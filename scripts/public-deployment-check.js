"use strict";

const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");

const root = path.resolve(__dirname, "..");
const authority = "demo.tencent.example";
const marker = `${Date.now()}-${process.pid}`;
const tempRoot = path.join(os.tmpdir(), `ai-memory-museum-public-deployment-${marker}`);
const dbPath = path.join(tempRoot, "ai-memory-museum-public-deployment.sqlite");
const mediaRoot = path.join(tempRoot, "ai-memory-museum-public-deployment-media");
let assertions = 0;

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

async function run() {
  let server = null;
  try {
    server = await startServer();
    const health = await requestJson(server.port, { path: "/api/health" });
    check("standalone public health is available through the exact host", health.status === 200 && health.payload.ok === true && health.payload.version === "17.1.2" && health.payload.schemaVersion === 19);

    const status = await requestJson(server.port, { path: "/api/demo/status" });
    check("standalone public runtime is the protected seeded Demo", status.status === 200 && status.payload.interviewDemo === true && status.payload.aiMode === "public-mock" && status.payload.seededExamples === 4 && status.payload.seededExhibitions === 1 && status.payload.seededTimeCalibrations === 1);

    const trust = await requestJson(server.port, { path: "/api/runtime/trust" });
    check("standalone public runtime exposes one truthful read-only trust contract", trust.status === 200 && trust.payload.appVersion === "17.1.2" && trust.payload.schemaVersion === 19 && trust.payload.audience === "public-demo" && trust.payload.deployment?.kind === "public-container" && trust.payload.deployment?.public === true && trust.payload.deployment?.tenancy === "shared-anonymous-read-only" && trust.payload.storage?.visitorWritesAllowed === false && trust.payload.externalAi?.allowed === false && trust.payload.encryptionAtRest?.enabled === false);

    const unknownHost = await requestJson(server.port, { host: "attacker.example", path: "/api/health" });
    check("standalone public runtime rejects an unlisted host", unknownHost.status === 421 && unknownHost.payload.code === "HOST_NOT_ALLOWED");
    const stalePlatformHost = await requestJson(server.port, { host: "stale-preview.vercel.app", path: "/api/health" });
    check("standalone public runtime ignores stale Vercel host variables", stalePlatformHost.status === 421 && stalePlatformHost.payload.code === "HOST_NOT_ALLOWED");

    const insecureOrigin = await requestJson(server.port, {
      method: "POST",
      path: "/api/memories",
      origin: `http://${authority}`,
      body: { id: "insecure-origin-probe", title: "不应保存", rawContent: "不应被读取。" }
    });
    check("standalone public writes still reject an insecure Origin before reaching any body-capable route", insecureOrigin.status === 403 && insecureOrigin.payload.code === "ORIGIN_MISMATCH");

    const blockedCreate = await requestJson(server.port, {
      method: "POST",
      path: "/api/memories",
      origin: `https://${authority}`,
      body: {
        id: "public-deployment-probe",
        title: "腾讯云公网模式虚构探针",
        hall: "daily",
        sourceType: "文档摘录",
        rawContent: "这是一条可丢弃的公开部署回归文本。",
        exhibitText: "用于确认核心文本仍受容量保护地临时可写。"
      }
    });
    check("standalone public Demo rejects same-origin memory creation before reading its body", blockedCreate.status === 403 && blockedCreate.payload.code === "INTERVIEW_DEMO_READ_ONLY" && blockedCreate.payload.bodyBytesRead === 0 && blockedCreate.payload.persistence?.wrote === false);

    const healthBefore = await requestJson(server.port, { path: "/api/health" });
    const lockBefore = await requestJson(server.port, { path: "/api/museum-lock" });
    check("public Demo remains at the four fixed fictional memories", healthBefore.payload.stats.memories === 4);

    const lockProbe = await requestJson(server.port, {
      method: "POST",
      path: "/api/museum-lock/lock",
      origin: `https://${authority}`,
      contentType: "text/plain; charset=utf-8",
      body: "TENCENT_LOCK_ZERO_WRITE_PROBE_DO_NOT_READ"
    });
    check("standalone public lock probe is rejected by the global Demo guard before reading its body", lockProbe.status === 403 && lockProbe.payload.code === "INTERVIEW_DEMO_READ_ONLY" && lockProbe.payload.bodyBytesRead === 0 && lockProbe.payload.persistence?.wrote === false);

    const drillProbe = await requestJson(server.port, {
      method: "POST",
      path: "/api/recovery-drills/structural",
      origin: `https://${authority}`,
      contentType: "text/plain",
      body: "A".repeat(2048)
    });
    check("standalone public recovery probe is rejected by the global Demo guard before reading its body", drillProbe.status === 403 && drillProbe.payload.code === "INTERVIEW_DEMO_READ_ONLY" && drillProbe.payload.bodyBytesRead === 0 && drillProbe.payload.persistence?.wrote === false);

    const healthAfter = await requestJson(server.port, { path: "/api/health" });
    const lockAfter = await requestJson(server.port, { path: "/api/museum-lock" });
    check("protected probes leave public Demo statistics unchanged", canonical(healthAfter.payload.stats) === canonical(healthBefore.payload.stats));
    check("protected probes leave the public lock state unchanged", lockCore(lockAfter.payload) === lockCore(lockBefore.payload));

    if (!(await stopServer(server.child))) throw new Error("Public deployment server could not be stopped after the first run.");
    server = await startServer();
    const restartedHealth = await requestJson(server.port, { path: "/api/health" });
    const restartedMemories = await requestJson(server.port, { path: "/api/memories" });
    check("standalone public restart still exposes exactly four fixed seeds", restartedHealth.payload.stats.memories === 4 && restartedMemories.payload.memories.length === 4 && !restartedMemories.payload.memories.some((memory) => memory.id === "public-deployment-probe"));

    console.log(`Public deployment checks passed: ${assertions} assertions.`);
  } finally {
    const stopped = server?.child ? await stopServer(server.child) : true;
    cleanup();
    if (!stopped) throw new Error("Public deployment server could not be stopped during cleanup.");
  }
}

