"use strict";

const assert = require("node:assert/strict");
const { buildSafeSnapshot, validateSafeSnapshot } = require("../lib/capsule-service");
const { createCapsuleApi } = require("../lib/capsule-api");
const { createOfflineExhibitApi } = require("../lib/offline-exhibit-api");

const NOW = "2026-07-17T04:00:00.000Z";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_JPEG = "c".repeat(64);
const UNOPENED_HASH_CANARY = "f".repeat(64);
const CANARIES = Object.freeze({
  payload: "UNOPENED_PAYLOAD_CANARY_7F3E",
  member: "UNOPENED_MEMBER_CANARY_2A91",
  media: "UNOPENED_MEDIA_CANARY_8C44",
  draft: "DRAFT_TRANSCRIPT_CANARY_6D55",
  agent: "AGENT_LOG_CANARY_04BB",
  gps: "GPS_METADATA_CANARY_77CA",
  original: "ORIGINAL_URL_CANARY_12AF"
});

let assertions = 0;

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  checkFactoryContracts();
  await checkCapsuleShellAndGate();
  await checkCapsuleCreateAndDelete();
  await checkOfflineCandidatesAndMaterial();
  await checkOfflineCapsuleGate();
  console.log(`capsule-api-check: ${assertions} assertions passed`);
}

function checkFactoryContracts() {
  equal(typeof createCapsuleApi, "function", "capsule HTTP adapter exports a factory");
  equal(typeof createOfflineExhibitApi, "function", "offline exhibit HTTP adapter exports a factory");
  equal(createCapsuleApi.length, 0, "capsule factory uses one optional dependency object");
  equal(createOfflineExhibitApi.length, 0, "offline factory uses one optional dependency object");
}

async function checkCapsuleShellAndGate() {
  const fixture = createFixture();
  const api = createCapsuleApi(fixture.dependencies());

  const list = await api.handle(request("GET"), {}, url("/api/capsules"));
  equal(list.status, 200, "capsule list returns 200");
  deepEqual(
    Object.keys(list.payload.capsules[0]).sort(),
    ["available", "ceremonialGate", "createdAt", "id", "needsReview", "opensOn", "shellMessage", "timezone", "title"].sort(),
    "capsule list returns the exact public shell contract"
  );
  noCanaryLeak(list.payload, "capsule list never serializes payload, members, media, or hashes");
  equal(fixture.counters.payloadReads, 0, "capsule list never calls the payload getter");

  const item = await api.handle(request("GET"), {}, url("/api/capsules/future-capsule"));
  equal(item.status, 200, "capsule item shell returns 200");
  equal(item.payload.capsule.available, false, "future capsule shell is unavailable in its named timezone");
  equal(item.payload.capsule.ceremonialGate, true, "shell exposes the date gate as a boolean public capability");
  noCanaryLeak(item.payload, "single capsule shell never serializes private content");
  equal(fixture.counters.payloadReads, 0, "single shell GET never calls the payload getter");

  const gate = await api.handle(request("GET"), {}, url("/api/capsules/future-capsule/content"));
  equal(gate.status, 423, "unopened capsule content returns 423");
  deepEqual(Object.keys(gate.payload).sort(), ["capsule", "code", "error"], "423 returns exactly an error code and the public shell");
  equal(gate.payload.code, "CAPSULE_NOT_AVAILABLE", "423 exposes a stable non-secret error code");
  noCanaryLeak(gate.payload, "423 response has no payload/member/media/hash leakage");
  equal(fixture.counters.payloadReads, 0, "423 is decided before the payload getter is called");

  const review = await api.handle(request("GET"), {}, url("/api/capsules/review-capsule/content"));
  equal(review.status, 409, "review-required capsule content returns 409");
  deepEqual(Object.keys(review.payload).sort(), ["capsule", "code", "error"], "review gate returns only an error code and public shell");
  equal(review.payload.code, "CAPSULE_REVIEW_REQUIRED", "review gate exposes a stable code");
  noCanaryLeak(review.payload, "review gate has no payload/member/media/hash leakage");
  equal(fixture.counters.payloadReads, 0, "review gate is decided before the payload getter is called");

  const opened = await api.handle(request("GET"), {}, url("/api/capsules/open-capsule/content"));
  equal(opened.status, 200, "due capsule content returns 200");
  equal(fixture.counters.payloadReadsById.get("open-capsule"), 1, "due capsule calls its payload getter exactly once");
  ok(validateSafeSnapshot(opened.payload.content.snapshot), "opened content retains the strict safe snapshot contract");
  deepEqual(
    opened.payload.content.media.map((entry) => Object.keys(entry).sort()),
    opened.payload.content.media.map(() => ["altText", "byteSize", "caption", "contentUrl", "height", "itemKey", "key", "mimeType", "sha256", "width"].sort()),
    "opened media exposes only anonymous placement and transient display material"
  );
  ok(opened.payload.content.media.every((entry) => entry.contentUrl.endsWith("/display")), "opened content exposes display URLs only");
  ok(opened.payload.content.media.every((entry) => entry.width > 0 && entry.height > 0), "opened content exposes verified positive display dimensions");
  ok(!JSON.stringify(opened.payload.content.snapshot).includes("photo-a"), "safe snapshot physically excludes media asset IDs");
  ok(!JSON.stringify(opened.payload.content.snapshot).includes("memory-a"), "safe snapshot physically excludes member IDs");
  ok(!JSON.stringify(opened.payload.content.snapshot).includes(HASH_A), "safe snapshot physically excludes hashes");
  ok(!JSON.stringify(opened.payload.content.snapshot).includes(CANARIES.agent), "safe snapshot physically excludes agent material");
  ok(!JSON.stringify(opened.payload.content.snapshot).includes(CANARIES.draft), "safe snapshot physically excludes draft transcripts");

  await rejectsStatus(
    () => api.handle(request("GET"), {}, url("/api/capsules?include=payload")),
    400,
    "capsule routes reject query switches that could widen disclosure"
  );
  equal(await api.handle(request("GET"), {}, url("/api/not-capsules")), false, "unrelated paths fall through");
}

