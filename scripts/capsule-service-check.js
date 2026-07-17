"use strict";

const assert = require("node:assert/strict");
const {
  CEREMONIAL_GATE,
  buildSafeSnapshot,
  createCapsuleService,
  getLocalDate,
  normalizeTimezone,
  requireLocalDate,
  validateSafeSnapshot
} = require("../lib/capsule-service");

let assertions = 0;

checkCalendarBoundaries();
checkSafeSnapshot();
checkServiceFlow();

console.log(`Capsule service checks passed: ${assertions} assertions.`);

function checkCalendarBoundaries() {
  equal(getLocalDate("2028-02-28T15:59:59.999Z", "Asia/Shanghai"), "2028-02-28", "上海午夜前仍是开启日前一天");
  equal(getLocalDate("2028-02-28T16:00:00.000Z", "Asia/Shanghai"), "2028-02-29", "上海午夜按存储时区进入闰日");
  equal(getLocalDate("2028-02-29T16:00:00.000Z", "Asia/Shanghai"), "2028-03-01", "闰日之后进入下一本地日期");
  equal(getLocalDate("2028-02-29T01:00:00.000Z", "America/New_York"), "2028-02-28", "同一时刻按纽约时区仍是前一天");
  equal(getLocalDate("2028-02-29T01:00:00.000Z", "Asia/Shanghai"), "2028-02-29", "同一时刻按上海时区已经到开启日");
  equal(normalizeTimezone("Asia/Shanghai"), "Asia/Shanghai", "IANA 时区被规范化");
  equal(requireLocalDate("2028-02-29", "date"), "2028-02-29", "有效闰日被接受");
  throwsCode(() => requireLocalDate("2027-02-29", "date"), "CAPSULE_DATE_INVALID", "无效闰日被拒绝");
  throwsCode(() => requireLocalDate("2100-02-29", "date"), "CAPSULE_DATE_INVALID", "世纪年遵循公历闰年规则");
  throwsCode(() => normalizeTimezone("Mars/Olympus"), "CAPSULE_TIMEZONE_INVALID", "不存在的 IANA 时区被拒绝");
  throwsCode(() => normalizeTimezone("GMT+08:00"), "CAPSULE_TIMEZONE_INVALID", "固定偏移不能冒充 IANA 时区");
  throwsCode(() => getLocalDate("not-a-time", "UTC"), "CAPSULE_NOW_INVALID", "无效注入时间会失败关闭");
}

