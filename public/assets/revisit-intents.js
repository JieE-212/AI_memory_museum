(function initializeTimeIsleRevisitIntents(global) {
  "use strict";

  const REQUIRED_IDS = Object.freeze({
    content: "revisitContent",
    manager: "revisitIntentManager",
    managerStatus: "revisitIntentManagerStatus",
    managerList: "revisitIntentManagerList"
  });
  const LABELS = Object.freeze({
    neutral: "自然回访",
    welcome: "欢迎主动出现",
    later: "指定日期以后",
    pause: "暂停主动出现"
  });
  const staleRequest = Symbol("stale revisit intent request");

  function createController(options = {}) {
    const documentRef = options.document || global.document;
    const fetchImpl = options.fetch || global.fetch?.bind(global);
    if (!documentRef || !fetchImpl) throw new Error("回访意愿缺少浏览器能力。");
    const elements = Object.fromEntries(Object.entries(REQUIRED_IDS).map(([key, id]) => [key, documentRef.getElementById(id)]));
    const missing = Object.entries(elements).filter(([, element]) => !element).map(([key]) => REQUIRED_IDS[key]);
    if (missing.length) throw new Error(`回访意愿缺少 DOM：${missing.join("、")}`);

    let demo = Boolean(options.demo);
    let destroyed = false;
    let busy = false;
    let managerLoaded = false;
    let session = 0;
    const requests = new Map();
    const listeners = [];

    listen(elements.content, "click", handleContentClick);
    listen(elements.content, "submit", handleSubmit);
    listen(elements.content, "change", handleChange);
    listen(elements.manager, "toggle", handleManagerToggle);
    listen(elements.managerList, "click", handleManagerClick);
    resetManager();

    function listen(target, type, handler) {
      target.addEventListener(type, handler);
      listeners.push({ target, type, handler });
    }

    function renderPanel(memory, value) {
      const memoryId = safeId(memory?.id);
      if (!memoryId) return "";
      const intent = normalizeIntent(value, memoryId);
      const timezone = intent.timezone || resolvedTimezone();
      const localDate = localCalendarDate(timezone);
      const minimumDate = intent.choice === "later" && intent.notBeforeLocalDate < localDate
        ? intent.notBeforeLocalDate
        : localDate;
      return `
        <details class="revisit-intent-panel" data-revisit-intent-panel data-memory-id="${escapeHtml(memoryId)}">
          <summary><span><strong>以后怎样再见</strong><small>${escapeHtml(LABELS[intent.choice])}</small></span><span aria-hidden="true">＋</span></summary>
          <form class="revisit-intent-form" data-revisit-intent-form data-memory-id="${escapeHtml(memoryId)}">
            <fieldset>
              <legend>只按你的明确选择调整主动回访</legend>
              ${choice("neutral", "自然回访", "不设长期偏好，沿用当前三种方式。", intent.choice)}
              ${choice("welcome", "欢迎主动出现", "仍遵守所选回访方式，只在符合条件时优先。", intent.choice)}
              ${choice("later", "指定日期以后", "到达日期前不主动带回，馆藏和搜索不受影响。", intent.choice)}
              ${choice("pause", "暂停主动出现", "暂停所有主动回访，直到你亲自恢复。", intent.choice)}
            </fieldset>
            <div class="revisit-intent-later" data-revisit-intent-later ${intent.choice === "later" ? "" : "hidden"}>
              <label>不早于这个日期
                <input type="date" name="notBeforeLocalDate" min="${escapeHtml(minimumDate)}" value="${escapeHtml(intent.notBeforeLocalDate)}" ${intent.choice === "later" ? "" : "disabled"} />
              </label>
              <label>日期所在时区
                <input type="text" name="timezone" value="${escapeHtml(timezone)}" readonly />
              </label>
            </div>
            <p class="revisit-intent-boundary">不保存选择原因，也不会据此推断心情、关系或重要程度。</p>
            <p class="revisit-intent-status" data-revisit-intent-status role="status" aria-live="polite">${demo ? "公开 Demo 只展示设置方式，不会保存长期意愿。" : "设置只影响主动回访，不隐藏或删除展品。"}</p>
            <button type="submit" class="button secondary" ${demo ? "data-intent-demo-disabled disabled" : ""}>保存回访意愿</button>
          </form>
        </details>`;
    }

    function choice(value, label, help, selected) {
      return `<label class="revisit-intent-choice"><input type="radio" name="choice" value="${value}" ${selected === value ? "checked" : ""} /><span><strong>${label}</strong><small>${help}</small></span></label>`;
    }

    function handleContentClick(event) {
      const summary = event.target.closest("[data-revisit-intent-panel] > summary");
      if (!summary) return;
      const panel = summary.parentElement;
      global.setTimeout?.(() => {
        if (panel?.open) loadCurrent(panel);
      }, 0);
    }

    function handleChange(event) {
      const form = event.target.closest("[data-revisit-intent-form]");
      if (!form || event.target.name !== "choice") return;
      const selected = normalizeChoice(event.target.value);
      const later = form.querySelector("[data-revisit-intent-later]");
      later.hidden = selected !== "later";
      form.elements.namedItem("notBeforeLocalDate").disabled = selected !== "later";
      setFormStatus(form, selected === "later"
        ? "请选择明确日期；时区只用于解释这次日期设置。"
        : "设置只影响主动回访，不隐藏或删除展品。");
    }

    async function loadCurrent(panel) {
      const memoryId = safeId(panel?.dataset.memoryId);
      const form = panel?.querySelector("[data-revisit-intent-form]");
      if (!memoryId || !form || busy || demo) return;
      busy = true;
      setFormStatus(form, "正在读取这件展品的回访意愿…");
      renderAccess();
      try {
        const payload = await requestJson(`get-${memoryId}`, `/api/revisits/${encodeURIComponent(memoryId)}/intent`);
        const intent = normalizeIntent(payload?.intent, memoryId);
        applyToForm(form, intent);
        panel.querySelector("summary small").textContent = LABELS[intent.choice];
        setFormStatus(form, "设置只影响主动回访，不隐藏或删除展品。");
      } catch (error) {
        if (!expected(error)) setFormStatus(form, `读取失败：${message(error)}`);
      } finally {
        busy = false;
        renderAccess();
      }
    }

    async function handleSubmit(event) {
      const form = event.target.closest("[data-revisit-intent-form]");
      if (!form) return;
      event.preventDefault();
      if (demo || busy) return;
      const memoryId = safeId(form.dataset.memoryId);
      const selected = normalizeChoice(new FormData(form).get("choice"));
      const date = form.elements.namedItem("notBeforeLocalDate");
      const timezone = form.elements.namedItem("timezone");
      const notBeforeLocalDate = selected === "later" ? String(date?.value || "") : "";
      const timezoneValue = selected === "later" ? String(timezone?.value || "") : "";
      if (!memoryId || !selected) return setFormStatus(form, "请选择一种有效的回访意愿。");
      if (selected === "later" && !/^\d{4}-\d{2}-\d{2}$/u.test(notBeforeLocalDate)) {
        setFormStatus(form, "“指定日期以后”需要选择一个明确日期。");
        date?.focus();
        return;
      }
      busy = true;
      setFormStatus(form, "正在保存明确的回访意愿…");
      renderAccess();
      try {
        const payload = await save(memoryId, selected, notBeforeLocalDate, timezoneValue);
        const intent = normalizeIntent(payload?.intent, memoryId);
        applyToForm(form, intent);
        form.closest("[data-revisit-intent-panel]").querySelector("summary small").textContent = LABELS[intent.choice];
        setFormStatus(form, payload?.action === "cleared" ? "已恢复自然回访。" : "回访意愿已保存。");
        managerLoaded = false;
        if (elements.manager.open) global.setTimeout?.(() => loadManager(true), 0);
      } catch (error) {
        if (!expected(error)) setFormStatus(form, `保存失败：${message(error)}`);
      } finally {
        busy = false;
        renderAccess();
      }
    }

    function applyToForm(form, intent) {
      const input = form.querySelector(`input[name="choice"][value="${intent.choice}"]`);
      if (input) input.checked = true;
      const timezone = intent.timezone || resolvedTimezone();
      const date = form.elements.namedItem("notBeforeLocalDate");
      const localDate = localCalendarDate(timezone);
      date.value = intent.notBeforeLocalDate;
      date.min = intent.choice === "later" && intent.notBeforeLocalDate < localDate
        ? intent.notBeforeLocalDate
        : localDate;
      date.disabled = intent.choice !== "later";
      form.elements.namedItem("timezone").value = timezone;
      form.querySelector("[data-revisit-intent-later]").hidden = intent.choice !== "later";
    }

    function setFormStatus(form, text) {
      const status = form?.querySelector("[data-revisit-intent-status]");
      if (status) status.textContent = text;
    }

    function save(memoryId, selected, date, timezone) {
      return requestJson(`save-${memoryId}`, `/api/revisits/${encodeURIComponent(memoryId)}/intent`, {
        method: "PUT",
        body: JSON.stringify({
          choice: selected,
          notBeforeLocalDate: date || "",
          timezone: timezone || "",
          confirm: true
        })
      });
    }

    function handleManagerToggle() {
      if (elements.manager.open && !managerLoaded && !busy) loadManager();
    }

    async function loadManager(force = false) {
      if (demo) {
        managerLoaded = true;
        elements.managerStatus.textContent = "公开 Demo 不保存长期回访意愿。";
        elements.managerList.innerHTML = '<div class="revisit-intent-manager-empty">本地持久模式可在这里恢复暂停或延期的展品。</div>';
        return;
      }
      if ((managerLoaded && !force) || busy) return;
      elements.managerStatus.textContent = "正在读取已设置的回访意愿…";
      try {
        const payload = await requestJson("manager", "/api/revisits/intents");
        const intents = (Array.isArray(payload?.intents) ? payload.intents : []).map((item) => normalizeIntent(item, item?.memoryId)).filter((item) => item.choice !== "neutral");
        managerLoaded = true;
        elements.managerStatus.textContent = intents.length ? `共有 ${intents.length} 件展品设置了长期回访意愿。` : "尚未设置长期回访意愿。";
        elements.managerList.innerHTML = intents.length ? intents.map(renderManaged).join("")
          : '<div class="revisit-intent-manager-empty">自然回访中的展品不需要额外管理。</div>';
      } catch (error) {
        if (expected(error)) return;
        managerLoaded = false;
        elements.managerStatus.textContent = `读取失败：${message(error)}`;
        elements.managerList.innerHTML = '<button type="button" class="button secondary" data-intent-manager-retry>重新读取</button>';
      }
    }

    function renderManaged(intent) {
      const detail = intent.choice === "later" ? `${intent.notBeforeLocalDate} · ${intent.timezone}` : LABELS[intent.choice];
      return `<article class="revisit-managed-intent"><div><strong>${escapeHtml(intent.memory?.title || "未命名展品")}</strong><small>${escapeHtml(detail)}</small></div><button type="button" class="button text-button compact" data-intent-clear="${escapeHtml(intent.memoryId)}">恢复自然回访</button></article>`;
    }

    async function handleManagerClick(event) {
      if (event.target.closest("[data-intent-manager-retry]")) return loadManager(true);
      const memoryId = safeId(event.target.closest("[data-intent-clear]")?.dataset.intentClear);
      if (!memoryId || demo || busy) return;
      busy = true;
      elements.managerStatus.textContent = "正在恢复自然回访…";
      renderAccess();
      try {
        await save(memoryId, "neutral", "", "");
        syncCurrentForm(memoryId, normalizeIntent({ memoryId, choice: "neutral" }, memoryId), "已从管理区恢复自然回访。");
        managerLoaded = false;
        busy = false;
        await loadManager(true);
      } catch (error) {
        if (!expected(error)) elements.managerStatus.textContent = `恢复失败：${message(error)}`;
      } finally {
        busy = false;
        renderAccess();
      }
    }

    function syncCurrentForm(memoryId, intent, statusText) {
      const form = [...elements.content.querySelectorAll("[data-revisit-intent-form]")]
        .find((candidate) => candidate.dataset.memoryId === memoryId);
      if (!form) return;
      applyToForm(form, intent);
      const panel = form.closest("[data-revisit-intent-panel]");
      const summary = panel?.querySelector("summary small");
      if (summary) summary.textContent = LABELS[intent.choice];
      setFormStatus(form, statusText);
    }

    function renderAccess() {
      elements.content.querySelectorAll("[data-revisit-intent-form] button").forEach((button) => {
        button.disabled = demo || busy;
      });
      elements.managerList.querySelectorAll("button").forEach((button) => { button.disabled = busy; });
    }

    async function requestJson(key, url, requestOptions = {}) {
      requests.get(key)?.controller.abort();
      const controller = new AbortController();
      const token = Symbol(key);
      requests.set(key, { controller, token });
      try {
        const response = await fetchImpl(url, {
          ...requestOptions,
          signal: controller.signal,
          headers: { Accept: "application/json", ...(requestOptions.body ? { "Content-Type": "application/json" } : {}) }
        });
        const text = await response.text();
        const payload = text ? parseJson(text) : {};
        if (!response.ok) throw new Error(payload?.error || payload?.message || `请求失败（${response.status}）`);
        if (destroyed || session !== currentSession || requests.get(key)?.token !== token) throw staleRequest;
        return payload;
      } finally {
        if (requests.get(key)?.token === token) requests.delete(key);
      }
    }

    let currentSession = session;

    function setDemo(value) {
      demo = Boolean(value);
      invalidate();
    }

    function resetManager() {
      managerLoaded = false;
      elements.managerStatus.textContent = "展开后读取已设置的长期回访意愿。";
      elements.managerList.innerHTML = "";
    }

    function invalidate() {
      session += 1;
      currentSession = session;
      requests.forEach((request) => request.controller.abort());
      requests.clear();
      busy = false;
      resetManager();
      renderAccess();
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      invalidate();
      listeners.forEach(({ target, type, handler }) => target.removeEventListener(type, handler));
      listeners.length = 0;
    }

    return Object.freeze({ destroy, invalidate, renderPanel, setDemo });
  }

  function normalizeIntent(value, fallbackMemoryId) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const memoryId = safeId(source.memoryId || fallbackMemoryId);
    let selected = normalizeChoice(source.choice || source.intent) || "neutral";
    const date = selected === "later" && /^\d{4}-\d{2}-\d{2}$/u.test(String(source.notBeforeLocalDate || "")) ? String(source.notBeforeLocalDate) : "";
    const timezone = selected === "later" ? String(source.timezone || source.notBeforeTimezone || "").slice(0, 100) : "";
    if (selected === "later" && (!date || !timezone)) selected = "neutral";
    const memory = source.memory && typeof source.memory === "object" ? { id: safeId(source.memory.id || memoryId), title: String(source.memory.title || "").slice(0, 200) } : null;
    return { memoryId, choice: selected, notBeforeLocalDate: selected === "later" ? date : "", timezone: selected === "later" ? timezone : "", updatedAt: String(source.updatedAt || "").slice(0, 40), memory };
  }

  function normalizeChoice(value) {
    const selected = String(value || "");
    return Object.prototype.hasOwnProperty.call(LABELS, selected) ? selected : "";
  }

  function safeId(value) {
    const id = String(value || "").trim();
    return /^[a-zA-Z0-9_-]{1,120}$/u.test(id) ? id : "";
  }

  function resolvedTimezone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
  }

  function localCalendarDate(timezone, date = new Date()) {
    try {
      const parts = new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
      const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
      return `${values.year}-${values.month}-${values.day}`;
    } catch { return date.toISOString().slice(0, 10); }
  }

  function parseJson(text) {
    try { return JSON.parse(text); } catch { return { error: text }; }
  }

  function expected(error) {
    return error === staleRequest || error?.name === "AbortError";
  }

  function message(error) {
    return String(error?.message || error || "未知错误");
  }

  function escapeHtml(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }

  global.TimeIsleRevisitIntents = Object.freeze({ createController, normalizeIntent });
})(typeof window !== "undefined" ? window : globalThis);