async function checkCapsuleCreateAndDelete() {
  const fixture = createFixture();
  const builderCalls = [];
  const api = createCapsuleApi(fixture.dependencies({
    buildSafeSnapshot(input) {
      builderCalls.push(structuredClone(input));
      return buildSafeSnapshot(input);
    }
  }));
  const body = validCreateBody();

  const beforeWrites = fixture.counters.writes;
  await rejectsStatus(
    () => api.handle(request("POST", { ...body, passphrase: "must-never-reach-server" }), {}, url("/api/capsules")),
    400,
    "capsule creation rejects passphrase as an unknown server field"
  );
  await rejectsStatus(
    () => api.handle(request("POST", { ...body, snapshot: { unsafe: true } }), {}, url("/api/capsules")),
    400,
    "capsule creation rejects client-supplied snapshots"
  );
  await rejectsStatus(
    () => api.handle(request("POST", { ...body, confirm: false }), {}, url("/api/capsules")),
    400,
    "capsule creation requires explicit confirmation"
  );
  equal(fixture.counters.writes, beforeWrites, "invalid and passphrase-bearing requests perform zero writes");
  equal(builderCalls.length, 0, "invalid request bodies never reach the snapshot builder");

  await rejectsStatus(
    () => api.handle(request("POST", { ...body, exhibitionId: "draft-exhibition" }), {}, url("/api/capsules")),
    409,
    "draft exhibitions cannot be capsule sources"
  );
  await rejectsStatus(
    () => api.handle(request("POST", { ...body, exhibitionId: "review-exhibition" }), {}, url("/api/capsules")),
    409,
    "review-required exhibitions cannot be capsule sources"
  );
  await rejectsStatus(
    () => api.handle(request("POST", { ...body, mediaAssetIds: ["photo-original-only"] }), {}, url("/api/capsules")),
    400,
    "an original-only member image cannot be selected"
  );
  await rejectsStatus(
    () => api.handle(request("POST", { ...body, mediaAssetIds: ["photo-jpeg-display"] }), {}, url("/api/capsules")),
    400,
    "a non-WebP display variant cannot be selected"
  );
  await rejectsStatus(
    () => api.handle(request("POST", { ...body, mediaAssetIds: ["photo-outside"] }), {}, url("/api/capsules")),
    400,
    "a non-member image cannot be selected"
  );
  await rejectsStatus(
    () => api.handle(request("POST", { ...body, transcriptAssetIds: ["voice-draft"] }), {}, url("/api/capsules")),
    400,
    "a draft transcript cannot be selected"
  );
  await rejectsStatus(
    () => api.handle(request("POST", { ...body, transcriptAssetIds: ["voice-outside"] }), {}, url("/api/capsules")),
    400,
    "a non-member transcript cannot be selected"
  );
  equal(fixture.counters.writes, beforeWrites, "source and selection failures perform zero writes");

  const created = await api.handle(request("POST", body), {}, url("/api/capsules"));
  equal(created.status, 201, "valid confirmed capsule creation returns 201");
  equal(builderCalls.length, 1, "valid creation builds one server-side safe snapshot");
  deepEqual(builderCalls[0].media.map((entry) => entry.assetId), ["photo-a"], "builder receives only explicitly selected member display media");
  deepEqual(builderCalls[0].transcripts.map((entry) => entry.assetId), ["voice-a"], "builder receives only explicitly selected confirmed transcripts");
  equal(fixture.counters.writes, beforeWrites + 1, "valid capsule creation performs one persistent write");
  equal(fixture.createdInput.exhibitionId, "published-exhibition", "server records the verified source exhibition");
  ok(validateSafeSnapshot(fixture.createdInput.snapshot), "only a validated safe snapshot reaches persistence");
  deepEqual(fixture.createdInput.mediaLinks.map((entry) => entry.assetId), ["photo-a"], "persistence receives only selected internal media links");
  ok(!JSON.stringify(fixture.createdInput.snapshot).includes("voice-a"), "confirmed transcript asset ID is discarded before persistence");
  ok(JSON.stringify(fixture.createdInput.snapshot).includes("CONFIRMED_TRANSCRIPT_A"), "confirmed transcript text is retained in the anonymous snapshot");
  ok(JSON.stringify(fixture.createdInput.snapshot).includes("SAFE_QUOTE_A"), "evidence-valid quote text is retained without citation offsets or IDs");
  ok(!JSON.stringify(fixture.createdInput.snapshot).includes("citation-a"), "citation IDs are discarded before persistence");
  deepEqual(
    Object.keys(created.payload.capsule).sort(),
    ["available", "ceremonialGate", "createdAt", "id", "needsReview", "opensOn", "shellMessage", "timezone", "title"].sort(),
    "create response returns a shell rather than persisted content"
  );

  const removed = await api.handle(request("DELETE"), {}, url("/api/capsules/open-capsule"));
  equal(removed.status, 200, "capsule DELETE returns 200");
  equal(fixture.counters.deletes, 1, "capsule DELETE performs exactly one delete");
  await rejectsStatus(
    () => api.handle(request("DELETE"), {}, url("/api/capsules/missing-capsule")),
    404,
    "deleting a missing capsule returns 404"
  );

  const demoReads = fixture.counters.readJson;
  const demoWrites = fixture.counters.writes;
  const demoDeletes = fixture.counters.deletes;
  const demoApi = createCapsuleApi(fixture.dependencies({ interviewDemo: true }));
  const demoList = await demoApi.handle(request("GET"), {}, url("/api/capsules"));
  equal(demoList.status, 200, "Demo may read capsule shells");
  await rejectsStatus(
    () => demoApi.handle(request("POST", body), {}, url("/api/capsules")),
    403,
    "Demo rejects capsule creation"
  );
  await rejectsStatus(
    () => demoApi.handle(request("DELETE"), {}, url("/api/capsules/open-capsule")),
    403,
    "Demo rejects capsule deletion"
  );
  equal(fixture.counters.readJson, demoReads, "Demo rejects writes before reading their bodies");
  equal(fixture.counters.writes, demoWrites, "Demo capsule creation performs zero writes");
  equal(fixture.counters.deletes, demoDeletes, "Demo capsule deletion performs zero writes");
}