function checkSafeSnapshot() {
  const exhibition = publishedExhibition();
  const built = buildSafeSnapshot({
    exhibition,
    media: [{
      assetId: "media-safe",
      memoryId: "memory-a",
      itemId: "source-item-a",
      selected: true,
      status: "ready",
      position: 0,
      altText: "海边合照",
      caption: "只留下展示副本",
      variant: {
        kind: "display",
        mimeType: "image/webp",
        width: 1200,
        height: 800,
        byteSize: 1234,
        sha256: "f".repeat(64)
      }
    }],
    transcripts: [{
      assetId: "voice-confirmed",
      memoryId: "memory-a",
      itemId: "source-item-a",
      status: "confirmed",
      language: "zh-CN",
      text: "那天的海风很轻。"
    }]
  });

  ok(validateSafeSnapshot(built.snapshot), "由已发布展览生成的快照通过严格合同");
  deepEqual(built.snapshot.sections.map((section) => section.key), ["section-1"], "章节只使用匿名顺序键");
  deepEqual(built.snapshot.sections[0].items.map((item) => item.key), ["item-1", "item-2"], "展品只使用全局匿名顺序键");
  deepEqual(built.snapshot.sections[0].items[0].confirmedQuotes, ["海风吹过旧码头"], "只保留通过核验的引用文本");
  deepEqual(built.snapshot.sections[0].items[0].confirmedTranscripts, ["那天的海风很轻。"], "只保留用户明确选择的确认文字");
  deepEqual(built.mediaLinks, [{
    assetId: "media-safe",
    itemKey: "item-1",
    position: 0,
    altText: "海边合照",
    caption: "只留下展示副本"
  }], "图片内部 ID 被隔离在单独链接中并改写为匿名 itemKey");

  const snapshotJson = JSON.stringify(built.snapshot);
  for (const secret of [
    "memory-a", "source-item-a", "media-safe", "voice-confirmed", "raw private memory",
    "agent-run-secret", "https://original.invalid/photo.jpg", "f".repeat(64)
  ]) {
    ok(!snapshotJson.includes(secret), `安全快照物理排除内部值：${secret.slice(0, 24)}`);
  }
  ok(!snapshotJson.includes("startOffset") && !snapshotJson.includes("field"), "快照不保留引用偏移或来源字段");

  const forbiddenCases = [
    ["rawContent", "private"],
    ["memoryId", "memory-a"],
    ["entityId", "entity-a"],
    ["voiceAssetId", "voice-a"],
    ["mediaId", "media-a"],
    ["originalUrl", "https://original.invalid"],
    ["sha256", "a".repeat(64)],
    ["agentData", { run: "secret" }],
    ["draftTranscript", "draft"]
  ];
  forbiddenCases.forEach(([key, value]) => {
    const unsafe = structuredClone(built.snapshot);
    unsafe.sections[0].items[0][key] = value;
    throwsCode(() => validateSafeSnapshot(unsafe), "CAPSULE_SNAPSHOT_UNSAFE", `严格快照拒绝 ${key}`);
  });

  const nonAnonymous = structuredClone(built.snapshot);
  nonAnonymous.sections[0].items[0].key = "memory-a";
  throwsCode(() => validateSafeSnapshot(nonAnonymous), "CAPSULE_SNAPSHOT_KEY_INVALID", "快照拒绝来源 ID 充当展示键");

  throwsCode(
    () => buildSafeSnapshot({
      exhibition,
      transcripts: [{ assetId: "voice-draft", memoryId: "memory-a", status: "draft", text: "未确认" }]
    }),
    "CAPSULE_TRANSCRIPT_NOT_CONFIRMED",
    "builder 拒绝草稿文字稿"
  );
  const unsafeEvidence = publishedExhibition();
  unsafeEvidence.sections[0].items[0].citations[0].evidenceValid = false;
  throwsCode(
    () => buildSafeSnapshot({ exhibition: unsafeEvidence }),
    "CAPSULE_SOURCE_REVIEW_REQUIRED",
    "builder 拒绝含无效证据的来源展览"
  );
  const draft = publishedExhibition();
  draft.status = "draft";
  throwsCode(() => buildSafeSnapshot({ exhibition: draft }), "CAPSULE_SOURCE_NOT_PUBLISHED", "builder 拒绝草稿展览");
  const review = publishedExhibition();
  review.needsReview = true;
  throwsCode(() => buildSafeSnapshot({ exhibition: review }), "CAPSULE_SOURCE_REVIEW_REQUIRED", "builder 拒绝待复核展览");
}

