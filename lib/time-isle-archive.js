"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { Readable, Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { TextDecoder } = require("node:util");

const TAR_BLOCK_BYTES = 512;
const DEFAULT_MAX_ENTRIES = 1000;
const DEFAULT_MAX_ENTRY_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 250 * 1024 * 1024;
const CREATE_MAX_ENTRIES = 10000;
const CREATE_MAX_ENTRY_BYTES = 100 * 1024 * 1024;
const CREATE_MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
const CONFIG_MAX_ENTRIES = 100000;
const CONFIG_MAX_ENTRY_BYTES = 512 * 1024 * 1024;
const CONFIG_MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const STREAM_CHUNK_BYTES = 64 * 1024;
const GZIP_HEADER_BYTES = 10;
const GZIP_TRAILER_BYTES = 8;
const CRC32_TABLE = createCrc32Table();
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

/**
 * Compatibility-only in-memory writer retained for existing callers and old
 * tests. Production exports should use createArchiveFile so media-sized tar
 * and gzip payloads are never aggregated. Only regular files are supported;
 * directories are inferred from their file paths.
 */
function createArchive(entries) {
  if (!Array.isArray(entries)) throw archiveError("entries must be an array.", "ARCHIVE_INPUT_INVALID");
  if (entries.length > CREATE_MAX_ENTRIES) {
    throw archiveError(`Archive contains more than ${CREATE_MAX_ENTRIES} entries.`, "ARCHIVE_TOO_MANY_ENTRIES");
  }

  const seen = new Set();
  const chunks = [];
  let totalBytes = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    assertPlainObject(entry, `entries[${index}]`);
    assertKnownKeys(entry, new Set(["path", "name", "data", "content", "mtime"]), `entries[${index}]`);
    const archivePath = validateArchivePath(firstDefined(entry.path, entry.name), `entries[${index}].path`);
    const collisionKey = pathCollisionKey(archivePath);
    if (seen.has(collisionKey)) {
      throw archiveError(`Duplicate archive entry: ${archivePath}`, "ARCHIVE_DUPLICATE_ENTRY");
    }
    seen.add(collisionKey);

    const data = toBuffer(firstDefined(entry.data, entry.content), `entries[${index}].data`);
    if (data.length > CREATE_MAX_ENTRY_BYTES) {
      throw archiveError(`Archive entry is too large: ${archivePath}`, "ARCHIVE_ENTRY_TOO_LARGE");
    }
    totalBytes = safeAdd(totalBytes, data.length, "ARCHIVE_TOTAL_TOO_LARGE");
    if (totalBytes > CREATE_MAX_TOTAL_BYTES) {
      throw archiveError("Archive payload is too large.", "ARCHIVE_TOTAL_TOO_LARGE");
    }

    const mtime = entry.mtime === undefined
      ? 0
      : requireSafeInteger(entry.mtime, `entries[${index}].mtime`, 0, 8589934591);
    chunks.push(createTarHeader(archivePath, data.length, mtime));
    chunks.push(data);
    const paddingBytes = paddingFor(data.length);
    if (paddingBytes) chunks.push(Buffer.alloc(paddingBytes));
  }
  chunks.push(Buffer.alloc(TAR_BLOCK_BYTES * 2));
  return zlib.gzipSync(Buffer.concat(chunks), { level: 9, mtime: 0 });
}

/**
 * Creates the same deterministic ustar + gzip format without aggregating the
 * tar or compressed archive in memory. Entries may use either `data`/`content`
 * or a regular `filePath`; file-backed entries are re-hashed while streamed so
 * a source mutation cannot silently enter the archive.
 */
async function createArchiveFile(entries, options = {}) {
  assertPlainObject(options, "options");
  assertKnownKeys(options, new Set(["outputPath", "signal"]), "options");
  const outputPath = validateOutputPath(options.outputPath);
  const normalized = normalizeStreamingEntries(entries);
  const source = Readable.from(generateTarChunks(normalized, options.signal));
  const gzip = zlib.createGzip({ level: 9, mtime: 0 });
  const output = fs.createWriteStream(outputPath, { flags: "wx", mode: 0o600 });
  try {
    await pipeline(source, gzip, output, { signal: options.signal });
    const stat = fs.lstatSync(outputPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw archiveError("Archive output is not a regular file.", "ARCHIVE_OUTPUT_INVALID");
    }
    let cleaned = false;
    return Object.freeze({
      path: outputPath,
      length: stat.size,
      cleanup: async () => {
        if (cleaned) return;
        await fs.promises.rm(outputPath, { force: true });
        cleaned = true;
      }
    });
  } catch (cause) {
    source.destroy();
    gzip.destroy();
    output.destroy();
    try { fs.rmSync(outputPath, { force: true }); } catch { /* best-effort cleanup */ }
    if (options.signal?.aborted) throw abortReason(options.signal, cause);
    if (cause?.name === "AbortError") throw cause;
    if (String(cause?.code || "").startsWith("ARCHIVE_")) throw cause;
    throw archiveError("Archive could not be written as a gzip stream.", "ARCHIVE_OUTPUT_INVALID", cause);
  }
}

/**
 * Strictly extracts an archive into a caller-owned staging directory. The tar
 * is fully validated before the first output file is created.
 */
