"use strict";

const assert = require("node:assert/strict");
const {
  extractExifHints,
  compareExifDateToMemoryDate
} = require("../lib/exif-hints");

let assertions = 0;

function equal(actual, expected, message) {
  assert.equal(actual, expected, message);
  assertions += 1;
}

function check(value, message) {
  assert.ok(value, message);
  assertions += 1;
}

function noThrow(action, message) {
  assert.doesNotThrow(action, message);
  assertions += 1;
}

const little = extractExifHints(createExifJpeg({
  littleEndian: true,
  orientation: 6,
  date: "2024:02:29 13:45:06",
  offset: "+08:00",
  latitudeRef: "N",
  latitude: [[30, 1], [15, 1], [30, 1]],
  longitudeRef: "E",
  longitude: [[120, 1], [30, 1], [0, 1]],
  app0Padding: 11
}));
equal(little.hasExif, true, "应识别带 APP0 偏移的 little-endian Exif");
equal(little.orientation, 6, "应读取 little-endian Orientation");
equal(little.capturedAt.localDateTime, "2024-02-29T13:45:06", "capturedAt 应公开拍摄时间线索");
equal(little.dateTimeOriginal.localDateTime, "2024-02-29T13:45:06", "应读取 DateTimeOriginal");
equal(little.dateTimeOriginal.timezone.kind, "offset", "有 OffsetTimeOriginal 时应标记明确偏移");
equal(little.dateTimeOriginal.timezone.value, "+08:00", "必须保留原始 UTC 偏移而非换算时间");
equal(little.offsetTimeOriginal, "+08:00", "应单独公开合法 OffsetTimeOriginal");
equal(little.gps.latitude, 30.2583333, "应换算北纬 DMS");
equal(little.gps.longitude, 120.5, "应换算东经 DMS");
equal(little.gps.status, "suggested", "GPS 只能作为 suggested 线索");
equal(little.gps.sensitive, true, "GPS 必须标记为敏感信息");
equal(little.gps.reverseGeocoded, false, "模块不得逆地理编码");
check(little.hints.every((hint) => hint.status === "suggested"), "所有 EXIF 线索都必须保持 suggested");

const bigFloating = extractExifHints(createExifJpeg({
  littleEndian: false,
  orientation: 3,
  date: "1998:12:05 01:02:03",
  offset: null,
  latitudeRef: "S",
  latitude: [[33, 1], [30, 1], [0, 1]],
  longitudeRef: "W",
  longitude: [[70, 1], [15, 1], [30, 1]]
}));
equal(bigFloating.orientation, 3, "应读取 big-endian Orientation");
equal(bigFloating.dateTimeOriginal.timezone.kind, "local-floating", "无时区日期必须是 local-floating");
equal(bigFloating.dateTimeOriginal.timezone.value, null, "不得为无时区日期补充偏移");
check(!bigFloating.dateTimeOriginal.localDateTime.endsWith("Z"), "不得为无时区 EXIF 日期自动追加 Z");
equal(bigFloating.gps.latitude, -33.5, "南纬应为负数");
equal(bigFloating.gps.longitude, -70.2583333, "西经应为负数");

const monthCompatible = compareExifDateToMemoryDate(little, "2024-02");
equal(monthCompatible.status, "compatible", "同月的月级记忆与日级 EXIF 应兼容");
equal(monthCompatible.relation, "same-month", "应说明兼容精度为月份");
equal(monthCompatible.conflict, false, "月级信息较少不能造成冲突");

const dayCompatible = compareExifDateToMemoryDate(little, "2024-02-29");
equal(dayCompatible.relation, "same-day", "相同日期应按日兼容");
const differentDay = compareExifDateToMemoryDate(little, "2024-02-28");
equal(differentDay.status, "review", "明确不同的日期只应提示核对");
equal(differentDay.requiresReview, true, "明确不同的日期需要用户核对");
check(differentDay.guidance.includes("不会自动覆盖"), "日期差异不得自动改写展品时间");

const missingMemory = compareExifDateToMemoryDate(little, "");
equal(missingMemory.status, "unknown", "缺失的记忆日期应保持 unknown");
equal(missingMemory.conflict, false, "缺失日期不能判冲突");
const missingExif = compareExifDateToMemoryDate(extractExifHints(Buffer.from("not jpeg")), "2024-02-29");
equal(missingExif.status, "unknown", "缺失 EXIF 日期应保持 unknown");
equal(missingExif.conflict, false, "缺失 EXIF 日期不能判冲突");
equal(compareExifDateToMemoryDate(little, "2023-02-29").status, "unknown", "非法记忆日期应安全降级");

