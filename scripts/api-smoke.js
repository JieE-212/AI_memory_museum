const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const { createHash } = require("crypto");
const zlib = require("zlib");

const root = path.resolve(__dirname, "..");
let assertionCount = 0;

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

async function main() {
  await runLocalFlow();
  await runArchiveMediaFlow();
  await runDemoSafetyFlow();
  console.log(`API smoke checks passed (${assertionCount} assertions).`);
}

async function runArchiveMediaFlow() {
  const dbPath = path.join(os.tmpdir(), `ai-memory-museum-archive-smoke-${Date.now()}.sqlite`);
  const mediaRoot = `${dbPath}.media`;
  try {
    await withServer({ DB_PATH: dbPath, MEDIA_ROOT: mediaRoot, INTERVIEW_DEMO: "false" }, async (baseUrl) => {
      const leftId = "archive-left-memory";
      const rightId = "archive-right-memory";
      for (const [id, title] of [[leftId, "旧相册里的操场"], [rightId, "多年后的重返"]]) {
        const created = await postJson(`${baseUrl}/api/memories`, {
          id,
          title,
          hall: "daily",
          sourceType: "照片描述",
          rawContent: `${title}，这是用于完整归档回环的本地测试。`,
          exhibitText: `${title}的展品说明。`,
          date: "2025-05-20",
          location: "归档操场",
          people: ["归档朋友"],
          tags: ["归档回环"]
        });
        assert(`完整归档场景可创建${title}`, created.response.status === 201);
      }

      const exhibitionPreview = await postJson(`${baseUrl}/api/exhibitions/preview`, {
        theme: "旧操场与重返",
        memoryIds: [leftId, rightId]
      });
      const savedExhibition = await postJson(`${baseUrl}/api/exhibitions`, {
        ...exhibitionPreview.payload.preview,
        status: "published",
        confirm: true
      });
      assert("完整归档场景可发布带原文依据的主题展览", exhibitionPreview.response.ok && savedExhibition.response.status === 201 && savedExhibition.payload.exhibition.status === "published");
      const sourceExhibitionId = savedExhibition.payload.exhibition.id;
      const archiveRevisitContext = { localDate: "2026-05-20", timezone: "Asia/Shanghai" };
      const archivedViewed = await postJson(`${baseUrl}/api/revisits/${leftId}/viewed`, archiveRevisitContext);
      const archivedDismissed = await postJson(`${baseUrl}/api/revisits/${rightId}/dismissed`, archiveRevisitContext);
      const archivedIntent = await putJson(`${baseUrl}/api/revisits/${rightId}/intent`, {
        choice: "later",
        notBeforeLocalDate: "2027-05-20",
        timezone: "Asia/Shanghai",
        confirm: true
      });
      assert(
        "完整归档场景保存回访与当日隐藏状态",
        archivedViewed.response.ok &&
          archivedViewed.payload.state.viewCount === 1 &&
          archivedDismissed.response.ok &&
          archivedDismissed.payload.state.dismissedLocalDate === archiveRevisitContext.localDate
      );
      assert(
        "完整归档场景保存非空 later 回访意愿",
        archivedIntent.response.ok &&
          archivedIntent.payload.intent.choice === "later" &&
          archivedIntent.payload.intent.notBeforeLocalDate === "2027-05-20" &&
          archivedIntent.payload.intent.timezone === "Asia/Shanghai"
      );

      const display = createWebp(320, 180);
      const thumb = createWebp(120, 80);
      const leftAsset = await createReadyAsset(baseUrl, createPng(640, 360), display, thumb, "旧操场.png");
      const rightAsset = await createReadyAsset(baseUrl, createPng(641, 361), display, thumb, "重返操场.png");
      const sample = { width: 9, height: 8, rgbaBase64: createFingerprintRgba().toString("base64") };
      const leftFingerprint = await postJson(`${baseUrl}/api/media/assets/${leftAsset.id}/fingerprint`, { sample });
      const rightFingerprint = await postJson(`${baseUrl}/api/media/assets/${rightAsset.id}/fingerprint`, { sample });
      assert("浏览器采样可生成不公开哈希的检索指纹", leftFingerprint.response.status === 201 && rightFingerprint.response.status === 201 && leftFingerprint.payload.fingerprint.ready && !leftFingerprint.payload.fingerprint.hash);

      await postJson(`${baseUrl}/api/memories/${leftId}/media`, { assetId: leftAsset.id, role: "cover", caption: "旧操场" });
      await postJson(`${baseUrl}/api/memories/${rightId}/media`, { assetId: rightAsset.id, role: "cover", caption: "重返操场" });
      const annotation = await postJson(`${baseUrl}/api/memories/${leftId}/media/${leftAsset.id}/annotations`, {
        region: { x: 0.1, y: 0.2, width: 0.4, height: 0.3 },
        regionType: "text",
        label: "看台上的年份",
        sensitive: true
      });
      assert("完整归档场景保存图片区域证据", annotation.response.status === 201);

      const similar = await getJson(`${baseUrl}/api/media/assets/${leftAsset.id}/similar`);
      assert("感知指纹只返回需人工核对的可能相似候选", similar.response.ok && similar.payload.candidates.some((item) => item.assetId === rightAsset.id && item.classification === "similar_candidate" && item.requiresReview === true));
      const compare = await getJson(`${baseUrl}/api/archaeology/puzzle?memoryId=${leftId}&relatedId=${rightId}`);
      assert("时光拼图同时返回两侧图片供手动对照", compare.response.ok && compare.payload.imageCompare.left.length === 1 && compare.payload.imageCompare.right.length === 1);

      const voiceUpload = await uploadVoice(baseUrl, createVoiceWebm(1_200), "操场晚风.webm", "audio/webm");
      const sourceVoiceId = voiceUpload.payload.asset.id;
      const linkedVoice = await putJson(`${baseUrl}/api/memories/${leftId}/voices`, {
        items: [{ assetId: sourceVoiceId, label: "操场晚风" }]
      });
      await putJson(`${baseUrl}/api/memories/${leftId}/voices/${sourceVoiceId}/transcript`, {
        text: "归档声音暗号",
        confirm: true
      });
      const voiceRange = await fetch(`${baseUrl}/api/voice/assets/${sourceVoiceId}/content`, { headers: { Range: "bytes=0-9" } });
      assert("完整归档场景保存可拖动播放的声音与人工确认文字稿", voiceUpload.response.status === 201 && linkedVoice.payload.count === 1 && voiceRange.status === 206 && voiceRange.headers.get("content-range")?.startsWith("bytes 0-9/"));

      const safeCandidates = await getJson(`${baseUrl}/api/offline-exhibits/candidates?exhibitionId=${encodeURIComponent(sourceExhibitionId)}`);
      assert(
        "离线展览候选只列来源展览的 display WebP 与 confirmed 文字稿",
        safeCandidates.response.ok &&
          safeCandidates.payload.media.some((item) => item.assetId === leftAsset.id && item.mimeType === "image/webp") &&
          safeCandidates.payload.transcripts.some((item) => item.assetId === sourceVoiceId && item.confirmed === true && item.text === "归档声音暗号")
      );
      const safeMaterial = await postJson(`${baseUrl}/api/offline-exhibits/material`, {
        sourceType: "exhibition",
        sourceId: sourceExhibitionId,
        mediaAssetIds: [leftAsset.id],
        transcriptAssetIds: [sourceVoiceId],
        confirm: true
      });
      const safeSnapshotText = JSON.stringify(safeMaterial.payload.material.snapshot);
      assert(
        "离线展览材料匿名化且只保留明确选择的安全内容",
        safeMaterial.response.ok &&
          safeMaterial.payload.material.media.length === 1 &&
          safeMaterial.payload.material.media[0].mimeType === "image/webp" &&
          safeMaterial.payload.material.media[0].width === 320 &&
          safeMaterial.payload.material.media[0].height === 180 &&
          safeSnapshotText.includes("归档声音暗号") &&
          !safeSnapshotText.includes(leftId) &&
          !safeSnapshotText.includes(leftAsset.id) &&
          !safeSnapshotText.includes(sourceVoiceId)
      );

      const lockedCapsule = await postJson(`${baseUrl}/api/capsules`, {
        exhibitionId: sourceExhibitionId,
        title: "未开启归档胶囊",
        shellMessage: "等到未来再见",
        opensOn: "2099-05-20",
        timezone: "Asia/Shanghai",
        mediaAssetIds: [leftAsset.id],
        transcriptAssetIds: [sourceVoiceId],
        confirm: true
      });
      const sourceLockedCapsuleId = lockedCapsule.payload.capsule.id;
      const lockedContent = await getJson(`${baseUrl}/api/capsules/${sourceLockedCapsuleId}/content`);
      const lockedText = JSON.stringify(lockedContent.payload);
      assert(
        "未到期胶囊只返回外壳且不泄漏任何 payload 线索",
        lockedCapsule.response.status === 201 &&
          lockedContent.response.status === 423 &&
          Object.keys(lockedContent.payload).sort().join(",") === "capsule,code,error" &&
          lockedContent.payload.capsule.available === false &&
          lockedContent.payload.capsule.ceremonialGate === true &&
          !lockedText.includes(leftId) &&
          !lockedText.includes(leftAsset.id) &&
          !lockedText.includes(sourceVoiceId) &&
          !lockedText.includes("归档声音暗号")
      );

      const openedCapsule = await postJson(`${baseUrl}/api/capsules`, {
        exhibitionId: sourceExhibitionId,
        title: "已开启归档胶囊",
        shellMessage: "用于无损归档回环",
        opensOn: "2020-05-20",
        timezone: "Asia/Shanghai",
        mediaAssetIds: [leftAsset.id],
        transcriptAssetIds: [sourceVoiceId],
        confirm: true
      });
      const sourceOpenedCapsuleId = openedCapsule.payload.capsule.id;
      const openedContent = await getJson(`${baseUrl}/api/capsules/${sourceOpenedCapsuleId}/content`);
      assert(
        "到期胶囊返回匿名快照与所选安全展示图",
        openedCapsule.response.status === 201 &&
          openedContent.response.ok &&
          openedContent.payload.capsule.available === true &&
          openedContent.payload.content.media.length === 1 &&
          openedContent.payload.content.snapshot.sections.some((section) => section.items.some((item) => item.confirmedTranscripts.includes("归档声音暗号") && item.confirmedQuotes.length > 0))
      );

      const archiveResponse = await fetch(`${baseUrl}/api/archive/export`);
      const archive = Buffer.from(await archiveResponse.arrayBuffer());
      assert("完整 .time-isle 导出包含二进制归档与下载文件名", archiveResponse.ok && archiveResponse.headers.get("content-type") === "application/vnd.time-isle" && archiveResponse.headers.get("content-disposition").includes(".time-isle") && archive.subarray(0, 2).equals(Buffer.from([0x1f, 0x8b])));
      const inspectionResponse = await fetch(`${baseUrl}/api/archive/inspect`, {
        method: "POST",
        headers: writeHeaders(`${baseUrl}/api/archive/inspect`, { "Content-Type": "application/vnd.time-isle" }),
        body: archive
      });
      const inspection = await inspectionResponse.json();
      assert("备份验真只读返回可恢复边界并清理暂存", inspectionResponse.ok && inspection.inspection.restorable === true && inspection.inspection.schemaVersion === 11 && inspection.inspection.counts.memories === 2 && inspection.inspection.counts.mediaAssets === 2 && inspection.inspection.counts.voices === 1 && inspection.inspection.counts.revisions === 2 && inspection.inspection.counts.revisitIntents === 1 && (await getJson(`${baseUrl}/api/memories`)).payload.memories.length === 2 && !fs.existsSync(path.join(mediaRoot, ".inspect")));
      const archiveCollection = await getJson(`${baseUrl}/api/memories/export`);
      const archivedEntityCount = archiveCollection.payload.entities.entities.length;
      const archivedEntityId = archiveCollection.payload.entities.entities[0].id;
      assert("完整归档边界包含实体图", archivedEntityCount > 0 && archiveCollection.payload.entities.entities.every((entity) => entity.memoryLinks.length > 0));
      assert("完整归档边界包含声音索引与确认文字稿", archiveCollection.payload.voices.assets.length === 1 && archiveCollection.payload.voices.transcripts.some((item) => item.text === "归档声音暗号" && item.status === "confirmed"));
      assert("完整归档边界包含胶囊安全快照与展示图引用", archiveCollection.payload.capsules.capsules.length === 2 && archiveCollection.payload.capsules.capsules.every((item) => item.snapshot.sections.length > 0) && archiveCollection.payload.capsules.capsules.some((item) => item.mediaLinks.some((link) => link.assetId === leftAsset.id)));
      assert("完整归档边界包含可校验记忆年轮", archiveCollection.payload.revisions.mode === "full" && archiveCollection.payload.revisions.revisions.length === 2 && archiveCollection.payload.revisions.revisions.every((item) => item.changeKind === "created"));
      assert("完整归档边界包含一条非空回访意愿", archiveCollection.payload.revisitIntents.mode === "full" && archiveCollection.payload.revisitIntents.intents.length === 1 && archiveCollection.payload.revisitIntents.intents[0].memoryId === rightId && archiveCollection.payload.revisitIntents.intents[0].intent === "later");

      const purged = await deleteJson(`${baseUrl}/api/memories/purge`, { confirm: "DELETE" });
      assert("归档恢复前可隔离并清空源馆藏、胶囊、实体索引、回访状态与意愿、图片与声音", purged.response.ok && purged.payload.purge.capsulesDeleted === 2 && purged.payload.purge.revisitStatesDeleted === 2 && purged.payload.purge.revisitIntentsDeleted === 1 && purged.payload.purge.entitiesDeleted === archivedEntityCount && purged.payload.purge.searchDocumentsDeleted === 2 && purged.payload.purge.voiceAssetsDeleted === 1 && purged.payload.mediaCleanupPending === false && listFiles(path.join(mediaRoot, "assets")).length === 0 && listFiles(path.join(mediaRoot, "voice", "ready")).length === 0);
      const restoreResponse = await fetch(`${baseUrl}/api/archive/restore`, {
        method: "POST",
        headers: writeHeaders(`${baseUrl}/api/archive/restore`, { "Content-Type": "application/octet-stream" }),
        body: archive
      });
      const restored = await restoreResponse.json();
      assert("完整归档以单次事务恢复展品、图片、声音、胶囊、展览、回访、意愿、年轮与实体图", restoreResponse.ok && restored.imported === 2 && restored.media.assetsCreated === 2 && restored.media.links === 2 && restored.media.observations === 3 && restored.voices.assets === 1 && restored.voices.memoryLinks === 1 && restored.voices.transcripts === 1 && restored.capsules.capsules === 2 && restored.capsules.mediaLinks === 2 && restored.exhibitions.exhibitions === 1 && restored.revisits.states === 2 && restored.revisitIntents.intents === 1 && restored.revisions.revisions === 2 && restored.entities.entities === archivedEntityCount && restored.idMap.entities[archivedEntityId] && restored.idMap.revisitIntents[rightId] === restored.idMap.memories[rightId]);
      const restoredLeftId = restored.idMap.memories[leftId];
      const restoredLeftAsset = restored.idMap.assets[leftAsset.id];
      const restoredVoiceId = restored.idMap.voices[sourceVoiceId];
      const restoredDetail = await getJson(`${baseUrl}/api/memories/${restoredLeftId}`);
      const restoredAnnotations = await getJson(`${baseUrl}/api/memories/${restoredLeftId}/media/${restoredLeftAsset}/annotations`);
      assert("恢复后图片文件、关联与敏感区域证据仍可读取", restoredDetail.payload.memory.media.length === 1 && restoredAnnotations.payload.annotations.length === 1 && restoredAnnotations.payload.annotations[0].sensitive === true && listFiles(path.join(mediaRoot, "assets")).length === 6);
      const restoredVoiceRange = await fetch(`${baseUrl}/api/voice/assets/${restoredVoiceId}/content`, { headers: { Range: "bytes=-8" } });
      const restoredVoiceSearch = await getJson(`${baseUrl}/api/search?q=${encodeURIComponent("归档声音暗号")}`);
      assert("恢复后声音文件、关联、Range 与确认文字稿检索仍可用", restoredDetail.payload.memory.voices.length === 1 && restoredDetail.payload.memory.voices[0].transcript.confirmed === true && restoredVoiceRange.status === 206 && restoredVoiceSearch.payload.results.some((item) => item.memory.id === restoredLeftId && item.matchedFields.includes("voice")) && listFiles(path.join(mediaRoot, "voice", "ready")).length === 1);
      const restoredEntity = await getJson(`${baseUrl}/api/entities/${restored.idMap.entities[archivedEntityId]}`);
      assert(".time-isle 恢复后实体关系映射到恢复后的展品", restoredEntity.response.ok && restoredEntity.payload.entity.memories.some((memory) => memory.memoryId === restoredLeftId || memory.memoryId === restored.idMap.memories[rightId]));
      const restoredExhibition = await getJson(`${baseUrl}/api/exhibitions/${restored.idMap.exhibitions[sourceExhibitionId]}`);
      assert("完整归档恢复后展览引用已映射到恢复后的展品", restoredExhibition.response.ok && restoredExhibition.payload.exhibition.memoryIds.includes(restoredLeftId));
      const restoredOpenedCapsuleId = restored.idMap.capsules[sourceOpenedCapsuleId];
      const restoredLockedCapsuleId = restored.idMap.capsules[sourceLockedCapsuleId];
      const restoredCapsuleContent = await getJson(`${baseUrl}/api/capsules/${restoredOpenedCapsuleId}/content`);
      const restoredLockedContent = await getJson(`${baseUrl}/api/capsules/${restoredLockedCapsuleId}/content`);
      assert(
        "完整归档恢复后胶囊日期、匿名文字与展示图映射保持一致",
        restoredCapsuleContent.response.ok &&
          restoredCapsuleContent.payload.content.media[0].contentUrl.includes(restoredLeftAsset) &&
          restoredCapsuleContent.payload.content.snapshot.sections.some((section) => section.items.some((item) => item.confirmedTranscripts.includes("归档声音暗号"))) &&
          restoredLockedContent.response.status === 423 &&
          restoredLockedContent.payload.capsule.opensOn === "2099-05-20"
      );
      const restoredRevisits = await getJson(`${baseUrl}/api/revisits?kind=long-unseen&localDate=2026-05-21&timezone=Asia%2FShanghai&limit=20`);
      const restoredViewed = restoredRevisits.payload.revisits.find((item) => item.memory.id === restoredLeftId);
      assert("完整归档恢复后回访状态已映射到恢复后的展品", restoredRevisits.response.ok && restored.idMap.revisits[leftId] === restoredLeftId && restoredViewed?.state.viewCount === 1);
      const restoredRightId = restored.idMap.memories[rightId];
      const restoredIntent = await getJson(`${baseUrl}/api/revisits/${restoredRightId}/intent`);
      assert("完整归档恢复后 later 意愿保留日期与 IANA 时区", restoredIntent.response.ok && restoredIntent.payload.intent.memoryId === restoredRightId && restoredIntent.payload.intent.choice === "later" && restoredIntent.payload.intent.notBeforeLocalDate === "2027-05-20" && restoredIntent.payload.intent.timezone === "Asia/Shanghai");
      const restoredSimilar = await getJson(`${baseUrl}/api/media/assets/${restoredLeftAsset}/similar`);
      assert("恢复后的检索指纹仍只生成相似候选", restoredSimilar.payload.candidates.length === 1 && restoredSimilar.payload.candidates[0].requiresReview === true);

      const beforeRejected = await getJson(`${baseUrl}/api/memories`);
      const corrupted = Buffer.from(archive);
      corrupted[Math.floor(corrupted.length / 2)] ^= 0xff;
      const rejectedResponse = await fetch(`${baseUrl}/api/archive/restore`, {
        method: "POST",
        headers: writeHeaders(`${baseUrl}/api/archive/restore`, { "Content-Type": "application/octet-stream" }),
        body: corrupted
      });
      const afterRejected = await getJson(`${baseUrl}/api/memories`);
      assert("损坏 .time-isle 在任何业务写入前被整批拒绝", rejectedResponse.status === 400 && afterRejected.payload.memories.length === beforeRejected.payload.memories.length);
    });
  } finally {
    removeDatabase(dbPath);
    removeDirectory(mediaRoot);
  }
}

