(function initializeTimeIsleMediaCompare(global) {
  "use strict";

  const ROOT_SELECTOR = "[data-media-compare]";
  const POINT_KEYS = Object.freeze(["left1", "right1", "left2", "right2"]);
  const MAX_HISTORY = 40;
  const MAX_CANVAS_EDGE = 1600;
  const controllerByRoot = new WeakMap();
  let renderSequence = 0;

  function renderComparison(payload = {}, escape) {
    const escapeText = typeof escape === "function"
      ? (value) => String(escape(String(value ?? "")))
      : escapeHtml;
    const leftItems = normalizeItems(extractItems(payload.left), "left");
    const rightItems = normalizeItems(extractItems(payload.right), "right");
    const instanceId = `media-compare-${++renderSequence}`;
    const title = String(payload.title || "时光对照");
    const description = String(payload.description || "把两段记忆的照片并排放置，保留各自的说明，再决定是否需要手动叠影。");

    return `<section class="media-compare" id="${instanceId}" data-media-compare aria-labelledby="${instanceId}-title">
      <header class="media-compare-heading">
        <div>
          <p class="media-compare-kicker">TIME COMPARE</p>
          <h3 id="${instanceId}-title">${escapeText(title)}</h3>
        </div>
        <p>${escapeText(description)}</p>
      </header>
      <div class="media-compare-pair" aria-label="两张照片并排对照">
        ${renderSide("left", "左侧记忆", leftItems, escapeText)}
        ${renderSide("right", "右侧记忆", rightItems, escapeText)}
      </div>
      <details class="media-compare-overlay" data-compare-overlay>
        <summary>手动叠影 <span>可选增强视图</span></summary>
        <div class="media-compare-overlay-body">
          <p class="media-compare-boundary" id="${instanceId}-boundary"><strong>手动对齐，不是自动识别。</strong>叠影只帮助目视比较，不会判断两张照片是否来自同一地点或事件。</p>
          <div class="media-compare-toolbar">
            <label>右图透明度
              <input type="range" min="0" max="100" step="1" value="50" data-compare-opacity aria-describedby="${instanceId}-boundary" />
            </label>
            <output data-compare-opacity-output>50%</output>
          </div>
          <div class="media-compare-point-pickers">
            ${renderPointPicker("left", "左图", instanceId)}
            ${renderPointPicker("right", "右图", instanceId)}
          </div>
          <fieldset class="media-compare-coordinates">
            <legend>键盘坐标后备</legend>
            <p id="${instanceId}-coordinate-help">每个点的 X、Y 都是 0 到 1 的规范化坐标；例如中心点为 0.5、0.5。输入框可完全替代图片点选。</p>
            <div class="media-compare-coordinate-grid">
              ${POINT_KEYS.map((key) => renderCoordinateRow(key, instanceId)).join("")}
            </div>
          </fieldset>
          <div class="media-compare-actions">
            <button type="button" class="button button-ghost" data-compare-action="undo" disabled>撤销上一步</button>
            <button type="button" class="button button-ghost" data-compare-action="reset">重置四点</button>
          </div>
          <p class="media-compare-point-status" data-compare-point-status aria-live="polite">尚未设置对应点；右图将仅居中叠放。</p>
          <div class="media-compare-canvas-frame">
            <canvas data-compare-canvas hidden role="img" aria-label="左图作为底图、右图按透明度叠加的手动对照视图"></canvas>
            <p data-compare-canvas-fallback role="status">展开后将在本地载入两张展示图。</p>
          </div>
          <output class="media-compare-transform" data-compare-transform>尚未进行手动对齐。</output>
          <p class="media-compare-note">原图、替代文字与照片说明仍保留在上方；Canvas 不是理解这些照片的唯一入口。</p>
        </div>
      </details>
    </section>`;
  }

  function renderSide(side, label, items, escapeText) {
    const first = items[0] || emptyItem(side);
    const disabled = items.length <= 1 ? " disabled" : "";
    const empty = items.length === 0;
    return `<section class="media-compare-side" data-compare-side="${side}" aria-label="${label}">
      <label class="media-compare-selector">${label}
        <select data-compare-select="${side}"${disabled}>
          ${empty
            ? `<option value="0" data-empty="true">暂无图片</option>`
            : items.map((item, index) => renderOption(item, index, escapeText)).join("")}
        </select>
      </label>
      <figure data-compare-figure="${side}">
        <div class="media-compare-image-frame">
          <img data-compare-display-image="${side}" alt="${escapeAttribute(first.altText)}" decoding="async" hidden />
          <span data-compare-display-fallback="${side}" role="status">${empty ? "该侧暂无可用于对照的图片" : "正在载入图片"}</span>
        </div>
        <figcaption>
          <strong data-compare-caption="${side}">${escapeText(first.caption || `${label}照片`)}</strong>
          <span data-compare-dimensions="${side}">${formatDimensions(first)}</span>
          <a data-compare-original="${side}" href="${escapeAttribute(first.originalUrl)}" target="_blank" rel="noreferrer"${first.originalUrl ? "" : " hidden"}>查看原图</a>
        </figcaption>
      </figure>
    </section>`;
  }

  function renderOption(item, index, escapeText) {
    return `<option value="${index}"
      data-asset-id="${escapeAttribute(item.assetId)}"
      data-display-url="${escapeAttribute(item.displayUrl)}"
      data-original-url="${escapeAttribute(item.originalUrl)}"
      data-caption="${escapeAttribute(item.caption)}"
      data-alt-text="${escapeAttribute(item.altText)}"
      data-width="${item.width || ""}"
      data-height="${item.height || ""}">${escapeText(item.caption || `照片 ${index + 1}`)}</option>`;
  }

  function renderPointPicker(side, label, instanceId) {
    return `<section class="media-compare-point-picker" data-compare-point-picker="${side}" aria-labelledby="${instanceId}-${side}-point-title">
      <div class="media-compare-point-heading">
        <h4 id="${instanceId}-${side}-point-title">${label}标点</h4>
        <div class="media-compare-point-choices" role="group" aria-label="选择${label}要设置的点">
          <button type="button" data-compare-point-choice="${side}1" aria-pressed="${side === "left"}">点 1</button>
          <button type="button" data-compare-point-choice="${side}2" aria-pressed="false">点 2</button>
        </div>
      </div>
      <p>先选择点号，再在照片中点选；也可以直接使用下方坐标输入。</p>
      <div class="media-compare-point-frame">
        <span class="media-compare-point-image-wrap" data-compare-point-image-wrap="${side}">
          <img data-compare-point-image="${side}" alt="${label}，用于手动选择两个对应点" aria-describedby="${instanceId}-coordinate-help" decoding="async" hidden />
          <span class="media-compare-marker is-one" data-compare-marker="${side}1" hidden aria-hidden="true">1</span>
          <span class="media-compare-marker is-two" data-compare-marker="${side}2" hidden aria-hidden="true">2</span>
        </span>
        <span data-compare-point-fallback="${side}" role="status">正在载入标点图片</span>
      </div>
    </section>`;
  }

  function renderCoordinateRow(key, instanceId) {
    const label = pointLabel(key);
    return `<fieldset class="media-compare-coordinate-row">
      <legend>${label}</legend>
      <label>X
        <input type="number" inputmode="decimal" min="0" max="1" step="0.001" data-compare-coordinate="x" data-compare-point="${key}" aria-describedby="${instanceId}-coordinate-help" />
      </label>
      <label>Y
        <input type="number" inputmode="decimal" min="0" max="1" step="0.001" data-compare-coordinate="y" data-compare-point="${key}" aria-describedby="${instanceId}-coordinate-help" />
      </label>
    </fieldset>`;
  }

  function hydrate(container) {
    const scope = container || global.document;
    if (!scope) return [];
    const roots = [];
    if (typeof scope.matches === "function" && scope.matches(ROOT_SELECTOR)) roots.push(scope);
    if (typeof scope.querySelectorAll === "function") {
      scope.querySelectorAll(ROOT_SELECTOR).forEach((root) => {
        if (!roots.includes(root)) roots.push(root);
      });
    }
    return roots.map((root) => controllerByRoot.get(root) || createController(root));
  }

  function createController(root) {
    if (!root || typeof root.querySelector !== "function") {
      throw new TypeError("时光对照控制器需要一个有效的 DOM 容器。");
    }
    if (controllerByRoot.has(root)) return controllerByRoot.get(root);

    const documentRef = root.ownerDocument || global.document;
    const view = documentRef?.defaultView || global;
    const elements = {
      details: required(root, "[data-compare-overlay]"),
      opacity: required(root, "[data-compare-opacity]"),
      opacityOutput: required(root, "[data-compare-opacity-output]"),
      pointStatus: required(root, "[data-compare-point-status]"),
      canvas: required(root, "[data-compare-canvas]"),
      canvasFallback: required(root, "[data-compare-canvas-fallback]"),
      transform: required(root, "[data-compare-transform]"),
      undo: required(root, '[data-compare-action="undo"]'),
      reset: required(root, '[data-compare-action="reset"]')
    };
    const sides = Object.fromEntries(["left", "right"].map((side) => [side, {
      select: required(root, `[data-compare-select="${side}"]`),
      displayImage: required(root, `[data-compare-display-image="${side}"]`),
      displayFallback: required(root, `[data-compare-display-fallback="${side}"]`),
      caption: required(root, `[data-compare-caption="${side}"]`),
      dimensions: required(root, `[data-compare-dimensions="${side}"]`),
      original: required(root, `[data-compare-original="${side}"]`),
      pointImage: required(root, `[data-compare-point-image="${side}"]`),
      pointFallback: required(root, `[data-compare-point-fallback="${side}"]`)
    }]));
    const inputs = [...root.querySelectorAll("[data-compare-coordinate]")];
    const pointButtons = [...root.querySelectorAll("[data-compare-point-choice]")];
    const markers = Object.fromEntries(POINT_KEYS.map((key) => [key, required(root, `[data-compare-marker="${key}"]`)]));
    const listeners = [];
    const state = {
      activePoint: "left1",
      points: blankPoints(),
      opacity: 0.5,
      history: [],
      overlayRun: 0,
      imageLoadRun: 0,
      loadedPair: null,
      destroyed: false,
      lastTransform: null
    };

    listen(elements.details, "toggle", () => {
      if (elements.details.open) refreshOverlay();
      else invalidateOverlay();
    });
    listen(elements.opacity, "input", () => {
      state.opacity = clamp(Number(elements.opacity.value) / 100, 0, 1);
      elements.opacityOutput.textContent = `${Math.round(state.opacity * 100)}%`;
      if (elements.details.open && state.loadedPair) drawComposite();
    });
    for (const side of ["left", "right"]) {
      listen(sides[side].select, "change", () => changeSelection(side));
      listen(sides[side].pointImage, "click", (event) => choosePointFromImage(side, event));
    }
    pointButtons.forEach((button) => listen(button, "click", () => {
      state.activePoint = button.dataset.comparePointChoice;
      syncPointUi(`${pointLabel(state.activePoint)}已选中；请在对应照片中点选。`);
    }));
    inputs.forEach((input) => listen(input, "change", () => updatePointFromInput(input)));
    listen(elements.undo, "click", undo);
    listen(elements.reset, "click", reset);

    refreshSide("left");
    refreshSide("right");
    syncPointUi();
    root.dataset.compareHydrated = "true";

    const controller = Object.freeze({
      destroy,
      getState,
      refresh: () => {
        refreshSide("left");
        refreshSide("right");
        if (elements.details.open) refreshOverlay();
      },
      reset
    });
    controllerByRoot.set(root, controller);
    return controller;

    function listen(target, type, handler, options) {
      target.addEventListener(type, handler, options);
      listeners.push({ target, type, handler, options });
    }

    function currentItem(side) {
      const select = sides[side].select;
      const option = select.options[select.selectedIndex] || select.options[0];
      if (!option || option.dataset.empty === "true") return emptyItem(side);
      return {
        assetId: option.dataset.assetId || "",
        displayUrl: safeMediaUrl(option.dataset.displayUrl),
        originalUrl: safeMediaUrl(option.dataset.originalUrl),
        caption: option.dataset.caption || "",
        altText: option.dataset.altText || option.dataset.caption || `${side === "left" ? "左" : "右"}侧照片`,
        width: positiveInteger(option.dataset.width),
        height: positiveInteger(option.dataset.height)
      };
    }

    function refreshSide(side) {
      const item = currentItem(side);
      const controls = sides[side];
      controls.caption.textContent = item.caption || `${side === "left" ? "左侧" : "右侧"}照片`;
      controls.dimensions.textContent = formatDimensions(item);
      controls.original.hidden = !item.originalUrl;
      if (item.originalUrl) controls.original.href = item.originalUrl;
      else controls.original.removeAttribute("href");
      setDomImage(controls.displayImage, controls.displayFallback, item.displayUrl, item.altText, "图片加载失败；照片说明仍可阅读。");
      setDomImage(controls.pointImage, controls.pointFallback, item.displayUrl, `${item.altText}，用于手动选择两个对应点`, "标点图片加载失败；仍可使用规范化坐标输入。");
    }

    function setDomImage(image, fallback, url, alt, failureText) {
      const loadRun = ++state.imageLoadRun;
      image.dataset.compareLoadRun = String(loadRun);
      image.hidden = true;
      image.alt = alt || "记忆照片";
      fallback.hidden = false;
      fallback.textContent = url ? "正在载入图片" : "该侧暂无可用图片";
      image.onload = null;
      image.onerror = null;
      image.removeAttribute("src");
      image.removeAttribute("crossorigin");
      if (!url) return;
      if (requiresAnonymousCors(url, documentRef)) image.crossOrigin = "anonymous";
      image.onload = () => {
        if (state.destroyed || image.dataset.compareLoadRun !== String(loadRun)) return;
        image.hidden = false;
        fallback.hidden = true;
      };
      image.onerror = () => {
        if (state.destroyed || image.dataset.compareLoadRun !== String(loadRun)) return;
        image.hidden = true;
        fallback.hidden = false;
        fallback.textContent = failureText;
      };
      image.src = url;
    }

    function changeSelection(side) {
      invalidateOverlay();
      state.history = [];
      state.points = blankPoints();
      state.activePoint = "left1";
      refreshSide(side);
      syncPointUi("已切换照片；为避免错配，原有手动点已重置。");
      if (elements.details.open) refreshOverlay();
    }

    function choosePointFromImage(side, event) {
      const image = sides[side].pointImage;
      if (image.hidden || !image.naturalWidth || !image.naturalHeight) return;
      let key = state.activePoint;
      if (!key.startsWith(side)) {
        key = [`${side}1`, `${side}2`].find((candidate) => !isCompletePoint(state.points[candidate])) || `${side}1`;
      }
      const rect = image.getBoundingClientRect();
      if (!(rect.width > 0 && rect.height > 0)) return;
      pushHistory();
      state.points[key] = {
        x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
        y: clamp((event.clientY - rect.top) / rect.height, 0, 1)
      };
      state.activePoint = nextPointKey(key);
      syncPointUi(`${pointLabel(key)}已设置；数值可在键盘坐标区继续微调。`);
      requestOverlayDraw();
    }

    function updatePointFromInput(input) {
      const key = input.dataset.comparePoint;
      const coordinate = input.dataset.compareCoordinate;
      if (!POINT_KEYS.includes(key) || !["x", "y"].includes(coordinate)) return;
      const raw = input.value.trim();
      const parsed = raw === "" ? null : Number(raw);
      if (parsed !== null && !Number.isFinite(parsed)) {
        input.setCustomValidity("请输入 0 到 1 之间的数字。");
        input.reportValidity();
        return;
      }
      input.setCustomValidity("");
      pushHistory();
      state.points[key][coordinate] = parsed === null ? null : clamp(parsed, 0, 1);
      state.activePoint = key;
      syncPointUi(`${pointLabel(key)}坐标已更新。`);
      requestOverlayDraw();
    }

    function pushHistory() {
      state.history.push(snapshot(state));
      if (state.history.length > MAX_HISTORY) state.history.shift();
    }

    function undo() {
      const previous = state.history.pop();
      if (!previous) return;
      state.points = clonePoints(previous.points);
      state.activePoint = previous.activePoint;
      state.opacity = previous.opacity;
      elements.opacity.value = String(Math.round(state.opacity * 100));
      elements.opacityOutput.textContent = `${Math.round(state.opacity * 100)}%`;
      syncPointUi("已撤销上一步手动标点操作。可继续调整，不会改动原图。");
      requestOverlayDraw();
    }

    function reset() {
      const hasChanges = POINT_KEYS.some((key) => state.points[key].x !== null || state.points[key].y !== null);
      if (hasChanges) pushHistory();
      state.points = blankPoints();
      state.activePoint = "left1";
      state.lastTransform = null;
      syncPointUi("四个对应点已重置；原图没有被修改。");
      requestOverlayDraw();
    }

    function syncPointUi(message, updateInputs = true) {
      if (updateInputs) {
        inputs.forEach((input) => {
          const point = state.points[input.dataset.comparePoint];
          const value = point?.[input.dataset.compareCoordinate];
          input.value = Number.isFinite(value) ? trimCoordinate(value) : "";
        });
      }
      pointButtons.forEach((button) => {
        const pressed = button.dataset.comparePointChoice === state.activePoint;
        button.setAttribute("aria-pressed", String(pressed));
      });
      for (const key of POINT_KEYS) {
        const marker = markers[key];
        const point = state.points[key];
        const complete = isCompletePoint(point);
        marker.hidden = !complete;
        if (complete) {
          marker.style.left = `${point.x * 100}%`;
          marker.style.top = `${point.y * 100}%`;
        } else {
          marker.style.removeProperty("left");
          marker.style.removeProperty("top");
        }
      }
      const completeCount = POINT_KEYS.filter((key) => isCompletePoint(state.points[key])).length;
      elements.pointStatus.textContent = message || (completeCount === 4
        ? "四个对应点已就绪；叠影将按两组点手动对齐。"
        : `已设置 ${completeCount}/4 个对应点；未完成前右图仅居中叠放。`);
      elements.undo.disabled = state.history.length === 0;
    }

    function requestOverlayDraw() {
      if (!elements.details.open) return;
      if (state.loadedPair) drawComposite();
      else refreshOverlay();
    }

    function invalidateOverlay() {
      state.overlayRun += 1;
      state.loadedPair = null;
      state.lastTransform = null;
    }

    async function refreshOverlay() {
      const run = ++state.overlayRun;
      state.loadedPair = null;
      state.lastTransform = null;
      elements.canvas.hidden = true;
      elements.canvasFallback.hidden = false;
      const left = currentItem("left");
      const right = currentItem("right");
      if (!left.displayUrl || !right.displayUrl) {
        elements.canvasFallback.textContent = "两侧都需要一张可用图片，才能打开叠影。";
        elements.transform.textContent = "未生成叠影。";
        return;
      }
      elements.canvasFallback.textContent = "正在本地载入叠影图片…";
      try {
        const [leftImage, rightImage] = await Promise.all([
          loadBitmap(left.displayUrl, run),
          loadBitmap(right.displayUrl, run)
        ]);
        if (state.destroyed || run !== state.overlayRun || !elements.details.open) return;
        state.loadedPair = { leftImage, rightImage, run };
        drawComposite();
      } catch (error) {
        if (state.destroyed || run !== state.overlayRun || error?.name === "AbortError") return;
        elements.canvas.hidden = true;
        elements.canvasFallback.hidden = false;
        elements.canvasFallback.textContent = "叠影图片加载失败。跨域图片需允许匿名读取；原图与说明仍可在上方查看。";
        elements.transform.textContent = "未生成叠影，也没有得出比较结论。";
      }
    }

    function loadBitmap(url, run) {
      const ImageConstructor = view?.Image || global.Image;
      if (typeof ImageConstructor !== "function") return Promise.reject(new Error("浏览器不支持图片解码。"));
      return new Promise((resolve, reject) => {
        const image = new ImageConstructor();
        if (requiresAnonymousCors(url, documentRef)) image.crossOrigin = "anonymous";
        image.decoding = "async";
        image.onload = () => {
          if (state.destroyed || run !== state.overlayRun) {
            reject(abortError());
            return;
          }
          if (!image.naturalWidth || !image.naturalHeight) reject(new Error("图片尺寸无效。"));
          else resolve(image);
        };
        image.onerror = () => reject(new Error("图片加载失败。"));
        image.src = url;
      });
    }

    function drawComposite() {
      const pair = state.loadedPair;
      if (!pair || pair.run !== state.overlayRun) return;
      const context = elements.canvas.getContext("2d");
      if (!context) {
        elements.canvas.hidden = true;
        elements.canvasFallback.hidden = false;
        elements.canvasFallback.textContent = "当前浏览器无法创建 Canvas；仍可使用上方并排对照。";
        return;
      }
      const leftWidth = pair.leftImage.naturalWidth;
      const leftHeight = pair.leftImage.naturalHeight;
      const canvasScale = Math.min(1, MAX_CANVAS_EDGE / Math.max(leftWidth, leftHeight));
      const width = Math.max(1, Math.round(leftWidth * canvasScale));
      const height = Math.max(1, Math.round(leftHeight * canvasScale));
      elements.canvas.width = width;
      elements.canvas.height = height;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalAlpha = 1;
      context.clearRect(0, 0, width, height);
      context.drawImage(pair.leftImage, 0, 0, width, height);

      const allPointsReady = POINT_KEYS.every((key) => isCompletePoint(state.points[key]));
      try {
        context.save();
        context.globalAlpha = state.opacity;
        if (allPointsReady) {
          const transform = computeSimilarityTransform(
            scalePoint(state.points.right1, pair.rightImage.naturalWidth, pair.rightImage.naturalHeight),
            scalePoint(state.points.right2, pair.rightImage.naturalWidth, pair.rightImage.naturalHeight),
            scalePoint(state.points.left1, width, height),
            scalePoint(state.points.left2, width, height)
          );
          context.setTransform(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f);
          context.drawImage(pair.rightImage, 0, 0);
          state.lastTransform = transform;
          elements.transform.textContent = `手动参数：缩放 ${formatNumber(transform.scale, 3)}×，旋转 ${formatSigned(transform.rotationDegrees, 2)}°，平移 X ${formatSigned(transform.e, 1)} px、Y ${formatSigned(transform.f, 1)} px。参数仅描述本次四点对齐。`;
        } else {
          const fit = containRect(pair.rightImage.naturalWidth, pair.rightImage.naturalHeight, width, height);
          context.drawImage(pair.rightImage, fit.x, fit.y, fit.width, fit.height);
          state.lastTransform = null;
          elements.transform.textContent = "尚未完成四点标注：右图仅居中叠放，未进行对齐。";
        }
        context.restore();
        elements.canvas.hidden = false;
        elements.canvasFallback.hidden = true;
      } catch (error) {
        context.restore();
        state.lastTransform = null;
        elements.canvas.hidden = false;
        elements.canvasFallback.hidden = true;
        elements.transform.textContent = error?.code === "DEGENERATE_POINTS"
          ? "同一张图上的两个点距离过近，无法计算方向；请把点 1 和点 2 分开。"
          : "本次叠影绘制失败；没有修改原图，也没有得出比较结论。";
      }
    }

    function destroy() {
      if (state.destroyed) return;
      state.destroyed = true;
      invalidateOverlay();
      listeners.forEach(({ target, type, handler, options }) => target.removeEventListener(type, handler, options));
      for (const side of ["left", "right"]) {
        for (const image of [sides[side].displayImage, sides[side].pointImage]) {
          image.onload = null;
          image.onerror = null;
          delete image.dataset.compareLoadRun;
        }
      }
      delete root.dataset.compareHydrated;
      controllerByRoot.delete(root);
    }

    function getState() {
      return {
        leftAssetId: currentItem("left").assetId,
        rightAssetId: currentItem("right").assetId,
        points: clonePoints(state.points),
        opacity: state.opacity,
        transform: state.lastTransform ? { ...state.lastTransform, translation: { ...state.lastTransform.translation } } : null
      };
    }
  }

  function computeSimilarityTransform(sourceA, sourceB, targetA, targetB) {
    const source1 = assertPoint(sourceA, "sourceA");
    const source2 = assertPoint(sourceB, "sourceB");
    const target1 = assertPoint(targetA, "targetA");
    const target2 = assertPoint(targetB, "targetB");
    const sourceDx = source2.x - source1.x;
    const sourceDy = source2.y - source1.y;
    const targetDx = target2.x - target1.x;
    const targetDy = target2.y - target1.y;
    const sourceLength = Math.hypot(sourceDx, sourceDy);
    const targetLength = Math.hypot(targetDx, targetDy);
    if (sourceLength <= 1e-8 || targetLength <= 1e-8) {
      const error = new RangeError("Each point pair must contain two distinct points.");
      error.code = "DEGENERATE_POINTS";
      throw error;
    }
    const scale = targetLength / sourceLength;
    const rawRotation = Math.atan2(targetDy, targetDx) - Math.atan2(sourceDy, sourceDx);
    const rotationRadians = Math.atan2(Math.sin(rawRotation), Math.cos(rawRotation));
    const cosine = Math.cos(rotationRadians);
    const sine = Math.sin(rotationRadians);
    const a = scale * cosine;
    const b = scale * sine;
    const c = -scale * sine;
    const d = scale * cosine;
    const e = target1.x - (a * source1.x + c * source1.y);
    const f = target1.y - (b * source1.x + d * source1.y);
    return Object.freeze({
      a,
      b,
      c,
      d,
      e,
      f,
      scale,
      rotationRadians,
      rotationDegrees: rotationRadians * 180 / Math.PI,
      translation: Object.freeze({ x: e, y: f })
    });
  }

  function applySimilarityTransform(transform, point) {
    const value = assertPoint(point, "point");
    if (!transform || !["a", "b", "c", "d", "e", "f"].every((key) => Number.isFinite(Number(transform[key])))) {
      throw new TypeError("A finite similarity transform is required.");
    }
    return {
      x: Number(transform.a) * value.x + Number(transform.c) * value.y + Number(transform.e),
      y: Number(transform.b) * value.x + Number(transform.d) * value.y + Number(transform.f)
    };
  }

  function normalizePoint(point) {
    if (!point || typeof point !== "object") return null;
    const x = strictNumber(point.x);
    const y = strictNumber(point.y);
    if (x === null || y === null) return null;
    return { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
  }

  function extractItems(value) {
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.media)) return value.media;
    if (Array.isArray(value?.images)) return value.images;
    return value && typeof value === "object" ? [value] : [];
  }

  function normalizeItems(items, side) {
    return items.map((item, index) => {
      const value = item && typeof item === "object" ? item : {};
      const urls = value.urls && typeof value.urls === "object" ? value.urls : {};
      const displayUrl = safeMediaUrl(urls.display || urls.preview || value.displayUrl || value.url || urls.original || urls.thumb);
      const originalUrl = safeMediaUrl(urls.original || value.originalUrl);
      const caption = String(value.caption || value.title || value.originalName || `${side === "left" ? "左" : "右"}侧照片 ${index + 1}`);
      return {
        assetId: String(value.assetId || value.id || `${side}-${index + 1}`),
        displayUrl,
        originalUrl,
        caption,
        altText: String(value.altText || caption),
        width: positiveInteger(value.width),
        height: positiveInteger(value.height)
      };
    });
  }

  function emptyItem(side) {
    return {
      assetId: "",
      displayUrl: "",
      originalUrl: "",
      caption: `${side === "left" ? "左" : "右"}侧暂无图片`,
      altText: "",
      width: 0,
      height: 0
    };
  }

  function safeMediaUrl(value) {
    const url = String(value || "").trim();
    if (!url) return "";
    if (/^\/(?!\/)/.test(url) || /^\.\//.test(url) || /^blob:/i.test(url)) return url;
    if (/^data:image\/(?:jpeg|png|webp);/i.test(url)) return url;
    if (/^https?:\/\//i.test(url)) return url;
    return "";
  }

  function requiresAnonymousCors(url, documentRef) {
    try {
      const base = documentRef?.baseURI || global.location?.href;
      if (!base || !/^https?:/i.test(url)) return false;
      const parsed = new URL(url, base);
      const origin = new URL(base).origin;
      return /^https?:$/.test(parsed.protocol) && parsed.origin !== origin;
    } catch {
      return false;
    }
  }

  function containRect(sourceWidth, sourceHeight, targetWidth, targetHeight) {
    const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
    const width = sourceWidth * scale;
    const height = sourceHeight * scale;
    return { x: (targetWidth - width) / 2, y: (targetHeight - height) / 2, width, height };
  }

  function scalePoint(point, width, height) {
    return { x: point.x * width, y: point.y * height };
  }

  function assertPoint(point, name) {
    const x = strictNumber(point?.x);
    const y = strictNumber(point?.y);
    if (x === null || y === null) throw new TypeError(`${name} must contain finite x and y values.`);
    return { x, y };
  }

  function strictNumber(value) {
    if (
      value === null
      || value === undefined
      || typeof value === "boolean"
      || (typeof value === "string" && value.trim() === "")
    ) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function blankPoints() {
    return Object.fromEntries(POINT_KEYS.map((key) => [key, { x: null, y: null }]));
  }

  function clonePoints(points) {
    return Object.fromEntries(POINT_KEYS.map((key) => [key, { x: points[key].x, y: points[key].y }]));
  }

  function snapshot(state) {
    return { points: clonePoints(state.points), activePoint: state.activePoint, opacity: state.opacity };
  }

  function isCompletePoint(point) {
    return Number.isFinite(point?.x) && Number.isFinite(point?.y);
  }

  function nextPointKey(key) {
    return POINT_KEYS[(POINT_KEYS.indexOf(key) + 1) % POINT_KEYS.length];
  }

  function pointLabel(key) {
    return `${key.startsWith("left") ? "左图" : "右图"}点 ${key.endsWith("1") ? "1" : "2"}`;
  }

  function trimCoordinate(value) {
    return Number(value.toFixed(3)).toString();
  }

  function positiveInteger(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : 0;
  }

  function formatDimensions(item) {
    return item.width && item.height ? `${item.width} × ${item.height}` : "尺寸未记录";
  }

  function formatNumber(value, digits) {
    return Number(value).toFixed(digits).replace(/\.0+$/, "");
  }

  function formatSigned(value, digits) {
    const number = Number(value);
    return `${number >= 0 ? "+" : ""}${formatNumber(number, digits)}`;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function required(root, selector) {
    const element = root.querySelector(selector);
    if (!element) throw new Error(`时光对照缺少必要结构：${selector}`);
    return element;
  }

  function abortError() {
    const error = new Error("Image load superseded.");
    error.name = "AbortError";
    return error;
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

  global.TimeIsleMediaCompare = Object.freeze({
    applySimilarityTransform,
    computeSimilarityTransform,
    createController,
    hydrate,
    normalizePoint,
    renderComparison
  });
})(typeof window !== "undefined" ? window : globalThis);
