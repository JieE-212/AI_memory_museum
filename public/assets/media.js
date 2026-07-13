(function initializeTimeIsleMedia(global) {
  "use strict";

  const DEFAULT_POLICY = Object.freeze({
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    maxOriginalBytes: 20 * 1024 * 1024,
    maxDerivedBytes: 4 * 1024 * 1024,
    maxPixelCount: 40_000_000,
    maxPhotosPerMemory: 6,
    displayMaxEdge: 1600,
    thumbMaxEdge: 480
  });

  const DEFAULT_IDS = Object.freeze({
    photoInput: "photoInput",
    photoHelp: "photoHelp",
    photoTray: "photoTray",
    photoEditor: "photoEditor",
    photoCaption: "photoCaption", photoAltText: "photoAltText",
    photoCapturedAt: "photoCapturedAt",
    photoHint: "photoHint",
    photoBackNote: "photoBackNote",
    photoSetCoverButton: "photoSetCoverButton",
    photoMoveLeftButton: "photoMoveLeftButton",
    photoMoveRightButton: "photoMoveRightButton",
    photoRemoveButton: "photoRemoveButton",
    photoStatus: "photoStatus",
    privacyMode: "privacyMode"
  });
  function createController(config = {}) {
    const documentRef = config.document || global.document;
    if (!documentRef) throw new Error("TimeIsleMedia 需要浏览器 DOM。");

    const fetchImpl = config.fetch || (typeof global.fetch === "function" ? global.fetch.bind(global) : null);
    if (!fetchImpl) throw new Error("TimeIsleMedia 需要 fetch 支持。");

    const ids = { ...DEFAULT_IDS, ...(config.ids || {}) };
    const suppliedElements = config.elements || {};
    const elements = Object.fromEntries(Object.entries(ids).map(([key, id]) => [
      key,
      suppliedElements[key] || documentRef.getElementById(id)
    ]));
    const missing = Object.entries(elements).filter(([, element]) => !element).map(([key]) => ids[key]);
    if (missing.length) throw new Error(`图片控制器缺少 DOM：${missing.join("、")}`);

    const apiRoot = String(config.apiRoot || "/api/media").replace(/\/$/, "");
    let policy = normalizePolicy(config.policy);
    let demo = Boolean(config.demo || config.interviewDemo);
    let mediaItems = [];
    let selectedLocalId = "";
    let memoryId = "";
    let session = 0;
    let uploadQueue = Promise.resolve();
    let mediaMutation = false;
    let destroyed = false;
    const removedAssetIds = new Set();
    const listeners = [];

    bindEvents();
    configureDom();
    render();
    if (demo) setStatus("公开 Demo 不接收私人图片；请在本地版本体验图片保存。", "notice");

    function bindEvents() {
      listen(elements.photoInput, "change", handlePhotoInput);
      listen(elements.photoTray, "click", handleTrayClick);
      listen(elements.photoCaption, "input", () => updateSelected("caption", elements.photoCaption.value)); listen(elements.photoAltText, "input", () => updateSelected("altText", elements.photoAltText.value));
      listen(elements.photoCapturedAt, "change", () => updateSelected("capturedAt", elements.photoCapturedAt.value));
      listen(elements.photoHint, "click", handlePhotoHintClick);
      listen(elements.photoBackNote, "input", () => updateSelected("backNote", elements.photoBackNote.value));
      listen(elements.photoSetCoverButton, "click", () => setCover(selectedLocalId));
      listen(elements.photoMoveLeftButton, "click", () => moveSelected(-1));
      listen(elements.photoMoveRightButton, "click", () => moveSelected(1));
      listen(elements.photoRemoveButton, "click", () => removeItem(selectedLocalId));
      listen(elements.privacyMode, "change", handlePrivacyChange);
      listen(documentRef, "click", handleGalleryClick);
      listen(documentRef, "keydown", handleGalleryKeydown);
      listen(documentRef, "error", handleImageError, true);
    }

    function listen(target, type, handler, options) {
      target.addEventListener(type, handler, options);
      listeners.push({ target, type, handler, options });
    }

    function configureDom() {
      elements.photoInput.multiple = true;
      elements.photoInput.accept = policy.allowedMimeTypes.join(",");
      const describedBy = new Set(String(elements.photoInput.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean));
      describedBy.add(ids.photoHelp);
      describedBy.add(ids.photoStatus);
      elements.photoInput.setAttribute("aria-describedby", [...describedBy].join(" "));
      if (!elements.photoHelp.textContent.trim()) elements.photoHelp.textContent = policyHelpText(policy);
      if (!["preserve_original", "sanitized_only"].includes(elements.privacyMode.value)) {
        elements.privacyMode.value = "sanitized_only";
      }
    }

    async function handlePhotoInput(event) {
      const files = [...(event.target.files || [])];
      event.target.value = "";
      if (!files.length) return;
      try {
        await addFiles(files);
      } catch (error) {
        setStatus(errorMessage(error), "error");
      }
    }

    function handleTrayClick(event) {
      const button = event.target.closest("[data-media-action]");
      if (!button || !elements.photoTray.contains(button)) return;
      const localId = button.dataset.mediaId || "";
      const action = button.dataset.mediaAction;
      if (action === "select") selectItem(localId, true);
      if (action === "retry") retryItem(localId);
    }

    function handlePrivacyChange() {
      if (mediaItems.length) {
        elements.privacyMode.value = mediaItems[0].privacyMode || "sanitized_only";
        setStatus("已有照片时不能切换保存策略；移除照片后可以重新选择。", "notice");
        return;
      }
      setStatus(privacyHelp(elements.privacyMode.value), "notice");
      notifyChange();
    }

    function handlePhotoHintClick(event) {
      const button = event.target.closest('[data-photo-hint-action="use-captured-at"]');
      if (!button || !elements.photoHint.contains(button)) return;
      const selected = findItem(selectedLocalId);
      const hint = global.TimeIsleMediaIntelligence?.capturedAtHint(selected);
      if (!selected || !hint) return;
      selected.capturedAt = hint.value.localDateTime;
      selected.metadata = { ...selected.metadata, capturedAt: hint.value.localDateTime, capturedAtSource: "exif-confirmed-by-user" };
      elements.photoCapturedAt.value = toDateTimeLocal(selected.capturedAt);
      renderPhotoHints(selected);
      notifyChange();
      setStatus("已采用照片中的拍摄时间；你仍可以继续修改。", "success");
    }

    async function addFiles(files) {
      assertMutable();
      const available = Math.max(0, policy.maxPhotosPerMemory - mediaItems.length);
      if (!available) throw new Error(`每段记忆最多保存 ${policy.maxPhotosPerMemory} 张照片。`);

      const accepted = [];
      const rejected = [];
      const fingerprints = new Set(mediaItems.map((item) => item.fingerprint).filter(Boolean));
      for (const file of files) {
        if (accepted.length >= available) {
          rejected.push(`${file.name || "未命名图片"}：超出 ${policy.maxPhotosPerMemory} 张上限`);
          continue;
        }
        const validationError = validateFile(file, policy);
        const fingerprint = fileFingerprint(file);
        if (validationError) {
          rejected.push(`${file.name || "未命名图片"}：${validationError}`);
          continue;
        }
        if (fingerprints.has(fingerprint)) {
          rejected.push(`${file.name || "未命名图片"}：已在当前照片列表中`);
          continue;
        }
        fingerprints.add(fingerprint);
        const item = createLocalItem(file, fingerprint, session, elements.privacyMode.value);
        mediaItems.push(item);
        accepted.push(item);
      }

      ensureCover();
      if (!selectedLocalId && accepted[0]) selectedLocalId = accepted[0].localId;
      render();
      notifyChange();

      if (accepted.length) {
        setStatus(`已加入 ${accepted.length} 张照片，正在生成安全预览。${rejected.length ? `另有 ${rejected.length} 张未加入。` : ""}`, rejected.length ? "notice" : "loading");
        accepted.forEach((item) => enqueueUpload(item));
      } else if (rejected.length) {
        setStatus(rejected.join("；"), "error");
      }
      return { accepted: accepted.length, rejected };
    }

    function createLocalItem(file, fingerprint, itemSession, privacyMode) {
      return {
        localId: `local-${randomId()}`,
        file,
        fingerprint,
        previewUrl: "",
        assetId: "",
        uploadId: "",
        urls: {},
        originalName: file.name || "memory-photo",
        caption: "",
        altText: "",
        backNote: "",
        capturedAt: "",
        metadata: {},
        hints: [],
        privacyMode,
        role: "gallery",
        position: mediaItems.length,
        status: "local",
        progress: 0,
        error: "",
        existing: false,
        itemSession,
        abortController: null,
        uploadPromise: null
      };
    }

    function enqueueUpload(item) {
      const run = uploadQueue.catch(() => {}).then(() => uploadItem(item));
      item.uploadPromise = run;
      uploadQueue = run.catch(() => {});
      return run;
    }

    async function uploadItem(item) {
      if (!isActiveItem(item)) return null;
      const itemSession = item.itemSession;
      const abortController = new AbortController();
      item.abortController = abortController;
      item.status = "uploading";
      item.progress = 5;
      item.error = "";
      render();
      notifyChange();

      try {
        const begin = await request(
          `${apiRoot}/uploads?filename=${encodeURIComponent(item.originalName)}&privacy=${encodeURIComponent(item.privacyMode)}`,
          {
            method: "POST",
            headers: { "Content-Type": item.file.type || "application/octet-stream" },
            body: item.file,
            signal: abortController.signal
          }
        );
        item.uploadId = begin.upload?.uploadId || "";
        if (!item.uploadId) throw new Error("服务器没有返回图片上传会话。");
        assertActiveItem(item, itemSession);
        item.progress = 24;
        render();

        const variants = await createDerivedWebps(item.file, item.previewUrl, policy, documentRef);
        assertActiveItem(item, itemSession);
        if (typeof global.URL?.createObjectURL === "function") item.previewUrl = global.URL.createObjectURL(variants.thumb);
        item.progress = 42;
        render();

        await request(`${apiRoot}/uploads/${encodeURIComponent(item.uploadId)}/display`, {
          method: "PUT",
          headers: { "Content-Type": "image/webp" },
          body: variants.display,
          signal: abortController.signal
        });
        assertActiveItem(item, itemSession);
        item.progress = 68;
        render();

        await request(`${apiRoot}/uploads/${encodeURIComponent(item.uploadId)}/thumb`, {
          method: "PUT",
          headers: { "Content-Type": "image/webp" },
          body: variants.thumb,
          signal: abortController.signal
        });
        assertActiveItem(item, itemSession);
        item.progress = 88;
        render();

        const completed = await request(`${apiRoot}/uploads/${encodeURIComponent(item.uploadId)}/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
          signal: abortController.signal
        });
        const media = completed.media;
        if (!media?.id) throw new Error("服务器没有返回已保存的图片。");
        if (!isActiveItem(item) || item.itemSession !== itemSession) {
          cleanupOrphanAsset(media.id);
          return null;
        }

        await request(`${apiRoot}/assets/${encodeURIComponent(media.id)}/fingerprint`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sample: variants.fingerprint }),
          signal: abortController.signal
        }).catch(() => null);
        item.assetId = media.id;
        item.uploadId = "";
        item.urls = media.urls || {};
        item.originalName = media.originalName || item.originalName;
        item.privacyMode = media.privacyMode || item.privacyMode;
        item.width = media.width;
        item.height = media.height;
        item.safeMetadata = media.safeMetadata || {};
        item.hints = Array.isArray(media.hints) ? media.hints : [];
        item.status = "ready";
        item.progress = 100;
        item.error = "";
        render();
        notifyChange();
        announceAggregateStatus();
        return media;
      } catch (error) {
        if (item.uploadId) discardUpload(item.uploadId);
        item.uploadId = "";
        if (error?.name === "AbortError" || !isActiveItem(item) || item.itemSession !== itemSession) return null;
        item.status = "error";
        item.progress = 0;
        item.error = errorMessage(error);
        render();
        notifyChange();
        setStatus(`${item.originalName} 保存失败：${item.error}`, "error");
        return null;
      } finally {
        item.abortController = null;
      }
    }

    function retryItem(localId) {
      if (demo || mediaMutation) return;
      const item = findItem(localId);
      if (!item || item.status !== "error" || !item.file) return;
      item.status = "local";
      item.progress = 0;
      item.error = "";
      item.itemSession = session;
      render();
      setStatus(`正在重试 ${item.originalName}…`, "loading");
      enqueueUpload(item);
    }

    async function removeItem(localId) {
      if (demo || mediaMutation) return;
      const index = mediaItems.findIndex((item) => item.localId === localId);
      if (index < 0) return;
      const [item] = mediaItems.splice(index, 1);
      item.abortController?.abort();
      revokePreview(item);
      if (item.existing && item.assetId) removedAssetIds.add(item.assetId);
      if (!item.existing && item.uploadId) discardUpload(item.uploadId);
      if (!item.existing && item.assetId) cleanupOrphanAsset(item.assetId);
      if (selectedLocalId === localId) {
        selectedLocalId = mediaItems[Math.min(index, mediaItems.length - 1)]?.localId || "";
      }
      ensureCover();
      normalizePositions();
      render();
      notifyChange();
      setStatus("照片已从草稿移除；保存展品后才会更新馆藏。", "notice");
    }

    function selectItem(localId, focusEditor = false) {
      if (!findItem(localId)) return;
      selectedLocalId = localId;
      render();
      if (focusEditor && !demo) elements.photoCaption.focus();
    }

    function updateSelected(field, value) {
      if (demo || mediaMutation) return;
      const item = findItem(selectedLocalId);
      if (!item) return;
      item[field] = String(value || "");
      notifyChange();
    }

    function setCover(localId) {
      if (demo || mediaMutation) return;
      const item = findItem(localId);
      if (!item) return;
      mediaItems.forEach((entry) => { entry.role = entry === item ? "cover" : "gallery"; });
      render();
      notifyChange();
      setStatus("已设为展品封面。", "success");
    }

    function moveSelected(offset) {
      if (demo || mediaMutation) return;
      const index = mediaItems.findIndex((item) => item.localId === selectedLocalId);
      const target = index + offset;
      if (index < 0 || target < 0 || target >= mediaItems.length) return;
      const [item] = mediaItems.splice(index, 1);
      mediaItems.splice(target, 0, item);
      normalizePositions();
      render();
      notifyChange();
      const direction = offset < 0 ? "前" : "后";
      setStatus(`照片已向${direction}移动到第 ${target + 1} 张。`, "success");
      const selectedButton = elements.photoTray.querySelector(`[data-media-action="select"][data-media-id="${cssEscape(selectedLocalId)}"]`);
      selectedButton?.focus();
    }

    function ensureCover() {
      if (!mediaItems.length) return;
      const covers = mediaItems.filter((item) => item.role === "cover");
      if (!covers.length) mediaItems[0].role = "cover";
      if (covers.length > 1) {
        const keeper = covers[0];
        mediaItems.forEach((item) => { item.role = item === keeper ? "cover" : "gallery"; });
      }
    }

    function normalizePositions() {
      mediaItems.forEach((item, index) => { item.position = index; });
    }

    function render() {
      if (destroyed) return;
      ensureCover();
      normalizePositions();
      if (selectedLocalId && !findItem(selectedLocalId)) selectedLocalId = mediaItems[0]?.localId || "";

      elements.photoTray.innerHTML = mediaItems.map((item, index) => renderTrayItem(item, index)).join("");
      const selected = findItem(selectedLocalId);
      elements.photoEditor.hidden = !selected;
      if (selected) {
        elements.photoCaption.value = selected.caption || ""; elements.photoAltText.value = selected.altText || "";
        elements.photoCapturedAt.value = toDateTimeLocal(selected.capturedAt);
        elements.photoBackNote.value = selected.backNote || "";
        renderPhotoHints(selected);
        elements.photoSetCoverButton.disabled = demo || mediaMutation || selected.role === "cover";
        elements.photoMoveLeftButton.disabled = demo || mediaMutation || selected.position === 0;
        elements.photoMoveRightButton.disabled = demo || mediaMutation || selected.position === mediaItems.length - 1;
        elements.photoRemoveButton.disabled = demo || mediaMutation;
      } else {
        elements.photoHint.hidden = true;
        elements.photoHint.innerHTML = "";
      }

      const atLimit = mediaItems.length >= policy.maxPhotosPerMemory;
      elements.photoInput.disabled = demo || mediaMutation || atLimit;
      elements.photoEditor.disabled = demo || mediaMutation;
      elements.privacyMode.disabled = demo || mediaMutation || mediaItems.length > 0;
      const fileLabel = documentRef.querySelector(`label[for="${cssEscape(ids.photoInput)}"]`);
      if (fileLabel) {
        const disabled = elements.photoInput.disabled;
        fileLabel.classList.toggle("is-disabled", disabled);
        fileLabel.setAttribute("aria-disabled", String(disabled));
        fileLabel.title = demo
          ? "公开 Demo 不接收私人图片"
          : atLimit ? `每段记忆最多 ${policy.maxPhotosPerMemory} 张照片` : "添加照片";
      }
    }

    function renderPhotoHints(item) {
      const markup = global.TimeIsleMediaIntelligence?.renderExifHints(item, { demo, busy: mediaMutation }) || "";
      elements.photoHint.innerHTML = markup;
      elements.photoHint.hidden = !markup;
    }

    function renderTrayItem(item, index) {
      const imageUrl = safeMediaUrl(item.previewUrl || item.urls?.thumb || item.urls?.display);
      const title = item.caption || item.originalName || `第 ${index + 1} 张照片`;
      const selected = item.localId === selectedLocalId;
      const stateLabel = mediaStateLabel(item);
      const progress = item.status === "uploading"
        ? `<progress class="photo-progress" aria-label="${escapeAttribute(title)}保存进度" max="100" value="${Math.round(item.progress || 0)}">${Math.round(item.progress || 0)}%</progress>`
        : "";
      const retry = item.status === "error"
        ? `<button type="button" class="photo-retry" data-media-action="retry" data-media-id="${escapeAttribute(item.localId)}">重试</button>`
        : "";
      return `<li class="photo-item${selected ? " is-selected" : ""}${item.status === "error" ? " is-error" : ""}">
        <button type="button" class="photo-select" data-media-action="select" data-media-id="${escapeAttribute(item.localId)}" aria-pressed="${selected}" aria-label="编辑第 ${index + 1} 张照片：${escapeAttribute(title)}">
          <span class="photo-thumb-frame media-image-frame">
            ${imageUrl ? `<img class="time-isle-media-image" src="${escapeAttribute(imageUrl)}" alt="" decoding="async" />` : ""}
            <span class="media-image-fallback"${imageUrl ? " hidden" : ""}>图片暂时无法显示</span>
          </span>
          <span class="photo-item-name">${escapeHtml(title)}</span>
        </button>
        ${item.role === "cover" ? '<span class="photo-cover-badge">封面</span>' : ""}
        <span class="photo-state">${escapeHtml(stateLabel)}</span>
        ${progress}${retry}
        ${item.error ? `<small class="photo-error">${escapeHtml(item.error)}</small>` : ""}
      </li>`;
    }

    function loadMemory(memory = {}) {
      clearDraft({ discardUnattached: true, silent: true });
      memoryId = String(memory.id || "");
      const incoming = Array.isArray(memory.media) ? [...memory.media] : [];
      incoming.sort((left, right) => Number(left.position || 0) - Number(right.position || 0));
      mediaItems = incoming.map((media, index) => ({
        localId: `asset-${media.assetId || media.id || randomId()}`,
        file: null,
        fingerprint: "",
        previewUrl: "",
        assetId: media.assetId || media.id || "",
        uploadId: "",
        urls: media.urls || {},
        originalName: media.originalName || `memory-photo-${index + 1}`,
        caption: media.caption || "",
        altText: media.altText || "",
        backNote: media.backNote || "",
        capturedAt: media.metadata?.capturedAt || "",
        metadata: isPlainObject(media.metadata) ? { ...media.metadata } : {},
        hints: Array.isArray(media.hints) ? media.hints : [],
        privacyMode: media.privacyMode || "sanitized_only",
        role: media.role === "cover" ? "cover" : "gallery",
        position: index,
        status: "ready",
        progress: 100,
        error: "",
        existing: true,
        itemSession: session,
        abortController: null,
        uploadPromise: null,
        width: media.width,
        height: media.height,
        safeMetadata: media.safeMetadata || {}
      })).filter((item) => item.assetId);
      removedAssetIds.clear();
      ensureCover();
      selectedLocalId = mediaItems[0]?.localId || "";
      if (mediaItems[0]?.privacyMode) elements.privacyMode.value = mediaItems[0].privacyMode;
      render();
      setStatus(demo && mediaItems.length ? "公开 Demo 中的示例照片仅供查看。" : "", "notice");
      notifyChange();
      return getSnapshot();
    }

    async function saveToMemory(targetMemoryId = memoryId) {
      assertMutable();
      const normalizedId = String(targetMemoryId || "").trim();
      if (!normalizedId) throw new Error("保存照片前需要先取得展品 ID。");
      setMutation(true);
      try {
        await waitForReady();
        setStatus("正在把照片与展品一起保存…", "loading");
        const result = await request(`/api/memories/${encodeURIComponent(normalizedId)}/media`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: serializeItems() })
        });
        memoryId = normalizedId;
        const collection = Array.isArray(result.collection) ? result.collection : [];
        reconcileSavedCollection(collection);
        const removed = [...removedAssetIds];
        removedAssetIds.clear();
        await Promise.allSettled(removed.map(cleanupOrphanAsset));
        setStatus(collection.length ? `已保存 ${collection.length} 张照片。` : "展品已更新为无照片。", "success");
        notifyChange();
        return result;
      } catch (error) {
        setStatus(errorMessage(error), "error");
        throw error;
      } finally {
        setMutation(false);
      }
    }

    async function waitForReady() {
      const promises = mediaItems.map((item) => item.uploadPromise).filter(Boolean);
      await Promise.allSettled(promises);
      const failed = mediaItems.filter((item) => item.status === "error");
      const pending = mediaItems.filter((item) => !["ready", "error"].includes(item.status));
      if (pending.length) throw new Error("仍有照片正在处理，请稍后再保存。");
      if (failed.length) throw new Error(`有 ${failed.length} 张照片保存失败，请重试或移除后再保存。`);
      if (mediaItems.some((item) => !item.assetId)) throw new Error("有照片尚未取得可保存的媒体 ID。");
      return true;
    }

    function serializeItems() {
      ensureCover();
      normalizePositions();
      return mediaItems.map((item, index) => ({
        assetId: item.assetId,
        role: item.role === "cover" ? "cover" : "gallery",
        position: index,
        caption: String(item.caption || "").slice(0, 1000),
        altText: String(item.altText || item.caption || "").slice(0, 1000),
        backNote: String(item.backNote || "").slice(0, 4000),
        metadata: {
          ...(isPlainObject(item.metadata) ? item.metadata : {}),
          ...(item.capturedAt ? { capturedAt: item.capturedAt } : {})
        }
      }));
    }

    function reconcileSavedCollection(collection) {
      const currentByAsset = new Map(mediaItems.map((item) => [item.assetId, item]));
      mediaItems = collection.map((saved, index) => {
        const item = currentByAsset.get(saved.assetId) || {};
        revokePreview(item);
        return {
          ...item,
          localId: item.localId || `asset-${saved.assetId}`,
          file: null,
          previewUrl: "",
          assetId: saved.assetId,
          urls: saved.urls || item.urls || {},
          originalName: saved.originalName || item.originalName || `memory-photo-${index + 1}`,
          caption: saved.caption || "",
          altText: saved.altText || "",
          backNote: saved.backNote || "",
          capturedAt: saved.metadata?.capturedAt || item.capturedAt || "",
          metadata: isPlainObject(saved.metadata) ? { ...saved.metadata } : {},
          privacyMode: saved.privacyMode || item.privacyMode || "sanitized_only",
          role: saved.role === "cover" ? "cover" : "gallery",
          position: index,
          status: "ready",
          progress: 100,
          error: "",
          existing: true,
          uploadId: "",
          uploadPromise: null,
          abortController: null,
          itemSession: session,
          width: saved.width,
          height: saved.height,
          safeMetadata: saved.safeMetadata || item.safeMetadata || {}
        };
      });
      ensureCover();
      selectedLocalId = mediaItems.find((item) => item.localId === selectedLocalId)?.localId || mediaItems[0]?.localId || "";
      render();
    }

    function reset(options = {}) {
      clearDraft({ discardUnattached: options.discardUnattached !== false, silent: Boolean(options.silent) });
      render();
      if (!options.silent) setStatus("", "notice");
      notifyChange();
    }

    function clearDraft(options = {}) {
      session += 1;
      const previous = mediaItems;
      mediaItems = [];
      uploadQueue = Promise.resolve();
      selectedLocalId = "";
      memoryId = "";
      previous.forEach((item) => {
        item.abortController?.abort();
        revokePreview(item);
        if (!options.discardUnattached || item.existing) return;
        if (item.uploadId) discardUpload(item.uploadId);
        if (item.assetId) cleanupOrphanAsset(item.assetId);
      });
      removedAssetIds.clear();
      elements.photoInput.value = "";
      if (!options.silent) render();
    }

    function setPolicy(nextPolicy) {
      policy = normalizePolicy(nextPolicy);
      configureDom();
      render();
      return policy;
    }

    function setDemo(value) {
      demo = Boolean(value);
      render();
      setStatus(demo ? "公开 Demo 不接收私人图片；请在本地版本体验图片保存。" : "", "notice");
    }

    function setMutation(value) {
      mediaMutation = Boolean(value);
      render();
      config.onBusyChange?.(mediaMutation);
    }

    function setStatus(message, type = "notice") {
      elements.photoStatus.textContent = message || "";
      elements.photoStatus.classList.toggle("is-error", type === "error");
      elements.photoStatus.classList.toggle("is-success", type === "success");
      elements.photoStatus.classList.toggle("is-loading", type === "loading");
      config.onStatus?.({ message: message || "", type });
    }

    function announceAggregateStatus() {
      const ready = mediaItems.filter((item) => item.status === "ready").length;
      const failed = mediaItems.filter((item) => item.status === "error").length;
      const pending = mediaItems.length - ready - failed;
      if (pending) return setStatus(`已准备 ${ready} 张，另有 ${pending} 张正在处理。`, "loading");
      if (failed) return setStatus(`已准备 ${ready} 张，${failed} 张需要重试。`, "error");
      setStatus(`已准备 ${ready} 张照片；保存展品后会正式进入馆藏。`, "success");
    }

    function notifyChange() {
      config.onChange?.(getSnapshot());
    }

    function getSnapshot() {
      return {
        memoryId,
        count: mediaItems.length,
        selectedLocalId,
        demo,
        busy: mediaMutation || mediaItems.some((item) => item.status === "uploading"),
        ready: mediaItems.every((item) => item.status === "ready"),
        hasErrors: mediaItems.some((item) => item.status === "error"),
        items: mediaItems.map((item) => ({
          localId: item.localId,
          assetId: item.assetId,
          role: item.role,
          position: item.position,
          caption: item.caption,
          altText: item.altText,
          backNote: item.backNote,
          capturedAt: item.capturedAt,
          privacyMode: item.privacyMode,
          status: item.status,
          progress: item.progress,
          error: item.error,
          urls: { ...(item.urls || {}) }
        }))
      };
    }

    function destroy() {
      if (destroyed) return;
      clearDraft({ discardUnattached: true, silent: true });
      destroyed = true;
      listeners.forEach(({ target, type, handler, options }) => target.removeEventListener(type, handler, options));
      listeners.length = 0;
    }

    function assertMutable() {
      if (demo) throw new Error("公开 Demo 不接收私人图片；请在本地版本体验图片保存。");
      if (mediaMutation) throw new Error("照片正在保存，请稍后再操作。");
      if (destroyed) throw new Error("图片控制器已经销毁。");
    }

    function isActiveItem(item) {
      return !destroyed && item && item.itemSession === session && mediaItems.includes(item);
    }

    function assertActiveItem(item, itemSession) {
      if (!isActiveItem(item) || item.itemSession !== itemSession) {
        const error = new Error("图片处理已取消。");
        error.name = "AbortError";
        throw error;
      }
    }

    function findItem(localId) {
      return mediaItems.find((item) => item.localId === localId);
    }

    function revokePreview(item) {
      if (!item?.previewUrl || typeof global.URL?.revokeObjectURL !== "function") return;
      global.URL.revokeObjectURL(item.previewUrl);
      item.previewUrl = "";
    }

    async function discardUpload(uploadId) {
      if (!uploadId) return;
      try {
        await request(`${apiRoot}/uploads/${encodeURIComponent(uploadId)}`, { method: "DELETE" });
      } catch {
        // Stale stages are also removed by the server's scheduled cleanup.
      }
    }

    async function cleanupOrphanAsset(assetId) {
      if (!assetId) return;
      try {
        await request(`${apiRoot}/assets/${encodeURIComponent(assetId)}`, { method: "DELETE" });
      } catch {
        // A deduplicated asset can still be referenced elsewhere and must then remain.
      }
    }

    async function request(url, options = {}) {
      const response = await fetchImpl(url, options);
      const contentType = response.headers.get("content-type") || "";
      const payload = contentType.includes("application/json") ? await response.json() : await response.text();
      if (!response.ok) {
        const error = new Error(typeof payload === "object" ? payload.error : payload || `请求失败（${response.status}）`);
        error.status = response.status;
        error.payload = payload;
        throw error;
      }
      return payload;
    }

    return Object.freeze({
      addFiles,
      loadMemory,
      saveToMemory,
      attachToMemory: saveToMemory,
      waitForReady,
      serializeItems,
      getSnapshot,
      reset,
      render,
      setPolicy,
      setDemo,
      destroy
    });
  }

  function renderCardMedia(memory = {}, escapeHtmlImpl = escapeHtml) {
    const escape = typeof escapeHtmlImpl === "function" ? escapeHtmlImpl : escapeHtml;
    const media = normalizedMemoryMedia(memory);
    const count = Number(memory.mediaSummary?.count || media.length || (memory.coverImage ? 1 : 0));
    if (!count) return "";
    const cover = media.find((item) => item.role === "cover") || media[0] || {};
    const url = safeMediaUrl(memory.mediaSummary?.coverThumbnailUrl || cover.urls?.thumb || cover.urls?.display || memory.coverImage);
    return `<div class="memory-card-media">
      <span class="memory-card-thumbnail media-image-frame">
        ${url ? `<img class="time-isle-media-image" src="${escape(url)}" alt="" loading="lazy" decoding="async" />` : ""}
        <span class="media-image-fallback"${url ? " hidden" : ""}>图片暂时无法显示</span>
      </span>
      <span class="memory-photo-count">${escape(String(count))} 张照片</span>
    </div>`;
  }

  function renderDetailGallery(memory = {}, escapeHtmlImpl = escapeHtml) {
    const escape = typeof escapeHtmlImpl === "function" ? escapeHtmlImpl : escapeHtml;
    const media = normalizedMemoryMedia(memory).filter((item) => (
      safeMediaUrl(item.urls?.display || item.urls?.thumb || item.urls?.original || item.url)
    ));
    if (!media.length && memory.coverImage) {
      media.push({
        assetId: "legacy-cover",
        role: "cover",
        position: 0,
        caption: memory.mediaNote || "",
        altText: "",
        backNote: "",
        metadata: {},
        urls: { display: memory.coverImage }
      });
    }
    if (!media.length) return "";

    const title = String(memory.title || "这段记忆");
    const slides = media.map((item, index) => renderGallerySlide(item, index, media.length, title, escape)).join("");
    const thumbnails = media.length > 1 ? `<div class="media-gallery-thumbnails" role="group" aria-label="选择照片">
      ${media.map((item, index) => {
        const url = safeMediaUrl(item.urls?.thumb || item.urls?.display || item.urls?.original || item.url);
        return `<button type="button" class="media-gallery-thumb${index === 0 ? " is-active" : ""}" data-media-gallery-action="select" data-gallery-index="${index}" aria-pressed="${index === 0}" aria-label="查看第 ${index + 1} 张照片" tabindex="${index === 0 ? 0 : -1}">
          <span class="media-image-frame"><img class="time-isle-media-image" src="${escape(url)}" alt="" loading="lazy" decoding="async" /><span class="media-image-fallback" hidden>无法显示</span></span>
        </button>`;
      }).join("")}
    </div>` : "";

    return `<section class="memory-gallery" data-gallery-index="0" aria-label="${escape(title)}的照片，共 ${media.length} 张">
      <div class="media-gallery-stage">
        <div class="media-gallery-slides">${slides}</div>
        ${media.length > 1 ? `<button type="button" class="media-gallery-nav is-previous" data-media-gallery-action="previous" aria-label="上一张照片" disabled>‹</button>
        <button type="button" class="media-gallery-nav is-next" data-media-gallery-action="next" aria-label="下一张照片">›</button>
        <span class="media-gallery-counter" aria-live="polite">1 / ${media.length}</span>` : ""}
      </div>
      ${thumbnails}
    </section>`;
  }

  function renderGallerySlide(item, index, total, memoryTitle, escape) {
    const url = safeMediaUrl(item.urls?.display || item.urls?.thumb || item.urls?.original || item.url);
    const originalUrl = safeMediaUrl(item.urls?.original);
    const caption = String(item.caption || "");
    const alt = String(item.altText || caption || `《${memoryTitle}》的第 ${index + 1} 张记忆照片`);
    const backNote = String(item.backNote || "");
    const capturedAt = String(item.metadata?.capturedAt || "");
    const dimensions = Number(item.width) > 0 && Number(item.height) > 0
      ? ` width="${Math.round(Number(item.width))}" height="${Math.round(Number(item.height))}"`
      : "";
    return `<figure class="media-gallery-slide" data-media-gallery-slide="${index}"${index ? " hidden" : ""}>
      <span class="media-gallery-image media-image-frame">
        <img class="time-isle-media-image" src="${escape(url)}" alt="${escape(alt)}"${dimensions} ${index ? 'loading="lazy"' : 'loading="eager"'} decoding="async" />
        <span class="media-image-fallback" hidden>图片暂时无法显示</span>
      </span>
      ${(caption || capturedAt || originalUrl) ? `<figcaption>
        ${caption ? `<p>${escape(caption)}</p>` : ""}
        <span class="media-gallery-meta">
          ${capturedAt ? `<time datetime="${escape(capturedAt)}">${escape(formatCapturedAt(capturedAt))}</time>` : ""}
          ${originalUrl ? `<a href="${escape(originalUrl)}" target="_blank" rel="noreferrer">查看原图 ↗</a>` : ""}
        </span>
      </figcaption>` : ""}
      ${backNote ? `<details class="photo-back"><summary>翻到照片背面</summary><p>${escape(backNote)}</p></details>` : ""}
      <span class="sr-only">第 ${index + 1} 张，共 ${total} 张</span>
    </figure>`;
  }

  function handleGalleryClick(event) {
    const actionButton = event.target.closest("[data-media-gallery-action]");
    if (!actionButton) return;
    const gallery = actionButton.closest(".memory-gallery");
    if (!gallery) return;
    const current = Number(gallery.dataset.galleryIndex || 0);
    const count = gallery.querySelectorAll("[data-media-gallery-slide]").length;
    let next = current;
    if (actionButton.dataset.mediaGalleryAction === "previous") next = Math.max(0, current - 1);
    if (actionButton.dataset.mediaGalleryAction === "next") next = Math.min(count - 1, current + 1);
    if (actionButton.dataset.mediaGalleryAction === "select") next = Number(actionButton.dataset.galleryIndex || 0);
    setGalleryIndex(gallery, next, false);
  }

  function handleGalleryKeydown(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const thumbnail = event.target.closest?.('.media-gallery-thumb[data-media-gallery-action="select"]');
    if (!thumbnail) return;
    const gallery = thumbnail.closest(".memory-gallery");
    if (!gallery) return;
    event.preventDefault();
    const count = gallery.querySelectorAll("[data-media-gallery-slide]").length;
    const current = Number(gallery.dataset.galleryIndex || 0);
    const next = event.key === "Home" ? 0
      : event.key === "End" ? count - 1
        : Math.max(0, Math.min(count - 1, current + (event.key === "ArrowRight" ? 1 : -1)));
    setGalleryIndex(gallery, next, true);
  }

  function setGalleryIndex(gallery, index, focusThumbnail) {
    const slides = [...gallery.querySelectorAll("[data-media-gallery-slide]")];
    const next = Math.max(0, Math.min(slides.length - 1, Number(index) || 0));
    gallery.dataset.galleryIndex = String(next);
    slides.forEach((slide, slideIndex) => { slide.hidden = slideIndex !== next; });
    const thumbs = [...gallery.querySelectorAll('[data-media-gallery-action="select"]')];
    thumbs.forEach((thumb, thumbIndex) => {
      const active = thumbIndex === next;
      thumb.classList.toggle("is-active", active);
      thumb.setAttribute("aria-pressed", String(active));
      thumb.tabIndex = active ? 0 : -1;
    });
    const previous = gallery.querySelector('[data-media-gallery-action="previous"]');
    const nextButton = gallery.querySelector('[data-media-gallery-action="next"]');
    if (previous) previous.disabled = next === 0;
    if (nextButton) nextButton.disabled = next === slides.length - 1;
    const counter = gallery.querySelector(".media-gallery-counter");
    if (counter) counter.textContent = `${next + 1} / ${slides.length}`;
    if (focusThumbnail) thumbs[next]?.focus();
  }

  function handleImageError(event) {
    const image = event.target;
    if (image?.tagName !== "IMG" || !image.classList.contains("time-isle-media-image")) return;
    image.hidden = true;
    const frame = image.closest(".media-image-frame");
    const fallback = frame?.querySelector(".media-image-fallback");
    if (fallback) fallback.hidden = false;
    frame?.classList.add("has-media-error");
  }

  async function createDerivedWebps(file, previewUrl, policy, documentRef) {
    const decoded = await decodeImage(file, previewUrl, documentRef);
    try {
      const width = Number(decoded.width || decoded.naturalWidth);
      const height = Number(decoded.height || decoded.naturalHeight);
      if (!width || !height) throw new Error("无法读取图片尺寸。");
      if (width * height > policy.maxPixelCount) throw new Error("图片像素尺寸过大。");
      const [display, thumb] = await Promise.all([
        drawStaticWebp(decoded, width, height, policy.displayMaxEdge, 0.86, policy.maxDerivedBytes, documentRef),
        drawStaticWebp(decoded, width, height, policy.thumbMaxEdge, 0.8, policy.maxDerivedBytes, documentRef)
      ]);
      const fingerprint = global.TimeIsleMediaIntelligence?.createFingerprintSample(decoded, documentRef);
      if (!fingerprint) throw new Error("图片线索模块尚未准备完成。");
      return { display, thumb, fingerprint };
    } finally {
      if (decoded?._timeIsleObjectUrl) global.URL?.revokeObjectURL?.(decoded._timeIsleObjectUrl);
      decoded.close?.();
    }
  }

  async function decodeImage(file, previewUrl, documentRef) {
    if (typeof global.createImageBitmap === "function") {
      try {
        return await global.createImageBitmap(file, { imageOrientation: "from-image" });
      } catch {
        try {
          return await global.createImageBitmap(file);
        } catch {
          // The HTMLImageElement path below provides the final compatibility fallback.
        }
      }
    }
    if (!global.URL?.createObjectURL) throw new Error("当前浏览器无法生成照片预览。");
    const ownedUrl = previewUrl || global.URL.createObjectURL(file);
    const image = documentRef.createElement("img");
    image.decoding = "async";
    try {
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error("图片无法解码，请换一张 JPEG、PNG 或 WebP。"));
        image.src = ownedUrl;
      });
      if (!previewUrl) image._timeIsleObjectUrl = ownedUrl;
      return image;
    } catch (error) {
      if (!previewUrl) global.URL.revokeObjectURL(ownedUrl);
      throw error;
    }
  }

  async function drawStaticWebp(source, sourceWidth, sourceHeight, maxEdge, quality, maxBytes, documentRef) {
    const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = documentRef.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("当前浏览器无法处理图片画布。");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(source, 0, 0, width, height);

    let blob = null;
    for (const candidateQuality of [quality, 0.76, 0.66]) {
      blob = await canvasToBlob(canvas, candidateQuality);
      if (blob.size <= maxBytes) break;
    }
    canvas.width = 1;
    canvas.height = 1;
    if (!blob || blob.type !== "image/webp") throw new Error("当前浏览器不能生成 WebP 图片。");
    if (blob.size > maxBytes) throw new Error("生成的展示图片仍然过大，请换一张尺寸较小的照片。");
    return blob;
  }

  function canvasToBlob(canvas, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("无法生成静态 WebP 图片。")), "image/webp", quality);
    });
  }

  function normalizedMemoryMedia(memory) {
    return (Array.isArray(memory?.media) ? [...memory.media] : [])
      .filter((item) => item && typeof item === "object")
      .sort((left, right) => Number(left.position || 0) - Number(right.position || 0));
  }

  function normalizePolicy(input = {}) {
    const positiveInteger = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0 ? Math.floor(Number(value)) : fallback;
    const allowedMimeTypes = Array.isArray(input.allowedMimeTypes)
      ? input.allowedMimeTypes.filter((value) => DEFAULT_POLICY.allowedMimeTypes.includes(value))
      : DEFAULT_POLICY.allowedMimeTypes;
    return Object.freeze({
      allowedMimeTypes: allowedMimeTypes.length ? [...allowedMimeTypes] : [...DEFAULT_POLICY.allowedMimeTypes],
      maxOriginalBytes: positiveInteger(input.maxOriginalBytes, DEFAULT_POLICY.maxOriginalBytes),
      maxDerivedBytes: positiveInteger(input.maxDerivedBytes, DEFAULT_POLICY.maxDerivedBytes),
      maxPixelCount: positiveInteger(input.maxPixelCount, DEFAULT_POLICY.maxPixelCount),
      maxPhotosPerMemory: Math.min(6, positiveInteger(input.maxPhotosPerMemory, DEFAULT_POLICY.maxPhotosPerMemory)),
      displayMaxEdge: positiveInteger(input.displayMaxEdge, DEFAULT_POLICY.displayMaxEdge),
      thumbMaxEdge: positiveInteger(input.thumbMaxEdge, DEFAULT_POLICY.thumbMaxEdge)
    });
  }

  function validateFile(file, policy) {
    if (!file || typeof file.size !== "number") return "不是可读取的图片文件";
    if (!file.size) return "文件为空";
    if (file.size > policy.maxOriginalBytes) return `超过 ${formatBytes(policy.maxOriginalBytes)} 上限`;
    const mimeType = String(file.type || "").toLowerCase();
    const extensionAllowed = /\.(?:jpe?g|png|webp)$/i.test(String(file.name || ""));
    if (mimeType && !policy.allowedMimeTypes.includes(mimeType)) return "仅支持 JPEG、PNG 或 WebP";
    if (!mimeType && !extensionAllowed) return "无法识别图片格式";
    return "";
  }

  function fileFingerprint(file) {
    return `${file.name || ""}|${file.size || 0}|${file.lastModified || 0}`;
  }

  function policyHelpText(policy) {
    return `最多 ${policy.maxPhotosPerMemory} 张 · 单张不超过 ${formatBytes(policy.maxOriginalBytes)} · JPEG / PNG / WebP。展示图会转为静态 WebP。`;
  }

  function privacyHelp(value) {
    return value === "preserve_original"
      ? "将保存原图，并额外生成不含照片元数据的展示图。"
      : "仅保留浏览器生成的静态展示图；服务端完成处理后会删除暂存原图。";
  }

  function mediaStateLabel(item) {
    if (item.status === "local") return "等待处理";
    if (item.status === "uploading") return `处理中 ${Math.round(item.progress || 0)}%`;
    if (item.status === "error") return "需要重试";
    return "已就绪";
  }

  function safeMediaUrl(value) {
    const url = String(value || "").trim();
    if (!url) return "";
    if (/^(?:\/|https?:\/\/|blob:|data:image\/)/i.test(url)) return url;
    return "";
  }

  function randomId() {
    if (global.crypto?.randomUUID) return global.crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${bytes} B`;
  }

  function toDateTimeLocal(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    const direct = text.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)?.[0];
    if (direct) return direct;
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (number) => String(number).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function formatCapturedAt(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value || "");
    return date.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  }

  function errorMessage(error) {
    if (error?.name === "AbortError") return "操作已取消";
    return String(error?.message || error || "图片处理失败");
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function cssEscape(value) {
    if (global.CSS?.escape) return global.CSS.escape(String(value || ""));
    return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "\\$&");
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

  global.TimeIsleMedia = Object.freeze({
    createController,
    renderCardMedia,
    renderDetailGallery
  });
})(typeof window !== "undefined" ? window : globalThis);
