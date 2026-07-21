(function initializeTimeIsleTimeCalibrations(global) {
  "use strict";

  const DOM_IDS = Object.freeze({
    details: "timeCalibrationDetails",
    summary: "timeCalibrationSummary",
    badge: "timeCalibrationBadge",
    body: "timeCalibrationBody",
    intro: "timeCalibrationIntro",
    sources: "timeCalibrationSources",
    form: "timeCalibrationForm",
    choices: "timeCalibrationChoices",
    interval: "timeCalibrationInterval",
    intervalStart: "timeCalibrationIntervalStart",
    intervalEnd: "timeCalibrationIntervalEnd",
    note: "timeCalibrationNote",
    status: "timeCalibrationStatus",
    saveButton: "timeCalibrationSaveButton",
    deleteButton: "timeCalibrationDeleteButton",
    refreshButton: "timeCalibrationRefreshButton"
  });
  const RESOLUTION_LABELS = Object.freeze({
    day: "确认一个日期",
    range: "确认一个时间范围",
    alternatives: "保留多种时间记录",
    uncertain: "仍不确定"
  });
  const SOURCE_KIND_LABELS = Object.freeze({
    original: "原文来源",
    revision: "记忆修订",
    photo: "照片时间线索",
    oralHistory: "人工确认的口述来源"
  });
  const RESOLUTION_NAME = "timeCalibrationResolutionKind";
  const SOURCE_NAME = "timeCalibrationSourceKey";
  const BOUNDARY_COPY = "这里只保存你对时间线索的判断，不会改写两段原文、展品日期，也不会自动确认它们属于同一往事。";
  const STALE_REQUEST = Symbol("stale time calibration request");

  function createController(options = {}) {
    const documentRef = options.document || global.document;
    const fetchImpl = options.fetch || global.fetch?.bind(global);
    const onBusyChange = typeof options.onBusyChange === "function" ? options.onBusyChange : () => {};
    const onChanged = typeof options.onChanged === "function" ? options.onChanged : () => {};
    const confirmImpl = typeof options.confirm === "function"
      ? options.confirm
      : typeof global.confirm === "function" ? global.confirm.bind(global) : () => true;
    if (!documentRef || !fetchImpl) throw new Error("时间校准缺少浏览器能力。");

    const elements = Object.fromEntries(Object.entries(DOM_IDS).map(([key, id]) => [key, documentRef.getElementById(id)]));
    const missing = Object.entries(elements).filter(([, element]) => !element).map(([key]) => DOM_IDS[key]);
    if (missing.length) throw new Error(`时间校准缺少 DOM：${missing.join("、")}`);

    let destroyed = false;
    let internalSession = 0;
    let requestController = null;
    let hostBusy = false;
    let pendingOpen = null;
    let state = emptyState();
    const listeners = [];

    listen(elements.form, "change", handleFormChange);
    listen(elements.form, "submit", handleSubmit);
    listen(elements.deleteButton, "click", handleDelete);
    listen(elements.refreshButton, "click", refreshLedger);
    listen(elements.summary, "click", blockBusyClose);
    listen(elements.summary, "keydown", blockBusyClose);
    listen(elements.details, "toggle", keepOpenWhileBusy);
    elements.status.setAttribute("role", "status");
    elements.status.setAttribute("aria-live", "polite");
    elements.status.setAttribute("aria-atomic", "true");
    elements.note.maxLength = 500;
    clearDom();

    function listen(target, type, handler) {
      target.addEventListener(type, handler);
      listeners.push({ target, type, handler });
    }

    function open(input = {}) {
      if (destroyed) return Promise.resolve(null);
      abortActiveRequest();
      internalSession += 1;
      setBusy(false);
      state = {
        ...emptyState(),
        eventId: safeEventId(input.eventId),
        hostSessionKey: input.sessionKey,
        demo: Boolean(input.demo),
        puzzle: normalizePuzzleReference(input.puzzle),
        hasDateDifference: input.hasDateDifference !== false
      };
      clearDom();
      if (!state.eventId) return Promise.resolve(null);
      elements.details.hidden = !state.hasDateDifference;
      setSummary("两段记录的时间线索需要核对", "待核对", "pending");
      setStatus("正在读取时间线索账本…");
      return loadLedger({ draft: null, refreshed: false });
    }

    function syncPuzzle(input = {}) {
      const target = calibrationPuzzleTarget(input.payload);
      if (!target) {
        reset();
        return { active: false, handlesDateQuestion: false };
      }
      const next = {
        eventId: target.eventId,
        puzzle: target.puzzle,
        demo: input.demo,
        sessionKey: input.sessionKey,
        hasDateDifference: target.hasDateDifference
      };
      if (state.eventId !== next.eventId || state.hostSessionKey !== next.sessionKey || state.hasDateDifference !== next.hasDateDifference) {
        if (hostBusy) {
          reset();
          pendingOpen = next;
        } else {
          pendingOpen = null;
          void open(next);
        }
      }
      return { active: true, handlesDateQuestion: target.hasDateDifference };
    }

    function reset() {
      abortActiveRequest();
      internalSession += 1;
      setBusy(false);
      state = emptyState();
      pendingOpen = null;
      clearDom();
    }

    function refreshLedger() {
      if (destroyed || hostBusy || !state.eventId) return Promise.resolve(null);
      const draft = readDraft();
      abortActiveRequest();
      internalSession += 1;
      state.conflict = false;
      elements.refreshButton.hidden = true;
      setStatus("正在重新读取变化后的时间线索…");
      return loadLedger({ draft, refreshed: true });
    }

    function destroy() {
      if (destroyed) return;
      reset();
      hostBusy = false;
      destroyed = true;
      listeners.forEach(({ target, type, handler }) => target.removeEventListener(type, handler));
      listeners.length = 0;
    }

    async function loadLedger({ draft, refreshed }) {
      const capture = captureSession();
      setBusy(true);
      try {
        const { payload, response } = await requestJson(
          `/api/time-calibrations/events/${encodeURIComponent(state.eventId)}`,
          { method: "GET" },
          capture
        );
        ensureCurrent(capture);
        const normalized = normalizePayload(payload, getEtag(response) || payload?.etag);
        state.payload = normalized;
        state.etag = normalized.etag;
        state.conflict = false;
        applyPayload(normalized, draft);
        if (refreshed) {
          setStatus("时间线索已重新读取；你的草稿仍保留，请核对变化后再保存。", "notice");
        }
        return normalized;
      } catch (error) {
        if (expectedError(error)) return null;
        setStatus(`读取失败：${errorMessage(error)}`, "error");
        elements.refreshButton.hidden = false;
        return null;
      } finally {
        if (isCurrent(capture)) setBusy(false);
      }
    }

    function applyPayload(payload, draft) {
      const calibration = payload.calibration;
      const shouldReveal = state.hasDateDifference || Boolean(calibration) || payload.needsReview;
      elements.details.hidden = !shouldReveal;
      if (!shouldReveal) elements.details.open = false;
      renderSources(payload.candidates, calibration, payload.candidateCount, payload.candidatesTruncated);
      const formValue = hasMeaningfulDraft(draft) ? draft : calibration;
      applyToForm(formValue);
      state.hasCalibration = Boolean(calibration);
      elements.deleteButton.hidden = !calibration;
      elements.refreshButton.hidden = true;

      if (payload.needsReview && calibration) {
        setSummary("已有时间判断，但来源后来发生变化", "需要复核", "review");
        elements.intro.textContent = `${BOUNDARY_COPY} 当前保留：${describeCalibration(calibration)}。`;
        setStatus("来源后来发生变化。旧判断仍保留，但不会继续作为已确认结果。", "review");
      } else if (calibration) {
        setSummary(`已保存：${RESOLUTION_LABELS[calibration.resolutionKind]}`, "已校准", "saved");
        elements.intro.textContent = `${BOUNDARY_COPY} 当前保留：${describeCalibration(calibration)}。`;
        setStatus(state.demo
          ? "公开 Demo 仅展示示例判断，不保存访客修改。"
          : "你可以复核来源后更新判断，或恢复未校准状态。", state.demo ? "demo" : "neutral");
      } else {
        setSummary("两段记录的时间线索需要核对", "待核对", "pending");
        elements.intro.textContent = BOUNDARY_COPY;
        setStatus(state.demo
          ? "公开 Demo 仅展示示例判断，不保存访客修改。"
          : payload.candidateCount
            ? `已找到 ${payload.candidateCount} 条可核对的时间来源。`
            : "没有可用于校准的结构化时间来源。", state.demo ? "demo" : "neutral");
      }

      if ((!payload.sourceSetSha256 || !payload.etag) && !state.demo) {
        setStatus("线索版本信息不完整；当前只能查看，暂时不能保存。", "error");
      }
      updateFormAccess();
    }

    function renderSources(candidates, calibration, candidateCount, candidatesTruncated) {
      const currentKeys = new Set(candidates.map((candidate) => candidate.sourceKey));
      const savedSnapshots = (calibration?.selectedSourceSnapshots || [])
        .filter((snapshot) => !currentKeys.has(snapshot.sourceKey));
      if (!candidates.length && !savedSnapshots.length) {
        elements.sources.innerHTML = '<div class="time-calibration-empty"><strong>暂无结构化时间来源</strong><span>原文仍会按原样保留，不会据此补写日期。</span></div>';
        return;
      }
      const currentSources = candidates.length ? `
        <fieldset class="time-calibration-source-fieldset">
          <legend>选择支持这次判断的来源</legend>
          <p>只勾选你实际核对过的线索；来源标签由系统按证据类型生成。${candidatesTruncated ? ` 共 ${candidateCount} 条，当前优先显示已选来源、当前记录等 100 条。` : ""}</p>
          <div class="time-calibration-source-grid">
            ${candidates.map(renderCandidate).join("")}
          </div>
        </fieldset>` : "";
      const savedSources = savedSnapshots.length ? `
        <section class="time-calibration-saved-sources" aria-label="保存时来源">
          <strong>保存时来源</strong>
          <p>这些来源后来发生变化或已不可用；日期快照只用于解释旧判断，不能再次勾选。</p>
          <div class="time-calibration-source-grid">
            ${savedSnapshots.map(renderSavedSource).join("")}
          </div>
        </section>` : "";
      elements.sources.innerHTML = currentSources + savedSources;
    }

    function renderCandidate(candidate, index) {
      const label = SOURCE_KIND_LABELS[candidate.sourceKind];
      const title = candidate.title || `${label} ${index + 1}`;
      const dateCopy = candidate.dateText || candidate.date || "未提供明确日期";
      return `<label class="time-calibration-source-card">
        <input type="checkbox" name="${SOURCE_NAME}" value="${escapeHtml(candidate.sourceKey)}" />
        <span class="time-calibration-source-copy">
          <small>${escapeHtml(label)}</small>
          <strong>${escapeHtml(title)}</strong>
          <span class="time-calibration-source-date">${escapeHtml(dateCopy)}</span>
          ${candidate.excerpt ? `<q>${escapeHtml(candidate.excerpt)}</q>` : ""}
        </span>
      </label>`;
    }

    function renderSavedSource(snapshot, index) {
      const sourceKind = normalizeSourceKind(snapshot.sourceType);
      const label = SOURCE_KIND_LABELS[sourceKind] || "保存时来源";
      const dateCopy = snapshot.intervalStart === snapshot.intervalEnd
        ? snapshot.intervalStart
        : `${snapshot.intervalStart} 至 ${snapshot.intervalEnd}`;
      return `<article class="time-calibration-source-card is-saved">
        <span class="time-calibration-source-copy">
          <small>${escapeHtml(label)} · 已变化</small>
          <strong>保存时来源 ${index + 1}</strong>
          <span class="time-calibration-source-date">${escapeHtml(dateCopy)}</span>
        </span>
      </article>`;
    }

    function applyToForm(value) {
      const calibration = value && typeof value === "object" ? value : {};
      const selectedKind = normalizeResolutionKind(calibration.resolutionKind);
      resolutionInputs().forEach((input) => { input.checked = input.value === selectedKind; });
      elements.intervalStart.value = normalizeDay(calibration.intervalStart);
      elements.intervalEnd.value = normalizeDay(calibration.intervalEnd);
      elements.note.value = boundedText(calibration.note, 500);
      const selected = new Set(normalizeSourceKeys(calibration.selectedSourceKeys));
      sourceInputs().forEach((input) => { input.checked = selected.has(input.value); });
      updateConditionalFields();
    }

    function handleFormChange(event) {
      if (event?.target?.name === RESOLUTION_NAME || event?.target?.name === SOURCE_NAME) {
        updateConditionalFields();
      }
    }

    function updateConditionalFields() {
      const kind = selectedResolutionKind();
      const hasInterval = kind === "day" || kind === "range";
      elements.interval.hidden = !hasInterval;
      const endContainer = elements.intervalEnd.parentElement;
      if (endContainer) endContainer.hidden = kind !== "range";
      updateFormAccess();
    }

    function updateFormAccess() {
      const locked = state.demo || state.busy || hostBusy;
      const kind = selectedResolutionKind();
      resolutionInputs().forEach((input) => { input.disabled = locked; });
      sourceInputs().forEach((input) => { input.disabled = locked; });
      elements.intervalStart.disabled = locked || (kind !== "day" && kind !== "range");
      elements.intervalEnd.disabled = locked || kind !== "range";
      elements.note.disabled = locked;
      elements.saveButton.disabled = locked || state.conflict || !state.payload?.sourceSetSha256 || !state.etag;
      elements.deleteButton.disabled = locked || state.conflict || !state.hasCalibration || !state.etag;
      elements.refreshButton.disabled = state.busy || hostBusy;
    }

    function setHostBusy(value) {
      hostBusy = Boolean(value);
      updateFormAccess();
      if (!hostBusy && pendingOpen) {
        const next = pendingOpen;
        pendingOpen = null;
        void open(next);
      }
    }

    async function handleSubmit(event) {
      event?.preventDefault?.();
      if (destroyed || state.demo || state.busy || hostBusy || state.conflict || !state.eventId) return;
      const draft = readDraft();
      const validation = validateDraft(draft, state.payload);
      if (validation) {
        setStatus(validation.message, "error");
        validation.focus?.focus?.();
        return;
      }
      if (!state.etag) {
        setStatus("版本标识缺失，请重新读取后再确认。", "error");
        elements.refreshButton.hidden = false;
        return;
      }

      const body = {
        resolutionKind: draft.resolutionKind,
        intervalStart: draft.resolutionKind === "day" || draft.resolutionKind === "range" ? draft.intervalStart : "",
        intervalEnd: draft.resolutionKind === "day" ? draft.intervalStart : draft.resolutionKind === "range" ? draft.intervalEnd : "",
        selectedSourceKeys: draft.selectedSourceKeys,
        sourceSetSha256: state.payload.sourceSetSha256,
        note: draft.note,
        confirm: true
      };
      const capture = captureSession();
      setStatus("正在保存时间判断…");
      setBusy(true);
      try {
        const { payload, response } = await requestJson(
          `/api/time-calibrations/events/${encodeURIComponent(state.eventId)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json", "If-Match": state.etag },
            body: JSON.stringify(body)
          },
          capture
        );
        ensureCurrent(capture);
        const merged = mergeMutationPayload(payload, body, getEtag(response), false);
        state.payload = normalizePayload(merged, getEtag(response) || payload?.etag || state.etag);
        state.etag = state.payload.etag;
        state.conflict = false;
        applyPayload(state.payload, null);
        setStatus("时间判断已保存；原文和展品日期都没有被改写。", "success");
        await notifyChanged({ action: "saved", eventId: state.eventId, calibration: state.payload.calibration });
      } catch (error) {
        if (expectedError(error)) return;
        if (error.status === 412 || (error.status === 409 && error.code === "CALIBRATION_SOURCES_CHANGED")) {
          return showConflict();
        }
        setStatus(`保存失败：${errorMessage(error)}`, "error");
      } finally {
        if (isCurrent(capture)) setBusy(false);
      }
    }

    async function handleDelete(event) {
      event?.preventDefault?.();
      if (destroyed || state.demo || state.busy || hostBusy || state.conflict || !state.eventId || !state.hasCalibration) return;
      if (!confirmImpl("恢复未校准状态吗？已保存的时间判断会移除，但两段原文和展品日期不会改变。")) return;
      const capture = captureSession();
      setStatus("正在恢复未校准状态…");
      setBusy(true);
      try {
        const { payload, response } = await requestJson(
          `/api/time-calibrations/events/${encodeURIComponent(state.eventId)}`,
          {
            method: "DELETE",
            headers: { "Content-Type": "application/json", "If-Match": state.etag },
            body: JSON.stringify({ confirm: true })
          },
          capture
        );
        ensureCurrent(capture);
        const deleteEtag = getEtag(response) || payload?.etag || "";
        if (deleteEtag || Array.isArray(payload?.candidates)) {
          const merged = mergeMutationPayload(payload, null, deleteEtag, true);
          state.payload = normalizePayload(merged, deleteEtag);
        } else {
          const latest = await requestJson(
            `/api/time-calibrations/events/${encodeURIComponent(state.eventId)}`,
            { method: "GET" },
            capture
          );
          ensureCurrent(capture);
          state.payload = normalizePayload(latest.payload, getEtag(latest.response) || latest.payload?.etag);
        }
        state.etag = state.payload.etag;
        state.conflict = false;
        applyPayload(state.payload, null);
        setStatus("已恢复未校准状态；两段原文和展品日期都没有被改写。", "success");
        await notifyChanged({ action: "deleted", eventId: state.eventId, calibration: null });
      } catch (error) {
        if (expectedError(error)) return;
        if (error.status === 412) return showConflict();
        setStatus(`恢复失败：${errorMessage(error)}`, "error");
      } finally {
        if (isCurrent(capture)) setBusy(false);
      }
    }

    function mergeMutationPayload(payload, fallbackCalibration, responseEtag, deleted) {
      const source = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
      return {
        candidates: Array.isArray(source.candidates) ? source.candidates : state.payload?.candidates || [],
        candidateCount: Object.hasOwn(source, "candidateCount") ? source.candidateCount : state.payload?.candidateCount,
        candidatesTruncated: Object.hasOwn(source, "candidatesTruncated") ? source.candidatesTruncated : state.payload?.candidatesTruncated,
        sourceSetSha256: source.sourceSetSha256 || state.payload?.sourceSetSha256 || "",
        calibration: deleted ? null : Object.hasOwn(source, "calibration") ? source.calibration : fallbackCalibration,
        needsReview: deleted ? false : source.needsReview === true,
        etag: responseEtag || source.etag || state.etag
      };
    }

    function showConflict() {
      state.conflict = true;
      elements.refreshButton.hidden = false;
      setStatus("时间线索已经变化，请重新读取后再确认。你的当前草稿仍保留。", "error");
      updateFormAccess();
    }

    function readDraft() {
      return {
        resolutionKind: selectedResolutionKind(),
        intervalStart: normalizeDay(elements.intervalStart.value),
        intervalEnd: normalizeDay(elements.intervalEnd.value),
        selectedSourceKeys: sourceInputs().filter((input) => input.checked).map((input) => input.value),
        note: boundedText(elements.note.value, 500)
      };
    }

    function validateDraft(draft, payload) {
      if (!draft.resolutionKind) return { message: "请选择一种保留时间的方式。", focus: resolutionInputs()[0] };
      if (!payload?.sourceSetSha256) return { message: "时间来源版本缺失，请重新读取后再确认。", focus: elements.refreshButton };
      if (draft.resolutionKind === "day" && !draft.intervalStart) {
        return { message: "“确认一个日期”需要填写明确日期。", focus: elements.intervalStart };
      }
      if (draft.resolutionKind === "range" && (!draft.intervalStart || !draft.intervalEnd)) {
        return { message: "“确认一个时间范围”需要填写开始与结束日期。", focus: !draft.intervalStart ? elements.intervalStart : elements.intervalEnd };
      }
      if (draft.resolutionKind === "range" && draft.intervalStart > draft.intervalEnd) {
        return { message: "时间范围的结束日期不能早于开始日期。", focus: elements.intervalEnd };
      }
      if ((draft.resolutionKind === "day" || draft.resolutionKind === "range") && draft.selectedSourceKeys.length < 1) {
        return { message: "请至少勾选一条你已经核对过的来源。", focus: sourceInputs()[0] };
      }
      if (draft.resolutionKind === "alternatives" && draft.selectedSourceKeys.length < 2) {
        return { message: "“保留多种时间记录”需要至少勾选两条来源。", focus: sourceInputs()[0] };
      }
      return null;
    }

    function resolutionInputs() {
      return Array.from(elements.choices.querySelectorAll(`input[name="${RESOLUTION_NAME}"]`));
    }

    function sourceInputs() {
      return Array.from(elements.sources.querySelectorAll(`input[name="${SOURCE_NAME}"]`));
    }

    function selectedResolutionKind() {
      return normalizeResolutionKind(resolutionInputs().find((input) => input.checked)?.value);
    }

    function setSummary(copy, badge, stateName) {
      const copyElement = elements.summary.querySelector?.("small");
      if (copyElement) copyElement.textContent = copy;
      elements.summary.setAttribute("aria-label", `校准这段时间：${copy}`);
      elements.badge.textContent = badge;
      elements.badge.dataset.state = stateName;
    }

    function setStatus(copy, stateName = "neutral") {
      elements.status.textContent = copy;
      elements.status.dataset.state = stateName;
    }

    function setBusy(value) {
      const next = Boolean(value);
      if (state.busy === next) return;
      state.busy = next;
      elements.details.setAttribute("aria-busy", String(next));
      elements.body.setAttribute("aria-busy", String(next));
      if (next) elements.summary.setAttribute("aria-disabled", "true");
      else elements.summary.removeAttribute("aria-disabled");
      updateFormAccess();
      try { onBusyChange(next); } catch { /* Host callbacks must not break the panel. */ }
    }

    function blockBusyClose(event) {
      if (!state.busy) return;
      if (event?.type !== "keydown" || event.key === "Enter" || event.key === " ") event.preventDefault?.();
    }

    function keepOpenWhileBusy() {
      if (state.busy && !elements.details.open) elements.details.open = true;
    }

    function clearDom() {
      elements.details.open = false;
      elements.details.hidden = true;
      elements.details.setAttribute("aria-busy", "false");
      elements.body.setAttribute("aria-busy", "false");
      elements.summary.removeAttribute("aria-disabled");
      elements.intro.textContent = BOUNDARY_COPY;
      elements.sources.innerHTML = "";
      elements.interval.hidden = true;
      if (elements.intervalEnd.parentElement) elements.intervalEnd.parentElement.hidden = true;
      elements.intervalStart.value = "";
      elements.intervalEnd.value = "";
      elements.note.value = "";
      resolutionInputs().forEach((input) => {
        input.checked = false;
        input.disabled = true;
      });
      elements.status.textContent = "";
      elements.status.dataset.state = "neutral";
      elements.saveButton.disabled = true;
      elements.deleteButton.disabled = true;
      elements.deleteButton.hidden = true;
      elements.refreshButton.disabled = false;
      elements.refreshButton.hidden = true;
      setSummary("两段记录的时间线索需要核对", "待核对", "pending");
    }

    function abortActiveRequest() {
      requestController?.abort();
      requestController = null;
    }

    async function requestJson(url, requestOptions, capture) {
      abortActiveRequest();
      const controller = new AbortController();
      requestController = controller;
      try {
        const response = await fetchImpl(url, {
          cache: "no-store",
          ...requestOptions,
          signal: controller.signal,
          headers: { Accept: "application/json", ...(requestOptions.headers || {}) }
        });
        const text = await response.text();
        const payload = text ? parseJson(text) : {};
        ensureCurrent(capture);
        if (!response.ok) {
          const error = new Error(boundedText(payload?.error || payload?.message, 300) || `请求失败（${response.status}）`);
          error.status = response.status;
          error.code = boundedText(payload?.code, 80);
          error.etag = getEtag(response);
          throw error;
        }
        return { payload, response };
      } finally {
        if (requestController === controller) requestController = null;
      }
    }

    function captureSession() {
      return { internalSession, hostSessionKey: state.hostSessionKey, eventId: state.eventId };
    }

    function isCurrent(capture) {
      return !destroyed && capture.internalSession === internalSession && capture.hostSessionKey === state.hostSessionKey && capture.eventId === state.eventId;
    }

    function ensureCurrent(capture) {
      if (!isCurrent(capture)) throw STALE_REQUEST;
    }

    async function notifyChanged(change) {
      try { await onChanged(change); } catch { /* The persisted result remains valid if the host refresh fails. */ }
    }

    return Object.freeze({ open, reset, refreshLedger, setHostBusy, syncPuzzle, destroy });
  }

  function calibrationPuzzleTarget(payload) {
    const source = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
    const puzzle = source?.puzzle;
    const eventId = safeEventId(source?.event?.id);
    const confirmed = source?.decision?.decision === "same_event" || Boolean(eventId);
    const hasDateDifference = Array.isArray(puzzle?.differs) && puzzle.differs.some((item) => item?.field === "date" && item?.verified === true);
    return confirmed && eventId ? { eventId, puzzle, hasDateDifference } : null;
  }

  function renderTimelineLedger(entries, escape = escapeHtml, format = (value) => String(value || "")) {
    const list = (Array.isArray(entries) ? entries : []).filter((entry) => entry?.calibration);
    if (!list.length) return "";
    const reviewCount = list.filter((entry) => entry.needsReview).length;
    const alternativesCount = list.filter((entry) => entry.calibration.resolutionKind === "alternatives").length;
    const summary = alternativesCount || reviewCount
      ? [alternativesCount ? `${alternativesCount} 组保留多种记录` : "", reviewCount ? `${reviewCount} 组需要重新核对` : ""].filter(Boolean).join(" · ")
      : `${list.length} 项用户确认的时间判断`;
    return `<details class="time-calibration-ledger"><summary><span><strong>不确定时间线</strong><small>${escape(summary)}</small></span><span>${escape(String(list.length))}</span></summary><div class="time-calibration-ledger-list">${list.map((entry) => {
      const ids = Array.isArray(entry.target?.memberIds) ? entry.target.memberIds.filter(Boolean).slice(0, 2) : [];
      const action = ids.length === 2
        ? `<button type="button" class="button text-button compact" data-puzzle-left="${escape(ids[0])}" data-puzzle-right="${escape(ids[1])}">回看拼图</button>`
        : entry.target?.type === "memory" ? `<button type="button" class="button text-button compact" data-memory-id="${escape(entry.target.id)}">查看展品</button>` : "";
      return `<article class="time-calibration-ledger-item"><span><strong>${escape(entry.target?.title || "未命名时间判断")}</strong><small>${escape(describeTimelineEntry(entry, format))}</small></span>${action}</article>`;
    }).join("")}</div></details>`;
  }

  function describeTimelineEntry(entry, format) {
    if (entry.needsReview) return "来源发生变化，需要重新核对";
    const calibration = entry.calibration || {};
    if (calibration.resolutionKind === "day") return `用户确认日期：${format(calibration.intervalStart)}`;
    if (calibration.resolutionKind === "range") return `用户确认范围：${format(calibration.intervalStart)} 至 ${format(calibration.intervalEnd)}`;
    if (calibration.resolutionKind === "alternatives") return "用户选择保留多种时间记录";
    return "用户明确保留不确定";
  }

  function emptyState() {
    return {
      eventId: "",
      hostSessionKey: undefined,
      demo: false,
      puzzle: null,
      hasDateDifference: false,
      payload: null,
      etag: "",
      busy: false,
      conflict: false,
      hasCalibration: false
    };
  }

  function normalizePayload(value, responseEtag = "") {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const rawCandidates = Array.isArray(source.candidates) ? source.candidates : [];
    const candidates = [];
    const keys = new Set();
    for (const item of rawCandidates.slice(0, 100)) {
      const candidate = normalizeCandidate(item);
      if (!candidate || keys.has(candidate.sourceKey)) continue;
      keys.add(candidate.sourceKey);
      candidates.push(candidate);
    }
    const suppliedCount = Number(source.candidateCount);
    const candidateCount = Number.isSafeInteger(suppliedCount) && suppliedCount >= candidates.length
      ? suppliedCount
      : rawCandidates.length;
    const headerEtag = responseEtag && typeof responseEtag === "object" ? responseEtag.etag : responseEtag;
    return {
      candidates,
      candidateCount,
      candidatesTruncated: source.candidatesTruncated === true || candidateCount > candidates.length,
      sourceSetSha256: normalizeSha256(source.sourceSetSha256),
      calibration: normalizeCalibration(source.calibration),
      needsReview: source.needsReview === true,
      etag: normalizeEtag(headerEtag || source.etag)
    };
  }

  function normalizeCandidate(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const sourceKey = safeSourceKey(source.sourceKey || source.key);
    const sourceKind = normalizeSourceKind(source.sourceKind || source.sourceType || source.kind || source.type);
    if (!sourceKey || !sourceKind) return null;
    const date = normalizeDay(source.date || source.dateValue || source.intervalStart);
    return {
      sourceKey,
      sourceKind,
      title: boundedText(source.title || source.memoryTitle || source.eventTitle || source.name, 200),
      date,
      dateText: boundedText(source.dateText || source.displayDate || source.timeLabel, 100),
      excerpt: boundedText(source.excerpt || source.sourceQuote || source.transcriptExcerpt || source.quote || source.description, 500)
    };
  }

  function normalizeCalibration(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : null;
    if (!source) return null;
    const resolutionKind = normalizeResolutionKind(source.resolutionKind);
    if (!resolutionKind) return null;
    let intervalStart = normalizeDay(source.intervalStart);
    let intervalEnd = normalizeDay(source.intervalEnd);
    if (resolutionKind === "day") {
      if (!intervalStart) return null;
      intervalEnd = intervalStart;
    } else if (resolutionKind === "range") {
      if (!intervalStart || !intervalEnd || intervalStart > intervalEnd) return null;
    } else {
      intervalStart = "";
      intervalEnd = "";
    }
    return {
      resolutionKind,
      intervalStart,
      intervalEnd,
      selectedSourceKeys: normalizeSourceKeys(source.selectedSourceKeys),
      selectedSourceSnapshots: normalizeSourceSnapshots(source.selectedSourceSnapshots),
      note: boundedText(source.note, 500)
    };
  }

  function normalizeSourceSnapshots(value) {
    const snapshots = [];
    const seen = new Set();
    for (const item of Array.isArray(value) ? value.slice(0, 100) : []) {
      const sourceKey = safeSourceKey(item?.sourceKey);
      const sourceType = String(item?.sourceType || "");
      const precision = String(item?.precision || "");
      const intervalStart = normalizeDay(item?.intervalStart);
      const intervalEnd = normalizeDay(item?.intervalEnd);
      if (!sourceKey || seen.has(sourceKey) || !normalizeSourceKind(sourceType) ||
          !["year", "month", "day", "range"].includes(precision) ||
          !intervalStart || !intervalEnd || intervalStart > intervalEnd) continue;
      seen.add(sourceKey);
      snapshots.push({ intervalEnd, intervalStart, precision, sourceKey, sourceType });
    }
    return snapshots.sort((left, right) => left.sourceKey.localeCompare(right.sourceKey, "en"));
  }

  function normalizeResolutionKind(value) {
    const kind = String(value || "");
    return Object.hasOwn(RESOLUTION_LABELS, kind) ? kind : "";
  }

  function normalizeSourceKind(value) {
    const kind = String(value || "").trim().toLowerCase();
    if (["original", "memory", "record", "raw", "memory_original", "memory-current", "raw-claim"].includes(kind)) return "original";
    if (["revision", "memory_revision", "correction", "revised"].includes(kind)) return "revision";
    if (["photo", "image", "media", "photo_metadata", "exif"].includes(kind)) return "photo";
    if (kind === "oral-history") return "oralHistory";
    return "";
  }

  function normalizeSourceKeys(value) {
    const result = [];
    const seen = new Set();
    for (const item of Array.isArray(value) ? value.slice(0, 100) : []) {
      const key = safeSourceKey(item);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(key);
    }
    return result;
  }

  function normalizePuzzleReference(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : null;
    if (!source) return null;
    const pair = source.pair && typeof source.pair === "object" ? source.pair : null;
    return pair ? {
      leftId: safeEventId(pair.left?.id || pair.leftId),
      rightId: safeEventId(pair.right?.id || pair.rightId)
    } : null;
  }

  function safeEventId(value) {
    const id = String(value || "").trim();
    return /^[a-zA-Z0-9_-]{1,120}$/u.test(id) ? id : "";
  }

  function safeSourceKey(value) {
    const key = boundedText(value, 200).trim();
    return /^time-source:[a-f0-9]{64}$/u.test(key) ? key : "";
  }

  function normalizeSha256(value) {
    const hash = String(value || "").trim().toLowerCase();
    return /^[a-f0-9]{64}$/u.test(hash) ? hash : "";
  }

  function normalizeEtag(value) {
    const etag = boundedText(value, 256).trim();
    return etag && !/[\r\n]/u.test(etag) ? etag : "";
  }

  function normalizeDay(value) {
    const day = String(value || "");
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(day)) return "";
    const date = new Date(`${day}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day ? day : "";
  }

  function boundedText(value, maximum) {
    return Array.from(String(value ?? "")).slice(0, maximum).join("");
  }

  function hasMeaningfulDraft(value) {
    return Boolean(value && (value.resolutionKind || value.intervalStart || value.intervalEnd || value.note || value.selectedSourceKeys?.length));
  }

  function describeCalibration(calibration) {
    const label = RESOLUTION_LABELS[calibration.resolutionKind] || "保留时间判断";
    if (calibration.resolutionKind === "day") return `${label}（${calibration.intervalStart}）`;
    if (calibration.resolutionKind === "range") return `${label}（${calibration.intervalStart} 至 ${calibration.intervalEnd}）`;
    if (calibration.resolutionKind === "alternatives") return `${label}（${calibration.selectedSourceKeys.length} 条来源）`;
    return label;
  }

  function getEtag(response) {
    return normalizeEtag(response?.headers?.get?.("etag") || response?.headers?.get?.("ETag"));
  }

  function parseJson(text) {
    try { return JSON.parse(text); } catch { return { error: boundedText(text, 300) }; }
  }

  function expectedError(error) {
    return error === STALE_REQUEST || error?.name === "AbortError";
  }

  function errorMessage(error) {
    return boundedText(error?.message || error || "未知错误", 300);
  }

  function escapeHtml(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  }

  global.TimeIsleTimeCalibrations = Object.freeze({ calibrationPuzzleTarget, createController, normalizePayload, renderTimelineLedger, domIds: DOM_IDS });
})(typeof window !== "undefined" ? window : globalThis);
