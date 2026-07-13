"use strict";

const MAX_IFD_ENTRIES = 256;
const MAX_ASCII_BYTES = 128;
const TIFF_TYPE_SIZES = Object.freeze({
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  6: 1,
  7: 1,
  8: 2,
  9: 4,
  10: 8,
  11: 4,
  12: 8
});

/**
 * Read privacy-sensitive EXIF metadata as unconfirmed hints.
 *
 * The parser deliberately never throws for untrusted or malformed bytes. It
 * only reads JPEG APP1/Exif and never writes a memory field, calls a network
 * service, or reverse-geocodes GPS coordinates.
 *
 * @param {Buffer|Uint8Array} input
 * @returns {{hasExif: boolean, source: string, orientation: number|null,
 *   capturedAt: object|null, dateTimeOriginal: object|null, offsetTimeOriginal: string|null,
 *   gps: object|null, hints: object[]}}
 */
function extractExifHints(input) {
  const buffer = safeBuffer(input);
  if (!buffer || buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return emptyResult(false);
  }

  try {
    let offset = 2;
    let sawValidExif = false;

    while (offset < buffer.length) {
      if (buffer[offset] !== 0xff) break;
      while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
      if (offset >= buffer.length) break;

      const marker = buffer[offset];
      offset += 1;
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x00 || marker === 0xd8) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (buffer.length - offset < 2) break;

      const segmentLength = buffer.readUInt16BE(offset);
      if (segmentLength < 2 || segmentLength > buffer.length - offset) break;
      const payloadStart = offset + 2;
      const payloadEnd = offset + segmentLength;

      if (marker === 0xe1) {
        const parsed = parseExifApp1(buffer, payloadStart, payloadEnd);
        if (parsed) {
          sawValidExif = true;
          if (hasRecognizedValue(parsed)) return buildResult(parsed);
        }
      }
      offset = payloadEnd;
    }

    return emptyResult(sawValidExif);
  } catch {
    return emptyResult(false);
  }
}

/**
 * Compare the EXIF local calendar date with a memory's partial ISO date.
 * A year/month memory date is compatible with a day-level EXIF date when the
 * shared components match. Missing or invalid values are always unknown, not
 * a conflict. EXIF remains a suggestion even when literal values differ.
 *
 * @param {object|null} exif Result from extractExifHints().
 * @param {string|{date?: string}|null} memoryDate YYYY, YYYY-MM or YYYY-MM-DD.
 */
function compareExifDateToMemoryDate(exif, memoryDate) {
  const exifDate = normalizeCalendarDate(exif?.capturedAt?.date || exif?.dateTimeOriginal?.date, 3);
  const suppliedMemoryDate = memoryDate && typeof memoryDate === "object"
    ? memoryDate.date
    : memoryDate;
  const memory = normalizeCalendarDate(suppliedMemoryDate);

  if (!exifDate || !memory) {
    return freezeDeep({
      status: "unknown",
      relation: "missing",
      conflict: false,
      requiresReview: false,
      exifDate: exifDate?.value || null,
      memoryDate: memory?.value || null,
      comparedPrecision: null,
      source: "exif",
      guidance: "缺失或无效的日期不会被判为冲突。"
    });
  }

  const precision = Math.min(exifDate.precision, memory.precision);
  const matches = exifDate.parts.slice(0, precision)
    .every((part, index) => part === memory.parts[index]);
  const precisionName = [null, "year", "month", "day"][precision];

  if (matches) {
    return freezeDeep({
      status: "compatible",
      relation: precision === 3 ? "same-day" : precision === 2 ? "same-month" : "same-year",
      conflict: false,
      requiresReview: false,
      exifDate: exifDate.value,
      memoryDate: memory.value,
      comparedPrecision: precisionName,
      source: "exif",
      guidance: "EXIF 只是一条待确认线索，不会自动改写记忆时间。"
    });
  }

  return freezeDeep({
    status: "review",
    relation: "different",
    conflict: true,
    requiresReview: true,
    exifDate: exifDate.value,
    memoryDate: memory.value,
    comparedPrecision: precisionName,
    source: "exif",
    guidance: "日期字面值不同，请由用户核对；EXIF 不会自动覆盖记忆时间。"
  });
}