async function extractArchive(source, options = {}) {
  assertPlainObject(options, "options");
  assertKnownKeys(
    options,
    new Set(["stagingRoot", "maxEntries", "maxEntryBytes", "maxTotalBytes", "signal", "layout"]),
    "options"
  );
  const stagingRoot = validateStagingRoot(options.stagingRoot);
  if (options.layout !== undefined && options.layout !== "paths" && options.layout !== "flat") {
    throw archiveError("options.layout must be paths or flat.", "ARCHIVE_INPUT_INVALID");
  }
  const limits = {
    maxEntries: optionalSafeInteger(options.maxEntries, "options.maxEntries", 1, CONFIG_MAX_ENTRIES, DEFAULT_MAX_ENTRIES),
    maxEntryBytes: optionalSafeInteger(
      options.maxEntryBytes,
      "options.maxEntryBytes",
      0,
      CONFIG_MAX_ENTRY_BYTES,
      DEFAULT_MAX_ENTRY_BYTES
    ),
    maxTotalBytes: optionalSafeInteger(
      options.maxTotalBytes,
      "options.maxTotalBytes",
      0,
      CONFIG_MAX_TOTAL_BYTES,
      DEFAULT_MAX_TOTAL_BYTES
    )
  };
  if (limits.maxEntryBytes > limits.maxTotalBytes) {
    limits.maxEntryBytes = limits.maxTotalBytes;
  }

  const maximumTarBytes = calculateMaximumTarBytes(limits);
  const replayable = await prepareReplayableSource(
    source,
    maximumTarBytes + 1024 * 1024,
    options.signal,
    stagingRoot
  );
  try {
    const gzip = await inspectCanonicalGzip(replayable);
    // Pass one validates every header, byte count, padding block and digest
    // before an archive-controlled output path is created.
    const first = await scanCompressedTar(replayable, gzip, limits, { signal: options.signal });
    const writer = createStagingWriter(stagingRoot, options.layout === "flat");
    try {
      // Pass two replays the exact compressed source, compares every entry to
      // pass one, and only then materializes bounded chunks into staging.
      const second = await scanCompressedTar(replayable, gzip, limits, {
        signal: options.signal,
        expectedEntries: first.entries,
        visitor: writer
      });
      writer.complete();
      return {
        format: "time-isle.tar.gz",
        entries: second.entries,
        totalBytes: second.totalBytes
      };
    } catch (error) {
      writer.abort();
      throw error;
    }
  } finally {
    await replayable.cleanup();
  }
}

function normalizeStreamingEntries(entries) {
  if (!Array.isArray(entries)) throw archiveError("entries must be an array.", "ARCHIVE_INPUT_INVALID");
  if (entries.length > CREATE_MAX_ENTRIES) {
    throw archiveError(`Archive contains more than ${CREATE_MAX_ENTRIES} entries.`, "ARCHIVE_TOO_MANY_ENTRIES");
  }
  const seen = new Set();
  let totalBytes = 0;
  return entries.map((entry, index) => {
    assertPlainObject(entry, `entries[${index}]`);
    assertKnownKeys(
      entry,
      new Set(["path", "name", "data", "content", "filePath", "size", "sha256", "mtime"]),
      `entries[${index}]`
    );
    const archivePath = validateArchivePath(firstDefined(entry.path, entry.name), `entries[${index}].path`);
    const collisionKey = pathCollisionKey(archivePath);
    if (seen.has(collisionKey)) {
      throw archiveError(`Duplicate archive entry: ${archivePath}`, "ARCHIVE_DUPLICATE_ENTRY");
    }
    seen.add(collisionKey);
    const hasFile = entry.filePath !== undefined;
    const hasData = entry.data !== undefined || entry.content !== undefined;
    if (hasFile === hasData) {
      throw archiveError(`Archive entry must have exactly one source: ${archivePath}`, "ARCHIVE_INPUT_INVALID");
    }
    let data = null;
    let filePath = null;
    let size;
    if (hasFile) {
      filePath = validateSourceFile(entry.filePath, archivePath);
      const stat = fs.lstatSync(filePath);
      size = stat.size;
      if (entry.size !== undefined && entry.size !== size) {
        throw archiveError(`Archive source size changed: ${archivePath}`, "ARCHIVE_SOURCE_CHANGED");
      }
    } else {
      data = toBuffer(firstDefined(entry.data, entry.content), `entries[${index}].data`);
      size = data.length;
    }
    if (size > CREATE_MAX_ENTRY_BYTES) {
      throw archiveError(`Archive entry is too large: ${archivePath}`, "ARCHIVE_ENTRY_TOO_LARGE");
    }
    totalBytes = safeAdd(totalBytes, size, "ARCHIVE_TOTAL_TOO_LARGE");
    if (totalBytes > CREATE_MAX_TOTAL_BYTES) {
      throw archiveError("Archive payload is too large.", "ARCHIVE_TOTAL_TOO_LARGE");
    }
    const expectedHash = entry.sha256 === undefined ? null : validateSha256(entry.sha256, `entries[${index}].sha256`);
    const mtime = entry.mtime === undefined
      ? 0
      : requireSafeInteger(entry.mtime, `entries[${index}].mtime`, 0, 8589934591);
    return { path: archivePath, data, filePath, size, expectedHash, mtime };
  });
}