function checkServiceFlow() {
  const fixture = createStoreFixture();
  const service = createCapsuleService({ store: fixture.store, now: () => fixture.clock.value });

  equal(fixture.payloadReads, 0, "初始没有读取胶囊 payload");
  const beforeList = service.listCapsuleShells();
  equal(fixture.payloadReads, 0, "列表只读取外壳，不接触 payload");
  equal(beforeList[0].available, false, "开启日前外壳标记为不可用");
  deepEqual(Object.keys(beforeList[0]).sort(), [
    "available", "ceremonialGate", "createdAt", "id", "needsReview", "opensOn",
    "shellMessage", "timezone", "title"
  ], "API 外壳只暴露九个允许字段");
  equal(beforeList[0].ceremonialGate, true, "公开外壳用布尔值明确存在仪式门槛");
  service.getCapsuleShell("capsule-existing");
  equal(fixture.payloadReads, 0, "单个外壳读取也不接触 payload");
  throwsCode(() => service.openCapsule("capsule-existing"), "CAPSULE_NOT_AVAILABLE", "开启日前只能看到外壳");
  equal(fixture.payloadReads, 0, "开启日前不会尝试读取 payload");

  fixture.clock.value = "2028-02-28T16:00:00.000Z";
  const opened = service.openCapsule("capsule-existing");
  equal(fixture.payloadReads, 1, "到本地开启日后才读取 payload");
  equal(opened.capsule.available, true, "开启日当天标记可用");
  ok(validateSafeSnapshot(opened.content.snapshot), "开启后仍对持久化快照重新校验");
  fixture.clock.value = "2028-02-29T16:00:00.000Z";
  equal(service.getCapsule("capsule-existing").available, true, "开启日之后保持可用");

  throwsCode(
    () => service.createCapsule({ exhibitionId: "exhibition-good", opensOn: "2029-01-01", timezone: "Asia/Shanghai" }),
    "CAPSULE_CONFIRMATION_REQUIRED",
    "创建需要 confirm:true"
  );
  throwsCode(
    () => service.createCapsule({
      confirm: true,
      exhibitionId: "exhibition-draft",
      opensOn: "2029-01-01",
      timezone: "Asia/Shanghai"
    }),
    "CAPSULE_SOURCE_NOT_PUBLISHED",
    "创建拒绝未发布来源"
  );
  throwsCode(
    () => service.createCapsule({
      confirm: true,
      exhibitionId: "exhibition-review",
      opensOn: "2029-01-01",
      timezone: "Asia/Shanghai"
    }),
    "CAPSULE_SOURCE_REVIEW_REQUIRED",
    "创建拒绝待复核来源"
  );
  throwsCode(
    () => service.createCapsule({
      confirm: true,
      exhibitionId: "exhibition-good",
      transcriptAssetIds: ["voice-draft"],
      opensOn: "2029-01-01",
      timezone: "Asia/Shanghai"
    }),
    "CAPSULE_TRANSCRIPT_NOT_CONFIRMED",
    "创建拒绝用户选择的草稿文字稿"
  );
  throwsCode(
    () => service.createCapsule({
      confirm: true,
      exhibitionId: "exhibition-good",
      mediaAssetIds: ["media-original-only"],
      opensOn: "2029-01-01",
      timezone: "Asia/Shanghai"
    }),
    "CAPSULE_MEDIA_REFERENCE_INVALID",
    "创建拒绝不属于展览成员的图片"
  );

  const created = service.createCapsule({
    confirm: true,
    exhibitionId: "exhibition-good",
    title: "给未来的一封展览",
    shellMessage: "等到那天，再慢慢打开。",
    opensOn: "2029-02-28",
    timezone: "Asia/Shanghai",
    transcriptAssetIds: ["voice-confirmed"],
    mediaAssetIds: ["media-safe"]
  });
  equal(created.title, "给未来的一封展览", "创建返回简洁外壳");
  equal(created.available, false, "未来日期的新胶囊不可用");
  equal(fixture.saved.confirm, true, "服务在校验用户确认后仍向数据库显式传递 confirm:true");
  equal(fixture.saved.ceremonialGate, CEREMONIAL_GATE, "内部持久化继续使用明确的 local-date-ritual 标记");
  equal(fixture.saved.sourceExhibitionId, "exhibition-good", "内部记录保留来源展览用于审计");
  deepEqual(fixture.saved.mediaLinks.map((link) => link.itemKey), ["item-1"], "图片关联被改写为匿名 itemKey");
  const savedJson = JSON.stringify(fixture.saved.snapshot);
  ok(!savedJson.includes("memory-a") && !savedJson.includes("voice-confirmed") && !savedJson.includes("media-safe"), "持久化快照不含任何附件或展品内部 ID");
  deepEqual(fixture.saved.snapshot.sections[0].items[0].confirmedTranscripts, ["确认后的口述"], "明确选择的确认文字稿进入安全快照");

  throwsCode(
    () => service.createCapsule({
      confirm: true,
      snapshot: fixture.saved.snapshot,
      opensOn: "2029-02-29",
      timezone: "Asia/Shanghai"
    }),
    "CAPSULE_DATE_INVALID",
    "创建拒绝不存在的开启日期"
  );
  throwsCode(
    () => service.createCapsule({
      confirm: true,
      snapshot: fixture.saved.snapshot,
      opensOn: "2029-02-28",
      timezone: "Bad/Timezone"
    }),
    "CAPSULE_TIMEZONE_INVALID",
    "创建拒绝无效时区"
  );
}