function parseExifApp1(buffer, payloadStart, payloadEnd) {
  if (payloadEnd - payloadStart < 14) return null;
  if (buffer.toString("ascii", payloadStart, payloadStart + 6) !== "Exif\0\0") return null;

  const reader = createTiffReader(buffer, payloadStart + 6, payloadEnd);
  if (!reader || reader.readU16(2) !== 42) return null;
  const ifd0Offset = reader.readU32(4);
  const ifd0 = parseIfd(reader, ifd0Offset);
  if (!ifd0) return null;

  const orientation = readFirst(ifd0, 0x0112, (entry) => {
    const value = readUnsignedScalar(reader, entry, 3);
    return value >= 1 && value <= 8 ? value : null;
  });
  const exifIfdOffset = readFirst(ifd0, 0x8769, (entry) => readUnsignedScalar(reader, entry, 4));
  const gpsIfdOffset = readFirst(ifd0, 0x8825, (entry) => readUnsignedScalar(reader, entry, 4));
  const exifIfd = exifIfdOffset === null ? [] : (parseIfd(reader, exifIfdOffset) || []);
  const gpsIfd = gpsIfdOffset === null ? [] : (parseIfd(reader, gpsIfdOffset) || []);

  const rawDate = readFirst(exifIfd, 0x9003, (entry) => readAscii(reader, entry));
  const rawOffset = readFirst(exifIfd, 0x9011, (entry) => readAscii(reader, entry));
  const parsedDate = parseExifDateTime(rawDate);
  const parsedOffset = parseExifOffset(rawOffset);
  const dateTimeOriginal = parsedDate
    ? buildDateTimeHint(parsedDate, parsedOffset)
    : null;
  const gps = parseGpsHint(reader, gpsIfd);

  return {
    orientation,
    dateTimeOriginal,
    offsetTimeOriginal: parsedOffset,
    gps
  };
}

function createTiffReader(buffer, start, end) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end > buffer.length || end - start < 8) {
    return null;
  }
  const byteOrder = buffer.toString("ascii", start, start + 2);
  if (byteOrder !== "II" && byteOrder !== "MM") return null;
  const littleEndian = byteOrder === "II";
  const length = end - start;

  function within(relativeOffset, byteLength) {
    return Number.isSafeInteger(relativeOffset)
      && Number.isSafeInteger(byteLength)
      && relativeOffset >= 0
      && byteLength >= 0
      && relativeOffset <= length
      && byteLength <= length - relativeOffset;
  }

  return {
    length,
    within,
    bytes(relativeOffset, byteLength) {
      return within(relativeOffset, byteLength)
        ? buffer.subarray(start + relativeOffset, start + relativeOffset + byteLength)
        : null;
    },
    readU16(relativeOffset) {
      if (!within(relativeOffset, 2)) return null;
      return littleEndian
        ? buffer.readUInt16LE(start + relativeOffset)
        : buffer.readUInt16BE(start + relativeOffset);
    },
    readU32(relativeOffset) {
      if (!within(relativeOffset, 4)) return null;
      return littleEndian
        ? buffer.readUInt32LE(start + relativeOffset)
        : buffer.readUInt32BE(start + relativeOffset);
    }
  };
}

function parseIfd(reader, relativeOffset) {
  if (!reader || !reader.within(relativeOffset, 2)) return null;
  const count = reader.readU16(relativeOffset);
  if (count === null || count > MAX_IFD_ENTRIES) return null;
  const entriesStart = relativeOffset + 2;
  const directoryBytes = count * 12;
  if (!reader.within(entriesStart, directoryBytes + 4)) return null;

  const entries = [];
  for (let index = 0; index < count; index += 1) {
    const offset = entriesStart + (index * 12);
    const tag = reader.readU16(offset);
    const type = reader.readU16(offset + 2);
    const valueCount = reader.readU32(offset + 4);
    if (tag === null || type === null || valueCount === null) continue;
    entries.push({ tag, type, count: valueCount, offset });
  }
  return entries;
}

