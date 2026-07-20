"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = read("public/index.html");
const css = read("public/museum-lock.css");
const source = read("public/assets/museum-lock.js");
require(path.join(root, "public", "assets", "museum-lock.js"));
const api = globalThis.TimeIsleMuseumLock;
let assertions = 0;

check(api && typeof api.createController === "function", "锁馆控制器可独立加载");
check(typeof api.applyWriteProtection === "function" && typeof api.normalizePublicState === "function", "模块导出状态与体验层边界");
const state = api.normalizePublicState({ status: "locked", revision: 2, verifierConfigured: true });
check(state.status === "locked" && state.revision === 2 && state.verifierConfigured, "只接受安全公开状态");
throws(() => api.normalizePublicState({ status: "locked", revision: 2, verifierConfigured: true, recoveryVerifier: {} }), "拒绝 recoveryVerifier 泄漏");
throws(() => api.normalizePublicState({ status: "locked", revision: 2, verifierConfigured: true, salt: "secret" }), "拒绝 salt 泄漏");
throws(() => api.normalizePublicState({ status: "locked", revision: 2, verifierConfigured: true, digest: "secret" }), "拒绝 digest 泄漏");

const controls = [fakeControl(), fakeControl(true)];
const documentRef = {
  documentElement: { toggleAttribute() {} },
  querySelectorAll: () => controls
};
api.applyWriteProtection(documentRef, true);
check(controls[0].disabled && controls[0].dataset.museumLockDisabled === "true", "锁馆体验层禁用原本可用的写控件");
check(controls[1].disabled && !controls[1].dataset.museumLockDisabled, "不接管原本已禁用的控件");
api.applyWriteProtection(documentRef, false);
check(!controls[0].disabled && controls[1].disabled, "解锁只恢复由锁馆模块接管的控件");

check((html.match(/class="nav-button/g) || []).length === 4 && !html.includes('data-view="museum-lock"'), "锁馆不增加第五项导航");
check(html.includes('<details class="museum-lock-panel" id="museumLockPanel">') && !html.includes('<details class="museum-lock-panel" id="museumLockPanel" open'), "锁馆与演练入口默认折叠");
for (const id of ["museumLockState", "museumLockForm", "museumLockPassphrase", "museumLockPassphraseConfirm", "museumLockAction", "museumLockStatus", "structuralRecoveryFile", "structuralRecoveryStatus"]) {
  check(html.includes(`id="${id}"`), `页面包含 ${id}`);
}
check(
  /id="museumLockPassphrase"[^>]*\sdisabled\s*\/>/u.test(html) &&
    /id="museumLockPassphraseConfirm"[^>]*\sdisabled\s*\/>/u.test(html) &&
    /id="structuralRecoveryFile"[^>]*\sdisabled\s*\/>/u.test(html),
  "锁馆状态读取完成前，口令与私人备份选择默认 fail closed"
);
check(html.includes("不是 SQLite 或磁盘静态加密") && html.includes("不会加密普通备份"), "页面诚实说明应用级写保护边界");
check(html.includes("不能证明具备灾难恢复能力") && !html.includes("恢复成功"), "页面不把结构验真表述为恢复成功");
check(source.includes('LOCK_CONFIRMATION = "LOCK_MUSEUM_WRITES"') && source.includes('UNLOCK_CONFIRMATION = "UNLOCK_MUSEUM_WRITES"'), "锁馆与解锁使用精确确认短语");
check(source.includes("expectedRevision: state.revision") && source.includes("operationId:"), "变更携带 revision CAS 与幂等操作 ID");
check(source.includes("clearSecrets();") && source.includes('body.passphrase = ""') && source.includes('bind(global, "pagehide", destroy)'), "口令在关闭、请求后和离页时清理");
check(source.includes("if (!file || !state || demo || busy) return;") && source.includes("if (demo) {\n        clearSecrets();"), "Demo 或未知状态不会在前端发起私人备份上传并会清空口令");
check(!/localStorage|sessionStorage|indexedDB|URLSearchParams/iu.test(source), "口令与锁馆状态不写浏览器持久化或 URL");
check(source.includes('"/api/recovery-drills/structural"') && source.includes('method: "POST"') && source.includes('"Content-Type": "application/octet-stream"'), "结构演练使用独立二进制只读接口");
check(source.includes('result?.kind !== "structural-verification"') && source.includes("actualRestorePerformed !== false"), "界面拒绝越界演练回执");
check(source.includes("未执行真实恢复、隔离恢复或磁盘加密") && !source.includes("恢复成功"), "结果文案固定保留四项限制");
check(source.includes("MutationObserver") && source.includes("childList: true") && source.includes('attributeFilter: ["disabled"]'), "锁馆后覆盖动态新增写控件并防止其它控制器重新启用");
check(["data-provenance-form", "data-provenance-action", "data-co-memory-confirm-save", "timeCalibrationForm", "oralHistoryForm", "data-curator-action"].every((token) => source.includes(token)), "锁馆体验层覆盖主要动态高级写入口");
check(source.includes("applyWriteProtection(documentRef, locked);") && source.includes('if (locked && typeof global.MutationObserver === "function")'), "公开 Demo 保留安全合成样例入口，只有真实锁馆启用整页写保护");
check(css.includes("min-height: 44px") && css.includes("@media (max-width: 650px)") && css.includes("@media (max-width: 390px)") && css.includes("@media (max-width: 320px)"), "移动端保持触控与三档窄屏边界");
check(css.includes("#structuralRecoveryStatus") && css.includes("overflow-wrap: anywhere"), "合法长备份文件名不会撑宽锁馆面板");
check(["safe-area-inset-right", "safe-area-inset-left"].every((token) => css.includes(token)), "移动端兼容横向安全区");
check(!/gradient\s*\(/iu.test(css), "锁馆界面不使用渐变");

check(source.includes("当前馆藏可写入；设置口令后可启用应用级写保护。") && source.includes("当前馆藏已启用应用级写保护；输入原口令可解除锁馆。"), "锁馆状态读取完成后不再停留在加载文案");

console.log(`Museum-lock UI checks passed: ${assertions} assertions.`);

function fakeControl(disabled = false) {
  return { disabled, dataset: {} };
}

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

function check(value, message) {
  assertions += 1;
  if (!value) throw new Error(`Check failed: ${message}`);
}

function throws(operation, message) {
  let caught = false;
  try { operation(); } catch { caught = true; }
  check(caught, message);
}
