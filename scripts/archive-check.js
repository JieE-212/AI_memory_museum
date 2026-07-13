"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const zlib = require("node:zlib");
const { createArchive, extractArchive } = require("../lib/time-isle-archive");

let assertions = 0;

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "time-isle-archive-"));
  let failure = null;
  try {
    await runChecks(temporaryRoot);
  } catch (error) {
    failure = error;
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
  if (failure) throw failure;
  checkEqual(fs.existsSync(temporaryRoot), false, "temporary archive workspace is removed");
  console.log(`archive-check: ${assertions} assertions passed`);
}

async function runChecks(temporaryRoot) {
  const manifest = Buffer.from(JSON.stringify({ format: "time-isle", version: 4 }), "utf8");
  const photo = crypto.randomBytes(1537);
  const longPath = `media/${"旧相册/".repeat(11)}originals/照片.webp`;
  const archive = createArchive([
    { path: "manifest.json", data: manifest, mtime: 0 },
    { path: longPath, data: photo, mtime: 1720000000 },
    { path: "collection/memories.json", data: "[]" }
  ]);
  check(Buffer.isBuffer(archive), "createArchive returns a Buffer");
  check(archive.subarray(0, 2).equals(Buffer.from([0x1f, 0x8b])), "created archive has a gzip signature");

  const roundTripRoot = path.join(temporaryRoot, "roundtrip");
  const source = Readable.from([
    archive.subarray(0, 17),
    archive.subarray(17, 113),
    archive.subarray(113)
  ]);
  const extracted = await extractArchive(source, {
    stagingRoot: roundTripRoot,
    maxEntries: 10,
    maxEntryBytes: 4096,
    maxTotalBytes: 8192
  });
  checkEqual(extracted.format, "time-isle.tar.gz", "extract reports its strict archive format");
  checkEqual(extracted.entries.length, 3, "round-trip preserves the entry count");
  checkEqual(extracted.totalBytes, manifest.length + photo.length + 2, "round-trip reports the exact total payload");
  checkDeepEqual(fs.readFileSync(path.join(roundTripRoot, "manifest.json")), manifest, "manifest bytes round-trip");
  checkDeepEqual(fs.readFileSync(path.join(roundTripRoot, ...longPath.split("/"))), photo, "binary photo bytes round-trip");
  checkEqual(
    extracted.entries.find((entry) => entry.path === longPath)?.sha256,
    digest(photo),
    "extracted metadata contains a SHA-256 digest"
  );
  checkEqual(extracted.entries.find((entry) => entry.path === longPath)?.mtime, 1720000000, "ustar mtime round-trips");
  check(extracted.entries.every((entry) => !Object.hasOwn(entry, "data")), "returned metadata does not retain file buffers");

  checkThrows(
    () => createArchive([{ path: "/absolute.txt", data: "x" }]),
    "ARCHIVE_ABSOLUTE_PATH",
    "creator rejects absolute paths"
  );
  checkThrows(
    () => createArchive([{ path: "../escape.txt", data: "x" }]),
    "ARCHIVE_PATH_ESCAPE",
    "creator rejects parent traversal"
  );
  checkThrows(
    () => createArchive([{ path: "folder\\escape.txt", data: "x" }]),
    "ARCHIVE_BACKSLASH_FORBIDDEN",
    "creator rejects backslash paths"
  );
  checkThrows(
    () => createArchive([
      { path: "Photo.jpg", data: "one" },
      { path: "photo.jpg", data: "two" }
    ]),
    "ARCHIVE_DUPLICATE_ENTRY",
    "creator rejects case-colliding duplicate entries"
  );
  checkThrows(
    () => createArchive([{ path: "CON.txt", data: "x" }]),
    "ARCHIVE_PATH_INVALID",
    "creator rejects unsafe Windows device names"
  );

  const simple = createArchive([{ path: "safe/file.txt", data: "hello" }]);
  const attacks = [
    {
      name: "absolute tar path",
      archive: mutateFirstHeader(simple, (header) => writeHeaderPath(header, "/escape.txt")),
      code: "ARCHIVE_ABSOLUTE_PATH"
    },
    {
      name: "parent traversal tar path",
      archive: mutateFirstHeader(simple, (header) => writeHeaderPath(header, "../escape.txt")),
      code: "ARCHIVE_PATH_ESCAPE"
    },
    {
      name: "backslash tar path",
      archive: mutateFirstHeader(simple, (header) => writeHeaderPath(header, "..\\escape.txt")),
      code: "ARCHIVE_BACKSLASH_FORBIDDEN"
    },
    {
      name: "symbolic link",
      archive: mutateFirstHeader(simple, (header) => {
        header[156] = "2".charCodeAt(0);
        writeField(header, 157, 100, "../../escape.txt");
      }),
      code: "ARCHIVE_SYMLINK_FORBIDDEN"
    },
    {
      name: "hard link",
      archive: mutateFirstHeader(simple, (header) => {
        header[156] = "1".charCodeAt(0);
        writeField(header, 157, 100, "safe/file.txt");
      }),
      code: "ARCHIVE_HARDLINK_FORBIDDEN"
    },
    {
      name: "unknown tar type",
      archive: mutateFirstHeader(simple, (header) => {
        header[156] = "5".charCodeAt(0);
      }),
      code: "ARCHIVE_TYPE_UNSUPPORTED"
    }
  ];
  for (let index = 0; index < attacks.length; index += 1) {
    const attack = attacks[index];
    await checkRejects(
      () => extractArchive(Readable.from([attack.archive]), {
        stagingRoot: path.join(temporaryRoot, `attack-${index}`),
        maxEntries: 10,
        maxEntryBytes: 1024,
        maxTotalBytes: 2048
      }),
      attack.code,
      `extractor rejects ${attack.name}`
    );
  }
  checkEqual(fs.existsSync(path.join(temporaryRoot, "escape.txt")), false, "path attacks never create an escaped file");

  const duplicateTar = mutateHeader(
    createArchive([
      { path: "first.txt", data: "a" },
      { path: "second.txt", data: "b" }
    ]),
    1024,
    (header) => writeHeaderPath(header, "first.txt")
  );
  await checkRejects(
    () => extractArchive(duplicateTar, { stagingRoot: path.join(temporaryRoot, "duplicate") }),
    "ARCHIVE_DUPLICATE_ENTRY",
    "extractor rejects duplicate tar entries"
  );

  const checksumTar = mutateRawTar(simple, (tar) => {
    tar[0] = tar[0] === 0x73 ? 0x74 : 0x73;
  });
  await checkRejects(
    () => extractArchive(checksumTar, { stagingRoot: path.join(temporaryRoot, "checksum") }),
    "ARCHIVE_CHECKSUM_INVALID",
    "extractor rejects a bad tar checksum"
  );

  const truncatedTar = mutateRawTar(simple, (tar) => tar.subarray(0, tar.length - 512));
  await checkRejects(
    () => extractArchive(truncatedTar, { stagingRoot: path.join(temporaryRoot, "truncated") }),
    "ARCHIVE_TRUNCATED",
    "extractor rejects a truncated tar end marker"
  );

  const oversizedDeclaration = mutateFirstHeader(simple, (header) => writeOctal(header, 124, 12, 4096));
  await checkRejects(
    () => extractArchive(oversizedDeclaration, {
      stagingRoot: path.join(temporaryRoot, "declared-size"),
      maxEntryBytes: 8192,
      maxTotalBytes: 8192
    }),
    "ARCHIVE_TRUNCATED",
    "extractor rejects an entry whose declared bytes are missing"
  );

  await checkRejects(
    () => extractArchive(simple.subarray(0, simple.length - 4), {
      stagingRoot: path.join(temporaryRoot, "gzip-truncated")
    }),
    "ARCHIVE_GZIP_INVALID",
    "extractor rejects a truncated gzip stream"
  );

  const limitsArchive = createArchive([
    { path: "one.bin", data: Buffer.alloc(8, 1) },
    { path: "two.bin", data: Buffer.alloc(8, 2) }
  ]);
  await checkRejects(
    () => extractArchive(limitsArchive, {
      stagingRoot: path.join(temporaryRoot, "entry-limit"),
      maxEntries: 2,
      maxEntryBytes: 7,
      maxTotalBytes: 16
    }),
    "ARCHIVE_ENTRY_TOO_LARGE",
    "extractor enforces the per-entry byte limit"
  );
  await checkRejects(
    () => extractArchive(limitsArchive, {
      stagingRoot: path.join(temporaryRoot, "total-limit"),
      maxEntries: 2,
      maxEntryBytes: 8,
      maxTotalBytes: 15
    }),
    "ARCHIVE_TOTAL_TOO_LARGE",
    "extractor enforces the total byte limit"
  );
  await checkRejects(
    () => extractArchive(limitsArchive, {
      stagingRoot: path.join(temporaryRoot, "entry-count"),
      maxEntries: 1,
      maxEntryBytes: 8,
      maxTotalBytes: 16
    }),
    "ARCHIVE_TOO_MANY_ENTRIES",
    "extractor enforces the entry-count limit"
  );

  await checkRejects(
    () => extractArchive(archive, {
      stagingRoot: roundTripRoot,
      maxEntries: 10,
      maxEntryBytes: 4096,
      maxTotalBytes: 8192
    }),
    "ARCHIVE_TARGET_EXISTS",
    "extractor does not overwrite an existing staging file"
  );
}

