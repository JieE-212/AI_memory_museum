"use strict";

const {
  MAX_VOICE_BYTES,
  MAX_VOICE_DURATION_MS,
  VOICE_FORMATS
} = require("./voice-policy");

const EBML_IDS = Object.freeze({
  EBML: 0x1a45dfa3,
  DOC_TYPE: 0x4282,
  SEGMENT: 0x18538067,
  INFO: 0x1549a966,
  TIMECODE_SCALE: 0x2ad7b1,
  DURATION: 0x4489,
  TRACKS: 0x1654ae6b,
  TRACK_ENTRY: 0xae,
  TRACK_NUMBER: 0xd7,
  TRACK_TYPE: 0x83,
  CODEC_ID: 0x86,
  CODEC_PRIVATE: 0x63a2,
  AUDIO: 0xe1,
  SAMPLING_FREQUENCY: 0xb5,
  CHANNELS: 0x9f,
  CLUSTER: 0x1f43b675,
  TIMESTAMP: 0xe7,
  SIMPLE_BLOCK: 0xa3,
  BLOCK_GROUP: 0xa0,
  BLOCK: 0xa1,
  BLOCK_DURATION: 0x9b,
  VOID: 0xec
});

const AAC_OBJECT_TYPES = new Set([1, 2, 3, 4, 5, 6, 7, 17, 19, 20, 21, 22, 23, 29, 39, 42]);
const MP4_BRANDS = new Set(["M4A ", "M4B ", "isom", "iso2", "mp41", "mp42", "dash", "MSNV"]);
const MAX_PARSED_ELEMENTS = 100_000;

/**
 * Structurally inspects an untrusted voice recording from its bytes. This does
 * not trust the extension or declared MIME type, and it deliberately supports
 * only the two V6.1 recording profiles: WebM/Opus and MP4/AAC.
 *
 * @param {Buffer|Uint8Array} input
 * @param {{declaredMimeType?: string, maxBytes?: number, maxDurationMs?: number}} [options]
 * @returns {{mimeType:string,extension:string,container:string,codec:string,durationMs:number,byteSize:number,audioTracks:number}}
 */
function inspectVoice(input, options = {}) {
  const buffer = toBuffer(input);
  const maxBytes = boundedPositiveInteger(options.maxBytes, MAX_VOICE_BYTES);
  const maxDurationMs = boundedPositiveInteger(options.maxDurationMs, MAX_VOICE_DURATION_MS);

  if (buffer.length === 0) fail(400, "声音文件不能为空。", "VOICE_EMPTY");
  if (buffer.length > maxBytes) fail(413, "声音文件超过 12 MiB 限制。", "VOICE_TOO_LARGE");

  const detected = detectVoiceMimeType(buffer);
  if (!detected) fail(415, "仅支持 WebM/Opus 或 MP4/AAC 声音。", "VOICE_UNSUPPORTED_TYPE");
  assertDeclaredMime(options.declaredMimeType, detected);

  const parsed = detected === "audio/webm" ? parseWebmOpus(buffer) : parseMp4Aac(buffer);
  if (!Number.isFinite(parsed.durationMs) || parsed.durationMs <= 0) {
    fail(400, "声音时长必须大于 0。", "VOICE_DURATION_INVALID");
  }
  if (parsed.durationMs > maxDurationMs) {
    fail(413, "单段声音最长为 3 分钟。", "VOICE_DURATION_EXCEEDED");
  }

  const profile = VOICE_FORMATS[detected];
  return Object.freeze({
    mimeType: detected,
    extension: profile.extension,
    container: profile.container,
    codec: profile.codec,
    durationMs: Math.max(1, Math.ceil(parsed.durationMs)),
    byteSize: buffer.length,
    audioTracks: parsed.audioTracks
  });
}

function detectVoiceMimeType(buffer) {
  if (buffer.length >= 4 && buffer.readUInt32BE(0) === EBML_IDS.EBML) return "audio/webm";
  if (buffer.length >= 12 && buffer.toString("ascii", 4, 8) === "ftyp") return "audio/mp4";
  return "";
}

