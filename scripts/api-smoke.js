const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
let assertionCount = 0;

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

async function main() {
  await runLocalFlow();
  await runDemoSafetyFlow();
  console.log(`API smoke checks passed (${assertionCount} assertions).`);
}

async function runLocalFlow() {
  const dbPath = path.join(os.tmpdir(), `ai-memory-museum-smoke-${Date.now()}.sqlite`);
  await withServer({ DB_PATH: dbPath, INTERVIEW_DEMO: "false" }, async (baseUrl) => {
    const home = await fetch(`${baseUrl}/`);
    const homeText = await home.text();
    assert("首页可访问并展示时屿品牌", home.ok && homeText.includes("把散落的生活片段") && homeText.includes("TIME ISLE"));
    assert("首页包含安全响应头", home.headers.get("x-content-type-options") === "nosniff" && home.headers.get("x-frame-options") === "DENY");

    const styles = await fetch(`${baseUrl}/styles.css`);
    const app = await fetch(`${baseUrl}/assets/app.js`);
    assert("静态资源可访问", styles.ok && app.ok);

    const health = await getJson(`${baseUrl}/api/health`);
    assert("健康检查返回时屿品牌与版本", health.response.ok && health.payload.ok && health.payload.version === "2.0.1" && health.payload.name === "时屿" && health.payload.englishName === "TIME ISLE" && health.payload.tagline === "AI 私人记忆策展工具");
    assert("本地模式使用 SQLite", health.payload.mode === "local" && health.payload.storage === "local-sqlite");

    const version = await getJson(`${baseUrl}/api/version`);
    assert("版本接口描述核心产品流程", version.response.ok && version.payload.productFlow.join(",") === "记录,AI 整理,检索与讲解,回顾,安全导出");

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

    const privacy = await getJson(`${baseUrl}/api/privacy`);
    assert("隐私接口说明本地数据位置", privacy.response.ok && privacy.payload.mode === "local-first" && privacy.payload.dataLocations.length >= 3);

    const fullExport = await getJson(`${baseUrl}/api/memories/export`);
    assert("完整备份保留品牌和原文", fullExport.response.ok && fullExport.payload.product === "时屿" && fullExport.payload.productEnglish === "TIME ISLE" && fullExport.payload.memories.some((memory) => memory.rawContent === rawContent));

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
      headers: { "Content-Type": "application/json" },
      body: "{broken"
    });
    assert("无效 JSON 得到明确错误", invalidJson.status === 400);

    const deleteResponse = await fetch(`${baseUrl}/api/memories/${memoryId}`, { method: "DELETE" });
    assert("本地展品可删除", deleteResponse.ok);

    const rejectedPurge = await fetch(`${baseUrl}/api/memories/purge`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: "NO" })
    });
    assert("清空操作要求明确确认", rejectedPurge.status === 400);

    const purge = await deleteJson(`${baseUrl}/api/memories/purge`, { confirm: "DELETE" });
    assert("确认后可清空本地馆藏", purge.response.ok && purge.payload.ok === true);
  });
  removeDatabase(dbPath);
}

async function runDemoSafetyFlow() {
  const dbPath = path.join(os.tmpdir(), `ai-memory-museum-demo-smoke-${Date.now()}.sqlite`);
  await withServer({ DB_PATH: dbPath, INTERVIEW_DEMO: "true" }, async (baseUrl) => {
    const status = await getJson(`${baseUrl}/api/demo/status`);
    assert("公开 Demo 自动注入四条示例", status.response.ok && status.payload.interviewDemo === true && status.payload.seededExamples === 4);
    assert("公开 Demo 使用临时存储", status.payload.storage === "ephemeral-sqlite-on-tmp" && status.payload.destructiveActionsBlocked === true);

    const memories = await getJson(`${baseUrl}/api/memories`);
    assert("公开 Demo 馆藏可直接浏览", memories.response.ok && memories.payload.memories.length === 4);

    const targetId = memories.payload.memories[0].id;
    const blockedDelete = await fetch(`${baseUrl}/api/memories/${targetId}`, { method: "DELETE" });
    const blockedPayload = await blockedDelete.json();
    assert("公开 Demo 阻止删除", blockedDelete.status === 403 && blockedPayload.interviewDemo === true);

    const blockedPurge = await fetch(`${baseUrl}/api/memories/purge`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: "DELETE" })
    });
    assert("公开 Demo 阻止清空", blockedPurge.status === 403);

    const guide = await postJson(`${baseUrl}/api/guide`, { question: "哪些记忆与温暖有关？" });
    assert("公开 Demo 讲解路径可用", guide.response.ok && guide.payload.citations.length > 0);
  });
  removeDatabase(dbPath);
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

async function requestJson(url, method, body) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return { response, payload: await response.json() };
}

function assert(name, condition) {
  assertionCount += 1;
  if (!condition) throw new Error(`not ok - ${name}`);
  console.log(`ok - ${name}`);
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