async function runLocalFlow() {
  const dbPath = path.join(os.tmpdir(), `ai-memory-museum-smoke-${Date.now()}.sqlite`);
  const mediaRoot = `${dbPath}.media`;
  try {
    await withServer({ DB_PATH: dbPath, MEDIA_ROOT: mediaRoot, INTERVIEW_DEMO: "false" }, async (baseUrl) => {
    const home = await fetch(`${baseUrl}/`);
    const homeText = await home.text();
    assert("首页可访问并展示时屿品牌", home.ok && homeText.includes("把散落的生活片段") && homeText.includes("TIME ISLE"));
    assert("首页包含安全响应头", home.headers.get("x-content-type-options") === "nosniff" && home.headers.get("x-frame-options") === "DENY");

    const styles = await fetch(`${baseUrl}/styles.css`);
    const archaeologyStyles = await fetch(`${baseUrl}/archaeology.css`);
    const app = await fetch(`${baseUrl}/assets/app.js`);
    assert("静态资源可访问", styles.ok && archaeologyStyles.ok && app.ok);

    const manifestResponse = await fetch(`${baseUrl}/manifest.webmanifest`);
    const manifest = await manifestResponse.json();
    assert("PWA Manifest 可安装且保持四视图起点", manifestResponse.ok && manifestResponse.headers.get("content-type") === "application/manifest+json; charset=utf-8" && manifestResponse.headers.get("cache-control") === "no-cache, no-store, must-revalidate" && manifest.start_url === "/#collection" && manifest.display === "standalone" && manifest.icons.length === 2);
    const workerResponse = await fetch(`${baseUrl}/sw.js`);
    const workerSource = await workerResponse.text();
    assert("Service Worker 根作用域禁缓存且只声明公开离线壳", workerResponse.ok && workerResponse.headers.get("service-worker-allowed") === "/" && workerResponse.headers.get("cache-control") === "no-cache, no-store, must-revalidate" && workerSource.includes('const OFFLINE_URL = "/offline.html"') && !workerSource.includes("cache.put"));
    const offlineResponse = await fetch(`${baseUrl}/offline.html`);
    const offlineText = await offlineResponse.text();
    assert("离线页明确不缓存或展示私人馆藏", offlineResponse.ok && offlineText.includes("不会展示馆藏、照片、声音或导出内容") && !offlineText.includes("<script"));

    const health = await getJson(`${baseUrl}/api/health`);
    assert("健康检查返回时屿 V7.3 与 schema 11", health.response.ok && health.response.headers.get("cache-control") === "no-store" && health.payload.ok && health.payload.version === "7.3.0" && health.payload.schemaVersion === 11 && health.payload.name === "时屿" && health.payload.englishName === "TIME ISLE" && health.payload.tagline === "AI 私人记忆策展工具" && health.payload.stats.capsules === 0);
    assert("本地模式使用 SQLite", health.payload.mode === "local" && health.payload.storage === "local-sqlite");
    assert("健康检查声明本地语义线索检索与短词回退", health.payload.search?.engine === "fts5-trigram" && health.payload.search?.shortQueryFallback === "parameterized-like" && health.payload.search?.externalModelRequired === false);

    const spoofedHost = await rawHttpStatus(`${baseUrl}/api/health`, {
      headers: { Host: "attacker.example" }
    });
    assert("本地服务以 421 拒绝 DNS rebinding Host", spoofedHost === 421);
    const legalHost = await rawHttpStatus(`${baseUrl}/api/health`, {
      headers: { Host: `localhost:${new URL(baseUrl).port}` }
    });
    assert("本地服务接受带合法端口的 localhost Host", legalHost === 200);
    const maliciousOrigin = await rawHttpStatus(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: {
        Host: `127.0.0.1:${new URL(baseUrl).port}`,
        Origin: "http://attacker.example",
        "Sec-Fetch-Site": "same-origin",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ rawContent: "不应进入整理流程。" })
    });
    assert("写请求以 403 拒绝恶意 Origin", maliciousOrigin === 403);

    const version = await getJson(`${baseUrl}/api/version`);
    assert("版本接口描述 V7.3 核心产品流程", version.response.ok && version.payload.version === "7.3.0" && version.payload.productFlow.join(",") === "记录,AI 整理,照片与声音归档,语义线索检索与讲解,主题策展,记忆回访,时光胶囊与加密分享,记忆考古,历史恢复,安全导出" && version.payload.v7.offlineSharing.includes("AES-256-GCM") && version.payload.v7.pwa.includes("不缓存私人馆藏") && version.payload.v72.concurrency.includes("If-Match") && version.payload.v73.sharePrivacy.includes("浏览器内") && version.payload.v73.revisitIntent.includes("明确选择"));

    const demo = await getJson(`${baseUrl}/api/demo/status`);
    assert("本地模式未伪装成公开 Demo", demo.response.ok && demo.payload.interviewDemo === false);

    const options = await getJson(`${baseUrl}/api/options`);
    assert("选项接口包含七个中文展厅", options.response.ok && options.payload.halls.length === 7 && options.payload.halls.every((hall) => hall.name.endsWith("展厅")));
    assert("JSON 兼容导入拥有独立的 64 MiB 往返预算", options.payload.limits.importBody === 64 * 1024 * 1024 && options.payload.limits.importBody > options.payload.limits.body);
    assert("本地声音策略锁定三段、三分钟与 12 MiB", options.payload.voicePolicy.maxVoicesPerMemory === 3 && options.payload.voicePolicy.maxDurationMs === 180000 && options.payload.voicePolicy.maxBytes === 12 * 1024 * 1024);

    const rawContent = "2025年5月20日，我和朋友在学校操场散步。那段时间很迷茫，但他一直陪我把话说完。";
    const analysis = await postJson(`${baseUrl}/api/analyze`, { rawContent });
    assert("本地 Mock 能生成展品草稿", analysis.response.ok && analysis.payload.mode === "mock-fallback" && analysis.payload.draft.title && analysis.payload.draft.hall);
    assert("Agent 整理保留三步轨迹", analysis.payload.workflow.steps.length === 3 && analysis.payload.workflow.run.persisted === true);
    assert("整理记录已获得可关联 ID", Boolean(analysis.payload.draft.agentRunId));

    const memoryId = `smoke-memory-${Date.now()}`;
    const created = await postJson(`${baseUrl}/api/memories`, {
      ...analysis.payload.draft,
      id: memoryId,
      favorite: true
    });
    assert("展品保存成功", created.response.status === 201 && created.payload.memory.id === memoryId);
    assert("展品关联 Agent run", created.payload.memory.agentRunId === analysis.payload.draft.agentRunId);

    const detail = await getJson(`${baseUrl}/api/memories/${memoryId}`);
    assert("展品详情可读取", detail.response.ok && detail.payload.memory.rawContent === rawContent);

    const trace = await getJson(`${baseUrl}/api/memories/${memoryId}/agent-run`);
    assert("展品可回看 Agent 依据", trace.response.ok && trace.payload.run.steps.length === 3 && trace.payload.run.memoryId === memoryId);

    const updated = await putJson(`${baseUrl}/api/memories/${memoryId}`, { title: "操场上的陪伴", importance: 5, expectedUpdatedAt: detail.payload.memory.updatedAt });
    assert("展品可更新", updated.response.ok && updated.payload.memory.title === "操场上的陪伴" && updated.payload.memory.importance === 5);

    const revisionMemoryId = `smoke-revision-${Date.now()}`;
    const revisionCreated = await postJson(`${baseUrl}/api/memories`, {
      id: revisionMemoryId, title: "年轮第一版", hall: "daily", sourceType: "日记",
      rawContent: "这是一段用于验证年轮的原文。", exhibitText: "年轮测试展签"
    });
    const initialEtag = revisionCreated.response.headers.get("etag");
    const missingPrecondition = await putJson(`${baseUrl}/api/memories/${revisionMemoryId}`, { title: "不应写入" });
    assert("展品编辑缺少版本条件时返回 428 且零写入", missingPrecondition.response.status === 428 && (await getJson(`${baseUrl}/api/memories/${revisionMemoryId}`)).payload.memory.title === "年轮第一版");
    const revisionUpdateResponse = await fetch(`${baseUrl}/api/memories/${revisionMemoryId}`, {
      method: "PUT",
      headers: writeHeaders(`${baseUrl}/api/memories/${revisionMemoryId}`, { "Content-Type": "application/json", "If-Match": initialEtag }),
      body: JSON.stringify({ title: "年轮第二版" })
    });
    const revisionUpdated = await revisionUpdateResponse.json();
    const currentEtag = revisionUpdateResponse.headers.get("etag");
    assert("匹配 If-Match 的编辑生成新版本", revisionUpdateResponse.ok && revisionUpdated.memory.title === "年轮第二版" && currentEtag && currentEtag !== initialEtag);
    const staleResponse = await fetch(`${baseUrl}/api/memories/${revisionMemoryId}`, {
      method: "PUT",
      headers: writeHeaders(`${baseUrl}/api/memories/${revisionMemoryId}`, { "Content-Type": "application/json", "If-Match": initialEtag }),
      body: JSON.stringify({ title: "过期页面不应覆盖" })
    });
    const stalePayload = await staleResponse.json();
    assert("过期 If-Match 返回 412、新 ETag 且不泄漏正文", staleResponse.status === 412 && staleResponse.headers.get("etag") === currentEtag && stalePayload.updatedAt === revisionUpdated.memory.updatedAt && !Object.hasOwn(stalePayload, "memory") && !JSON.stringify(stalePayload).includes("这是一段用于验证年轮的原文"));
    const noopResponse = await fetch(`${baseUrl}/api/memories/${revisionMemoryId}`, {
      method: "PUT",
      headers: writeHeaders(`${baseUrl}/api/memories/${revisionMemoryId}`, { "Content-Type": "application/json", "If-Match": currentEtag }),
      body: JSON.stringify({ title: "年轮第二版" })
    });
    const noopPayload = await noopResponse.json();
    const revisionList = await getJson(`${baseUrl}/api/memories/${revisionMemoryId}/revisions`);
    assert("无变化 PUT 不更新时间也不制造修订", noopResponse.ok && noopPayload.memory.updatedAt === revisionUpdated.memory.updatedAt && noopResponse.headers.get("etag") === currentEtag && revisionList.payload.revisions.length === 2);
    const revisionTimeline = await getJson(`${baseUrl}/api/revisions?limit=30`);
    const timelineRevision = revisionTimeline.payload.revisions.find((item) => item.memoryId === revisionMemoryId);
    assert("全馆年轮只下发列表所需摘要，不泄露备注、内部修订 ID 或恢复引用", timelineRevision && JSON.stringify(Object.keys(timelineRevision).sort()) === JSON.stringify(["changeKind", "createdAt", "memoryId", "memoryTitle", "revisionNo"].sort()) && !/(?:changeNote|restoredFromRevisionId|sourceUpdatedAt|snapshot)/.test(JSON.stringify(revisionTimeline.payload)));
    const initialRevision = revisionList.payload.revisions.find((item) => item.changeKind === "created");
    const revisionDetail = await getJson(`${baseUrl}/api/memories/${revisionMemoryId}/revisions/${initialRevision.id}`);
    assert("历史详情按需返回规范快照", revisionDetail.response.ok && revisionDetail.payload.revision.snapshot.title === "年轮第一版" && !Object.hasOwn(revisionDetail.payload.revision.snapshot, "agentRunId"));
    const restoreResponse = await fetch(`${baseUrl}/api/memories/${revisionMemoryId}/revisions/${initialRevision.id}/restore`, {
      method: "POST",
      headers: writeHeaders(`${baseUrl}/api/memories/${revisionMemoryId}/revisions/${initialRevision.id}/restore`, { "Content-Type": "application/json", "If-Match": currentEtag }),
      body: "{}"
    });
    const restoredRevision = await restoreResponse.json();
    const restoredRevisionList = await getJson(`${baseUrl}/api/memories/${revisionMemoryId}/revisions`);
    assert("恢复旧版复制为新的 head 且不删除历史", restoreResponse.ok && restoredRevision.memory.title === "年轮第一版" && restoredRevisionList.payload.revisions.length === 3 && restoredRevisionList.payload.revisions[0].changeKind === "restored" && restoredRevisionList.payload.revisions[0].restoredFromRevisionId === initialRevision.id);
    await deleteJson(`${baseUrl}/api/memories/${revisionMemoryId}`);

    const healthStarted = await postJson(`${baseUrl}/api/collection-health/scans`, { scope: "full" });
    let healthScan = healthStarted.payload.scan;
    for (let attempt = 0; attempt < 30 && !["completed", "cancelled", "failed"].includes(healthScan.state); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      healthScan = (await getJson(`${baseUrl}/api/collection-health/scans/${healthScan.id}`)).payload.scan;
    }
    assert("馆藏体检以只读任务核对数据库、图片和声音", healthStarted.response.status === 202 && healthScan.state === "completed" && healthScan.summary.database.status === "pass" && healthScan.summary.media.status === "pass" && healthScan.summary.voices.status === "pass" && !/(?:[a-f0-9]{64}|[A-Z]:\\)/i.test(JSON.stringify(healthScan.issues || [])));

    const search = await getJson(`${baseUrl}/api/search?mode=hybrid&query=${encodeURIComponent("朋友 陪伴")}`);
    assert("混合检索返回匹配依据", search.response.ok && search.payload.results.some((item) => item.memory.id === memoryId) && search.payload.results[0].reason);

    const guide = await postJson(`${baseUrl}/api/guide`, { question: "哪些记忆和朋友的陪伴有关？" });
    assert("讲解员回答包含展品引用", guide.response.ok && guide.payload.answer && guide.payload.citations.some((item) => item.id === memoryId));

    const insights = await getJson(`${baseUrl}/api/insights`);
    assert("回顾接口生成时间线、主题和摘要", insights.response.ok && Array.isArray(insights.payload.timeline) && Array.isArray(insights.payload.themes) && insights.payload.report.summary);

    const relatedId = `smoke-related-${Date.now()}`;
    const related = await postJson(`${baseUrl}/api/memories`, {
      id: relatedId,
      title: "后来想起操场上的陪伴",
      hall: "friends",
      sourceType: "日记",
      rawContent: "2025年5月20日，我和朋友又说起学校操场的那次散步。那段迷茫里，他一直陪伴着我。",
      exhibitText: "同一段操场往事在后来被再次写下。",
      date: "2025-05-20",
      location: "学校操场",
      people: ["朋友"],
      tags: ["陪伴", "操场", "星河湾"],
      emotions: ["温暖"],
      importance: 4
    });
    assert("可保存同一往事的第二个版本", related.response.status === 201 && related.payload.memory.id === relatedId);

    const shortClueSearch = await getJson(`${baseUrl}/api/search?q=${encodeURIComponent("学校")}`);
    const trigramClueSearch = await getJson(`${baseUrl}/api/search?q=${encodeURIComponent("星河湾")}`);
    assert("两字中文线索使用参数化 LIKE 回退", shortClueSearch.response.ok && shortClueSearch.payload.engine.shortQueryFallback === true && shortClueSearch.payload.results.some((item) => item.memory.id === relatedId));
    assert("三字中文线索使用 FTS5 trigram 且返回完整展品", trigramClueSearch.response.ok && trigramClueSearch.payload.engine.fts === "fts5-trigram" && trigramClueSearch.payload.engine.shortQueryFallback === false && trigramClueSearch.payload.results.some((item) => item.memory.id === relatedId && item.memory.rawContent));

    const peopleEntities = await getJson(`${baseUrl}/api/entities?type=person&q=${encodeURIComponent("朋友")}&limit=20`);
    assert("同名人物默认保留为不同身份线索", peopleEntities.response.ok && peopleEntities.payload.entities.length >= 2 && new Set(peopleEntities.payload.entities.map((entity) => entity.id)).size === peopleEntities.payload.entities.length);
    const [targetPerson, sourcePerson] = peopleEntities.payload.entities;
    const aliasPreview = await postJson(`${baseUrl}/api/entities/${targetPerson.id}/aliases/preview`, { alias: "老友" });
    const unconfirmedAlias = await postJson(`${baseUrl}/api/entities/${targetPerson.id}/aliases`, { alias: "老友" });
    const confirmedAlias = await postJson(`${baseUrl}/api/entities/${targetPerson.id}/aliases`, { alias: "老友", confirm: true });
    assert("实体别名必须预览并明确确认后才保存", aliasPreview.response.ok && aliasPreview.payload.requiresConfirmation === true && unconfirmedAlias.response.status === 400 && confirmedAlias.response.status === 201);
    const aliasSearch = await getJson(`${baseUrl}/api/search?q=${encodeURIComponent("老友")}`);
    assert("已确认别名可作为可解释检索线索", aliasSearch.response.ok && aliasSearch.payload.results.some((item) => item.entityRefs.some((ref) => ref.id === targetPerson.id)));
    const mergePreview = await postJson(`${baseUrl}/api/entities/${targetPerson.id}/merge/preview`, { sourceEntityId: sourcePerson.id });
    const unconfirmedMerge = await postJson(`${baseUrl}/api/entities/${targetPerson.id}/merge`, { sourceEntityId: sourcePerson.id });
    const confirmedMerge = await postJson(`${baseUrl}/api/entities/${targetPerson.id}/merge`, { sourceEntityId: sourcePerson.id, confirm: true });
    const mergedProfile = await getJson(`${baseUrl}/api/entities/${targetPerson.id}`);
    assert("同名身份合并必须预览并明确确认", mergePreview.response.ok && unconfirmedMerge.response.status === 400 && confirmedMerge.response.ok && mergedProfile.payload.entity.memories.length === 2);

    const revisitQuery = "localDate=2026-05-20&timezone=Asia%2FShanghai&limit=20";
    const onThisDay = await getJson(`${baseUrl}/api/revisits?kind=on-this-day&${revisitQuery}`);
    const longUnseen = await getJson(`${baseUrl}/api/revisits?kind=long-unseen&${revisitQuery}`);
    const randomRevisit = await getJson(`${baseUrl}/api/revisits?kind=random&${revisitQuery}`);
    assert(
      "往年今日只返回有明确周年日期的记忆",
      onThisDay.response.ok &&
        onThisDay.payload.kind === "on-this-day" &&
        onThisDay.payload.revisits.some((item) => item.memory.id === relatedId && item.basis.type === "explicit-date" && item.label === "往年今日")
    );
    assert(
      "很久没见返回可解释的未回访记忆",
      longUnseen.response.ok &&
        longUnseen.payload.kind === "long-unseen" &&
        longUnseen.payload.revisits.length === 2 &&
        longUnseen.payload.revisits.every((item) => item.basis.type === "never-viewed" && item.label === "很久没见")
    );
    assert(
      "随机漫游返回同一本地日期下的稳定候选",
      randomRevisit.response.ok &&
        randomRevisit.payload.kind === "random" &&
        randomRevisit.payload.revisits.length === 2 &&
        randomRevisit.payload.revisit?.memory.id === randomRevisit.payload.revisits[0].memory.id &&
        randomRevisit.payload.revisits.every((item) => item.basis.type === "stable-daily-rotation" && item.label === "随机漫游")
    );

    const initialIntent = await getJson(`${baseUrl}/api/revisits/${relatedId}/intent`);
    assert("单件回访意愿以无记录 neutral 起步", initialIntent.response.ok && initialIntent.payload.intent.memoryId === relatedId && initialIntent.payload.intent.choice === "neutral" && initialIntent.payload.intent.updatedAt === "");
    const welcomedIntent = await putJson(`${baseUrl}/api/revisits/${relatedId}/intent`, {
      choice: "welcome",
      notBeforeLocalDate: "",
      timezone: "",
      confirm: true
    });
    const managedIntents = await getJson(`${baseUrl}/api/revisits/intents`);
    assert("用户明确确认后可保存 welcome 意愿", welcomedIntent.response.ok && welcomedIntent.payload.action === "saved" && welcomedIntent.payload.intent.choice === "welcome");
    assert(
      "回访意愿管理列表只附带最小展品标题",
      managedIntents.response.ok &&
        managedIntents.payload.count === 1 &&
        managedIntents.payload.intents[0].memoryId === relatedId &&
        managedIntents.payload.intents[0].memory.title === related.payload.memory.title &&
        Object.keys(managedIntents.payload.intents[0].memory).sort().join(",") === "id,title"
    );
    const welcomedRevisits = await getJson(`${baseUrl}/api/revisits?kind=on-this-day&${revisitQuery}`);
    assert(
      "welcome 只在原回访资格集合内优先",
      welcomedRevisits.response.ok &&
        welcomedRevisits.payload.candidateCount === onThisDay.payload.candidateCount &&
        welcomedRevisits.payload.revisits[0].memory.id === relatedId &&
        welcomedRevisits.payload.revisits[0].intent.choice === "welcome" &&
        welcomedRevisits.payload.revisits.map((item) => item.memory.id).sort().join(",") === onThisDay.payload.revisits.map((item) => item.memory.id).sort().join(",")
    );

    const deferredIntent = await putJson(`${baseUrl}/api/revisits/${relatedId}/intent`, {
      choice: "later",
      notBeforeLocalDate: "2099-05-20",
      timezone: "Asia/Shanghai",
      confirm: true
    });
    const beforeDeferredDate = await getJson(`${baseUrl}/api/revisits?kind=on-this-day&${revisitQuery}`);
    assert("未到保存的本地日期前 later 从当前候选排除", deferredIntent.response.ok && deferredIntent.payload.intent.choice === "later" && deferredIntent.payload.intent.notBeforeLocalDate === "2099-05-20" && deferredIntent.payload.intent.timezone === "Asia/Shanghai" && !beforeDeferredDate.payload.revisits.some((item) => item.memory.id === relatedId) && beforeDeferredDate.payload.revisits.some((item) => item.memory.id === memoryId));
    const pausedIntent = await putJson(`${baseUrl}/api/revisits/${relatedId}/intent`, {
      choice: "pause",
      notBeforeLocalDate: "",
      timezone: "",
      confirm: true
    });
    const whilePaused = await getJson(`${baseUrl}/api/revisits?kind=on-this-day&${revisitQuery}`);
    assert("暂停意愿在用户恢复前排除主动回访", pausedIntent.response.ok && pausedIntent.payload.intent.choice === "pause" && !whilePaused.payload.revisits.some((item) => item.memory.id === relatedId));
    const neutralIntent = await putJson(`${baseUrl}/api/revisits/${relatedId}/intent`, {
      choice: "neutral",
      notBeforeLocalDate: "",
      timezone: "",
      confirm: true
    });
    const neutralIntentReadback = await getJson(`${baseUrl}/api/revisits/${relatedId}/intent`);
    const emptyIntentManager = await getJson(`${baseUrl}/api/revisits/intents`);
    assert("恢复 neutral 会物理清除长期意愿记录", neutralIntent.response.ok && neutralIntent.payload.action === "cleared" && neutralIntentReadback.payload.intent.choice === "neutral" && emptyIntentManager.payload.count === 0);

    const revisitContext = { localDate: "2026-05-20", timezone: "Asia/Shanghai" };
    const viewedRevisit = await postJson(`${baseUrl}/api/revisits/${memoryId}/viewed`, revisitContext);
    const dismissedRevisit = await postJson(`${baseUrl}/api/revisits/${relatedId}/dismissed`, revisitContext);
    assert("打开回访会记录本地日期和回访次数", viewedRevisit.response.ok && viewedRevisit.payload.action === "viewed" && viewedRevisit.payload.state.lastViewedLocalDate === revisitContext.localDate && viewedRevisit.payload.state.viewCount === 1);
    assert("略过回访只保存当日本地隐藏状态", dismissedRevisit.response.ok && dismissedRevisit.payload.action === "dismissed" && dismissedRevisit.payload.state.dismissedLocalDate === revisitContext.localDate && dismissedRevisit.payload.state.viewCount === 0);
    const handledToday = await getJson(`${baseUrl}/api/revisits?kind=random&${revisitQuery}`);
    assert("同一天已打开或略过的记忆不会重复出现", handledToday.response.ok && handledToday.payload.candidateCount === 0 && handledToday.payload.revisits.length === 0);
    const exportIntent = await putJson(`${baseUrl}/api/revisits/${relatedId}/intent`, {
      choice: "later",
      notBeforeLocalDate: "2027-05-20",
      timezone: "Asia/Shanghai",
      confirm: true
    });
    assert("馆藏导出前保留一条用户确认的 later 意愿", exportIntent.response.ok && exportIntent.payload.intent.choice === "later");

    const exhibitionPreview = await postJson(`${baseUrl}/api/exhibitions/preview`, {
      theme: "操场上的陪伴",
      memoryIds: [memoryId, relatedId]
    });
    assert("主题策展预览返回完整章节和原文引用", exhibitionPreview.response.ok && exhibitionPreview.payload.preview.sections.flatMap((section) => section.items).length === 2 && exhibitionPreview.payload.preview.sections.every((section) => section.items.every((item) => item.citations.every((citation) => citation.evidenceValid))));
    const unconfirmedExhibition = await postJson(`${baseUrl}/api/exhibitions`, exhibitionPreview.payload.preview);
    assert("主题展览保存要求用户明确确认", unconfirmedExhibition.response.status === 400);
    const savedExhibition = await postJson(`${baseUrl}/api/exhibitions`, {
      ...exhibitionPreview.payload.preview,
      confirm: true
    });
    const exhibitionId = savedExhibition.payload.exhibition.id;
    assert("核对后的主题展览可保存", savedExhibition.response.status === 201 && exhibitionId);
    const exhibitionList = await getJson(`${baseUrl}/api/exhibitions`);
    const exhibitionDetail = await getJson(`${baseUrl}/api/exhibitions/${exhibitionId}`);
    assert("主题展览书架和阅读详情可用", exhibitionList.payload.exhibitions.some((item) => item.id === exhibitionId) && exhibitionDetail.payload.exhibition.memoryIds.length === 2);
    const updatedExhibition = await putJson(`${baseUrl}/api/exhibitions/${exhibitionId}`, {
      ...exhibitionPreview.payload.preview,
      title: "操场上的两次回望",
      confirm: true
    });
    assert("主题展览可在再次确认后更新", updatedExhibition.response.ok && updatedExhibition.payload.exhibition.title === "操场上的两次回望");

    await runLocalMediaFlow(baseUrl, memoryId, relatedId, mediaRoot);

    const routes = await getJson(`${baseUrl}/api/archaeology/routes?focus=${memoryId}`);
    const routeMatch = routes.payload.route.connections.find((item) => item.memory.id === relatedId);
    assert("记忆航线返回可解释关联且不自动认定同一事件", routes.response.ok && routeMatch?.reasons.length && routeMatch.sameEvent === "unassessed" && routeMatch.requiresConfirmation === true);

    const puzzle = await getJson(`${baseUrl}/api/archaeology/puzzle?memoryId=${memoryId}&relatedId=${relatedId}`);
    const validSources = [...puzzle.payload.puzzle.stable, ...puzzle.payload.puzzle.differs, ...puzzle.payload.puzzle.additions]
      .flatMap((item) => item.sources || [])
      .filter((source) => source.valid);
    assert("时光拼图只展示可回到原文的证据", puzzle.response.ok && validSources.length > 0 && puzzle.payload.puzzle.guidance.includes("缺失") && puzzle.payload.question.allowUnknown === true);

    const confirmedEvent = await postJson(`${baseUrl}/api/archaeology/events`, { memoryIds: [memoryId, relatedId] });
    assert("用户确认后才保存同一往事关系", confirmedEvent.response.status === 201 && confirmedEvent.payload.event.versionCount === 2);

    const overview = await getJson(`${baseUrl}/api/archaeology/overview`);
    const pairedOverview = overview.payload.overview.filter((item) => [memoryId, relatedId].includes(item.memoryId));
    assert("馆藏概览标记两个记忆版本", overview.response.ok && pairedOverview.length === 2 && pairedOverview.every((item) => item.versionCount === 2));

    const question = await postJson(`${baseUrl}/api/archaeology/questions`, {
      memoryId,
      relatedId,
      action: "keep_unknown"
    });
    assert("补一块拼图允许明确保留不确定", question.response.status === 201 && question.payload.question.status === "unknown" && question.payload.question.answer === "");

    const unlinked = await deleteJson(`${baseUrl}/api/archaeology/events/${confirmedEvent.payload.event.id}`);
    const unlinkedPuzzle = await getJson(`${baseUrl}/api/archaeology/puzzle?memoryId=${memoryId}&relatedId=${relatedId}`);
    assert("用户可以解除版本分组且保留两段原文", unlinked.response.ok && unlinked.payload.overview.filter((item) => [memoryId, relatedId].includes(item.memoryId)).every((item) => item.versionCount === 1));
    assert("解除分组后已处理的补问仍然保留", unlinkedPuzzle.payload.event === null && unlinkedPuzzle.payload.savedQuestions.some((item) => item.status === "unknown"));

    const reconfirmedEvent = await postJson(`${baseUrl}/api/archaeology/events`, { memoryIds: [memoryId, relatedId] });
    assert("解除后仍可由用户重新确认版本关系", reconfirmedEvent.response.status === 201 && reconfirmedEvent.payload.event.versionCount === 2);

    const privacy = await getJson(`${baseUrl}/api/privacy`);
    assert("隐私接口说明本地数据位置", privacy.response.ok && privacy.payload.mode === "local-first" && privacy.payload.dataLocations.length >= 3);
    assert("隐私接口说明实体同名不自动认定且变更需确认", privacy.payload.dataLocations.some((item) => item.name.includes("实体线索") && item.location.includes("同名默认只是线索")) && privacy.payload.controls.some((item) => item.includes("先预览")));
    assert("隐私接口说明胶囊分表与口令零上传", privacy.payload.dataLocations.some((item) => item.name.includes("时光胶囊") && item.location.includes("不发送给服务端") && item.location.includes("不写入导出文件")));

    const fullExport = await getJson(`${baseUrl}/api/memories/export`);
    assert("馆藏备份保留品牌和原文", fullExport.response.ok && fullExport.payload.product === "时屿" && fullExport.payload.productEnglish === "TIME ISLE" && fullExport.payload.memories.some((memory) => memory.rawContent === rawContent));
    assert("馆藏备份包含版本组、证据和补问", fullExport.payload.archaeology.events.length === 1 && fullExport.payload.archaeology.claims.length > 0 && fullExport.payload.archaeology.questions.length === 1);
    assert("馆藏备份包含已确认主题展览", fullExport.payload.exhibitions.exhibitions.some((item) => item.id === exhibitionId));
    assert("馆藏备份包含回访与当日隐藏状态", fullExport.payload.revisits.mode === "full" && fullExport.payload.revisits.states.length === 2 && fullExport.payload.revisits.states.some((state) => state.memoryId === memoryId && state.viewCount === 1) && fullExport.payload.revisits.states.some((state) => state.memoryId === relatedId && state.dismissedLocalDate === "2026-05-20"));
    assert("馆藏完整备份包含非空 later 回访意愿", fullExport.payload.revisitIntents.mode === "full" && fullExport.payload.revisitIntents.schemaVersion === 11 && fullExport.payload.revisitIntents.intents.length === 1 && fullExport.payload.revisitIntents.intents[0].memoryId === relatedId && fullExport.payload.revisitIntents.intents[0].intent === "later" && fullExport.payload.revisitIntents.intents[0].notBeforeLocalDate === "2027-05-20" && fullExport.payload.revisitIntents.intents[0].notBeforeTimezone === "Asia/Shanghai");
    assert("schema 11 馆藏备份包含实体、声音、胶囊、修订与回访意愿边界", fullExport.payload.schemaVersion === 11 && fullExport.payload.entities.mode === "full" && fullExport.payload.entities.entities.some((entity) => entity.aliases.some((alias) => alias.alias === "老友")) && fullExport.payload.voices.mode === "full" && fullExport.payload.capsules.mode === "full" && fullExport.payload.revisions.mode === "full" && fullExport.payload.revisitIntents.mode === "full");

    await putJson(`${baseUrl}/api/memories/${memoryId}`, { rawContent: "这段原文已被重新整理，不再包含此前的日期、人物或地点线索。", expectedUpdatedAt: updated.payload.memory.updatedAt });
    const revalidatedExport = await getJson(`${baseUrl}/api/memories/export`);
    const revisedClaims = revalidatedExport.payload.archaeology.claims.filter((claim) => claim.memoryId === memoryId);
    assert("编辑原文会重新校验并失效旧证据锚点", revisedClaims.length > 0 && revisedClaims.every((claim) => claim.evidenceValid === false && claim.status === "source_invalidated"));
    const revisedExhibition = revalidatedExport.payload.exhibitions.exhibitions.find((item) => item.id === exhibitionId);
    assert("编辑原文会让相关主题展览回到待复核草稿", revisedExhibition.requiresConfirmation === true && revisedExhibition.status === "draft" && revisedExhibition.sections.flatMap((section) => section.items).flatMap((item) => item.citations).some((citation) => citation.evidenceValid === false));

    const redactedExport = await getJson(`${baseUrl}/api/memories/export?mode=redacted`);
    const redacted = redactedExport.payload.memories.find((memory) => memory.id === memoryId);
    assert("脱敏备份隐藏原文和地点", redactedExport.response.ok && redacted.rawContent.includes("已隐藏") && redacted.location.includes("已隐藏"));
    assert("脱敏备份物理排除主题展览叙事和引用", redactedExport.payload.exhibitions.mode === "redacted-summary" && !redactedExport.payload.exhibitions.exhibitions);
    const redactedRevisits = JSON.stringify(redactedExport.payload.revisits);
    assert("脱敏备份只保留回访汇总且移除展品 ID 与精确时间", redactedExport.payload.revisits.mode === "redacted-summary" && redactedExport.payload.revisits.stateCount === 2 && !redactedExport.payload.revisits.states && !redactedRevisits.includes(memoryId) && !redactedRevisits.includes("lastViewedAt"));
    const redactedRevisitIntents = JSON.stringify(redactedExport.payload.revisitIntents);
    assert(
      "脱敏回访意愿只保留计数摘要且物理排除 ID、选择、日期与时区",
      redactedExport.payload.revisitIntents.mode === "redacted-summary" &&
        redactedExport.payload.revisitIntents.intentCount === 1 &&
        Object.keys(redactedExport.payload.revisitIntents).sort().join(",") === "intentCount,mode,note" &&
        !/(?:memoryId|choice|notBeforeLocalDate|timezone|updatedAt|intents)/i.test(redactedRevisitIntents) &&
        !redactedRevisitIntents.includes(relatedId) &&
        !redactedRevisitIntents.includes("later") &&
        !redactedRevisitIntents.includes("2027-05-20") &&
        !redactedRevisitIntents.includes("Asia/Shanghai")
    );
    const redactedEntities = JSON.stringify(redactedExport.payload.entities);
    assert("脱敏实体摘要物理排除名称、别名、ID、关系和精确时间", redactedExport.payload.entities.mode === "redacted-summary" && !redactedEntities.includes("老友") && !redactedEntities.includes(targetPerson.id) && !/(?:canonicalName|aliases|memoryLinks|confirmedAt)/.test(redactedEntities));
    const redactedSerialized = JSON.stringify(redactedExport.payload);
    assert("整份脱敏导出以展品字段白名单排除实体引用与 Agent 内部 ID", redacted.entityRefs.length === 0 && redacted.agentRunId === "" && !redactedSerialized.includes("老友") && !redactedSerialized.includes(targetPerson.id) && !/(?:canonicalName|mentionText|sourceValue|agentRunId\":\"[^\"])/.test(redactedSerialized));
    assert("脱敏胶囊摘要物理排除标题、日期、来源、快照与内部 ID", redactedExport.payload.capsules.mode === "redacted-summary" && redactedExport.payload.capsules.capsuleCount === 0 && !Object.hasOwn(redactedExport.payload.capsules, "capsules") && !/(?:title|opensOn|snapshot|exhibitionId|assetId)/.test(JSON.stringify(redactedExport.payload.capsules)));
    assert("脱敏记忆年轮只保留计数并物理排除旧正文、哈希、时间与内部 ID", redactedExport.payload.revisions.mode === "redacted-summary" && !Object.hasOwn(redactedExport.payload.revisions, "revisions") && !/(?:rawContent|snapshot|sha256|createdAt|memoryId|changeNote)/i.test(JSON.stringify(redactedExport.payload.revisions)));

    const redactedImportId = `redacted-import-${Date.now()}`;
    const redactedImport = await postJson(`${baseUrl}/api/memories/import`, {
      schemaVersion: 7,
      mode: "redacted",
      memories: [{ id: redactedImportId, title: "脱敏占位", people: ["[已隐藏人物]"], rawContent: "[已隐藏原始记忆]" }],
      entities: redactedExport.payload.entities
    });
    const redactedImportDetail = await getJson(`${baseUrl}/api/memories/${redactedImportId}`);
    assert("脱敏 JSON 导入不从占位文字制造实体", redactedImport.response.ok && redactedImport.payload.entities.entities === 0 && redactedImportDetail.payload.memory.entityRefs.length === 0);
    await deleteJson(`${baseUrl}/api/memories/${redactedImportId}`);

    const imported = await postJson(`${baseUrl}/api/memories/import`, {
      memories: [{ ...created.payload.memory, id: `imported-${Date.now()}`, title: "导入验证展品" }]
    });
    assert("JSON 记忆可导入", imported.response.ok && imported.payload.imported === 1);
    assert("导入副本不会错误复用 Agent run", imported.payload.memories.find((memory) => memory.title === "导入验证展品")?.agentRunId === "");

    const largeCompatibilityImport = await postJson(`${baseUrl}/api/memories/import`, {
      memories: [],
      privacy: "x".repeat(2 * 1024 * 1024 + 1)
    });
    assert("JSON 兼容导入可接回超过普通 API 2 MiB 上限的自身导出", largeCompatibilityImport.response.ok && largeCompatibilityImport.payload.imported === 0);

    const invalidJson = await fetch(`${baseUrl}/api/memories`, {
      method: "POST",
      headers: writeHeaders(`${baseUrl}/api/memories`, { "Content-Type": "application/json" }),
      body: "{broken"
    });
    assert("无效 JSON 得到明确错误", invalidJson.status === 400);

    const rejectedContentType = await fetch(`${baseUrl}/api/memories`, {
      method: "POST",
      headers: writeHeaders(`${baseUrl}/api/memories`, { "Content-Type": "text/plain" }),
      body: JSON.stringify({ title: "跨站简单请求" })
    });
    assert("写入接口拒绝非 JSON Content-Type", rejectedContentType.status === 415);

    const deleteRelatedResponse = await fetch(`${baseUrl}/api/memories/${relatedId}`, {
      method: "DELETE",
      headers: writeHeaders(`${baseUrl}/api/memories/${relatedId}`)
    });
    const afterVersionDelete = await getJson(`${baseUrl}/api/memories/export`);
    assert("删除一个版本后保留归属于剩余记忆的补问", deleteRelatedResponse.ok && afterVersionDelete.payload.archaeology.events.length === 0 && afterVersionDelete.payload.archaeology.questions.length === 1);

    const deleteResponse = await fetch(`${baseUrl}/api/memories/${memoryId}`, {
      method: "DELETE",
      headers: writeHeaders(`${baseUrl}/api/memories/${memoryId}`)
    });
    assert("本地展品可删除", deleteResponse.ok);

    const purgeMemoryIds = [`purge-a-${Date.now()}`, `purge-b-${Date.now()}`];
    for (const [index, id] of purgeMemoryIds.entries()) {
      await postJson(`${baseUrl}/api/memories`, {
        id,
        title: `清空验证展品 ${index + 1}`,
        rawContent: `这是清空主题展览前的第 ${index + 1} 段可引用原文。`,
        exhibitText: "只用于验证整馆清空。"
      });
    }
    const purgePreview = await postJson(`${baseUrl}/api/exhibitions/preview`, { theme: "清空验证", memoryIds: purgeMemoryIds });
    const purgeExhibition = await postJson(`${baseUrl}/api/exhibitions`, { ...purgePreview.payload.preview, confirm: true });
    assert("清空前存在可验证的主题展览", purgeExhibition.response.status === 201);
    const purgeRevisit = await postJson(`${baseUrl}/api/revisits/${purgeMemoryIds[0]}/viewed`, { localDate: "2026-06-01", timezone: "Asia/Shanghai" });
    assert("清空前存在可验证的回访状态", purgeRevisit.response.ok && purgeRevisit.payload.state.viewCount === 1);

    const rejectedPurge = await fetch(`${baseUrl}/api/memories/purge`, {
      method: "DELETE",
      headers: writeHeaders(`${baseUrl}/api/memories/purge`, { "Content-Type": "application/json" }),
      body: JSON.stringify({ confirm: "NO" })
    });
    assert("清空操作要求明确确认", rejectedPurge.status === 400);

    const purge = await deleteJson(`${baseUrl}/api/memories/purge`, { confirm: "DELETE" });
    assert("确认后可清空本地馆藏、回访与实体索引", purge.response.ok && purge.payload.ok === true && purge.payload.purge.revisitStatesDeleted === 1 && purge.payload.purge.entitiesDeleted > 0 && purge.payload.purge.searchDocumentsDeleted > 0);
    const exhibitionsAfterPurge = await getJson(`${baseUrl}/api/exhibitions`);
    assert("清空馆藏不会残留主题展览", exhibitionsAfterPurge.payload.exhibitions.length === 0);
    const revisitsAfterPurge = await getJson(`${baseUrl}/api/revisits?kind=random&localDate=2026-06-01&timezone=Asia%2FShanghai&limit=20`);
    assert("清空馆藏不会残留可见回访候选", revisitsAfterPurge.response.ok && revisitsAfterPurge.payload.candidateCount === 0 && revisitsAfterPurge.payload.revisits.length === 0);

    const restored = await postJson(`${baseUrl}/api/memories/import`, revalidatedExport.payload);
    assert("馆藏备份可恢复记忆考古、主题展览、回访、意愿、年轮与实体图", restored.response.ok && restored.payload.archaeology.events === 1 && restored.payload.archaeology.claims > 0 && restored.payload.archaeology.questions === 1 && restored.payload.exhibitions.exhibitions === 1 && restored.payload.revisits.states === 2 && restored.payload.revisitIntents.intents === 1 && restored.payload.revisions.revisions === revalidatedExport.payload.revisions.revisions.length && restored.payload.entities.entities > 0 && restored.payload.entities.aliases > 0);
    const restoredOverview = await getJson(`${baseUrl}/api/archaeology/overview`);
    assert("恢复后两个版本仍属于同一时光拼图", restoredOverview.payload.overview.filter((item) => [memoryId, relatedId].includes(item.memoryId)).length === 2 && restoredOverview.payload.overview.filter((item) => [memoryId, relatedId].includes(item.memoryId)).every((item) => item.versionCount === 2));
    const restoredExhibitionId = restored.payload.exhibitions.idMap[exhibitionId];
    const restoredExhibition = await getJson(`${baseUrl}/api/exhibitions/${restoredExhibitionId}`);
    assert("JSON 恢复会重写展览成员并保留待复核状态", restoredExhibition.response.ok && restoredExhibition.payload.exhibition.requiresConfirmation === true && restoredExhibition.payload.exhibition.memoryIds.length === 2);
    const revisitsAfterJsonRestore = await getJson(`${baseUrl}/api/revisits?kind=random&${revisitQuery}`);
    assert("JSON 恢复会重写回访展品 ID 并保留同日去重状态", restored.payload.revisits.idMap[memoryId] === memoryId && restored.payload.revisits.idMap[relatedId] === relatedId && revisitsAfterJsonRestore.response.ok && revisitsAfterJsonRestore.payload.candidateCount === 0);
    const intentAfterJsonRestore = await getJson(`${baseUrl}/api/revisits/${restored.payload.revisitIntents.idMap[relatedId]}/intent`);
    assert("JSON 恢复会重写回访意愿 ID 并保留 later 日期时区", restored.payload.revisitIntents.idMap[relatedId] === relatedId && intentAfterJsonRestore.response.ok && intentAfterJsonRestore.payload.intent.choice === "later" && intentAfterJsonRestore.payload.intent.notBeforeLocalDate === "2027-05-20" && intentAfterJsonRestore.payload.intent.timezone === "Asia/Shanghai");
    const deletedExhibition = await deleteJson(`${baseUrl}/api/exhibitions/${restoredExhibitionId}`);
    assert("主题展览可独立删除且不删除来源展品", deletedExhibition.response.ok && (await getJson(`${baseUrl}/api/memories/${memoryId}`)).response.ok);

    const beforeRejectedImport = await getJson(`${baseUrl}/api/memories`);
    const futureSchema = await postJson(`${baseUrl}/api/memories/import`, {
      schemaVersion: 12,
      mode: "full",
      memories: [{ ...created.payload.memory, id: "future-schema-memory" }],
      entities: { mode: "full", schemaVersion: 7, entities: [] }
    });
    const missingEntities = await postJson(`${baseUrl}/api/memories/import`, {
      schemaVersion: 7,
      mode: "full",
      memories: [{ ...created.payload.memory, id: "missing-entities-memory" }]
    });
    const missingVoices = await postJson(`${baseUrl}/api/memories/import`, {
      schemaVersion: 8,
      mode: "full",
      memories: [{ ...created.payload.memory, id: "missing-voices-memory" }],
      entities: { mode: "full", schemaVersion: 7, entities: [] }
    });
    const missingCapsules = await postJson(`${baseUrl}/api/memories/import`, {
      schemaVersion: 9,
      mode: "full",
      memories: [{ ...created.payload.memory, id: "missing-capsules-memory" }],
      entities: { mode: "full", schemaVersion: 7, entities: [] },
      voices: revalidatedExport.payload.voices
    });
    const missingRevisions = await postJson(`${baseUrl}/api/memories/import`, {
      schemaVersion: 10,
      mode: "full",
      memories: [{ ...created.payload.memory, id: "missing-revisions-memory" }],
      entities: { mode: "full", schemaVersion: 7, entities: [] },
      voices: revalidatedExport.payload.voices,
      capsules: revalidatedExport.payload.capsules
    });
    const nullRevisitIntents = await postJson(`${baseUrl}/api/memories/import`, {
      ...revalidatedExport.payload,
      revisitIntents: null
    });
    assert("JSON 导入拒绝未来 schema、缺失必需 section 及 schema 11 的 null 回访意愿", futureSchema.response.status === 400 && missingEntities.response.status === 400 && missingVoices.response.status === 400 && missingCapsules.response.status === 400 && missingRevisions.response.status === 400 && nullRevisitIntents.response.status === 400);
    const rejectedArchive = await postJson(`${baseUrl}/api/memories/import`, {
      memories: [{ ...created.payload.memory, id: "corrupt-archive-memory" }],
      archaeology: { mode: "full", events: [null], claims: [], pairDecisions: [], questions: [] }
    });
    const afterRejectedImport = await getJson(`${baseUrl}/api/memories`);
    assert("损坏的考古备份在写入前被拒绝", rejectedArchive.response.status === 400 && afterRejectedImport.payload.memories.length === beforeRejectedImport.payload.memories.length);
    });
  } finally {
    removeDatabase(dbPath);
    removeDirectory(mediaRoot);
  }
}

