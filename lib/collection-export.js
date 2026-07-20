"use strict";

const { referencedOralVoiceAssetIds } = require("./oral-history-backup");

const REDACTED_COLLECTION_PRIVACY = "原始正文、人物、地点、媒体备注、声音内容、文字稿、口述问题与回答、来源护照主张与证据定位、展览叙事及受限策展运行内容已隐藏。";

function createCollectionExporter({ store, appVersion, schemaVersion, buildArchaeologyBackup }) {
  if (!store || typeof buildArchaeologyBackup !== "function") {
    throw new TypeError("Collection exporter dependencies are required.");
  }

  return function buildCollectionExport(memories, mode) {
    const exported = mode === "redacted" ? memories.map(redactMemory) : memories;
    const memoryIds = memories.map((memory) => memory.id);
    const archaeology = buildArchaeologyBackup(store, memories, mode);
    const collection = {
      product: "时屿",
      productEnglish: "TIME ISLE",
      version: appVersion,
      schemaVersion,
      mode,
      exportedAt: new Date().toISOString(),
      count: exported.length,
      privacy: mode === "redacted"
        ? REDACTED_COLLECTION_PRIVACY
        : "包含馆藏、声音索引、口述史、主题展览、时光胶囊、时间校准、记忆考古与受限策展审计数据；媒体字节只在 .time-isle 完整备份中携带，不包含隐藏思维链或旧整理 Agent 日志。",
      memories: exported,
      archaeology,
      exhibitions: store.buildExhibitionBackup(mode),
      revisits: store.buildRevisitBackup(mode, memoryIds),
      entities: store.buildClueBackup(mode, memoryIds)
    };
    let oralHistories = null;
    let additionalAssetIds = [];
    if (schemaVersion >= 13) {
      if (typeof store.buildOralHistoryBackup !== "function") {
        throw new TypeError("Schema 13 collection exporter requires oral-history backup support.");
      }
      const eventIds = archaeology?.mode === "full" && Array.isArray(archaeology.events)
        ? archaeology.events.map((event) => event?.id).filter(Boolean)
        : [];
      oralHistories = store.buildOralHistoryBackup(mode, eventIds);
      additionalAssetIds = mode === "redacted" ? [] : referencedOralVoiceAssetIds(oralHistories);
    }
    if (schemaVersion >= 8) {
      if (typeof store.buildVoiceBackup !== "function") throw new TypeError("Schema 8 collection exporter requires voice backup support.");
      collection.voices = store.buildVoiceBackup(mode, memoryIds, { additionalAssetIds });
    }
    if (schemaVersion >= 9) {
      if (typeof store.buildCapsuleBackup !== "function") throw new TypeError("Schema 9 collection exporter requires capsule backup support.");
      collection.capsules = store.buildCapsuleBackup(mode);
    }
    if (schemaVersion >= 10) {
      if (typeof store.buildRevisionBackup !== "function") throw new TypeError("Schema 10 collection exporter requires revision backup support.");
      collection.revisions = store.buildRevisionBackup(mode, memoryIds);
    }
    if (schemaVersion >= 11) {
      if (typeof store.buildRevisitIntentBackup !== "function") throw new TypeError("Schema 11 collection exporter requires revisit intent backup support.");
      collection.revisitIntents = store.buildRevisitIntentBackup(mode, memoryIds);
    }
    if (schemaVersion >= 12) {
      if (typeof store.buildTimeCalibrationBackup !== "function") throw new TypeError("Schema 12 collection exporter requires time calibration backup support.");
      collection.timeCalibrations = store.buildTimeCalibrationBackup(mode, memoryIds);
    }
    if (schemaVersion >= 13) collection.oralHistories = oralHistories;
    if (schemaVersion >= 14) {
      if (typeof store.buildCuratorAgentBackup !== "function") {
        throw new TypeError("Schema 14 collection exporter requires curator-agent backup support.");
      }
      collection.curatorAgent = store.buildCuratorAgentBackup(mode);
    }
    if (schemaVersion >= 15) {
      if (typeof store.buildMemoryInboxBackup !== "function") {
        throw new TypeError("Schema 15 collection exporter requires memory-inbox backup support.");
      }
      collection.memoryInbox = store.buildMemoryInboxBackup(mode);
    }
    if (schemaVersion >= 16) {
      if (typeof store.buildProvenanceBackup !== "function") {
        throw new TypeError("Schema 16 collection exporter requires provenance backup support.");
      }
      collection.provenance = store.buildProvenanceBackup(mode, memoryIds);
    }
    if (schemaVersion >= 17) {
      if (typeof store.buildCoMemoryResponseBackup !== "function") {
        throw new TypeError("Schema 17 collection exporter requires co-memory response backup support.");
      }
      collection.coMemoryResponses = store.buildCoMemoryResponseBackup(mode, memoryIds);
    }
    return collection;
  };
}

function redactMemory(memory) {
  return {
    schemaVersion: memory.schemaVersion,
    id: memory.id,
    title: memory.title,
    hall: memory.hall,
    sourceType: memory.sourceType,
    rawContent: "[已隐藏原始记忆]",
    exhibitText: String(memory.exhibitText || "").trim().slice(0, 160),
    date: memory.date || "",
    people: memory.people?.length ? ["[已隐藏人物]"] : [],
    location: memory.location ? "[已隐藏地点]" : "",
    tags: Array.isArray(memory.tags) ? memory.tags : [],
    emotions: Array.isArray(memory.emotions) ? memory.emotions : [],
    emotionIntensity: memory.emotionIntensity,
    importance: memory.importance,
    favorite: Boolean(memory.favorite),
    coverImage: "",
    mediaNote: memory.mediaNote ? "[已隐藏媒体备注]" : "",
    attachments: [],
    agentRunId: "",
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
    entityRefs: [],
    media: [],
    mediaSummary: { count: memory.media?.length || 0, coverAssetId: "", coverThumbnailUrl: "" },
    voices: [],
    voiceSummary: { count: memory.voices?.length || memory.voiceSummary?.count || 0, confirmedTranscriptCount: 0 }
  };
}

module.exports = { createCollectionExporter, redactMemory, REDACTED_COLLECTION_PRIVACY };
