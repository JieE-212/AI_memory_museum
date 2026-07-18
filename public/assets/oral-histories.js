(function initializeTimeIsleOralHistories(global) {
  "use strict";

  const DOM_IDS = Object.freeze({
    details: "oralHistoryDetails",
    summary: "oralHistorySummary",
    summaryCopy: "oralHistorySummaryCopy",
    badge: "oralHistoryBadge",
    sourceRegion: "oralHistorySourceRegion",
    sourceCount: "oralHistorySourceCount",
    sourceList: "oralHistorySourceList",
    status: "oralHistoryStatus",
    form: "oralHistoryForm",
    questionStep: "oralHistoryQuestionStep",
    questionChoices: "oralHistoryQuestionChoices",
    audioStep: "oralHistoryAudioStep",
    recordButton: "oralHistoryRecordButton",
    fileInput: "oralHistoryFileInput",
    fileLabel: "oralHistoryFileLabel",
    captureHelp: "oralHistoryCaptureHelp",
    recording: "oralHistoryRecording",
    timer: "oralHistoryRecordingTimer",
    stopButton: "oralHistoryStopButton",
    cancelButton: "oralHistoryCancelButton",
    draftAudio: "oralHistoryDraftAudio",
    captureStatus: "oralHistoryCaptureStatus",
    retryButton: "oralHistoryRetryButton",
    removeAudioButton: "oralHistoryRemoveAudioButton",
    segmentStep: "oralHistorySegmentStep",
    segmentStart: "oralHistorySegmentStart",
    segmentStartOutput: "oralHistorySegmentStartOutput",
    segmentEnd: "oralHistorySegmentEnd",
    segmentEndOutput: "oralHistorySegmentEndOutput",
    markStartButton: "oralHistoryMarkStartButton",
    markEndButton: "oralHistoryMarkEndButton",
    previewSegmentButton: "oralHistoryPreviewSegmentButton",
    transcriptStep: "oralHistoryTranscriptStep",
    transcript: "oralHistoryTranscript",
    resolutionChoices: "oralHistoryResolutionChoices",
    firstDateLabel: "oralHistoryFirstDateLabel",
    firstDateMeta: "oralHistoryFirstDateMeta",
    secondDateLabel: "oralHistorySecondDateLabel",
    secondDateMeta: "oralHistorySecondDateMeta",
    customInterval: "oralHistoryCustomInterval",
    intervalStartLabel: "oralHistoryIntervalStartLabel",
    intervalStart: "oralHistoryIntervalStart",
    intervalEndField: "oralHistoryIntervalEndField",
    intervalEnd: "oralHistoryIntervalEnd",
    acknowledge: "oralHistoryAcknowledge",
    saveButton: "oralHistorySaveButton",
    resetButton: "oralHistoryResetButton",
    refreshButton: "oralHistoryRefreshButton"
  });
  const QUESTION_NAME = "oralHistoryQuestionId";
  const RESOLUTION_NAME = "oralHistoryResolutionChoice";
  const MIN_SEGMENT_MS = 500;
  const MAX_TRANSCRIPT_LENGTH = 8000;
  const CONFLICT_CODES = new Set([
    "ORAL_HISTORY_VERSION_CONFLICT",
    "ORAL_HISTORY_QUESTION_SET_CHANGED",
    "ORAL_HISTORY_PRECONDITION_REQUIRED",
    "ORAL_HISTORY_NOT_ELIGIBLE"
  ]);
  const STALE = Symbol("stale oral-history request");

  function createController(options = {}) {
    const documentRef = options.document || global.document;
    const fetchImpl = options.fetch || global.fetch?.bind(global);
    const captureFactory = options.captureFactory || global.TimeIsleVoiceCapture?.createController;
    if (!documentRef || typeof fetchImpl !== "function" || typeof captureFactory !== "function") {
      throw new Error("口述史控制器缺少浏览器能力。");
    }
    const supplied = options.elements || {};
    const elements = Object.fromEntries(Object.entries(DOM_IDS).map(([key, id]) => [key, supplied[key] || documentRef.getElementById(id)]));
    const missing = Object.entries(elements).filter(([, element]) => !element).map(([key]) => DOM_IDS[key]);
    if (missing.length) throw new Error(`口述史控制器缺少 DOM：${missing.join("、")}`);

    const confirmImpl = options.confirm || (typeof global.confirm === "function" ? global.confirm.bind(global) : () => true);
    const onBusyChange = typeof options.onBusyChange === "function" ? options.onBusyChange : () => {};
    const onChanged = typeof options.onChanged === "function" ? options.onChanged : () => {};
    const listeners = [];
    let destroyed = false;
    let session = 0;
    let requestController = null;
    let hostBusy = false;
    let captureBusy = false;
    let lastPublishedBusy = false;
    let previewAudio = null;
    let previewEndMs = 0;
    let state = emptyState(Boolean(options.demo));

    const captureController = captureFactory({
      elements: {
        recordButton: elements.recordButton,
        fileInput: elements.fileInput,
        fileLabel: elements.fileLabel,
        help: elements.captureHelp,
        recording: elements.recording,
        timer: elements.timer,
        stopButton: elements.stopButton,
        cancelButton: elements.cancelButton,
        audio: elements.draftAudio,
        status: elements.captureStatus,
        retryButton: elements.retryButton,
        removeButton: elements.removeAudioButton
      },
      policy: options.policy,
      demo: state.demo,
      document: documentRef,
      fetch: fetchImpl,
      navigator: options.navigator,
      MediaRecorder: options.MediaRecorder,
      isSecureContext: options.isSecureContext,
      onBusyChange: (busy) => {
        captureBusy = Boolean(busy);
        publishBusy();
        updateAccess();
      },
      onChange: handleCaptureChange
    });

    configureDom();
    bindEvents();
    clearDom();

    function configureDom() {
      elements.transcript.maxLength = MAX_TRANSCRIPT_LENGTH;
      elements.status.setAttribute("role", "status");
      elements.status.setAttribute("aria-live", "polite");
      elements.status.setAttribute("aria-atomic", "true");
      [elements.segmentStart, elements.segmentEnd].forEach((input) => input.setAttribute("aria-describedby", elements.status.id));
      elements.transcript.setAttribute("aria-describedby", elements.status.id);
    }

    function bindEvents() {
      listen(elements.form, "change", handleFormChange);
      listen(elements.form, "input", handleFormInput);
      listen(elements.form, "submit", handleSubmit);
      listen(elements.segmentStart, "input", updateSegmentFromInputs);
      listen(elements.segmentEnd, "input", updateSegmentFromInputs);
      listen(elements.markStartButton, "click", () => markFromPlayback("start"));
      listen(elements.markEndButton, "click", () => markFromPlayback("end"));
      listen(elements.previewSegmentButton, "click", previewDraftSegment);
      listen(elements.resetButton, "click", handleResetDraft);
      listen(elements.refreshButton, "click", refresh);
      listen(elements.sourceList, "click", handleSourceAction);
      listen(elements.summary, "click", blockBusyCollapse);
      listen(elements.summary, "keydown", blockBusyCollapse);
      listen(elements.details, "toggle", keepOpenWhileBusy);
      listen(options.dialog, "cancel", guardDialogClose);
      listen(options.closeButton, "click", guardDialogClose);
    }

    function listen(target, type, handler) {
      if (!target?.addEventListener) return;
      target.addEventListener(type, handler);
      listeners.push({ target, type, handler });
    }

    function syncPuzzle(input = {}) {
      if (destroyed) return { active: false, eligible: false };
      const target = puzzleTarget(input.payload);
      if (!target) {
        reset();
        return { active: false, eligible: false };
      }
      const nextDemo = Boolean(input.demo);
      const changed = state.eventId !== target.eventId || state.hostSessionKey !== input.sessionKey;
      if (changed) {
        reset({ preserveDemo: true });
        state = {
          ...emptyState(nextDemo),
          eventId: target.eventId,
          pairKey: target.pairKey,
          hostSessionKey: input.sessionKey,
          localHasDateDifference: target.hasDateDifference,
          demo: nextDemo
        };
        captureController.setDemo(nextDemo);
        void loadWorkspace({ preserveDraft: false, announce: false });
      } else {
        state.demo = nextDemo;
        state.localHasDateDifference = target.hasDateDifference;
        captureController.setDemo(nextDemo);
        applyEligibility();
        render();
      }
      return { active: true, eligible: state.eligible };
    }

    async function loadWorkspace({ preserveDraft, announce }) {
      if (!state.eventId || destroyed) return null;
      abortRequest();
      const active = captureSession();
      const draft = preserveDraft ? readLocalDraft() : null;
      state.loading = true;
      publishBusy();
      render();
      try {
        const { payload, response } = await requestJson(
          `/api/oral-histories/events/${encodeURIComponent(state.eventId)}`,
          { method: "GET" },
          active
        );
        ensureCurrent(active);
        state.workspace = normalizeWorkspace(payload, response.headers?.get?.("etag") || payload?.etag);
        state.etag = state.workspace.etag;
        state.questionSetSha256 = state.workspace.questionSetSha256;
        state.conflict = false;
        state.loadError = "";
        applyEligibility();
        if (draft) restoreLocalDraft(draft, { reselectQuestion: false });
        if (announce) {
          setStatus("问题已重新读取；本次草稿仍保留，请重新选择问题。", "notice");
        } else if (state.demo) {
          setStatus("公开 Demo 只展示示例口述来源，不请求麦克风或保存修改。", "demo");
        } else if (state.eligible) {
          setStatus(state.workspace.currentConfirmed ? "已有一份人工确认的回答；你可以重新回答，旧来源仍会保留。" : "请先明确选择要回答的时间问题。");
        }
        render();
        return state.workspace;
      } catch (error) {
        if (expectedError(error)) return null;
        state.loadError = errorMessage(error);
        state.conflict = true;
        state.eligible = state.localHasDateDifference;
        setStatus(`口述来源读取失败：${state.loadError}`, "error");
        render();
        return null;
      } finally {
        if (isCurrent(active)) {
          state.loading = false;
          publishBusy();
          render();
        }
      }
    }

    function applyEligibility() {
      const eligibility = state.workspace?.eligibility || {};
      state.eligible = Boolean(
        state.localHasDateDifference &&
        eligibility.eligible === true &&
        eligibility.canAnswer !== false &&
        state.workspace?.question
      );
    }

    function handleCaptureChange(next) {
      const previousAssetId = state.captureAssetId;
      state.captureState = next;
      state.captureAssetId = next.assetId || "";
      if (next.ready && next.assetId) {
        const duration = Math.max(MIN_SEGMENT_MS, Math.floor(next.durationMs));
        if (previousAssetId !== next.assetId) {
          state.segmentStartMs = 0;
          state.segmentEndMs = duration;
          state.transcriptText = "";
          state.resolutionChoice = "";
          state.intervalStart = "";
          state.intervalEnd = "";
          state.acknowledged = false;
          state.submissionId = "";
        }
        configureSegmentInputs(duration);
      } else if (previousAssetId && !next.assetId) {
        clearAnswerFields();
      }
      render();
    }

    function handleFormChange(event) {
      const target = event.target;
      if (target.name === QUESTION_NAME) {
        state.selectedQuestionKey = String(target.value || "");
        state.conflict = false;
        setStatus("问题已选定；现在可以录音或选择本地音频。", "notice");
      } else if (target.name === RESOLUTION_NAME) {
        state.resolutionChoice = String(target.value || "");
        updateResolutionFields();
      } else if (target === elements.acknowledge) {
        state.acknowledged = Boolean(target.checked);
      } else if (target === elements.intervalStart) {
        state.intervalStart = target.value;
      } else if (target === elements.intervalEnd) {
        state.intervalEnd = target.value;
      }
      updateAccess();
    }

    function handleFormInput(event) {
      if (event.target === elements.transcript) state.transcriptText = elements.transcript.value.slice(0, MAX_TRANSCRIPT_LENGTH);
      if (event.target === elements.intervalStart) state.intervalStart = elements.intervalStart.value;
      if (event.target === elements.intervalEnd) state.intervalEnd = elements.intervalEnd.value;
      updateAccess();
    }

    function updateSegmentFromInputs() {
      state.segmentStartMs = boundedInteger(elements.segmentStart.value, 0, captureDuration(), 0);
      state.segmentEndMs = boundedInteger(elements.segmentEnd.value, 0, captureDuration(), captureDuration());
      renderSegmentOutputs();
      updateAccess();
    }

    function markFromPlayback(kind) {
      const duration = captureDuration();
      if (!duration) return;
      const current = boundedInteger(Number(elements.draftAudio.currentTime || 0) * 1000, 0, duration, 0);
      if (kind === "start") state.segmentStartMs = current;
      else state.segmentEndMs = current;
      syncSegmentInputs();
      updateAccess();
    }

    async function previewDraftSegment() {
      const validation = validateSegment();
      if (validation) return showValidation(validation, elements.segmentStart);
      await playBounded(elements.draftAudio, state.segmentStartMs, state.segmentEndMs);
    }

    async function playBounded(audio, startMs, endMs) {
      stopPreview();
      if (!audio || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return;
      previewAudio = audio;
      previewEndMs = endMs;
      audio.currentTime = startMs / 1000;
      audio.addEventListener?.("timeupdate", handlePreviewTime);
      try {
        await audio.play?.();
      } catch (error) {
        stopPreview();
        setStatus(`暂时无法播放选段：${errorMessage(error)}`, "error");
      }
    }

    function handlePreviewTime() {
      if (!previewAudio || Number(previewAudio.currentTime || 0) * 1000 < previewEndMs) return;
      stopPreview();
    }

    function stopPreview() {
      if (!previewAudio) return;
      previewAudio.pause?.();
      previewAudio.removeEventListener?.("timeupdate", handlePreviewTime);
      previewAudio = null;
      previewEndMs = 0;
    }

    async function handleSubmit(event) {
      event.preventDefault();
      if (state.demo || hostBusy || isBusy() || state.conflict || !state.eligible) return;
      const invalid = validateDraft();
      if (invalid) return showValidation(invalid.message, invalid.focus);
      const active = captureSession();
      state.mutation = "saving";
      if (!state.submissionId) state.submissionId = createSubmissionId();
      publishBusy();
      render();
      setStatus("正在保存人工确认的口述来源…", "loading");
      try {
        const capture = await captureController.waitForReady();
        ensureCurrent(active);
        const resolution = readResolution();
        const body = {
          questionSetSha256: state.questionSetSha256,
          assetId: capture.assetId,
          segmentStartMs: state.segmentStartMs,
          segmentEndMs: state.segmentEndMs,
          transcriptText: state.transcriptText.trim(),
          resolutionKind: resolution.resolutionKind,
          intervalStart: resolution.intervalStart,
          intervalEnd: resolution.intervalEnd,
          confirmTranscript: true,
          confirm: true,
          submissionId: state.submissionId
        };
        const { payload, response } = await requestJson(
          `/api/oral-histories/events/${encodeURIComponent(state.eventId)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json", "If-Match": state.etag },
            body: JSON.stringify(body)
          },
          active
        );
        ensureCurrent(active);
        captureController.markAttached();
        clearLocalDraft({ cleanup: true, silent: true });
        state.workspace = normalizeWorkspace(payload, response.headers?.get?.("etag") || payload?.etag);
        state.etag = state.workspace.etag;
        state.questionSetSha256 = state.workspace.questionSetSha256;
        state.conflict = false;
        applyEligibility();
        render();
        setStatus("口述回答已作为人工确认的独立来源保存；时间判断仍由你决定。", "success");
        await Promise.resolve(onChanged({ type: "saved", eventId: state.eventId, workspace: state.workspace }));
      } catch (error) {
        if (expectedError(error)) return;
        if (isConflict(error)) {
          markConflict(error);
        } else {
          setStatus(`保存未完成：${errorMessage(error)}。声音、选段和文字稿仍保留，可直接重试。`, "error");
        }
      } finally {
        if (isCurrent(active)) {
          state.mutation = "";
          publishBusy();
          render();
        }
      }
    }

    async function handleDelete() {
      const current = state.workspace?.currentConfirmed || state.workspace?.currentDraft;
      if (!current || state.demo || hostBusy || isBusy()) return;
      if (!confirmImpl("删除当前口述来源吗？这不会修改两段原文或时间校准，声音文件也不会在这一步被物理删除。")) return;
      const active = captureSession();
      state.mutation = "deleting";
      publishBusy();
      render();
      try {
        const { payload, response } = await requestJson(
          `/api/oral-histories/events/${encodeURIComponent(state.eventId)}`,
          {
            method: "DELETE",
            headers: { "Content-Type": "application/json", "If-Match": state.etag },
            body: JSON.stringify({ questionSetSha256: state.questionSetSha256, confirm: true })
          },
          active
        );
        ensureCurrent(active);
        state.workspace = normalizeWorkspace(payload, response.headers?.get?.("etag") || payload?.etag);
        state.etag = state.workspace.etag;
        state.questionSetSha256 = state.workspace.questionSetSha256;
        state.conflict = false;
        applyEligibility();
        render();
        setStatus("当前口述来源已撤回；两段原文和时间校准没有改变。", "success");
        await Promise.resolve(onChanged({ type: "deleted", eventId: state.eventId, workspace: state.workspace }));
      } catch (error) {
        if (expectedError(error)) return;
        if (isConflict(error)) markConflict(error);
        else setStatus(`口述来源未能删除：${errorMessage(error)}`, "error");
      } finally {
        if (isCurrent(active)) {
          state.mutation = "";
          publishBusy();
          render();
        }
      }
    }

    function handleSourceAction(event) {
      const action = event.target.closest?.("[data-oral-history-action]");
      if (!action || !elements.sourceList.contains(action)) return;
      if (action.dataset.oralHistoryAction === "redo") {
        if (!state.eligible || state.demo || hostBusy || isBusy()) return;
        clearLocalDraft({ cleanup: true, silent: true });
        elements.details.open = true;
        render();
        setStatus("旧来源仍保留。请重新选择问题，再留下新回答。", "notice");
        focusFirstQuestion();
      } else if (action.dataset.oralHistoryAction === "delete") {
        void handleDelete();
      } else if (action.dataset.oralHistoryAction === "play") {
        const card = action.closest?.(".oral-history-source-card");
        const audio = card?.querySelector?.("audio");
        void playBounded(audio, Number(action.dataset.startMs), Number(action.dataset.endMs));
      }
    }

    function handleResetDraft() {
      if (state.demo || hostBusy || state.mutation) return;
      if (hasUnsavedDraft() && !confirmImpl("清空本次尚未保存的声音、选段和文字稿吗？")) return;
      clearLocalDraft({ cleanup: true });
      setStatus("已清空本次回答，已保存的口述来源不受影响。", "notice");
    }

    function refresh() {
      if (!state.eventId || state.loading || state.mutation || captureBusy) return Promise.resolve(null);
      state.selectedQuestionKey = "";
      state.conflict = false;
      return loadWorkspace({ preserveDraft: true, announce: true });
    }

    function markConflict(error) {
      state.conflict = true;
      state.selectedQuestionKey = "";
      setStatus(`时间线索已经变化，本次草稿仍保留；重新读取后请再次选择问题。${errorMessage(error) ? ` ${errorMessage(error)}` : ""}`, "error");
      render();
    }

    function validateDraft() {
      if (!state.selectedQuestionKey || state.selectedQuestionKey !== state.workspace?.question?.selectionKey) {
        return { message: "请先明确选择要回答的问题。", focus: questionInputs()[0] };
      }
      if (!state.captureState?.ready || !state.captureAssetId) {
        return { message: "请先录音或选择音频文件，并等待它完成检查。", focus: elements.recordButton };
      }
      const segmentError = validateSegment();
      if (segmentError) return { message: segmentError, focus: elements.segmentStart };
      if (!state.transcriptText.trim()) return { message: "请先填写并核对文字稿。", focus: elements.transcript };
      const resolution = validateResolution();
      if (resolution) return resolution;
      if (!state.acknowledged) return { message: "请确认你已经听过选定片段并核对文字稿。", focus: elements.acknowledge };
      if (!state.etag || !state.questionSetSha256) return { message: "问题版本信息缺失，请重新读取后再保存。", focus: elements.refreshButton };
      return null;
    }

    function validateSegment() {
      const duration = captureDuration();
      if (!duration || state.segmentStartMs < 0 || state.segmentEndMs > duration || state.segmentEndMs - state.segmentStartMs < MIN_SEGMENT_MS) {
        return "结束时间必须晚于开始时间，且选段至少 0.5 秒。";
      }
      return "";
    }

    function validateResolution() {
      if (!state.resolutionChoice) return { message: "请明确这段回答对时间的含义，也可选择“仍不确定”。", focus: resolutionInputs()[0] };
      if (["first", "second"].includes(state.resolutionChoice) && !selectedQuestionSource()) {
        return { message: "这条日期来源已不可用，请重新读取问题。", focus: elements.refreshButton };
      }
      if (state.resolutionChoice === "day" && !normalizeDay(state.intervalStart)) {
        return { message: "请填写你手工确认的日期。", focus: elements.intervalStart };
      }
      if (state.resolutionChoice === "range") {
        const start = normalizeDay(state.intervalStart);
        const end = normalizeDay(state.intervalEnd);
        if (!start || !end) return { message: "请填写完整的开始和结束日期。", focus: elements.intervalStart };
        if (start > end) return { message: "结束日期不能早于开始日期。", focus: elements.intervalEnd };
      }
      return null;
    }

    function readResolution() {
      if (state.resolutionChoice === "uncertain") return { resolutionKind: "uncertain", intervalStart: "", intervalEnd: "" };
      if (state.resolutionChoice === "day") {
        const date = normalizeDay(state.intervalStart);
        return { resolutionKind: "day", intervalStart: date, intervalEnd: date };
      }
      if (state.resolutionChoice === "range") {
        return { resolutionKind: "range", intervalStart: normalizeDay(state.intervalStart), intervalEnd: normalizeDay(state.intervalEnd) };
      }
      const source = selectedQuestionSource();
      const start = source?.intervalStart || "";
      const end = source?.intervalEnd || start;
      return { resolutionKind: start === end ? "day" : "range", intervalStart: start, intervalEnd: end };
    }

    function selectedQuestionSource() {
      const sources = state.workspace?.question?.sources || [];
      return sources[state.resolutionChoice === "second" ? 1 : 0] || null;
    }

    function render() {
      const workspace = state.workspace;
      renderSources(workspace);
      elements.details.hidden = !(state.eligible || state.loadError);
      if (elements.details.hidden) elements.details.open = false;
      elements.summaryCopy.textContent = state.workspace?.currentConfirmed
        ? "已留下人工确认的来源，仍可重新回答"
        : "回答一个仍未确定的时间问题";
      elements.badge.textContent = state.demo ? "Demo 只读"
        : state.conflict ? "需刷新"
          : state.loading ? "读取中"
            : state.workspace?.currentConfirmed ? "已有来源" : "待回答";
      renderQuestion();
      renderQuestionDates();
      syncDraftToDom();
      updateAccess();
    }

    function renderQuestion() {
      const question = state.workspace?.question;
      if (!question) {
        elements.questionChoices.innerHTML = '<div class="route-empty"><span>暂时没有可回答的时间问题。</span></div>';
        return;
      }
      const checked = state.selectedQuestionKey === question.selectionKey ? " checked" : "";
      const sourceNote = question.sources.slice(0, 2).map((source) => `${source.memoryTitle || "时间来源"}：${formatInterval(source)}`).join(" · ");
      elements.questionChoices.innerHTML = `<label class="oral-history-question-choice"><input type="radio" name="${QUESTION_NAME}" value="${escapeHtml(question.selectionKey)}"${checked} /><span><strong>${escapeHtml(question.text)}</strong><small>${escapeHtml(sourceNote || "原文时间线索仍待你核对")}</small></span></label>`;
    }

    function renderQuestionDates() {
      const sources = state.workspace?.question?.sources || [];
      const first = sources[0];
      const second = sources[1];
      elements.firstDateLabel.textContent = first ? `更接近：${formatInterval(first)}` : "第一种日期已不可用";
      elements.firstDateMeta.textContent = first?.memoryTitle || "";
      elements.secondDateLabel.textContent = second ? `更接近：${formatInterval(second)}` : "第二种日期已不可用";
      elements.secondDateMeta.textContent = second?.memoryTitle || "";
      const firstInput = resolutionInputs().find((input) => input.value === "first");
      const secondInput = resolutionInputs().find((input) => input.value === "second");
      if (firstInput) firstInput.disabled = !first;
      if (secondInput) secondInput.disabled = !second;
    }

    function renderSources(workspace) {
      const current = workspace?.currentConfirmed && !workspace.currentConfirmed.withdrawnAt ? workspace.currentConfirmed : null;
      const history = (workspace?.history || []).filter((answer) => ["confirmed", "superseded", "withdrawn"].includes(answer.status) && answer.id !== current?.id);
      const count = (current ? 1 : 0) + history.length;
      elements.sourceRegion.hidden = count === 0;
      elements.sourceCount.textContent = count ? `${count} 条` : "";
      if (!count) {
        elements.sourceList.innerHTML = "";
        return;
      }
      const currentMarkup = current ? renderAnswer(current, { current: true }) : "";
      const historyMarkup = history.length
        ? `<details class="oral-history-history"><summary>之前的回答（${history.length}）</summary><div class="oral-history-source-list">${history.map((answer) => renderAnswer(answer, { current: false })).join("")}</div></details>`
        : "";
      elements.sourceList.innerHTML = currentMarkup + historyMarkup;
    }

    function renderAnswer(answer, options = {}) {
      const audioUrl = safeAudioUrl(answer.asset?.contentUrl || (answer.assetId ? `/api/voice/assets/${encodeURIComponent(answer.assetId)}/content` : ""));
      const question = state.workspace?.question?.text || "这处时间差异当时如何？";
      const review = answer.withdrawnAt || answer.status === "withdrawn" ? "已撤回"
        : answer.supersededAt || answer.status === "superseded" ? "之前的回答"
          : state.workspace?.eligibility?.needsReview ? "问题线索已变化" : "独立来源";
      const actions = options.current ? `<div class="oral-history-source-actions">
        <button type="button" class="button secondary compact" data-oral-history-action="redo" ${state.demo || !state.eligible ? "disabled" : ""}>重新回答</button>
        <button type="button" class="button text-button compact" data-oral-history-action="delete" ${state.demo ? "disabled" : ""}>删除来源</button>
      </div>` : "";
      return `<article class="oral-history-source-card" data-answer-id="${escapeHtml(answer.id)}">
        <header><h4>人工确认的口述回答</h4><span class="oral-history-source-tag">${escapeHtml(review)}</span></header>
        <q>${escapeHtml(question)}</q>
        <blockquote>${escapeHtml(answer.transcriptText)}</blockquote>
        <div class="oral-history-source-meta"><span>选段 ${escapeHtml(formatPrecise(answer.segmentStartMs))}–${escapeHtml(formatPrecise(answer.segmentEndMs))}</span><span>${escapeHtml(describeResolution(answer))}</span><span>${escapeHtml(formatAnswerTimestamp(answer))}</span></div>
        ${audioUrl ? `<audio controls preload="metadata" src="${escapeHtml(audioUrl)}" aria-label="播放人工确认的口述回答"></audio><div class="oral-history-source-actions"><button type="button" class="button text-button compact" data-oral-history-action="play" data-start-ms="${answer.segmentStartMs}" data-end-ms="${answer.segmentEndMs}">只播放选段</button></div>` : '<p>声音文件暂时无法播放。</p>'}
        ${actions}
      </article>`;
    }

    function syncDraftToDom() {
      elements.transcript.value = state.transcriptText;
      elements.acknowledge.checked = state.acknowledged;
      elements.intervalStart.value = state.intervalStart;
      elements.intervalEnd.value = state.intervalEnd;
      resolutionInputs().forEach((input) => { input.checked = input.value === state.resolutionChoice; });
      syncSegmentInputs();
      updateResolutionFields();
    }

    function updateResolutionFields() {
      const custom = state.resolutionChoice === "day" || state.resolutionChoice === "range";
      elements.customInterval.hidden = !custom;
      elements.intervalEndField.hidden = state.resolutionChoice !== "range";
      elements.intervalStartLabel.textContent = state.resolutionChoice === "range" ? "开始日期" : "日期";
    }

    function updateAccess() {
      const locked = state.demo || hostBusy || state.loading || Boolean(state.mutation) || state.conflict;
      const selected = Boolean(state.selectedQuestionKey && state.selectedQuestionKey === state.workspace?.question?.selectionKey);
      const captureReady = Boolean(state.captureState?.ready && state.captureAssetId);
      elements.questionStep.disabled = locked || captureBusy;
      elements.audioStep.disabled = locked || !selected;
      captureController.setHostBusy(locked || !selected);
      elements.segmentStep.hidden = !captureReady;
      elements.segmentStep.disabled = locked || captureBusy || !captureReady;
      elements.transcriptStep.hidden = !captureReady;
      elements.transcriptStep.disabled = locked || captureBusy || !captureReady;
      const invalid = validateDraft();
      elements.saveButton.disabled = locked || captureBusy || Boolean(invalid);
      elements.resetButton.disabled = state.demo || hostBusy || Boolean(state.mutation) || captureBusy;
      elements.refreshButton.hidden = !state.conflict && !state.loadError;
      elements.refreshButton.disabled = state.loading || Boolean(state.mutation) || captureBusy;
      renderSegmentOutputs();
    }

    function configureSegmentInputs(duration) {
      [elements.segmentStart, elements.segmentEnd].forEach((input) => { input.max = String(duration); });
      syncSegmentInputs();
    }

    function syncSegmentInputs() {
      const duration = captureDuration();
      elements.segmentStart.max = String(duration);
      elements.segmentEnd.max = String(duration);
      elements.segmentStart.value = String(Math.min(duration, Math.max(0, state.segmentStartMs)));
      elements.segmentEnd.value = String(Math.min(duration, Math.max(0, state.segmentEndMs)));
      renderSegmentOutputs();
    }

    function renderSegmentOutputs() {
      const start = formatPrecise(state.segmentStartMs);
      const end = formatPrecise(state.segmentEndMs);
      elements.segmentStartOutput.textContent = start;
      elements.segmentEndOutput.textContent = end;
      elements.segmentStart.setAttribute("aria-valuetext", start);
      elements.segmentEnd.setAttribute("aria-valuetext", end);
      elements.previewSegmentButton.textContent = `试听 ${start}–${end}`;
    }

    function readLocalDraft() {
      return {
        captureAssetId: state.captureAssetId,
        segmentStartMs: state.segmentStartMs,
        segmentEndMs: state.segmentEndMs,
        transcriptText: state.transcriptText,
        resolutionChoice: state.resolutionChoice,
        intervalStart: state.intervalStart,
        intervalEnd: state.intervalEnd,
        acknowledged: state.acknowledged,
        submissionId: state.submissionId
      };
    }

    function restoreLocalDraft(draft, options = {}) {
      state.selectedQuestionKey = options.reselectQuestion ? state.workspace?.question?.selectionKey || "" : "";
      state.segmentStartMs = Number(draft.segmentStartMs || 0);
      state.segmentEndMs = Number(draft.segmentEndMs || 0);
      state.transcriptText = String(draft.transcriptText || "").slice(0, MAX_TRANSCRIPT_LENGTH);
      state.resolutionChoice = String(draft.resolutionChoice || "");
      state.intervalStart = normalizeDay(draft.intervalStart);
      state.intervalEnd = normalizeDay(draft.intervalEnd);
      state.acknowledged = Boolean(draft.acknowledged);
      state.submissionId = String(draft.submissionId || "");
    }

    function clearAnswerFields() {
      state.captureAssetId = "";
      state.captureState = null;
      state.segmentStartMs = 0;
      state.segmentEndMs = 0;
      state.transcriptText = "";
      state.resolutionChoice = "";
      state.intervalStart = "";
      state.intervalEnd = "";
      state.acknowledged = false;
      state.submissionId = "";
      stopPreview();
    }

    function clearLocalDraft(options = {}) {
      captureController.reset({ cleanup: options.cleanup !== false, silent: true });
      state.selectedQuestionKey = "";
      clearAnswerFields();
      if (!options.silent) render();
    }

    function hasUnsavedDraft() {
      return Boolean(state.selectedQuestionKey || state.captureAssetId || state.transcriptText || state.resolutionChoice || state.acknowledged);
    }

    function guardDialogClose(event) {
      if (isBusy()) {
        event.preventDefault?.();
        elements.details.open = true;
        setStatus("声音或口述来源正在处理；请先停止录音或等待操作完成。", "error");
      } else if (hasUnsavedDraft() && !confirmImpl("放弃本次尚未保存的口述回答吗？已保存来源不受影响。")) {
        event.preventDefault?.();
      } else if (hasUnsavedDraft()) {
        clearLocalDraft({ cleanup: true, silent: true });
      }
    }

    function blockBusyCollapse(event) {
      if (!isBusy() || !elements.details.open) return;
      event.preventDefault?.();
      setStatus("当前操作完成前，请保持口述回答面板展开。", "error");
    }

    function keepOpenWhileBusy() {
      if (isBusy() && !elements.details.open) elements.details.open = true;
    }

    function showValidation(message, focus) {
      setStatus(message, "error");
      if (focus?.setAttribute) focus.setAttribute("aria-invalid", "true");
      focus?.focus?.({ preventScroll: false });
    }

    function focusFirstQuestion() {
      global.requestAnimationFrame?.(() => questionInputs()[0]?.focus?.({ preventScroll: false }));
    }

    function setStatus(copy, kind = "neutral") {
      elements.status.textContent = String(copy || "");
      elements.status.dataset.state = kind;
    }

    function setHostBusy(value) {
      hostBusy = Boolean(value);
      updateAccess();
    }

    function isBusy() {
      return state.loading || Boolean(state.mutation) || captureBusy;
    }

    function publishBusy() {
      const busy = isBusy();
      if (busy === lastPublishedBusy) return;
      lastPublishedBusy = busy;
      onBusyChange(busy);
    }

    function questionInputs() {
      return Array.from(elements.questionChoices.querySelectorAll(`input[name="${QUESTION_NAME}"]`));
    }

    function resolutionInputs() {
      return Array.from(elements.resolutionChoices.querySelectorAll(`input[name="${RESOLUTION_NAME}"]`));
    }

    function captureDuration() {
      return Math.max(0, Math.floor(Number(state.captureState?.durationMs || 0)));
    }

    function reset(resetOptions = {}) {
      abortRequest();
      session += 1;
      stopPreview();
      captureController.reset({ cleanup: true, silent: true });
      const demo = resetOptions.preserveDemo ? state.demo : Boolean(options.demo);
      state = emptyState(demo);
      hostBusy = false;
      captureBusy = false;
      clearDom();
      publishBusy();
    }

    function clearDom() {
      elements.details.hidden = true;
      elements.details.open = false;
      elements.sourceRegion.hidden = true;
      elements.sourceList.innerHTML = "";
      elements.sourceCount.textContent = "";
      elements.questionChoices.innerHTML = "";
      elements.status.textContent = "";
      elements.status.dataset.state = "neutral";
      elements.transcript.value = "";
      elements.acknowledge.checked = false;
      elements.segmentStep.hidden = true;
      elements.transcriptStep.hidden = true;
      elements.refreshButton.hidden = true;
    }

    function abortRequest() {
      requestController?.abort?.();
      requestController = null;
    }

    function captureSession() {
      return { session, eventId: state.eventId, pairKey: state.pairKey };
    }

    function isCurrent(value) {
      return !destroyed && value.session === session && value.eventId === state.eventId && value.pairKey === state.pairKey;
    }

    function ensureCurrent(value) {
      if (!isCurrent(value)) throw STALE;
    }

    async function requestJson(url, requestOptions, active) {
      const controller = typeof global.AbortController === "function" ? new global.AbortController() : null;
      requestController = controller;
      try {
        const response = await fetchImpl(url, { ...requestOptions, ...(controller ? { signal: controller.signal } : {}) });
        ensureCurrent(active);
        const text = await response.text();
        ensureCurrent(active);
        const payload = text ? parseJson(text) : {};
        if (!response.ok) {
          const error = new Error(boundedText(payload?.error || payload?.message, 400) || `请求失败（${response.status}）`);
          error.status = response.status;
          error.code = boundedText(payload?.code, 100);
          throw error;
        }
        return { payload, response };
      } finally {
        if (requestController === controller) requestController = null;
      }
    }

    function expectedError(error) {
      return error === STALE || error?.name === "AbortError";
    }

    function isConflict(error) {
      return [412, 428].includes(Number(error?.status)) || CONFLICT_CODES.has(String(error?.code || ""));
    }

    function destroy() {
      if (destroyed) return;
      reset();
      destroyed = true;
      captureController.destroy();
      listeners.forEach(({ target, type, handler }) => target.removeEventListener?.(type, handler));
      listeners.length = 0;
    }

    return Object.freeze({ syncPuzzle, refresh, reset, setHostBusy, hasUnsavedDraft, destroy });
  }

  function puzzleTarget(payload) {
    const source = payload && typeof payload === "object" ? payload : null;
    const eventId = safeId(source?.event?.id);
    const confirmed = source?.decision?.decision === "same_event" || Boolean(eventId);
    if (!confirmed || !eventId) return null;
    const pair = source?.puzzle?.pair || {};
    const pairIds = [safeId(pair.left?.id), safeId(pair.right?.id)].filter(Boolean).sort();
    const hasDateDifference = Array.isArray(source?.puzzle?.differs) && source.puzzle.differs.some((item) => item?.field === "date" && item?.verified === true);
    return { eventId, pairKey: pairIds.join("|"), hasDateDifference };
  }

  function normalizeWorkspace(value, responseEtag = "") {
    const source = value && typeof value === "object" ? value : {};
    const history = Array.isArray(source.history) ? source.history.map(normalizeAnswer).filter(Boolean) : [];
    return Object.freeze({
      event: source.event && typeof source.event === "object" ? { id: safeId(source.event.id), title: boundedText(source.event.title, 160) } : null,
      eligibility: normalizeEligibility(source.eligibility),
      question: normalizeQuestion(source.question),
      questionSetSha256: normalizeSha256(source.questionSetSha256),
      currentDraft: normalizeAnswer(source.currentDraft),
      currentConfirmed: normalizeAnswer(source.currentConfirmed),
      history,
      demo: source.demo === true,
      etag: normalizeEtag(responseEtag || source.etag)
    });
  }

  function normalizeEligibility(value) {
    const source = value && typeof value === "object" ? value : {};
    return Object.freeze({
      eligible: source.eligible === true,
      canAnswer: source.canAnswer !== false,
      reason: boundedText(source.reason, 120),
      calibrationState: boundedText(source.calibrationState, 80),
      needsReview: source.needsReview === true
    });
  }

  function normalizeQuestion(value) {
    if (!value || typeof value !== "object") return null;
    const id = safeId(value.id);
    const questionKey = safeQuestionKey(value.questionKey);
    const selectionKey = questionKey || id;
    const text = boundedText(value.text || value.question, 400);
    if (!selectionKey || !text) return null;
    const seen = new Set();
    const sources = [];
    for (const item of Array.isArray(value.sources) ? value.sources : []) {
      const source = normalizeQuestionSource(item);
      const key = `${source?.sourceKey}|${source?.intervalStart}|${source?.intervalEnd}`;
      if (!source || seen.has(key)) continue;
      seen.add(key);
      sources.push(source);
    }
    return Object.freeze({ id, questionKey, selectionKey, text, persisted: value.persisted === true, sources: sources.slice(0, 10) });
  }

  function normalizeQuestionSource(value) {
    const source = value && typeof value === "object" ? value : {};
    const intervalStart = normalizeDay(source.intervalStart);
    const intervalEnd = normalizeDay(source.intervalEnd || source.intervalStart);
    if (!intervalStart || !intervalEnd || intervalStart > intervalEnd) return null;
    return Object.freeze({
      sourceKey: boundedText(source.sourceKey, 160),
      sourceType: boundedText(source.sourceType, 80),
      precision: boundedText(source.precision, 40),
      intervalStart,
      intervalEnd,
      memoryId: safeId(source.memoryId),
      memoryTitle: boundedText(source.memoryTitle, 160)
    });
  }

  function normalizeAnswer(value) {
    if (!value || typeof value !== "object") return null;
    const id = safeId(value.id);
    const assetId = safeId(value.assetId || value.asset?.id);
    if (!id || !assetId) return null;
    const asset = value.asset && typeof value.asset === "object" ? Object.freeze({
      id: assetId,
      durationMs: boundedInteger(value.asset.durationMs, 0, 180_000, 0),
      mimeType: boundedText(value.asset.mimeType, 100),
      contentUrl: safeAudioUrl(value.asset.contentUrl || `/api/voice/assets/${encodeURIComponent(assetId)}/content`)
    }) : Object.freeze({ id: assetId, durationMs: 0, mimeType: "", contentUrl: `/api/voice/assets/${encodeURIComponent(assetId)}/content` });
    return Object.freeze({
      id,
      submissionId: safeId(value.submissionId),
      status: ["draft", "confirmed", "superseded", "withdrawn"].includes(value.status) ? value.status : "confirmed",
      assetId,
      asset,
      segmentStartMs: boundedInteger(value.segmentStartMs, 0, 180_000, 0),
      segmentEndMs: boundedInteger(value.segmentEndMs, 0, 180_000, asset.durationMs),
      transcriptText: boundedText(value.transcriptText || value.transcript, MAX_TRANSCRIPT_LENGTH),
      resolutionKind: ["day", "range", "uncertain"].includes(value.resolutionKind) ? value.resolutionKind : "uncertain",
      intervalStart: normalizeDay(value.intervalStart),
      intervalEnd: normalizeDay(value.intervalEnd),
      createdAt: normalizeTimestamp(value.createdAt),
      confirmedAt: normalizeTimestamp(value.confirmedAt),
      supersededAt: normalizeTimestamp(value.supersededAt),
      withdrawnAt: normalizeTimestamp(value.withdrawnAt)
    });
  }

  function formatInterval(source) {
    if (!source) return "未知日期";
    return source.intervalStart === source.intervalEnd ? source.intervalStart : `${source.intervalStart} 至 ${source.intervalEnd}`;
  }

  function describeResolution(answer) {
    if (answer.resolutionKind === "day") return `口述含义：${answer.intervalStart || "日期未保留"}`;
    if (answer.resolutionKind === "range") return `口述含义：${answer.intervalStart || "?"} 至 ${answer.intervalEnd || "?"}`;
    return "口述含义：仍不确定";
  }

  function formatPrecise(value) {
    const milliseconds = Math.max(0, Number(value || 0));
    const totalTenths = Math.floor(milliseconds / 100);
    const minutes = Math.floor(totalTenths / 600);
    const seconds = Math.floor((totalTenths % 600) / 10);
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${totalTenths % 10}`;
  }

  function formatTimestamp(value) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return "人工确认";
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} 人工确认`;
  }

  function formatAnswerTimestamp(answer) {
    if (answer.withdrawnAt) return `${formatTimestamp(answer.withdrawnAt).replace("人工确认", "撤回")}`;
    if (answer.supersededAt) return `${formatTimestamp(answer.supersededAt).replace("人工确认", "被新回答接替")}`;
    return formatTimestamp(answer.confirmedAt);
  }

  function normalizeDay(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(String(value || ""));
    if (!match) return "";
    const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
    return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== match[0] ? "" : match[0];
  }

  function normalizeTimestamp(value) {
    const text = String(value || "");
    return text && !Number.isNaN(new Date(text).getTime()) ? new Date(text).toISOString() : "";
  }

  function normalizeSha256(value) {
    const text = String(value || "").toLowerCase();
    return /^[a-f0-9]{64}$/u.test(text) ? text : "";
  }

  function normalizeEtag(value) {
    const text = String(value || "").trim();
    return /^(?:W\/)?"[^"\r\n]+"$/u.test(text) ? text : "";
  }

  function safeId(value) {
    const text = String(value || "").trim();
    return /^[a-zA-Z0-9_-]{1,160}$/u.test(text) ? text : "";
  }

  function safeQuestionKey(value) {
    const text = String(value || "").trim();
    return /^[a-zA-Z0-9:_-]{1,200}$/u.test(text) ? text : "";
  }

  function safeAudioUrl(value) {
    const text = String(value || "").trim();
    return /^(?:\/|blob:)/iu.test(text) ? text : "";
  }

  function boundedText(value, maximum) {
    return String(value || "").trim().slice(0, maximum);
  }

  function boundedInteger(value, minimum, maximum, fallback) {
    const number = Math.floor(Number(value));
    return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
  }

  function createSubmissionId() {
    if (global.crypto?.randomUUID) return `oral-${global.crypto.randomUUID()}`;
    return `oral-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function parseJson(value) {
    try { return JSON.parse(value); } catch { return {}; }
  }

  function errorMessage(error) {
    return boundedText(error?.message || error || "口述史处理失败", 400);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function emptyState(demo = false) {
    return {
      eventId: "",
      pairKey: "",
      hostSessionKey: undefined,
      demo,
      localHasDateDifference: false,
      eligible: false,
      workspace: null,
      etag: "",
      questionSetSha256: "",
      selectedQuestionKey: "",
      captureState: null,
      captureAssetId: "",
      segmentStartMs: 0,
      segmentEndMs: 0,
      transcriptText: "",
      resolutionChoice: "",
      intervalStart: "",
      intervalEnd: "",
      acknowledged: false,
      submissionId: "",
      loading: false,
      loadError: "",
      mutation: "",
      conflict: false
    };
  }

  global.TimeIsleOralHistories = Object.freeze({
    createController,
    normalizeWorkspace,
    puzzleTarget,
    formatPrecise
  });
})(typeof window !== "undefined" ? window : globalThis);