async function runLocalMediaFlow(baseUrl, memoryId, relatedId, mediaRoot) {
  const original = createPng(640, 360);
  const display = createWebp(320, 180);
  const thumb = createWebp(120, 80);
  const originalHash = sha256(original);

  const firstUpload = await uploadOriginal(baseUrl, original, {
    fileName: "操场合影.png",
    mimeType: "image/png",
    privacyMode: "preserve_original"
  });
  assert(
    "原图可通过二进制接口进入暂存区",
    firstUpload.response.status === 201 &&
      firstUpload.payload.upload.source.mimeType === "image/png" &&
      firstUpload.payload.upload.source.width === 640 &&
      firstUpload.payload.upload.source.height === 360 &&
      firstUpload.payload.upload.source.sha256 === originalHash &&
      firstUpload.payload.upload.readyToFinalize === false
  );
  const uploadId = firstUpload.payload.upload.uploadId;

  const displayUpload = await putMediaBytes(
    `${baseUrl}/api/media/uploads/${uploadId}/display`,
    display,
    "image/webp"
  );
  assert(
    "展示图以 WebP 写入且不能单独完成上传",
    displayUpload.response.ok &&
      displayUpload.payload.upload.variants.display.width === 320 &&
      displayUpload.payload.upload.variants.display.height === 180 &&
      displayUpload.payload.upload.readyToFinalize === false
  );

  const thumbUpload = await putMediaBytes(
    `${baseUrl}/api/media/uploads/${uploadId}/thumb`,
    thumb,
    "image/webp"
  );
  assert(
    "缩略图写入后上传会话进入可完成状态",
    thumbUpload.response.ok &&
      thumbUpload.payload.upload.variants.thumb.width === 120 &&
      thumbUpload.payload.upload.variants.thumb.height === 80 &&
      thumbUpload.payload.upload.readyToFinalize === true
  );

  const completed = await postJson(`${baseUrl}/api/media/uploads/${uploadId}/complete`, {});
  assert(
    "完整上传生成内容寻址媒体资产",
    completed.response.status === 201 &&
      completed.payload.deduplicated === false &&
      completed.payload.media.contentSha256 === originalHash &&
      completed.payload.media.urls.original &&
      completed.payload.media.urls.display &&
      completed.payload.media.urls.thumb
  );
  const asset = completed.payload.media;

  const duplicateUpload = await uploadOriginal(baseUrl, original, {
    fileName: "同一张照片的副本.png",
    mimeType: "image/png"
  });
  const duplicateUploadId = duplicateUpload.payload.upload.uploadId;
  await putMediaBytes(`${baseUrl}/api/media/uploads/${duplicateUploadId}/display`, display, "image/webp");
  await putMediaBytes(`${baseUrl}/api/media/uploads/${duplicateUploadId}/thumb`, thumb, "image/webp");
  const deduplicated = await postJson(`${baseUrl}/api/media/uploads/${duplicateUploadId}/complete`, {});
  assert(
    "相同原图 SHA-256 只复用一份媒体资产",
    deduplicated.response.status === 200 &&
      deduplicated.payload.deduplicated === true &&
      deduplicated.payload.media.id === asset.id &&
      deduplicated.payload.media.contentSha256 === originalHash
  );

  const gcTriggerId = `media-gc-trigger-${Date.now()}`;
  await postJson(`${baseUrl}/api/memories`, { id: gcTriggerId, title: "媒体清理触发器", rawContent: "验证刚完成上传的图片不会被并发清理。" });
  const gcTriggerDelete = await fetch(`${baseUrl}/api/memories/${gcTriggerId}`, {
    method: "DELETE",
    headers: writeHeaders(`${baseUrl}/api/memories/${gcTriggerId}`)
  });
  const freshAssetAfterGc = await fetch(`${baseUrl}${asset.urls.display}`);
  assert("新完成但尚未关联的媒体享有清理宽限期", gcTriggerDelete.ok && freshAssetAfterGc.ok);

  const displayResponse = await fetch(`${baseUrl}${asset.urls.display}`);
  const displayBody = Buffer.from(await displayResponse.arrayBuffer());
  const etag = displayResponse.headers.get("etag");
  assert(
    "GET 可读取派生图、返回内容型 ETag 且禁浏览器缓存",
    displayResponse.ok &&
      displayResponse.headers.get("content-type") === "image/webp" &&
      displayResponse.headers.get("content-length") === String(display.length) &&
      displayResponse.headers.get("cache-control") === "private, no-store" &&
      displayBody.equals(display) &&
      etag === `"sha256-${sha256(display)}"`
  );

  const headResponse = await fetch(`${baseUrl}${asset.urls.display}`, { method: "HEAD" });
  const headBody = Buffer.from(await headResponse.arrayBuffer());
  assert(
    "HEAD 返回与 GET 一致的媒体元数据且没有响应体",
    headResponse.ok &&
      headResponse.headers.get("etag") === etag &&
      headResponse.headers.get("content-length") === String(display.length) &&
      headBody.length === 0
  );

  const notModified = await fetch(`${baseUrl}${asset.urls.display}`, {
    headers: { "If-None-Match": etag }
  });
  assert("匹配 ETag 的媒体请求返回 304", notModified.status === 304 && (await notModified.arrayBuffer()).byteLength === 0);

  const originalResponse = await fetch(`${baseUrl}${asset.urls.original}`);
  const originalBody = Buffer.from(await originalResponse.arrayBuffer());
  assert(
    "原图可读取但使用私有禁缓存策略",
    originalResponse.ok &&
      originalResponse.headers.get("content-type") === "image/png" &&
      originalResponse.headers.get("cache-control") === "private, no-store" &&
      originalBody.equals(original)
  );

  const attached = await postJson(`${baseUrl}/api/memories/${memoryId}/media`, {
    assetId: asset.id,
    role: "cover",
    caption: "第一次写下的照片说明",
    altText: "两个人沿着操场慢慢散步",
    backNote: "照片背面写着：谢谢你陪我把话说完。"
  });
  assert(
    "媒体资产可关联展品并成为封面",
    attached.response.status === 201 &&
      attached.payload.media.assetId === asset.id &&
      attached.payload.media.role === "cover" &&
      attached.payload.collection.length === 1
  );

  const updated = await putJson(`${baseUrl}/api/memories/${memoryId}/media/${asset.id}`, {
    role: "cover",
    caption: "操场上的陪伴",
    altText: "傍晚的学校操场上，两位朋友并肩散步",
    backNote: "照片没有替回忆下结论，只保存当时留下的画面。"
  });
  assert(
    "照片说明、无障碍文本、背面故事与封面角色可更新",
    updated.response.ok &&
      updated.payload.media.role === "cover" &&
      updated.payload.media.caption === "操场上的陪伴" &&
      updated.payload.media.altText.includes("两位朋友") &&
      updated.payload.media.backNote.includes("没有替回忆下结论")
  );

  const replaced = await putJson(`${baseUrl}/api/memories/${memoryId}/media`, {
    items: [{
      assetId: asset.id,
      role: "cover",
      position: 0,
      caption: "前端批量保存的照片说明",
      altText: "傍晚操场上的两位朋友",
      backNote: "由真实前端序列化结构重新保存。",
      metadata: { capturedAt: "2024-06-18T18:30" }
    }]
  });
  assert(
    "前端含 position 的真实图片 PUT 结构可批量保存",
    replaced.response.ok &&
      replaced.payload.collection.length === 1 &&
      replaced.payload.collection[0].assetId === asset.id &&
      replaced.payload.collection[0].position === 0 &&
      replaced.payload.collection[0].caption === "前端批量保存的照片说明"
  );

  const unknownReplacementField = await putJson(`${baseUrl}/api/memories/${memoryId}/media`, {
    items: [{ assetId: asset.id, role: "cover", position: 0, unexpected: true }]
  });
  assert(
    "批量图片 PUT 的未知字段返回 400 而不是服务端错误",
    unknownReplacementField.response.status === 400 && /未知字段/.test(unknownReplacementField.payload.error)
  );

  const contradictoryPosition = await putJson(`${baseUrl}/api/memories/${memoryId}/media`, {
    items: [{ assetId: asset.id, role: "cover", position: 1 }]
  });
  assert(
    "批量图片 PUT 的矛盾 position 返回 400 而不是服务端错误",
    contradictoryPosition.response.status === 400 && /position/.test(contradictoryPosition.payload.error)
  );

  const memoryWithMedia = await getJson(`${baseUrl}/api/memories/${memoryId}`);
  assert(
    "展品详情汇总封面、媒体数量和可用缩略图地址",
    memoryWithMedia.response.ok &&
      memoryWithMedia.payload.memory.media.length === 1 &&
      memoryWithMedia.payload.memory.mediaSummary.count === 1 &&
      memoryWithMedia.payload.memory.mediaSummary.coverAssetId === asset.id &&
      memoryWithMedia.payload.memory.media[0].urls.thumb === asset.urls.thumb &&
      memoryWithMedia.payload.memory.media[0].caption === "前端批量保存的照片说明" &&
      memoryWithMedia.payload.memory.mediaSummary.coverThumbnailUrl === asset.urls.thumb
  );

  const annotationsUrl = `${baseUrl}/api/memories/${memoryId}/media/${asset.id}/annotations`;
  const createdAnnotation = await postJson(annotationsUrl, {
    region: { x: 0.125, y: 0.2, width: 0.5, height: 0.4 },
    regionType: "location",
    label: "操场边的旧看台",
    note: "由用户亲手圈选并确认",
    sensitive: false
  });
  const annotation = createdAnnotation.payload.annotation;
  assert(
    "用户可创建带来源哈希的图片区域证据",
    createdAnnotation.response.status === 201 &&
      annotation.assetId === asset.id &&
      annotation.memoryId === memoryId &&
      annotation.sourceHash === `sha256:${originalHash}` &&
      annotation.integrityStatus === "source_verified" &&
      annotation.semanticStatus === "user_confirmed" &&
      annotation.locator.coordinateSpace === "canonical-preview-v1" &&
      annotation.media.urls.display === asset.urls.display
  );

  const listedAnnotations = await getJson(annotationsUrl);
  assert(
    "图片区域证据列表只返回当前展品已确认的标注",
    listedAnnotations.response.ok &&
      listedAnnotations.payload.annotations.length === 1 &&
      listedAnnotations.payload.annotations[0].id === annotation.id &&
      listedAnnotations.payload.annotations[0].label === "操场边的旧看台"
  );

  const invalidAnnotation = await postJson(annotationsUrl, {
    region: { x: 0.9, y: 0.1, width: 0.2, height: 0.5 },
    regionType: "object",
    label: "超出图片边界的区域"
  });
  assert("图片区域坐标越界时返回 400", invalidAnnotation.response.status === 400);

  const annotationUrl = `${annotationsUrl}/${annotation.id}`;
  const updatedAnnotation = await putJson(annotationUrl, {
    region: { x: 0.2, y: 0.25, width: 0.45, height: 0.5 },
    regionType: "object",
    label: "看台旁留下的长椅",
    note: "用户复核后调整了圈选范围",
    sensitive: true
  });
  assert(
    "图片区域证据可更新坐标、类型和敏感标记",
    updatedAnnotation.response.ok &&
      updatedAnnotation.payload.annotation.id === annotation.id &&
      updatedAnnotation.payload.annotation.regionType === "object" &&
      updatedAnnotation.payload.annotation.label === "看台旁留下的长椅" &&
      updatedAnnotation.payload.annotation.sensitive === true &&
      updatedAnnotation.payload.annotation.locator.x === 0.2 &&
      updatedAnnotation.payload.annotation.locator.y === 0.25 &&
      updatedAnnotation.payload.annotation.locator.width === 0.45 &&
      updatedAnnotation.payload.annotation.locator.height === 0.5
  );

  const evidencePuzzle = await getJson(
    `${baseUrl}/api/archaeology/puzzle?memoryId=${encodeURIComponent(memoryId)}&relatedId=${encodeURIComponent(relatedId)}`
  );
  const puzzleImageEvidence = evidencePuzzle.payload.imageEvidence?.left?.find((item) => item.id === annotation.id);
  assert(
    "时光拼图保留图片证据的哈希、坐标与用户确认语义",
    evidencePuzzle.response.ok &&
      puzzleImageEvidence?.sourceHash === `sha256:${originalHash}` &&
      puzzleImageEvidence?.integrityStatus === "source_verified" &&
      puzzleImageEvidence?.semanticStatus === "user_confirmed" &&
      puzzleImageEvidence?.locator.coordinateSpace === "canonical-preview-v1" &&
      puzzleImageEvidence?.locator.x === 0.2 &&
      puzzleImageEvidence?.locator.y === 0.25 &&
      puzzleImageEvidence?.locator.width === 0.45 &&
      puzzleImageEvidence?.locator.height === 0.5 &&
      puzzleImageEvidence?.label === "看台旁留下的长椅" &&
      evidencePuzzle.payload.imageEvidence.right.length === 0
  );

  const deletedAnnotation = await deleteJson(annotationUrl);
  assert(
    "用户可删除图片区域证据",
    deletedAnnotation.response.ok && deletedAnnotation.payload.annotationId === annotation.id
  );
  const annotationsAfterDelete = await getJson(annotationsUrl);
  const puzzleAfterAnnotationDelete = await getJson(
    `${baseUrl}/api/archaeology/puzzle?memoryId=${encodeURIComponent(memoryId)}&relatedId=${encodeURIComponent(relatedId)}`
  );
  assert(
    "删除标注后证据列表和时光拼图均不再返回它",
    annotationsAfterDelete.response.ok &&
      annotationsAfterDelete.payload.annotations.length === 0 &&
      !puzzleAfterAnnotationDelete.payload.imageEvidence.left.some((item) => item.id === annotation.id)
  );

  const usage = await getJson(`${baseUrl}/api/media/usage`);
  assert(
    "媒体用量只统计已关联资产及全部变体字节",
    usage.response.ok &&
      usage.payload.assets === 1 &&
      usage.payload.memories === 1 &&
      usage.payload.sourceBytes === original.length &&
      usage.payload.totalVariantBytes === original.length + display.length + thumb.length
  );

  const stillReferenced = await deleteJson(`${baseUrl}/api/media/assets/${asset.id}`);
  assert("被展品引用的资产不能绕过关联直接删除", stillReferenced.response.status === 409);

  const detached = await deleteJson(`${baseUrl}/api/memories/${memoryId}/media/${asset.id}`);
  assert(
    "解除最后一个关联会同步回收无人引用的资产",
    detached.response.ok &&
      detached.payload.assetRemoved === true &&
      detached.payload.cleanupPending === false &&
      detached.payload.collection.length === 0
  );
  const reclaimedResponse = await fetch(`${baseUrl}${asset.urls.display}`);
  const usageAfterDetach = await getJson(`${baseUrl}/api/media/usage`);
  assert(
    "回收后媒体 URL 失效、用量归零且磁盘不残留文件",
    reclaimedResponse.status === 404 &&
      usageAfterDetach.payload.assets === 0 &&
      usageAfterDetach.payload.memories === 0 &&
      listFiles(path.join(mediaRoot, "assets")).length === 0
  );

  const fakeMime = await uploadOriginal(baseUrl, original, {
    fileName: "伪装成JPEG的PNG.jpg",
    mimeType: "image/jpeg"
  });
  assert("原图声明 MIME 与真实魔数不符时拒绝", fakeMime.response.status === 400);

  const invalidDerivedStage = await uploadOriginal(baseUrl, original, {
    fileName: "错误派生测试.png",
    mimeType: "image/png"
  });
  const invalidUploadId = invalidDerivedStage.payload.upload.uploadId;
  const disguisedDerived = await putMediaBytes(
    `${baseUrl}/api/media/uploads/${invalidUploadId}/display`,
    original,
    "image/webp"
  );
  assert("派生图即使声明 WebP 也必须通过真实格式校验", disguisedDerived.response.status === 400);
  const wrongDerivedContentType = await putMediaBytes(
    `${baseUrl}/api/media/uploads/${invalidUploadId}/display`,
    display,
    "image/png"
  );
  assert("派生接口在读取内容前拒绝非 WebP Content-Type", wrongDerivedContentType.response.status === 415);
  const discarded = await deleteJson(`${baseUrl}/api/media/uploads/${invalidUploadId}`);
  assert("失败的派生测试会话可主动清理", discarded.response.ok && discarded.payload.uploadId === invalidUploadId);
}

