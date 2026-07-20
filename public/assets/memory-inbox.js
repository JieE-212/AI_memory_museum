(function memoryInboxModule(root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.TimeIsleMemoryInbox = factory();
}(typeof globalThis !== "undefined" ? globalThis : self, function createMemoryInboxModule() {
  "use strict";

  const MAX_FILE_BYTES = 512 * 1024;
  const MAX_EXCERPT_LENGTH = 4000;
  const MAX_SEGMENTS = 100;
  const ALLOWED_EXTENSIONS = new Set(["txt", "md", "markdown"]);

  function decodeUtf8(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || 0);
    if (!bytes.byteLength || bytes.byteLength > MAX_FILE_BYTES) {
      throw inboxError(`文件需在 1 B 至 ${MAX_FILE_BYTES / 1024} KiB 之间。`, "MEMORY_INBOX_FILE_SIZE");
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw inboxError("文件不是有效的 UTF-8 文本，未读取也未保存。", "MEMORY_INBOX_UTF8_INVALID");
    }
  }

  function segmentText(text, maximum = MAX_SEGMENTS) {
    const source = String(text || "");
    const limit = Math.min(MAX_SEGMENTS, Math.max(1, Number(maximum) || MAX_SEGMENTS));
    const rows = lineRows(source);
    const segments = [];
    let start = null;
    let end = null;
    for (const row of rows) {
      if (row.content.trim()) {
        if (start === null) start = row.start;
        end = row.contentEnd;
        continue;
      }
      appendSegment(source, segments, start, end, limit);
      start = null;
      end = null;
      if (segments.length >= limit) break;
    }
    if (segments.length < limit) appendSegment(source, segments, start, end, limit);
    return segments;
  }

  function lineRows(text) {
    const rows = [];
    let offset = 0;
    let line = 1;
    while (offset < text.length) {
      let cursor = offset;
      while (cursor < text.length && text[cursor] !== "\n" && text[cursor] !== "\r") cursor += 1;
      const contentEnd = cursor;
      if (text[cursor] === "\r" && text[cursor + 1] === "\n") cursor += 2;
      else if (cursor < text.length) cursor += 1;
      rows.push({ line, start: offset, contentEnd, end: cursor, content: text.slice(offset, contentEnd) });
      offset = cursor;
      line += 1;
    }
    if (!rows.length || offset === text.length) {
      rows.push({ line, start: offset, contentEnd: offset, end: offset, content: "" });
    }
    return rows;
  }

  function appendSegment(source, segments, start, end, limit) {
    if (start === null || end === null || end <= start || segments.length >= limit) return;
    let cursor = start;
    while (cursor < end && segments.length < limit) {
      let next = Math.min(end, cursor + MAX_EXCERPT_LENGTH);
      if (next < end) {
        const breakAt = Math.max(
          source.lastIndexOf("\n", next),
          source.lastIndexOf("。", next),
          source.lastIndexOf("！", next),
          source.lastIndexOf("？", next)
        );
        if (breakAt > cursor + 200) next = breakAt + 1;
      }
      const excerpt = source.slice(cursor, next);
      if (excerpt.trim()) {
        const startPosition = positionForOffset(source, cursor);
        const endPosition = positionForOffset(source, next);
        segments.push({
          startOffset: cursor,
          endOffset: next,
          startLine: startPosition.line,
          startColumn: startPosition.column,
          endLine: endPosition.line,
          endColumn: endPosition.column,
          excerpt
        });
      }
      cursor = next;
    }
  }

  function positionForOffset(text, offset) {
    const before = String(text || "").slice(0, Math.max(0, Number(offset) || 0));
    const lines = before.split(/\r\n|\r|\n/u);
    return { line: lines.length, column: lines[lines.length - 1].length + 1 };
  }

  function bytesToBase64(bytes) {
    const value = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
    let binary = "";
    for (let offset = 0; offset < value.length; offset += 0x8000) {
      binary += String.fromCharCode(...value.subarray(offset, offset + 0x8000));
    }
    return typeof btoa === "function" ? btoa(binary) : Buffer.from(value).toString("base64");
  }

  function createController(options = {}) {
    const documentRef = options.document || (typeof document !== "undefined" ? document : null);
    const fetchImpl = options.fetch || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
    const onCompose = typeof options.onCompose === "function" ? options.onCompose : () => {};
    if (!documentRef || !fetchImpl) return null;
    const elements = collectElements(documentRef);
    if (!elements) return null;
    let demo = Boolean(options.demo);
    let fileState = null;
    let opener = null;
    let requestNo = 0;

    bind();
    setDemo(demo);
    updateSummary({ pending: 0 });

    function bind() {
      elements.open.addEventListener("click", () => open(elements.open));
      elements.close.forEach((button) => button.addEventListener("click", close));
      elements.dialog.addEventListener("close", cleanupFile);
      elements.file.addEventListener("change", loadSelectedFile);
      elements.sample.addEventListener("click", loadSample);
      elements.candidates.addEventListener("click", handleCandidateClick);
      elements.items.addEventListener("click", handleItemClick);
      elements.refresh.addEventListener("click", loadPending);
    }

    function setDemo(value) {
      demo = Boolean(value);
      elements.file.disabled = demo;
      elements.fileLabel.classList.toggle("is-disabled", demo);
      elements.fileLabel.setAttribute("aria-disabled", String(demo));
      elements.demoNote.hidden = !demo;
      elements.localNote.hidden = demo;
    }

    function prepareComposer(item) {
      const prepared = createComposerContext(item);
      setComposerLocked(true, prepared.draft.rawContent);
      return prepared;
    }

    function setComposerLocked(locked, excerpt = "") {
      const rawContent = documentRef.querySelector("#rawContent");
      const sampleButton = documentRef.querySelector("#sampleButton");
      const analyzeButton = documentRef.querySelector("#analyzeButton");
      if (rawContent) {
        if (locked) rawContent.value = String(excerpt || "");
        rawContent.readOnly = Boolean(locked);
        if (locked) rawContent.setAttribute("aria-readonly", "true");
        else rawContent.removeAttribute("aria-readonly");
      }
      if (sampleButton) sampleButton.disabled = Boolean(locked);
      if (analyzeButton) analyzeButton.disabled = Boolean(locked);
    }

    async function admit(item, memory) {
      const prepared = requireComposerItem(item);
      return requestJson(`/api/memory-inbox/items/${encodeURIComponent(prepared.id)}/admit`, {
        method: "POST",
        headers: {
          "If-Match": prepared.etag || `\"${Number(prepared.version) || 1}\"`,
          "Idempotency-Key": prepared.admissionKey
        },
        body: JSON.stringify({
          confirm: true,
          memory: admissionMemory(memory)
        })
      });
    }

    async function open(trigger) {
      opener = trigger || documentRef.activeElement;
      if (!elements.dialog.open) elements.dialog.showModal();
      elements.title.focus({ preventScroll: true });
      await loadPending();
      if (demo && !fileState) await loadSample();
    }

    function close() {
      if (elements.dialog.open) elements.dialog.close();
      opener?.focus?.({ preventScroll: true });
      opener = null;
    }

    async function loadSelectedFile() {
      const file = elements.file.files?.[0];
      if (!file) return;
      try {
        const extension = String(file.name || "").split(".").pop().toLowerCase();
        if (!ALLOWED_EXTENSIONS.has(extension)) throw inboxError("首版只支持 .txt、.md 或 .markdown 文件。", "MEMORY_INBOX_FILE_TYPE");
        const bytes = new Uint8Array(await file.arrayBuffer());
        const text = decodeUtf8(bytes);
        const segments = segmentText(text);
        if (!segments.length) throw inboxError("文件里没有可加入收件箱的文字片段。", "MEMORY_INBOX_EMPTY");
        fileState = {
          bytes,
          text,
          segments,
          displayName: String(file.name || "本地文本").slice(0, 160),
          format: extension === "txt" ? "txt" : "markdown",
          mimeType: extension === "txt" ? "text/plain" : "text/markdown",
          demo: false
        };
        renderCandidates();
        setStatus(`已在浏览器内读取 ${segments.length} 个原样片段；整份文件不会保存。`, "success");
      } catch (error) {
        cleanupFile();
        setStatus(error.message, "error");
      }
    }

    async function loadSample() {
      const text = "2024 年春天，我们在旧图书馆门口等雨停。\n没有人急着给这段往事下结论。\n\n后来翻到那天的聊天记录，我只想先保存逐字原文，再自己核对日期和人物。";
      const bytes = new TextEncoder().encode(text);
      fileState = {
        bytes,
        text,
        segments: segmentText(text),
        displayName: "合成示例.md",
        format: "markdown",
        mimeType: "text/markdown",
        demo: true
      };
      renderCandidates();
      setStatus(demo ? "这是合成只读样例，不会写入收件箱或馆藏。" : "已放入合成样例；仍需逐段确认。", "success");
    }

    function renderCandidates() {
      elements.fileMeta.textContent = fileState
        ? `${fileState.displayName} · ${fileState.bytes.byteLength} B · UTF-8 · 最多显示 ${MAX_SEGMENTS} 段`
        : "尚未选择文件。";
      elements.candidates.replaceChildren();
      for (const [index, segment] of (fileState?.segments || []).entries()) {
        const article = documentRef.createElement("article");
        article.className = "memory-inbox-candidate";
        const meta = documentRef.createElement("small");
        meta.textContent = `第 ${segment.startLine}–${segment.endLine} 行 · ${segment.excerpt.length} 字符`;
        const preview = documentRef.createElement("p");
        preview.textContent = segment.excerpt;
        const button = documentRef.createElement("button");
        button.type = "button";
        button.className = "button secondary compact";
        button.dataset.inboxCandidate = String(index);
        button.disabled = demo || fileState.demo;
        button.textContent = demo || fileState.demo ? "只读示例" : "加入收件箱";
        article.append(meta, preview, button);
        elements.candidates.append(article);
      }
    }

    async function handleCandidateClick(event) {
      const button = event.target.closest("[data-inbox-candidate]");
      if (!button || !fileState || demo || fileState.demo) return;
      const segment = fileState.segments[Number(button.dataset.inboxCandidate)];
      if (!segment) return;
      button.disabled = true;
      button.textContent = "核对中…";
      try {
        await requestJson("/api/memory-inbox/items", {
          method: "POST",
          headers: { "Idempotency-Key": randomKey("inbox-add") },
          body: JSON.stringify({
            confirm: true,
            displayName: fileState.displayName,
            format: fileState.format,
            mimeType: fileState.mimeType,
            rawBase64: bytesToBase64(fileState.bytes),
            startOffset: segment.startOffset,
            endOffset: segment.endOffset
          })
        });
        button.textContent = "已加入";
        setStatus("片段已带着来源哈希和精确区间加入收件箱，尚未成为展品。", "success");
        await loadPending();
      } catch (error) {
        button.disabled = false;
        button.textContent = "加入收件箱";
        setStatus(error.message, "error");
      }
    }

    async function loadPending() {
      const current = ++requestNo;
      elements.items.setAttribute("aria-busy", "true");
      try {
        if (demo) {
          renderItems([]);
          updateSummary({ pending: 0 });
          return;
        }
        const payload = await requestJson("/api/memory-inbox?status=pending");
        if (current !== requestNo) return;
        renderItems(payload.items || []);
        updateSummary(payload.counts || { pending: (payload.items || []).length });
      } catch (error) {
        if (current === requestNo) setStatus(error.message, "error");
      } finally {
        if (current === requestNo) elements.items.removeAttribute("aria-busy");
      }
    }

    function renderItems(items) {
      elements.items.replaceChildren();
      if (!items.length) {
        const empty = documentRef.createElement("p");
        empty.className = "memory-inbox-empty";
        empty.textContent = demo ? "公开 Demo 不保存收件箱条目。" : "收件箱是空的。选择文件并逐段确认后，条目会出现在这里。";
        elements.items.append(empty);
        return;
      }
      for (const item of items) {
        const article = documentRef.createElement("article");
        article.className = "memory-inbox-item";
        const heading = documentRef.createElement("div");
        const strong = documentRef.createElement("strong");
        strong.textContent = item.source?.displayName || item.displayName || "本地文本片段";
        const small = documentRef.createElement("small");
        small.textContent = item.anchor?.label || lineLabel(item);
        heading.append(strong, small);
        const excerpt = documentRef.createElement("p");
        excerpt.textContent = item.excerpt || item.excerptText || "";
        const actions = documentRef.createElement("div");
        actions.className = "memory-inbox-item-actions";
        const compose = documentRef.createElement("button");
        compose.type = "button";
        compose.className = "button primary compact";
        compose.dataset.inboxCompose = item.id;
        compose.textContent = "整理为展品";
        const dismiss = documentRef.createElement("button");
        dismiss.type = "button";
        dismiss.className = "button text-button compact";
        dismiss.dataset.inboxDismiss = item.id;
        dismiss.textContent = "暂不处理";
        actions.append(compose, dismiss);
        article.dataset.item = JSON.stringify(item);
        article.append(heading, excerpt, actions);
        elements.items.append(article);
      }
    }

    async function handleItemClick(event) {
      const article = event.target.closest(".memory-inbox-item");
      if (!article) return;
      let item;
      try { item = JSON.parse(article.dataset.item || "{}"); } catch { return; }
      const compose = event.target.closest("[data-inbox-compose]");
      if (compose) {
        onCompose(item);
        close();
        return;
      }
      const dismiss = event.target.closest("[data-inbox-dismiss]");
      if (!dismiss) return;
      dismiss.disabled = true;
      try {
        await requestJson(`/api/memory-inbox/items/${encodeURIComponent(item.id)}/dismiss`, {
          method: "POST",
          headers: { "If-Match": item.etag || `\"${Number(item.version) || 1}\"` },
          body: JSON.stringify({ confirm: true })
        });
        await loadPending();
        setStatus("条目已移出待处理列表；来源原文没有被改写。", "success");
      } catch (error) {
        dismiss.disabled = false;
        setStatus(error.message, "error");
      }
    }

    function updateSummary(counts) {
      const pending = Math.max(0, Number(counts?.pending) || 0);
      elements.summary.textContent = pending ? `${pending} 段待确认` : "逐段确认后才入馆";
      elements.badge.textContent = String(pending);
      elements.badge.hidden = pending === 0;
    }

    function cleanupFile() {
      if (fileState?.bytes) fileState.bytes.fill(0);
      fileState = null;
      elements.file.value = "";
      elements.fileMeta.textContent = "尚未选择文件。";
      elements.candidates.replaceChildren();
    }

    function setStatus(message, tone = "") {
      elements.status.textContent = String(message || "");
      elements.status.classList.toggle("is-error", tone === "error");
      elements.status.classList.toggle("is-success", tone === "success");
    }

    async function requestJson(url, init = {}) {
      const headers = { Accept: "application/json", ...(init.headers || {}) };
      if (init.body !== undefined) headers["Content-Type"] = "application/json";
      const response = await fetchImpl(url, { ...init, headers });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = inboxError(payload.error || `请求失败（${response.status}）`, payload.code || "MEMORY_INBOX_REQUEST_FAILED");
        error.status = response.status;
        throw error;
      }
      return payload;
    }

    return Object.freeze({ admit, open, close, load: loadPending, prepareComposer, reset: cleanupFile, setComposerLocked, setDemo });
  }

  function createComposerContext(item) {
    const source = requireComposerItem(item);
    const excerpt = String(source.excerpt || source.excerptText || "");
    return {
      item: { ...source, admissionKey: source.admissionKey || randomKey("inbox-admit") },
      draft: {
        rawContent: excerpt,
        title: "",
        exhibitText: excerpt,
        hall: "daily",
        sourceType: "文档摘录",
        date: "",
        location: "",
        people: [],
        tags: [],
        emotions: [],
        importance: 2,
        emotionIntensity: 3,
        favorite: false
      },
      workflow: {
        steps: [
          { agent: "来源回执", output: "原文件哈希、UTF-16 区间与逐字片段已由本机服务复核。" },
          { agent: "等待你的决定", output: "没有自动推断任何日期、人物、关系、说话人或情绪。" }
        ]
      }
    };
  }

  function admissionMemory(memory = {}) {
    return {
      title: String(memory.title || ""),
      exhibitText: String(memory.exhibitText || ""),
      hall: String(memory.hall || "daily"),
      sourceType: String(memory.sourceType || "其他"),
      date: String(memory.date || ""),
      location: String(memory.location || ""),
      people: Array.isArray(memory.people) ? memory.people : [],
      tags: Array.isArray(memory.tags) ? memory.tags : [],
      emotions: Array.isArray(memory.emotions) ? memory.emotions : [],
      importance: Number(memory.importance),
      emotionIntensity: Number(memory.emotionIntensity),
      favorite: Boolean(memory.favorite)
    };
  }

  function requireComposerItem(item) {
    if (!item || typeof item !== "object" || !String(item.id || "") || !String(item.excerpt || item.excerptText || "")) {
      throw inboxError("收件箱条目缺少可核对的逐字片段。", "MEMORY_INBOX_ITEM_INVALID");
    }
    return item;
  }

  function collectElements(documentRef) {
    const elements = {
      open: documentRef.querySelector("#memoryInboxOpenButton"),
      summary: documentRef.querySelector("#memoryInboxSummary"),
      badge: documentRef.querySelector("#memoryInboxBadge"),
      dialog: documentRef.querySelector("#memoryInboxDialog"),
      title: documentRef.querySelector("#memoryInboxTitle"),
      close: [...documentRef.querySelectorAll("[data-memory-inbox-close]")],
      file: documentRef.querySelector("#memoryInboxFile"),
      fileLabel: documentRef.querySelector("#memoryInboxFileLabel"),
      sample: documentRef.querySelector("#memoryInboxSampleButton"),
      demoNote: documentRef.querySelector("#memoryInboxDemoNote"),
      localNote: documentRef.querySelector("#memoryInboxLocalNote"),
      fileMeta: documentRef.querySelector("#memoryInboxFileMeta"),
      candidates: documentRef.querySelector("#memoryInboxCandidates"),
      items: documentRef.querySelector("#memoryInboxItems"),
      refresh: documentRef.querySelector("#memoryInboxRefreshButton"),
      status: documentRef.querySelector("#memoryInboxStatus")
    };
    return Object.values(elements).every((value) => Array.isArray(value) ? value.length : value) ? elements : null;
  }

  function lineLabel(item) {
    const start = Number(item.startLine || item.anchor?.startLine) || 1;
    const end = Number(item.endLine || item.anchor?.endLine) || start;
    return `第 ${start}–${end} 行 · UTF-16 精确区间`;
  }

  function randomKey(prefix) {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return `${prefix}-${crypto.randomUUID()}`;
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function inboxError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  return Object.freeze({
    ALLOWED_EXTENSIONS,
    MAX_EXCERPT_LENGTH,
    MAX_FILE_BYTES,
    MAX_SEGMENTS,
    bytesToBase64,
    createComposerContext,
    createController,
    decodeUtf8,
    positionForOffset,
    segmentText
  });
}));
