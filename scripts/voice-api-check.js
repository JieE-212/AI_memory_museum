"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Readable, Writable } = require("node:stream");
const {
  MAX_VOICE_BYTES,
  MAX_VOICE_DURATION_MS,
  MAX_VOICES_PER_MEMORY,
  createVoiceApi,
  parseSingleByteRange
} = require("../lib/voice-api");

let assertions = 0;

async function main() {
  await checkConstructionAndRouting();
  await checkUploadsAndValidation();
  await checkContentAndRanges();
  await checkMemoryLinksAndTranscripts();
  await checkAssetDeletionAndMaintenance();
  await checkDemoZeroWrites();
  console.log(`Voice API checks passed: ${assertions} assertions.`);
}

async function checkConstructionAndRouting() {
  const harness = createHarness();
  throws(() => createVoiceApi({}), /\u4f9d\u8d56\u4e0d\u5b8c\u6574/u, "missing dependencies rejected");
  check(harness.api.isRawVoiceRequest({ method: "POST" }, url("/api/voice/uploads")), "upload is raw voice request");
  equal(harness.api.isRawVoiceRequest({ method: "PUT" }, url("/api/voice/uploads")), false, "PUT is not raw upload");
  equal(harness.api.isRawVoiceRequest({ method: "POST" }, url("/api/voice/assets/a")), false, "asset route is not raw upload");
  equal(await harness.api.handle(request("GET"), response(), url("/api/not-voice")), false, "unrelated route is ignored");
  await rejectsStatus(() => harness.call("GET", "/api/voice/uploads"), 405, "upload method locked");
  await rejectsStatus(() => harness.call("POST", "/api/memories/memory-1/voices"), 405, "voice list method locked");
  deepEqual(parseSingleByteRange("bytes=0-2", 10), { start: 0, end: 2 }, "closed range parsed");
  deepEqual(parseSingleByteRange("bytes=8-", 10), { start: 8, end: 9 }, "open range parsed");
  deepEqual(parseSingleByteRange("bytes=-4", 10), { start: 6, end: 9 }, "suffix range parsed");
  equal(parseSingleByteRange("bytes=10-", 10), null, "out of bounds range rejected");
  equal(parseSingleByteRange("bytes=1-2,4-5", 10), null, "multiple ranges rejected");
  equal(MAX_VOICE_BYTES, 12 * 1024 * 1024, "12 MiB policy shared");
  equal(MAX_VOICE_DURATION_MS, 180_000, "three minute policy shared");
  equal(MAX_VOICES_PER_MEMORY, 3, "three voices per memory policy shared");
}

async function checkUploadsAndValidation() {
  const harness = createHarness();
  const first = await harness.upload(Buffer.from("webm-opus-one"), "first memory.webm", "audio/webm");
  equal(first.statusCode, 201, "new upload returns 201");
  equal(first.payload.deduplicated, false, "new upload is not deduplicated");
  equal(first.payload.asset.mimeType, "audio/webm", "public asset exposes MIME");
  equal(first.payload.asset.codec, "opus", "public asset exposes codec");
  check(first.payload.asset.contentUrl.endsWith("/content"), "public asset exposes private content URL");
  equal(hasKeyDeep(first.payload, "storageKey"), false, "upload response never exposes storageKey");
  equal(harness.store.assets.size, 1, "new upload creates one asset row");
  equal(harness.storage.files.size, 1, "new upload materializes one file");
  equal(harness.storage.stages.size, 0, "successful upload leaves no staging tombstone");

  const duplicate = await harness.upload(Buffer.from("webm-opus-one"), "renamed.webm", "audio/webm");
  equal(duplicate.statusCode, 200, "duplicate upload returns 200");
  equal(duplicate.payload.deduplicated, true, "duplicate is explicitly reported");
  equal(duplicate.payload.asset.id, first.payload.asset.id, "duplicate reuses asset ID");
  equal(harness.store.assets.size, 1, "duplicate does not create row");
  equal(harness.storage.files.size, 1, "duplicate does not create file");

  const mp4 = await harness.upload(Buffer.from("mp4-aac-two"), "memo.m4a", "audio/mp4; codecs=mp4a.40.2");
  equal(mp4.statusCode, 201, "MP4/AAC upload accepted");
  equal(mp4.payload.asset.codec, "aac", "MP4 asset reports AAC");
  equal((await harness.upload(Buffer.from("mp4-aac-alias"), "alias.m4a", "audio/x-m4a")).statusCode, 201, "M4A MIME alias reaches real-byte validation");
  equal((await harness.upload(Buffer.from("webm-opus-generic"), "generic.webm", "application/octet-stream")).statusCode, 201, "generic binary MIME reaches real-byte validation");

  const beginBefore = harness.storage.calls.beginUpload;
  await rejectsStatus(() => harness.callRaw("POST", "/api/voice/uploads", Buffer.from("x"), {
    "content-type": "audio/webm"
  }), 400, "filename required");
  equal(harness.storage.calls.beginUpload, beginBefore, "missing filename rejected before storage");
  await rejectsStatus(() => harness.callRaw("POST", "/api/voice/uploads?filename=a.webm&filename=b.webm", Buffer.from("x"), {
    "content-type": "audio/webm"
  }), 400, "duplicate filename query rejected");
  await rejectsStatus(() => harness.callRaw("POST", "/api/voice/uploads?filename=a.webm&extra=1", Buffer.from("x"), {
    "content-type": "audio/webm"
  }), 400, "unknown upload query rejected");
  await rejectsStatus(() => harness.callRaw("POST", "/api/voice/uploads?filename=a.wav", Buffer.from("x"), {
    "content-type": "audio/wav"
  }), 415, "unsupported MIME rejected");
  equal(harness.storage.calls.beginUpload, beginBefore, "invalid upload metadata never reaches storage");
  await rejectsStatus(() => harness.callRaw("POST", "/api/voice/uploads?filename=a.webm", Buffer.from("x"), {
    "content-type": "audio/webm",
    "content-length": String(MAX_VOICE_BYTES + 1)
  }), 413, "declared oversize rejected");
  await rejectsStatus(() => harness.callRaw("POST", "/api/voice/uploads?filename=a.webm", Buffer.from("x"), {
    "content-type": "audio/webm",
    "content-length": "0"
  }), 400, "declared empty file rejected");
  await rejectsStatus(() => harness.callRaw("POST", "/api/voice/uploads?filename=a.webm", Buffer.from("x"), {
    "content-type": "audio/webm",
    "content-length": "wat"
  }), 400, "malformed content length rejected");

  harness.storage.nextBeginError = Object.assign(new Error("container mismatch"), { code: "VOICE_FORMAT_UNSUPPORTED" });
  await rejectsStatus(() => harness.upload(Buffer.from("bad"), "bad.webm", "audio/webm"), 415, "storage format errors normalized");
  equal(harness.storage.stages.size, 0, "failed upload leaves no stage");
}