async function runDemoSafetyFlow() {
  const dbPath = path.join(os.tmpdir(), `ai-memory-museum-demo-smoke-${Date.now()}.sqlite`);
  const mediaRoot = `${dbPath}.media`;
  try {
    await withServer({
      DB_PATH: dbPath,
      MEDIA_ROOT: mediaRoot,
      INTERVIEW_DEMO: "true",
      AI_API_KEY: "demo-key-must-be-ignored",
      AI_BASE_URL: "http://127.0.0.1:1"
    }, async (baseUrl) => {
    const status = await getJson(`${baseUrl}/api/demo/status`);
    assert("公开 Demo 自动注入四条示例与一场已发布展览", status.response.ok && status.payload.interviewDemo === true && status.payload.seededExamples === 4 && status.payload.seededExhibitions === 1);
    assert("公开 Demo 使用临时存储并强制本地 Mock", status.payload.storage === "ephemeral-sqlite-on-tmp" && status.payload.destructiveActionsBlocked === true && status.payload.aiMode === "mock-fallback");
    const demoHome = await fetch(`${baseUrl}/`);
    assert("公开 Demo 通过权限策略禁用麦克风", demoHome.headers.get("permissions-policy")?.includes("microphone=()"));

    const memories = await getJson(`${baseUrl}/api/memories`);
    assert("公开 Demo 馆藏可直接浏览", memories.response.ok && memories.payload.memories.length === 4);
    const demoExhibitions = await getJson(`${baseUrl}/api/exhibitions`);
    const seededExhibition = demoExhibitions.payload.exhibitions[0];
    const seededExhibitionDetail = await getJson(`${baseUrl}/api/exhibitions/${seededExhibition.id}`);
    const seededShareCandidates = await getJson(`${baseUrl}/api/offline-exhibits/candidates?exhibitionId=${encodeURIComponent(seededExhibition.id)}`);
    assert(
      "公开 Demo 预置已发布展览可读并可进入加密分享素材流",
      demoExhibitions.response.ok &&
        demoExhibitions.payload.exhibitions.length === 1 &&
        seededExhibition.status === "published" &&
        seededExhibitionDetail.response.ok &&
        seededExhibitionDetail.payload.exhibition.id === seededExhibition.id &&
        seededExhibitionDetail.payload.exhibition.status === "published" &&
        ["demo-campus-farewell", "demo-family-noodles", "demo-friend-call"].every((id) => seededExhibitionDetail.payload.exhibition.memoryIds.includes(id)) &&
        seededExhibitionDetail.payload.exhibition.memoryIds.length === 3 &&
        seededShareCandidates.response.ok &&
        seededShareCandidates.payload.exhibition.id === seededExhibition.id
    );

    const demoPeople = await getJson(`${baseUrl}/api/entities?type=person&limit=20`);
    const [demoTargetPerson, demoSourcePerson] = demoPeople.payload.entities;
    const demoClueStatsBefore = (await getJson(`${baseUrl}/api/health`)).payload.stats;
    const demoAliasPreview = await postJson(`${baseUrl}/api/entities/${demoTargetPerson.id}/aliases/preview`, { alias: "演示别名" });
    const demoAliasWrite = await postJson(`${baseUrl}/api/entities/${demoTargetPerson.id}/aliases`, { alias: "演示别名", confirm: true });
    const demoMergePreview = await postJson(`${baseUrl}/api/entities/${demoTargetPerson.id}/merge/preview`, { sourceEntityId: demoSourcePerson.id });
    const demoMergeWrite = await postJson(`${baseUrl}/api/entities/${demoTargetPerson.id}/merge`, { sourceEntityId: demoSourcePerson.id, confirm: true });
    const demoClueStatsAfter = (await getJson(`${baseUrl}/api/health`)).payload.stats;
    assert("公开 Demo 可预览实体变更但拒绝别名与合并写入", demoAliasPreview.response.ok && demoMergePreview.response.ok && demoAliasWrite.response.status === 403 && demoMergeWrite.response.status === 403);
    assert("公开 Demo 实体预览保持 SQLite 零写入", demoClueStatsAfter.entities === demoClueStatsBefore.entities && demoClueStatsAfter.entityAliases === demoClueStatsBefore.entityAliases);

    const demoExhibitionPreview = await postJson(`${baseUrl}/api/exhibitions/preview`, {
      theme: "Demo 中的温暖片段",
      memoryIds: memories.payload.memories.slice(0, 2).map((memory) => memory.id)
    });
    assert("公开 Demo 允许生成不落库的主题展览预览", demoExhibitionPreview.response.ok && demoExhibitionPreview.payload.preview.sections.length > 0);
    const blockedExhibitionSave = await postJson(`${baseUrl}/api/exhibitions`, {
      ...demoExhibitionPreview.payload.preview,
      confirm: true
    });
    assert("公开 Demo 阻止主题展览持久化", blockedExhibitionSave.response.status === 403 && blockedExhibitionSave.payload.interviewDemo === true);

    const demoCapsulesBefore = await getJson(`${baseUrl}/api/capsules`);
    const blockedCapsule = await postJson(`${baseUrl}/api/capsules`, {
      exhibitionId: "demo-exhibition",
      title: "不应保存的 Demo 胶囊",
      shellMessage: "不写入",
      opensOn: "2099-01-01",
      timezone: "Asia/Shanghai",
      mediaAssetIds: [],
      transcriptAssetIds: [],
      confirm: true
    });
    const demoCapsulesAfter = await getJson(`${baseUrl}/api/capsules`);
    assert("公开 Demo 阻止胶囊写入且外壳列表保持零变化", demoCapsulesBefore.response.ok && blockedCapsule.response.status === 403 && blockedCapsule.payload.interviewDemo === true && demoCapsulesAfter.payload.capsules.length === demoCapsulesBefore.payload.capsules.length);

    const targetId = memories.payload.memories[0].id;
    const demoRevisit = await getJson(`${baseUrl}/api/revisits?kind=random&localDate=2026-07-16&timezone=Asia%2FShanghai`);
    assert("公开 Demo 可以浏览但不会预写回访状态", demoRevisit.response.ok && demoRevisit.payload.revisit?.memory.id && demoRevisit.payload.revisit.state.viewCount === 0);
    const demoIntentBefore = await getJson(`${baseUrl}/api/revisits/${targetId}/intent`);
    const demoIntentListBefore = await getJson(`${baseUrl}/api/revisits/intents`);
    const blockedIntent = await putJson(`${baseUrl}/api/revisits/${targetId}/intent`, {
      choice: "welcome",
      notBeforeLocalDate: "",
      timezone: "",
      confirm: true
    });
    const demoIntentAfter = await getJson(`${baseUrl}/api/revisits/${targetId}/intent`);
    const demoIntentListAfter = await getJson(`${baseUrl}/api/revisits/intents`);
    assert("公开 Demo 拒绝回访意愿 PUT 且保持零持久化", demoIntentBefore.payload.intent.choice === "neutral" && demoIntentListBefore.payload.count === 0 && blockedIntent.response.status === 403 && blockedIntent.payload.interviewDemo === true && demoIntentAfter.payload.intent.choice === "neutral" && demoIntentListAfter.payload.count === 0);
    const demoRevisitContext = { localDate: "2026-07-16", timezone: "Asia/Shanghai" };
    const blockedViewed = await postJson(`${baseUrl}/api/revisits/${targetId}/viewed`, demoRevisitContext);
    const blockedDismissed = await postJson(`${baseUrl}/api/revisits/${targetId}/dismissed`, demoRevisitContext);
    assert("公开 Demo 阻止回访浏览与隐藏状态写入", blockedViewed.response.status === 403 && blockedViewed.payload.interviewDemo === true && blockedDismissed.response.status === 403 && blockedDismissed.payload.interviewDemo === true);

    const blockedDelete = await fetch(`${baseUrl}/api/memories/${targetId}`, {
      method: "DELETE",
      headers: writeHeaders(`${baseUrl}/api/memories/${targetId}`)
    });
    const blockedPayload = await blockedDelete.json();
    assert("公开 Demo 阻止删除", blockedDelete.status === 403 && blockedPayload.interviewDemo === true);

    const blockedPurge = await fetch(`${baseUrl}/api/memories/purge`, {
      method: "DELETE",
      headers: writeHeaders(`${baseUrl}/api/memories/purge`, { "Content-Type": "application/json" }),
      body: JSON.stringify({ confirm: "DELETE" })
    });
    assert("公开 Demo 阻止清空", blockedPurge.status === 403);

    const blockedSeedEdit = await putJson(`${baseUrl}/api/memories/${targetId}`, { title: "不应覆盖预置展品" });
    assert("公开 Demo 保护预置展品不被改写", blockedSeedEdit.response.status === 403);

    const blockedImport = await postJson(`${baseUrl}/api/memories/import`, { memories: [] });
    assert("公开 Demo 禁止导入污染共享临时实例", blockedImport.response.status === 403);

    const blockedArchiveRestore = await fetch(`${baseUrl}/api/archive/restore`, {
      method: "POST",
      headers: writeHeaders(`${baseUrl}/api/archive/restore`, { "Content-Type": "application/octet-stream" }),
      body: Buffer.from([0x1f, 0x8b])
    });
    assert("公开 Demo 禁止完整归档恢复", blockedArchiveRestore.status === 403);
    const blockedHealthScan = await postJson(`${baseUrl}/api/collection-health/scans`, { scope: "full" });
    const blockedArchiveInspect = await fetch(`${baseUrl}/api/archive/inspect`, {
      method: "POST",
      headers: writeHeaders(`${baseUrl}/api/archive/inspect`, { "Content-Type": "application/vnd.time-isle" }),
      body: Buffer.from([0x1f, 0x8b])
    });
    assert("公开 Demo 禁止重型馆藏体检与私人备份验真", blockedHealthScan.response.status === 403 && blockedArchiveInspect.status === 403);

    const guide = await postJson(`${baseUrl}/api/guide`, { question: "哪些记忆与温暖有关？" });
    assert("公开 Demo 讲解路径可用", guide.response.ok && guide.payload.citations.length > 0);
    const analyzed = await postJson(`${baseUrl}/api/analyze`, { rawContent: "公开 Demo 的模型密钥即使误配也不能被调用。" });
    assert("公开 Demo 忽略误配密钥且整理仍可用", analyzed.response.ok && analyzed.payload.mode === "mock-fallback");

    const visitorMemoryId = `demo-visitor-${Date.now()}`;
    const visitorCreated = await postJson(`${baseUrl}/api/memories`, {
      id: visitorMemoryId,
      title: "访客临时展品",
      rawContent: "只用于验证公开 Demo 不能通过反复编辑膨胀修订历史。",
      exhibitText: "共享示例只允许一次性临时记录。"
    });
    const revisionsBeforeBlockedEdit = await getJson(`${baseUrl}/api/revisions?limit=100`);
    const blockedVisitorEdit = await putJson(`${baseUrl}/api/memories/${visitorMemoryId}`, {
      title: "不应产生第二条修订",
      expectedUpdatedAt: visitorCreated.payload.memory.updatedAt
    });
    const revisionsAfterBlockedEdit = await getJson(`${baseUrl}/api/revisions?limit=100`);
    assert("公开 Demo 阻止访客新增展品的后续 PUT，避免无限制造修订", visitorCreated.response.status === 201 && blockedVisitorEdit.response.status === 403 && revisionsAfterBlockedEdit.payload.revisions.length === revisionsBeforeBlockedEdit.payload.revisions.length);

    const route = await getJson(`${baseUrl}/api/archaeology/routes`);
    assert("公开 Demo 可生成不写入私人数据的记忆航线", route.response.ok && route.payload.route.items.length >= 2 && route.payload.route.transitions.every((item) => item.sameEvent === "unassessed"));

    await assertDemoMediaWritesBlocked(baseUrl, targetId);
    await assertDemoVoiceWritesBlocked(baseUrl, targetId, mediaRoot);
    const memoryLimit = status.payload.limits?.memories;
    const memoriesBeforeCapacity = await getJson(`${baseUrl}/api/memories`);
    const capacityAttempts = Array.from({ length: (memoryLimit - memoriesBeforeCapacity.payload.memories.length) + 8 }, (_, offset) => {
      const index = memoriesBeforeCapacity.payload.memories.length + offset;
      return postJson(`${baseUrl}/api/memories`, {
        id: `demo-capacity-${index}`,
        title: `临时容量 ${index}`,
        rawContent: "只用于验证公开 Demo 的固定资源上限。",
        exhibitText: "容量边界测试"
      });
    });
    const capacityResults = await Promise.all(capacityAttempts);
    const afterCapacity = await getJson(`${baseUrl}/api/memories`);
    assert(
      "公开 Demo 以事务硬上限和 429 阻止并发共享文本无限增长",
      Number.isInteger(memoryLimit) &&
        capacityResults.filter((item) => item.response.status === 201).length === memoryLimit - memoriesBeforeCapacity.payload.memories.length &&
        capacityResults.filter((item) => item.response.status === 429).length === 8 &&
        afterCapacity.payload.memories.length === memoryLimit
    );
    });
  } finally {
    removeDatabase(dbPath);
    removeDirectory(mediaRoot);
  }
}