function parseWebmOpus(buffer) {
  let offset = 0;
  const header = readEbmlElement(buffer, offset, buffer.length, false);
  if (header.id !== EBML_IDS.EBML) invalid("WebM 缺少 EBML 文件头。", "VOICE_WEBM_INVALID");
  let docType = "";
  walkEbml(buffer, header.dataStart, header.dataEnd, (element) => {
    if (element.id === EBML_IDS.DOC_TYPE) docType = readUtf8(buffer, element);
  });
  if (docType.toLowerCase() !== "webm") invalid("EBML 容器不是 WebM。", "VOICE_WEBM_INVALID");
  offset = header.dataEnd;

  let segment = null;
  while (offset < buffer.length) {
    const element = readEbmlElement(buffer, offset, buffer.length, true);
    if (element.id === EBML_IDS.SEGMENT) {
      if (segment) invalid("WebM 包含多个 Segment。", "VOICE_WEBM_INVALID");
      segment = element;
    } else if (element.id !== EBML_IDS.VOID) {
      invalid("WebM Segment 之外存在未知数据。", "VOICE_WEBM_INVALID");
    }
    offset = element.dataEnd;
  }
  if (!segment) truncated("WebM 缺少 Segment。", "VOICE_WEBM_TRUNCATED");

  let timecodeScale = 1_000_000;
  let declaredDurationUnits = 0;
  const tracks = [];
  const clusters = [];
  walkEbml(buffer, segment.dataStart, segment.dataEnd, (element) => {
    if (element.id === EBML_IDS.INFO) {
      walkEbml(buffer, element.dataStart, element.dataEnd, (child) => {
        if (child.id === EBML_IDS.TIMECODE_SCALE) {
          timecodeScale = readEbmlUnsigned(buffer, child, "TimecodeScale");
          if (!Number.isSafeInteger(timecodeScale) || timecodeScale <= 0 || timecodeScale > 1_000_000_000) {
            invalid("WebM TimecodeScale 无效。", "VOICE_WEBM_INVALID");
          }
        } else if (child.id === EBML_IDS.DURATION) {
          const units = readEbmlFloat(buffer, child, "Duration");
          if (!Number.isFinite(units) || units < 0) invalid("WebM Duration 无效。", "VOICE_DURATION_INVALID");
          declaredDurationUnits = Math.max(declaredDurationUnits, units);
        }
      });
    } else if (element.id === EBML_IDS.TRACKS) {
      walkEbml(buffer, element.dataStart, element.dataEnd, (child) => {
        if (child.id === EBML_IDS.TRACK_ENTRY) tracks.push(parseWebmTrack(buffer, child));
      });
    } else if (element.id === EBML_IDS.CLUSTER) {
      clusters.push(element);
    }
  });

  if (!tracks.length) invalid("WebM 缺少轨道信息。", "VOICE_WEBM_INVALID");
  if (new Set(tracks.map((track) => track.number)).size !== tracks.length) {
    invalid("WebM 轨道编号重复。", "VOICE_WEBM_INVALID");
  }
  if (tracks.some((track) => track.type === 1)) {
    fail(415, "声音文件不能包含视频轨。", "VOICE_VIDEO_TRACK_FORBIDDEN");
  }
  const audioTracks = tracks.filter((track) => track.type === 2);
  if (audioTracks.length !== 1) {
    fail(415, "声音文件必须且只能包含一条音频轨。", "VOICE_AUDIO_TRACK_INVALID");
  }
  const audioTrack = audioTracks[0];
  if (audioTrack.codecId !== "A_OPUS") {
    fail(415, "WebM 音频轨必须使用 Opus。", "VOICE_CODEC_UNSUPPORTED");
  }
  validateOpusHead(audioTrack.codecPrivate, audioTrack);

  let observedEndMs = 0;
  let observedBlocks = 0;
  for (const cluster of clusters) {
    const result = parseWebmCluster(buffer, cluster, audioTrack.number, timecodeScale);
    observedEndMs = Math.max(observedEndMs, result.endMs);
    observedBlocks += result.blocks;
  }
  if (!observedBlocks) invalid("WebM 音频轨没有声音数据。", "VOICE_AUDIO_DATA_MISSING");
  const declaredDurationMs = declaredDurationUnits * timecodeScale / 1_000_000;
  return {
    durationMs: Math.max(declaredDurationMs, observedEndMs),
    audioTracks: audioTracks.length
  };
}

function parseWebmTrack(buffer, entry) {
  const track = { number: 0, type: 0, codecId: "", codecPrivate: null, channels: 0, sampleRate: 0 };
  walkEbml(buffer, entry.dataStart, entry.dataEnd, (child) => {
    if (child.id === EBML_IDS.TRACK_NUMBER) track.number = readEbmlUnsigned(buffer, child, "TrackNumber");
    else if (child.id === EBML_IDS.TRACK_TYPE) track.type = readEbmlUnsigned(buffer, child, "TrackType");
    else if (child.id === EBML_IDS.CODEC_ID) track.codecId = readAscii(buffer, child);
    else if (child.id === EBML_IDS.CODEC_PRIVATE) track.codecPrivate = buffer.subarray(child.dataStart, child.dataEnd);
    else if (child.id === EBML_IDS.AUDIO) {
      walkEbml(buffer, child.dataStart, child.dataEnd, (audioChild) => {
        if (audioChild.id === EBML_IDS.CHANNELS) track.channels = readEbmlUnsigned(buffer, audioChild, "Channels");
        else if (audioChild.id === EBML_IDS.SAMPLING_FREQUENCY) {
          track.sampleRate = readEbmlFloat(buffer, audioChild, "SamplingFrequency");
        }
      });
    }
  });
  if (!Number.isSafeInteger(track.number) || track.number <= 0 || !Number.isSafeInteger(track.type) || track.type <= 0) {
    invalid("WebM 轨道编号或类型无效。", "VOICE_WEBM_INVALID");
  }
  return track;
}

