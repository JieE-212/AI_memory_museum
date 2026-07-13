(function initializeTimeIsleMediaEvidence(global) {
  "use strict";

  const REGION_TYPES = Object.freeze({
    person: "人物",
    location: "地点",
    object: "物件",
    text: "文字",
    date: "日期",
    other: "其他"
  });
  const COORDINATE_SPACE = "canonical-preview-v1";

  function createController(config = {}) {
    const documentRef = config.document || global.document;
    const fetchImpl = config.fetch || (typeof global.fetch === "function" ? global.fetch.bind(global) : null);
    if (!documentRef || !fetchImpl) throw new Error("照片线索需要浏览器 DOM 和 fetch 支持。");

    let demo = Boolean(config.demo || config.interviewDemo);
    let destroyed = false;
    let session = 0;
    let memoryId = "";
    let root = null;
    let panel = null;
    let gallery = null;
    let galleryObserver = null;
    let elements = {};
    let mediaItems = [];
    let currentMedia = null;
    let currentIndex = -1;
    let imageReady = false;
    let mutation = false;
    let drag = null;
    let draftRegion = null;
    const annotationsByAsset = new Map();
    const loadingAssets = new Set();
    const requestControllers = new Set();
    const listeners = [];
    const timers = new Set();

    function open(memory, container) {
      if (destroyed) return;
      teardown();
      session += 1;
      memoryId = validId(memory?.id);
      root = container || null;
      panel = root?.querySelector?.("[data-media-evidence-panel]") || null;
      if (!memoryId || !panel) {
        teardown();
        return;
      }

      mediaItems = normalizedMemoryMedia(memory);
      gallery = root.querySelector(".memory-gallery");
      elements = collectElements(panel);
      if (!elements.form || !elements.surface || !elements.image || !elements.list || !elements.overlay) {
        teardown();
        return;
      }

      bind(panel, "toggle", handlePanelToggle);
      bind(root, "click", handleRootClick);
      bind(root, "keydown", handleRootKeydown);
      bind(root, "timeisle:media-ocr-saved", handleOcrSaved);
      bind(elements.form, "submit", saveAnnotation);
      bind(elements.coordinates, "input", updateDraftFromInputs);
      bind(elements.clearButton, "click", clearDraftRegion);
      bind(elements.surface, "pointerdown", beginDrag);
      bind(elements.surface, "pointermove", moveDrag);
      bind(elements.surface, "pointerup", finishDrag);
      bind(elements.surface, "pointercancel", cancelDrag);
      bind(elements.image, "load", handleImageLoad);
      bind(elements.image, "error", handleImageError);

      if (gallery && typeof global.MutationObserver === "function") {
        galleryObserver = new global.MutationObserver(() => syncGalleryIndex());
        galleryObserver.observe(gallery, { attributes: true, attributeFilter: ["data-gallery-index"] });
      }
      updateReadOnlyState();
      if (panel.open) activateCurrentMedia();
    }

    function close() {
      if (destroyed) return;
      teardown();
      session += 1;
    }

    function destroy() {
      if (destroyed) return;
      teardown();
      session += 1;
      destroyed = true;
    }

    function setDemo(value) {
      demo = Boolean(value);
      updateReadOnlyState();
      if (panel?.open && currentMedia) renderAnnotations();
    }

    function handlePanelToggle() {
      if (panel.open) activateCurrentMedia();
    }

    function handleRootClick(event) {
      if (event.target.closest("[data-media-gallery-action]")) defer(syncGalleryIndex);
      const action = event.target.closest("[data-evidence-action]");
      if (!action || !panel.contains(action)) return;
      const annotationId = action.dataset.annotationId || "";
      if (action.dataset.evidenceAction === "locate" || action.dataset.evidenceAction === "focus-region") {
        locateAnnotation(annotationId);
      }
      if (action.dataset.evidenceAction === "delete") deleteAnnotation(annotationId);
      if (action.dataset.evidenceAction === "retry") loadAnnotations(currentMedia, true);
    }

    function handleRootKeydown(event) {
      if (event.target.closest?.("[data-media-gallery-action]") && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
        defer(syncGalleryIndex);
      }
    }

    function handleOcrSaved(event) {
      const annotation = event.detail?.annotation;
      const assetId = validId(event.detail?.assetId);
      if (event.detail?.memoryId !== memoryId || !assetId || !validAnnotation(annotation)) return;
      const annotations = annotationsByAsset.get(assetId) || [];
      if (!annotations.some((item) => item.id === annotation.id)) {
        annotationsByAsset.set(assetId, [...annotations, annotation]);
      }
      if (currentMedia?.assetId === assetId) renderAnnotations();
    }

    function activateCurrentMedia() {
      syncGalleryIndex(true);
    }

    function syncGalleryIndex(force = false) {
      if (!panel?.open) return;
      const index = Math.max(0, Math.min(mediaItems.length - 1, Number(gallery?.dataset.galleryIndex || 0) || 0));
      if (!force && index === currentIndex) return;
      selectMedia(index);
    }

    function selectMedia(index) {
      const changed = currentIndex !== index;
      currentIndex = index;
      currentMedia = mediaItems[index] || null;
      if (changed) elements.form.reset();
      clearDraftRegion();
      setStatus("", "");
      elements.current.textContent = mediaItems.length
        ? `当前：第 ${index + 1} 张，共 ${mediaItems.length} 张`
        : "当前展品没有可标注的照片";

      if (!currentMedia?.eligible) {
        elements.image.removeAttribute("src");
        elements.image.hidden = true;
        elements.surface.hidden = true;
        elements.unavailable.hidden = false;
        elements.unavailable.textContent = "这张旧版图片没有可验证的媒体 ID，暂不能添加区域线索。";
        elements.list.replaceChildren();
        setStatus("", "");
        updateReadOnlyState();
        return;
      }

      elements.unavailable.hidden = true;
      elements.surface.hidden = false;
      elements.surface.setAttribute("aria-busy", "true");
      elements.surface.setAttribute("aria-label", `第 ${index + 1} 张照片的线索圈选区`);
      elements.image.hidden = false;
      elements.image.alt = currentMedia.altText || currentMedia.caption || `第 ${index + 1} 张记忆照片`;
      elements.image.dataset.assetId = currentMedia.assetId;
      imageReady = false;
      applySurfaceDimensions(currentMedia.width, currentMedia.height);
      elements.image.src = currentMedia.url;
      if (elements.image.complete && elements.image.naturalWidth) defer(handleImageLoad);
      renderAnnotations();
      updateReadOnlyState();
      loadAnnotations(currentMedia);
    }

    async function loadAnnotations(media, force = false) {
      if (!media?.eligible || loadingAssets.has(media.assetId)) return;
      if (!force && annotationsByAsset.has(media.assetId)) {
        if (currentMedia?.assetId === media.assetId) renderAnnotations();
        return;
      }
      const activeSession = session;
      loadingAssets.add(media.assetId);
      if (currentMedia?.assetId === media.assetId) {
        elements.list.setAttribute("aria-busy", "true");
        setStatus("正在读取这张照片的线索…", "");
      }
      try {
        const payload = await requestJson(annotationCollectionUrl(media.assetId));
        if (activeSession !== session) return;
        annotationsByAsset.set(media.assetId, Array.isArray(payload.annotations) ? payload.annotations : []);
        if (currentMedia?.assetId === media.assetId) {
          renderAnnotations();
          setStatus("", "");
        }
      } catch (error) {
        if (activeSession !== session || error.name === "AbortError") return;
        if (currentMedia?.assetId === media.assetId) {
          renderLoadError(errorMessage(error));
          setStatus(errorMessage(error), "error");
        }
      } finally {
        loadingAssets.delete(media.assetId);
        if (activeSession === session && currentMedia?.assetId === media.assetId) {
          elements.list.removeAttribute("aria-busy");
        }
      }
    }

    async function saveAnnotation(event) {
      event.preventDefault();
      if (demo || mutation || !currentMedia?.eligible) return;
      let region;
      try {
        region = readRegion(true);
      } catch (error) {
        setStatus(error.message, "error");
        return;
      }
      const label = elements.label.value.trim();
      if (!label) {
        setStatus("请先写一条简短说明。", "error");
        elements.label.focus();
        return;
      }
      if (!REGION_TYPES[elements.regionType.value]) {
        setStatus("请选择这条线索的类型。", "error");
        elements.regionType.focus();
        return;
      }
      if (!elements.confirm.checked) {
        setStatus("保存前，请确认这是你亲自核对的画面区域。", "error");
        elements.confirm.focus();
        return;
      }

      const activeSession = session;
      const media = currentMedia;
      setMutation(true);
      setStatus("正在保存你确认的照片线索…", "");
      try {
        const payload = await requestJson(annotationCollectionUrl(media.assetId), {
          method: "POST",
          body: JSON.stringify({
            region,
            regionType: elements.regionType.value,
            label,
            note: elements.note.value.trim(),
            sensitive: elements.sensitive.checked
          })
        });
        if (activeSession !== session) return;
        if (!validAnnotation(payload.annotation)) throw new Error("服务器没有返回完整的照片线索。");
        const annotations = annotationsByAsset.get(media.assetId) || [];
        annotationsByAsset.set(media.assetId, [...annotations, payload.annotation].filter(Boolean));
        if (currentMedia?.assetId === media.assetId) {
          resetFormAfterSave();
          renderAnnotations();
          setStatus("照片线索已保存，并标记为由你确认。", "success");
          defer(() => locateAnnotation(payload.annotation?.id || ""));
        }
      } catch (error) {
        if (activeSession !== session || error.name === "AbortError") return;
        setStatus(errorMessage(error), "error");
      } finally {
        if (activeSession === session) setMutation(false);
      }
    }

    async function deleteAnnotation(annotationId) {
      if (demo || mutation || !currentMedia?.eligible || !validId(annotationId)) return;
      const media = currentMedia;
      const annotations = annotationsByAsset.get(media.assetId) || [];
      const annotation = annotations.find((item) => item.id === annotationId);
      if (!annotation) return;
      if (!global.confirm(`确定删除照片线索“${annotation.label || "未命名线索"}”吗？`)) return;

      const activeSession = session;
      setMutation(true);
      setStatus("正在删除照片线索…", "");
      try {
        await requestJson(`${annotationCollectionUrl(media.assetId)}/${encodeURIComponent(annotationId)}`, { method: "DELETE" });
        if (activeSession !== session) return;
        annotationsByAsset.set(media.assetId, annotations.filter((item) => item.id !== annotationId));
        if (currentMedia?.assetId === media.assetId) {
          renderAnnotations();
          setStatus("照片线索已删除。", "success");
          elements.listHeading.focus({ preventScroll: true });
        }
      } catch (error) {
        if (activeSession !== session || error.name === "AbortError") return;
        setStatus(errorMessage(error), "error");
      } finally {
        if (activeSession === session) setMutation(false);
      }
    }

    function beginDrag(event) {
      if (demo || mutation || !imageReady || event.button !== 0 || !currentMedia?.eligible) return;
      if (event.target.closest("[data-evidence-action='focus-region']")) return;
      const point = pointerPoint(event);
      if (!point) return;
      drag = { pointerId: event.pointerId, start: point, current: point };
      elements.surface.setPointerCapture?.(event.pointerId);
      elements.surface.classList.add("is-drawing");
      event.preventDefault();
      drawDraft(regionFromPoints(point, point));
    }

    function moveDrag(event) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const point = pointerPoint(event);
      if (!point) return;
      drag.current = point;
      event.preventDefault();
      drawDraft(regionFromPoints(drag.start, point));
    }

    function finishDrag(event) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const point = pointerPoint(event) || drag.current;
      const region = regionFromPoints(drag.start, point);
      elements.surface.releasePointerCapture?.(event.pointerId);
      elements.surface.classList.remove("is-drawing");
      drag = null;
      event.preventDefault();
      if (!regionHasMinimumSize(region)) {
        clearDraftRegion();
        setStatus("圈选区域太小，请拖出一个更清晰的范围。", "error");
        return;
      }
      setRegionInputs(region);
      drawDraft(region);
      setStatus("区域已圈选，请补充说明并确认后保存。", "");
      elements.label.focus();
    }

    function cancelDrag(event) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      elements.surface.releasePointerCapture?.(event.pointerId);
      elements.surface.classList.remove("is-drawing");
      drag = null;
      clearDraftRegion();
    }

    function pointerPoint(event) {
      const rect = elements.surface.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      return {
        x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
        y: clamp((event.clientY - rect.top) / rect.height, 0, 1)
      };
    }

    function regionFromPoints(start, end) {
      const x = Math.min(start.x, end.x);
      const y = Math.min(start.y, end.y);
      return normalizeRegion({ x, y, width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) });
    }

    function updateDraftFromInputs() {
      try {
        const region = readRegion(false);
        if (region) drawDraft(region);
        else hideDraft();
      } catch {
        hideDraft();
      }
    }

    function readRegion(strict) {
      const values = Object.fromEntries(elements.coordinateInputs.map((input) => [input.name, input.value.trim()]));
      if (Object.values(values).some((value) => value === "")) {
        if (!strict) return null;
        throw new Error("请圈选区域，或填写完整的 x、y、宽度和高度。 ");
      }
      const region = normalizeRegion(Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Number(value)])));
      if (![region.x, region.y, region.width, region.height].every(Number.isFinite)) throw new Error("区域坐标必须是数字。");
      if (region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0 || region.x >= 1 || region.y >= 1) {
        throw new Error("区域坐标必须位于 0 到 1 的画面范围内。");
      }
      if (region.x + region.width > 1.000001 || region.y + region.height > 1.000001) {
        throw new Error("区域超出照片边界，请调整坐标。");
      }
      if (!regionHasMinimumSize(region)) throw new Error("区域太小，请至少覆盖 4 × 4 个图片像素。");
      return region;
    }

    function regionHasMinimumSize(region) {
      const width = Number(currentMedia?.width || elements.image.naturalWidth || 0);
      const height = Number(currentMedia?.height || elements.image.naturalHeight || 0);
      return width > 0 && height > 0 && region.width * width >= 4 && region.height * height >= 4;
    }

    function setRegionInputs(region) {
      elements.coordinateInputs.forEach((input) => {
        input.value = formatCoordinate(region[input.name]);
      });
    }

    function clearDraftRegion() {
      drag = null;
      draftRegion = null;
      if (elements.coordinateInputs) elements.coordinateInputs.forEach((input) => { input.value = ""; });
      hideDraft();
    }

    function drawDraft(region) {
      draftRegion = region;
      applyRegionBox(elements.draft, region);
      elements.draft.hidden = false;
    }

    function hideDraft() {
      draftRegion = null;
      if (elements.draft) elements.draft.hidden = true;
    }

    function resetFormAfterSave() {
      elements.form.reset();
      clearDraftRegion();
      updateReadOnlyState();
    }

    function renderAnnotations() {
      if (!elements.overlay || !elements.list || !currentMedia?.eligible) return;
      const annotations = (annotationsByAsset.get(currentMedia.assetId) || []).filter(validAnnotation);
      elements.overlay.replaceChildren();
      elements.list.replaceChildren();
      elements.summary.textContent = demo
        ? `已有 ${annotations.length} 条 · Demo 只读`
        : annotations.length ? `已有 ${annotations.length} 条` : "可选 · 由你确认";

      annotations.forEach((annotation, index) => {
        const regionButton = documentRef.createElement("button");
        regionButton.type = "button";
        regionButton.className = "media-evidence-region";
        regionButton.dataset.evidenceAction = "focus-region";
        regionButton.dataset.annotationId = annotation.id;
        regionButton.dataset.regionNumber = String(index + 1);
        const invalidated = annotation.integrityStatus === "source_invalidated";
        regionButton.setAttribute("aria-label", `照片线索 ${index + 1}：${annotation.label}，类型：${regionTypeLabel(annotation.regionType)}${invalidated ? "；图片来源已变化，请重新核对" : ""}`);
        regionButton.classList.toggle("is-invalidated", invalidated);
        applyRegionBox(regionButton, annotation.locator);
        elements.overlay.append(regionButton);

        const item = documentRef.createElement("li");
        item.className = "media-evidence-list-item";
        const locate = documentRef.createElement("button");
        locate.type = "button";
        locate.className = "media-evidence-locate";
        locate.dataset.evidenceAction = "locate";
        locate.dataset.annotationId = annotation.id;
        locate.setAttribute("aria-label", `在照片中定位线索：${annotation.label}`);
        const title = documentRef.createElement("strong");
        title.textContent = `${index + 1}. ${annotation.label}`;
        const meta = documentRef.createElement("span");
        meta.textContent = [
          regionTypeLabel(annotation.regionType),
          annotation.sensitive ? "敏感" : "由你确认",
          invalidated ? "图片来源已变化" : ""
        ].filter(Boolean).join(" · ");
        locate.append(title, meta);
        item.append(locate);
        if (annotation.note) {
          const note = documentRef.createElement("p");
          note.textContent = annotation.note;
          item.append(note);
        }
        const remove = documentRef.createElement("button");
        remove.type = "button";
        remove.className = "media-evidence-delete";
        remove.dataset.evidenceAction = "delete";
        remove.dataset.annotationId = annotation.id;
        remove.textContent = "删除";
        remove.setAttribute("aria-label", `删除照片线索：${annotation.label}`);
        remove.disabled = demo || mutation;
        remove.hidden = demo;
        item.append(remove);
        elements.list.append(item);
      });

      if (!annotations.length && !loadingAssets.has(currentMedia.assetId)) {
        const empty = documentRef.createElement("li");
        empty.className = "media-evidence-empty";
        empty.textContent = demo ? "这张照片还没有已确认的区域线索。" : "还没有线索。可以在照片上拖拽圈选，或直接填写坐标。";
        elements.list.append(empty);
      }
      updateReadOnlyState();
    }

    function renderLoadError(message) {
      elements.overlay.replaceChildren();
      elements.list.replaceChildren();
      const item = documentRef.createElement("li");
      item.className = "media-evidence-empty is-error";
      item.textContent = message;
      const retry = documentRef.createElement("button");
      retry.type = "button";
      retry.className = "button secondary compact";
      retry.dataset.evidenceAction = "retry";
      retry.textContent = "重新读取";
      item.append(retry);
      elements.list.append(item);
    }

    function locateAnnotation(annotationId) {
      if (!annotationId) return;
      const region = [...elements.overlay.querySelectorAll("[data-annotation-id]")]
        .find((item) => item.dataset.annotationId === annotationId);
      if (!region) return;
      region.focus({ preventScroll: true });
      region.scrollIntoView({ block: "nearest", inline: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
      region.classList.add("is-highlighted");
      const timer = global.setTimeout(() => {
        region.classList.remove("is-highlighted");
        timers.delete(timer);
      }, 1400);
      timers.add(timer);
    }

    function handleImageLoad() {
      if (!currentMedia || elements.image.dataset.assetId !== currentMedia.assetId) return;
      imageReady = true;
      elements.surface.removeAttribute("aria-busy");
      elements.surface.classList.remove("has-image-error");
      elements.image.hidden = false;
      applySurfaceDimensions(currentMedia?.width || elements.image.naturalWidth, currentMedia?.height || elements.image.naturalHeight);
      if (draftRegion) drawDraft(draftRegion);
      updateReadOnlyState();
    }

    function applySurfaceDimensions(widthValue, heightValue) {
      const width = Number(widthValue) || 0;
      const height = Number(heightValue) || 0;
      if (!width || !height) {
        elements.surface.style.removeProperty("aspect-ratio");
        elements.surface.style.removeProperty("max-width");
        return;
      }
      const ratio = width / height;
      elements.surface.style.aspectRatio = `${width} / ${height}`;
      elements.surface.style.maxWidth = `${Math.min(900, Math.max(240, Math.round(520 * ratio)))}px`;
    }

    function handleImageError() {
      if (!currentMedia || elements.image.dataset.assetId !== currentMedia.assetId) return;
      imageReady = false;
      elements.surface.removeAttribute("aria-busy");
      elements.surface.classList.add("has-image-error");
      setStatus("照片暂时无法显示，仍可稍后重试读取展品。", "error");
      updateReadOnlyState();
    }

    function updateReadOnlyState() {
      if (!elements.form) return;
      const disabled = demo || mutation || !currentMedia?.eligible || !imageReady;
      [...elements.form.elements].forEach((control) => { control.disabled = disabled; });
      elements.form.hidden = demo;
      elements.readOnly.hidden = !demo;
      elements.surface.classList.toggle("is-read-only", demo);
      elements.list.querySelectorAll("[data-evidence-action='delete']").forEach((button) => {
        button.disabled = demo || mutation;
        button.hidden = demo;
      });
    }

    function setMutation(value) {
      mutation = Boolean(value);
      updateReadOnlyState();
    }

    function setStatus(message, kind) {
      if (!elements.status) return;
      elements.status.textContent = message || "";
      elements.status.classList.toggle("is-error", kind === "error");
      elements.status.classList.toggle("is-success", kind === "success");
    }

    async function requestJson(url, options = {}) {
      const controller = typeof global.AbortController === "function" ? new global.AbortController() : null;
      if (controller) requestControllers.add(controller);
      try {
        const response = await fetchImpl(url, {
          ...options,
          headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) },
          ...(controller ? { signal: controller.signal } : {})
        });
        const contentType = String(response.headers?.get?.("content-type") || "");
        const payload = contentType.includes("application/json") ? await response.json() : await response.text();
        if (!response.ok) {
          const error = new Error(typeof payload === "object" ? payload.error : payload || `请求失败（${response.status}）`);
          error.status = response.status;
          throw error;
        }
        return payload;
      } finally {
        if (controller) requestControllers.delete(controller);
      }
    }

    function annotationCollectionUrl(assetId) {
      return `/api/memories/${encodeURIComponent(memoryId)}/media/${encodeURIComponent(assetId)}/annotations`;
    }

    function teardown() {
      requestControllers.forEach((controller) => controller.abort());
      requestControllers.clear();
      listeners.splice(0).forEach(({ target, type, handler, options }) => target.removeEventListener(type, handler, options));
      galleryObserver?.disconnect();
      galleryObserver = null;
      timers.forEach((timer) => global.clearTimeout(timer));
      timers.clear();
      if (elements.image) {
        elements.image.removeAttribute("src");
        delete elements.image.dataset.assetId;
        elements.image.alt = "";
      }
      annotationsByAsset.clear();
      loadingAssets.clear();
      memoryId = "";
      root = null;
      panel = null;
      gallery = null;
      elements = {};
      mediaItems = [];
      currentMedia = null;
      currentIndex = -1;
      imageReady = false;
      mutation = false;
      drag = null;
      draftRegion = null;
    }

    function bind(target, type, handler, options) {
      if (!target) return;
      target.addEventListener(type, handler, options);
      listeners.push({ target, type, handler, options });
    }

    return Object.freeze({ open, close, setDemo, destroy });
  }

  function renderPanel(memory = {}) {
    const media = normalizedMemoryMedia(memory);
    if (!media.some((item) => item.eligible)) return "";
    return `<details class="media-evidence-panel" data-media-evidence-panel>
      <summary>
        <span><strong>照片线索</strong><small data-evidence-summary>可选 · 由你确认</small></span>
        <span aria-hidden="true">＋</span>
      </summary>
      <div class="media-evidence-body">
        <div class="media-evidence-heading">
          <p>圈出画面中值得留存的区域。这里只记录你的判断，不会生成或补写 AI 结论。</p>
          <span data-evidence-current></span>
        </div>
        <p class="media-evidence-readonly" data-evidence-readonly hidden>公开 Demo 仅展示已确认线索，不允许新增或删除。</p>
        <div class="media-evidence-layout">
          <section class="media-evidence-workspace" aria-label="照片区域圈选">
            <div class="media-evidence-surface" data-evidence-surface aria-describedby="mediaEvidencePointerHint" hidden>
              <img data-evidence-image alt="" draggable="false" />
              <div class="media-evidence-overlay" data-evidence-overlay></div>
              <span class="media-evidence-draft" data-evidence-draft aria-hidden="true" hidden></span>
              <span class="media-evidence-image-error" aria-hidden="true">照片暂时无法显示</span>
            </div>
            <p class="media-evidence-unavailable" data-evidence-unavailable hidden></p>
            <p class="media-evidence-pointer-hint" id="mediaEvidencePointerHint">鼠标或触摸拖拽可圈选；键盘用户可直接填写下方 0–1 坐标。</p>
          </section>
          <form class="media-evidence-form" data-evidence-form>
            <div class="media-evidence-form-grid">
              <label>线索类型
                <select name="regionType" data-evidence-region-type required>
                  <option value="">请选择</option>
                  ${Object.entries(REGION_TYPES).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}
                </select>
              </label>
              <label>简短说明
                <input name="label" data-evidence-label type="text" maxlength="80" required placeholder="例如：外婆手里的旧车票" />
              </label>
            </div>
            <label>备注（可选）
              <textarea name="note" data-evidence-note maxlength="240" placeholder="补充这条线索为何重要"></textarea>
            </label>
            <fieldset class="media-evidence-coordinates" data-evidence-coordinates>
              <legend>区域坐标 <span>左上角为 0，右下角为 1</span></legend>
              <div>
                ${coordinateInput("x", "X", "0.120")}
                ${coordinateInput("y", "Y", "0.180")}
                ${coordinateInput("width", "宽度", "0.320")}
                ${coordinateInput("height", "高度", "0.240")}
              </div>
              <button type="button" class="media-evidence-clear" data-evidence-clear>清除区域</button>
            </fieldset>
            <label class="media-evidence-check"><input name="sensitive" data-evidence-sensitive type="checkbox" /> 这一区域包含敏感信息</label>
            <label class="media-evidence-check is-confirm"><input name="confirm" data-evidence-confirm type="checkbox" required /> 我已亲自核对圈选区域与说明，并确认保存</label>
            <button type="submit" class="button primary compact">保存照片线索</button>
          </form>
        </div>
        <section class="media-evidence-results" aria-labelledby="mediaEvidenceListHeading">
          <h3 id="mediaEvidenceListHeading" data-evidence-list-heading tabindex="-1">已确认线索</h3>
          <ol class="media-evidence-list" data-evidence-list aria-live="polite"></ol>
        </section>
        <p class="media-evidence-status" data-evidence-status role="status" aria-live="polite"></p>
      </div>
    </details>`;
  }

  function collectElements(panel) {
    const coordinates = panel.querySelector("[data-evidence-coordinates]");
    return {
      summary: panel.querySelector("[data-evidence-summary]"),
      current: panel.querySelector("[data-evidence-current]"),
      readOnly: panel.querySelector("[data-evidence-readonly]"),
      surface: panel.querySelector("[data-evidence-surface]"),
      image: panel.querySelector("[data-evidence-image]"),
      overlay: panel.querySelector("[data-evidence-overlay]"),
      draft: panel.querySelector("[data-evidence-draft]"),
      unavailable: panel.querySelector("[data-evidence-unavailable]"),
      form: panel.querySelector("[data-evidence-form]"),
      regionType: panel.querySelector("[data-evidence-region-type]"),
      label: panel.querySelector("[data-evidence-label]"),
      note: panel.querySelector("[data-evidence-note]"),
      sensitive: panel.querySelector("[data-evidence-sensitive]"),
      confirm: panel.querySelector("[data-evidence-confirm]"),
      coordinates,
      coordinateInputs: coordinates ? [...coordinates.querySelectorAll("input[type='number']")] : [],
      clearButton: panel.querySelector("[data-evidence-clear]"),
      listHeading: panel.querySelector("[data-evidence-list-heading]"),
      list: panel.querySelector("[data-evidence-list]"),
      status: panel.querySelector("[data-evidence-status]")
    };
  }

  function coordinateInput(name, label, placeholder) {
    return `<label>${label}<input name="${name}" type="number" min="0" max="1" step="0.001" inputmode="decimal" placeholder="${placeholder}" /></label>`;
  }

  function normalizedMemoryMedia(memory) {
    return (Array.isArray(memory?.media) ? [...memory.media] : [])
      .filter((item) => item && typeof item === "object")
      .sort((left, right) => Number(left.position || 0) - Number(right.position || 0))
      .map((item) => {
        const assetId = validId(item.assetId || item.id);
        const url = safeMediaUrl(item.urls?.display || item.urls?.thumb || item.urls?.original || item.url);
        return {
          assetId,
          url,
          eligible: Boolean(assetId && url),
          caption: String(item.caption || ""),
          altText: String(item.altText || ""),
          width: Number(item.width) || 0,
          height: Number(item.height) || 0
        };
      })
      .filter((item) => item.url);
  }

  function validAnnotation(annotation) {
    const locator = annotation?.locator;
    return Boolean(validId(annotation?.id)
      && locator?.coordinateSpace === COORDINATE_SPACE
      && [locator.x, locator.y, locator.width, locator.height].every((value) => Number.isFinite(Number(value)))
      && Number(locator.x) >= 0
      && Number(locator.y) >= 0
      && Number(locator.width) > 0
      && Number(locator.height) > 0
      && Number(locator.x) + Number(locator.width) <= 1.000001
      && Number(locator.y) + Number(locator.height) <= 1.000001);
  }

  function applyRegionBox(element, region) {
    if (!element || !region) return;
    element.style.left = `${Number(region.x) * 100}%`;
    element.style.top = `${Number(region.y) * 100}%`;
    element.style.width = `${Number(region.width) * 100}%`;
    element.style.height = `${Number(region.height) * 100}%`;
  }

  function normalizeRegion(region) {
    return {
      x: roundCoordinate(region.x),
      y: roundCoordinate(region.y),
      width: roundCoordinate(region.width),
      height: roundCoordinate(region.height)
    };
  }

  function roundCoordinate(value) {
    return Math.round(Number(value) * 1_000_000) / 1_000_000;
  }

  function formatCoordinate(value) {
    return Number(value).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  }

  function regionTypeLabel(value) {
    return REGION_TYPES[value] || REGION_TYPES.other;
  }

  function safeMediaUrl(value) {
    const url = String(value || "").trim();
    return /^(?:\/|https?:\/\/|blob:|data:image\/)/i.test(url) ? url : "";
  }

  function validId(value) {
    const id = String(value || "").trim();
    return /^[a-zA-Z0-9_-]{1,120}$/.test(id) ? id : "";
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function defer(callback) {
    if (typeof global.queueMicrotask === "function") global.queueMicrotask(callback);
    else Promise.resolve().then(callback);
  }

  function prefersReducedMotion() {
    return Boolean(global.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  }

  function errorMessage(error) {
    return String(error?.message || error || "照片线索操作失败。");
  }

  global.TimeIsleMediaEvidence = Object.freeze({ createController, renderPanel });
})(typeof window !== "undefined" ? window : globalThis);