async function assertDemoMediaWritesBlocked(baseUrl, memoryId) {
  const uploadId = "upload-00000000-0000-4000-8000-000000000000";
  const assetId = "asset-demo-write-guard";
  const annotationId = "observation-demo-write-guard";
  const fixture = createWebp(2, 2);
  const attempts = [
    {
      name: "原图上传",
      request: () => fetch(`${baseUrl}/api/media/uploads`, {
        method: "POST",
        headers: writeHeaders(`${baseUrl}/api/media/uploads`, { "Content-Type": "image/webp" }),
        body: fixture
      })
    },
    {
      name: "展示图写入",
      request: () => fetch(`${baseUrl}/api/media/uploads/${uploadId}/display`, {
        method: "PUT",
        headers: writeHeaders(`${baseUrl}/api/media/uploads/${uploadId}/display`, { "Content-Type": "image/webp" }),
        body: fixture
      })
    },
    {
      name: "缩略图写入",
      request: () => fetch(`${baseUrl}/api/media/uploads/${uploadId}/thumb`, {
        method: "PUT",
        headers: writeHeaders(`${baseUrl}/api/media/uploads/${uploadId}/thumb`, { "Content-Type": "image/webp" }),
        body: fixture
      })
    },
    {
      name: "上传完成",
      request: () => jsonFetch(`${baseUrl}/api/media/uploads/${uploadId}/complete`, "POST", {})
    },
    {
      name: "上传丢弃",
      request: () => jsonFetch(`${baseUrl}/api/media/uploads/${uploadId}`, "DELETE")
    },
    {
      name: "媒体关联",
      request: () => jsonFetch(`${baseUrl}/api/memories/${memoryId}/media`, "POST", { assetId })
    },
    {
      name: "媒体说明更新",
      request: () => jsonFetch(`${baseUrl}/api/memories/${memoryId}/media/${assetId}`, "PUT", { caption: "不应写入" })
    },
    {
      name: "媒体解除关联",
      request: () => jsonFetch(`${baseUrl}/api/memories/${memoryId}/media/${assetId}`, "DELETE")
    },
    {
      name: "孤儿资产删除",
      request: () => jsonFetch(`${baseUrl}/api/media/assets/${assetId}`, "DELETE")
    }
  ];

  const results = [];
  for (const attempt of attempts) {
    const response = await attempt.request();
    const payload = await response.json();
    results.push({ name: attempt.name, status: response.status, payload });
  }
  assert(
    "公开 Demo 阻止全部媒体写操作",
    results.length === attempts.length &&
      results.every((item) => item.status === 403 && item.payload.interviewDemo === true)
  );

  const annotationsUrl = `${baseUrl}/api/memories/${memoryId}/media/${assetId}/annotations`;
  const annotationAttempts = [
    () => jsonFetch(annotationsUrl, "POST", {
      region: { x: 0, y: 0, width: 1, height: 1 },
      label: "不应写入公开 Demo"
    }),
    () => jsonFetch(`${annotationsUrl}/${annotationId}`, "PUT", {
      region: { x: 0, y: 0, width: 1, height: 1 },
      label: "不应更新公开 Demo"
    }),
    () => jsonFetch(`${annotationsUrl}/${annotationId}`, "DELETE")
  ];
  const annotationResults = [];
  for (const request of annotationAttempts) {
    const response = await request();
    annotationResults.push({ response, payload: await response.json() });
  }
  assert(
    "公开 Demo 阻止图片区域证据的创建、更新和删除",
    annotationResults.every(({ response, payload }) => response.status === 403 && payload.interviewDemo === true)
  );
}