async function checkContentAndRanges() {
  const harness = createHarness();
  const seeded = harness.seedAsset("asset-range", Buffer.from("0123456789"));

  let result = await harness.call("GET", `/api/voice/assets/${seeded.id}/content`);
  equal(result.statusCode, 200, "full content returns 200");
  equal(result.body.toString(), "0123456789", "full content bytes preserved");
  equal(result.getHeader("content-type"), "audio/webm", "content MIME set");
  equal(result.getHeader("accept-ranges"), "bytes", "byte ranges advertised");
  equal(result.getHeader("cache-control"), "private, no-store", "voice content never publicly cached");
  check(/^"sha256-/u.test(result.getHeader("etag")), "content has strong hash ETag");

  const openBeforeHead = harness.storage.calls.open;
  result = await harness.call("HEAD", `/api/voice/assets/${seeded.id}/content`);
  equal(result.statusCode, 200, "HEAD returns 200");
  equal(result.body.length, 0, "HEAD has no body");
  equal(result.getHeader("content-length"), "10", "HEAD reports total length");
  equal(harness.storage.calls.open, openBeforeHead, "HEAD does not open stream");

  result = await harness.call("GET", `/api/voice/assets/${seeded.id}/content`, { headers: { range: "bytes=2-5" } });
  equal(result.statusCode, 206, "closed range returns 206");
  equal(result.body.toString(), "2345", "closed range bytes exact");
  equal(result.getHeader("content-range"), "bytes 2-5/10", "closed Content-Range exact");
  equal(result.getHeader("content-length"), "4", "closed range length exact");

  result = await harness.call("GET", `/api/voice/assets/${seeded.id}/content`, { headers: { range: "bytes=-3" } });
  equal(result.body.toString(), "789", "suffix range exact");
  result = await harness.call("GET", `/api/voice/assets/${seeded.id}/content`, { headers: { range: "bytes=7-99" } });
  equal(result.body.toString(), "789", "range end clamps to file");
  equal(result.getHeader("content-range"), "bytes 7-9/10", "clamped Content-Range exact");

  const rangeBeforeHead = harness.storage.calls.openRange;
  result = await harness.call("HEAD", `/api/voice/assets/${seeded.id}/content`, { headers: { range: "bytes=1-2" } });
  equal(result.statusCode, 206, "range HEAD returns 206");
  equal(result.body.length, 0, "range HEAD has no body");
  equal(harness.storage.calls.openRange, rangeBeforeHead, "range HEAD does not open stream");

  for (const invalid of ["bytes=10-", "bytes=4-2", "bytes=0-1,3-4", "items=0-1", "bytes=-0"]) {
    const before = harness.storage.calls.openRange;
    result = await harness.call("GET", `/api/voice/assets/${seeded.id}/content`, { headers: { range: invalid } });
    equal(result.statusCode, 416, `invalid range ${invalid} returns 416`);
    equal(result.getHeader("content-range"), "bytes */10", `invalid range ${invalid} reports total`);
    equal(harness.storage.calls.openRange, before, `invalid range ${invalid} never opens storage`);
  }

  const etag = (await harness.call("HEAD", `/api/voice/assets/${seeded.id}/content`)).getHeader("etag");
  result = await harness.call("GET", `/api/voice/assets/${seeded.id}/content`, { headers: { "if-none-match": etag } });
  equal(result.statusCode, 304, "matching ETag returns 304");
  equal(result.body.length, 0, "304 has no body");
  result = await harness.call("GET", `/api/voice/assets/${seeded.id}/content`, { headers: { range: "bytes=0-1", "if-range": "\"other\"" } });
  equal(result.statusCode, 200, "mismatched If-Range falls back to full response");
  equal(result.body.toString(), "0123456789", "If-Range fallback is full content");
  result = await harness.call("GET", `/api/voice/assets/${seeded.id}/content`, { headers: { range: "bytes=0-1", "if-range": etag } });
  equal(result.statusCode, 206, "matching If-Range keeps partial response");

  await rejectsStatus(() => harness.call("GET", "/api/voice/assets/missing/content"), 404, "missing asset rejected");
  harness.seedAsset("asset-pending", Buffer.from("pending"), { status: "pending" });
  await rejectsStatus(() => harness.call("GET", "/api/voice/assets/asset-pending/content"), 409, "pending asset rejected");
  await rejectsStatus(() => harness.call("GET", `/api/voice/assets/${seeded.id}/content?download=1`), 400, "content query is strict");
  await rejectsStatus(() => harness.call("POST", `/api/voice/assets/${seeded.id}/content`), 405, "content methods locked");
}

async function checkMemoryLinksAndTranscripts() {
  const harness = createHarness();
  const assets = [1, 2, 3, 4].map((index) => harness.seedAsset(`asset-${index}`, Buffer.from(`voice-${index}`)));

  let result = await harness.call("GET", "/api/memories/memory-1/voices");
  equal(result.statusCode, 200, "voice collection GET succeeds");
  equal(result.payload.count, 0, "new memory has no voice");
  equal(result.payload.policy.maxVoicesPerMemory, 3, "collection exposes limit");
  await rejectsStatus(() => harness.call("GET", "/api/memories/missing/voices"), 404, "missing memory rejected");

  result = await harness.call("PUT", "/api/memories/memory-1/voices", {
    jsonBody: { items: [{ assetId: assets[0].id, label: "  一段   问候  " }, { assetId: assets[1].id }] }
  });
  equal(result.statusCode, 200, "atomic voice replacement succeeds");
  equal(result.payload.count, 2, "two links returned");
  equal(result.payload.voices[0].label, "一段 问候", "label normalized");
  equal(hasKeyDeep(result.payload, "storageKey"), false, "voice collection hides storageKey");
  deepEqual(harness.store.links.get("memory-1").map((item) => item.assetId), [assets[0].id, assets[1].id], "link order persisted");

  const stable = JSON.stringify(harness.store.links.get("memory-1"));
  await rejectsStatus(() => harness.call("PUT", "/api/memories/memory-1/voices", { jsonBody: { items: [], extra: true } }), 400, "unknown root field rejected");
  await rejectsStatus(() => harness.call("PUT", "/api/memories/memory-1/voices", { jsonBody: { items: [{ assetId: assets[0].id, caption: "old" }] } }), 400, "legacy caption field rejected");
  await rejectsStatus(() => harness.call("PUT", "/api/memories/memory-1/voices", { jsonBody: { items: [assets[0], assets[0]].map((asset) => ({ assetId: asset.id })) } }), 400, "duplicate asset rejected");
  await rejectsStatus(() => harness.call("PUT", "/api/memories/memory-1/voices", { jsonBody: { items: assets.map((asset) => ({ assetId: asset.id })) } }), 400, "more than three voices rejected");
  await rejectsStatus(() => harness.call("PUT", "/api/memories/memory-1/voices", { jsonBody: { items: [{ assetId: "bad id" }] } }), 400, "invalid asset ID rejected");
  await rejectsStatus(() => harness.call("PUT", "/api/memories/memory-1/voices", { jsonBody: { items: [{ assetId: assets[0].id, label: 1 }] } }), 400, "non-text label rejected");
  await rejectsStatus(() => harness.call("PUT", "/api/memories/memory-1/voices", { jsonBody: { items: [{ assetId: assets[0].id, label: "x".repeat(121) }] } }), 400, "long label rejected");
  equal(JSON.stringify(harness.store.links.get("memory-1")), stable, "all invalid replacements are atomic");

  result = await harness.call("PUT", `/api/memories/memory-1/voices/${assets[0].id}/transcript`, {
    jsonBody: { text: "  这是一段\r\n手工转写  ", confirm: false }
  });
  equal(result.statusCode, 201, "first transcript draft created");
  equal(result.payload.transcript.text, "这是一段\n手工转写", "transcript normalized");
  equal(result.payload.transcript.confirmed, false, "confirm false saves draft");
  equal(result.payload.transcript.source, "manual", "manual source enum used");

  result = await harness.call("PUT", `/api/memories/memory-1/voices/${assets[0].id}/transcript`, {
    jsonBody: { text: "已核对文字", confirm: true }
  });
  equal(result.statusCode, 200, "existing transcript updated");
  equal(result.payload.transcript.confirmed, true, "confirm true saves confirmed transcript");
  equal(harness.store.transcripts.get(`memory-1:${assets[0].id}`).status, "confirmed", "confirmed status persisted");

  await rejectsStatus(() => harness.call("PUT", `/api/memories/memory-1/voices/${assets[0].id}/transcript`, { jsonBody: { text: "x" } }), 400, "explicit confirm required");
  await rejectsStatus(() => harness.call("PUT", `/api/memories/memory-1/voices/${assets[0].id}/transcript`, { jsonBody: { text: "x", confirm: "true" } }), 400, "confirm must be boolean");
  await rejectsStatus(() => harness.call("PUT", `/api/memories/memory-1/voices/${assets[0].id}/transcript`, { jsonBody: { text: "x", confirm: true, model: "none" } }), 400, "unknown transcript field rejected");
  await rejectsStatus(() => harness.call("PUT", `/api/memories/memory-1/voices/${assets[0].id}/transcript`, { jsonBody: { text: " ", confirm: false } }), 400, "empty transcript rejected");
  await rejectsStatus(() => harness.call("PUT", `/api/memories/memory-1/voices/${assets[0].id}/transcript`, { jsonBody: { text: "x".repeat(8001), confirm: false } }), 400, "long transcript rejected");

  result = await harness.call("GET", "/api/memories/memory-1/voices");
  equal(result.payload.voices[0].transcript.text, "已核对文字", "GET embeds transcript");
  const readsBeforeDelete = harness.calls.readJsonBody;
  result = await harness.call("DELETE", `/api/memories/memory-1/voices/${assets[0].id}/transcript`, { jsonBody: { unexpected: true } });
  equal(result.statusCode, 200, "transcript DELETE succeeds without JSON contract");
  equal(harness.calls.readJsonBody, readsBeforeDelete, "transcript DELETE does not read body");
  equal(harness.store.transcripts.has(`memory-1:${assets[0].id}`), false, "transcript deleted");
  await rejectsStatus(() => harness.call("DELETE", `/api/memories/memory-1/voices/${assets[0].id}/transcript`), 404, "missing transcript delete rejected");

  result = await harness.call("DELETE", `/api/memories/memory-1/voices/${assets[1].id}`);
  equal(result.statusCode, 200, "single voice detach succeeds");
  equal(result.payload.count, 1, "detach returns current collection");
  await rejectsStatus(() => harness.call("DELETE", `/api/memories/memory-1/voices/${assets[1].id}`), 404, "duplicate detach rejected");
  await rejectsStatus(() => harness.call("PUT", `/api/memories/memory-1/voices/${assets[1].id}/transcript`, { jsonBody: { text: "x", confirm: false } }), 404, "unlinked transcript rejected");
}

async function checkAssetDeletionAndMaintenance() {
  const harness = createHarness();
  const linked = harness.seedAsset("asset-linked", Buffer.from("linked"));
  const orphan = harness.seedAsset("asset-orphan", Buffer.from("orphan"));
  harness.store.replaceMemoryVoice("memory-1", [{ assetId: linked.id, label: "linked" }]);

  await rejectsStatus(() => harness.call("DELETE", `/api/voice/assets/${linked.id}`), 409, "referenced asset cannot be deleted");
  check(harness.store.assets.has(linked.id), "referenced asset row restored");
  check(harness.storage.files.has(linked.storageKey), "referenced file restored from quarantine");

  let result = await harness.call("DELETE", `/api/voice/assets/${orphan.id}`);
  equal(result.statusCode, 200, "orphan delete succeeds");
  equal(result.payload.cleanupPending, false, "successful file cleanup reported");
  equal(harness.store.assets.has(orphan.id), false, "orphan row deleted");
  equal(harness.storage.files.has(orphan.storageKey), false, "orphan file deleted");
  await rejectsStatus(() => harness.call("DELETE", "/api/voice/assets/missing"), 404, "missing asset delete rejected");
  await rejectsStatus(() => harness.call("DELETE", `/api/voice/assets/${linked.id}?force=1`), 400, "asset delete query strict");

  const gcOne = harness.seedAsset("asset-gc-1", Buffer.from("gc1"));
  const gcTwo = harness.seedAsset("asset-gc-2", Buffer.from("gc2"));
  harness.store.replaceMemoryVoice("memory-1", [{ assetId: linked.id }, { assetId: gcTwo.id }]);
  result = await harness.api.garbageCollect({ status: "ready", limit: 10 });
  check(result.removed.includes(gcOne.id), "GC removes unreferenced voice");
  equal(result.removed.includes(gcTwo.id), false, "GC preserves referenced voice");
  equal(harness.storage.files.has(gcOne.storageKey), false, "GC removes physical file");

  const interruptedRestore = harness.seedAsset("asset-interrupted-restore", Buffer.from("interrupted-restore"));
  const restoreToken = await harness.storage.quarantine(interruptedRestore.storageKey);
  result = await harness.api.reconcileQuarantine();
  check(result.restored.includes(interruptedRestore.id), "startup reconciliation restores a quarantined file whose DB row survived");
  check(harness.storage.files.has(interruptedRestore.storageKey), "restored voice returns to its content-addressed path");
  const interruptedRemove = harness.seedAsset("asset-interrupted-remove", Buffer.from("interrupted-remove"));
  const removeToken = await harness.storage.quarantine(interruptedRemove.storageKey);
  harness.store.assets.delete(interruptedRemove.id);
  result = await harness.api.reconcileQuarantine();
  check(result.removed.includes(interruptedRemove.storageKey), "startup reconciliation removes trash whose DB row was already deleted");
  equal(harness.storage.trash.has(removeToken), false, "reconciled orphan trash leaves no tombstone");

  let release;
  let started = false;
  const gate = new Promise((resolve) => { release = resolve; });
  const first = harness.api.withVoiceOperation(async () => { started = true; await gate; return "first"; });
  while (!started) await new Promise((resolve) => setImmediate(resolve));
  let secondDone = false;
  const second = harness.api.withVoiceOperation(() => "second").finally(() => { secondDone = true; });
  await new Promise((resolve) => setImmediate(resolve));
  equal(secondDone, false, "voice lock serializes operations");
  release();
  equal(await first, "first", "first locked operation finishes");
  equal(await second, "second", "queued operation resumes");
  await rejects(() => harness.api.withVoiceOperation(() => { throw new Error("queue rejection"); }), /queue rejection/u, "queue propagates failure");
  equal(await harness.api.withVoiceOperation(() => "healthy"), "healthy", "queue is not poisoned by failure");

  const rollbackA = harness.seedAsset("asset-rollback-a", Buffer.from("rollback-a"));
  const rollbackB = harness.seedAsset("asset-rollback-b", Buffer.from("rollback-b"));
  await rejects(() => harness.api.purgeAll(() => { throw new Error("forced purge failure"); }), /forced purge failure/u, "purge failure propagated");
  check(harness.storage.files.has(rollbackA.storageKey) && harness.storage.files.has(rollbackB.storageKey), "failed purge restores all files");
  check(harness.store.assets.has(rollbackA.id), "failed purge keeps DB rows");

  result = await harness.api.purgeAll(() => harness.store.clearAll());
  equal(result.purge.ok, true, "purge callback result returned");
  equal(harness.store.assets.size, 0, "purge clears asset rows");
  equal(harness.storage.files.size, 0, "purge clears voice files");
  equal(result.cleanup.pending.length, 0, "purge has no cleanup tombstone");
}

async function checkDemoZeroWrites() {
  const harness = createHarness({ interviewDemo: true });
  const asset = harness.seedAsset("asset-demo", Buffer.from("demo"));
  harness.store.replaceMemoryVoice("memory-1", [{ assetId: asset.id }]);
  const before = snapshotCalls(harness);
  let rawConsumed = false;
  const raw = Readable.from((async function* demoBody() { rawConsumed = true; yield Buffer.from("private"); })());
  raw.method = "POST";
  raw.headers = { "content-type": "audio/webm" };
  let result = await harness.invoke(raw, "/api/voice/uploads?filename=demo.webm");
  equal(result.statusCode, 403, "Demo blocks raw upload");
  equal(result.payload.interviewDemo, true, "Demo response is explicit");
  equal(rawConsumed, false, "Demo upload body is never consumed");

  const mutations = [
    ["PUT", "/api/memories/memory-1/voices", { items: [] }],
    ["DELETE", `/api/memories/memory-1/voices/${asset.id}`],
    ["PUT", `/api/memories/memory-1/voices/${asset.id}/transcript`, { text: "private", confirm: true }],
    ["DELETE", `/api/memories/memory-1/voices/${asset.id}/transcript`],
    ["DELETE", `/api/voice/assets/${asset.id}`]
  ];
  for (const [method, pathname, jsonBody] of mutations) {
    result = await harness.call(method, pathname, { jsonBody });
    equal(result.statusCode, 403, `Demo blocks ${method} ${pathname}`);
    equal(result.payload.code, "VOICE_DEMO_READ_ONLY", "Demo uses stable error code");
  }
  deepEqual(snapshotCalls(harness), before, "Demo mutations call neither body reader, store, nor storage");
  result = await harness.call("GET", "/api/memories/memory-1/voices");
  equal(result.statusCode, 200, "Demo still permits voice reads");
}

function createHarness(options = {}) {
  const calls = { readJsonBody: 0 };
  const store = createFakeStore();
  const storage = createFakeStorage();
  const api = createVoiceApi({
    store,
    storage,
    interviewDemo: Boolean(options.interviewDemo),
    sendJson(responseValue, statusCode, payload) {
      responseValue.statusCode = statusCode;
      responseValue.payload = payload;
      responseValue.setHeader("Content-Type", "application/json; charset=utf-8");
      responseValue.setHeader("Cache-Control", "no-store");
      responseValue.end(JSON.stringify(payload));
      return payload;
    },
    async readJsonBody(requestValue) {
      calls.readJsonBody += 1;
      return requestValue.jsonBody === undefined ? {} : requestValue.jsonBody;
    },
    httpError(statusCode, message) {
      return Object.assign(new Error(message), { statusCode });
    }
  });

  async function invoke(requestValue, pathname) {
    const responseValue = response();
    const handled = await api.handle(requestValue, responseValue, url(pathname));
    if (handled === false) return false;
    await responseValue.finished;
    return responseValue;
  }

  return {
    api,
    store,
    storage,
    calls,
    invoke,
    call(method, pathname, optionsValue = {}) {
      return invoke(request(method, optionsValue), pathname);
    },
    callRaw(method, pathname, bytes, headers = {}) {
      const source = Readable.from(bytes);
      source.method = method;
      source.headers = headers;
      return invoke(source, pathname);
    },
    upload(bytes, fileName, mimeType) {
      return this.callRaw("POST", `/api/voice/uploads?filename=${encodeURIComponent(fileName)}`, bytes, {
        "content-type": mimeType,
        "content-length": String(bytes.length)
      });
    },
    seedAsset(id, bytes, extra = {}) {
      return seedAsset(store, storage, id, bytes, extra);
    }
  };
}

function createFakeStore() {
  const counters = counterBag([
    "getMemory", "createVoiceAsset", "getVoiceAsset", "getVoiceAssetByHash", "listVoiceAssets",
    "listUnreferencedVoiceAssets", "listVoiceForMemory", "replaceMemoryVoice", "detachVoice",
    "deleteVoiceAsset", "getVoiceTranscript", "upsertVoiceTranscript", "deleteVoiceTranscript"
  ]);
  const store = {
    calls: counters,
    memories: new Map([["memory-1", { id: "memory-1", title: "Memory" }]]),
    assets: new Map(),
    links: new Map(),
    transcripts: new Map(),
    getMemory(id) { counters.getMemory += 1; return this.memories.get(id) || null; },
    createVoiceAsset(input) {
      counters.createVoiceAsset += 1;
      if (this.getVoiceAssetByHash(input.contentSha256)) {
        throw Object.assign(new Error("hash exists"), { code: "VOICE_ASSET_HASH_EXISTS", statusCode: 409 });
      }
      const id = `voice-${this.assets.size + 1}`;
      const asset = { id, createdAt: new Date().toISOString(), ...input };
      this.assets.set(id, asset);
      return { ...asset };
    },
    getVoiceAsset(id) { counters.getVoiceAsset += 1; const value = this.assets.get(id); return value ? { ...value } : null; },
    getVoiceAssetByHash(hash) {
      counters.getVoiceAssetByHash += 1;
      return [...this.assets.values()].find((item) => item.contentSha256 === hash) || null;
    },
    listVoiceAssets(filters = {}) {
      counters.listVoiceAssets += 1;
      let values = [...this.assets.values()];
      if (filters.status) values = values.filter((item) => item.status === filters.status);
      const offset = Number(filters.offset) || 0;
      const limit = Number(filters.limit) || values.length;
      return values.slice(offset, offset + limit).map((asset) => ({ ...asset, referenceCount: referenceCount(this, asset.id) }));
    },
    listUnreferencedVoiceAssets(filters = {}) {
      counters.listUnreferencedVoiceAssets += 1;
      return this.listVoiceAssets(filters).filter((asset) => asset.referenceCount === 0);
    },
    listVoiceForMemory(memoryId) {
      counters.listVoiceForMemory += 1;
      return (this.links.get(memoryId) || []).map((link, position) => ({
        ...link,
        position,
        asset: this.assets.get(link.assetId),
        transcript: this.transcripts.get(`${memoryId}:${link.assetId}`) || null
      }));
    },
    replaceMemoryVoice(memoryId, items) {
      counters.replaceMemoryVoice += 1;
      if (!this.memories.has(memoryId)) throw Object.assign(new Error("memory missing"), { code: "VOICE_MEMORY_NOT_FOUND", statusCode: 404 });
      if (items.length > 3) throw Object.assign(new Error("too many"), { code: "VOICE_MEMORY_LIMIT", statusCode: 400 });
      for (const item of items) {
        const asset = this.assets.get(item.assetId);
        if (!asset || asset.status !== "ready") throw Object.assign(new Error("asset unavailable"), { code: "VOICE_ASSET_NOT_READY", statusCode: 409 });
      }
      this.links.set(memoryId, items.map((item) => ({ ...item })));
      return this.listVoiceForMemory(memoryId);
    },
    detachVoice(memoryId, assetId) {
      counters.detachVoice += 1;
      const items = this.links.get(memoryId) || [];
      const next = items.filter((item) => item.assetId !== assetId);
      if (next.length === items.length) return false;
      this.links.set(memoryId, next);
      this.transcripts.delete(`${memoryId}:${assetId}`);
      return true;
    },
    deleteVoiceAsset(id) {
      counters.deleteVoiceAsset += 1;
      if (referenceCount(this, id) > 0) throw Object.assign(new Error("asset in use"), { code: "VOICE_ASSET_IN_USE", statusCode: 409 });
      return this.assets.delete(id);
    },
    getVoiceTranscript(memoryId, assetId) {
      counters.getVoiceTranscript += 1;
      return this.transcripts.get(`${memoryId}:${assetId}`) || null;
    },
    upsertVoiceTranscript(input) {
      counters.upsertVoiceTranscript += 1;
      const key = `${input.memoryId}:${input.assetId}`;
      const existing = this.transcripts.get(key);
      const now = new Date().toISOString();
      const transcript = {
        ...input,
        status: input.confirmed ? "confirmed" : "draft",
        created: !existing,
        createdAt: existing?.createdAt || now,
        updatedAt: now
      };
      this.transcripts.set(key, transcript);
      return { ...transcript };
    },
    deleteVoiceTranscript(memoryId, assetId) {
      counters.deleteVoiceTranscript += 1;
      return this.transcripts.delete(`${memoryId}:${assetId}`);
    },
    clearAll() {
      this.assets.clear();
      this.links.clear();
      this.transcripts.clear();
      return { ok: true };
    }
  };
  return store;
}

function createFakeStorage() {
  const counters = counterBag(["beginUpload", "materialize", "getUpload", "discardUpload", "stat", "open", "openRange", "quarantine", "restoreQuarantined", "removeQuarantined", "listQuarantined"]);
  let stageIndex = 0;
  let trashIndex = 0;
  return {
    calls: counters,
    policy: { maxBytes: MAX_VOICE_BYTES, maxDurationMs: MAX_VOICE_DURATION_MS },
    files: new Map(),
    stages: new Map(),
    trash: new Map(),
    nextBeginError: null,
    async beginUpload(readable, input) {
      counters.beginUpload += 1;
      if (this.nextBeginError) { const error = this.nextBeginError; this.nextBeginError = null; throw error; }
      const chunks = [];
      for await (const chunk of readable) chunks.push(Buffer.from(chunk));
      const bytes = Buffer.concat(chunks);
      const contentSha256 = sha256(bytes);
      const uploadId = `upload-00000000-0000-4000-8000-${String(++stageIndex).padStart(12, "0")}`;
      const mimeType = input.declaredMimeType;
      const stage = {
        uploadId,
        originalName: input.fileName,
        contentSha256,
        byteSize: bytes.length,
        mimeType,
        extension: mimeType === "audio/webm" ? "webm" : "m4a",
        codec: mimeType === "audio/webm" ? "opus" : "aac",
        durationMs: 1_500,
        createdAt: new Date().toISOString(),
        bytes
      };
      this.stages.set(uploadId, stage);
      return { ...stage, bytes: undefined };
    },
    async materialize(uploadId) {
      counters.materialize += 1;
      const stage = this.stages.get(uploadId);
      if (!stage) throw Object.assign(new Error("stage missing"), { code: "VOICE_UPLOAD_NOT_FOUND", statusCode: 404 });
      const storageKey = `ready/${stage.contentSha256.slice(0, 2)}/${stage.contentSha256}.${stage.extension}`;
      const created = !this.files.has(storageKey);
      if (created) this.files.set(storageKey, Buffer.from(stage.bytes));
      return {
        asset: {
          contentSha256: stage.contentSha256,
          originalName: stage.originalName,
          mimeType: stage.mimeType,
          codec: stage.codec,
          durationMs: stage.durationMs,
          byteSize: stage.byteSize
        },
        file: { storageKey, sha256: stage.contentSha256, byteSize: stage.byteSize, mimeType: stage.mimeType },
        created,
        reused: !created
      };
    },
    async getUpload(uploadId) { counters.getUpload += 1; return this.stages.get(uploadId) || null; },
    async discardUpload(uploadId) { counters.discardUpload += 1; this.stages.delete(uploadId); },
    async stat(storageKey) {
      counters.stat += 1;
      const bytes = this.files.get(storageKey);
      if (!bytes) throw Object.assign(new Error("file missing"), { code: "VOICE_FILE_NOT_FOUND", statusCode: 404 });
      const hash = sha256(bytes);
      return { storageKey, byteSize: bytes.length, mimeType: storageKey.endsWith(".webm") ? "audio/webm" : "audio/mp4", sha256: hash, etag: `\"sha256-${hash}\"` };
    },
    async open(storageKey) {
      counters.open += 1;
      const bytes = this.files.get(storageKey);
      if (!bytes) throw Object.assign(new Error("file missing"), { code: "VOICE_FILE_NOT_FOUND", statusCode: 404 });
      return Readable.from(Buffer.from(bytes));
    },
    async openRange(storageKey, range) {
      counters.openRange += 1;
      const bytes = this.files.get(storageKey);
      if (!bytes) throw Object.assign(new Error("file missing"), { code: "VOICE_FILE_NOT_FOUND", statusCode: 404 });
      const slice = bytes.subarray(range.start, range.end + 1);
      return { stream: Readable.from(Buffer.from(slice)), start: range.start, end: range.end, length: slice.length, total: bytes.length, contentRange: `bytes ${range.start}-${range.end}/${bytes.length}` };
    },
    async quarantine(storageKey) {
      counters.quarantine += 1;
      const bytes = this.files.get(storageKey);
      if (!bytes) throw Object.assign(new Error("file missing"), { code: "VOICE_FILE_NOT_FOUND", statusCode: 404 });
      const token = `trash-${++trashIndex}`;
      this.files.delete(storageKey);
      this.trash.set(token, { storageKey, bytes });
      return token;
    },
    async restoreQuarantined(token) {
      counters.restoreQuarantined += 1;
      const entry = this.trash.get(token);
      if (!entry) throw Object.assign(new Error("trash missing"), { code: "VOICE_TRASH_NOT_FOUND", statusCode: 404 });
      this.files.set(entry.storageKey, entry.bytes);
      this.trash.delete(token);
    },
    async removeQuarantined(token) {
      counters.removeQuarantined += 1;
      if (!this.trash.delete(token)) throw Object.assign(new Error("trash missing"), { code: "VOICE_TRASH_NOT_FOUND", statusCode: 404 });
    },
    async listQuarantined() {
      counters.listQuarantined += 1;
      return [...this.trash.entries()].map(([token, entry]) => ({
        token,
        storageKey: entry.storageKey,
        sha256: sha256(entry.bytes)
      }));
    }
  };
}

function seedAsset(store, storage, id, bytes, extra = {}) {
  const contentSha256 = sha256(bytes);
  const mimeType = extra.mimeType || "audio/webm";
  const extension = mimeType === "audio/webm" ? "webm" : "m4a";
  const storageKey = `ready/${contentSha256.slice(0, 2)}/${contentSha256}.${extension}`;
  storage.files.set(storageKey, Buffer.from(bytes));
  const asset = {
    id,
    contentSha256,
    sha256: contentSha256,
    originalName: `${id}.${extension}`,
    mimeType,
    codec: mimeType === "audio/webm" ? "opus" : "aac",
    durationMs: 1_000,
    byteSize: bytes.length,
    storageKey,
    status: "ready",
    createdAt: new Date().toISOString(),
    ...extra
  };
  store.assets.set(id, asset);
  return asset;
}

function referenceCount(store, assetId) {
  return [...store.links.values()].reduce((sum, items) => sum + items.filter((item) => item.assetId === assetId).length, 0);
}

class CaptureResponse extends Writable {
  constructor() {
    super();
    this.statusCode = 0;
    this.headers = new Map();
    this.chunks = [];
    this.finished = new Promise((resolve, reject) => {
      this.once("finish", resolve);
      this.once("error", reject);
    });
  }

  _write(chunk, _encoding, callback) {
    this.chunks.push(Buffer.from(chunk));
    callback();
  }

  setHeader(name, value) { this.headers.set(String(name).toLowerCase(), String(value)); }
  getHeader(name) { return this.headers.get(String(name).toLowerCase()); }
  get body() { return Buffer.concat(this.chunks); }
}

function response() {
  return new CaptureResponse();
}

function request(method, options = {}) {
  return { method, headers: options.headers || {}, jsonBody: options.jsonBody };
}

function url(pathname) {
  return new URL(pathname, "http://local.test");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function counterBag(names) {
  return Object.fromEntries(names.map((name) => [name, 0]));
}

function snapshotCalls(harness) {
  return {
    readJsonBody: harness.calls.readJsonBody,
    store: { ...harness.store.calls },
    storage: { ...harness.storage.calls }
  };
}

function hasKeyDeep(value, wanted) {
  if (!value || typeof value !== "object") return false;
  if (Object.prototype.hasOwnProperty.call(value, wanted)) return true;
  return Object.values(value).some((item) => hasKeyDeep(item, wanted));
}

function check(value, message) {
  assert.ok(value, message);
  assertions += 1;
}

function equal(actual, expected, message) {
  assert.equal(actual, expected, message);
  assertions += 1;
}

function deepEqual(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
  assertions += 1;
}

function throws(operation, matcher, message) {
  assert.throws(operation, matcher, message);
  assertions += 1;
}

async function rejects(operation, matcher, message) {
  await assert.rejects(operation, matcher, message);
  assertions += 1;
}

async function rejectsStatus(operation, statusCode, message) {
  await assert.rejects(operation, (error) => Number(error?.statusCode) === statusCode, message);
  assertions += 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