function entryData(reader, entry) {
  const unitSize = TIFF_TYPE_SIZES[entry.type];
  if (!unitSize || !Number.isSafeInteger(entry.count) || entry.count < 1) return null;
  const byteLength = unitSize * entry.count;
  if (!Number.isSafeInteger(byteLength) || byteLength > reader.length) return null;
  const relativeOffset = byteLength <= 4
    ? entry.offset + 8
    : reader.readU32(entry.offset + 8);
  if (relativeOffset === null || !reader.within(relativeOffset, byteLength)) return null;
  return { relativeOffset, byteLength };
}

function readUnsignedScalar(reader, entry, expectedType) {
  if (entry.type !== expectedType || entry.count !== 1) return null;
  const data = entryData(reader, entry);
  if (!data) return null;
  if (expectedType === 3) return reader.readU16(data.relativeOffset);
  if (expectedType === 4) return reader.readU32(data.relativeOffset);
  return null;
}

function readAscii(reader, entry, exactCount = null) {
  if (entry.type !== 2 || entry.count < 1 || entry.count > MAX_ASCII_BYTES) return null;
  if (exactCount !== null && entry.count !== exactCount) return null;
  const data = entryData(reader, entry);
  if (!data) return null;
  const bytes = reader.bytes(data.relativeOffset, data.byteLength);
  if (!bytes) return null;
  for (const byte of bytes) {
    if (byte !== 0 && (byte < 0x20 || byte > 0x7e)) return null;
  }
  const value = bytes.toString("ascii").replace(/\0+$/u, "");
  if (value.includes("\0")) return null;
  return value.trim();
}

function readRationalTriplet(reader, entry) {
  if (entry.type !== 5 || entry.count !== 3) return null;
  const data = entryData(reader, entry);
  if (!data) return null;
  const values = [];
  for (let index = 0; index < 3; index += 1) {
    const numerator = reader.readU32(data.relativeOffset + (index * 8));
    const denominator = reader.readU32(data.relativeOffset + (index * 8) + 4);
    if (numerator === null || denominator === null || denominator === 0) return null;
    values.push(numerator / denominator);
  }
  return values.every(Number.isFinite) ? values : null;
}

function readFirst(entries, tag, parser) {
  for (const entry of entries) {
    if (entry.tag !== tag) continue;
    const value = parser(entry);
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return null;
}

function parseExifDateTime(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/u.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  if (!validCalendarDay(year, month, day) || hour > 23 || minute > 59 || second > 59) return null;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  return {
    raw: value,
    date,
    localDateTime: `${date}T${match[4]}:${match[5]}:${match[6]}`
  };
}

function parseExifOffset(value) {
  if (typeof value !== "string") return null;
  const match = /^([+-])(\d{2}):(\d{2})$/u.exec(value);
  if (!match) return null;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) return null;
  return `${match[1]}${match[2]}:${match[3]}`;
}

function buildDateTimeHint(parsedDate, offset) {
  return freezeDeep({
    raw: parsedDate.raw,
    localDateTime: parsedDate.localDateTime,
    date: parsedDate.date,
    precision: "second",
    timezone: offset
      ? { kind: "offset", value: offset }
      : { kind: "local-floating", value: null },
    status: "suggested",
    source: "exif"
  });
}

