(function initializeTimeIsleMuseumLock(global) {
  "use strict";

  const LOCK_CONFIRMATION = "LOCK_MUSEUM_WRITES";
  const UNLOCK_CONFIRMATION = "UNLOCK_MUSEUM_WRITES";
  const WRITE_CONTROL_SELECTORS = [
    "#memoryForm button", "#memoryForm textarea", "#draftForm button", "#draftForm input", "#draftForm select", "#draftForm textarea",
    "#photoInput", "#voiceRecordButton", "#voiceFileInput", "#memoryInboxOpenButton", "#curatorAgentButton",
    "#exhibitionStudioButton", "#capsuleStudioButton", "#collectionHealthStart", "#archiveImportFile", "#importFile", "#purgeButton",
    "#dialogEditButton", "#dialogDeleteButton", "#guideQuestion", "#guideAskButton",
    "#timeCalibrationForm :is(button,input,select,textarea)", "#oralHistoryForm :is(button,input,select,textarea)",
    "[data-provenance-form] :is(button,input,select,textarea)", "[data-provenance-action]", "[data-co-memory-confirm-save]",
    "[data-curator-action]", "[data-curator-run-delete]", "[data-curator-run-delete-confirm]"
  ];

  function createController(options = {}) {
    const documentRef = options.document || global.document;
    const fetchImpl = options.fetch || global.fetch?.bind(global);
    if (!documentRef || typeof fetchImpl !== "function") return null;
    const elements = resolveElements(documentRef);
    if (!elements) return null;
    let state = null;
    let demo = false;
    let busy = false;
    let request = null;
    let protectionObserver = null;
    const listeners = [];

    bind(elements.form, "submit", submitTransition);
    bind(elements.panel, "toggle", () => {
      if (!elements.panel.open) clearSecrets();
    });
    bind(elements.isolatedFile, "change", runIsolatedRecovery);
    bind(elements.drillFile, "change", runStructuralDrill);
    bind(global, "pagehide", destroy);
    void loadState();

    function bind(target, type, handler) {
      target?.addEventListener?.(type, handler);
      listeners.push({ target, type, handler });
    }

    async function loadState() {
      setLockStatus("正在读取本机锁馆状态…");
      try {
        const payload = await requestJson("/api/museum-lock", { method: "GET" });
        state = normalizePublicState(payload.state);
        demo = payload.demo === true;
        render();
        if (!demo) setLockStatus(state.status === "locked"
          ? "当前馆藏已启用应用级写保护；输入原口令可解除锁馆。"
          : state.verifierConfigured
            ? "当前馆藏可写入；输入原口令可重新锁馆。"
            : "当前馆藏可写入；设置口令后可启用应用级写保护。");
      } catch (error) {
        setLockStatus(`锁馆状态读取失败：${message(error)}`, true);
        elements.action.disabled = true;
      }
    }

    async function submitTransition(event) {
      event.preventDefault();
      if (!state || busy || demo) return;
      const action = state.status === "locked" ? "unlock" : "lock";
      const passphrase = elements.passphrase.value;
      if (!passphrase.trim() || new TextEncoder().encode(passphrase).byteLength < 8) {
        setLockStatus("口令至少需要 8 个 UTF-8 字节，并且不能只有空白。", true);
        elements.passphrase.focus();
        return;
      }
      if (action === "lock" && !state.verifierConfigured && passphrase !== elements.confirm.value) {
        setLockStatus("两次输入的口令不一致；尚未执行锁馆。", true);
        elements.confirm.focus();
        return;
      }
      if (action === "lock" && !global.confirm("锁馆后，新增、编辑、删除、导入和恢复都会在读取正文前被阻止。继续吗？")) return;
      const body = {
        confirmation: action === "lock" ? LOCK_CONFIRMATION : UNLOCK_CONFIRMATION,
        expectedRevision: state.revision,
        operationId: `museum-lock:${randomId()}`,
        passphrase
      };
      clearSecrets();
      setBusy(true);
      setLockStatus(action === "lock" ? "正在等待已有写操作结束并锁馆…" : "正在核对口令并解除锁馆…");
      try {
        const payload = await requestJson(`/api/museum-lock/${action}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        state = normalizePublicState(payload.state);
        render();
        setLockStatus(action === "lock"
          ? "已启用应用级写保护；读取、导出、备份验真与结构演练仍可使用。"
          : "已解除写保护；原馆藏内容没有被覆盖或重写。", false, true);
      } catch (error) {
        setLockStatus(message(error), true);
      } finally {
        body.passphrase = "";
        setBusy(false);
      }
    }

    async function runStructuralDrill(event) {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file || !state || demo || busy) return;
      if (!String(file.name || "").toLowerCase().endsWith(".time-isle")) {
        return setDrillStatus("请选择扩展名为 .time-isle 的完整备份。", true);
      }
      setBusy(true);
      setDrillStatus(`正在隔离验真 ${file.name}；不会写入当前馆藏…`);
      try {
        const payload = await requestJson("/api/recovery-drills/structural", {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: file
        });
        const result = payload.verification;
        if (result?.kind !== "structural-verification" || result?.limitations?.actualRestorePerformed !== false) {
          throw new Error("服务器没有返回受限的结构验真回执。");
        }
        setDrillStatus(
          `结构验真通过：${result.archive.entryCount} 个条目、${result.checks.references.memoryCount} 件展品；未执行真实恢复、隔离恢复或磁盘加密。`,
          false,
          true
        );
      } catch (error) {
        setDrillStatus(`结构演练未通过：${message(error)}；当前馆藏没有被写入。`, true);
      } finally {
        setBusy(false);
      }
    }

    async function runIsolatedRecovery(event) {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file || !state || demo || busy) return;
      resetIsolatedSteps();
      if (!String(file.name || "").toLowerCase().endsWith(".time-isle")) {
        return setIsolatedStatus("请选择扩展名为 .time-isle 的完整备份。", true);
      }
      setBusy(true);
      setIsolatedStatus(`正在验真并把 ${file.name} 恢复到本机一次性副本；完成体检和销毁前不会显示通过…`);
      try {
        const payload = await requestJson("/api/recovery-drills/isolated-restore", {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: file
        });
        const receipt = payload.receipt;
        if (receipt?.kind !== "isolated-restore" || receipt?.verdict !== "passed-isolated-restore" ||
            receipt?.isolation?.currentMuseumCapabilityProvided !== false ||
            receipt?.isolation?.sandboxDestroyed !== true ||
            receipt?.limitations?.disasterRecoveryProven !== false) {
          throw new Error("服务器没有返回安全、完整的一次性恢复回执。");
        }
        markIsolatedStepsPassed();
        const counts = receipt.checks?.restore?.counts || {};
        const database = receipt.checks?.database || {};
        setIsolatedStatus(
          `演练通过：${safeCount(counts.memories)} 件展品、${safeCount(counts.mediaAssets)} 组图片、${safeCount(counts.voiceAssets)} 段声音已在一次性副本真实恢复，${safeCount(database.passed)} 项数据库体检通过；副本已关闭并销毁。该结果不等于异机灾备、磁盘加密或生产恢复承诺。`,
          false,
          true
        );
      } catch (error) {
        resetIsolatedSteps();
        setIsolatedStatus(`一次性恢复演练未通过：${message(error)}；当前馆藏没有获得本次演练的写入。`, true);
      } finally {
        setBusy(false);
      }
    }

    async function requestJson(url, requestOptions) {
      request?.abort();
      request = new AbortController();
      const response = await fetchImpl(url, { credentials: "same-origin", cache: "no-store", ...requestOptions, signal: request.signal });
      const text = await response.text();
      let payload = {};
      try { payload = text ? JSON.parse(text) : {}; } catch { throw new Error("服务器返回了无法读取的结果。"); }
      if (!response.ok) {
        const error = new Error(payload.error || `请求未完成（HTTP ${response.status}）`);
        error.code = payload.code || "MUSEUM_LOCK_REQUEST_FAILED";
        throw error;
      }
      return payload;
    }

    function render() {
      const locked = state.status === "locked";
      elements.state.textContent = demo ? "Demo 只读" : locked ? "已锁馆" : "可写入";
      elements.state.dataset.state = demo ? "demo" : state.status;
      elements.confirmField.hidden = locked || state.verifierConfigured;
      elements.confirm.required = !locked && !state.verifierConfigured;
      elements.action.textContent = locked ? "核对口令并解除锁馆" : state.verifierConfigured ? "使用原口令重新锁馆" : "设置口令并锁馆";
      elements.action.disabled = busy || demo;
      elements.passphrase.disabled = busy || demo;
      elements.confirm.disabled = busy || demo || elements.confirmField.hidden;
      elements.isolatedFile.disabled = busy || demo;
      elements.isolatedLabel.classList.toggle("is-disabled", busy || demo);
      elements.isolatedLabel.setAttribute("aria-disabled", String(busy || demo));
      elements.drillFile.disabled = busy || demo;
      elements.drillLabel.classList.toggle("is-disabled", busy || demo);
      elements.drillLabel.setAttribute("aria-disabled", String(busy || demo));
      protectionObserver?.disconnect();
      protectionObserver = null;
      // Demo mode already has its own read-only controllers and still needs to
      // expose safe synthetic previews. Only a real museum lock should apply
      // the page-wide write-control overlay.
      applyWriteProtection(documentRef, locked);
      if (locked && typeof global.MutationObserver === "function") {
        protectionObserver = new global.MutationObserver((records) => records.forEach((record) => {
          if (record.type === "childList") {
            applyWriteProtection(documentRef, true);
            return;
          }
          const target = record.target;
          if (target?.matches?.(WRITE_CONTROL_SELECTORS.join(",")) && !target.disabled) {
            target.dataset.museumLockDisabled = "true";
            target.disabled = true;
          }
        }));
        protectionObserver.observe(documentRef.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["disabled"] });
      }
      if (demo) {
        clearSecrets();
        setIsolatedStatus("公开 Demo 不读取、暂存或恢复私人备份；请在本地版本运行一次性恢复演练。");
        setLockStatus("公开 Demo 不接收口令、备份或锁馆请求；本地版本才会保存写保护状态。");
        setDrillStatus("公开 Demo 不暂存私人备份；请在本地版本运行结构演练。");
      }
    }

    function setBusy(value) {
      busy = Boolean(value);
      if (state) render();
    }

    function clearSecrets() {
      elements.passphrase.value = "";
      elements.confirm.value = "";
    }

    function setLockStatus(text, error = false, success = false) {
      setStatus(elements.status, text, error, success);
    }

    function setDrillStatus(text, error = false, success = false) {
      setStatus(elements.drillStatus, text, error, success);
    }

    function setIsolatedStatus(text, error = false, success = false) {
      setStatus(elements.isolatedStatus, text, error, success);
    }

    function resetIsolatedSteps() {
      elements.isolatedSteps.hidden = true;
      elements.isolatedSteps.querySelectorAll("[data-isolated-step]").forEach((step) => delete step.dataset.state);
    }

    function markIsolatedStepsPassed() {
      elements.isolatedSteps.hidden = false;
      elements.isolatedSteps.querySelectorAll("[data-isolated-step]").forEach((step) => { step.dataset.state = "passed"; });
    }

    function destroy() {
      request?.abort();
      protectionObserver?.disconnect();
      clearSecrets();
      listeners.forEach(({ target, type, handler }) => target?.removeEventListener?.(type, handler));
      listeners.length = 0;
    }

    return Object.freeze({ destroy, refresh: loadState });
  }

  function applyWriteProtection(documentRef, protectedMode) {
    documentRef.documentElement?.toggleAttribute?.("data-museum-locked", protectedMode);
    documentRef.querySelectorAll(WRITE_CONTROL_SELECTORS.join(",")).forEach((element) => {
      if (protectedMode && !element.disabled) {
        element.dataset.museumLockDisabled = "true";
        element.disabled = true;
      } else if (!protectedMode && element.dataset.museumLockDisabled === "true") {
        element.disabled = false;
        delete element.dataset.museumLockDisabled;
      }
    });
  }

  function resolveElements(documentRef) {
    const ids = {
      panel: "museumLockPanel", state: "museumLockState", form: "museumLockForm", passphrase: "museumLockPassphrase",
      confirmField: "museumLockConfirmField", confirm: "museumLockPassphraseConfirm", action: "museumLockAction",
      status: "museumLockStatus", isolatedFile: "isolatedRecoveryFile", isolatedSteps: "isolatedRecoverySteps",
      isolatedStatus: "isolatedRecoveryStatus", drillFile: "structuralRecoveryFile", drillStatus: "structuralRecoveryStatus"
    };
    const elements = Object.fromEntries(Object.entries(ids).map(([key, id]) => [key, documentRef.getElementById(id)]));
    elements.isolatedLabel = documentRef.querySelector('label[for="isolatedRecoveryFile"]');
    elements.drillLabel = documentRef.querySelector('label[for="structuralRecoveryFile"]');
    return Object.values(elements).every(Boolean) ? elements : null;
  }

  function normalizePublicState(value) {
    if (!value || !["locked", "unlocked"].includes(value.status) || !Number.isSafeInteger(value.revision) ||
        typeof value.verifierConfigured !== "boolean" || Object.hasOwn(value, "recoveryVerifier") ||
        Object.hasOwn(value, "salt") || Object.hasOwn(value, "digest")) {
      throw new Error("锁馆状态缺少安全公开投影。");
    }
    return Object.freeze({ status: value.status, revision: value.revision, verifierConfigured: value.verifierConfigured });
  }

  function setStatus(element, text, error, success) {
    element.textContent = String(text || "");
    element.classList.toggle("is-error", Boolean(error));
    element.classList.toggle("is-success", Boolean(success));
  }

  function randomId() {
    return typeof global.crypto?.randomUUID === "function" ? global.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function message(error) {
    if (error?.code === "ISOLATED_RECOVERY_CLEANUP_REQUIRED") {
      return "上一次演练的一次性副本尚未成功销毁；系统已在读取新备份前停止。请稍后重试，若持续出现请重启本地服务。";
    }
    if (error?.code === "ISOLATED_RECOVERY_CLEANUP_FAILED") {
      return "本次一次性副本未能安全销毁；新演练已暂停，当前馆藏没有被写入。请稍后重试清理。";
    }
    if (error?.code === "MUSEUM_LOCK_VERIFIER_MISMATCH") return "口令不正确；锁馆状态没有变化。";
    if (error?.code === "MUSEUM_LOCK_REVISION_CONFLICT") return "锁馆状态已变化，请刷新后再试。";
    return String(error?.message || error || "请求未完成。");
  }

  function safeCount(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : 0;
  }

  const api = Object.freeze({ createController, applyWriteProtection, normalizePublicState });
  global.TimeIsleMuseumLock = api;
  const start = () => { global.TimeIsleMuseumLockController = createController(); };
  if (global.document?.readyState === "loading") global.document.addEventListener("DOMContentLoaded", start, { once: true });
  else if (global.document) start();
}(typeof window !== "undefined" ? window : globalThis));