function validateOpusHead(privateBytes, track) {
  if (!privateBytes || privateBytes.length < 19 || privateBytes.toString("ascii", 0, 8) !== "OpusHead") {
    invalid("Opus 轨道缺少有效的 OpusHead。", "VOICE_OPUS_INVALID");
  }
  const version = privateBytes[8];
  const channels = privateBytes[9];
  if (version > 15 || channels < 1 || channels > 8) invalid("OpusHead 版本或声道数无效。", "VOICE_OPUS_INVALID");
  const mappingFamily = privateBytes[18];
  if (mappingFamily === 0) {
    if (privateBytes.length !== 19 || channels > 2) invalid("Opus 单流声道映射无效。", "VOICE_OPUS_INVALID");
  } else {
    if (privateBytes.length < 21 + channels) truncated("Opus 声道映射被截断。", "VOICE_OPUS_TRUNCATED");
    const streams = privateBytes[19];
    const coupled = privateBytes[20];
    if (!streams || coupled > streams || streams + coupled !== channels) {
      invalid("Opus 声道映射无效。", "VOICE_OPUS_INVALID");
    }
  }
  if (track.channels && track.channels !== channels) invalid("WebM 与 OpusHead 声道数不一致。", "VOICE_OPUS_INVALID");
  if (track.sampleRate && (!Number.isFinite(track.sampleRate) || track.sampleRate <= 0 || track.sampleRate > 384_000)) {
    invalid("WebM 采样率无效。", "VOICE_OPUS_INVALID");
  }
}

function parseWebmCluster(buffer, cluster, audioTrackNumber, timecodeScale) {
  let clusterTimestamp = null;
  const pendingBlocks = [];
  walkEbml(buffer, cluster.dataStart, cluster.dataEnd, (child) => {
    if (child.id === EBML_IDS.TIMESTAMP) {
      clusterTimestamp = readEbmlUnsigned(buffer, child, "Cluster Timestamp");
    } else if (child.id === EBML_IDS.SIMPLE_BLOCK) {
      pendingBlocks.push({ element: child, durationUnits: 0 });
    } else if (child.id === EBML_IDS.BLOCK_GROUP) {
      let block = null;
      let durationUnits = 0;
      walkEbml(buffer, child.dataStart, child.dataEnd, (groupChild) => {
        if (groupChild.id === EBML_IDS.BLOCK) block = groupChild;
        else if (groupChild.id === EBML_IDS.BLOCK_DURATION) {
          durationUnits = readEbmlUnsigned(buffer, groupChild, "BlockDuration");
        }
      });
      if (block) pendingBlocks.push({ element: block, durationUnits });
    }
  });
  if (pendingBlocks.length && clusterTimestamp === null) invalid("WebM Cluster 缺少时间戳。", "VOICE_WEBM_INVALID");

  let endMs = 0;
  let blocks = 0;
  for (const pending of pendingBlocks) {
    const block = parseWebmBlock(buffer.subarray(pending.element.dataStart, pending.element.dataEnd));
    if (block.trackNumber !== audioTrackNumber) continue;
    const baseUnits = clusterTimestamp + block.relativeTimecode;
    if (!Number.isSafeInteger(baseUnits)) invalid("WebM 块时间戳超出范围。", "VOICE_DURATION_INVALID");
    let packetDurationMs = 0;
    for (const packet of block.packets) packetDurationMs += opusPacketDurationMs(packet);
    const startMs = baseUnits * timecodeScale / 1_000_000;
    const declaredBlockMs = pending.durationUnits * timecodeScale / 1_000_000;
    const blockEnd = Math.max(startMs + packetDurationMs, startMs + declaredBlockMs);
    if (!Number.isFinite(blockEnd) || blockEnd < 0) invalid("WebM 块时间戳无效。", "VOICE_DURATION_INVALID");
    endMs = Math.max(endMs, blockEnd);
    blocks += 1;
  }
  return { endMs, blocks };
}

function parseWebmBlock(data) {
  const trackVint = readEbmlVint(data, 0, false);
  if (trackVint.unknown || trackVint.value <= 0n || trackVint.value > BigInt(Number.MAX_SAFE_INTEGER)) {
    invalid("WebM 块轨道编号无效。", "VOICE_WEBM_INVALID");
  }
  let offset = trackVint.end;
  if (data.length - offset < 3) truncated("WebM 块头被截断。", "VOICE_WEBM_TRUNCATED");
  const relativeTimecode = data.readInt16BE(offset);
  const flags = data[offset + 2];
  offset += 3;
  const packets = parseWebmLacing(data, offset, (flags & 0x06) >> 1);
  if (!packets.length || packets.some((packet) => packet.length === 0)) {
    invalid("WebM 块没有有效的 Opus 包。", "VOICE_AUDIO_DATA_MISSING");
  }
  return { trackNumber: Number(trackVint.value), relativeTimecode, packets };
}

