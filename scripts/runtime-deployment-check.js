"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { resolveRuntimeDeployment } = require("../lib/runtime-deployment");

let assertions = 0;

const local = resolveRuntimeDeployment({}, { interviewDemo: false });
equal("local defaults to port 3000", local.port, 3000);
equal("local defaults to IPv4 loopback", local.bindHost, "127.0.0.1");
equal("local is not a public deployment", local.publicDeployment, false);
equal("local is not a Vercel runtime", local.isVercelRuntime, false);

const publicLoopback = resolveRuntimeDeployment({
  PUBLIC_DEPLOYMENT: "true",
  INTERVIEW_DEMO: "true",
  ALLOWED_HOSTS: "memory.example"
}, { interviewDemo: true });
equal("standalone public mode remains a listening runtime", publicLoopback.isVercelRuntime, false);
equal("standalone public mode enables deployed request boundaries", publicLoopback.publicDeployment, true);
equal("standalone public mode defaults to loopback for a host reverse proxy", publicLoopback.bindHost, "127.0.0.1");

const publicContainer = resolveRuntimeDeployment({
  PUBLIC_DEPLOYMENT: "on",
  ALLOWED_HOSTS: "memory.example",
  BIND_HOST: "0.0.0.0",
  PORT: "3100"
}, { interviewDemo: true });
equal("container public mode permits an explicit wildcard bind", publicContainer.bindHost, "0.0.0.0");
equal("container public mode accepts an explicit port", publicContainer.port, 3100);

const vercel = resolveRuntimeDeployment({ VERCEL: "1", BIND_HOST: "0.0.0.0", PORT: "not-used" }, { interviewDemo: true });
equal("Vercel remains a serverless runtime", vercel.isVercelRuntime, true);
equal("Vercel uses deployed request boundaries", vercel.publicDeployment, true);
equal("Vercel ignores standalone bind configuration", vercel.bindHost, "127.0.0.1");
equal("Vercel ignores a standalone listener port", vercel.port, 3000);

equal("an explicit false public flag preserves local mode", resolveRuntimeDeployment({ PUBLIC_DEPLOYMENT: "false" }).publicDeployment, false);
throws("a misspelled public flag fails fast", () => resolveRuntimeDeployment({ PUBLIC_DEPLOYMENT: "treu" }), TypeError);
throws("local mode cannot bind all IPv4 interfaces", () => resolveRuntimeDeployment({ BIND_HOST: "0.0.0.0" }), TypeError);
throws("local mode cannot bind all IPv6 interfaces", () => resolveRuntimeDeployment({ BIND_HOST: "::" }), TypeError);
throws("an arbitrary bind hostname fails fast", () => resolveRuntimeDeployment({ BIND_HOST: "memory.example" }), TypeError);
throws("standalone public mode requires Demo protections", () => resolveRuntimeDeployment({ PUBLIC_DEPLOYMENT: "true", ALLOWED_HOSTS: "memory.example" }, { interviewDemo: false }), TypeError);
throws("standalone public mode requires an exact host allowlist", () => resolveRuntimeDeployment({ PUBLIC_DEPLOYMENT: "true", ALLOWED_HOSTS: "  " }, { interviewDemo: true }), TypeError);
throws("a non-numeric port fails fast", () => resolveRuntimeDeployment({ PORT: "three-thousand" }), TypeError);
throws("port zero fails fast", () => resolveRuntimeDeployment({ PORT: "0" }), TypeError);
throws("an out-of-range port fails fast", () => resolveRuntimeDeployment({ PORT: "65536" }), TypeError);

const marker = `${Date.now()}-${process.pid}`;
const dbPath = path.join(os.tmpdir(), `ai-memory-museum-vercel-runtime-${marker}.sqlite`);
const mediaRoot = path.join(os.tmpdir(), `ai-memory-museum-vercel-runtime-media-${marker}`);
try {
  const vercelProbe = spawnSync(process.execPath, ["-e", [
    "const http=require('node:http');",
    "http.createServer=()=>{throw new Error('Vercel runtime must not create a listener')};",
    "const handler=require('./api/index.js');",
    "if(typeof handler!=='function')throw new Error('Vercel entry must export a handler');",
    "process.stdout.write('handler-exported');"
  ].join("")], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8",
    timeout: 20000,
    env: {
      ...process.env,
      VERCEL: "1",
      VERCEL_URL: "runtime-probe.vercel.app",
      PUBLIC_DEPLOYMENT: "false",
      BIND_HOST: "0.0.0.0",
      PORT: "not-used",
      INTERVIEW_DEMO: "true",
      DEMO_MODE: "",
      ALLOWED_HOSTS: "",
      DB_PATH: dbPath,
      MEDIA_ROOT: mediaRoot,
      AI_API_KEY: ""
    }
  });
  check(
    "Vercel entry exports a handler without creating a listener",
    vercelProbe.status === 0 && vercelProbe.stdout === "handler-exported",
    vercelProbe.error || vercelProbe.stderr
  );
} finally {
  for (const target of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`, mediaRoot]) {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
}

console.log(`Runtime deployment checks passed: ${assertions} assertions.`);

function equal(name, actual, expected) {
  check(name, actual === expected);
}

function throws(name, operation, ErrorType) {
  let caught = null;
  try {
    operation();
  } catch (error) {
    caught = error;
  }
  check(name, caught instanceof ErrorType);
}

function check(name, condition, detail = "") {
  assertions += 1;
  if (!condition) throw new Error(`not ok - ${name}${detail ? `: ${detail}` : ""}`);
  console.log(`ok - ${name}`);
}