async function startServer() {
  const port = await getFreePort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: {
      ...process.env,
      VERCEL: "",
      VERCEL_URL: "stale-preview.vercel.app",
      PUBLIC_DEPLOYMENT: "true",
      INTERVIEW_DEMO: "true",
      DEMO_MODE: "",
      BIND_HOST: "0.0.0.0",
      ALLOWED_HOSTS: authority,
      DEPLOYMENT_PLATFORM: "public-container",
      PORT: String(port),
      DB_PATH: dbPath,
      MEDIA_ROOT: mediaRoot,
      AI_API_KEY: "must-be-ignored-in-public-demo",
      AI_BASE_URL: "http://127.0.0.1:1"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });

  try {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`Public deployment server exited early.\n${output}`);
      try {
        const response = await requestJson(port, { path: "/api/health", timeoutMs: 500 });
        if (response.status === 200) return { child, port };
      } catch {
        // The listener may still be starting.
      }
      await delay(100);
    }
    throw new Error(`Public deployment server did not become ready.\n${output}`);
  } catch (error) {
    if (!(await stopServer(child))) throw new Error(`Public deployment startup failed and its child could not be stopped: ${error.message}`);
    throw error;
  }
}

function requestJson(port, options = {}) {
  const method = options.method || "GET";
  const contentType = options.contentType || "application/json";
  const body = options.body === undefined
    ? null
    : Buffer.from(contentType.startsWith("application/json") ? JSON.stringify(options.body) : String(options.body));
  const headers = { Host: options.host || authority, Accept: "application/json" };
  if (options.origin) {
    headers.Origin = options.origin;
    headers["Sec-Fetch-Site"] = "same-origin";
  }
  if (body) {
    headers["Content-Type"] = contentType;
    headers["Content-Length"] = String(body.length);
  }

  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: "127.0.0.1", port, path: options.path || "/", method, headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let payload = {};
        try {
          payload = text ? JSON.parse(text) : {};
        } catch {
          return reject(new Error(`Expected JSON from ${method} ${options.path}: ${text.slice(0, 200)}`));
        }
        resolve({ status: response.statusCode, payload });
      });
    });
    request.setTimeout(options.timeoutMs || 5000, () => request.destroy(new Error("Request timed out.")));
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const port = probe.address().port;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function stopServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    let finished = false;
    let forceTimer = null;
    let giveUpTimer = null;
    const finish = (stopped) => {
      if (finished) return;
      finished = true;
      clearTimeout(forceTimer);
      clearTimeout(giveUpTimer);
      resolve(stopped);
    };
    child.once("exit", () => finish(true));
    forceTimer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { finish(child.exitCode !== null || child.signalCode !== null); }
    }, 3000);
    giveUpTimer = setTimeout(() => {
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.unref();
      finish(false);
    }, 5000);
    try { child.kill("SIGTERM"); } catch { finish(child.exitCode !== null || child.signalCode !== null); }
  });
}

function cleanup() {
  const resolved = path.resolve(tempRoot);
  const relative = path.relative(path.resolve(os.tmpdir()), resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !path.basename(resolved).startsWith("ai-memory-museum-public-deployment-")) {
    throw new Error(`Refusing to clean an unsafe public-deployment temp path: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  if (fs.existsSync(resolved)) throw new Error(`Public-deployment temp cleanup did not finish: ${resolved}`);
}

function canonical(value) {
  return JSON.stringify(value);
}

function lockCore(payload) {
  return canonical({ status: payload.state.status, revision: payload.state.revision, verifierConfigured: payload.state.verifierConfigured });
}

function check(name, condition) {
  assertions += 1;
  if (!condition) throw new Error(`not ok - ${name}`);
  console.log(`ok - ${name}`);
}