function parseWebmLacing(data, offset, lacing) {
  if (lacing === 0) return [data.subarray(offset)];
  if (offset >= data.length) truncated("WebM lacing 头被截断。", "VOICE_WEBM_TRUNCATED");
  const count = data[offset] + 1;
  offset += 1;
  const sizes = [];
  if (lacing === 1) {
    for (let index = 0; index < count - 1; index += 1) {
      let size = 0;
      while (true) {
        if (offset >= data.length) truncated("WebM Xiph lacing 被截断。", "VOICE_WEBM_TRUNCATED");
        const value = data[offset++];
        size += value;
        if (value !== 255) break;
      }
      sizes.push(size);
    }
  } else if (lacing === 2) {
    const payload = data.length - offset;
    if (payload <= 0 || payload % count !== 0) invalid("WebM fixed lacing 长度无效。", "VOICE_WEBM_INVALID");
    sizes.push(...new Array(count - 1).fill(payload / count));
  } else {
    const first = readEbmlVint(data, offset, false);
    if (first.unknown || first.value > BigInt(Number.MAX_SAFE_INTEGER)) invalid("WebM EBML lacing 长度无效。", "VOICE_WEBM_INVALID");
    offset = first.end;
    sizes.push(Number(first.value));
    for (let index = 1; index < count - 1; index += 1) {
      const delta = readSignedEbmlVint(data, offset);
      offset = delta.end;
      const next = sizes[index - 1] + delta.value;
      if (!Number.isSafeInteger(next) || next < 0) invalid("WebM EBML lacing 长度无效。", "VOICE_WEBM_INVALID");
      sizes.push(next);
    }
  }
  const knownBytes = sizes.reduce((sum, size) => sum + size, 0);
  const lastSize = data.length - offset - knownBytes;
  if (lastSize < 0) truncated("WebM lacing 数据被截断。", "VOICE_WEBM_TRUNCATED");
  sizes.push(lastSize);
  const packets = [];
  for (const size of sizes) {
    const end = offset + size;
    if (!Number.isSafeInteger(end) || end > data.length) truncated("WebM lacing 数据被截断。", "VOICE_WEBM_TRUNCATED");
    packets.push(data.subarray(offset, end));
    offset = end;
  }
  if (offset !== data.length) invalid("WebM lacing 尾部存在额外数据。", "VOICE_WEBM_INVALID");
  return packets;
}

function opusPacketDurationMs(packet) {
  if (!packet.length) invalid("Opus 包为空。", "VOICE_OPUS_INVALID");
  const config = packet[0] >> 3;
  const frameCode = packet[0] & 0x03;
  let frameMs;
  if (config >= 16) frameMs = [2.5, 5, 10, 20][config & 0x03];
  else if (config >= 12) frameMs = [10, 20][config & 0x01];
  else frameMs = [10, 20, 40, 60][config & 0x03];
  let frames;
  if (frameCode === 0) frames = 1;
  else if (frameCode === 1 || frameCode === 2) frames = 2;
  else {
    if (packet.length < 2) truncated("Opus 包帧计数被截断。", "VOICE_OPUS_TRUNCATED");
    frames = packet[1] & 0x3f;
  }
  const total = frames * frameMs;
  if (!frames || frames > 48 || total > 120) invalid("Opus 包时长无效。", "VOICE_OPUS_INVALID");
  return total;
}

function parseMp4Aac(buffer) {
  const top = readMp4Boxes(buffer, 0, buffer.length);
  if (!top.length || top[0].type !== "ftyp") invalid("MP4 缺少 ftyp 文件头。", "VOICE_MP4_INVALID");
  validateFtyp(buffer, top[0]);
  const moovBoxes = top.filter((box) => box.type === "moov");
  if (moovBoxes.length !== 1) invalid("MP4 必须包含一个 moov。", "VOICE_MP4_INVALID");
  const mdatBoxes = top.filter((box) => box.type === "mdat");
  const mdatBytes = mdatBoxes.reduce((sum, box) => sum + (box.end - box.dataStart), 0);
  if (!mdatBoxes.length || mdatBytes <= 0) invalid("MP4 缺少声音媒体数据。", "VOICE_AUDIO_DATA_MISSING");

  const moovChildren = readMp4Boxes(buffer, moovBoxes[0].dataStart, moovBoxes[0].end);
  const trackBoxes = moovChildren.filter((box) => box.type === "trak");
  if (!trackBoxes.length) invalid("MP4 缺少轨道。", "VOICE_MP4_INVALID");
  const audioTracks = [];
  for (const trackBox of trackBoxes) {
    const track = parseMp4Track(buffer, trackBox);
    if (track.handler === "vide") fail(415, "声音文件不能包含视频轨。", "VOICE_VIDEO_TRACK_FORBIDDEN");
    if (track.handler === "soun") audioTracks.push(track);
  }
  if (audioTracks.length !== 1) {
    fail(415, "声音文件必须且只能包含一条音频轨。", "VOICE_AUDIO_TRACK_INVALID");
  }
  const track = audioTracks[0];
  if (!track.aac) fail(415, "MP4 音频轨必须使用 AAC。", "VOICE_CODEC_UNSUPPORTED");
  if (!track.sampleCount || !track.sampleBytes) invalid("MP4 AAC 轨没有声音样本。", "VOICE_AUDIO_DATA_MISSING");
  if (track.sampleBytes > mdatBytes) truncated("MP4 声音样本超出 mdat 边界。", "VOICE_MP4_TRUNCATED");
  return { durationMs: track.durationMs, audioTracks: 1 };
}

