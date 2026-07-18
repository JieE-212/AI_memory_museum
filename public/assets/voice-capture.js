(function initializeTimeIsleVoiceCapture(global) {
  "use strict";

  const DEFAULT_POLICY = Object.freeze({
    maxBytes: 12 * 1024 * 1024,
    maxDurationMs: 180_000,
    acceptedMimeTypes: ["audio/webm", "audio/mp4"]
  });
  const REQUIRED_ELEMENTS = Object.freeze([
    "recordButton", "fileInput", "fileLabel", "help", "recording", "timer",
    "stopButton", "cancelButton", "audio", "status", "retryButton", "removeButton"
  ]);

  function createController(options = {}) {
    const elements = options.elements || {};
    const missing = REQUIRED_ELEMENTS.filter((name) => !elements[name]);
    if (missing.length) throw new Error(`声音采集器缺少 DOM：${missing.join("、")}`);
    const fetchImpl = options.fetch || global.fetch?.bind(global);
    if (typeof fetchImpl !== "function") throw new Error("声音采集器需要 fetch 支持。");
    const navigatorRef = options.navigator || global.navigator || {};
    const MediaRecorderImpl = options.MediaRecorder || global.MediaRecorder;
    const AbortControllerImpl = options.AbortController || global.AbortController;
    const policy = normalizePolicy(options.policy);
    const listeners = [];
    let destroyed = false;
    let demo = Boolean(options.demo);
    let hostBusy = false;
    let session = 0;
    let capture = emptyCapture();
    let permissionRequest = null;
    let recording = null;
    let lastBusy = false;

    configureDom();
    bindEvents();
    render();
    if (demo) setStatus("公开 Demo 不请求麦克风、不打开文件选择，也不上传声音。", "notice");

    function configureDom() {
      elements.fileInput.multiple = false;
      elements.fileInput.accept = "audio/webm,audio/mp4,.webm,.m4a,.mp4";
      const describedBy = new Set(String(elements.fileInput.getAttribute?.("aria-describedby") || "").split(/\s+/u).filter(Boolean));
      if (elements.help.id) describedBy.add(elements.help.id);
      if (elements.status.id) describedBy.add(elements.status.id);
      if (describedBy.size) elements.fileInput.setAttribute?.("aria-describedby", [...describedBy].join(" "));
      elements.status.setAttribute?.("role", "status");
      elements.status.setAttribute?.("aria-live", "polite");
      elements.status.setAttribute?.("aria-atomic", "true");
    }

    function bindEvents() {
      listen(elements.recordButton, "click", startRecording);
      listen(elements.stopButton, "click", () => stopRecording(false));
      listen(elements.cancelButton, "click", () => stopRecording(true));
      listen(elements.fileInput, "change", handleFileInput);
      listen(elements.retryButton, "click", retry);
      listen(elements.removeButton, "click", () => reset({ cleanup: true }));
      listen(global, "pagehide", () => reset({ cleanup: true, silent: true }));
    }

    function listen(target, type, handler) {
      if (!target?.addEventListener) return;
      target.addEventListener(type, handler);
      listeners.push({ target, type, handler });
    }

    function canRecord() {
      const secure = options.isSecureContext === undefined ? global.isSecureContext === true : Boolean(options.isSecureContext);
      return secure && typeof navigatorRef.mediaDevices?.getUserMedia === "function" && Boolean(preferredRecorderMime(MediaRecorderImpl));
    }

    async function handleFileInput(event) {
      const file = event.target.files?.[0] || null;
      event.target.value = "";
      if (!file || demo || hostBusy) return;
      try {
        await addFile(file);
      } catch (error) {
        setStatus(errorMessage(error), "error");
      }
    }

    async function addFile(file) {
      assertMutable();
      if (capture.status !== "empty") throw new Error("请先移除当前声音，再重新选择。");
      const validationError = validateFile(file, policy);
      if (validationError) throw new Error(validationError);
      const activeSession = session;
      const previewUrl = global.URL?.createObjectURL?.(file) || "";
      capture = {
        ...emptyCapture(),
        file,
        originalName: safeFileName(file),
        previewUrl,
        contentUrl: previewUrl,
        status: "uploading"
      };
      render();
      setStatus("正在检查并保存声音…", "loading");
      notifyChange();
      const controller = AbortControllerImpl ? new AbortControllerImpl() : null;
      capture.abortController = controller;
      const upload = request(`/api/voice/uploads?filename=${encodeURIComponent(capture.originalName)}`, {
        method: "POST",
        headers: { "Content-Type": canonicalMime(file.type, capture.originalName) },
        body: file,
        ...(controller ? { signal: controller.signal } : {})
      }).then((payload) => {
        if (destroyed || activeSession !== session || capture.file !== file) return null;
        const asset = normalizeAsset(payload?.asset || payload);
        if (!asset.id || !asset.durationMs) throw new Error("服务端未返回可用的声音资产。");
        if (asset.durationMs > policy.maxDurationMs) throw new Error(`声音超过 ${formatDuration(policy.maxDurationMs)} 上限。`);
        revokePreview();
        capture.asset = asset;
        capture.assetId = asset.id;
        capture.contentUrl = asset.contentUrl;
        capture.status = "ready";
        capture.error = "";
        render();
        setStatus(`声音已就绪，时长 ${formatDuration(asset.durationMs)}。`, "success");
        notifyChange();
        return asset;
      }).catch((error) => {
        if (destroyed || activeSession !== session || error?.name === "AbortError") return null;
        capture.status = "error";
        capture.error = errorMessage(error);
        render();
        setStatus(`声音保存失败：${capture.error}`, "error");
        notifyChange();
        return null;
      }).finally(updateBusy);
      capture.uploadPromise = upload;
      updateBusy();
      return upload;
    }

    async function retry() {
      if (demo || hostBusy || capture.status !== "error" || !capture.file) return null;
      const file = capture.file;
      revokePreview();
      capture = emptyCapture();
      return addFile(file);
    }

    async function startRecording() {
      if (permissionRequest) {
        cancelPermissionRequest(true);
        return;
      }
      if (demo || hostBusy || recording || capture.status !== "empty") return;
      if (!canRecord()) {
        setStatus("当前环境不能安全录音；仍可选择音频文件。", "error");
        return;
      }
      const requestSession = session;
      const token = Symbol("voice capture permission");
      permissionRequest = { token, hintTimer: null };
      render();
      setStatus("正在请求麦克风权限…", "loading");
      permissionRequest.hintTimer = global.setTimeout?.(() => {
        if (permissionRequest?.token !== token || requestSession !== session) return;
        setStatus("仍在等待麦克风授权；请查看地址栏附近的权限提示，也可取消后选择音频文件。", "notice");
      }, 6000);
      let stream;
      try {
        stream = await navigatorRef.mediaDevices.getUserMedia({ audio: true, video: false });
        if (permissionRequest?.token !== token || requestSession !== session || demo || hostBusy) {
          stopTracks(stream);
          return;
        }
        const mimeType = preferredRecorderMime(MediaRecorderImpl);
        const recorder = new MediaRecorderImpl(stream, { mimeType });
        const chunks = [];
        recording = {
          recorder,
          stream,
          chunks,
          mimeType,
          startedAt: Date.now(),
          cancelled: false,
          reachedLimit: false,
          session: requestSession,
          timer: null,
          timeout: null
        };
        recorder.addEventListener("dataavailable", (event) => { if (event.data?.size) chunks.push(event.data); });
        recorder.addEventListener("error", (event) => {
          const message = event.error?.message || "录音未能完成。";
          stopRecording(true);
          setStatus(message, "error");
        });
        recorder.addEventListener("stop", finalizeRecording, { once: true });
        recorder.start(500);
        recording.timer = global.setInterval?.(updateTimer, 250);
        recording.timeout = global.setTimeout?.(() => stopRecording(false, true), Math.min(179_000, policy.maxDurationMs - 1000));
        updateTimer();
        render();
        setStatus("正在录音；停止后会先检查文件，再进入选段。", "loading");
      } catch (error) {
        stopTracks(stream);
        if (permissionRequest?.token === token && requestSession === session) setStatus(permissionErrorMessage(error), "error");
      } finally {
        if (permissionRequest?.token === token) {
          if (permissionRequest.hintTimer) global.clearTimeout?.(permissionRequest.hintTimer);
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
      if (finished.session !== session) return;
      if (finished.cancelled) {
        setStatus("已取消本次录音，没有留下文件。", "notice");
        notifyChange();
        return;
      }
      const mimeType = canonicalMime(finished.recorder.mimeType || finished.mimeType, "recording.webm");
      const blob = new Blob(finished.chunks, { type: mimeType });
      if (!blob.size) {
        setStatus("这次录音没有可保存的声音，请重试。", "error");
        return;
      }
      const extension = mimeType === "audio/mp4" ? "m4a" : "webm";
      const file = createNamedBlob(blob, `口述回答-${recordingStamp(new Date())}.${extension}`, mimeType);
      void addFile(file).then(() => {
        if (finished.reachedLimit) setStatus("已到 2 分 59 秒，录音已自动停止并完成检查。", "notice");
      }).catch((error) => setStatus(errorMessage(error), "error"));
    }

    function updateTimer() {
      if (!recording) return;
      elements.timer.textContent = formatDuration(Math.min(179_000, Math.max(0, Date.now() - recording.startedAt)));
    }

    function cancelPermissionRequest(announce = false) {
      const pending = permissionRequest;
      if (pending?.hintTimer) global.clearTimeout?.(pending.hintTimer);
      permissionRequest = null;
      if (pending && announce) {
        render();
        setStatus("已取消等待麦克风授权；没有开始录音。", "notice");
      }
      return Boolean(pending);
    }

    function markAttached() {
      if (capture.assetId) capture.attached = true;
      return capture.assetId;
    }

    function reset(resetOptions = {}) {
      session += 1;
      cancelPermissionRequest();
      if (recording) stopRecording(true);
      capture.abortController?.abort?.();
      const assetId = capture.assetId;
      const shouldCleanup = resetOptions.cleanup !== false && assetId && !capture.attached && !demo;
      revokePreview();
      capture = emptyCapture();
      elements.fileInput.value = "";
      clearAudio();
      render();
      if (!resetOptions.silent) setStatus(demo ? "公开 Demo 只展示示例，不保存声音。" : "", "notice");
      notifyChange();
      if (shouldCleanup) void cleanupAsset(assetId);
    }

    async function cleanupAsset(assetId) {
      try {
        await request(`/api/voice/assets/${encodeURIComponent(assetId)}`, { method: "DELETE" });
      } catch {
        // An asset linked elsewhere or already collected must remain untouched.
      }
    }

    function setDemo(value) {
      const next = Boolean(value);
      if (next === demo) {
        render();
        return demo;
      }
      if (next) reset({ cleanup: true, silent: true });
      demo = next;
      render();
      if (demo) setStatus("公开 Demo 不请求麦克风、不打开文件选择，也不上传声音。", "notice");
      return demo;
    }

    function setHostBusy(value) {
      hostBusy = Boolean(value);
      render();
    }

    async function waitForReady() {
      if (permissionRequest) throw new Error("仍在等待麦克风授权。");
      if (recording) throw new Error("仍在录音，请先停止或取消。");
      if (capture.uploadPromise) await capture.uploadPromise;
      if (capture.status === "error") throw new Error(capture.error || "声音保存失败。");
      if (capture.status !== "ready" || !capture.assetId) throw new Error("请先录音或选择音频文件。");
      return getState();
    }

    function render() {
      const recordAvailable = canRecord();
      const hasCapture = capture.status !== "empty";
      const permissionPending = Boolean(permissionRequest);
      const locked = demo || hostBusy || Boolean(recording) || capture.status === "uploading" || hasCapture;
      elements.recordButton.hidden = false;
      elements.recordButton.disabled = permissionPending ? false : locked || !recordAvailable;
      elements.recordButton.textContent = demo ? "Demo 不录音"
        : permissionPending ? "取消授权等待"
          : recordAvailable ? "开始录音" : "此浏览器不能录音";
      elements.recordButton.setAttribute?.("aria-busy", String(permissionPending));
      elements.fileInput.disabled = demo || hostBusy || Boolean(recording) || permissionPending || hasCapture;
      elements.fileLabel.classList?.toggle?.("is-disabled", elements.fileInput.disabled);
      elements.fileLabel.setAttribute?.("aria-disabled", String(elements.fileInput.disabled));
      elements.help.textContent = demo
        ? "公开 Demo 不请求麦克风、不打开文件选择，也不上传声音。"
        : recordAvailable
          ? `可录音或选择 WebM/Opus、M4A/AAC；单段不超过 ${formatBytes(policy.maxBytes)}。`
          : "当前环境不能安全录音；仍可选择 WebM/Opus 或 M4A/AAC 文件。";
      elements.recording.hidden = !recording;
      elements.stopButton.disabled = !recording;
      elements.cancelButton.disabled = !recording;
      elements.retryButton.hidden = capture.status !== "error";
      elements.retryButton.disabled = demo || hostBusy || capture.status !== "error";
      elements.removeButton.hidden = capture.status === "empty";
      elements.removeButton.disabled = demo || hostBusy || capture.status === "uploading";
      const audioUrl = safeAudioUrl(capture.contentUrl || capture.asset?.contentUrl);
      elements.audio.hidden = !audioUrl;
      if (audioUrl && elements.audio.dataset?.captureSource !== audioUrl) {
        elements.audio.src = audioUrl;
        if (elements.audio.dataset) elements.audio.dataset.captureSource = audioUrl;
      }
      updateBusy();
    }

    function clearAudio() {
      elements.audio.pause?.();
      elements.audio.removeAttribute?.("src");
      if (elements.audio.dataset) delete elements.audio.dataset.captureSource;
      elements.audio.load?.();
      elements.audio.hidden = true;
    }

    function updateBusy() {
      const busy = Boolean(permissionRequest || recording || capture.status === "uploading");
      if (busy === lastBusy) return;
      lastBusy = busy;
      options.onBusyChange?.(busy);
    }

    function setStatus(message, kind = "notice") {
      elements.status.textContent = String(message || "");
      if (elements.status.dataset) elements.status.dataset.state = kind;
      options.onStatus?.({ message: String(message || ""), kind });
    }

    function notifyChange() {
      options.onChange?.(getState());
    }

    function getState() {
      return Object.freeze({
        demo,
        hostBusy,
        status: capture.status,
        error: capture.error,
        assetId: capture.assetId,
        asset: capture.asset ? { ...capture.asset } : null,
        durationMs: Number(capture.asset?.durationMs || 0),
        contentUrl: safeAudioUrl(capture.contentUrl),
        recording: Boolean(recording),
        awaitingPermission: Boolean(permissionRequest),
        busy: Boolean(permissionRequest || recording || capture.status === "uploading"),
        ready: capture.status === "ready" && Boolean(capture.assetId)
      });
    }

    function assertMutable() {
      if (destroyed) throw new Error("声音采集器已关闭。");
      if (demo) throw new Error("公开 Demo 不保存私人声音。");
      if (hostBusy) throw new Error("另一项拼图操作正在进行，请稍候。");
    }

    function revokePreview() {
      if (!capture.previewUrl) return;
      global.URL?.revokeObjectURL?.(capture.previewUrl);
      capture.previewUrl = "";
    }

    async function request(url, requestOptions = {}) {
      const response = await fetchImpl(url, requestOptions);
      const contentType = response.headers?.get?.("content-type") || "";
      const payload = contentType.includes("application/json") ? await response.json() : await response.text();
      if (!response.ok) {
        const error = new Error(typeof payload === "object" ? payload.error : payload || `请求失败（${response.status}）`);
        error.status = response.status;
        error.code = typeof payload === "object" ? payload.code : "";
        throw error;
      }
      return payload;
    }

    function destroy() {
      if (destroyed) return;
      reset({ cleanup: true, silent: true });
      destroyed = true;
      listeners.forEach(({ target, type, handler }) => target.removeEventListener?.(type, handler));
      listeners.length = 0;
    }

    return Object.freeze({
      addFile,
      waitForReady,
      markAttached,
      reset,
      setDemo,
      setHostBusy,
      getState,
      destroy
    });
  }

  function emptyCapture() {
    return {
      file: null,
      originalName: "",
      previewUrl: "",
      contentUrl: "",
      assetId: "",
      asset: null,
      status: "empty",
      error: "",
      abortController: null,
      uploadPromise: null,
      attached: false
    };
  }

  function normalizePolicy(value = {}) {
    const positive = (input, fallback) => Number.isFinite(Number(input)) && Number(input) > 0 ? Math.floor(Number(input)) : fallback;
    const accepted = Array.isArray(value.acceptedMimeTypes)
      ? value.acceptedMimeTypes.filter((type) => DEFAULT_POLICY.acceptedMimeTypes.includes(type))
      : [];
    return Object.freeze({
      maxBytes: positive(value.maxBytes, DEFAULT_POLICY.maxBytes),
      maxDurationMs: Math.min(DEFAULT_POLICY.maxDurationMs, positive(value.maxDurationMs, DEFAULT_POLICY.maxDurationMs)),
      acceptedMimeTypes: accepted.length ? [...accepted] : [...DEFAULT_POLICY.acceptedMimeTypes]
    });
  }

  function preferredRecorderMime(MediaRecorderImpl) {
    const candidates = ["audio/webm;codecs=opus", "audio/mp4;codecs=mp4a.40.2", "audio/mp4"];
    if (typeof MediaRecorderImpl?.isTypeSupported !== "function") return "";
    return candidates.find((candidate) => MediaRecorderImpl.isTypeSupported(candidate)) || "";
  }

  function validateFile(file, policyInput = DEFAULT_POLICY) {
    const policy = normalizePolicy(policyInput);
    if (!file || typeof file.size !== "number") return "这不是可读取的声音文件。";
    if (!file.size) return "声音文件为空。";
    if (file.size > policy.maxBytes) return `声音文件超过 ${formatBytes(policy.maxBytes)} 上限。`;
    const mime = String(file.type || "").split(";", 1)[0].trim().toLowerCase();
    const extensionAllowed = /\.(?:webm|m4a|mp4)$/iu.test(String(file.name || ""));
    if (mime && !["audio/webm", "audio/mp4", "audio/m4a", "audio/x-m4a"].includes(mime)) return "仅支持 WebM/Opus 或 M4A/AAC。";
    if (!mime && !extensionAllowed) return "无法识别这个声音格式。";
    return "";
  }

  function normalizeAsset(value = {}) {
    const id = String(value.id || value.assetId || "");
    return Object.freeze({
      id,
      durationMs: Math.max(0, Number(value.durationMs || 0)),
      mimeType: String(value.mimeType || ""),
      originalName: String(value.originalName || ""),
      contentUrl: safeAudioUrl(value.contentUrl || (id ? `/api/voice/assets/${encodeURIComponent(id)}/content` : ""))
    });
  }

  function canonicalMime(value, fileName = "") {
    const mime = String(value || "").split(";", 1)[0].trim().toLowerCase();
    if (mime === "audio/webm") return "audio/webm";
    if (["audio/mp4", "audio/m4a", "audio/x-m4a"].includes(mime)) return "audio/mp4";
    return /\.webm$/iu.test(String(fileName)) ? "audio/webm" : "audio/mp4";
  }

  function safeAudioUrl(value) {
    const url = String(value || "").trim();
    return /^(?:\/|blob:)/iu.test(url) ? url : "";
  }

  function safeFileName(file) {
    return String(file?.name || "口述回答").replace(/[\\/\u0000-\u001f\u007f]/gu, "-").slice(0, 160) || "口述回答";
  }

  function createNamedBlob(blob, name, mimeType) {
    if (typeof global.File === "function") return new global.File([blob], name, { type: mimeType, lastModified: Date.now() });
    try { Object.defineProperty(blob, "name", { value: name }); } catch { /* Blob remains uploadable. */ }
    return blob;
  }

  function stopTracks(stream) {
    stream?.getTracks?.().forEach((track) => {
      try { track.stop(); } catch { /* Track was already stopped. */ }
    });
  }

  function clearRecordingTimers(value) {
    if (value?.timer) global.clearInterval?.(value.timer);
    if (value?.timeout) global.clearTimeout?.(value.timeout);
  }

  function permissionErrorMessage(error) {
    if (["NotAllowedError", "SecurityError"].includes(error?.name)) return "未获得麦克风权限；没有上传任何内容。你仍可选择音频文件。";
    if (error?.name === "NotFoundError") return "没有找到可用麦克风；你仍可选择音频文件。";
    return errorMessage(error);
  }

  function errorMessage(error) {
    if (error?.name === "AbortError") return "操作已取消";
    return String(error?.message || error || "声音处理失败");
  }

  function formatDuration(value) {
    const totalSeconds = Math.floor(Math.max(0, Number(value || 0)) / 1000);
    return `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;
  }

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MiB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KiB`;
    return `${bytes} B`;
  }

  function recordingStamp(date) {
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  }

  global.TimeIsleVoiceCapture = Object.freeze({
    createController,
    normalizePolicy,
    preferredRecorderMime,
    validateFile,
    formatDuration
  });
})(typeof window !== "undefined" ? window : globalThis);
