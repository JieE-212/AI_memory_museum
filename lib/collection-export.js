"use strict";

function createCollectionExporter({ store, appVersion, schemaVersion, buildArchaeologyBackup }) {
  if (!store || typeof buildArchaeologyBackup !== "function") {
    throw new TypeError("Collection exporter dependencies are required.");
  }

  return function buildCollectionExport(memories, mode) {
    const exported = mode === "redacted" ? memories.map(redactMemory) : memories;
    const memoryIds = memories.map((memory) => memory.id);
    const collection = {
      product: "时屿",
      productEnglish: "TIME ISLE",
      version: appVersion,
      schemaVersion,
      mode,
      exportedAt: new Date().toISOString(),
      count: exported.length,
      privacy: mode === "redacted"
        ? "原始正文、人物、地点、媒体备注、声音内容、文字稿和展览叙事已隐藏。"
        : "包含馆藏、声音索引、主题展览、时光胶囊与记忆考古数据；媒体字节只在 .time-isle 完整备份中携带，不包含 Agent 运行日志。",
      memories: exported,
      archaeology: buildArchaeologyBackup(store, memories, mode),
      exhibitions: store.buildExhibitionBackup(mode),
      revisits: store.buildRevisitBackup(mode, memoryIds),
      entities: store.buildClueBackup(mode, memoryIds)
    };
    if (schemaVersion >= 8) {
      if (typeof store.buildVoiceBackup !== "function") throw new TypeError("Schema 8 collection exporter requires voice backup support.");
      collection.voices = store.buildVoiceBackup(mode, memoryIds);
    }
    if (schemaVersion >= 9) {
      if (typeof store.buildCapsuleBackup !== "function") throw new TypeError("Schema 9 collection exporter requires capsule backup support.");
      collection.capsules = store.buildCapsuleBackup(mode);
    }
    return collection;
  };
}

function redactMemory(memory) {
  return {
    ...memory,
    rawContent: "[已隐藏原始记忆]",
    exhibitText: String(memory.exhibitText || "").trim().slice(0, 160),
    people: memory.people?.length ? ["[已隐藏人物]"] : [],
    location: memory.location ? "[已隐藏地点]" : "",
    coverImage: "",
    mediaNote: memory.mediaNote ? "[已隐藏媒体备注]" : "",
    attachments: [],
    media: [],
    mediaSummary: { count: memory.media?.length || 0, coverAssetId: "", coverThumbnailUrl: "" },
    voices: [],
    voiceSummary: { count: memory.voices?.length || memory.voiceSummary?.count || 0, confirmedTranscriptCount: 0 }
  };
}

module.exports = { createCollectionExporter, redactMemory };