const invalidInputs = [
  null,
  {},
  Buffer.alloc(0),
  Buffer.from([0xff, 0xd8, 0xff]),
  Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0xff]),
  Buffer.concat([Buffer.from([0xff, 0xd8]), jpegSegment(0xe1, Buffer.from("Exif\0\0BAD")), Buffer.from([0xff, 0xd9])])
];
for (const input of invalidInputs) {
  noThrow(() => extractExifHints(input), "非法输入不得抛出上传级错误");
  equal(extractExifHints(input).hints.length, 0, "非法输入不得产生 EXIF 线索");
}

const outOfBoundsDate = createExifJpeg({
  littleEndian: true,
  orientation: 8,
  date: "2020:01:02 03:04:05",
  offset: "+01:00",
  latitudeRef: "N",
  latitude: [[1, 1], [2, 1], [3, 1]],
  longitudeRef: "E",
  longitude: [[4, 1], [5, 1], [6, 1]],
  corruptDatePointer: true
});
const bounded = extractExifHints(outOfBoundsDate);
equal(bounded.orientation, 8, "单一越界标签不应丢失其他合法字段");
equal(bounded.dateTimeOriginal, null, "越界 DateTimeOriginal 应被忽略");
equal(bounded.offsetTimeOriginal, "+01:00", "越界日期不应影响独立且合法的偏移字段");
equal(bounded.gps.status, "suggested", "越界日期不应影响合法 GPS 线索");

const zeroDenominator = createExifJpeg({
  littleEndian: false,
  orientation: 1,
  date: "2022:07:08 09:10:11",
  offset: null,
  latitudeRef: "N",
  latitude: [[10, 1], [20, 0], [30, 1]],
  longitudeRef: "E",
  longitude: [[40, 1], [50, 1], [0, 1]]
});
noThrow(() => extractExifHints(zeroDenominator), "零分母 GPS 不得抛错");
equal(extractExifHints(zeroDenominator).gps, null, "零分母 GPS 应整体忽略");

const hugeIfd = createExifJpeg({ littleEndian: true, orientation: 1 });
const app1PayloadStart = findExifPayloadStart(hugeIfd);
hugeIfd.writeUInt16LE(0xffff, app1PayloadStart + 6 + 8);
noThrow(() => extractExifHints(hugeIfd), "异常 IFD 数量不得触发越界或分配攻击");
equal(extractExifHints(hugeIfd).hints.length, 0, "异常 IFD 应安全降级为空线索");

check(Object.isFrozen(little) && Object.isFrozen(little.gps) && Object.isFrozen(little.hints), "解析结果应是不可变快照");
console.log(`EXIF hint checks passed: ${assertions} assertions.`);