async function* generateTarChunks(entries, signal) {
  for (const entry of entries) {
    throwIfAborted(signal);
    yield createTarHeader(entry.path, entry.size, entry.mtime);
    const hash = crypto.createHash("sha256");
    let emitted = 0;
    if (entry.data !== null) {
      hash.update(entry.data);
      emitted = entry.data.length;
      yield entry.data;
    } else {
      const handle = await fs.promises.open(entry.filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size !== entry.size) {
          throw archiveError(`Archive source changed while reading: ${entry.path}`, "ARCHIVE_SOURCE_CHANGED");
        }
        const stream = handle.createReadStream({ autoClose: false, highWaterMark: STREAM_CHUNK_BYTES });
        for await (const chunk of stream) {
          throwIfAborted(signal);
          const buffer = binaryChunk(chunk);
          emitted = safeAdd(emitted, buffer.length, "ARCHIVE_SOURCE_CHANGED");
          if (emitted > entry.size) {
            throw archiveError(`Archive source grew while reading: ${entry.path}`, "ARCHIVE_SOURCE_CHANGED");
          }
          hash.update(buffer);
          yield buffer;
        }
      } finally {
        await handle.close();
      }
    }
    if (emitted !== entry.size) {
      throw archiveError(`Archive source was truncated while reading: ${entry.path}`, "ARCHIVE_SOURCE_CHANGED");
    }
    const digest = hash.digest("hex");
    if (entry.expectedHash && digest !== entry.expectedHash) {
      throw archiveError(`Archive source hash changed: ${entry.path}`, "ARCHIVE_SOURCE_CHANGED");
    }
    const paddingBytes = paddingFor(entry.size);
    if (paddingBytes) yield Buffer.alloc(paddingBytes);
  }
  yield Buffer.alloc(TAR_BLOCK_BYTES * 2);
}

function createTarHeader(archivePath, size, mtime) {
  const header = Buffer.alloc(TAR_BLOCK_BYTES);
  const { name, prefix } = splitUstarPath(archivePath);
  writeUtf8Field(header, 0, 100, name, "tar name");
  writeOctalField(header, 100, 8, 0o600, "tar mode");
  writeOctalField(header, 108, 8, 0, "tar uid");
  writeOctalField(header, 116, 8, 0, "tar gid");
  writeOctalField(header, 124, 12, size, "tar size");
  writeOctalField(header, 136, 12, mtime, "tar mtime");
  header.fill(0x20, 148, 156);
  header[156] = 0x30;
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  header.write("TIME ISLE", 265, 9, "ascii");
  header.write("TIME ISLE", 297, 9, "ascii");
  if (prefix) writeUtf8Field(header, 345, 155, prefix, "tar prefix");
  const checksum = calculateTarChecksum(header);
  const checksumText = checksum.toString(8).padStart(6, "0");
  header.write(checksumText, 148, 6, "ascii");
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

function verifyTarHeader(header) {
  const declaredChecksum = parseOctalField(header, 148, 8, "checksum");
  const checksumHeader = Buffer.from(header);
  checksumHeader.fill(0x20, 148, 156);
  const actualChecksum = calculateTarChecksum(checksumHeader);
  if (declaredChecksum !== actualChecksum) {
    throw archiveError("Tar header checksum does not match its contents.", "ARCHIVE_CHECKSUM_INVALID");
  }
}

function calculateTarChecksum(header) {
  let checksum = 0;
  for (const byte of header) checksum += byte;
  return checksum;
}

function parseOctalField(buffer, offset, length, name) {
  const field = buffer.subarray(offset, offset + length);
  if (field[0] & 0x80) {
    throw archiveError(`Base-256 tar ${name} values are not supported.`, "ARCHIVE_FORMAT_UNSUPPORTED");
  }
  const text = field.toString("ascii").replace(/[\0 ]+$/g, "").replace(/^ +/g, "");
  if (!text || !/^[0-7]+$/.test(text)) {
    throw archiveError(`Tar ${name} field is invalid.`, "ARCHIVE_FORMAT_INVALID");
  }
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw archiveError(`Tar ${name} field is outside the supported range.`, "ARCHIVE_FORMAT_UNSUPPORTED");
  }
  return value;
}

function readTarText(buffer, offset, length, name) {
  const field = buffer.subarray(offset, offset + length);
  const terminator = field.indexOf(0);
  const content = terminator < 0 ? field : field.subarray(0, terminator);
  if (terminator >= 0 && !isZeroBlock(field.subarray(terminator))) {
    throw archiveError(`Tar ${name} field has data after its terminator.`, "ARCHIVE_FORMAT_INVALID");
  }
  try {
    return utf8Decoder.decode(content);
  } catch (cause) {
    throw archiveError(`Tar ${name} is not valid UTF-8.`, "ARCHIVE_FORMAT_INVALID", cause);
  }
}