async function checkOfflineCandidatesAndMaterial() {
  const fixture = createFixture();
  const offline = createOfflineExhibitApi(fixture.dependencies());

  const candidates = await offline.handle(
    request("GET"),
    {},
    url("/api/offline-exhibits/candidates?exhibitionId=published-exhibition")
  );
  equal(candidates.status, 200, "offline candidates return 200");
  deepEqual(candidates.payload.media.map((entry) => entry.assetId), ["photo-a", "photo-b"], "candidate media contains only member display-WebP assets");
  deepEqual(candidates.payload.transcripts.map((entry) => entry.assetId), ["voice-a", "voice-b"], "candidate transcripts contain only confirmed member transcripts");
  ok(candidates.payload.media.every((entry) => entry.mimeType === "image/webp"), "every media checkbox candidate is a display WebP");
  ok(candidates.payload.transcripts.every((entry) => entry.confirmed === true), "every transcript checkbox candidate is confirmed");
  const candidateJson = JSON.stringify(candidates.payload);
  ok(!candidateJson.includes("photo-original-only") && !candidateJson.includes("photo-jpeg-display"), "original-only and non-WebP assets are absent from candidates");
  ok(!candidateJson.includes("photo-outside") && !candidateJson.includes("voice-outside"), "non-member attachments are absent from candidates");
  ok(!candidateJson.includes(CANARIES.draft), "draft transcript text is physically absent from candidates");
  ok(!candidateJson.includes(CANARIES.gps), "EXIF/GPS metadata is physically absent from candidates");
  ok(!candidateJson.includes(CANARIES.original), "original image URLs are physically absent from candidates");

  await rejectsStatus(
    () => offline.handle(request("GET"), {}, url("/api/offline-exhibits/candidates?exhibitionId=published-exhibition&include=all")),
    400,
    "candidate endpoint rejects disclosure-widening query keys"
  );
  await rejectsStatus(
    () => offline.handle(request("GET"), {}, url("/api/offline-exhibits/candidates?exhibitionId=published-exhibition&exhibitionId=review-exhibition")),
    400,
    "candidate endpoint rejects duplicate source IDs"
  );

  const materialBody = {
    sourceType: "exhibition",
    sourceId: "published-exhibition",
    mediaAssetIds: ["photo-a"],
    transcriptAssetIds: ["voice-a"],
    confirm: true
  };
  const writesBefore = fixture.counters.writes;
  await rejectsStatus(
    () => offline.handle(request("POST", { ...materialBody, passphrase: "never-upload" }), {}, url("/api/offline-exhibits/material")),
    400,
    "offline material rejects passphrase as an unknown field"
  );
  await rejectsStatus(
    () => offline.handle(request("POST", { ...materialBody, sourceType: "memory" }), {}, url("/api/offline-exhibits/material")),
    400,
    "offline material rejects unsupported source types"
  );
  await rejectsStatus(
    () => offline.handle(request("POST", { ...materialBody, mediaAssetIds: ["photo-b", "photo-b"] }), {}, url("/api/offline-exhibits/material")),
    400,
    "offline material rejects duplicate selections"
  );
  await rejectsStatus(
    () => offline.handle(request("POST", { ...materialBody, transcriptAssetIds: ["voice-draft"] }), {}, url("/api/offline-exhibits/material")),
    400,
    "offline material rejects draft transcript selection"
  );
  equal(fixture.counters.writes, writesBefore, "invalid offline material requests perform zero writes");

  const material = await offline.handle(request("POST", materialBody), {}, url("/api/offline-exhibits/material"));
  equal(material.status, 200, "valid exhibition material returns 200");
  deepEqual(Object.keys(material.payload.material).sort(), ["media", "snapshot"], "exhibition material has the exact transient top-level shape");
  ok(validateSafeSnapshot(material.payload.material.snapshot), "offline material contains a strict anonymous safe snapshot");
  equal(material.payload.material.media.length, 1, "offline material includes only explicitly selected media");
  deepEqual(
    Object.keys(material.payload.material.media[0]).sort(),
    ["altText", "byteSize", "caption", "contentUrl", "height", "itemKey", "key", "mimeType", "sha256", "width"].sort(),
    "transient media exposes exactly the browser fetch/integrity fields"
  );
  ok(material.payload.material.media[0].contentUrl === "/api/media/photo-a/display", "material exposes only the selected display content URL");
  ok(material.payload.material.media[0].width > 0 && material.payload.material.media[0].height > 0, "material includes positive display dimensions for browser validation");
  ok(!Object.hasOwn(material.payload.material.media[0], "assetId"), "transient media never exposes an assetId property");
  const snapshotJson = JSON.stringify(material.payload.material.snapshot);
  ok(!snapshotJson.includes("published-exhibition") && !snapshotJson.includes("memory-a") && !snapshotJson.includes("photo-a"), "offline snapshot contains no source, member, or media IDs");
  ok(!snapshotJson.includes(HASH_A) && !snapshotJson.includes(CANARIES.gps), "offline snapshot contains no hash or metadata");
  ok(!snapshotJson.includes(CANARIES.draft) && !snapshotJson.includes(CANARIES.agent), "offline snapshot contains no draft text or agent logs");
  ok(snapshotJson.includes("CONFIRMED_TRANSCRIPT_A"), "offline snapshot contains the selected confirmed transcript text");
  ok(snapshotJson.includes("SAFE_QUOTE_A"), "offline snapshot contains only display-safe confirmed quote text");
  ok(!snapshotJson.includes("citation-a") && !snapshotJson.includes("startOffset"), "offline snapshot drops citation IDs and offsets");
  equal(fixture.counters.writes, writesBefore, "offline material generation is a zero-write read operation");

  const demoOffline = createOfflineExhibitApi(fixture.dependencies({ interviewDemo: true }));
  const demoCandidates = await demoOffline.handle(
    request("GET"),
    {},
    url("/api/offline-exhibits/candidates?exhibitionId=published-exhibition")
  );
  const demoMaterial = await demoOffline.handle(request("POST", materialBody), {}, url("/api/offline-exhibits/material"));
  equal(demoCandidates.status, 200, "Demo may read safe offline candidates");
  equal(demoMaterial.status, 200, "Demo may build transient safe material without persistence");
  equal(fixture.counters.writes, writesBefore, "Demo offline workflow performs zero writes");
}