async function assertDemoVoiceWritesBlocked(baseUrl, memoryId, mediaRoot) {
  const assetId = "voice-demo-write-guard";
  const before = (await getJson(`${baseUrl}/api/health`)).payload.stats;
  const attempts = [
    fetch(`${baseUrl}/api/voice/uploads?filename=demo.webm`, {
      method: "POST",
      headers: writeHeaders(`${baseUrl}/api/voice/uploads?filename=demo.webm`, { "Content-Type": "audio/webm" }),
      body: createVoiceWebm()
    }),
    jsonFetch(`${baseUrl}/api/memories/${memoryId}/voices`, "PUT", { items: [{ assetId }] }),
    jsonFetch(`${baseUrl}/api/memories/${memoryId}/voices/${assetId}/transcript`, "PUT", { text: "不应写入", confirm: true }),
    jsonFetch(`${baseUrl}/api/memories/${memoryId}/voices/${assetId}/transcript`, "DELETE"),
    jsonFetch(`${baseUrl}/api/voice/assets/${assetId}`, "DELETE")
  ];
  const responses = await Promise.all(attempts);
  const payloads = await Promise.all(responses.map((response) => response.json()));
  const after = (await getJson(`${baseUrl}/api/health`)).payload.stats;
  assert("公开 Demo 阻止全部声音与转写写操作", responses.every((response) => response.status === 403) && payloads.every((payload) => payload.interviewDemo === true));
  assert("公开 Demo 声音写入保持数据库与文件零变化", after.voiceAssets === before.voiceAssets && after.voiceLinks === before.voiceLinks && after.voiceTranscripts === before.voiceTranscripts && listFiles(path.join(mediaRoot, "voice", "ready")).length === 0);
}