function prepareStagingRoot(stagingRoot) {
  if (fs.existsSync(stagingRoot)) {
    const stat = fs.lstatSync(stagingRoot);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw archiveError("stagingRoot must be a real directory, not a link.", "ARCHIVE_STAGING_INVALID");
    }
    return;
  }
  fs.mkdirSync(stagingRoot, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(stagingRoot);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw archiveError("stagingRoot could not be created safely.", "ARCHIVE_STAGING_INVALID");
  }
}

function ensureSafeParentDirectories(stagingRoot, parentPath, createdDirectories) {
  const relative = path.relative(stagingRoot, parentPath);
  if (!relative) return;
  let current = stagingRoot;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    if (fs.existsSync(current)) {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw archiveError("A staging path component is not a real directory.", "ARCHIVE_STAGING_ESCAPE");
      }
    } else {
      fs.mkdirSync(current, { mode: 0o700 });
      createdDirectories.push(current);
    }
  }
}

function resolveStagingTarget(stagingRoot, archivePath) {
  const targetPath = path.resolve(stagingRoot, ...archivePath.split("/"));
  const rootPrefix = `${path.resolve(stagingRoot)}${path.sep}`;
  const comparableTarget = process.platform === "win32" ? targetPath.toLowerCase() : targetPath;
  const comparableRoot = process.platform === "win32" ? rootPrefix.toLowerCase() : rootPrefix;
  if (!comparableTarget.startsWith(comparableRoot)) {
    throw archiveError("Archive entry escapes stagingRoot.", "ARCHIVE_PATH_ESCAPE");
  }
  return targetPath;
}

function validateArchivePath(value, name) {
  if (typeof value !== "string") throw archiveError(`${name} must be a string.`, "ARCHIVE_PATH_INVALID");
  const normalized = value.normalize("NFC");
  if (!normalized || Buffer.byteLength(normalized, "utf8") > 255 || normalized.includes("\0")) {
    throw archiveError(`${name} is empty or too long.`, "ARCHIVE_PATH_INVALID");
  }
  if (normalized.startsWith("/") || normalized.startsWith("\\") || /^[a-zA-Z]:/.test(normalized)) {
    throw archiveError(`${name} must be relative.`, "ARCHIVE_ABSOLUTE_PATH");
  }
  if (normalized.includes("\\")) {
    throw archiveError(`${name} cannot contain backslashes.`, "ARCHIVE_BACKSLASH_FORBIDDEN");
  }
  if (/[:\x00-\x1f\x7f]/u.test(normalized)) {
    throw archiveError(`${name} contains unsupported characters.`, "ARCHIVE_PATH_INVALID");
  }
  const segments = normalized.split("/");
  for (const segment of segments) {
    if (!segment || segment === "." || segment === "..") {
      throw archiveError(`${name} contains an unsafe path segment.`, "ARCHIVE_PATH_ESCAPE");
    }
    if (segment.endsWith(".") || segment.endsWith(" ") || isWindowsDeviceName(segment)) {
      throw archiveError(`${name} is not portable to a safe staging path.`, "ARCHIVE_PATH_INVALID");
    }
  }
  splitUstarPath(normalized);
  return normalized;
}

function validateStagingRoot(value) {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) {
    throw archiveError("options.stagingRoot is required.", "ARCHIVE_STAGING_INVALID");
  }
  if (!path.isAbsolute(value)) {
    throw archiveError("options.stagingRoot must be absolute.", "ARCHIVE_STAGING_INVALID");
  }
  return path.resolve(value);
}

function validateOutputPath(value) {
  if (typeof value !== "string" || !value.trim() || value.includes("\0") || !path.isAbsolute(value)) {
    throw archiveError("options.outputPath must be an absolute file path.", "ARCHIVE_OUTPUT_INVALID");
  }
  const resolved = path.resolve(value);
  const parent = path.dirname(resolved);
  let stat;
  try {
    stat = fs.lstatSync(parent);
  } catch (cause) {
    throw archiveError("Archive output parent does not exist.", "ARCHIVE_OUTPUT_INVALID", cause);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw archiveError("Archive output parent must be a real directory.", "ARCHIVE_OUTPUT_INVALID");
  }
  return resolved;
}

function validateSourceFile(value, archivePath) {
  if (typeof value !== "string" || !value.trim() || value.includes("\0") || !path.isAbsolute(value)) {
    throw archiveError(`Archive source path is invalid: ${archivePath}`, "ARCHIVE_INPUT_INVALID");
  }
  const resolved = path.resolve(value);
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch (cause) {
    throw archiveError(`Archive source is missing: ${archivePath}`, "ARCHIVE_INPUT_INVALID", cause);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw archiveError(`Archive source is not a regular file: ${archivePath}`, "ARCHIVE_INPUT_INVALID");
  }
  return resolved;
}

function validateSha256(value, name) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw archiveError(`${name} must be a lowercase SHA-256 digest.`, "ARCHIVE_INPUT_INVALID");
  }
  return value;
}

function binaryChunk(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  throw archiveError("Archive streams must emit binary chunks.", "ARCHIVE_INPUT_INVALID");
}

function createCrc32Table() {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
}

