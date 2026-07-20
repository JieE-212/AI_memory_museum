"use strict";

const { EventEmitter } = require("node:events");
const { createInitialMuseumLockState, applyMuseumLockTransition } = require("../lib/museum-lock-service");
const { createMuseumWriteRuntime, isMutationRequest } = require("../lib/museum-write-runtime");

let assertions = 0;

async function main() {
  const unlocked = createInitialMuseumLockState({
    clock: () => "2026-07-19T00:00:00.000Z",
    randomBytes: () => Buffer.alloc(18, 1)
  });
  const verifier = {
    format: "time-isle.recovery-verifier", version: 1, algorithm: "pbkdf2-sha256",
    parameters: { iterations: 310000, keyLength: 32 }, salt: Buffer.alloc(16, 2).toString("base64url"),
    digest: Buffer.alloc(32, 3).toString("base64url")
  };
  const locked = applyMuseumLockTransition(unlocked, {
    action: "lock", confirmation: "LOCK_MUSEUM_WRITES", expectedRevision: 0,
    operationId: "runtime-lock-0001", verifier
  }, { clock: () => "2026-07-19T00:00:01.000Z" }).persistenceRecord;
  let current = unlocked;
  const runtime = createMuseumWriteRuntime({ store: { getMuseumLockState: () => current } });

  check(isMutationRequest("POST", "/api/memories"), "普通 POST 是写请求");
  check(!isMutationRequest("GET", "/api/memories"), "GET 是只读请求");
  check(!isMutationRequest("POST", "/api/archive/inspect"), "归档验真是显式只读 POST");
  check(!isMutationRequest("POST", "/api/recovery-drills/structural"), "结构演练是显式只读 POST");
  check(!isMutationRequest("POST", "/api/museum-lock/unlock"), "锁馆控制保持可用");

  current = locked;
  const blocked = await runtime.enterHttpRequest({ method: "POST" }, response(), url("/api/memories"));
  check(!blocked.allowed && blocked.statusCode === 423 && blocked.code === "MUSEUM_LOCKED" && blocked.bodyBytesRead === 0, "锁馆写请求在正文前返回 423");
  check((await runtime.enterHttpRequest({ method: "GET" }, response(), url("/api/memories"))).allowed, "锁馆 GET 仍可用");
  check((await runtime.enterHttpRequest({ method: "POST" }, response(), url("/api/archive/inspect"))).allowed, "锁馆归档验真仍可用");
  check((await runtime.enterHttpRequest({ method: "POST" }, response(), url("/api/recovery-drills/structural"))).allowed, "锁馆结构演练仍可用");
  check((await runtime.runMaintenance(() => { throw new Error("must not run"); })).skipped, "锁馆后台维护零写入跳过");

  current = unlocked;
  const mutationResponse = response();
  const mutation = await runtime.enterHttpRequest({ method: "POST" }, mutationResponse, url("/api/memories"));
  check(mutation.allowed && mutation.mutation && typeof mutation.settle === "function", "解锁后写请求取得处理期租约");
  const lockResponse = response();
  let lockEntered = false;
  const lockPromise = runtime.enterHttpRequest({ method: "POST" }, lockResponse, url("/api/museum-lock/lock")).then((value) => {
    lockEntered = true;
    return value;
  });
  await tick();
  check(!lockEntered, "锁馆等待在途写请求完成");
  mutationResponse.emit("close");
  await tick();
  check(!lockEntered, "客户端断开不会在处理函数结束前提前释放写租约");
  const pending = await runtime.enterHttpRequest({ method: "DELETE" }, response(), url("/api/memories/example"));
  check(!pending.allowed && pending.code === "MUSEUM_LOCK_TRANSITION_PENDING" && pending.bodyBytesRead === 0, "等待锁馆时拒绝新的写正文");
  mutation.settle();
  const lockDecision = await lockPromise;
  check(lockEntered && lockDecision.allowed && typeof lockDecision.settle === "function", "在途处理函数结算后锁馆控制继续");

  const competingResponse = response();
  const competingTransition = await runtime.enterHttpRequest(
    { method: "POST" }, competingResponse, url("/api/museum-lock/unlock")
  );
  check(
    !competingTransition.allowed && competingTransition.statusCode === 423 &&
      competingTransition.code === "MUSEUM_LOCK_TRANSITION_PENDING" && competingTransition.bodyBytesRead === 0,
    "并发锁馆控制在正文前被拒绝，不与当前切换共享布尔生命周期"
  );
  const stillPending = await runtime.enterHttpRequest({ method: "POST" }, response(), url("/api/memories"));
  check(
    !stillPending.allowed && stillPending.code === "MUSEUM_LOCK_TRANSITION_PENDING" && stillPending.bodyBytesRead === 0,
    "被拒绝的并发控制结束后，当前锁馆切换仍持续阻止新写入"
  );
  lockDecision.settle();

  let maintenanceRelease;
  const maintenance = runtime.runMaintenance(() => new Promise((resolve) => { maintenanceRelease = resolve; }));
  await tick();
  const secondLockResponse = response();
  let secondLockEntered = false;
  const secondLock = runtime.enterHttpRequest({ method: "POST" }, secondLockResponse, url("/api/museum-lock/lock")).then((value) => {
    secondLockEntered = true;
    return value;
  });
  await tick();
  check(!secondLockEntered, "锁馆也会等待后台维护结束");
  maintenanceRelease({ ok: true });
  await maintenance;
  const secondLockDecision = await secondLock;
  check(secondLockEntered, "后台维护结束后锁馆继续");
  secondLockDecision?.settle?.();

  console.log(`Museum write runtime checks passed: ${assertions} assertions.`);
}

function response() {
  return new EventEmitter();
}

function url(pathname) {
  return new URL(`http://127.0.0.1${pathname}`);
}

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

function check(value, message) {
  assertions += 1;
  if (!value) throw new Error(`Check failed: ${message}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
