(function initializeTimeIsleVoice(global) {
  "use strict";

  const DEFAULT_POLICY = Object.freeze({
    maxBytes: 12 * 1024 * 1024,
    maxDurationMs: 180_000,
    maxVoicesPerMemory: 3,
    acceptedMimeTypes: ["audio/webm", "audio/mp4"]
  });

  const DEFAULT_IDS = Object.freeze({
    voiceRecordButton: "voiceRecordButton",
    voiceFileInput: "voiceFileInput",
    voiceFileLabel: "voiceFileLabel",
    voiceFallbackHelp: "voiceFallbackHelp",
    voiceRecording: "voiceRecording",
    voiceRecordingTimer: "voiceRecordingTimer",
    voiceStopButton: "voiceStopButton",
    voiceCancelButton: "voiceCancelButton",
    voiceList: "voiceList",
    voiceStatus: "voiceStatus"
  });

  function createController(config = {}) {
    const documentRef = config.document || global.document;
    if (!documentRef) throw new Error("TimeIsleVoice 需要浏览器 DOM。");
    const fetchImpl = config.fetch || (typeof global.fetch === "function" ? global.fetch.bind(global) : null);
    if (!fetchImpl) throw new Error("TimeIsleVoice 需要 fetch 支持。");

    const ids = { ...DEFAULT_IDS, ...(config.ids || {}) };
    const suppliedElements = config.elements || {};
    const elements = Object.fromEntries(Object.entries(ids).map(([key, id]) => [
      key,
      suppliedElements[key] || documentRef.getElementById(id)
    ]));
    const missing = Object.entries(elements).filter(([, element]) => !element).map(([key]) => ids[key]);
    if (missing.length) throw new Error(`声音控制器缺少 DOM：${missing.join("、")}`);

    const navigatorRef = config.navigator || global.navigator || {};
    const MediaRecorderImpl = config.MediaRecorder || global.MediaRecorder;
    let policy = normalizePolicy(config.policy);
    let demo = Boolean(config.demo || config.interviewDemo);
    let memoryId = "";
    let items = [];
    let session = 0;
    let mutationBusy = false;
    let loadError = null;
    let loadPromise = Promise.resolve();
    let recording = null;
    let permissionRequest = null;
    const removedAssetIds = new Set();
    const listeners = [];

    bindEvents();
    configureDom();
    render();
    setStatus(demo ? "公开 Demo 不接收私人声音；录音、上传和文字稿保存均已关闭。" : "", "notice");

    function bindEvents() {
      listen(elements.voiceRecordButton, "click", startRecording);
      listen(elements.voiceStopButton, "click", () => stopRecording(false));
      listen(elements.voiceCancelButton, "click", () => stopRecording(true));
      listen(elements.voiceFileInput, "change", handleFileInput);
      listen(elements.voiceList, "click", handleListClick);
      listen(elements.voiceList, "input", handleListInput);
      listen(global, "pagehide", handlePageHide);
    }

    function listen(target, type, handler, options) {
      if (!target?.addEventListener) return;
      target.addEventListener(type, handler, options);
      listeners.push({ target, type, handler, options });
    }

    function configureDom() {
      elements.voiceFileInput.multiple = true;
      elements.voiceFileInput.accept = "audio/webm,audio/mp4,.webm,.m4a,.mp4";
      const describedBy = new Set(String(elements.voiceFileInput.getAttribute("aria-describedby") || "").split(/\s+/u).filter(Boolean));
      describedBy.add(ids.voiceFallbackHelp);
      describedBy.add(ids.voiceStatus);
      elements.voiceFileInput.setAttribute("aria-describedby", [...describedBy].join(" "));
    }

    function canRecord() {
      const secure = config.isSecureContext === undefined ? global.isSecureContext === true : Boolean(config.isSecureContext);
      return secure && typeof navigatorRef.mediaDevices?.getUserMedia === "function" && Boolean(MediaRecorderImpl) && Boolean(preferredRecorderMime(MediaRecorderImpl));
    }

    async function handleFileInput(event) {
      const files = [...(event.target.files || [])];
      event.target.value = "";
      if (!files.length) return;
      try {
        await addFiles(files);
      } catch (error) {
        setStatus(errorMessage(error), "error");
      }
    }

    async function addFiles(files) {
      assertMutable();
      const available = Math.max(0, policy.maxVoicesPerMemory - items.length);
      if (!available) throw new Error(`每段记忆最多保存 ${policy.maxVoicesPerMemory} 段声音。`);
      const fingerprints = new Set(items.map((item) => item.fingerprint).filter(Boolean));
      const accepted = [];
      const rejected = [];

      for (const file of files) {
        if (accepted.length >= available) {
          rejected.push(`${safeFileName(file)}：超过 ${policy.maxVoicesPerMemory} 段上限`);
          continue;
        }
        const validationError = validateFile(file, policy);
        const fingerprint = fileFingerprint(file);
        if (validationError) {
          rejected.push(`${safeFileName(file)}：${validationError}`);
          continue;
        }
        if (fingerprints.has(fingerprint)) {
          rejected.push(`${safeFileName(file)}：已在当前声音列表中`);
          continue;
        }
        fingerprints.add(fingerprint);
        const item = createLocalItem(file, fingerprint);
        items.push(item);
        accepted.push(item);
      }

      render();
      notifyChange();
      accepted.forEach((item) => uploadItem(item));
      if (accepted.length) {
        setStatus(`已加入 ${accepted.length} 段声音，正在安全检查并保存。${rejected.length ? `另有 ${rejected.length} 段未加入。` : ""}`, rejected.length ? "notice" : "loading");
      } else if (rejected.length) {
        setStatus(rejected.join("；"), "error");
      }
      return { accepted: accepted.length, rejected };
    }

    function createLocalItem(file, fingerprint) {
      const previewUrl = typeof global.URL?.createObjectURL === "function" ? global.URL.createObjectURL(file) : "";
      return {
        localId: `voice-local-${randomId()}`,
        assetId: "",
        asset: null,
        file,
        fingerprint,
        originalName: safeFileName(file),
        label: "",
        previewUrl,
        contentUrl: previewUrl,
        status: "uploading",
        error: "",
        existing: false,
        itemSession: session,
        abortController: null,
        uploadPromise: null,
        transcript: { text: "", status: "", existed: false, dirty: false, delete: false }
      };
    }

    function uploadItem(item) {
      const abortController = new AbortController();
      item.abortController = abortController;
      const itemSession = item.itemSession;
      const upload = request(`/api/voice/uploads?filename=${encodeURIComponent(item.originalName)}`, {
        method: "POST",
        headers: { "Content-Type": canonicalMime(item.file?.type, item.originalName) },
        body: item.file,
        signal: abortController.signal
      }).then((payload) => {
        if (!isActiveItem(item, itemSession)) return null;
        item.asset = normalizeAsset(payload.asset);
        item.assetId = item.asset.id;
        item.contentUrl = safeAudioUrl(item.asset.contentUrl) || item.previewUrl;
        item.status = "ready";
        item.error = "";
        render();
        announceAggregateStatus();
        notifyChange();
        return item.asset;
      }).catch((error) => {
        if (!isActiveItem(item, itemSession) || error?.name === "AbortError") return null;
        item.status = "error";
        item.error = errorMessage(error);
        render();
        announceAggregateStatus();
        notifyChange();
        return null;
      });
      item.uploadPromise = upload;
      return upload;
    }

    async function startRecording() {
      if (permissionRequest) { cancelPermissionRequest(true); return; }
      if (demo || recording || mutationBusy || items.length >= policy.maxVoicesPerMemory) return;
      if (!canRecord()) {
        setStatus("当前环境不能安全录音，请改为选择已有音频。", "error");
        return;
      }
      const requestSession = session, token = Symbol("voice-permission"), pending = { token, hintTimer: null };
      permissionRequest = pending; render();
      setStatus("正在请求麦克风权限…", "loading");
      pending.hintTimer = global.setTimeout?.(() => {
        if (permissionRequest?.token !== token || requestSession !== session) return;
        setStatus("仍在等待麦克风授权；请查看浏览器地址栏附近的权限提示，也可以拒绝后改用“选择音频”。", "notice");
      }, 6000);
      let stream, startedRecording = null;
      try {
        stream = await navigatorRef.mediaDevices.getUserMedia({ audio: true, video: false });
        if (permissionRequest?.token !== token || requestSession !== session || demo || mutationBusy) { stopTracks(stream); return; }
        const mimeType = preferredRecorderMime(MediaRecorderImpl);
        const recorder = new MediaRecorderImpl(stream, { mimeType });
        const recordSession = session;
        const chunks = [];
        recording = {
          recorder,
          stream,
          chunks,
          mimeType,
          startedAt: Date.now(),
          cancelled: false,
          recordSession,
          timer: null,
          timeout: null
        };
        startedRecording = recording;
        recorder.addEventListener("dataavailable", (event) => {
          if (event.data?.size) chunks.push(event.data);
        });
        recorder.addEventListener("error", (event) => {
          const message = event.error?.message || "录音未能完成。";
          stopRecording(true);
          setStatus(message, "error");
        });
        recorder.addEventListener("stop", finalizeRecording, { once: true });
        recorder.start(500);
        recording.timer = global.setInterval?.(updateRecordingTimer, 250);
        recording.timeout = global.setTimeout?.(() => stopRecording(false, true), Math.min(179_000, policy.maxDurationMs - 1_000));
        updateRecordingTimer();
        render();
        setStatus("正在录音；完成后可先试听，再随展品一起保存。", "loading");
      } catch (error) {
        stopTracks(stream);
        if (recording === startedRecording) recording = null;
        if (permissionRequest?.token === token && requestSession === session) setStatus(recordingPermissionMessage(error), "error");
      } finally {
        if (pending.hintTimer) global.clearTimeout?.(pending.hintTimer);
        if (permissionRequest?.token === token) {
          permissionRequest = null;
          render();
        }
      }
    }

    function stopRecording(cancelled = false, reachedLimit = false) {
      if (!recording) return;
      recording.cancelled = Boolean(cancelled);
      recording.reachedLimit = Boolean(reachedLimit);
      clearRecordingTimers(recording);
      stopTracks(recording.stream);
      if (recording.recorder.state !== "inactive") recording.recorder.stop();
      else finalizeRecording();
    }

    function finalizeRecording() {
      const finished = recording;
      if (!finished) return;
      recording = null;
      clearRecordingTimers(finished);
      stopTracks(finished.stream);
      render();
      if (finished.recordSession !== session) return;
      if (finished.cancelled) {
        setStatus("已取消本次录音，没有留下文件。", "notice");
        return;
      }
      const mimeType = canonicalMime(finished.recorder.mimeType || finished.mimeType, "recording.webm");
      const blob = new Blob(finished.chunks, { type: mimeType });
      if (!blob.size) {
        setStatus("这次录音没有可保存的声音，请重试。", "error");
        return;
      }
      const extension = mimeType === "audio/mp4" ? "m4a" : "webm";
      const fileName = `记忆录音-${recordingStamp(new Date())}.${extension}`;
      const file = createNamedBlob(blob, fileName, mimeType);
      addFiles([file]).then(() => {
        if (finished.reachedLimit) setStatus("已到 2 分 59 秒，录音已自动停止并开始保存。", "notice");
      }).catch((error) => setStatus(errorMessage(error), "error"));
    }

    function updateRecordingTimer() {
      if (!recording) return;
      const elapsed = Math.min(179_000, Math.max(0, Date.now() - recording.startedAt));
      elements.voiceRecordingTimer.textContent = formatDuration(elapsed);
    }

    function handleListInput(event) {
      const target = event.target;
      const item = findItem(target.dataset.voiceId);
      if (!item || demo) return;
      if (target.matches("[data-voice-label]")) item.label = target.value.slice(0, 120);
      if (target.matches("[data-voice-transcript]")) {
        item.transcript.text = target.value.slice(0, 8000);
        item.transcript.delete = false;
      }
      notifyChange();
    }

    function handleListClick(event) {
      const button = event.target.closest("[data-voice-action]");
      if (!button || !elements.voiceList.contains(button)) return;
      const item = findItem(button.dataset.voiceId);
      if (!item) return;
      const action = button.dataset.voiceAction;
      if (action === "remove") removeItem(item);
      if (action === "retry" && item.file) retryUpload(item);
      if (action === "draft") stageTranscript(item, false);
      if (action === "confirm") stageTranscript(item, true);
      if (action === "delete-transcript") stageTranscriptDeletion(item);
    }

    function stageTranscript(item, confirmed) {
      if (demo || mutationBusy) return;
      const text = String(item.transcript.text || "").trim();
      if (!text) {
        setStatus("请先根据录音填写并核对文字稿。", "error");
        return;
      }
      item.transcript.text = text;
      item.transcript.status = confirmed ? "confirmed" : "draft";
      item.transcript.dirty = true;
      item.transcript.delete = false;
      render();
      notifyChange();
      setStatus(confirmed ? "已标记为人工确认；保存展品时会写入馆藏。" : "文字稿草稿已暂存；保存展品时会写入馆藏。", "success");
    }

    function stageTranscriptDeletion(item) {
      if (demo || mutationBusy) return;
      item.transcript = { ...item.transcript, text: "", status: "", dirty: true, delete: true };
      render();
      notifyChange();
      setStatus("文字稿已标记移除；声音仍会保留。", "notice");
    }

    function retryUpload(item) {
      if (demo || item.status !== "error" || !item.file) return;
      item.status = "uploading";
      item.error = "";
      render();
      uploadItem(item);
    }

    function removeItem(item) {
      if (demo || mutationBusy) return;
      item.abortController?.abort();
      revokePreview(item);
      items = items.filter((candidate) => candidate !== item);
      if (item.assetId) {
        if (item.existing) removedAssetIds.add(item.assetId);
        else cleanupOrphanAsset(item.assetId);
      }
      render();
      notifyChange();
      setStatus(items.length ? `当前保留 ${items.length} 段声音。` : "已移除声音。", "notice");
    }

    function loadMemory(memory = {}) {
      clearDraft({ discardUnattached: true });
      memoryId = String(memory.id || "");
      items = normalizeVoiceList(memory.voices).map(createExistingItem);
      removedAssetIds.clear();
      loadError = null;
      render();
      if (!memoryId) {
        loadPromise = Promise.resolve();
        return loadPromise;
      }
      const loadSession = session;
      loadPromise = request(`/api/memories/${encodeURIComponent(memoryId)}/voices`).then((payload) => {
        if (loadSession !== session) return null;
        items.forEach(revokePreview);
        items = normalizeVoiceList(payload.voices).map(createExistingItem);
        policy = normalizePolicy(payload.policy || policy);
        configureDom();
        render();
        setStatus(demo && items.length ? "公开 Demo 中的示例声音仅供播放。" : "", "notice");
        notifyChange();
        return payload;
      }).catch((error) => {
        if (loadSession !== session) return null;
        loadError = error;
        setStatus(`声音附件读取失败：${errorMessage(error)}`, "error");
        return null;
      });
      return loadPromise;
    }

    function createExistingItem(voice, index) {
      const asset = normalizeAsset(voice.asset || { id: voice.assetId });
      const transcript = normalizeTranscript(voice.transcript);
      return {
        localId: `voice-asset-${asset.id || randomId()}`,
        assetId: asset.id,
        asset,
        file: null,
        fingerprint: "",
        originalName: asset.originalName || `记忆声音-${index + 1}`,
        label: String(voice.label || ""),
        previewUrl: "",
        contentUrl: safeAudioUrl(asset.contentUrl),
        status: "ready",
        error: "",
        existing: true,
        itemSession: session,
        abortController: null,
        uploadPromise: null,
        transcript
      };
    }

    async function waitForReady() {
      await loadPromise;
      if (loadError) throw new Error(`声音附件未能读取：${errorMessage(loadError)}`);
      if (permissionRequest) throw new Error("仍在等待麦克风授权，请先完成或拒绝权限请求。");
      if (recording) throw new Error("仍在录音，请先停止或取消本次录音。");
      await Promise.allSettled(items.map((item) => item.uploadPromise).filter(Boolean));
      const failed = items.filter((item) => item.status === "error");
      const pending = items.filter((item) => !["ready", "error"].includes(item.status));
      if (pending.length) throw new Error("仍有声音正在处理，请稍后再保存。");
      if (failed.length) throw new Error(`有 ${failed.length} 段声音保存失败，请重试或移除后再保存。`);
      if (items.some((item) => !item.assetId)) throw new Error("有声音尚未取得可保存的附件 ID。");
      return true;
    }

    async function saveToMemory(targetMemoryId = memoryId) {
      assertMutable();
      const normalizedId = String(targetMemoryId || "").trim();
      if (!normalizedId) throw new Error("保存声音前需要先取得展品 ID。");
      setMutation(true);
      try {
        await waitForReady();
        setStatus("正在把声音与展品一起保存…", "loading");
        const association = await request(`/api/memories/${encodeURIComponent(normalizedId)}/voices`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: items.map((item) => ({ assetId: item.assetId, label: String(item.label || "").trim().slice(0, 120) })) })
        });
        memoryId = normalizedId;
        await saveDirtyTranscripts(normalizedId);
        const latest = await request(`/api/memories/${encodeURIComponent(normalizedId)}/voices`);
        items.forEach(revokePreview);
        items = normalizeVoiceList(latest.voices || association.voices).map(createExistingItem);
        const removed = [...removedAssetIds];
        removedAssetIds.clear();
        await Promise.allSettled(removed.map(cleanupOrphanAsset));
        render();
        setStatus(items.length ? `已保存 ${items.length} 段声音。` : "展品已更新为无声音。", "success");
        notifyChange();
        return { ...association, voices: latest.voices || association.voices || [] };
      } catch (error) {
        setStatus(errorMessage(error), "error");
        throw error;
      } finally {
        setMutation(false);
      }
    }

    async function saveDirtyTranscripts(targetMemoryId) {
      for (const item of items.filter((candidate) => candidate.transcript.dirty)) {
        const endpoint = `/api/memories/${encodeURIComponent(targetMemoryId)}/voices/${encodeURIComponent(item.assetId)}/transcript`;
        if (item.transcript.delete) {
          if (item.transcript.existed) {
            try {
              await request(endpoint, { method: "DELETE" });
            } catch (error) {
              if (error.status !== 404) throw error;
            }
          }
          continue;
        }
        const text = String(item.transcript.text || "").trim();
        if (!text || !["draft", "confirmed"].includes(item.transcript.status)) continue;
        await request(endpoint, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, confirm: item.transcript.status === "confirmed" })
        });
      }
    }

    function reset(options = {}) {
      clearDraft({ discardUnattached: options.discardUnattached !== false });
      render();
      if (!options.silent) setStatus(demo ? "公开 Demo 不接收私人声音；录音、上传和文字稿保存均已关闭。" : "", "notice");
      notifyChange();
    }

    function clearDraft(options = {}) {
      session += 1;
      cancelPermissionRequest();
      stopRecording(true);
      const previous = items;
      items = [];
      memoryId = "";
      loadError = null;
      loadPromise = Promise.resolve();
      previous.forEach((item) => {
        item.abortController?.abort();
        revokePreview(item);
        if (options.discardUnattached && !item.existing && item.assetId) cleanupOrphanAsset(item.assetId);
      });
      removedAssetIds.clear();
      elements.voiceFileInput.value = "";
    }

    function setDemo(value) {
      demo = Boolean(value);
      if (demo) {
        cancelPermissionRequest();
        stopRecording(true);
      }
      render();
      setStatus(demo ? "公开 Demo 不接收私人声音；录音、上传和文字稿保存均已关闭。" : "", "notice");
      return demo;
    }

    function setMutation(value) {
      mutationBusy = Boolean(value);
      render();
      config.onBusyChange?.(mutationBusy);
    }

    function render() {
      const recordAvailable = !demo && canRecord();
      const atLimit = items.length >= policy.maxVoicesPerMemory;
      elements.voiceRecordButton.hidden = !recordAvailable;
      elements.voiceRecordButton.disabled = mutationBusy || Boolean(recording) || atLimit;
      elements.voiceRecordButton.textContent = permissionRequest ? "取消授权等待" : "开始录音";
      elements.voiceRecordButton.setAttribute("aria-busy", String(Boolean(permissionRequest)));
      elements.voiceFileInput.disabled = demo || mutationBusy || Boolean(recording) || Boolean(permissionRequest) || atLimit;
      elements.voiceFileLabel.classList.toggle("is-disabled", elements.voiceFileInput.disabled);
      elements.voiceFileLabel.setAttribute("aria-disabled", String(elements.voiceFileInput.disabled));
      elements.voiceFallbackHelp.textContent = demo
        ? "公开 Demo 仅播放示例声音，不会请求麦克风权限，也不会上传文件。"
        : recordAvailable
          ? `支持 WebM/Opus 或 M4A/AAC，单段不超过 ${formatBytes(policy.maxBytes)}；声音只保存在本地。`
          : "当前环境不支持安全录音；仍可选择 WebM/Opus 或 M4A/AAC 音频文件。";
      elements.voiceRecording.hidden = !recording;
      elements.voiceStopButton.disabled = !recording;
      elements.voiceCancelButton.disabled = !recording;
      elements.voiceList.innerHTML = items.map(renderListItem).join("");
    }

    function renderListItem(item, index) {
      const title = item.label || item.originalName || `第 ${index + 1} 段声音`;
      const audioUrl = safeAudioUrl(item.contentUrl || item.asset?.contentUrl);
      const stateText = item.status === "uploading" ? "正在检查" : item.status === "error" ? "需要重试" : "已就绪";
      const transcriptStatus = item.transcript.delete ? "文字稿将移除"
        : item.transcript.status === "confirmed" ? "已人工确认"
          : item.transcript.status === "draft" ? "草稿，不在普通详情展示" : "尚未填写";
      return `<li class="voice-item${item.status === "error" ? " is-error" : ""}">
        <div class="voice-item-main">
          <audio controls preload="metadata" src="${escapeAttribute(audioUrl)}" aria-label="试听${escapeAttribute(title)}"></audio>
          <label>声音标签<input type="text" maxlength="120" value="${escapeAttribute(item.label)}" data-voice-label data-voice-id="${escapeAttribute(item.localId)}" placeholder="例如：外婆讲述" ${demo || mutationBusy ? "disabled" : ""} /></label>
          <button type="button" class="button text-button compact" data-voice-action="remove" data-voice-id="${escapeAttribute(item.localId)}" ${demo || mutationBusy ? "disabled" : ""}>移除</button>
        </div>
        <div class="voice-item-meta"><span>${escapeHtml(formatDuration(item.asset?.durationMs))}</span><span>${escapeHtml(stateText)}</span></div>
        ${item.status === "error" ? `<div class="voice-item-error"><span>${escapeHtml(item.error)}</span><button type="button" data-voice-action="retry" data-voice-id="${escapeAttribute(item.localId)}">重试</button></div>` : ""}
        <details class="voice-transcript">
          <summary>文字稿 <small>${escapeHtml(transcriptStatus)}</small></summary>
          <div class="voice-transcript-body">
            <label>根据你听到的内容手动核对<textarea maxlength="8000" data-voice-transcript data-voice-id="${escapeAttribute(item.localId)}" placeholder="这里不会自动生成文字；请亲自听过后填写。" ${demo || mutationBusy ? "disabled" : ""}>${escapeHtml(item.transcript.text)}</textarea></label>
            <p>“保存草稿”不会出现在普通详情；只有“人工确认”后的文字稿会展示并参与检索。</p>
            <div class="voice-transcript-actions">
              <button type="button" class="button secondary compact" data-voice-action="draft" data-voice-id="${escapeAttribute(item.localId)}" ${demo || mutationBusy || item.status !== "ready" ? "disabled" : ""}>保存草稿</button>
              <button type="button" class="button primary compact" data-voice-action="confirm" data-voice-id="${escapeAttribute(item.localId)}" ${demo || mutationBusy || item.status !== "ready" ? "disabled" : ""}>人工确认</button>
              ${item.transcript.existed && !item.transcript.delete ? `<button type="button" class="button text-button compact" data-voice-action="delete-transcript" data-voice-id="${escapeAttribute(item.localId)}" ${demo || mutationBusy ? "disabled" : ""}>移除文字稿</button>` : ""}
            </div>
          </div>
        </details>
      </li>`;
    }

    function getState() {
      return {
        memoryId,
        count: items.length,
        demo,
        recording: Boolean(recording),
        awaitingPermission: Boolean(permissionRequest),
        busy: mutationBusy || Boolean(permissionRequest) || Boolean(recording) || items.some((item) => item.status === "uploading"),
        ready: !loadError && !permissionRequest && !recording && items.every((item) => item.status === "ready"),
        hasErrors: Boolean(loadError) || items.some((item) => item.status === "error"),
        items: items.map((item, index) => ({
          assetId: item.assetId,
          position: index,
          label: item.label,
          status: item.status,
          transcriptStatus: item.transcript.status,
          transcriptDirty: item.transcript.dirty
        }))
      };
    }

    function handlePageHide() {
      cancelPermissionRequest();
      stopRecording(true);
      items.forEach((item) => {
        item.abortController?.abort();
        revokePreview(item);
      });
    }

    function destroy() {
      handlePageHide();
      listeners.forEach(({ target, type, handler, options }) => target.removeEventListener?.(type, handler, options));
      listeners.length = 0;
    }

    function cancelPermissionRequest(announce = false) {
      if (permissionRequest?.hintTimer) global.clearTimeout?.(permissionRequest.hintTimer);
      const cancelled = Boolean(permissionRequest);
      permissionRequest = null;
      if (cancelled && announce) {
        render();
        setStatus("已取消等待麦克风授权；没有开始录音。", "notice");
      }
      return cancelled;
    }

    function announceAggregateStatus() {
      const ready = items.filter((item) => item.status === "ready").length;
      const failed = items.filter((item) => item.status === "error").length;
      const pending = items.length - ready - failed;
      if (pending) return setStatus(`已准备 ${ready} 段，另有 ${pending} 段正在处理。`, "loading");
      if (failed) return setStatus(`已准备 ${ready} 段，${failed} 段需要重试。`, "error");
      setStatus(`已准备 ${ready} 段声音；保存展品后会正式进入馆藏。`, "success");
    }

    function setStatus(message, type = "notice") {
      elements.voiceStatus.textContent = message || "";
      elements.voiceStatus.classList.toggle("is-error", type === "error");
      elements.voiceStatus.classList.toggle("is-success", type === "success");
      elements.voiceStatus.classList.toggle("is-loading", type === "loading");
      config.onStatus?.({ message: message || "", type });
    }

    function notifyChange() {
      config.onChange?.(getState());
    }

    function findItem(localId) {
      return items.find((item) => item.localId === String(localId || ""));
    }

    function isActiveItem(item, itemSession) {
      return itemSession === session && items.includes(item);
    }

    async function cleanupOrphanAsset(assetId) {
      if (!assetId || demo) return;
      try {
        await request(`/api/voice/assets/${encodeURIComponent(assetId)}`, { method: "DELETE" });
      } catch {
        // Shared or already collected assets must remain untouched.
      }
    }

    function revokePreview(item) {
      if (!item?.previewUrl) return;
      global.URL?.revokeObjectURL?.(item.previewUrl);
      if (item.contentUrl === item.previewUrl) item.contentUrl = "";
      item.previewUrl = "";
    }

    async function request(url, options = {}) {
      const response = await fetchImpl(url, options);
      const contentType = response.headers?.get?.("content-type") || "";
      const payload = contentType.includes("application/json") ? await response.json() : await response.text();
      if (!response.ok) {
        const error = new Error(typeof payload === "object" ? payload.error : payload || `请求失败（${response.status}）`);
        error.status = response.status;
        error.code = typeof payload === "object" ? payload.code : "";
        error.payload = payload;
        throw error;
      }
      return payload;
    }

    function assertMutable() {
      if (demo) throw new Error("公开 Demo 不保存私人声音。");
      if (mutationBusy) throw new Error("声音附件正在保存，请稍候。");
    }

    return Object.freeze({
      addFiles,
      loadMemory,
      waitForReady,
      saveToMemory,
      reset,
      setDemo,
      getState,
      destroy
    });
  }

  function renderCardSummary(memory = {}, escapeHtmlImpl = escapeHtml) {
    const escape = typeof escapeHtmlImpl === "function" ? escapeHtmlImpl : escapeHtml;
    const count = voiceCount(memory);
    return count ? `<span class="memory-voice-count">${escape(String(count))} 段声音</span>` : "";
  }

  function renderDetailVoices(memory = {}, escapeHtmlImpl = escapeHtml) {
    const escape = typeof escapeHtmlImpl === "function" ? escapeHtmlImpl : escapeHtml;
    const voices = normalizeVoiceList(memory.voices);
    if (!voices.length) return "";
    return `<section class="memory-voice-detail" aria-label="声音记忆，共 ${voices.length} 段">
      <div class="memory-voice-heading"><h3>声音记忆</h3><span>${voices.length} 段</span></div>
      <div class="memory-voice-detail-list">${voices.map((voice, index) => {
        const asset = normalizeAsset(voice.asset || { id: voice.assetId });
        const label = String(voice.label || asset.originalName || `第 ${index + 1} 段声音`);
        const url = safeAudioUrl(asset.contentUrl);
        const confirmedText = transcriptConfirmed(voice.transcript) ? String(voice.transcript.text || "").trim() : "";
        return `<article class="memory-voice-detail-item">
          <div><strong>${escape(label)}</strong><span>${escape(formatDuration(asset.durationMs))}</span></div>
          ${url ? `<audio controls preload="metadata" src="${escape(url)}" aria-label="播放${escape(label)}"></audio>` : '<p class="voice-unavailable">声音文件暂时无法播放。</p>'}
          ${confirmedText ? `<details class="confirmed-transcript"><summary>已人工确认的文字稿</summary><p>${escape(confirmedText)}</p></details>` : ""}
        </article>`;
      }).join("")}</div>
    </section>`;
  }

  function normalizeVoiceList(value) {
    return (Array.isArray(value) ? value : []).filter((item) => item && typeof item === "object")
      .sort((left, right) => Number(left.position || 0) - Number(right.position || 0));
  }

  function normalizeAsset(value = {}) {
    const id = String(value.id || value.assetId || "");
    return {
      id,
      originalName: String(value.originalName || ""),
      mimeType: String(value.mimeType || ""),
      codec: String(value.codec || ""),
      byteSize: Number(value.byteSize || 0),
      durationMs: Number(value.durationMs || 0),
      contentUrl: safeAudioUrl(value.contentUrl || (id ? `/api/voice/assets/${encodeURIComponent(id)}/content` : ""))
    };
  }

  function normalizeTranscript(value) {
    if (!value || typeof value !== "object") return { text: "", status: "", existed: false, dirty: false, delete: false };
    const status = transcriptConfirmed(value) ? "confirmed" : "draft";
    return {
      text: String(value.text || ""),
      status,
      existed: true,
      dirty: false,
      delete: false
    };
  }

  function transcriptConfirmed(value) {
    return value?.confirmed === true || value?.status === "confirmed";
  }

  function voiceCount(memory = {}) {
    const explicit = Number(memory.voiceSummary?.count ?? memory.voiceCount);
    if (Number.isSafeInteger(explicit) && explicit > 0) return explicit;
    return normalizeVoiceList(memory.voices).length;
  }

  function normalizePolicy(input = {}) {
    const positiveInteger = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0 ? Math.floor(Number(value)) : fallback;
    const accepted = Array.isArray(input.acceptedMimeTypes) ? input.acceptedMimeTypes.filter((type) => DEFAULT_POLICY.acceptedMimeTypes.includes(type)) : [];
    return Object.freeze({
      maxBytes: positiveInteger(input.maxBytes, DEFAULT_POLICY.maxBytes),
      maxDurationMs: Math.min(180_000, positiveInteger(input.maxDurationMs, DEFAULT_POLICY.maxDurationMs)),
      maxVoicesPerMemory: Math.min(3, positiveInteger(input.maxVoicesPerMemory, DEFAULT_POLICY.maxVoicesPerMemory)),
      acceptedMimeTypes: accepted.length ? [...accepted] : [...DEFAULT_POLICY.acceptedMimeTypes]
    });
  }

  function preferredRecorderMime(MediaRecorderImpl) {
    const candidates = ["audio/webm;codecs=opus", "audio/mp4;codecs=mp4a.40.2", "audio/mp4"];
    if (typeof MediaRecorderImpl?.isTypeSupported !== "function") return "";
    return candidates.find((candidate) => MediaRecorderImpl.isTypeSupported(candidate)) || "";
  }

  function canonicalMime(value, fileName = "") {
    const mime = String(value || "").split(";", 1)[0].trim().toLowerCase();
    if (mime === "audio/webm") return "audio/webm";
    if (["audio/mp4", "audio/m4a", "audio/x-m4a"].includes(mime)) return "audio/mp4";
    return /\.webm$/iu.test(String(fileName)) ? "audio/webm" : "audio/mp4";
  }

  function validateFile(file, policy) {
    if (!file || typeof file.size !== "number") return "不是可读取的声音文件";
    if (!file.size) return "文件为空";
    if (file.size > policy.maxBytes) return `超过 ${formatBytes(policy.maxBytes)} 上限`;
    const mime = String(file.type || "").split(";", 1)[0].toLowerCase();
    const extensionAllowed = /\.(?:webm|m4a|mp4)$/iu.test(String(file.name || ""));
    if (mime && !["audio/webm", "audio/mp4", "audio/m4a", "audio/x-m4a"].includes(mime)) return "仅支持 WebM/Opus 或 M4A/AAC";
    if (!mime && !extensionAllowed) return "无法识别声音格式";
    return "";
  }

  function createNamedBlob(blob, name, mimeType) {
    if (typeof global.File === "function") return new global.File([blob], name, { type: mimeType, lastModified: Date.now() });
    try { Object.defineProperty(blob, "name", { value: name }); } catch { /* Blob still uploads with an explicit query filename. */ }
    return blob;
  }

  function stopTracks(stream) {
    stream?.getTracks?.().forEach((track) => {
      try { track.stop(); } catch { /* Already stopped. */ }
    });
  }

  function clearRecordingTimers(value) {
    if (value?.timer) global.clearInterval?.(value.timer);
    if (value?.timeout) global.clearTimeout?.(value.timeout);
  }

  function fileFingerprint(file) {
    return `${file.name || ""}|${file.size || 0}|${file.lastModified || 0}`;
  }

  function safeFileName(file) {
    return String(file?.name || "记忆声音").replace(/[\\/\u0000-\u001f\u007f]/gu, "-").slice(0, 160) || "记忆声音";
  }

  function safeAudioUrl(value) {
    const url = String(value || "").trim();
    return /^(?:\/|blob:)/iu.test(url) ? url : "";
  }

  function formatDuration(value) {
    const milliseconds = Math.max(0, Number(value || 0));
    const totalSeconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MiB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KiB`;
    return `${bytes} B`;
  }

  function recordingStamp(date) {
    const pad = (number) => String(number).padStart(2, "0");
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  }

  function recordingPermissionMessage(error) {
    if (["NotAllowedError", "SecurityError"].includes(error?.name)) return "未获得麦克风权限；你仍可选择已有音频。";
    if (error?.name === "NotFoundError") return "没有找到可用麦克风；你仍可选择已有音频。";
    return errorMessage(error);
  }

  function errorMessage(error) {
    if (error?.name === "AbortError") return "操作已取消";
    return String(error?.message || error || "声音处理失败");
  }

  function randomId() {
    if (global.crypto?.randomUUID) return global.crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function escapeAttribute(value) {
    return escapeHtml(value);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  global.TimeIsleVoice = Object.freeze({
    createController,
    renderCardSummary,
    renderDetailVoices,
    preferredRecorderMime,
    normalizePolicy
  });
})(typeof window !== "undefined" ? window : globalThis);
