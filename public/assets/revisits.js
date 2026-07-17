(function initializeTimeIsleRevisits(global) {
  "use strict";

  const REQUIRED_IDS = {
    card: "revisitCard",
    modeGroup: "revisitModeGroup",
    status: "revisitStatus",
    content: "revisitContent"
  };
  const KINDS = ["on-this-day", "long-unseen", "random"];
  const KIND_LABELS = {
    "on-this-day": "往年今日",
    "long-unseen": "很久没见",
    random: "随机漫游"
  };
  const staleRequest = Symbol("stale revisit request");

  function createController(options = {}) {
    const documentRef = options.document || global.document;
    const fetchImpl = options.fetch || global.fetch?.bind(global);
    if (!documentRef || !fetchImpl) throw new Error("今日回访缺少浏览器能力。");

    const elements = Object.fromEntries(Object.entries(REQUIRED_IDS).map(([key, id]) => [
      key,
      documentRef.getElementById(id)
    ]));
    const missing = Object.entries(elements).filter(([, element]) => !element).map(([key]) => REQUIRED_IDS[key]);
    if (missing.length) throw new Error(`今日回访缺少 DOM：${missing.join("、")}`);

    let demo = Boolean(options.demo);
    let destroyed = false;
    let session = 0;
    let loadGeneration = 0;
    let loaded = false;
    let activeKind = KINDS[0];
    let current = null;
    let busyLoad = false;
    let busyAction = false;
    const sessionHidden = new Set();
    const requests = new Map();
    const listeners = [];

    configureDom();
    bindEvents();
    renderModes();
    renderInitial();

    function configureDom() {
      elements.status.setAttribute("role", "status");
      elements.status.setAttribute("aria-live", "polite");
      elements.status.setAttribute("aria-atomic", "true");
      elements.content.setAttribute("aria-live", "off");
      elements.content.setAttribute("aria-busy", "false");
    }

    function bindEvents() {
      listen(elements.modeGroup, "click", handleModeClick);
      listen(elements.content, "click", handleContentClick);
    }

    function listen(target, type, handler) {
      target.addEventListener(type, handler);
      listeners.push({ target, type, handler });
    }

    async function load(kind) {
      if (destroyed) return null;
      const explicitKind = normalizeKind(kind);
      if (!explicitKind && loaded && !busyLoad) return current;
      const candidates = explicitKind ? [explicitKind] : KINDS;
      const generation = ++loadGeneration;
      const run = session;
      busyLoad = true;
      loaded = true;
      if (explicitKind) activeKind = explicitKind;
      renderModes();
      renderLoading(explicitKind ? `正在寻找“${KIND_LABELS[explicitKind]}”…` : "正在挑选今天最值得重逢的一件展品…");

      try {
        for (const candidate of candidates) {
          const payload = await requestJson("load", revisitUrl(candidate), {}, run);
          if (!isCurrent(run, generation)) return null;
          const revisit = normalizeRevisit(payload, candidate, sessionHidden);
          if (!revisit) continue;
          activeKind = revisit.kind;
          current = revisit;
          busyLoad = false;
          renderModes();
          renderCurrent();
          setStatus(revisit.reason || `今天从“${revisit.label}”重新遇见它。`);
          return revisit;
        }

        if (!isCurrent(run, generation)) return null;
        current = null;
        busyLoad = false;
        activeKind = explicitKind || activeKind;
        renderModes();
        renderEmpty(explicitKind);
        return null;
      } catch (error) {
        if (isExpectedCancellation(error)) return null;
        if (!isCurrent(run, generation)) return null;
        current = null;
        busyLoad = false;
        renderModes();
        renderError(message(error));
        return null;
      } finally {
        if (isCurrent(run, generation)) {
          busyLoad = false;
          elements.content.setAttribute("aria-busy", "false");
          renderAccess();
        }
      }
    }

    function renderModes() {
      elements.modeGroup.querySelectorAll("[data-revisit-kind]").forEach((button) => {
        const selected = button.dataset.revisitKind === activeKind;
        button.classList.toggle("is-active", selected);
        button.setAttribute("aria-pressed", String(selected));
        button.disabled = busyAction;
      });
    }

    function setStatus(text, isError = false) {
      elements.status.textContent = String(text || "");
      elements.status.classList.toggle("is-error", Boolean(isError));
    }

    function renderInitial() {
      setStatus("进入回顾页后再从本地馆藏挑选，不影响其他页面加载。");
      elements.content.innerHTML = '<div class="revisit-placeholder"><span aria-hidden="true">◇</span><p>今天只带回一件记忆，给它留一点安静的位置。</p></div>';
    }

    function renderLoading(text) {
      current = null;
      elements.content.setAttribute("aria-busy", "true");
      elements.content.innerHTML = `<div class="revisit-placeholder" role="status"><span aria-hidden="true">◇</span><p>${escapeHtml(text)}</p></div>`;
      setStatus(text);
      renderAccess();
    }

    function renderCurrent() {
      if (!current) return;
      const memory = current.memory;
      const thumbnail = safeMediaUrl(
        memory.mediaSummary?.coverThumbnailUrl ||
        memory.media?.find?.((item) => item.role === "cover")?.urls?.display ||
        memory.media?.[0]?.urls?.display ||
        memory.coverImage
      );
      const date = formatMemoryDate(memory.date || memory.createdAt);
      const context = [date, memory.location, ...(memory.people || []).slice(0, 2)].filter(Boolean).join(" · ");
      const excerpt = memory.exhibitText || memory.rawContent || "这件展品正在等你重新打开。";
      elements.content.innerHTML = `
        <article class="revisit-feature">
          ${thumbnail ? `<div class="revisit-image"><img src="${escapeHtml(thumbnail)}" alt="" loading="eager" decoding="async" /></div>` : '<div class="revisit-image is-empty" aria-hidden="true">◇</div>'}
          <div class="revisit-copy">
            <div class="revisit-kicker"><span>${escapeHtml(current.label)}</span>${context ? `<span>${escapeHtml(context)}</span>` : ""}</div>
            <h3 tabindex="-1" data-revisit-title>${escapeHtml(memory.title || "一件没有标题的展品")}</h3>
            <p class="revisit-reason">${escapeHtml(current.reason || "今天适合再看它一眼。")}</p>
            <p class="revisit-excerpt">${escapeHtml(excerpt)}</p>
            <div class="revisit-actions">
              <button type="button" class="button primary" data-revisit-open>打开这件展品</button>
              <button type="button" class="button text-button" data-revisit-dismiss>今天先略过</button>
            </div>
          </div>
        </article>`;
      elements.content.setAttribute("aria-busy", "false");
      renderAccess();
    }

    function renderEmpty(explicitKind) {
      const label = explicitKind ? KIND_LABELS[explicitKind] : "今日回访";
      setStatus(`${label}暂时没有新的展品。`);
      elements.content.innerHTML = `<div class="revisit-empty"><span aria-hidden="true">◇</span><strong>${escapeHtml(label)}已经看完了</strong><p>${demo ? "本次 Demo 会话里略过的记忆不会再出现，也不会写入服务器。" : "可以换一种回访方式，或者以后补充更多记忆再回来。"}</p></div>`;
      elements.content.setAttribute("aria-busy", "false");
      renderAccess();
    }

    function renderError(error) {
      setStatus(`今日回访暂时无法完成：${error}`, true);
      elements.content.innerHTML = `<div class="revisit-empty is-error"><span aria-hidden="true">!</span><strong>暂时无法带回这件记忆</strong><p>${escapeHtml(error)}</p><button type="button" class="button secondary" data-revisit-retry>重新寻找</button></div>`;
      elements.content.setAttribute("aria-busy", "false");
      renderAccess();
    }

    function renderAccess() {
      elements.modeGroup.querySelectorAll("[data-revisit-kind]").forEach((button) => {
        button.disabled = busyAction;
      });
      elements.content.querySelectorAll("button").forEach((button) => {
        button.disabled = busyAction || busyLoad;
      });
    }

    function handleModeClick(event) {
      const button = event.target.closest("[data-revisit-kind]");
      if (!button || busyAction) return;
      const kind = normalizeKind(button.dataset.revisitKind);
      if (!kind) return;
      activeKind = kind;
      renderModes();
      load(kind);
    }

    function handleContentClick(event) {
      if (event.target.closest("[data-revisit-retry]")) {
        load(activeKind).then((result) => {
          if (result) elements.content.querySelector("[data-revisit-title]")?.focus({ preventScroll: true });
        });
        return;
      }
      if (event.target.closest("[data-revisit-open]")) {
        openCurrent();
        return;
      }
      if (event.target.closest("[data-revisit-dismiss]")) dismissCurrent();
    }

    async function openCurrent() {
      if (!current || busyAction) return;
      const revisit = current;
      hideCurrent(revisit, "正在打开展品并更新回访时间…");
      try {
        const result = options.onOpenMemory?.(revisit.memory.id);
        Promise.resolve(result).catch(() => {});
      } catch {
        // The revisit history remains independent from the detail dialog.
      }
      await recordAction(revisit, "viewed");
    }

    async function dismissCurrent() {
      if (!current || busyAction) return;
      const revisit = current;
      hideCurrent(revisit, "已略过当前记忆，正在寻找下一件…");
      await recordAction(revisit, "dismissed", true);
    }

    function hideCurrent(revisit, statusText) {
      busyAction = true;
      sessionHidden.add(revisit.memory.id);
      current = null;
      elements.content.innerHTML = `<div class="revisit-placeholder" role="status"><span aria-hidden="true">◇</span><p>${escapeHtml(statusText)}</p></div>`;
      setStatus(statusText);
      renderModes();
      renderAccess();
    }

    async function recordAction(revisit, action, focusNext = false) {
      const kind = revisit.kind;
      const run = session;
      let writeError = "";
      try {
        if (!demo) {
          await requestJson("mutation", `/api/revisits/${encodeURIComponent(revisit.memory.id)}/${action}`, {
            method: "POST",
            body: JSON.stringify(requestContext(kind))
          }, run);
        }
      } catch (error) {
        if (!isExpectedCancellation(error)) writeError = message(error);
      } finally {
        if (!isCurrentSession(run)) return;
        busyAction = false;
        renderModes();
      }

      const next = await load(kind);
      if (!isCurrentSession(run)) return;
      if (writeError) setStatus(`当前记忆已在本次会话中略过，但回访记录未能写入：${writeError}`, true);
      if (focusNext && next) elements.content.querySelector("[data-revisit-title]")?.focus({ preventScroll: true });
    }

    function revisitUrl(kind) {
      const context = requestContext(kind);
      const query = new URLSearchParams({
        kind,
        localDate: context.localDate,
        timezone: context.timezone,
        limit: String(Math.min(20, sessionHidden.size + 1))
      });
      return `/api/revisits?${query.toString()}`;
    }

    function requestContext(kind) {
      const timezone = resolvedTimezone();
      return { kind, localDate: localCalendarDate(timezone), timezone };
    }

    function invalidate() {
      startSession();
      loadGeneration += 1;
      loaded = false;
      current = null;
      busyLoad = false;
      busyAction = false;
      renderModes();
      renderInitial();
    }

    function setDemo(value) {
      const next = Boolean(value);
      if (next === demo) return;
      demo = next;
      sessionHidden.clear();
      const reload = loaded;
      invalidate();
      if (reload) load();
    }

    function startSession() {
      session += 1;
      requests.forEach((request) => request.controller.abort());
      requests.clear();
    }

    async function requestJson(key, url, requestOptions = {}, run = session) {
      requests.get(key)?.controller.abort();
      const controller = new AbortController();
      const token = Symbol(key);
      requests.set(key, { controller, token });
      try {
        const response = await fetchImpl(url, {
          ...requestOptions,
          signal: controller.signal,
          headers: {
            Accept: "application/json",
            ...(requestOptions.body ? { "Content-Type": "application/json" } : {}),
            ...(requestOptions.headers || {})
          }
        });
        const text = await response.text();
        const payload = text ? parseJson(text) : {};
        if (!response.ok) throw new Error(payload?.error || payload?.message || `请求失败（${response.status}）`);
        if (!isCurrentSession(run) || requests.get(key)?.token !== token) throw staleRequest;
        return payload;
      } finally {
        if (requests.get(key)?.token === token) requests.delete(key);
      }
    }

    function isCurrent(run, generation) {
      return isCurrentSession(run) && generation === loadGeneration;
    }

    function isCurrentSession(run) {
      return !destroyed && run === session;
    }

    function isExpectedCancellation(error) {
      return error === staleRequest || error?.name === "AbortError";
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      startSession();
      listeners.forEach(({ target, type, handler }) => target.removeEventListener(type, handler));
      listeners.length = 0;
    }

    return Object.freeze({ load, invalidate, setDemo, destroy });
  }

  function normalizeRevisit(payload, fallbackKind, excludedIds) {
    const excluded = excludedIds instanceof Set ? excludedIds : new Set(excludedIds || []);
    const candidates = Array.isArray(payload?.revisits) && payload.revisits.length
      ? payload.revisits
      : [payload?.revisit || (payload?.memory ? payload : null)];
    const value = candidates.find((candidate) => (
      candidate?.memory?.id && !excluded.has(String(candidate.memory.id))
    ));
    if (!value?.memory || !value.memory.id) return null;
    const kind = normalizeKind(value.kind) || normalizeKind(fallbackKind) || KINDS[0];
    return {
      kind,
      label: String(value.label || KIND_LABELS[kind]),
      reason: String(value.reason || ""),
      memory: value.memory
    };
  }

  function normalizeKind(value) {
    const kind = String(value || "");
    return KINDS.includes(kind) ? kind : "";
  }

  function resolvedTimezone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
  }

  function localCalendarDate(timezone, date = new Date()) {
    try {
      const parts = new Intl.DateTimeFormat("en", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).formatToParts(date);
      const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
      return `${values.year}-${values.month}-${values.day}`;
    } catch {
      return date.toISOString().slice(0, 10);
    }
  }

  function formatMemoryDate(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    const match = text.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
    if (match?.[3]) return `${match[1]}.${match[2]}.${match[3]}`;
    if (match?.[2]) return `${match[1]}.${match[2]}`;
    return match?.[1] || text;
  }

  function safeMediaUrl(value) {
    const url = String(value || "").trim();
    return /^\/(?!\/)/.test(url) || /^blob:/i.test(url) || /^data:image\/(?:png|jpeg|webp);/i.test(url) ? url : "";
  }

  function parseJson(text) {
    try { return JSON.parse(text); } catch { return { error: text }; }
  }

  function message(error) {
    return String(error?.message || error || "未知错误");
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  global.TimeIsleRevisits = Object.freeze({ createController, normalizeRevisit, localCalendarDate });
})(typeof window !== "undefined" ? window : globalThis);