async function checkOfflineCapsuleGate() {
  const fixture = createFixture();
  const offline = createOfflineExhibitApi(fixture.dependencies());
  const futureReads = fixture.counters.payloadReadsById.get("future-capsule") || 0;
  const error = await rejectsStatus(
    () => offline.handle(
      request("POST", {
        sourceType: "capsule",
        sourceId: "future-capsule",
        mediaAssetIds: [],
        transcriptAssetIds: [],
        confirm: true
      }),
      {},
      url("/api/offline-exhibits/material")
    ),
    423,
    "unopened capsule cannot produce offline material"
  );
  equal(fixture.counters.payloadReadsById.get("future-capsule") || 0, futureReads, "offline 423 never calls the capsule payload getter");
  noCanaryLeak({ message: error.message, code: error.code }, "offline 423 contains no payload/member/media/hash canary");

  const reviewReads = fixture.counters.payloadReadsById.get("review-capsule") || 0;
  const reviewError = await rejectsStatus(
    () => offline.handle(
      request("POST", {
        sourceType: "capsule",
        sourceId: "review-capsule",
        mediaAssetIds: [],
        transcriptAssetIds: [],
        confirm: true
      }),
      {},
      url("/api/offline-exhibits/material")
    ),
    409,
    "review-required capsule cannot produce offline material"
  );
  equal(reviewError.code, "CAPSULE_REVIEW_REQUIRED", "offline review gate exposes a stable code");
  equal(fixture.counters.payloadReadsById.get("review-capsule") || 0, reviewReads, "offline review gate never calls the payload getter");
  noCanaryLeak({ message: reviewError.message, code: reviewError.code }, "offline review gate contains no payload/member/media/hash canary");

  await rejectsStatus(
    () => offline.handle(
      request("POST", {
        sourceType: "capsule",
        sourceId: "open-capsule",
        mediaAssetIds: ["photo-a"],
        transcriptAssetIds: ["voice-a"],
        confirm: true
      }),
      {},
      url("/api/offline-exhibits/material")
    ),
    400,
    "capsule export rejects transcript IDs because they were physically discarded at sealing"
  );

  const opened = await offline.handle(
    request("POST", {
      sourceType: "capsule",
      sourceId: "open-capsule",
      mediaAssetIds: ["photo-a"],
      transcriptAssetIds: [],
      confirm: true
    }),
    {},
    url("/api/offline-exhibits/material")
  );
  equal(opened.status, 200, "opened capsule can produce offline material");
  deepEqual(Object.keys(opened.payload.material).sort(), ["media", "shell", "snapshot"], "capsule material adds only a public shell to transient material");
  equal(opened.payload.material.media.length, 1, "capsule material enforces explicit media subset selection");
  ok(opened.payload.material.media[0].contentUrl.includes("photo-a") && !JSON.stringify(opened.payload.material.media).includes("photo-b"), "capsule material excludes unselected media");
  ok(!JSON.stringify(opened.payload.material.snapshot).includes("photo-a"), "capsule material keeps asset IDs outside its immutable snapshot");
  ok(validateSafeSnapshot(opened.payload.material.snapshot), "capsule-derived offline snapshot remains valid");

  await rejectsStatus(
    () => offline.handle(
      request("POST", {
        sourceType: "capsule",
        sourceId: "open-capsule",
        mediaAssetIds: ["photo-outside"],
        transcriptAssetIds: [],
        confirm: true
      }),
      {},
      url("/api/offline-exhibits/material")
    ),
    400,
    "capsule material rejects media outside its sealed selection"
  );
  equal(await offline.handle(request("GET"), {}, url("/api/offline-exhibits/unknown")), false, "unknown offline paths fall through");
}

