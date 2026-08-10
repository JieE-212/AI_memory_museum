"use strict";

const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const RUN_PREFIX = "ai-memory-museum-browser-gate-";

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});

async function main() {
  const [demoPort, writablePort] = await Promise.all([reservePort(), reservePort()]);
  const runToken = `${process.pid}-${Date.now()}`;
  const tempRoot = assertOwnedTempPath(path.join(os.tmpdir(), `${RUN_PREFIX}${runToken}`));
  const cliPath = require.resolve("@playwright/test/cli");
  const rootDir = path.resolve(__dirname, "../../..");
  const baseURL = `http://127.0.0.1:${demoPort}`;
  const writableBaseURL = `http://127.0.0.1:${writablePort}`;
  const sharedEnv = {
    ...process.env,
    BROWSER_GATE_BASE_URL: baseURL,
    BROWSER_GATE_WRITABLE_BASE_URL: writableBaseURL,
    BROWSER_GATE_RUN_TOKEN: runToken
  };

  const demoServer = spawnMuseumServer({
    rootDir,
    sharedEnv,
    port: demoPort,
    interviewDemo: true,
    dbPath: path.join(tempRoot, "ai-memory-museum-browser-gate-demo.sqlite"),
    mediaRoot: path.join(tempRoot, "ai-memory-museum-browser-gate-demo-media")
  });
  const writableServer = spawnMuseumServer({
    rootDir,
    sharedEnv,
    port: writablePort,
    interviewDemo: false,
    dbPath: path.join(tempRoot, "ai-memory-museum-browser-gate-writable.sqlite"),
    mediaRoot: path.join(tempRoot, "ai-memory-museum-browser-gate-writable-media")
  });
  prefixOutput(demoServer.stdout, "[Demo] ");
  prefixOutput(demoServer.stderr, "[Demo] ");
  prefixOutput(writableServer.stdout, "[Writable] ");
  prefixOutput(writableServer.stderr, "[Writable] ");

  let tests = null;
  let forwardedSignal = null;
  const servers = [demoServer, writableServer];
  const forward = (signal) => {
    forwardedSignal = signal;
    if (tests && !tests.killed) terminateWithBudget(tests, signal);
    for (const server of servers) if (!server.killed) terminateWithBudget(server, signal);
  };
  process.once("SIGINT", forward);
  process.once("SIGTERM", forward);

  let exitCode = 1;
  try {
    await Promise.all([
      waitForMode(baseURL, demoServer, "interview-demo", "Interview Demo"),
      waitForMode(writableBaseURL, writableServer, "local", "Writable local service")
    ]);
    tests = spawn(process.execPath, [cliPath, "test", ...process.argv.slice(2)], {
      cwd: path.resolve(__dirname, ".."),
      env: sharedEnv,
      stdio: "inherit",
      windowsHide: true
    });
    exitCode = await waitForExit(tests);
  } finally {
    process.removeListener("SIGINT", forward);
    process.removeListener("SIGTERM", forward);
    const stopped = await Promise.all(servers.map((server) => stopChild(server)));
    let cleanupError = null;
    try { removeTempTree(tempRoot); } catch (error) { cleanupError = error; }
    if (stopped.some((value) => value !== true) || cleanupError) {
      const running = servers.filter((server, index) => stopped[index] !== true).map((server) => server.pid).join(", ");
      throw new Error([running && `Browser-gate child processes did not stop: ${running}.`, cleanupError?.message].filter(Boolean).join(" "));
    }
  }

  if (forwardedSignal) process.kill(process.pid, forwardedSignal);
  process.exitCode = exitCode;
}

function spawnMuseumServer({ rootDir, sharedEnv, port, interviewDemo, dbPath, mediaRoot }) {
  return spawn(process.execPath, [path.join(rootDir, "server.js")], {
    cwd: rootDir,
    env: {
      ...sharedEnv,
      PORT: String(port),
      VERCEL: "",
      PUBLIC_DEPLOYMENT: "false",
      BIND_HOST: "127.0.0.1",
      ALLOWED_HOSTS: "",
      DEMO_MODE: "false",
      INTERVIEW_DEMO: interviewDemo ? "true" : "false",
      AI_API_KEY: "",
      DB_PATH: dbPath,
      MEDIA_ROOT: mediaRoot,
      VOICE_ROOT: path.join(mediaRoot, "voice")
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForMode(baseURL, server, expectedMode, label) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`${label} exited before becoming ready (code ${server.exitCode}).`);
    try {
      const response = await fetch(`${baseURL}/api/health`, { signal: AbortSignal.timeout(1_000) });
      const payload = response.ok ? await response.json() : null;
      if (payload?.ok === true && payload?.mode === expectedMode) return;
      if (response.ok) throw new Error(`${label} reported ${payload?.mode || "an unknown mode"} instead of ${expectedMode}.`);
    } catch (error) {
      if (error.message.includes(" instead of ")) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label} did not become ready at ${baseURL}.`);
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(code ?? signalExitCode(signal)));
  });
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return true;
  child.kill("SIGTERM");
  const stopped = await Promise.race([
    waitForExit(child).then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 5_000))
  ]);
  if (!stopped && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    return await Promise.race([
      waitForExit(child).then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 2_000))
    ]);
  }
  return true;
}

function assertOwnedTempPath(candidate) {
  const resolved = path.resolve(candidate);
  const tempRoot = path.resolve(os.tmpdir());
  const relative = path.relative(tempRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !path.basename(resolved).startsWith(RUN_PREFIX)) {
    throw new Error(`Refusing to use an unsafe browser-gate temp path: ${resolved}`);
  }
  return resolved;
}

function removeTempTree(candidate) {
  const resolved = assertOwnedTempPath(candidate);
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  if (fs.existsSync(resolved)) throw new Error(`Browser-gate temp cleanup did not finish: ${resolved}`);
}

function terminateWithBudget(child, signal) {
  try { child.kill(signal); } catch { return; }
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      try { child.kill("SIGKILL"); } catch { /* final cleanup reports a live process */ }
    }
  }, 5_000);
  timer.unref?.();
}

function prefixOutput(stream, prefix) {
  if (!stream) return;
  let pending = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || "";
    for (const line of lines) console.log(`${prefix}${line}`);
  });
  stream.on("end", () => {
    if (pending) console.log(`${prefix}${pending}`);
  });
}

function signalExitCode(signal) {
  return signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1;
}