function abortReason(signal, fallback) {
  if (signal?.reason instanceof Error) return signal.reason;
  if (fallback?.name === "AbortError") return fallback;
  const error = new Error("Archive operation was aborted.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (typeof signal.throwIfAborted === "function") signal.throwIfAborted();
  throw abortReason(signal);
}

function splitUstarPath(archivePath) {
  if (Buffer.byteLength(archivePath, "utf8") <= 100) return { name: archivePath, prefix: "" };
  const slashPositions = [];
  for (let index = 0; index < archivePath.length; index += 1) {
    if (archivePath[index] === "/") slashPositions.push(index);
  }
  for (let index = slashPositions.length - 1; index >= 0; index -= 1) {
    const splitAt = slashPositions[index];
    const prefix = archivePath.slice(0, splitAt);
    const name = archivePath.slice(splitAt + 1);
    if (Buffer.byteLength(prefix, "utf8") <= 155 && Buffer.byteLength(name, "utf8") <= 100) {
      return { name, prefix };
    }
  }
  throw archiveError(`Path cannot be represented by ustar: ${archivePath}`, "ARCHIVE_PATH_TOO_LONG");
}

function writeUtf8Field(buffer, offset, length, value, name) {
  const encoded = Buffer.from(value, "utf8");
  if (encoded.length > length) throw archiveError(`${name} is too long.`, "ARCHIVE_PATH_TOO_LONG");
  encoded.copy(buffer, offset);
}

function writeOctalField(buffer, offset, length, value, name) {
  const digits = value.toString(8);
  if (digits.length > length - 1) throw archiveError(`${name} is too large.`, "ARCHIVE_FORMAT_UNSUPPORTED");
  buffer.write(`${digits.padStart(length - 1, "0")}\0`, offset, length, "ascii");
}

async function prepareReplayableSource(source, maximumBytes, signal, stagingRoot) {
  if (Buffer.isBuffer(source) || source instanceof Uint8Array) {
    const buffer = Buffer.isBuffer(source)
      ? source
      : Buffer.from(source.buffer, source.byteOffset, source.byteLength);
    if (buffer.length > maximumBytes) {
      throw archiveError("Compressed archive is too large.", "ARCHIVE_COMPRESSED_TOO_LARGE");
    }
    return {
      size: buffer.length,
      open: (start = 0) => Readable.from([buffer.subarray(start)]),
      read: async (offset, length) => Buffer.from(buffer.subarray(offset, offset + length)),
      cleanup: async () => {}
    };
  }
  if (!source || typeof source[Symbol.asyncIterator] !== "function") {
    throw archiveError("Archive source must be a Buffer, Uint8Array, Readable, or async iterable.", "ARCHIVE_INPUT_INVALID");
  }

  const replayParent = path.dirname(stagingRoot);
  await fs.promises.mkdir(replayParent, { recursive: true, mode: 0o700 });
  const parentStat = await fs.promises.lstat(replayParent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw archiveError("Archive replay parent must be a real directory.", "ARCHIVE_STAGING_INVALID");
  }
  // Keep streamed private archives beside the caller-owned staging root. Its
  // basename retains restore-/inspect-/drill- prefixes, so crash leftovers are
  // covered by the same bounded startup cleanup instead of global OS temp.
  const replayPrefix = path.join(replayParent, `${path.basename(stagingRoot)}-input-`);
  const temporaryRoot = await fs.promises.mkdtemp(replayPrefix);
  const temporaryPath = path.join(temporaryRoot, "archive.time-isle.upload");
  let totalBytes = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      try {
        const buffer = binaryChunk(chunk);
        totalBytes = safeAdd(totalBytes, buffer.length, "ARCHIVE_COMPRESSED_TOO_LARGE");
        if (totalBytes > maximumBytes) {
          throw archiveError("Compressed archive is too large.", "ARCHIVE_COMPRESSED_TOO_LARGE");
        }
        callback(null, buffer);
      } catch (error) {
        callback(error);
      }
    }
  });
  try {
    await pipeline(
      Readable.from(source),
      limiter,
      fs.createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 }),
      { signal }
    );
    return {
      size: totalBytes,
      open: (start = 0) => fs.createReadStream(temporaryPath, { start, highWaterMark: STREAM_CHUNK_BYTES }),
      read: async (offset, length) => {
        const handle = await fs.promises.open(temporaryPath, "r");
        try {
          const output = Buffer.alloc(length);
          const { bytesRead } = await handle.read(output, 0, length, offset);
          return output.subarray(0, bytesRead);
        } finally {
          await handle.close();
        }
      },
      cleanup: async () => fs.promises.rm(temporaryRoot, { recursive: true, force: true })
    };
  } catch (cause) {
    try { await fs.promises.rm(temporaryRoot, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
    if (signal?.aborted) throw abortReason(signal, cause);
    if (cause?.name === "AbortError" || String(cause?.code || "").startsWith("ARCHIVE_")) throw cause;
    throw archiveError("Archive input stream could not be read.", "ARCHIVE_INPUT_INVALID", cause);
  }
}

async function inspectCanonicalGzip(replayable) {
  if (!Number.isSafeInteger(replayable.size) || replayable.size < GZIP_HEADER_BYTES + GZIP_TRAILER_BYTES + 1) {
    throw archiveError("Archive is not a complete gzip member.", "ARCHIVE_GZIP_INVALID");
  }
  const header = await replayable.read(0, GZIP_HEADER_BYTES);
  if (header.length !== GZIP_HEADER_BYTES || header[0] !== 0x1f || header[1] !== 0x8b || header[2] !== 8) {
    throw archiveError("Archive does not use the gzip deflate format.", "ARCHIVE_GZIP_INVALID");
  }
  if (header[3] !== 0) {
    throw archiveError("Archive gzip headers cannot contain optional fields.", "ARCHIVE_GZIP_INVALID");
  }
  if (header.readUInt32LE(4) !== 0) {
    throw archiveError("Archive gzip timestamp must be deterministic.", "ARCHIVE_GZIP_INVALID");
  }
  return Object.freeze({ dataOffset: GZIP_HEADER_BYTES });
}

async function scanCompressedTar(replayable, gzip, limits, options = {}) {
  const input = replayable.open(gzip.dataOffset);
  const inflate = zlib.createInflateRaw();
  const forwardError = (error) => inflate.destroy(error);
  input.once("error", forwardError);
  input.pipe(inflate);
  try {
    const scanned = await scanTarStream(inflate, limits, options);
    const deflateBytes = Number(inflate.bytesWritten);
    if (!Number.isSafeInteger(deflateBytes) || deflateBytes <= 0) {
      throw archiveError("Archive gzip deflate payload is invalid.", "ARCHIVE_GZIP_INVALID");
    }
    const trailerOffset = gzip.dataOffset + deflateBytes;
    if (trailerOffset + GZIP_TRAILER_BYTES !== replayable.size) {
      throw archiveError("Archive must contain exactly one gzip member with no trailing bytes.", "ARCHIVE_GZIP_INVALID");
    }
    const trailer = await replayable.read(trailerOffset, GZIP_TRAILER_BYTES);
    if (trailer.length !== GZIP_TRAILER_BYTES || trailer.readUInt32LE(0) !== scanned.gzipCrc32 ||
        trailer.readUInt32LE(4) !== scanned.gzipSize) {
      throw archiveError("Archive gzip trailer does not match its uncompressed bytes.", "ARCHIVE_GZIP_INVALID");
    }
    return scanned;
  } catch (cause) {
    if (options.signal?.aborted) throw abortReason(options.signal, cause);
    if (cause?.name === "AbortError" || String(cause?.code || "").startsWith("ARCHIVE_")) throw cause;
    throw archiveError("Archive is not a valid or complete gzip stream.", "ARCHIVE_GZIP_INVALID", cause);
  } finally {
    input.off("error", forwardError);
    input.destroy();
    inflate.destroy();
  }
}

async function scanTarStream(stream, limits, options) {
  const reader = new StreamByteReader(stream, calculateMaximumTarBytes(limits));
  const entries = [];
  const seen = new Set();
  let totalBytes = 0;
  let terminated = false;

  while (!terminated) {
    throwIfAborted(options.signal);
    const header = await reader.readExact(TAR_BLOCK_BYTES);
    if (isZeroBlock(header)) {
      const second = await reader.readExact(TAR_BLOCK_BYTES);
      if (!isZeroBlock(second)) {
        throw archiveError("Tar stream has an incomplete end marker.", "ARCHIVE_TRUNCATED");
      }
      await reader.assertZeroRemainder(() => throwIfAborted(options.signal));
      if (reader.totalBytes % TAR_BLOCK_BYTES !== 0) {
        throw archiveError("Tar stream is truncated or misaligned.", "ARCHIVE_TRUNCATED");
      }
      terminated = true;
      break;
    }

    const entry = parseStreamingHeader(header, seen, entries.length, limits);
    totalBytes = safeAdd(totalBytes, entry.size, "ARCHIVE_TOTAL_TOO_LARGE");
    if (totalBytes > limits.maxTotalBytes) {
      throw archiveError("Archive exceeds its total extraction limit.", "ARCHIVE_TOTAL_TOO_LARGE");
    }
    const expected = options.expectedEntries?.[entries.length];
    if (options.expectedEntries && (!expected || expected.path !== entry.path ||
        expected.size !== entry.size || expected.mtime !== entry.mtime)) {
      throw archiveError("Archive changed between validation passes.", "ARCHIVE_SOURCE_CHANGED");
    }
    options.visitor?.start?.(entry, entries.length);
    const hash = crypto.createHash("sha256");
    await reader.consume(entry.size, (chunk) => {
      throwIfAborted(options.signal);
      hash.update(chunk);
      options.visitor?.write?.(chunk, entry, entries.length);
    });
    const paddingBytes = paddingFor(entry.size);
    if (paddingBytes) {
      const padding = await reader.readExact(paddingBytes);
      if (!isZeroBlock(padding)) {
        throw archiveError(`Tar entry has non-zero padding: ${entry.path}`, "ARCHIVE_FORMAT_INVALID");
      }
    }
    entry.sha256 = hash.digest("hex");
    if (expected && expected.sha256 !== entry.sha256) {
      throw archiveError("Archive changed between validation passes.", "ARCHIVE_SOURCE_CHANGED");
    }
    options.visitor?.end?.(entry, entries.length);
    entries.push(Object.freeze({
      path: entry.path,
      size: entry.size,
      sha256: entry.sha256,
      mtime: entry.mtime,
      ...(entry.filePath ? { filePath: entry.filePath } : {})
    }));
  }

  if (!terminated) throw archiveError("Tar stream has no complete end marker.", "ARCHIVE_TRUNCATED");
  if (options.expectedEntries && entries.length !== options.expectedEntries.length) {
    throw archiveError("Archive changed between validation passes.", "ARCHIVE_SOURCE_CHANGED");
  }
  return {
    entries,
    totalBytes,
    gzipCrc32: reader.crc32(),
    gzipSize: reader.totalBytes >>> 0
  };
}

function parseStreamingHeader(header, seen, index, limits) {
  verifyTarHeader(header);
  const typeByte = header[156];
  if (typeByte === 0x31) throw archiveError("Hard links are not allowed in archives.", "ARCHIVE_HARDLINK_FORBIDDEN");
  if (typeByte === 0x32) throw archiveError("Symbolic links are not allowed in archives.", "ARCHIVE_SYMLINK_FORBIDDEN");
  if (typeByte !== 0 && typeByte !== 0x30) {
    throw archiveError(`Unsupported tar entry type: ${String.fromCharCode(typeByte)}`, "ARCHIVE_TYPE_UNSUPPORTED");
  }
  if (readTarText(header, 157, 100, "link name")) {
    throw archiveError("Regular files cannot contain link targets.", "ARCHIVE_LINK_TARGET_FORBIDDEN");
  }
  if (!header.subarray(257, 263).equals(Buffer.from("ustar\0", "ascii")) ||
      !header.subarray(263, 265).equals(Buffer.from("00", "ascii"))) {
    throw archiveError("Only POSIX ustar headers are supported.", "ARCHIVE_FORMAT_UNSUPPORTED");
  }
  if (!isZeroBlock(header.subarray(500, 512))) {
    throw archiveError("Tar header contains unsupported extension data.", "ARCHIVE_FORMAT_UNSUPPORTED");
  }
  parseOctalField(header, 100, 8, "mode");
  parseOctalField(header, 108, 8, "uid");
  parseOctalField(header, 116, 8, "gid");
  const size = parseOctalField(header, 124, 12, "size");
  const mtime = parseOctalField(header, 136, 12, "mtime");
  const name = readTarText(header, 0, 100, "name");
  const prefix = readTarText(header, 345, 155, "prefix");
  const archivePath = validateArchivePath(prefix ? `${prefix}/${name}` : name, "tar entry path");
  const collisionKey = pathCollisionKey(archivePath);
  if (seen.has(collisionKey)) {
    throw archiveError(`Duplicate archive entry: ${archivePath}`, "ARCHIVE_DUPLICATE_ENTRY");
  }
  seen.add(collisionKey);
  if (index + 1 > limits.maxEntries) {
    throw archiveError("Archive contains too many entries.", "ARCHIVE_TOO_MANY_ENTRIES");
  }
  if (size > limits.maxEntryBytes) {
    throw archiveError(`Archive entry exceeds its size limit: ${archivePath}`, "ARCHIVE_ENTRY_TOO_LARGE");
  }
  return { path: archivePath, size, mtime };
}

class StreamByteReader {
  constructor(stream, maximumBytes) {
    this.iterator = stream[Symbol.asyncIterator]();
    this.current = null;
    this.offset = 0;
    this.done = false;
    this.maximumBytes = maximumBytes;
    this.totalBytes = 0;
    this.crcState = 0xffffffff;
  }

  async readExact(length) {
    const output = Buffer.alloc(length);
    let written = 0;
    await this.consume(length, (chunk) => {
      chunk.copy(output, written);
      written += chunk.length;
    });
    return output;
  }

  async consume(length, callback) {
    let remaining = length;
    while (remaining > 0) {
      if (!this.current || this.offset >= this.current.length) await this.advance();
      if (this.done) throw archiveError("Tar entry or end marker is truncated.", "ARCHIVE_TRUNCATED");
      const available = Math.min(remaining, this.current.length - this.offset);
      const chunk = this.current.subarray(this.offset, this.offset + available);
      this.offset += available;
      remaining -= available;
      this.addTotal(available);
      this.updateCrc(chunk);
      callback(chunk);
    }
  }

  async assertZeroRemainder(checkpoint = () => {}) {
    if (this.current && this.offset < this.current.length) {
      checkpoint();
      const remainder = this.current.subarray(this.offset);
      this.addTotal(remainder.length);
      this.updateCrc(remainder);
      if (!isZeroBlock(remainder)) throw archiveError("Tar stream contains data after its end marker.", "ARCHIVE_TRAILING_DATA");
    }
    while (!this.done) {
      checkpoint();
      await this.advance();
      if (this.done) break;
      const remainder = this.current.subarray(this.offset);
      this.offset = this.current.length;
      this.addTotal(remainder.length);
      this.updateCrc(remainder);
      if (!isZeroBlock(remainder)) throw archiveError("Tar stream contains data after its end marker.", "ARCHIVE_TRAILING_DATA");
    }
  }

  async advance() {
    while (true) {
      const next = await this.iterator.next();
      if (next.done) {
        this.done = true;
        this.current = null;
        this.offset = 0;
        return;
      }
      this.current = binaryChunk(next.value);
      this.offset = 0;
      if (this.current.length) return;
    }
  }

  addTotal(bytes) {
    this.totalBytes = safeAdd(this.totalBytes, bytes, "ARCHIVE_TOTAL_TOO_LARGE");
    if (this.totalBytes > this.maximumBytes) {
      throw archiveError("Uncompressed archive exceeds its structural limit.", "ARCHIVE_TOTAL_TOO_LARGE");
    }
  }

  updateCrc(chunk) {
    let crc = this.crcState;
    for (const byte of chunk) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    this.crcState = crc >>> 0;
  }

  crc32() {
    return (this.crcState ^ 0xffffffff) >>> 0;
  }
}

function createStagingWriter(stagingRoot, flatLayout = false) {
  prepareStagingRoot(stagingRoot);
  const createdFiles = [];
  const createdDirectories = [];
  let descriptor;
  let currentPath = "";
  return {
    start(entry, index) {
      if (descriptor !== undefined) throw archiveError("Staging writer state is invalid.", "ARCHIVE_OUTPUT_INVALID");
      const targetPath = flatLayout
        ? path.join(
            stagingRoot,
            `.entry-${String(index + 1).padStart(6, "0")}-${crypto.createHash("sha256").update(entry.path).digest("hex").slice(0, 16)}.bin`
          )
        : resolveStagingTarget(stagingRoot, entry.path);
      if (!flatLayout) ensureSafeParentDirectories(stagingRoot, path.dirname(targetPath), createdDirectories);
      if (fs.existsSync(targetPath)) {
        throw archiveError(`Staging target already exists: ${entry.path}`, "ARCHIVE_TARGET_EXISTS");
      }
      descriptor = fs.openSync(
        targetPath,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0),
        0o600
      );
      currentPath = targetPath;
      createdFiles.push(targetPath);
      entry.filePath = targetPath;
    },
    write(chunk) {
      if (descriptor === undefined) throw archiveError("Staging writer is not open.", "ARCHIVE_OUTPUT_INVALID");
      let offset = 0;
      while (offset < chunk.length) offset += fs.writeSync(descriptor, chunk, offset, chunk.length - offset);
    },
    end() {
      if (descriptor === undefined) throw archiveError("Staging writer is not open.", "ARCHIVE_OUTPUT_INVALID");
      fs.closeSync(descriptor);
      descriptor = undefined;
      currentPath = "";
    },
    complete() {
      if (descriptor !== undefined) {
        fs.closeSync(descriptor);
        descriptor = undefined;
      }
    },
    abort() {
      if (descriptor !== undefined) {
        try { fs.closeSync(descriptor); } catch { /* best-effort close */ }
        descriptor = undefined;
      }
      for (const filePath of createdFiles.reverse()) {
        try { fs.rmSync(filePath, { force: true }); } catch { /* best-effort rollback */ }
      }
      for (const directoryPath of createdDirectories.reverse()) {
        try { fs.rmdirSync(directoryPath); } catch { /* preserve caller data */ }
      }
      currentPath = "";
    }
  };
}