function createFixture() {
  const exhibitions = new Map();
  const published = exhibition("published-exhibition", "published", false);
  exhibitions.set(published.id, published);
  exhibitions.set("draft-exhibition", { ...exhibition("draft-exhibition", "draft", false) });
  exhibitions.set("review-exhibition", { ...exhibition("review-exhibition", "published", true) });

  const assets = new Map([
    ["photo-a", mediaAsset("photo-a", HASH_A)],
    ["photo-b", mediaAsset("photo-b", HASH_B)],
    ["photo-outside", mediaAsset("photo-outside", "d".repeat(64))],
    ["photo-original-only", {
      ...mediaAsset("photo-original-only", "e".repeat(64)),
      variants: [{ kind: "original", mimeType: "image/jpeg", byteSize: 999, sha256: "e".repeat(64) }]
    }],
    ["photo-jpeg-display", {
      ...mediaAsset("photo-jpeg-display", HASH_JPEG),
      variants: [{ kind: "display", mimeType: "image/jpeg", byteSize: 444, sha256: HASH_JPEG }]
    }]
  ]);
  const mediaByMemory = new Map([
    ["memory-a", [
      mediaLink("memory-a", "photo-a", assets, 0),
      mediaLink("memory-a", "photo-original-only", assets, 1),
      mediaLink("memory-a", "photo-jpeg-display", assets, 2)
    ]],
    ["memory-b", [mediaLink("memory-b", "photo-b", assets, 0)]],
    ["memory-outside", [mediaLink("memory-outside", "photo-outside", assets, 0)]]
  ]);
  const voicesByMemory = new Map([
    ["memory-a", [
      voice("memory-a", "voice-a", "confirmed", "CONFIRMED_TRANSCRIPT_A"),
      voice("memory-a", "voice-draft", "draft", CANARIES.draft)
    ]],
    ["memory-b", [voice("memory-b", "voice-b", "confirmed", "CONFIRMED_TRANSCRIPT_B")]],
    ["memory-outside", [voice("memory-outside", "voice-outside", "confirmed", "OUTSIDE_TRANSCRIPT_CANARY")]]
  ]);
  const openedBuilt = buildSafeSnapshot({
    exhibition: published,
    media: [displaySelection(mediaByMemory.get("memory-a")[0], "item-a")],
    transcripts: [{ assetId: "voice-a", memoryId: "memory-a", itemId: "item-a", text: "CONFIRMED_TRANSCRIPT_A", status: "confirmed" }]
  });
  const openedWithTwoMedia = buildSafeSnapshot({
    exhibition: published,
    media: [
      displaySelection(mediaByMemory.get("memory-a")[0], "item-a"),
      displaySelection(mediaByMemory.get("memory-b")[0], "item-b")
    ],
    transcripts: [{ assetId: "voice-a", memoryId: "memory-a", itemId: "item-a", text: "CONFIRMED_TRANSCRIPT_A", status: "confirmed" }]
  });

  const shells = new Map([
    ["future-capsule", shell("future-capsule", "2099-01-01")],
    ["open-capsule", shell("open-capsule", "2026-07-17")],
    ["review-capsule", { ...shell("review-capsule", "2026-07-17"), needsReview: true }]
  ]);
  shells.get("future-capsule").payload = CANARIES.payload;
  shells.get("future-capsule").memberIds = [CANARIES.member];
  shells.get("future-capsule").mediaLinks = [{ assetId: CANARIES.media, sha256: UNOPENED_HASH_CANARY }];
  const payloads = new Map([
    ["future-capsule", {
      snapshot: { title: CANARIES.payload, sections: [{ items: [{ memoryId: CANARIES.member }] }] },
      mediaLinks: [{ assetId: CANARIES.media, sha256: UNOPENED_HASH_CANARY }]
    }],
    ["open-capsule", {
      ...openedWithTwoMedia,
      privatePayloadCanary: CANARIES.payload,
      agentLog: CANARIES.agent
    }],
    ["review-capsule", {
      ...openedBuilt,
      privatePayloadCanary: CANARIES.payload,
      memberCanary: CANARIES.member,
      hashCanary: UNOPENED_HASH_CANARY
    }]
  ]);
  const counters = {
    payloadReads: 0,
    payloadReadsById: new Map(),
    readJson: 0,
    writes: 0,
    deletes: 0
  };
  let createdInput = null;
  const database = {
    listCapsuleShells() {
      return [...shells.values()];
    },
    getCapsuleShell(id) {
      return shells.get(id) || null;
    },
    getCapsulePayload(id) {
      counters.payloadReads += 1;
      counters.payloadReadsById.set(id, (counters.payloadReadsById.get(id) || 0) + 1);
      return payloads.get(id) || null;
    },
    createCapsule(input) {
      counters.writes += 1;
      createdInput = structuredClone(input);
      const created = shell("created-capsule", input.opensOn, input.title, input.shellMessage, input.timezone);
      shells.set(created.id, created);
      payloads.set(created.id, { snapshot: input.snapshot, mediaLinks: input.mediaLinks });
      return created;
    },
    deleteCapsule(id) {
      counters.deletes += 1;
      if (!shells.has(id)) return false;
      shells.delete(id);
      payloads.delete(id);
      return true;
    }
  };
  const store = {
    getExhibition(id) {
      return exhibitions.get(id) || null;
    },
    listMediaForMemory(memoryId) {
      return mediaByMemory.get(memoryId) || [];
    },
    getMediaAsset(assetId) {
      return assets.get(assetId) || null;
    },
    listVoiceForMemory(memoryId) {
      return voicesByMemory.get(memoryId) || [];
    }
  };
  const fixture = {
    counters,
    database,
    store,
    get createdInput() { return createdInput; },
    dependencies(overrides = {}) {
      return {
        database,
        store,
        buildSafeSnapshot,
        sendJson: (_response, status, payload) => ({ status, payload }),
        readJsonBody: async (incoming) => {
          counters.readJson += 1;
          return incoming.body;
        },
        httpError,
        now: () => NOW,
        ...overrides
      };
    }
  };
  // Keep one payload variable referenced to prove fixtures are valid and not
  // accidentally optimized into a shell-only test.
  ok(validateSafeSnapshot(openedBuilt.snapshot), "fixture safe snapshot is valid");
  return fixture;
}