function mutateFirstHeader(archive, mutate) {
  return mutateHeader(archive, 0, mutate);
}

function mutateHeader(archive, headerOffset, mutate) {
  return mutateRawTar(archive, (tar) => {
    const header = tar.subarray(headerOffset, headerOffset + 512);
    mutate(header);
    refreshChecksum(header);
  });
}

function mutateRawTar(archive, mutate) {
  const tar = Buffer.from(zlib.gunzipSync(archive));
  const result = mutate(tar) || tar;
  return zlib.gzipSync(result, { level: 9, mtime: 0 });
}

function writeHeaderPath(header, entryPath) {
  writeField(header, 0, 100, entryPath);
  header.fill(0, 345, 500);
}

function writeField(buffer, offset, length, value) {
  buffer.fill(0, offset, offset + length);
  Buffer.from(value, "utf8").copy(buffer, offset, 0, length);
}

function writeOctal(buffer, offset, length, value) {
  buffer.fill(0, offset, offset + length);
  buffer.write(`${value.toString(8).padStart(length - 1, "0")}\0`, offset, length, "ascii");
}

function refreshChecksum(header) {
  header.fill(0x20, 148, 156);
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(checksum.toString(8).padStart(6, "0"), 148, 6, "ascii");
  header[154] = 0;
  header[155] = 0x20;
}

function digest(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function check(condition, message) {
  assert.ok(condition, message);
  assertions += 1;
}

function checkEqual(actual, expected, message) {
  assert.equal(actual, expected, message);
  assertions += 1;
}

function checkDeepEqual(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
  assertions += 1;
}

function checkThrows(operation, expectedCode, message) {
  let error = null;
  try {
    operation();
  } catch (caught) {
    error = caught;
  }
  assert.equal(error?.code, expectedCode, message);
  assertions += 1;
}

async function checkRejects(operation, expectedCode, message) {
  let error = null;
  try {
    await operation();
  } catch (caught) {
    error = caught;
  }
  assert.equal(error?.code, expectedCode, message);
  assertions += 1;
}