function validateFtyp(buffer, box) {
  const length = box.end - box.dataStart;
  if (length < 8 || length % 4 !== 0) invalid("MP4 ftyp 无效。", "VOICE_MP4_INVALID");
  const brands = [];
  for (let offset = box.dataStart; offset < box.end; offset += 4) {
    if (offset === box.dataStart + 4) continue;
    brands.push(buffer.toString("ascii", offset, offset + 4));
  }
  if (!brands.some((brand) => MP4_BRANDS.has(brand))) {
    fail(415, "ISO BMFF 品牌不是受支持的 MP4/M4A。", "VOICE_UNSUPPORTED_TYPE");
  }
}

function parseMp4Track(buffer, trackBox) {
  const children = readMp4Boxes(buffer, trackBox.dataStart, trackBox.end);
  const mdia = exactlyOne(children, "mdia", "MP4 trak 缺少或重复 mdia。");
  const mediaChildren = readMp4Boxes(buffer, mdia.dataStart, mdia.end);
  const hdlr = exactlyOne(mediaChildren, "hdlr", "MP4 mdia 缺少或重复 hdlr。");
  const handler = parseMp4Handler(buffer, hdlr);
  if (handler !== "soun") return { handler };
  const mdhd = exactlyOne(mediaChildren, "mdhd", "MP4 音频轨缺少或重复 mdhd。");
  const durationMs = parseMp4Duration(buffer, mdhd);
  const minf = exactlyOne(mediaChildren, "minf", "MP4 音频轨缺少或重复 minf。");
  const minfChildren = readMp4Boxes(buffer, minf.dataStart, minf.end);
  const stbl = exactlyOne(minfChildren, "stbl", "MP4 音频轨缺少或重复 stbl。");
  const sampleTable = parseMp4SampleTable(buffer, stbl);
  return { handler, durationMs, ...sampleTable };
}

function parseMp4Handler(buffer, box) {
  requireMp4Payload(box, 12, "hdlr");
  return buffer.toString("ascii", box.dataStart + 8, box.dataStart + 12);
}

function parseMp4Duration(buffer, box) {
  requireMp4Payload(box, 4, "mdhd");
  const version = buffer[box.dataStart];
  let timescale;
  let duration;
  if (version === 0) {
    requireMp4Payload(box, 24, "mdhd");
    timescale = buffer.readUInt32BE(box.dataStart + 12);
    duration = BigInt(buffer.readUInt32BE(box.dataStart + 16));
    if (duration === 0xffffffffn) duration = 0n;
  } else if (version === 1) {
    requireMp4Payload(box, 36, "mdhd");
    timescale = buffer.readUInt32BE(box.dataStart + 20);
    duration = buffer.readBigUInt64BE(box.dataStart + 24);
    if (duration === 0xffffffffffffffffn) duration = 0n;
  } else {
    invalid("MP4 mdhd 版本无效。", "VOICE_MP4_INVALID");
  }
  if (!timescale || duration <= 0n) invalid("MP4 音频时长无效。", "VOICE_DURATION_INVALID");
  const durationMs = Number(duration) * 1000 / timescale;
  if (!Number.isFinite(durationMs) || durationMs <= 0) invalid("MP4 音频时长超出范围。", "VOICE_DURATION_INVALID");
  return durationMs;
}

function parseMp4SampleTable(buffer, stbl) {
  const children = readMp4Boxes(buffer, stbl.dataStart, stbl.end);
  const stsd = exactlyOne(children, "stsd", "MP4 音频轨缺少或重复 stsd。");
  const description = parseMp4SampleDescription(buffer, stsd);
  const sizeBox = children.find((box) => box.type === "stsz" || box.type === "stz2");
  if (!sizeBox || children.filter((box) => box.type === "stsz" || box.type === "stz2").length !== 1) {
    invalid("MP4 音频轨缺少或重复样本大小表。", "VOICE_MP4_INVALID");
  }
  const sizes = sizeBox.type === "stsz" ? parseStsz(buffer, sizeBox) : parseStz2(buffer, sizeBox);
  return { ...description, ...sizes };
}

function parseMp4SampleDescription(buffer, stsd) {
  requireMp4Payload(stsd, 8, "stsd");
  const entryCount = buffer.readUInt32BE(stsd.dataStart + 4);
  if (!entryCount || entryCount > 32) invalid("MP4 stsd 条目数无效。", "VOICE_MP4_INVALID");
  const entries = readMp4Boxes(buffer, stsd.dataStart + 8, stsd.end);
  if (entries.length !== entryCount || entries.length !== 1 || entries[0].type !== "mp4a") {
    fail(415, "MP4 音频样本必须是 mp4a/AAC。", "VOICE_CODEC_UNSUPPORTED");
  }
  validateMp4aEntry(buffer, entries[0]);
  return { aac: true };
}