function exhibition(id, status, needsReview) {
  return {
    id,
    title: "A reviewed exhibition",
    theme: "Remembered journeys",
    opening: "A deliberately reviewed opening.",
    status,
    needsReview,
    requiresConfirmation: needsReview,
    sections: [{
      id: `section-${id}`,
      title: "First chapter",
      summary: "A safe summary.",
      items: [
        {
          id: "item-a",
          memoryId: "memory-a",
          title: "First memory",
          excerpt: "Selected exhibit excerpt A.",
          curatorNote: "Reviewed note A.",
          citations: [{
            id: "citation-a",
            quote: "SAFE_QUOTE_A",
            startOffset: 12,
            endOffset: 24,
            field: "rawContent",
            evidenceValid: true
          }]
        },
        {
          id: "item-b",
          memoryId: "memory-b",
          title: "Second memory",
          excerpt: "Selected exhibit excerpt B.",
          curatorNote: "Reviewed note B.",
          citations: [{
            id: "citation-b",
            quote: "SAFE_QUOTE_B",
            startOffset: 30,
            endOffset: 42,
            field: "rawContent",
            evidenceValid: true
          }]
        }
      ]
    }],
    rawContent: "UNSELECTED_RAW_MEMORY_CANARY",
    agentRun: CANARIES.agent
  };
}

