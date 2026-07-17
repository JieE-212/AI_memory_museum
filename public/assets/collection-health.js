(function attachTimeIsleCollectionHealth(global) {
  "use strict";

  const PHASE_LABELS = Object.freeze({ queued: "准备清单", database: "核对数据库", inventory: "读取媒体清单", media: "核对图片", voice: "核对声音", cancelling: "正在停止", cancelled: "已停止", done: "已完成", failed: "未完成" });

  function createController(options = {}) {
    let demo = Boolean(options.demo);
    const elements = {
      details: document.querySelector("#collectionHealthDetails"),
      state: document.querySelector("#collectionHealthState"),
      description: document.querySelector("#collectionHealthDescription"),
      start: document.querySelector("#collectionHealthStart"),
      stop: document.querySelector("#collectionHealthStop"),
      progress: document.querySelector("#collectionHealthProgress"),
      phase: document.querySelector("#collectionHealthPhase"),
      result: document.querySelector("#collectionHealthResult"),
      inspectInput: document.querySelector("#archiveInspectFile"),
      inspectLabel: document.querySelector("[for='archiveInspectFile']"),
      inspectStatus: document.querySelector("#archiveInspectStatus")
    };
    let scanId = "";
    let timer = null;
    let destroyed = false;

    elements.start?.addEventListener("click", start);
    elements.stop?.addEventListener("click", stop);
    elements.inspectInput?.addEventListener("change", inspectArchive);
    applyDemoBoundary();

    async function start() {
      if (demo || destroyed || scanId) return;
      setBusy(true);
      setState("体检进行中");
      setText(elements.description, "只读核对数据库、图片和声音，不会自动删除或改写任何内容。");
      elements.result.replaceChildren();
      try {
        const payload = await requestJson("/api/collection-health/scans", { method: "POST", body: JSON.stringify({ scope: "full" }) });
        scanId = payload.scan.id;
        renderProgress(payload.scan);
        schedulePoll(120);
      } catch (error) {
        setBusy(false);
        setState("未能开始", true);
        setText(elements.description, error.message, true);
      }
    }

    async function poll() {
      if (!scanId || destroyed) return;
      try {
        const payload = await requestJson(`/api/collection-health/scans/${encodeURIComponent(scanId)}`);
        renderProgress(payload.scan);
        if (["completed", "cancelled", "failed"].includes(payload.scan.state)) {
          const finished = payload.scan;
          scanId = "";
          setBusy(false);
          renderResult(finished);
          return;
        }
        schedulePoll(280);
      } catch (error) {
        scanId = "";
        setBusy(false);
        setState("体检中断", true);
        setText(elements.description, error.message, true);
      }
    }

    async function stop() {
      if (!scanId || destroyed) return;
      elements.stop.disabled = true;
      try {
        const payload = await requestJson(`/api/collection-health/scans/${encodeURIComponent(scanId)}`, { method: "DELETE" });
        renderProgress(payload.scan);
        schedulePoll(100);
      } catch (error) {
        setText(elements.description, error.message, true);
        elements.stop.disabled = false;
      }
    }

    function renderProgress(scan) {
      const progress = scan.progress || {};
      const total = Math.max(1, Number(progress.total) || 1);
      const checked = Math.min(total, Number(progress.checked) || 0);
      const phase = PHASE_LABELS[progress.phase] || "正在核对";
      elements.progress.hidden = false;
      elements.progress.max = total;
      elements.progress.value = checked;
      elements.progress.setAttribute("aria-valuetext", `${phase}，${checked} / ${total}`);
      setText(elements.phase, phase);
    }

    function renderResult(scan) {
      elements.progress.hidden = true;
      if (scan.state === "cancelled") {
        setState("已停止");
        setText(elements.description, "本次只读体检已停止，没有修改馆藏。");
        return;
      }
      if (scan.state !== "completed" || !scan.summary) {
        setState("未完成", true);
        setText(elements.description, "本次体检未能走完，请稍后重试。", true);
        return;
      }
      const summary = scan.summary;
      const issueCount = Number(summary.issuesTotal) || 0;
      setState(issueCount ? `${issueCount} 项待核对` : "结构核对通过", issueCount > 0);
      setText(elements.description, issueCount ? "发现的项目只做提示，不会自动修复。" : "本次运行中未发现数据库、图片或声音的结构性异常。");
      elements.result.innerHTML = `
        <div class="collection-health-grid">
          ${renderMetric("数据库", summary.database?.failed ? `${summary.database.failed} 项异常` : `${summary.database?.checks || 0} 项通过`, summary.database?.failed)}
          ${renderMetric("图片", `${summary.media?.ready || 0} 项就绪`, summary.media?.status !== "pass")}
          ${renderMetric("声音", `${summary.voices?.ready || 0} 项就绪`, summary.voices?.status !== "pass")}
          ${renderMetric("待核对内容", `${summary.curation?.needsReview || 0} 项`, summary.curation?.needsReview)}
        </div>
        ${scan.issues?.length ? `<details class="collection-health-issues"><summary>查看待核对项${summary.issuesTruncated ? "（仅显示前 200 项）" : ""}</summary><ul>${scan.issues.map((issue) => `<li><span>${escapeHtml(areaLabel(issue.area))}</span><p>${escapeHtml(issue.message)}</p>${issue.recordId ? `<code>${escapeHtml(issue.recordId)}</code>` : ""}</li>`).join("")}</ul></details>` : ""}`;
    }

    async function inspectArchive(event) {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file || demo || destroyed) return;
      setText(elements.inspectStatus, "正在只读验真；不会恢复到当前馆藏。");
      elements.inspectInput.disabled = true;
      elements.inspectLabel?.classList.add("is-disabled");
      try {
        const response = await fetch("/api/archive/inspect", { method: "POST", headers: { "Content-Type": "application/vnd.time-isle" }, body: file });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || `验真失败（${response.status}）`);
        const info = payload.inspection || {};
        setText(elements.inspectStatus, `可恢复 · schema ${info.schemaVersion || "?"} · ${info.entries || 0} 个条目 · ${formatBytes(info.expandedBytes)}`);
      } catch (error) {
        setText(elements.inspectStatus, `未通过验真：${error.message}`, true);
      } finally {
        elements.inspectInput.disabled = demo;
        elements.inspectLabel?.classList.toggle("is-disabled", demo);
      }
    }

    function setBusy(value) {
      elements.start.disabled = value || demo;
      elements.stop.hidden = !value;
      elements.stop.disabled = !value;
      elements.details?.setAttribute("aria-busy", String(Boolean(value)));
    }

    function schedulePoll(delay) {
      clearTimeout(timer);
      timer = setTimeout(poll, delay);
    }

    function setState(text, error = false) {
      setText(elements.state, text, error);
    }

    function applyDemoBoundary() {
      elements.start.disabled = demo;
      elements.inspectInput.disabled = demo;
      elements.inspectLabel?.classList.toggle("is-disabled", demo);
      if (demo) {
        setState("本地功能");
        setText(elements.description, "共享临时示例不提供本机馆藏体检，也不接收私人备份。");
      }
    }

    function setDemo(value) { demo = Boolean(value); applyDemoBoundary(); }
    function destroy() { destroyed = true; clearTimeout(timer); }
    return Object.freeze({ destroy, setDemo });
  }

  function renderMetric(label, value, attention) {
    return `<div class="collection-health-metric${attention ? " has-attention" : ""}"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></div>`;
  }

  function areaLabel(area) {
    return ({ database: "数据库", media: "图片", voice: "声音", curation: "内容", system: "体检" })[area] || "馆藏";
  }

  async function requestJson(url, options = {}) {
    const response = await fetch(url, { cache: "no-store", ...options, headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `请求失败（${response.status}）`);
    return payload;
  }

  function setText(element, value, error = false) {
    if (!element) return;
    element.textContent = value;
    element.classList.toggle("is-error", Boolean(error));
  }

  function formatBytes(value) {
    const bytes = Number(value) || 0;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  }

  global.TimeIsleCollectionHealth = Object.freeze({ createController });
})(window);