function validateMp4aEntry(buffer, entry) {
  requireMp4Payload(entry, 28, "mp4a");
  const version = buffer.readUInt16BE(entry.dataStart + 8);
  const childOffset = entry.dataStart + (version === 0 ? 28 : version === 1 ? 44 : version === 2 ? 64 : 0);
  if (!childOffset || childOffset > entry.end) invalid("mp4a AudioSampleEntry 版本无效。", "VOICE_MP4_INVALID");
  const channels = buffer.readUInt16BE(entry.dataStart + 16);
  const sampleRate = buffer.readUInt32BE(entry.dataStart + 24) >>> 16;
  if (!channels || channels > 8 || !sampleRate || sampleRate > 384_000) {
    invalid("mp4a 声道数或采样率无效。", "VOICE_MP4_INVALID");
  }
  const children = readMp4Boxes(buffer, childOffset, entry.end);
  const esds = findNestedMp4Box(buffer, children, "esds", 0);
  if (!esds || !parseAacEsds(buffer, esds)) fail(415, "mp4a 缺少有效的 AAC 配置。", "VOICE_CODEC_UNSUPPORTED");
}

function findNestedMp4Box(buffer, boxes, type, depth) {
  const direct = boxes.find((box) => box.type === type);
  if (direct) return direct;
  if (depth >= 2) return null;
  for (const box of boxes) {
    if (box.type !== "wave") continue;
    const found = findNestedMp4Box(buffer, readMp4Boxes(buffer, box.dataStart, box.end), type, depth + 1);
    if (found) return found;
  }
  return null;
}

function parseAacEsds(buffer, esds) {
  requireMp4Payload(esds, 6, "esds");
  const start = esds.dataStart + 4;
  try {
    const root = readDescriptor(buffer, start, esds.end);
    if (root.end !== esds.end) return false;
    if (root.tag === 0x03) return parseEsDescriptor(buffer, root);
    if (root.tag === 0x04) return parseDecoderConfigDescriptor(buffer, root);
    return false;
  } catch (error) {
    if (error?.code?.startsWith("VOICE_")) return false;
    throw error;
  }
}

function parseEsDescriptor(buffer, descriptor) {
  let offset = descriptor.dataStart;
  if (descriptor.dataEnd - offset < 3) return false;
  offset += 2;
  const flags = buffer[offset++];
  if (flags & 0x80) offset += 2;
  if (flags & 0x40) {
    if (offset >= descriptor.dataEnd) return false;
    offset += 1 + buffer[offset];
  }
  if (flags & 0x20) offset += 2;
  if (offset > descriptor.dataEnd) return false;
  while (offset < descriptor.dataEnd) {
    const child = readDescriptor(buffer, offset, descriptor.dataEnd);
    if (child.tag === 0x04 && parseDecoderConfigDescriptor(buffer, child)) return true;
    offset = child.end;
  }
  return false;
}

function parseDecoderConfigDescriptor(buffer, descriptor) {
  if (descriptor.dataEnd - descriptor.dataStart < 13) return false;
  if (buffer[descriptor.dataStart] !== 0x40) return false;
  if (((buffer[descriptor.dataStart + 1] >> 2) & 0x3f) !== 0x05) return false;
  let offset = descriptor.dataStart + 13;
  while (offset < descriptor.dataEnd) {
    const child = readDescriptor(buffer, offset, descriptor.dataEnd);
    if (child.tag === 0x05 && validAudioSpecificConfig(buffer.subarray(child.dataStart, child.dataEnd))) return true;
    offset = child.end;
  }
  return false;
}

function validAudioSpecificConfig(bytes) {
  if (bytes.length < 2) return false;
  const bits = new BitReader(bytes);
  let objectType = bits.read(5);
  if (objectType === 31) objectType = 32 + bits.read(6);
  if (!AAC_OBJECT_TYPES.has(objectType)) return false;
  const frequencyIndex = bits.read(4);
  if (frequencyIndex === 15) {
    const explicit = bits.read(24);
    if (explicit < 7350 || explicit > 384_000) return false;
  } else if (frequencyIndex > 12) return false;
  const channelConfig = bits.read(4);
  return channelConfig >= 1 && channelConfig <= 7;
}

function parseStsz(buffer, box) {
  requireMp4Payload(box, 12, "stsz");
  const sampleSize = buffer.readUInt32BE(box.dataStart + 4);
  const sampleCount = buffer.readUInt32BE(box.dataStart + 8);
  if (!sampleCount || sampleCount > 10_000_000) invalid("MP4 样本数无效。", "VOICE_MP4_INVALID");
  let sampleBytes = 0;
  if (sampleSize) {
    sampleBytes = sampleSize * sampleCount;
  } else {
    const requiredEnd = box.dataStart + 12 + sampleCount * 4;
    if (!Number.isSafeInteger(requiredEnd) || requiredEnd !== box.end) truncated("MP4 stsz 被截断。", "VOICE_MP4_TRUNCATED");
    for (let offset = box.dataStart + 12; offset < box.end; offset += 4) sampleBytes += buffer.readUInt32BE(offset);
  }
  if (!Number.isSafeInteger(sampleBytes) || sampleBytes <= 0) invalid("MP4 样本大小无效。", "VOICE_AUDIO_DATA_MISSING");
  return { sampleCount, sampleBytes };
}