function createExifJpeg(options = {}) {
  const littleEndian = options.littleEndian !== false;
  const includeExifIfd = Boolean(options.date || options.offset);
  const includeGpsIfd = Boolean(options.latitude && options.longitude && options.latitudeRef && options.longitudeRef);
  const ifd0Entries = 1 + (includeExifIfd ? 1 : 0) + (includeGpsIfd ? 1 : 0);
  const ifd0Offset = 8;
  const ifd0Size = 2 + (ifd0Entries * 12) + 4;
  const exifIfdOffset = ifd0Offset + ifd0Size;
  const exifEntryCount = includeExifIfd ? (options.date ? 1 : 0) + (options.offset ? 1 : 0) : 0;
  const exifIfdSize = includeExifIfd ? 2 + (exifEntryCount * 12) + 4 : 0;
  const gpsIfdOffset = exifIfdOffset + exifIfdSize;
  const gpsIfdSize = includeGpsIfd ? 2 + (4 * 12) + 4 : 0;
  let dataOffset = gpsIfdOffset + gpsIfdSize + 9;

  const dateBytes = options.date ? Buffer.from(`${options.date}\0`, "ascii") : null;
  const offsetBytes = options.offset ? Buffer.from(`${options.offset}\0`, "ascii") : null;
  const dateOffset = dateBytes ? dataOffset : null;
  if (dateBytes) dataOffset += dateBytes.length;
  const timezoneOffset = offsetBytes ? dataOffset : null;
  if (offsetBytes) dataOffset += offsetBytes.length;
  const latitudeOffset = includeGpsIfd ? dataOffset : null;
  if (includeGpsIfd) dataOffset += 24;
  const longitudeOffset = includeGpsIfd ? dataOffset : null;
  if (includeGpsIfd) dataOffset += 24;

  const tiff = Buffer.alloc(dataOffset);
  tiff.write(littleEndian ? "II" : "MM", 0, 2, "ascii");
  writeU16(tiff, 42, 2, littleEndian);
  writeU32(tiff, ifd0Offset, 4, littleEndian);
  writeU16(tiff, ifd0Entries, ifd0Offset, littleEndian);
  let entryOffset = ifd0Offset + 2;
  writeEntry(tiff, entryOffset, 0x0112, 3, 1, options.orientation || 1, littleEndian, true);
  entryOffset += 12;
  if (includeExifIfd) {
    writeEntry(tiff, entryOffset, 0x8769, 4, 1, exifIfdOffset, littleEndian);
    entryOffset += 12;
  }
  if (includeGpsIfd) writeEntry(tiff, entryOffset, 0x8825, 4, 1, gpsIfdOffset, littleEndian);

  if (includeExifIfd) {
    writeU16(tiff, exifEntryCount, exifIfdOffset, littleEndian);
    let exifEntryOffset = exifIfdOffset + 2;
    if (dateBytes) {
      const pointer = options.corruptDatePointer ? tiff.length + 4096 : dateOffset;
      writeEntry(tiff, exifEntryOffset, 0x9003, 2, dateBytes.length, pointer, littleEndian);
      exifEntryOffset += 12;
      dateBytes.copy(tiff, dateOffset);
    }
    if (offsetBytes) {
      writeEntry(tiff, exifEntryOffset, 0x9011, 2, offsetBytes.length, timezoneOffset, littleEndian);
      offsetBytes.copy(tiff, timezoneOffset);
    }
  }

  if (includeGpsIfd) {
    writeU16(tiff, 4, gpsIfdOffset, littleEndian);
    let gpsEntryOffset = gpsIfdOffset + 2;
    writeAsciiInlineEntry(tiff, gpsEntryOffset, 0x0001, options.latitudeRef, littleEndian);
    gpsEntryOffset += 12;
    writeEntry(tiff, gpsEntryOffset, 0x0002, 5, 3, latitudeOffset, littleEndian);
    gpsEntryOffset += 12;
    writeAsciiInlineEntry(tiff, gpsEntryOffset, 0x0003, options.longitudeRef, littleEndian);
    gpsEntryOffset += 12;
    writeEntry(tiff, gpsEntryOffset, 0x0004, 5, 3, longitudeOffset, littleEndian);
    writeRationals(tiff, latitudeOffset, options.latitude, littleEndian);
    writeRationals(tiff, longitudeOffset, options.longitude, littleEndian);
  }

  const exifPayload = Buffer.concat([Buffer.from("Exif\0\0", "binary"), tiff]);
  const segments = [Buffer.from([0xff, 0xd8])];
  if (options.app0Padding) segments.push(jpegSegment(0xe0, Buffer.alloc(options.app0Padding, 0x41)));
  segments.push(jpegSegment(0xe1, exifPayload), Buffer.from([0xff, 0xd9]));
  return Buffer.concat(segments);
}

function writeEntry(buffer, offset, tag, type, count, value, littleEndian, shortInline = false) {
  writeU16(buffer, tag, offset, littleEndian);
  writeU16(buffer, type, offset + 2, littleEndian);
  writeU32(buffer, count, offset + 4, littleEndian);
  if (shortInline) writeU16(buffer, value, offset + 8, littleEndian);
  else writeU32(buffer, value, offset + 8, littleEndian);
}

function writeAsciiInlineEntry(buffer, offset, tag, value, littleEndian) {
  writeU16(buffer, tag, offset, littleEndian);
  writeU16(buffer, 2, offset + 2, littleEndian);
  writeU32(buffer, 2, offset + 4, littleEndian);
  buffer.write(`${value}\0`, offset + 8, 2, "ascii");
}

function writeRationals(buffer, offset, rationals, littleEndian) {
  rationals.forEach(([numerator, denominator], index) => {
    writeU32(buffer, numerator, offset + (index * 8), littleEndian);
    writeU32(buffer, denominator, offset + (index * 8) + 4, littleEndian);
  });
}

function writeU16(buffer, value, offset, littleEndian) {
  if (littleEndian) buffer.writeUInt16LE(value, offset);
  else buffer.writeUInt16BE(value, offset);
}

function writeU32(buffer, value, offset, littleEndian) {
  if (littleEndian) buffer.writeUInt32LE(value >>> 0, offset);
  else buffer.writeUInt32BE(value >>> 0, offset);
}

function jpegSegment(marker, payload) {
  const segment = Buffer.alloc(payload.length + 4);
  segment[0] = 0xff;
  segment[1] = marker;
  segment.writeUInt16BE(payload.length + 2, 2);
  payload.copy(segment, 4);
  return segment;
}

function findExifPayloadStart(jpeg) {
  const signature = Buffer.from("Exif\0\0", "binary");
  return jpeg.indexOf(signature);
}