function parseGpsHint(reader, gpsIfd) {
  const latitudeRef = readFirst(gpsIfd, 0x0001, (entry) => readAscii(reader, entry, 2));
  const latitudeValues = readFirst(gpsIfd, 0x0002, (entry) => readRationalTriplet(reader, entry));
  const longitudeRef = readFirst(gpsIfd, 0x0003, (entry) => readAscii(reader, entry, 2));
  const longitudeValues = readFirst(gpsIfd, 0x0004, (entry) => readRationalTriplet(reader, entry));
  if (latitudeRef !== "N" && latitudeRef !== "S") return null;
  if (longitudeRef !== "E" && longitudeRef !== "W") return null;
  if (!validDms(latitudeValues, 90) || !validDms(longitudeValues, 180)) return null;

  let latitude = dmsToDecimal(latitudeValues);
  let longitude = dmsToDecimal(longitudeValues);
  if (latitudeRef === "S") latitude *= -1;
  if (longitudeRef === "W") longitude *= -1;
  latitude = roundCoordinate(latitude);
  longitude = roundCoordinate(longitude);

  return freezeDeep({
    latitude,
    longitude,
    status: "suggested",
    sensitive: true,
    source: "exif",
    reverseGeocoded: false
  });
}

function validDms(values, maximumDegrees) {
  if (!Array.isArray(values) || values.length !== 3) return false;
  const [degrees, minutes, seconds] = values;
  return values.every(Number.isFinite)
    && degrees >= 0
    && degrees <= maximumDegrees
    && minutes >= 0
    && minutes < 60
    && seconds >= 0
    && seconds < 60
    && (degrees < maximumDegrees || (minutes === 0 && seconds === 0));
}

function dmsToDecimal(values) {
  return values[0] + (values[1] / 60) + (values[2] / 3600);
}

function roundCoordinate(value) {
  const rounded = Math.round(value * 10_000_000) / 10_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function validCalendarDay(year, month, day) {
  if (!Number.isInteger(year) || year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) return false;
  const monthLengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= monthLengths[month - 1];
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function normalizeCalendarDate(value, requiredPrecision = null) {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/u.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = match[2] ? Number(match[2]) : null;
  const day = match[3] ? Number(match[3]) : null;
  const precision = day !== null ? 3 : month !== null ? 2 : 1;
  if (requiredPrecision !== null && precision !== requiredPrecision) return null;
  if (year < 1 || year > 9999) return null;
  if (month !== null && (month < 1 || month > 12)) return null;
  if (day !== null && !validCalendarDay(year, month, day)) return null;
  return {
    value: match[0],
    precision,
    parts: [year, month, day].slice(0, precision)
  };
}

function hasRecognizedValue(parsed) {
  return parsed.orientation !== null
    || parsed.dateTimeOriginal !== null
    || parsed.offsetTimeOriginal !== null
    || parsed.gps !== null;
}

function buildResult(parsed) {
  const hints = [];
  if (parsed.dateTimeOriginal) {
    hints.push({
      kind: "captured_at",
      status: "suggested",
      sensitive: false,
      source: "exif",
      value: {
        localDateTime: parsed.dateTimeOriginal.localDateTime,
        date: parsed.dateTimeOriginal.date,
        timezone: parsed.dateTimeOriginal.timezone
      }
    });
  }
  if (parsed.gps) {
    hints.push({
      kind: "gps_coordinates",
      status: "suggested",
      sensitive: true,
      source: "exif",
      value: {
        latitude: parsed.gps.latitude,
        longitude: parsed.gps.longitude
      }
    });
  }
  return freezeDeep({
    hasExif: true,
    source: "jpeg-app1-exif",
    orientation: parsed.orientation,
    capturedAt: parsed.dateTimeOriginal,
    dateTimeOriginal: parsed.dateTimeOriginal,
    offsetTimeOriginal: parsed.offsetTimeOriginal,
    gps: parsed.gps,
    hints
  });
}

function emptyResult(hasExif) {
  return freezeDeep({
    hasExif: Boolean(hasExif),
    source: "jpeg-app1-exif",
    orientation: null,
    capturedAt: null,
    dateTimeOriginal: null,
    offsetTimeOriginal: null,
    gps: null,
    hints: []
  });
}

function safeBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) {
    return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  }
  return null;
}

function freezeDeep(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) freezeDeep(item);
  return Object.freeze(value);
}

module.exports = {
  extractExifHints,
  compareExifDateToMemoryDate
};