function parseStz2(buffer, box) {
  requireMp4Payload(box, 12, "stz2");
  const fieldSize = buffer[box.dataStart + 7];
  const sampleCount = buffer.readUInt32BE(box.dataStart + 8);
  if (![4, 8, 16].includes(fieldSize) || !sampleCount || sampleCount > 10_000_000) {
    invalid("MP4 stz2 参数无效。", "VOICE_MP4_INVALID");
  }
  const dataStart = box.dataStart + 12;
  const requiredBytes = Math.ceil(sampleCount * fieldSize / 8);
  if (dataStart + requiredBytes !== box.end) truncated("MP4 stz2 被截断。", "VOICE_MP4_TRUNCATED");
  let sampleBytes = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    if (fieldSize === 4) sampleBytes += (buffer[dataStart + (index >> 1)] >> (index % 2 ? 0 : 4)) & 0x0f;
    else if (fieldSize === 8) sampleBytes += buffer[dataStart + index];
    else sampleBytes += buffer.readUInt16BE(dataStart + index * 2);
  }
  if (!sampleBytes) invalid("MP4 样本大小无效。", "VOICE_AUDIO_DATA_MISSING");
  return { sampleCount, sampleBytes };
}

function readMp4Boxes(buffer, start, end) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > buffer.length) {
    invalid("MP4 盒边界无效。", "VOICE_MP4_INVALID");
  }
  const boxes = [];
  let offset = start;
  while (offset < end) {
    if (boxes.length >= MAX_PARSED_ELEMENTS) invalid("MP4 盒数量过多。", "VOICE_MP4_INVALID");
    if (end - offset < 8) truncated("MP4 盒头被截断。", "VOICE_MP4_TRUNCATED");
    const size32 = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    if (!/^[\x20-\x7e]{4}$/.test(type)) invalid("MP4 盒类型无效。", "VOICE_MP4_INVALID");
    let headerSize = 8;
    let boxSize;
    if (size32 === 1) {
      if (end - offset < 16) truncated("MP4 扩展盒头被截断。", "VOICE_MP4_TRUNCATED");
      const extended = buffer.readBigUInt64BE(offset + 8);
      if (extended > BigInt(Number.MAX_SAFE_INTEGER)) invalid("MP4 盒过大。", "VOICE_MP4_INVALID");
      boxSize = Number(extended);
      headerSize = 16;
    } else if (size32 === 0) {
      boxSize = end - offset;
    } else {
      boxSize = size32;
    }
    if (boxSize < headerSize) invalid("MP4 盒长度无效。", "VOICE_MP4_INVALID");
    const boxEnd = offset + boxSize;
    if (!Number.isSafeInteger(boxEnd) || boxEnd > end) truncated("MP4 盒超出父盒边界。", "VOICE_MP4_TRUNCATED");
    boxes.push({ type, start: offset, dataStart: offset + headerSize, end: boxEnd, headerSize });
    offset = boxEnd;
  }
  return boxes;
}

function exactlyOne(boxes, type, message) {
  const matches = boxes.filter((box) => box.type === type);
  if (matches.length !== 1) invalid(message, "VOICE_MP4_INVALID");
  return matches[0];
}

function requireMp4Payload(box, minimum, name) {
  if (box.end - box.dataStart < minimum) truncated(`MP4 ${name} 被截断。`, "VOICE_MP4_TRUNCATED");
}

function readDescriptor(buffer, offset, limit) {
  if (offset >= limit) truncated("MPEG-4 描述符被截断。", "VOICE_MP4_TRUNCATED");
  const tag = buffer[offset++];
  let length = 0;
  let terminated = false;
  for (let index = 0; index < 4; index += 1) {
    if (offset >= limit) truncated("MPEG-4 描述符长度被截断。", "VOICE_MP4_TRUNCATED");
    const value = buffer[offset++];
    length = length * 128 + (value & 0x7f);
    if (!(value & 0x80)) {
      terminated = true;
      break;
    }
  }
  if (!terminated) invalid("MPEG-4 描述符长度无效。", "VOICE_MP4_INVALID");
  const dataEnd = offset + length;
  if (!Number.isSafeInteger(dataEnd) || dataEnd > limit) truncated("MPEG-4 描述符被截断。", "VOICE_MP4_TRUNCATED");
  return { tag, dataStart: offset, dataEnd, end: dataEnd };
}

function walkEbml(buffer, start, end, visitor) {
  let offset = start;
  let count = 0;
  while (offset < end) {
    if (++count > MAX_PARSED_ELEMENTS) invalid("WebM 元素数量过多。", "VOICE_WEBM_INVALID");
    const element = readEbmlElement(buffer, offset, end, false);
    visitor(element);
    offset = element.dataEnd;
  }
}

function readEbmlElement(buffer, offset, limit, allowUnknownSize) {
  const id = readEbmlVint(buffer, offset, true);
  if (id.width > 4 || id.value > 0xffffffffn) invalid("EBML 元素 ID 无效。", "VOICE_WEBM_INVALID");
  const size = readEbmlVint(buffer, id.end, false);
  if (size.unknown && !allowUnknownSize) invalid("EBML 子元素不能使用未知长度。", "VOICE_WEBM_INVALID");
  if (size.unknown && Number(id.value) !== EBML_IDS.SEGMENT) invalid("仅 WebM Segment 可使用未知长度。", "VOICE_WEBM_INVALID");
  const dataStart = size.end;
  let dataEnd = limit;
  if (!size.unknown) {
    if (size.value > BigInt(Number.MAX_SAFE_INTEGER)) invalid("EBML 元素过大。", "VOICE_WEBM_INVALID");
    dataEnd = dataStart + Number(size.value);
    if (!Number.isSafeInteger(dataEnd) || dataEnd > limit) truncated("EBML 元素超出父元素边界。", "VOICE_WEBM_TRUNCATED");
  }
  return { id: Number(id.value), start: offset, dataStart, dataEnd, unknownSize: size.unknown };
}