function mediaAsset(id, sha256) {
  return {
    id,
    status: "ready",
    originalName: `${CANARIES.original}-${id}.jpg`,
    safeMetadata: { gps: CANARIES.gps },
    variants: [{
      assetId: id,
      kind: "display",
      mimeType: "image/webp",
      byteSize: id === "photo-b" ? 222 : 111,
      width: 1280,
      height: 960,
      sha256,
      storageKey: `private/${id}/display.webp`
    }, {
      assetId: id,
      kind: "original",
      mimeType: "image/jpeg",
      byteSize: 9999,
      sha256: "9".repeat(64),
      storageKey: `private/${id}/original.jpg`
    }]
  };
}

function mediaLink(memoryId, assetId, assets, position) {
  const asset = assets.get(assetId);
  return {
    memoryId,
    assetId,
    position,
    caption: `Caption ${assetId}`,
    altText: `Alt ${assetId}`,
    backNote: "PRIVATE_BACK_NOTE_CANARY",
    metadata: { gps: CANARIES.gps },
    asset,
    variants: asset.variants
  };
}

function displaySelection(link, itemId) {
  return {
    assetId: link.assetId,
    memoryId: link.memoryId,
    itemId,
    position: link.position,
    selected: true,
    status: "ready",
    caption: link.caption,
    altText: link.altText,
    variant: link.variants.find((entry) => entry.kind === "display")
  };
}

