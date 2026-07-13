"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
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
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

/**
 * Creates a deterministic ustar archive wrapped in gzip. Only regular files
 * are supported; directories are inferred from their file paths.
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
 * Strictly extracts an archive into a caller-owned staging directory. The tar
 * is fully validated before the first output file is created.
 */
async function extractArchive(source, options = {}) {
  assertPlainObject(options, "options");
  assertKnownKeys(
    options,
    new Set(["stagingRoot", "maxEntries", "maxEntryBytes", "maxTotalBytes"]),
    "options"
  );
  const stagingRoot = validateStagingRoot(options.stagingRoot);
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
  const compressed = await collectArchiveSource(source, maximumTarBytes + 1024 * 1024);
  let tar;
  try {
    tar = zlib.gunzipSync(compressed, { maxOutputLength: maximumTarBytes });
  } catch (cause) {
    throw archiveError("Archive is not a valid or complete gzip stream.", "ARCHIVE_GZIP_INVALID", cause);
  }
  const parsed = parseTar(tar, limits);
  writeEntriesToStaging(stagingRoot, parsed.entries);
  return {
    format: "time-isle.tar.gz",
    entries: parsed.entries.map(({ path: entryPath, size, sha256, mtime }) => ({
      path: entryPath,
      size,
      sha256,
      mtime
    })),
    totalBytes: parsed.totalBytes
  };
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

function parseTar(tar, limits) {
  if (!Buffer.isBuffer(tar) || tar.length < TAR_BLOCK_BYTES * 2 || tar.length % TAR_BLOCK_BYTES !== 0) {
    throw archiveError("Tar stream is truncated or misaligned.", "ARCHIVE_TRUNCATED");
  }
  const entries = [];
  const seen = new Set();
  let totalBytes = 0;
  let offset = 0;
  let terminated = false;

  while (offset < tar.length) {
    const header = tar.subarray(offset, offset + TAR_BLOCK_BYTES);
    if (isZeroBlock(header)) {
      const secondEnd = offset + TAR_BLOCK_BYTES * 2;
      if (secondEnd > tar.length || !isZeroBlock(tar.subarray(offset + TAR_BLOCK_BYTES, secondEnd))) {
        throw archiveError("Tar stream has an incomplete end marker.", "ARCHIVE_TRUNCATED");
      }
      if (!isZeroBlock(tar.subarray(secondEnd))) {
        throw archiveError("Tar stream contains data after its end marker.", "ARCHIVE_TRAILING_DATA");
      }
      terminated = true;
      break;
    }

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

    if (entries.length + 1 > limits.maxEntries) {
      throw archiveError("Archive contains too many entries.", "ARCHIVE_TOO_MANY_ENTRIES");
    }
    if (size > limits.maxEntryBytes) {
      throw archiveError(`Archive entry exceeds its size limit: ${archivePath}`, "ARCHIVE_ENTRY_TOO_LARGE");
    }
    totalBytes = safeAdd(totalBytes, size, "ARCHIVE_TOTAL_TOO_LARGE");
    if (totalBytes > limits.maxTotalBytes) {
      throw archiveError("Archive exceeds its total extraction limit.", "ARCHIVE_TOTAL_TOO_LARGE");
    }

    const dataStart = offset + TAR_BLOCK_BYTES;
    const dataEnd = dataStart + size;
    const nextOffset = dataEnd + paddingFor(size);
    if (!Number.isSafeInteger(nextOffset) || dataEnd > tar.length || nextOffset > tar.length) {
      throw archiveError(`Tar entry is truncated: ${archivePath}`, "ARCHIVE_TRUNCATED");
    }
    if (!isZeroBlock(tar.subarray(dataEnd, nextOffset))) {
      throw archiveError(`Tar entry has non-zero padding: ${archivePath}`, "ARCHIVE_FORMAT_INVALID");
    }
    const data = tar.subarray(dataStart, dataEnd);
    entries.push({
      path: archivePath,
      size,
      mtime,
      sha256: crypto.createHash("sha256").update(data).digest("hex"),
      data
    });
    offset = nextOffset;
  }

  if (!terminated) throw archiveError("Tar stream has no complete end marker.", "ARCHIVE_TRUNCATED");
  return { entries, totalBytes };
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

function writeEntriesToStaging(stagingRoot, entries) {
  prepareStagingRoot(stagingRoot);
  const createdFiles = [];
  const createdDirectories = [];
  try {
    for (const entry of entries) {
      const targetPath = resolveStagingTarget(stagingRoot, entry.path);
      ensureSafeParentDirectories(stagingRoot, path.dirname(targetPath), createdDirectories);
      if (fs.existsSync(targetPath)) {
        throw archiveError(`Staging target already exists: ${entry.path}`, "ARCHIVE_TARGET_EXISTS");
      }
      const noFollow = fs.constants.O_NOFOLLOW || 0;
      let descriptor;
      try {
        descriptor = fs.openSync(
          targetPath,
          fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow,
          0o600
        );
        createdFiles.push(targetPath);
        fs.writeFileSync(descriptor, entry.data);
      } finally {
        if (descriptor !== undefined) fs.closeSync(descriptor);
      }
    }
  } catch (error) {
    for (const filePath of createdFiles.reverse()) {
      try { fs.rmSync(filePath, { force: true }); } catch { /* best-effort rollback */ }
    }
    for (const directoryPath of createdDirectories.reverse()) {
      try { fs.rmdirSync(directoryPath); } catch { /* preserve non-empty caller data */ }
    }
    throw error;
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

async function collectArchiveSource(source, maximumBytes) {
  if (Buffer.isBuffer(source)) {
    if (source.length > maximumBytes) throw archiveError("Compressed archive is too large.", "ARCHIVE_COMPRESSED_TOO_LARGE");
    return source;
  }
  if (source instanceof Uint8Array) {
    const buffer = Buffer.from(source.buffer, source.byteOffset, source.byteLength);
    if (buffer.length > maximumBytes) throw archiveError("Compressed archive is too large.", "ARCHIVE_COMPRESSED_TOO_LARGE");
    return buffer;
  }
  if (!source || typeof source[Symbol.asyncIterator] !== "function") {
    throw archiveError("Archive source must be a Buffer, Uint8Array, Readable, or async iterable.", "ARCHIVE_INPUT_INVALID");
  }
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of source) {
    if (!Buffer.isBuffer(chunk) && !(chunk instanceof Uint8Array)) {
      throw archiveError("Archive streams must emit binary chunks.", "ARCHIVE_INPUT_INVALID");
    }
    const buffer = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    totalBytes = safeAdd(totalBytes, buffer.length, "ARCHIVE_COMPRESSED_TOO_LARGE");
    if (totalBytes > maximumBytes) {
      throw archiveError("Compressed archive is too large.", "ARCHIVE_COMPRESSED_TOO_LARGE");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, totalBytes);
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

module.exports = { createArchive, extractArchive };
