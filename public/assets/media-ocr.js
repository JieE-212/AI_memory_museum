(function initializeTimeIsleMediaOcr(global) {
  "use strict";

  const ROOT_SELECTOR = "[data-media-ocr-panel]";
  const COORDINATE_SPACE = "canonical-preview-v1";
  const MAX_DRAFT_LENGTH = 240;
  const MAX_CANVAS_EDGE = 2048;
  const MAX_CANVAS_PIXELS = 4_000_000;
  const controllerByRoot = new WeakMap();
  let renderSequence = 0;

  function renderOcrPanel(context = {}, escape) {
    const memoryId = validId(context.memoryId || context.memory?.id);
    const assetId = validId(context.assetId || context.media?.assetId || context.media?.id);
    const displayUrl = safeLocalMediaUrl(context.displayUrl || context.media?.urls?.display || context.media?.url);
    if (!memoryId || !assetId || !displayUrl) return "";

    const escapeText = typeof escape === "function"
      ? (value) => String(escape(String(value ?? "")))
      : escapeHtml;
    const regions = normalizeExistingRegions(context.existingRegions || context.regions);
    const instanceId = `media-ocr-${++renderSequence}`;
    const demo = Boolean(context.demo || context.interviewDemo);
    const altText = String(context.altText || context.media?.altText || context.media?.caption || "待摘录文字的照片");

    return `<details class="media-ocr-panel" data-media-ocr-panel
      data-memory-id="${escapeAttribute(memoryId)}"
      data-asset-id="${escapeAttribute(assetId)}"
      data-display-url="${escapeAttribute(displayUrl)}"
      data-demo="${demo ? "true" : "false"}">
      <summary>
        <span><strong>照片文字摘录</strong><small>辅助摘录 · 默认不保存</small></span>
        <span aria-hidden="true">＋</span>
      </summary>
      <div class="media-ocr-body">
        <p class="media-ocr-boundary" id="${instanceId}-boundary"><strong>这是辅助摘录，不是事实判断。</strong>本机识别只会生成可编辑草稿；你核对并确认前，不会保存，也不会自动写入展品正文。</p>
        <p class="media-ocr-engine" data-ocr-engine role="status" aria-live="polite">正在检查本机文字检测能力……</p>
        ${demo ? `<p class="media-ocr-readonly" data-ocr-readonly>公开 Demo 可在本机试摘录，但不会保存任何图片文字。</p>` : ""}
        <div class="media-ocr-layout">
          <section class="media-ocr-workspace" aria-label="照片文字区域选择">
            <div class="media-ocr-surface" data-ocr-surface aria-describedby="${instanceId}-coordinate-help">
              <img data-ocr-image alt="${escapeAttribute(altText)}" decoding="async" draggable="false" />
              <span class="media-ocr-region" data-ocr-region aria-hidden="true" hidden></span>
              <span class="media-ocr-image-state" data-ocr-image-state>展开后载入本地展示图</span>
            </div>
            <p class="media-ocr-coordinate-help" id="${instanceId}-coordinate-help">拖拽圈选照片中的文字；键盘用户可直接填写 0–1 坐标。只有圈选区域会交给浏览器本机检测。</p>
            ${renderExistingRegions(regions, escapeText)}
          </section>
          <form class="media-ocr-form" data-ocr-form aria-describedby="${instanceId}-boundary">
            <fieldset class="media-ocr-coordinates" data-ocr-coordinates>
              <legend>摘录区域 <span>左上角为 0，右下角为 1</span></legend>
              <div>
                ${coordinateInput("x", "X")}
                ${coordinateInput("y", "Y")}
                ${coordinateInput("width", "宽度")}
                ${coordinateInput("height", "高度")}
              </div>
              <button type="button" class="media-ocr-clear" data-ocr-action="clear-region">清除区域</button>
            </fieldset>
            <button type="button" class="button button-ghost media-ocr-detect" data-ocr-action="detect" disabled>在本机识别所选区域</button>
            <p class="media-ocr-manual" data-ocr-manual>无论浏览器是否支持识别，你都可以在下方手动摘录和修正。</p>
            <label class="media-ocr-draft-label">可编辑摘录草稿
              <textarea data-ocr-draft name="draft" maxlength="${MAX_DRAFT_LENGTH}" required placeholder="请手动输入，或先圈选区域后使用本机识别"></textarea>
            </label>
            <p class="media-ocr-draft-state" data-ocr-draft-state>尚无草稿 · 尚未确认</p>
            <label class="media-ocr-check"><input data-ocr-sensitive name="sensitive" type="checkbox" checked /> 将这段照片文字标记为敏感信息</label>
            <label class="media-ocr-check is-confirm"><input data-ocr-confirm name="confirm" type="checkbox" required /> 我已核对圈选区域和摘录文字，确认将它保存为照片区域证据</label>
            <button type="submit" class="button primary compact" data-ocr-save${demo ? " disabled" : ""}>保存已确认摘录</button>
          </form>
        </div>
        <p class="media-ocr-status" data-ocr-status role="status" aria-live="polite"></p>
      </div>
    </details>`;
  }

  function renderExistingRegions(regions, escapeText) {
    if (!regions.length) return "";
    return `<div class="media-ocr-existing" data-ocr-existing>
      <p>也可以主动沿用一条已有圈选区域：</p>
      <div>${regions.map((item, index) => `<button type="button"
        data-ocr-existing-region
        data-x="${item.x}" data-y="${item.y}"
        data-width="${item.width}" data-height="${item.height}">${escapeText(item.label || `已有区域 ${index + 1}`)}</button>`).join("")}</div>
    </div>`;
  }

  function coordinateInput(name, label) {
    return `<label>${label}<input type="number" name="${name}" data-ocr-coordinate="${name}" min="0" max="1" step="0.001" inputmode="decimal" autocomplete="off" /></label>`;
  }

  function hydrate(container, options = {}) {
    const scope = container || global.document;
    if (!scope) return [];
    const roots = [];
    if (typeof scope.matches === "function" && scope.matches(ROOT_SELECTOR)) roots.push(scope);
    if (typeof scope.querySelectorAll === "function") {
      scope.querySelectorAll(ROOT_SELECTOR).forEach((root) => {
        if (!roots.includes(root)) roots.push(root);
      });
    }
    return roots.map((root) => controllerByRoot.get(root) || createController(root, options));
  }

  function createController(root, options = {}) {
    if (!root || typeof root.querySelector !== "function") {
      throw new TypeError("照片文字摘录需要一个有效的 DOM 容器。");
    }
    if (controllerByRoot.has(root)) return controllerByRoot.get(root);

    const documentRef = root.ownerDocument || global.document;
    const view = documentRef?.defaultView || global;
    const fetchImpl = options.fetch || (typeof view.fetch === "function" ? view.fetch.bind(view) : null);
    const TextDetectorClass = options.TextDetector === null
      ? null
      : options.TextDetector || (typeof view.TextDetector === "function" ? view.TextDetector : null);
    const createBitmap = options.createImageBitmap || (typeof view.createImageBitmap === "function" ? view.createImageBitmap.bind(view) : null);
    const context = {
      memoryId: validId(root.dataset.memoryId),
      assetId: validId(root.dataset.assetId),
      displayUrl: safeLocalMediaUrl(root.dataset.displayUrl),
      demo: root.dataset.demo === "true"
    };
    const elements = {
      image: required(root, "[data-ocr-image]"),
      imageState: required(root, "[data-ocr-image-state]"),
      surface: required(root, "[data-ocr-surface]"),
      region: required(root, "[data-ocr-region]"),
      form: required(root, "[data-ocr-form]"),
      coordinates: [...root.querySelectorAll("[data-ocr-coordinate]")],
      detect: required(root, '[data-ocr-action="detect"]'),
      draft: required(root, "[data-ocr-draft]"),
      draftState: required(root, "[data-ocr-draft-state]"),
      sensitive: required(root, "[data-ocr-sensitive]"),
      confirm: required(root, "[data-ocr-confirm]"),
      save: required(root, "[data-ocr-save]"),
      engine: required(root, "[data-ocr-engine]"),
      manual: required(root, "[data-ocr-manual]"),
      status: required(root, "[data-ocr-status]")
    };
    const listeners = [];
    const requestControllers = new Set();
    let destroyed = false;
    let session = 1;
    let recognitionOperation = 0;
    let detector = null;
    let detectorAvailable = Boolean(TextDetectorClass);
    let imageReady = false;
    let dragStart = null;
    let draftRegion = null;
    let saving = false;

    function bind(target, type, handler, eventOptions) {
      if (!target) return;
      target.addEventListener(type, handler, eventOptions);
      listeners.push({ target, type, handler, eventOptions });
    }

    function initialize() {
      if (!context.memoryId || !context.assetId || !context.displayUrl) {
        setEngine("照片上下文无效，已停用摘录。", "error");
        disableActions();
        return;
      }
      setDetectorAvailability(detectorAvailable);
      bind(root, "toggle", handleToggle);
      bind(root, "click", handleClick);
      bind(elements.coordinates[0]?.closest("fieldset"), "input", handleCoordinateInput);
      bind(elements.surface, "pointerdown", beginSelection);
      bind(elements.surface, "pointermove", moveSelection);
      bind(elements.surface, "pointerup", finishSelection);
      bind(elements.surface, "pointercancel", cancelSelection);
      bind(elements.image, "load", handleImageLoad);
      bind(elements.image, "error", handleImageError);
      bind(elements.draft, "input", handleDraftInput);
      bind(elements.form, "submit", saveConfirmedDraft);
      if (root.open) activate();
    }

    function handleToggle() {
      if (root.open) activate();
      else suspend();
    }

    function activate() {
      if (destroyed || imageReady || elements.image.getAttribute("src")) return;
      elements.imageState.textContent = "正在载入本地展示图……";
      elements.image.src = context.displayUrl;
    }

    function suspend() {
      session += 1;
      recognitionOperation += 1;
      requestControllers.forEach((controller) => controller.abort());
      requestControllers.clear();
      saving = false;
      setBusy(false);
      setRecognitionBusy(false);
    }

    function handleImageLoad() {
      if (destroyed) return;
      imageReady = elements.image.naturalWidth > 0 && elements.image.naturalHeight > 0;
      elements.surface.classList.toggle("has-image", imageReady);
      elements.imageState.textContent = imageReady ? "" : "图片尺寸不可用";
      updateDetectButton();
    }

    function handleImageError() {
      imageReady = false;
      elements.surface.classList.remove("has-image");
      elements.imageState.textContent = "本地展示图暂时无法载入；你仍可填写坐标并手动摘录。";
      updateDetectButton();
    }

    function handleClick(event) {
      const existing = event.target.closest?.("[data-ocr-existing-region]");
      if (existing && root.contains(existing)) {
        setRegion(regionFromDataset(existing));
        setStatus("已沿用所选区域；请继续摘录并亲自核对。", "");
        return;
      }
      const action = event.target.closest?.("[data-ocr-action]");
      if (!action || !root.contains(action)) return;
      if (action.dataset.ocrAction === "clear-region") clearRegion();
      if (action.dataset.ocrAction === "detect") recognizeSelectedRegion();
    }

    function beginSelection(event) {
      if (!imageReady || event.button !== undefined && event.button !== 0) return;
      const point = normalizedPointer(event);
      if (!point) return;
      dragStart = point;
      draftRegion = { x: point.x, y: point.y, width: 0, height: 0 };
      elements.surface.setPointerCapture?.(event.pointerId);
      drawRegion(draftRegion);
      event.preventDefault();
    }

    function moveSelection(event) {
      if (!dragStart) return;
      const point = normalizedPointer(event);
      if (!point) return;
      draftRegion = regionBetween(dragStart, point);
      drawRegion(draftRegion);
      event.preventDefault();
    }

    function finishSelection(event) {
      if (!dragStart) return;
      const point = normalizedPointer(event);
      const next = point ? regionBetween(dragStart, point) : draftRegion;
      dragStart = null;
      elements.surface.releasePointerCapture?.(event.pointerId);
      if (!next || next.width < 0.003 || next.height < 0.003) {
        clearRegion();
        setStatus("圈选区域太小，请重新选择。", "error");
        return;
      }
      setRegion(next);
      setStatus("已圈选区域；本机识别只会读取这一范围。", "");
      event.preventDefault();
    }

    function cancelSelection(event) {
      dragStart = null;
      elements.surface.releasePointerCapture?.(event.pointerId);
      if (draftRegion && (draftRegion.width < 0.003 || draftRegion.height < 0.003)) clearRegion();
    }

    function normalizedPointer(event) {
      const bounds = elements.surface.getBoundingClientRect();
      if (!(bounds.width > 0) || !(bounds.height > 0)) return null;
      return {
        x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
        y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1)
      };
    }

    function handleCoordinateInput() {
      try {
        const region = readRegion(false);
        draftRegion = region;
        drawRegion(region);
        invalidateConfirmation("坐标已修改 · 尚未确认");
      } catch {
        draftRegion = null;
        elements.region.hidden = true;
        invalidateConfirmation("区域坐标尚未填写完整 · 尚未确认");
      }
      updateDetectButton();
    }

    function setRegion(region) {
      const normalized = normalizeRegion(region);
      draftRegion = normalized;
      elements.coordinates.forEach((input) => {
        input.value = formatCoordinate(normalized[input.dataset.ocrCoordinate]);
      });
      drawRegion(normalized);
      invalidateConfirmation("区域已修改 · 尚未确认");
      updateDetectButton();
    }

    function clearRegion() {
      draftRegion = null;
      elements.coordinates.forEach((input) => { input.value = ""; });
      elements.region.hidden = true;
      invalidateConfirmation("尚未选择区域 · 尚未确认");
      updateDetectButton();
    }

    function drawRegion(region) {
      if (!region || !(region.width > 0) || !(region.height > 0)) {
        elements.region.hidden = true;
        return;
      }
      elements.region.style.left = `${region.x * 100}%`;
      elements.region.style.top = `${region.y * 100}%`;
      elements.region.style.width = `${region.width * 100}%`;
      elements.region.style.height = `${region.height * 100}%`;
      elements.region.hidden = false;
    }

    async function recognizeSelectedRegion() {
      if (destroyed || saving || !detectorAvailable || !imageReady) return;
      let region;
      try {
        region = readRegion(true);
      } catch (error) {
        setStatus(error.message, "error");
        return;
      }

      const activeSession = session;
      const activeOperation = ++recognitionOperation;
      setRecognitionBusy(true);
      setStatus("正在使用浏览器本机能力识别所选区域；图片不会发送到第三方。", "");
      let bitmap = null;
      try {
        detector ||= new TextDetectorClass();
        const canvas = cropSelectedRegion(documentRef, elements.image, region);
        const source = createBitmap ? await createBitmap(canvas) : canvas;
        bitmap = source !== canvas ? source : null;
        const results = await detector.detect(source);
        if (destroyed || activeSession !== session || activeOperation !== recognitionOperation) return;
        const text = collectDetectedText(results);
        if (!text) {
          setStatus("本机检测没有返回可用文字；这不代表照片中没有文字，请手动摘录。", "");
          elements.draftState.textContent = elements.draft.value.trim()
            ? "保留现有可编辑草稿 · 尚未确认"
            : "未检测到文字 · 可手动摘录 · 尚未确认";
          elements.confirm.checked = false;
          return;
        }
        elements.draft.value = text.slice(0, MAX_DRAFT_LENGTH);
        elements.confirm.checked = false;
        elements.draftState.textContent = "本机识别初稿 · 必须由你编辑核对后确认";
        setStatus("已生成本机识别初稿，尚未保存。请逐字核对后再确认。", "success");
        elements.draft.focus();
      } catch (error) {
        if (destroyed || activeSession !== session || activeOperation !== recognitionOperation) return;
        setDetectorAvailability(false, "本机文字检测启动失败，已安全切换为手动摘录。图片未发送到第三方。");
        setStatus(readableError(error, "本机识别失败，请改为手动摘录。"), "error");
      } finally {
        bitmap?.close?.();
        if (!destroyed && activeSession === session && activeOperation === recognitionOperation) {
          setRecognitionBusy(false);
        }
      }
    }

    function handleDraftInput() {
      invalidateConfirmation(elements.draft.value.trim()
        ? "可编辑草稿已修改 · 尚未确认"
        : "尚无草稿 · 尚未确认");
    }

    function invalidateConfirmation(message) {
      elements.confirm.checked = false;
      elements.draftState.textContent = message;
    }

    async function saveConfirmedDraft(event) {
      event.preventDefault();
      if (destroyed || saving || context.demo) return;
      if (!fetchImpl) {
        setStatus("当前环境无法连接本地保存接口。", "error");
        return;
      }
      if (!elements.confirm.checked) {
        setStatus("请先亲自核对区域和摘录草稿，再勾选确认。", "error");
        elements.confirm.focus();
        return;
      }

      let region;
      try {
        region = readRegion(true);
      } catch (error) {
        setStatus(error.message, "error");
        return;
      }
      const text = elements.draft.value.trim();
      if (!text) {
        setStatus("请先填写并核对摘录草稿。", "error");
        elements.draft.focus();
        return;
      }

      const payload = {
        regionType: "text",
        label: text.slice(0, 80),
        note: text.length > 80 ? text.slice(0, MAX_DRAFT_LENGTH) : "",
        sensitive: elements.sensitive.checked,
        region
      };
      recognitionOperation += 1;
      const activeSession = session;
      const controller = new AbortController();
      requestControllers.add(controller);
      saving = true;
      setBusy(true);
      setStatus("正在保存已确认的照片区域证据……", "");
      try {
        const response = await fetchImpl(annotationCollectionUrl(context), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        const responsePayload = await readJson(response);
        if (destroyed || activeSession !== session) return;
        if (!response.ok) throw new Error(responsePayload?.error || `保存失败（HTTP ${response.status}）`);
        elements.confirm.checked = false;
        elements.draftState.textContent = "已由你确认并保存为照片区域证据";
        setStatus("摘录已保存为照片区域证据；展品正文没有被修改。", "success");
        dispatchSaved(responsePayload?.annotation || null);
      } catch (error) {
        if (destroyed || activeSession !== session || error?.name === "AbortError") return;
        setStatus(readableError(error, "摘录保存失败，请稍后重试。"), "error");
      } finally {
        requestControllers.delete(controller);
        if (!destroyed && activeSession === session) {
          saving = false;
          setBusy(false);
        }
      }
    }

    function readRegion(requireComplete) {
      const values = Object.fromEntries(elements.coordinates.map((input) => [
        input.dataset.ocrCoordinate,
        input.value === "" ? NaN : Number(input.value)
      ]));
      const complete = [values.x, values.y, values.width, values.height].every(Number.isFinite);
      if (!complete) {
        if (requireComplete) throw new Error("请先圈选图片文字区域，或完整填写四项坐标。");
        throw new Error("区域尚未填写完整。");
      }
      if (values.x < 0 || values.y < 0 || values.width <= 0 || values.height <= 0
        || values.x >= 1 || values.y >= 1 || values.x + values.width > 1.000001 || values.y + values.height > 1.000001) {
        throw new Error("区域坐标必须完整位于 0–1 的照片范围内。");
      }
      return normalizeRegion(values);
    }

    function setDetectorAvailability(available, overrideMessage = "") {
      detectorAvailable = Boolean(available);
      if (detectorAvailable) {
        setEngine("本机 TextDetector 可用 · 只识别你圈选的区域 · 不向第三方上传", "local");
        elements.manual.textContent = "识别结果只会进入可编辑草稿；你也可以完全手动摘录。";
      } else {
        setEngine(overrideMessage || "本机 TextDetector 不可用 · 当前仅提供手动摘录 · 不会伪装识别成功", "manual");
        elements.manual.textContent = "请在下方手动摘录；保存前仍需核对区域和文字。";
      }
      updateDetectButton();
    }

    function setEngine(message, state) {
      elements.engine.textContent = message;
      elements.engine.dataset.state = state;
    }

    function updateDetectButton() {
      elements.detect.hidden = !detectorAvailable;
      elements.detect.disabled = !detectorAvailable || !imageReady || !draftRegion || saving;
    }

    function setRecognitionBusy(value) {
      elements.detect.disabled = Boolean(value);
      elements.detect.textContent = value ? "正在本机识别……" : "在本机识别所选区域";
      if (!value) updateDetectButton();
    }

    function setBusy(value) {
      elements.form.setAttribute("aria-busy", value ? "true" : "false");
      elements.save.disabled = Boolean(value) || context.demo;
      elements.draft.disabled = Boolean(value);
      elements.confirm.disabled = Boolean(value);
      elements.sensitive.disabled = Boolean(value);
      elements.coordinates.forEach((input) => { input.disabled = Boolean(value); });
      updateDetectButton();
    }

    function disableActions() {
      elements.detect.disabled = true;
      elements.save.disabled = true;
      elements.form.querySelectorAll("input, textarea, button").forEach((item) => { item.disabled = true; });
    }

    function setStatus(message, state) {
      elements.status.textContent = message;
      elements.status.dataset.state = state;
    }

    function dispatchSaved(annotation) {
      if (!annotation || typeof root.dispatchEvent !== "function") return;
      const CustomEventClass = view.CustomEvent || global.CustomEvent;
      if (typeof CustomEventClass !== "function") return;
      root.dispatchEvent(new CustomEventClass("timeisle:media-ocr-saved", {
        bubbles: true,
        detail: { annotation, memoryId: context.memoryId, assetId: context.assetId }
      }));
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      suspend();
      listeners.forEach(({ target, type, handler, eventOptions }) => {
        target.removeEventListener(type, handler, eventOptions);
      });
      listeners.length = 0;
      elements.image.removeAttribute("src");
      detector = null;
      controllerByRoot.delete(root);
    }

    const controller = Object.freeze({ destroy, recognizeSelectedRegion });
    controllerByRoot.set(root, controller);
    initialize();
    return controller;
  }

  function cropSelectedRegion(documentRef, image, region) {
    const sourceWidth = Number(image.naturalWidth);
    const sourceHeight = Number(image.naturalHeight);
    if (!(sourceWidth > 0) || !(sourceHeight > 0)) throw new Error("图片尚未载入完成。");
    const cropWidth = Math.max(1, Math.round(sourceWidth * region.width));
    const cropHeight = Math.max(1, Math.round(sourceHeight * region.height));
    const scale = Math.min(
      1,
      MAX_CANVAS_EDGE / cropWidth,
      MAX_CANVAS_EDGE / cropHeight,
      Math.sqrt(MAX_CANVAS_PIXELS / (cropWidth * cropHeight))
    );
    const canvas = documentRef.createElement("canvas");
    canvas.width = Math.max(1, Math.round(cropWidth * scale));
    canvas.height = Math.max(1, Math.round(cropHeight * scale));
    const drawing = canvas.getContext("2d", { alpha: false });
    if (!drawing) throw new Error("浏览器无法创建本机图片处理画布。");
    drawing.drawImage(
      image,
      Math.round(sourceWidth * region.x),
      Math.round(sourceHeight * region.y),
      cropWidth,
      cropHeight,
      0,
      0,
      canvas.width,
      canvas.height
    );
    return canvas;
  }

  function collectDetectedText(results) {
    if (!Array.isArray(results)) return "";
    const lines = [];
    const seen = new Set();
    results.forEach((result) => {
      const value = String(result?.rawValue || result?.text || "").replace(/\s+/g, " ").trim();
      if (!value || seen.has(value)) return;
      seen.add(value);
      lines.push(value);
    });
    return lines.join("\n").slice(0, MAX_DRAFT_LENGTH);
  }

  function normalizeExistingRegions(input) {
    if (!Array.isArray(input)) return [];
    return input.map((item) => {
      const locator = item?.locator || item?.region || item;
      if (locator?.coordinateSpace && locator.coordinateSpace !== COORDINATE_SPACE) return null;
      try {
        const region = normalizeRegion(locator);
        if (region.x + region.width > 1.000001 || region.y + region.height > 1.000001) return null;
        return { ...region, label: String(item?.label || "").slice(0, 80) };
      } catch {
        return null;
      }
    }).filter(Boolean).slice(0, 12);
  }

  function normalizeRegion(region) {
    const values = {
      x: Number(region?.x),
      y: Number(region?.y),
      width: Number(region?.width),
      height: Number(region?.height)
    };
    if (![values.x, values.y, values.width, values.height].every(Number.isFinite)
      || values.x < 0 || values.y < 0 || values.width <= 0 || values.height <= 0) {
      throw new TypeError("图片区域坐标无效。");
    }
    return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, roundCoordinate(value)]));
  }

  function regionBetween(start, end) {
    return {
      x: roundCoordinate(Math.min(start.x, end.x)),
      y: roundCoordinate(Math.min(start.y, end.y)),
      width: roundCoordinate(Math.abs(start.x - end.x)),
      height: roundCoordinate(Math.abs(start.y - end.y))
    };
  }

  function regionFromDataset(element) {
    return normalizeRegion({
      x: element.dataset.x,
      y: element.dataset.y,
      width: element.dataset.width,
      height: element.dataset.height
    });
  }

  function annotationCollectionUrl(context) {
    return `/api/memories/${encodeURIComponent(context.memoryId)}/media/${encodeURIComponent(context.assetId)}/annotations`;
  }

  async function readJson(response) {
    const text = await response.text();
    if (!text) return {};
    try { return JSON.parse(text); } catch { return {}; }
  }

  function required(root, selector) {
    const element = root.querySelector(selector);
    if (!element) throw new Error(`照片文字摘录缺少必要元素：${selector}`);
    return element;
  }

  function safeLocalMediaUrl(value) {
    const url = String(value || "").trim();
    if (/^\/(?!\/)[^<>\r\n]*$/.test(url)) return url;
    if (/^blob:[^<>\s]+$/i.test(url)) return url;
    return "";
  }

  function validId(value) {
    const id = String(value || "").trim();
    return /^[a-zA-Z0-9_-]{1,120}$/.test(id) ? id : "";
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[character]);
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
  }

  function roundCoordinate(value) {
    return Math.round(Number(value) * 1_000_000) / 1_000_000;
  }

  function formatCoordinate(value) {
    return Number(value).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function readableError(error, fallback) {
    const message = String(error?.message || "").trim();
    return message && message.length <= 160 ? message : fallback;
  }

  global.TimeIsleMediaOcr = Object.freeze({ renderOcrPanel, hydrate });
})(typeof window !== "undefined" ? window : globalThis);