async function withServer(extraEnv, callback) {
  const port = await getFreePort();
  const logs = [];
  const child = spawn(process.execPath, [path.join(root, "server.js")], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      AI_API_KEY: "",
      ...extraEnv
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => logs.push(chunk.toString()));
  child.stderr.on("data", (chunk) => logs.push(chunk.toString()));
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForHealth(baseUrl, child, logs);
    await callback(baseUrl);
  } catch (error) {
    if (logs.length) error.message = `${error.message}\nServer log:\n${logs.join("")}`;
    throw error;
  } finally {
    if (!child.killed) child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 1500))
    ]);
  }
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function rawHttpStatus(url, options = {}) {
  const target = new URL(url);
  const body = options.body === undefined ? null : Buffer.from(options.body);
  const headers = { ...(options.headers || {}) };
  if (body && headers["Content-Length"] === undefined) headers["Content-Length"] = String(body.length);
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: options.method || "GET",
      headers
    }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

async function waitForHealth(baseUrl, child, logs) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Server exited early.\n${logs.join("")}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Startup is still in progress.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not become healthy.\n${logs.join("")}`);
}

async function getJson(url) {
  const response = await fetch(url);
  return { response, payload: await response.json() };
}

async function postJson(url, body) {
  return requestJson(url, "POST", body);
}

async function putJson(url, body) {
  return requestJson(url, "PUT", body);
}

async function deleteJson(url, body) {
  return requestJson(url, "DELETE", body);
}

async function createReadyAsset(baseUrl, original, display, thumb, fileName) {
  const staged = await uploadOriginal(baseUrl, original, { fileName, mimeType: "image/png", privacyMode: "preserve_original" });
  const uploadId = staged.payload.upload.uploadId;
  await putMediaBytes(`${baseUrl}/api/media/uploads/${uploadId}/display`, display, "image/webp");
  await putMediaBytes(`${baseUrl}/api/media/uploads/${uploadId}/thumb`, thumb, "image/webp");
  const completed = await postJson(`${baseUrl}/api/media/uploads/${uploadId}/complete`, {});
  if (!completed.response.ok) throw new Error(completed.payload.error || "媒体测试资产无法完成上传。");
  return completed.payload.media;
}

function createFingerprintRgba() {
  const pixels = Buffer.alloc(9 * 8 * 4);
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 9; x += 1) {
      const offset = ((y * 9) + x) * 4;
      pixels[offset] = x * 28;
      pixels[offset + 1] = y * 30;
      pixels[offset + 2] = (x + y) * 14;
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
}

async function uploadOriginal(baseUrl, bytes, options = {}) {
  const query = new URLSearchParams({
    filename: options.fileName || "memory-photo.png",
    privacy: options.privacyMode || "preserve_original"
  });
  const response = await fetch(`${baseUrl}/api/media/uploads?${query}`, {
    method: "POST",
    headers: writeHeaders(`${baseUrl}/api/media/uploads?${query}`, { "Content-Type": options.mimeType || "application/octet-stream" }),
    body: bytes
  });
  return { response, payload: await response.json() };
}

async function uploadVoice(baseUrl, bytes, fileName, mimeType) {
  const query = new URLSearchParams({ filename: fileName });
  const url = `${baseUrl}/api/voice/uploads?${query}`;
  const response = await fetch(url, {
    method: "POST",
    headers: writeHeaders(url, { "Content-Type": mimeType }),
    body: bytes
  });
  return { response, payload: await response.json() };
}

async function putMediaBytes(url, bytes, mimeType) {
  const response = await fetch(url, {
    method: "PUT",
    headers: writeHeaders(url, { "Content-Type": mimeType }),
    body: bytes
  });
  return { response, payload: await response.json() };
}

function jsonFetch(url, method, body) {
  return fetch(url, {
    method,
    headers: writeHeaders(url, { "Content-Type": "application/json" }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

async function requestJson(url, method, body) {
  const response = await fetch(url, {
    method,
    headers: writeHeaders(url, { "Content-Type": "application/json" }),
    body: JSON.stringify(body)
  });
  return { response, payload: await response.json() };
}

function writeHeaders(url, additional = {}) {
  return {
    Origin: new URL(url).origin,
    "Sec-Fetch-Site": "same-origin",
    ...additional
  };
}

function assert(name, condition) {
  assertionCount += 1;
  if (!condition) throw new Error(`not ok - ${name}`);
  console.log(`ok - ${name}`);
}

function createPng(width, height) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines = Buffer.alloc((1 + (width * 4)) * height);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return chunk;
}

function createWebp(width, height) {
  const frame = Buffer.alloc(10);
  frame[3] = 0x9d;
  frame[4] = 0x01;
  frame[5] = 0x2a;
  frame.writeUInt16LE(width, 6);
  frame.writeUInt16LE(height, 8);
  const imageChunk = Buffer.alloc(18);
  imageChunk.write("VP8 ", 0, 4, "ascii");
  imageChunk.writeUInt32LE(frame.length, 4);
  frame.copy(imageChunk, 8);
  const body = Buffer.concat([Buffer.from("WEBP", "ascii"), imageChunk]);
  const header = Buffer.alloc(8);
  header.write("RIFF", 0, 4, "ascii");
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

function createVoiceWebm(durationMs = 1_000) {
  const opusHead = Buffer.alloc(19);
  opusHead.write("OpusHead", 0, "ascii");
  opusHead[8] = 1;
  opusHead[9] = 1;
  opusHead.writeUInt32LE(48_000, 12);
  const track = voiceEbmlElement("ae", Buffer.concat([
    voiceEbmlUInt("d7", 1),
    voiceEbmlUInt("83", 2),
    voiceEbmlElement("86", Buffer.from("A_OPUS")),
    voiceEbmlElement("63a2", opusHead),
    voiceEbmlElement("e1", Buffer.concat([voiceEbmlUInt("9f", 1), voiceEbmlFloat("b5", 48_000)]))
  ]));
  const info = voiceEbmlElement("1549a966", Buffer.concat([
    voiceEbmlUInt("2ad7b1", 1_000_000),
    voiceEbmlFloat("4489", durationMs)
  ]));
  const cluster = voiceEbmlElement("1f43b675", Buffer.concat([
    voiceEbmlUInt("e7", 0),
    voiceEbmlElement("a3", Buffer.from([0x81, 0x00, 0x00, 0x80, 0xf8]))
  ]));
  return Buffer.concat([
    voiceEbmlElement("1a45dfa3", voiceEbmlElement("4282", Buffer.from("webm"))),
    voiceEbmlElement("18538067", Buffer.concat([info, voiceEbmlElement("1654ae6b", track), cluster]))
  ]);
}

function voiceEbmlUInt(id, value) {
  let hex = BigInt(value).toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  return voiceEbmlElement(id, Buffer.from(hex, "hex"));
}

function voiceEbmlFloat(id, value) {
  const data = Buffer.alloc(8);
  data.writeDoubleBE(value);
  return voiceEbmlElement(id, data);
}

function voiceEbmlElement(id, payload) {
  return Buffer.concat([Buffer.from(id, "hex"), voiceEbmlSize(payload.length), payload]);
}

function voiceEbmlSize(value) {
  const number = BigInt(value);
  for (let width = 1; width <= 8; width += 1) {
    const maximum = (1n << BigInt(7 * width)) - 1n;
    if (number >= maximum) continue;
    let marked = number | (1n << BigInt(7 * width));
    const output = Buffer.alloc(width);
    for (let index = width - 1; index >= 0; index -= 1) {
      output[index] = Number(marked & 0xffn);
      marked >>= 8n;
    }
    return output;
  }
  throw new Error("voice fixture is too large");
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function listFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(target) : [target];
  });
}

function removeDatabase(dbPath) {
  [dbPath, `${dbPath}-shm`, `${dbPath}-wal`].forEach((filePath) => {
    try {
      fs.rmSync(filePath, { force: true });
    } catch {
      // Temporary cleanup failure does not affect the product result.
    }
  });
}

function removeDirectory(directory) {
  try {
    fs.rmSync(directory, { recursive: true, force: true });
  } catch {
    // Temporary cleanup failure does not affect the product result.
  }
}