function readEbmlVint(buffer, offset, keepMarker) {
  if (offset >= buffer.length) truncated("EBML 可变长整数被截断。", "VOICE_WEBM_TRUNCATED");
  const first = buffer[offset];
  if (!first) invalid("EBML 可变长整数无效。", "VOICE_WEBM_INVALID");
  let width = 1;
  let marker = 0x80;
  while (!(first & marker) && width <= 8) {
    marker >>= 1;
    width += 1;
  }
  if (width > 8 || offset + width > buffer.length) truncated("EBML 可变长整数被截断。", "VOICE_WEBM_TRUNCATED");
  let value = BigInt(keepMarker ? first : first & (marker - 1));
  for (let index = 1; index < width; index += 1) value = (value << 8n) | BigInt(buffer[offset + index]);
  const maximum = (1n << BigInt(7 * width)) - 1n;
  return { value, width, end: offset + width, unknown: !keepMarker && value === maximum };
}

function readSignedEbmlVint(buffer, offset) {
  const vint = readEbmlVint(buffer, offset, false);
  if (vint.unknown) invalid("EBML lacing 差值无效。", "VOICE_WEBM_INVALID");
  const bias = (1n << BigInt(7 * vint.width - 1)) - 1n;
  const signed = vint.value - bias;
  if (signed < BigInt(Number.MIN_SAFE_INTEGER) || signed > BigInt(Number.MAX_SAFE_INTEGER)) {
    invalid("EBML lacing 差值超出范围。", "VOICE_WEBM_INVALID");
  }
  return { value: Number(signed), end: vint.end };
}

function readEbmlUnsigned(buffer, element, name) {
  const length = element.dataEnd - element.dataStart;
  if (length < 1 || length > 8) invalid(`WebM ${name} 长度无效。`, "VOICE_WEBM_INVALID");
  let value = 0n;
  for (let offset = element.dataStart; offset < element.dataEnd; offset += 1) value = (value << 8n) | BigInt(buffer[offset]);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) invalid(`WebM ${name} 超出范围。`, "VOICE_WEBM_INVALID");
  return Number(value);
}

function readEbmlFloat(buffer, element, name) {
  const length = element.dataEnd - element.dataStart;
  if (length === 4) return buffer.readFloatBE(element.dataStart);
  if (length === 8) return buffer.readDoubleBE(element.dataStart);
  invalid(`WebM ${name} 必须是 32 或 64 位浮点数。`, "VOICE_WEBM_INVALID");
}

function readAscii(buffer, element) {
  const value = buffer.toString("ascii", element.dataStart, element.dataEnd);
  if (!value || !/^[\x20-\x7e]+$/.test(value)) invalid("WebM ASCII 字段无效。", "VOICE_WEBM_INVALID");
  return value;
}

function readUtf8(buffer, element) {
  const value = buffer.toString("utf8", element.dataStart, element.dataEnd);
  if (!value || value.includes("\ufffd") || value.includes("\u0000")) invalid("WebM 文本字段无效。", "VOICE_WEBM_INVALID");
  return value;
}

class BitReader {
  constructor(bytes) {
    this.bytes = bytes;
    this.offset = 0;
  }

  read(count) {
    if (!Number.isInteger(count) || count < 0 || this.offset + count > this.bytes.length * 8) {
      invalid("AAC AudioSpecificConfig 被截断。", "VOICE_AAC_INVALID");
    }
    let value = 0;
    for (let index = 0; index < count; index += 1) {
      value = value * 2 + ((this.bytes[this.offset >> 3] >> (7 - (this.offset & 7))) & 1);
      this.offset += 1;
    }
    return value;
  }
}

function assertDeclaredMime(raw, detected) {
  const declared = String(raw || "").split(";", 1)[0].trim().toLowerCase();
  if (!declared || declared === "application/octet-stream") return;
  const canonical = declared === "audio/m4a" || declared === "audio/x-m4a" ? "audio/mp4" : declared;
  if (canonical !== detected) {
    fail(415, "声明的声音 MIME 与文件真实格式不一致。", "VOICE_MIME_MISMATCH");
  }
}

function boundedPositiveInteger(value, hardLimit) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) return hardLimit;
  return Math.min(number, hardLimit);
}

function toBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  throw new TypeError("声音内容必须是 Buffer 或 Uint8Array。");
}

function truncated(message, code) {
  fail(400, message, code);
}

function invalid(message, code) {
  fail(400, message, code);
}

function fail(statusCode, message, code) {
  throw voiceFormatError(statusCode, message, code);
}

function voiceFormatError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

module.exports = {
  inspectVoice,
  detectVoiceMimeType,
  voiceFormatError
};
