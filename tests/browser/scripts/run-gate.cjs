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
  const port = await reservePort();
  const runToken = `${process.pid}-${Date.now()}`;
  const tempRoot = assertOwnedTempPath(path.join(os.tmpdir(), `${RUN_PREFIX}${runToken}`));
  const cliPath = require.resolve("@playwright/test/cli");
  const rootDir = path.resolve(__dirname, "../../..");
  const baseURL = `http://127.0.0.1:${port}`;
  const sharedEnv = {
    ...process.env,
    BROWSER_GATE_BASE_URL: baseURL,
    BROWSER_GATE_RUN_TOKEN: runToken
  };

  const server = spawn(process.execPath, [path.join(rootDir, "server.js")], {
    cwd: rootDir,
    env: {
      ...sharedEnv,
      PORT: String(port),
      VERCEL: "",
      PUBLIC_DEPLOYMENT: "false",
      BIND_HOST: "127.0.0.1",
      ALLOWED_HOSTS: "",
      DEMO_MODE: "false",
      INTERVIEW_DEMO: "true",
      AI_API_KEY: "",
      DB_PATH: path.join(tempRoot, "ai-memory-museum-browser-gate.sqlite"),
      MEDIA_ROOT: path.join(tempRoot, "ai-memory-museum-browser-gate-media")
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  prefixOutput(server.stdout, "[Demo] ");
  prefixOutput(server.stderr, "[Demo] ");

  let tests = null;
  let forwardedSignal = null;
  const forward = (signal) => {
    forwardedSignal = signal;
    if (tests && !tests.killed) tests.kill(signal);
    if (!server.killed) server.kill(signal);
  };
  process.once("SIGINT", forward);
  process.once("SIGTERM", forward);

  let exitCode = 1;
  try {
    await waitForDemo(baseURL, server);
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
    await stopChild(server);
    removeTempTree(tempRoot);
  }

  if (forwardedSignal) process.kill(process.pid, forwardedSignal);
  process.exitCode = exitCode;
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

async function waitForDemo(baseURL, server) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Interview Demo exited before becoming ready (code ${server.exitCode}).`);
    try {
      const response = await fetch(`${baseURL}/api/health`, { signal: AbortSignal.timeout(1_000) });
      const payload = response.ok ? await response.json() : null;
      if (payload?.ok === true && payload?.mode === "interview-demo") return;
      if (response.ok) throw new Error("The isolated server did not report interview-demo mode.");
    } catch (error) {
      if (error.message === "The isolated server did not report interview-demo mode.") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Interview Demo did not become ready at ${baseURL}.`);
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(code ?? signalExitCode(signal)));
  });
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const stopped = await Promise.race([
    waitForExit(child).then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 5_000))
  ]);
  if (!stopped && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await Promise.race([
      waitForExit(child),
      new Promise((resolve) => setTimeout(resolve, 2_000))
    ]);
  }
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
  try {
    fs.rmSync(assertOwnedTempPath(candidate), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    console.warn(`Browser-gate temp cleanup did not finish: ${error.message}`);
  }
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