function createStoreFixture() {
  const exhibition = publishedExhibition();
  const records = [{
    id: "capsule-existing",
    title: "闰日胶囊",
    shellMessage: "等到闰日",
    opensOn: "2028-02-29",
    timezone: "Asia/Shanghai",
    ceremonialGate: CEREMONIAL_GATE,
    needsReview: false,
    createdAt: "2027-01-01T00:00:00.000Z"
  }];
  const initialPayload = buildSafeSnapshot({ exhibition }).snapshot;
  const payloads = new Map([["capsule-existing", { snapshot: initialPayload, mediaLinks: [] }]]);
  const fixture = {
    clock: { value: "2028-02-28T15:59:59.999Z" },
    payloadReads: 0,
    saved: null,
    store: null
  };
  fixture.store = {
    listCapsuleShells: () => records.map((record) => ({ ...record })),
    getCapsuleShell: (id) => records.find((record) => record.id === id) || null,
    getCapsulePayload: (id) => {
      fixture.payloadReads += 1;
      return payloads.get(id) || null;
    },
    createCapsuleRecord: (input) => {
      if (input.confirm !== true) throw new Error("test store requires confirmation");
      fixture.saved = structuredClone(input);
      const record = {
        id: input.id || "capsule-created",
        title: input.title,
        shellMessage: input.shellMessage,
        opensOn: input.opensOn,
        timezone: input.timezone,
        ceremonialGate: input.ceremonialGate,
        needsReview: input.needsReview,
        createdAt: "2028-03-01T00:00:00.000Z"
      };
      records.push(record);
      payloads.set(record.id, { snapshot: input.snapshot, mediaLinks: input.mediaLinks });
      return record;
    },
    deleteCapsule: (id) => {
      const index = records.findIndex((record) => record.id === id);
      if (index < 0) return false;
      records.splice(index, 1);
      payloads.delete(id);
      return true;
    },
    clearCapsules: () => ({ capsulesDeleted: records.splice(0).length }),
    getCapsuleStats: () => ({ capsules: records.length, payloads: payloads.size, mediaLinks: 0, needsReview: 0 }),
    getExhibition: (id) => {
      const value = structuredClone(exhibition);
      if (id === "exhibition-draft") value.status = "draft";
      if (id === "exhibition-review") value.needsReview = true;
      return id.startsWith("exhibition-") ? value : null;
    },
    listVoiceForMemory: (memoryId) => memoryId === "memory-a" ? [
      { assetId: "voice-confirmed", transcript: { status: "confirmed", text: "确认后的口述" } },
      { assetId: "voice-draft", transcript: { status: "draft", text: "尚未确认" } }
    ] : [],
    listMediaForMemory: (memoryId) => memoryId === "memory-a" ? [{
      assetId: "media-safe",
      altText: "海边",
      caption: "display only"
    }] : [],
    getMediaAsset: (id) => id === "media-safe" ? {
      id,
      status: "ready",
      variants: [{ kind: "display", mimeType: "image/webp", sha256: "a".repeat(64) }]
    } : id === "media-original-only" ? {
      id,
      status: "ready",
      variants: [{ kind: "original", mimeType: "image/jpeg" }]
    } : null
  };
  return fixture;
}

function publishedExhibition() {
  return {
    id: "exhibition-good",
    title: "海边与归途",
    theme: "重逢",
    opening: "两段经过确认的记忆。",
    status: "published",
    needsReview: false,
    requiresConfirmation: false,
    rawContent: "raw private memory",
    agentRunId: "agent-run-secret",
    sections: [{
      id: "source-section-a",
      title: "第一章",
      summary: "从海边开始。",
      items: [{
        id: "source-item-a",
        memoryId: "memory-a",
        title: "旧码头",
        excerpt: "海风与晚霞。",
        curatorNote: "只保留适合展示的叙事。",
        rawContent: "raw private memory",
        citations: [{
          id: "citation-secret",
          quote: "海风吹过旧码头",
          startOffset: 8,
          endOffset: 16,
          field: "rawContent",
          evidenceValid: true
        }]
      }, {
        id: "source-item-b",
        memoryId: "memory-b",
        title: "回程车票",
        excerpt: "夜里回家。",
        curatorNote: "第二件展品。",
        citations: [{
          id: "citation-secret-b",
          quote: "车灯照亮了站台",
          startOffset: 0,
          endOffset: 8,
          field: "rawContent",
          evidenceValid: true
        }]
      }]
    }]
  };
}

function ok(value, message) {
  assertions += 1;
  assert.ok(value, message);
}

function equal(actual, expected, message) {
  assertions += 1;
  assert.equal(actual, expected, message);
}

function deepEqual(actual, expected, message) {
  assertions += 1;
  assert.deepEqual(actual, expected, message);
}

function throwsCode(operation, expectedCode, message) {
  assertions += 1;
  assert.throws(operation, (error) => error?.code === expectedCode, message);
}
