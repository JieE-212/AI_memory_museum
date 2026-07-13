(function initializeTimeIsleMediaLab(global) {
  "use strict";

  const ROOT_SELECTOR = "[data-media-lab-panel]";
  const MAX_CANDIDATES = 20;
  let renderSequence = 0;

  function renderPanel(memory = {}, escape) {
    const media = normalizeMemoryMedia(memory);
    if (!media.length) return "";

    const escapeText = typeof escape === "function"
      ? (value) => String(escape(String(value ?? "")))
      : escapeHtml;
    const instanceId = `media-lab-${++renderSequence}`;

    return `<details class="media-lab" data-media-lab-panel>
      <summary>
        <span><strong>影像线索实验台</strong><small>可选 · 结果由你核对</small></span>
        <span aria-hidden="true">＋</span>
      </summary>
      <div class="media-lab-body">
        <p class="media-lab-boundary"><strong>这里只提供线索，不替你下结论。</strong>相似照片检索与文字摘录都不会自动改写、合并或删除展品。</p>
        <div class="media-lab-toolbar">
          <label for="${instanceId}-photo">当前照片
            <select id="${instanceId}-photo" data-media-lab-select>
              ${renderMediaOptions(media, escapeText)}
            </select>
          </label>
          <button type="button" class="button button-ghost compact" data-media-lab-action="find-similar">寻找可能相似照片</button>
        </div>
        <p class="media-lab-current" data-media-lab-current aria-live="polite"></p>
        <p class="media-lab-status" data-media-lab-status role="status" aria-live="polite">尚未检索；只有点击上方按钮后才会寻找候选。</p>
        <section class="media-lab-results" data-media-lab-results aria-labelledby="${instanceId}-results-title" hidden>
          <h3 id="${instanceId}-results-title">相似照片候选</h3>
          <div data-media-lab-result-list></div>
        </section>
        <div class="media-lab-ocr" data-media-lab-ocr>
          <p class="media-lab-ocr-state">正在准备当前照片的可选文字摘录工具……</p>
        </div>
      </div>
    </details>`;
  }

  function createController(config = {}) {
    const documentRef = config.document || global.document;
    const fetchImpl = config.fetch || (typeof global.fetch === "function" ? global.fetch.bind(global) : null);
    const AbortControllerClass = config.AbortController || global.AbortController;
    let demo = Boolean(config.demo || config.interviewDemo);
    let destroyed = false;
    let session = 0;
    let operation = 0;
    let panel = null;
    let memoryId = "";
    let mediaItems = [];
    let currentIndex = -1;
    let currentMedia = null;
    let elements = {};
    let activeRequest = null;
    let ocrControllers = [];
    const listeners = [];

    function open(memory, container) {
      if (destroyed) return;
      teardown();
      session += 1;

      memoryId = validId(memory?.id);
      mediaItems = normalizeMemoryMedia(memory);
      panel = findPanel(container || documentRef);
      if (!memoryId || !panel || !mediaItems.length) {
        teardown();
        return;
      }

      elements = collectElements(panel);
      if (!elements.select || !elements.findButton || !elements.status
        || !elements.results || !elements.resultList || !elements.ocrHost) {
        teardown();
        return;
      }

      elements.select.innerHTML = renderMediaOptions(mediaItems, escapeHtml);
      elements.select.value = "0";
      bind(elements.select, "change", handlePhotoChange);
      bind(elements.findButton, "click", findSimilarPhotos);
      selectPhoto(0);
    }

    function close() {
      if (destroyed) return;
      teardown();
      session += 1;
    }

    function setDemo(value) {
      if (destroyed) return;
      const nextDemo = Boolean(value);
      if (nextDemo === demo) return;
      demo = nextDemo;
      if (panel && currentMedia) renderOcr();
    }

    function destroy() {
      if (destroyed) return;
      teardown();
      session += 1;
      destroyed = true;
    }

    function findPanel(container) {
      if (!container) return null;
      if (typeof container.matches === "function" && container.matches(ROOT_SELECTOR)) return container;
      return container.querySelector?.(ROOT_SELECTOR) || null;
    }

    function collectElements(root) {
      return {
        select: root.querySelector("[data-media-lab-select]"),
        findButton: root.querySelector('[data-media-lab-action="find-similar"]'),
        current: root.querySelector("[data-media-lab-current]"),
        status: root.querySelector("[data-media-lab-status]"),
        results: root.querySelector("[data-media-lab-results]"),
        resultList: root.querySelector("[data-media-lab-result-list]"),
        ocrHost: root.querySelector("[data-media-lab-ocr]")
      };
    }

    function bind(target, type, handler, options) {
      if (!target?.addEventListener) return;
      target.addEventListener(type, handler, options);
      listeners.push({ target, type, handler, options });
    }

    function handlePhotoChange() {
      const requestedIndex = Number.parseInt(elements.select.value, 10);
      selectPhoto(Number.isInteger(requestedIndex) ? requestedIndex : elements.select.selectedIndex);
    }

    function selectPhoto(index) {
      const normalizedIndex = Math.max(0, Math.min(mediaItems.length - 1, Number(index) || 0));
      abortSearch();
      currentIndex = normalizedIndex;
      currentMedia = mediaItems[normalizedIndex] || null;
      if (elements.select) elements.select.value = String(normalizedIndex);
      resetSearchView();
      if (elements.current) {
        const label = photoLabel(currentMedia, normalizedIndex);
        elements.current.textContent = `当前：${label}`;
      }
      renderOcr();
    }

    function resetSearchView() {
      if (elements.results) elements.results.hidden = true;
      if (elements.resultList) elements.resultList.innerHTML = "";
      setStatus("尚未检索；只有点击上方按钮后才会寻找候选。", "idle");
      setSearchBusy(false);
    }

    async function findSimilarPhotos() {
      if (!currentMedia || destroyed) return;
      if (!fetchImpl || typeof AbortControllerClass !== "function") {
        showSearchError("当前环境无法连接本地相似照片检索接口。");
        return;
      }

      abortSearch();
      const controller = new AbortControllerClass();
      activeRequest = controller;
      const activeSession = session;
      const activeOperation = ++operation;
      const assetId = currentMedia.assetId;
      setSearchBusy(true);
      setStatus("正在本地寻找可能相似照片……", "loading");
      elements.results.hidden = true;
      elements.resultList.innerHTML = "";

      try {
        const response = await fetchImpl(
          `/api/media/assets/${encodeURIComponent(assetId)}/similar?limit=8`,
          { method: "GET", headers: { Accept: "application/json" }, signal: controller.signal }
        );
        const payload = await readJson(response);
        if (!isActive(activeSession, activeOperation, assetId)) return;
        if (!response.ok) throw new Error(payload?.error || `检索失败（HTTP ${response.status}）`);
        renderSimilarResults(payload);
      } catch (error) {
        if (!isActive(activeSession, activeOperation, assetId) || error?.name === "AbortError") return;
        showSearchError(readableError(error, "相似照片检索失败，请稍后重试。"));
      } finally {
        if (activeRequest === controller) activeRequest = null;
        if (isActive(activeSession, activeOperation, assetId)) setSearchBusy(false);
      }
    }

    function isActive(activeSession, activeOperation, assetId) {
      return !destroyed
        && activeSession === session
        && activeOperation === operation
        && currentMedia?.assetId === assetId;
    }

    function renderSimilarResults(payload) {
      elements.results.hidden = false;
      if (!payload?.ready) {
        elements.resultList.innerHTML = emptyResult("当前照片还没有可用的本地检索线索，暂时无法寻找候选。");
        setStatus("暂时无法检索；这不代表馆藏中没有相关照片。", "empty");
        return;
      }

      const candidates = normalizeCandidates(payload.candidates, currentMedia?.assetId);
      if (!candidates.length) {
        elements.resultList.innerHTML = emptyResult("没有找到可能相似照片；这只是一次辅助检索，不代表不存在关联。");
        setStatus("本次没有候选。你仍可以通过展品内容继续人工查找。", "empty");
        return;
      }

      elements.resultList.innerHTML = `<p class="media-lab-review-note"><strong>可能相似</strong>只表示画面线索接近；每一项都<strong>需人工核对</strong>。</p>
        <ol class="media-lab-candidate-list">${candidates.map(renderCandidate).join("")}</ol>`;
      setStatus(`找到 ${candidates.length} 个可能相似候选，均需人工核对。`, "success");
    }

    function showSearchError(message) {
      if (!elements.results || !elements.resultList) return;
      elements.results.hidden = false;
      elements.resultList.innerHTML = emptyResult("检索没有完成。没有任何照片被合并、修改或删除。");
      setStatus(message, "error");
      setSearchBusy(false);
    }

    function setSearchBusy(value) {
      if (!elements.findButton) return;
      elements.findButton.disabled = Boolean(value);
      elements.findButton.setAttribute?.("aria-busy", value ? "true" : "false");
      elements.findButton.textContent = value ? "正在寻找……" : "寻找可能相似照片";
    }

    function setStatus(message, state) {
      if (!elements.status) return;
      elements.status.textContent = message;
      elements.status.dataset.state = state;
    }

    function renderOcr() {
      destroyOcr();
      if (!elements.ocrHost || !currentMedia) return;
      const ocr = global.TimeIsleMediaOcr;
      if (!ocr || typeof ocr.renderOcrPanel !== "function" || typeof ocr.hydrate !== "function") {
        elements.ocrHost.innerHTML = '<p class="media-lab-ocr-state">当前环境未载入照片文字摘录工具。</p>';
        return;
      }

      try {
        const markup = ocr.renderOcrPanel({
          memoryId,
          assetId: currentMedia.assetId,
          displayUrl: currentMedia.displayUrl,
          media: currentMedia.source,
          altText: currentMedia.altText || photoLabel(currentMedia, currentIndex),
          existingRegions: currentMedia.regions,
          demo
        }, escapeHtml);
        if (!markup) {
          elements.ocrHost.innerHTML = '<p class="media-lab-ocr-state">当前照片没有可用于文字摘录的安全展示图。</p>';
          return;
        }
        elements.ocrHost.innerHTML = markup;
        const hydrated = ocr.hydrate(elements.ocrHost, { fetch: fetchImpl });
        ocrControllers = Array.isArray(hydrated) ? hydrated.filter(Boolean) : [];
      } catch {
        destroyOcr();
        elements.ocrHost.innerHTML = '<p class="media-lab-ocr-state" role="status">照片文字摘录工具暂时无法启动；相似候选功能仍可使用。</p>';
      }
    }

    function destroyOcr() {
      ocrControllers.forEach((controller) => controller?.destroy?.());
      ocrControllers = [];
      if (elements.ocrHost) elements.ocrHost.innerHTML = "";
    }

    function abortSearch() {
      operation += 1;
      activeRequest?.abort?.();
      activeRequest = null;
    }

    function teardown() {
      abortSearch();
      destroyOcr();
      listeners.splice(0).forEach(({ target, type, handler, options }) => {
        target.removeEventListener?.(type, handler, options);
      });
      panel = null;
      memoryId = "";
      mediaItems = [];
      currentIndex = -1;
      currentMedia = null;
      elements = {};
    }

    return Object.freeze({ open, close, setDemo, destroy });
  }

  function renderMediaOptions(media, escapeText) {
    return media.map((item, index) => (
      `<option value="${index}">${escapeText(photoLabel(item, index))}</option>`
    )).join("");
  }

  function photoLabel(item, index) {
    return String(item?.caption || item?.altText || `照片 ${Number(index) + 1}`).trim().slice(0, 100);
  }

  function normalizeMemoryMedia(memory) {
    return (Array.isArray(memory?.media) ? [...memory.media] : [])
      .filter((item) => item && typeof item === "object")
      .sort((left, right) => Number(left.position || 0) - Number(right.position || 0))
      .map((item) => {
        const assetId = validId(item.assetId || item.id);
        const displayUrl = safeLocalMediaUrl(item.urls?.display || item.urls?.thumb || item.url);
        const regions = Array.isArray(item.annotations)
          ? item.annotations
          : Array.isArray(item.regions) ? item.regions : [];
        return {
          assetId,
          displayUrl,
          caption: String(item.caption || ""),
          altText: String(item.altText || ""),
          regions,
          source: item
        };
      })
      .filter((item) => item.assetId && item.displayUrl);
  }

  function normalizeCandidates(input, selectedAssetId) {
    const seen = new Set();
    return (Array.isArray(input) ? input : []).map((candidate) => {
      const assetId = validId(candidate?.assetId || candidate?.media?.id);
      if (!assetId || assetId === selectedAssetId || seen.has(assetId)) return null;
      seen.add(assetId);
      const media = candidate?.media && typeof candidate.media === "object" ? candidate.media : {};
      const thumbnailUrl = safeLocalMediaUrl(media.urls?.thumb || media.urls?.display);
      const memorySeen = new Set();
      const memories = (Array.isArray(candidate?.memories) ? candidate.memories : []).map((memory) => {
        const id = validId(memory?.id);
        if (!id || memorySeen.has(id)) return null;
        memorySeen.add(id);
        return {
          id,
          title: String(memory?.title || "未命名展品").trim().slice(0, 120),
          date: String(memory?.date || "").trim().slice(0, 40)
        };
      }).filter(Boolean).slice(0, 8);
      return { assetId, thumbnailUrl, memories };
    }).filter(Boolean).slice(0, MAX_CANDIDATES);
  }

  function renderCandidate(candidate, index) {
    const label = `可能相似照片候选 ${index + 1}，需人工核对`;
    const image = candidate.thumbnailUrl
      ? `<img src="${escapeAttribute(candidate.thumbnailUrl)}" alt="${escapeAttribute(label)}" loading="lazy" decoding="async" />`
      : '<span class="media-lab-candidate-placeholder" aria-hidden="true">无预览</span>';
    const memoryLinks = candidate.memories.length
      ? `<div class="media-lab-memory-links" aria-label="候选照片关联展品">${candidate.memories.map((memory) => (
        `<button type="button" data-open-memory="${escapeAttribute(memory.id)}">${escapeHtml(memory.title)}${memory.date ? `<small>${escapeHtml(memory.date)}</small>` : ""}</button>`
      )).join("")}</div>`
      : '<p class="media-lab-no-memory">这张候选照片暂未关联可打开的展品。</p>';
    return `<li class="media-lab-candidate">
      <div class="media-lab-candidate-media">${image}</div>
      <div class="media-lab-candidate-copy">
        <strong>可能相似 · 需人工核对</strong>
        ${memoryLinks}
      </div>
    </li>`;
  }

  function emptyResult(message) {
    return `<p class="media-lab-empty">${escapeHtml(message)}</p>`;
  }

  async function readJson(response) {
    const text = await response.text();
    if (!text) return {};
    try { return JSON.parse(text); } catch { return {}; }
  }

  function safeLocalMediaUrl(value) {
    const url = String(value || "").trim();
    return /^\/(?!\/)[^<>\r\n]*$/.test(url) || /^blob:[^<>\s]+$/i.test(url) ? url : "";
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

  function readableError(error, fallback) {
    const message = String(error?.message || "").trim();
    return message && message.length <= 160 ? message : fallback;
  }

  global.TimeIsleMediaLab = Object.freeze({ createController, renderPanel });
})(typeof window !== "undefined" ? window : globalThis);
