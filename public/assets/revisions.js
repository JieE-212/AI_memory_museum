(function attachTimeIsleRevisions(global) {
  "use strict";

  const KIND_LABELS = Object.freeze({
    baseline: "纳入年轮",
    created: "初次入馆",
    edited: "编辑展品",
    restored: "恢复旧版",
    imported: "从备份入馆"
  });

  function createController(options = {}) {
    let demo = Boolean(options.demo);
    const onOpenMemory = typeof options.onOpenMemory === "function" ? options.onOpenMemory : () => {};
    const onRestored = typeof options.onRestored === "function" ? options.onRestored : async () => {};
    const timeline = document.querySelector("#revisionTimelineDetails");
    const timelineStatus = document.querySelector("#revisionTimelineStatus");
    const timelineList = document.querySelector("#revisionTimelineList");
    let timelineLoaded = false;
    let timelineRequest = 0;
    let mounted = null;

    timeline?.addEventListener("toggle", () => {
      if (timeline.open && !timelineLoaded) void loadTimeline();
    });
    timelineList?.addEventListener("click", (event) => {
      const trigger = event.target.closest("[data-revision-memory]");
      if (trigger) onOpenMemory(trigger.dataset.revisionMemory);
    });

    async function loadTimeline(force = false) {
      if (!timelineStatus || !timelineList || (timelineLoaded && !force)) return;
      const request = ++timelineRequest;
      setText(timelineStatus, "正在读取可校验的版本记录…");
      try {
        const { payload } = await requestJson("/api/revisions?limit=30");
        if (request !== timelineRequest) return;
        const revisions = Array.isArray(payload.revisions) ? payload.revisions : [];
        timelineLoaded = true;
        setText(timelineStatus, revisions.length ? `本机已记录 ${revisions.length} 次版本变化。` : "展品发生首次编辑后，这里会出现可回看的版本记录。");
        timelineList.innerHTML = revisions.length ? revisions.map(renderTimelineItem).join("") : '<p class="revision-empty">还没有年轮记录。</p>';
      } catch (error) {
        if (request !== timelineRequest) return;
        setText(timelineStatus, error.message, true);
        timelineList.innerHTML = '<button type="button" class="button text-button compact" data-revision-retry>重新读取</button>';
        timelineList.querySelector("[data-revision-retry]")?.addEventListener("click", () => loadTimeline(true));
      }
    }

    function open(memory, container) {
      if (!memory?.id || !container) return;
      const panel = document.createElement("details");
      panel.className = "memory-revision-panel";
      panel.innerHTML = `
        <summary><span><strong>记忆年轮</strong><small>查看修改记录，旧版不会覆盖消失</small></span><span aria-hidden="true">＋</span></summary>
        <div class="memory-revision-body">
          <p class="revision-panel-status" role="status">展开后读取本机版本记录。</p>
          <div class="memory-revision-list"></div>
          <div class="memory-revision-preview" aria-live="polite" aria-atomic="true" hidden></div>
        </div>`;
      container.append(panel);
      mounted = { memory, panel, etag: "", revisions: [], busy: false, returnFocus: null };
      panel.addEventListener("toggle", () => { if (panel.open && !mounted.busy && !mounted.revisions.length) void loadMemoryHistory(mounted); });
      panel.addEventListener("click", (event) => void handlePanelClick(event, mounted));
    }

    async function loadMemoryHistory(session) {
      if (!session || session !== mounted) return;
      setSessionBusy(session, true);
      const status = session.panel.querySelector(".revision-panel-status");
      setText(status, "正在核对版本链…");
      try {
        const { payload, response } = await requestJson(`/api/memories/${encodeURIComponent(session.memory.id)}/revisions`);
        if (session !== mounted) return;
        session.etag = response.headers.get("etag") || "";
        session.revisions = Array.isArray(payload.revisions) ? payload.revisions : [];
        setText(status, session.revisions.length ? `共 ${session.revisions.length} 个连续版本；恢复旧版也会留下新记录。` : "这件展品尚未产生历史版本。首次编辑后会自动建立基线。 ");
        session.panel.querySelector(".memory-revision-list").innerHTML = session.revisions.length
          ? session.revisions.map((revision, index) => renderMemoryRevision(revision, index === 0, demo)).join("")
          : '<p class="revision-empty">暂无历史版本。</p>';
      } catch (error) {
        setText(status, error.message, true);
        session.panel.querySelector(".memory-revision-list").innerHTML = '<button type="button" class="button text-button compact" data-revision-list-retry>重新读取</button>';
      } finally {
        if (session === mounted) setSessionBusy(session, false);
      }
    }

    async function handlePanelClick(event, session) {
      if (!session || session !== mounted || session.busy) return;
      const view = event.target.closest("[data-revision-view]");
      if (view) {
        session.returnFocus = view;
        return showRevision(session, view.dataset.revisionView);
      }
      const prepare = event.target.closest("[data-revision-prepare]");
      if (prepare) {
        session.returnFocus = prepare;
        return showRestoreConfirmation(session, prepare.dataset.revisionPrepare);
      }
      const cancel = event.target.closest("[data-revision-cancel]");
      if (cancel) return clearPreview(session);
      const confirm = event.target.closest("[data-revision-confirm]");
      if (confirm) return restoreRevision(session, confirm.dataset.revisionConfirm);
      const retry = event.target.closest("[data-revision-list-retry]");
      if (retry) return loadMemoryHistory(session);
    }

    async function showRevision(session, revisionId) {
      const preview = session.panel.querySelector(".memory-revision-preview");
      setSessionBusy(session, true);
      preview.hidden = false;
      preview.innerHTML = '<p class="revision-empty">正在读取这一版…</p>';
      try {
        const { payload } = await requestJson(`/api/memories/${encodeURIComponent(session.memory.id)}/revisions/${encodeURIComponent(revisionId)}`);
        if (session !== mounted) return;
        preview.innerHTML = renderSnapshot(payload.revision);
      } catch (error) {
        preview.innerHTML = `<p class="revision-error">${escapeHtml(error.message)}</p><button type="button" class="button text-button compact revision-error-action" data-revision-view="${escapeHtml(revisionId)}">重新读取这一版</button>`;
      } finally {
        if (session === mounted) setSessionBusy(session, false);
      }
    }

    function showRestoreConfirmation(session, revisionId) {
      const revision = session.revisions.find((item) => item.id === revisionId);
      if (!revision) return;
      const preview = session.panel.querySelector(".memory-revision-preview");
      preview.hidden = false;
      preview.innerHTML = `
        <div class="revision-confirmation" role="alert">
          <strong>恢复第 ${revision.revisionNo} 版？</strong>
          <p>当前版本不会被删除；系统会把所选内容复制成新的最新版本。</p>
          <div><button type="button" class="button primary compact" data-revision-confirm="${escapeHtml(revision.id)}">确认恢复</button><button type="button" class="button text-button compact" data-revision-cancel>取消</button></div>
        </div>`;
    }

    async function restoreRevision(session, revisionId) {
      if (demo) return;
      setSessionBusy(session, true);
      const preview = session.panel.querySelector(".memory-revision-preview");
      preview.innerHTML = '<p class="revision-empty">正在恢复，并保留当前版本…</p>';
      try {
        const { payload, response } = await requestJson(`/api/memories/${encodeURIComponent(session.memory.id)}/revisions/${encodeURIComponent(revisionId)}/restore`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(session.etag ? { "If-Match": session.etag } : {}) },
          body: JSON.stringify({ expectedUpdatedAt: session.memory.updatedAt || "" })
        });
        session.etag = response.headers.get("etag") || session.etag;
        timelineLoaded = false;
        await onRestored(payload.memory);
        if (session !== mounted) return;
        preview.innerHTML = '<p class="revision-success">旧版已复制为新的最新版本；原有年轮仍完整保留。</p>';
        session.memory = payload.memory;
        session.revisions = [];
        await loadMemoryHistory(session);
      } catch (error) {
        preview.innerHTML = `<p class="revision-error">${escapeHtml(error.status === 412 ? "这件展品已有更新，未执行恢复。请关闭详情后重新打开。" : error.message)}</p>`;
      } finally {
        if (session === mounted) setSessionBusy(session, false);
      }
    }

    function clearPreview(session) {
      const preview = session.panel.querySelector(".memory-revision-preview");
      preview.hidden = true;
      preview.replaceChildren();
      const returnFocus = session.returnFocus;
      session.returnFocus = null;
      if (returnFocus?.isConnected) queueMicrotask(() => returnFocus.focus());
    }

    function setSessionBusy(session, value) {
      session.busy = Boolean(value);
      const body = session.panel.querySelector(".memory-revision-body");
      body?.setAttribute("aria-busy", String(session.busy));
      session.panel.querySelectorAll("button").forEach((button) => {
        if (session.busy && !button.disabled) {
          button.disabled = true;
          button.dataset.revisionBusyDisabled = "true";
        } else if (!session.busy && button.dataset.revisionBusyDisabled === "true") {
          button.disabled = false;
          delete button.dataset.revisionBusyDisabled;
        }
      });
    }

    function setDemo(value) { demo = Boolean(value); }

    return Object.freeze({ loadTimeline, open, setDemo });
  }

  function renderTimelineItem(revision) {
    return `<button type="button" class="revision-timeline-item" data-revision-memory="${escapeHtml(revision.memoryId)}"><span><strong>${escapeHtml(revision.memoryTitle || "未命名记忆")}</strong><small>${escapeHtml(KIND_LABELS[revision.changeKind] || "版本变化")} · 第 ${Number(revision.revisionNo) || 1} 版</small></span><time>${escapeHtml(formatDate(revision.createdAt))}</time></button>`;
  }

  function renderMemoryRevision(revision, isHead, demo) {
    const disabled = isHead || demo ? " disabled" : "";
    const note = revision.changeNote || (revision.restoredFromRevisionId ? "由较早版本恢复生成" : "");
    return `<article class="memory-revision-item${isHead ? " is-head" : ""}"><div><strong>第 ${Number(revision.revisionNo) || 1} 版${isHead ? " · 当前" : ""}</strong><small>${escapeHtml(KIND_LABELS[revision.changeKind] || "版本变化")} · ${escapeHtml(formatDateTime(revision.createdAt))}</small>${note ? `<p>${escapeHtml(note)}</p>` : ""}</div><div class="memory-revision-actions"><button type="button" class="button text-button compact" data-revision-view="${escapeHtml(revision.id)}">查看</button><button type="button" class="button secondary compact" data-revision-prepare="${escapeHtml(revision.id)}"${disabled}>恢复</button></div></article>`;
  }

  function renderSnapshot(revision) {
    const snapshot = revision?.snapshot || {};
    return `<article class="revision-snapshot"><header><div><small>第 ${Number(revision?.revisionNo) || 1} 版</small><strong>${escapeHtml(snapshot.title || "未命名记忆")}</strong></div><button type="button" class="button text-button compact" data-revision-cancel>关闭</button></header><p>${escapeHtml(snapshot.exhibitText || "暂无展签")}</p><dl><div><dt>日期</dt><dd>${escapeHtml(snapshot.date || "未注明")}</dd></div><div><dt>地点</dt><dd>${escapeHtml(snapshot.location || "未注明")}</dd></div><div><dt>人物</dt><dd>${escapeHtml((snapshot.people || []).join("、") || "未注明")}</dd></div></dl><details><summary>查看这一版原文</summary><p class="revision-raw">${escapeHtml(snapshot.rawContent || "暂无原文")}</p></details></article>`;
  }

  async function requestJson(url, options = {}) {
    const response = await fetch(url, { cache: "no-store", ...options });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `请求失败（${response.status}）`);
      error.status = response.status;
      error.code = payload.code || "";
      throw error;
    }
    return { payload, response };
  }

  function setText(element, text, error = false) {
    if (!element) return;
    element.textContent = text;
    element.classList.toggle("is-error", error);
  }

  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
  }

  function formatDateTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "时间未记录" : date.toLocaleString("zh-CN", { hour12: false });
  }

  function escapeHtml(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  }

  global.TimeIsleRevisions = Object.freeze({ createController });
})(window);
