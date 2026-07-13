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
          exhibitText: `${title}的展品说明。`
        });
        assert(`完整归档场景可创建${title}`, created.response.status === 201);
      }

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

      const archiveResponse = await fetch(`${baseUrl}/api/archive/export`);
      const archive = Buffer.from(await archiveResponse.arrayBuffer());
      assert("完整 .time-isle 导出包含二进制归档与下载文件名", archiveResponse.ok && archiveResponse.headers.get("content-type") === "application/vnd.time-isle" && archiveResponse.headers.get("content-disposition").includes(".time-isle") && archive.subarray(0, 2).equals(Buffer.from([0x1f, 0x8b])));

      const purged = await deleteJson(`${baseUrl}/api/memories/purge`, { confirm: "DELETE" });
      assert("归档恢复前可隔离并清空源馆藏与媒体", purged.response.ok && purged.payload.mediaCleanupPending === false && listFiles(path.join(mediaRoot, "assets")).length === 0);
      const restoreResponse = await fetch(`${baseUrl}/api/archive/restore`, {
        method: "POST",
        headers: writeHeaders(`${baseUrl}/api/archive/restore`, { "Content-Type": "application/octet-stream" }),
        body: archive
      });
      const restored = await restoreResponse.json();
      assert("完整归档以单次事务恢复展品、媒体和图片线索", restoreResponse.ok && restored.imported === 2 && restored.media.assetsCreated === 2 && restored.media.links === 2 && restored.media.observations === 3);
      const restoredLeftId = restored.idMap.memories[leftId];
      const restoredLeftAsset = restored.idMap.assets[leftAsset.id];
      const restoredDetail = await getJson(`${baseUrl}/api/memories/${restoredLeftId}`);
      const restoredAnnotations = await getJson(`${baseUrl}/api/memories/${restoredLeftId}/media/${restoredLeftAsset}/annotations`);
      assert("恢复后图片文件、关联与敏感区域证据仍可读取", restoredDetail.payload.memory.media.length === 1 && restoredAnnotations.payload.annotations.length === 1 && restoredAnnotations.payload.annotations[0].sensitive === true && listFiles(path.join(mediaRoot, "assets")).length === 6);
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

    const health = await getJson(`${baseUrl}/api/health`);
    assert("健康检查返回时屿品牌与版本", health.response.ok && health.payload.ok && health.payload.version === "4.0.0" && health.payload.schemaVersion === 4 && health.payload.name === "时屿" && health.payload.englishName === "TIME ISLE" && health.payload.tagline === "AI 私人记忆策展工具");
    assert("本地模式使用 SQLite", health.payload.mode === "local" && health.payload.storage === "local-sqlite");

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
    assert("版本接口描述核心产品流程", version.response.ok && version.payload.productFlow.join(",") === "记录,AI 整理,照片归档,检索与讲解,记忆考古,安全导出");

    const demo = await getJson(`${baseUrl}/api/demo/status`);
    assert("本地模式未伪装成公开 Demo", demo.response.ok && demo.payload.interviewDemo === false);

    const options = await getJson(`${baseUrl}/api/options`);
    assert("选项接口包含七个中文展厅", options.response.ok && options.payload.halls.length === 7 && options.payload.halls.every((hall) => hall.name.endsWith("展厅")));

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

    const updated = await putJson(`${baseUrl}/api/memories/${memoryId}`, { title: "操场上的陪伴", importance: 5 });
    assert("展品可更新", updated.response.ok && updated.payload.memory.title === "操场上的陪伴" && updated.payload.memory.importance === 5);

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
      tags: ["陪伴", "操场"],
      emotions: ["温暖"],
      importance: 4
    });
    assert("可保存同一往事的第二个版本", related.response.status === 201 && related.payload.memory.id === relatedId);

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

    const fullExport = await getJson(`${baseUrl}/api/memories/export`);
    assert("馆藏备份保留品牌和原文", fullExport.response.ok && fullExport.payload.product === "时屿" && fullExport.payload.productEnglish === "TIME ISLE" && fullExport.payload.memories.some((memory) => memory.rawContent === rawContent));
    assert("馆藏备份包含版本组、证据和补问", fullExport.payload.archaeology.events.length === 1 && fullExport.payload.archaeology.claims.length > 0 && fullExport.payload.archaeology.questions.length === 1);

    await putJson(`${baseUrl}/api/memories/${memoryId}`, { rawContent: "这段原文已被重新整理，不再包含此前的日期、人物或地点线索。" });
    const revalidatedExport = await getJson(`${baseUrl}/api/memories/export`);
    const revisedClaims = revalidatedExport.payload.archaeology.claims.filter((claim) => claim.memoryId === memoryId);
    assert("编辑原文会重新校验并失效旧证据锚点", revisedClaims.length > 0 && revisedClaims.every((claim) => claim.evidenceValid === false && claim.status === "source_invalidated"));

    const redactedExport = await getJson(`${baseUrl}/api/memories/export?mode=redacted`);
    const redacted = redactedExport.payload.memories.find((memory) => memory.id === memoryId);
    assert("脱敏备份隐藏原文和地点", redactedExport.response.ok && redacted.rawContent.includes("已隐藏") && redacted.location.includes("已隐藏"));

    const imported = await postJson(`${baseUrl}/api/memories/import`, {
      memories: [{ ...created.payload.memory, id: `imported-${Date.now()}`, title: "导入验证展品" }]
    });
    assert("JSON 记忆可导入", imported.response.ok && imported.payload.imported === 1);
    assert("导入副本不会错误复用 Agent run", imported.payload.memories.find((memory) => memory.title === "导入验证展品")?.agentRunId === "");

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

    const rejectedPurge = await fetch(`${baseUrl}/api/memories/purge`, {
      method: "DELETE",
      headers: writeHeaders(`${baseUrl}/api/memories/purge`, { "Content-Type": "application/json" }),
      body: JSON.stringify({ confirm: "NO" })
    });
    assert("清空操作要求明确确认", rejectedPurge.status === 400);

    const purge = await deleteJson(`${baseUrl}/api/memories/purge`, { confirm: "DELETE" });
    assert("确认后可清空本地馆藏", purge.response.ok && purge.payload.ok === true);

    const restored = await postJson(`${baseUrl}/api/memories/import`, fullExport.payload);
    assert("馆藏备份可恢复记忆考古数据", restored.response.ok && restored.payload.archaeology.events === 1 && restored.payload.archaeology.claims > 0 && restored.payload.archaeology.questions === 1);
    const restoredOverview = await getJson(`${baseUrl}/api/archaeology/overview`);
    assert("恢复后两个版本仍属于同一时光拼图", restoredOverview.payload.overview.filter((item) => [memoryId, relatedId].includes(item.memoryId)).length === 2 && restoredOverview.payload.overview.filter((item) => [memoryId, relatedId].includes(item.memoryId)).every((item) => item.versionCount === 2));

    const beforeRejectedImport = await getJson(`${baseUrl}/api/memories`);
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
    "GET 可读取派生图并返回内容型 ETag",
    displayResponse.ok &&
      displayResponse.headers.get("content-type") === "image/webp" &&
      displayResponse.headers.get("content-length") === String(display.length) &&
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
    assert("公开 Demo 自动注入四条示例", status.response.ok && status.payload.interviewDemo === true && status.payload.seededExamples === 4);
    assert("公开 Demo 使用临时存储并强制本地 Mock", status.payload.storage === "ephemeral-sqlite-on-tmp" && status.payload.destructiveActionsBlocked === true && status.payload.aiMode === "mock-fallback");

    const memories = await getJson(`${baseUrl}/api/memories`);
    assert("公开 Demo 馆藏可直接浏览", memories.response.ok && memories.payload.memories.length === 4);

    const targetId = memories.payload.memories[0].id;
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

    const guide = await postJson(`${baseUrl}/api/guide`, { question: "哪些记忆与温暖有关？" });
    assert("公开 Demo 讲解路径可用", guide.response.ok && guide.payload.citations.length > 0);
    const analyzed = await postJson(`${baseUrl}/api/analyze`, { rawContent: "公开 Demo 的模型密钥即使误配也不能被调用。" });
    assert("公开 Demo 忽略误配密钥且整理仍可用", analyzed.response.ok && analyzed.payload.mode === "mock-fallback");

    const route = await getJson(`${baseUrl}/api/archaeology/routes`);
    assert("公开 Demo 可生成不写入私人数据的记忆航线", route.response.ok && route.payload.route.items.length >= 2 && route.payload.route.transitions.every((item) => item.sameEvent === "unassessed"));

    await assertDemoMediaWritesBlocked(baseUrl, targetId);
    const memoryLimit = status.payload.limits?.memories;
    const capacityAttempts = Array.from({ length: (memoryLimit - memories.payload.memories.length) + 8 }, (_, offset) => {
      const index = memories.payload.memories.length + offset;
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
        capacityResults.filter((item) => item.response.status === 201).length === memoryLimit - memories.payload.memories.length &&
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