function calculateMaximumTarBytes(limits) {
  const headerAndPadding = safeAdd(
    (limits.maxEntries + 1) * TAR_BLOCK_BYTES * 2,
    TAR_BLOCK_BYTES * 2,
    "ARCHIVE_LIMIT_INVALID"
  );
  return safeAdd(limits.maxTotalBytes, headerAndPadding, "ARCHIVE_LIMIT_INVALID");
}

function paddingFor(size) {
  return (TAR_BLOCK_BYTES - (size % TAR_BLOCK_BYTES)) % TAR_BLOCK_BYTES;
}

function isZeroBlock(buffer) {
  for (const byte of buffer) {
    if (byte !== 0) return false;
  }
  return true;
}

function pathCollisionKey(archivePath) {
  return archivePath.normalize("NFC").toLocaleLowerCase("en-US");
}

function isWindowsDeviceName(segment) {
  const basename = segment.split(".")[0].toUpperCase();
  return /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(basename);
}

function toBuffer(value, name) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (typeof value === "string") return Buffer.from(value, "utf8");
  throw archiveError(`${name} must be binary data or a string.`, "ARCHIVE_INPUT_INVALID");
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined);
}

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw archiveError(`${name} must be an object.`, "ARCHIVE_INPUT_INVALID");
  }
}

function assertKnownKeys(value, allowed, name) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) {
    throw archiveError(`${name} contains unsupported field(s): ${unknown.join(", ")}.`, "ARCHIVE_INPUT_INVALID");
  }
}

function requireSafeInteger(value, name, minimum, maximum) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw archiveError(`${name} must be an integer from ${minimum} to ${maximum}.`, "ARCHIVE_LIMIT_INVALID");
  }
  return value;
}

function optionalSafeInteger(value, name, minimum, maximum, fallback) {
  return value === undefined ? fallback : requireSafeInteger(value, name, minimum, maximum);
}

function safeAdd(left, right, code) {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw archiveError("Archive size exceeds the safe integer range.", code);
  return result;
}

function archiveError(message, code, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

module.exports = { createArchive, createArchiveFile, extractArchive };