function voice(memoryId, assetId, status, text) {
  return {
    memoryId,
    assetId,
    label: `Voice ${assetId}`,
    asset: { id: assetId, status: "ready", storageKey: `private/${assetId}.webm` },
    transcript: {
      memoryId,
      assetId,
      text,
      language: "zh-CN",
      source: "manual",
      status,
      confirmed: status === "confirmed",
      agentData: CANARIES.agent
    }
  };
}

function shell(id, opensOn, title = `Capsule ${id}`, shellMessage = "Open when the day arrives.", timezone = "Asia/Shanghai") {
  return {
    id,
    title,
    shellMessage,
    opensOn,
    timezone,
    ceremonialGate: "local-date-ritual",
    needsReview: false,
    createdAt: "2026-07-16T00:00:00.000Z"
  };
}

function validCreateBody() {
  return {
    exhibitionId: "published-exhibition",
    title: "A future reunion",
    shellMessage: "See you on that day.",
    opensOn: "2027-07-17",
    timezone: "Asia/Shanghai",
    mediaAssetIds: ["photo-a"],
    transcriptAssetIds: ["voice-a"],
    confirm: true
  };
}

function request(method, body) {
  return { method, body };
}

function url(pathname) {
  return new URL(pathname, "http://127.0.0.1");
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function noCanaryLeak(value, message) {
  const serialized = JSON.stringify(value);
  ok(!serialized.includes(CANARIES.payload), `${message}: payload canary`);
  ok(!serialized.includes(CANARIES.member), `${message}: member canary`);
  ok(!serialized.includes(CANARIES.media), `${message}: media canary`);
  ok(!serialized.includes(UNOPENED_HASH_CANARY), `${message}: hash canary`);
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

async function rejectsStatus(operation, expectedStatus, message) {
  assertions += 1;
  let caught;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `${message}: expected rejection`);
  assert.equal(caught.statusCode, expectedStatus, `${message}: status`);
  return caught;
}
