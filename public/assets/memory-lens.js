(function initializeTimeIsleMemoryLens(root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.TimeIsleMemoryLens = factory();
}(typeof globalThis !== "undefined" ? globalThis : self, function createMemoryLensModule() {
  "use strict";

  const PREVIEW_FORMAT = "time-isle.memory-lens-preview";
  const PREVIEW_VERSION = 1;
  const ENGINE_ID = "deterministic-memory-lenses-v1";
  const ENGINE_KIND = "deterministic-local-rules";
  const ENGINE_BOUNDARY = "镜片只重排明确保存的字段和已确认来源；不认定事实，不推断关系、日期或情绪。";
  const CURATOR_BRIEF_FORMAT = "time-isle.memory-lens-curator-brief";
  const MIN_MEMORIES = 2;
  const MAX_MEMORIES = 20;
  const MAX_CANDIDATES = 200;
  const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
  const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/u;
  const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
  const CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;
  const SINGLE_LINE_CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u;
  const LENSES = Object.freeze({
    time: Object.freeze({
      code: "time",
      label: "时间镜片",
      short: "按已保存日期重排",
      boundary: "只读取已保存的日期字段；日期为空或格式不明确时保持原状，不从标题或正文补全。"
    }),
    cooccurrence: Object.freeze({
      code: "cooccurrence",
      label: "共同出现镜片",
      short: "按已确认实体并置",
      boundary: "只使用已确认实体引用；共同出现不代表朋友、亲属或任何其他关系。"
    }),
    evidence: Object.freeze({
      code: "evidence",
      label: "证据镜片",
      short: "按已保存来源类型重排",
      boundary: "只统计已保存的来源类型和已确认文字稿；数量不代表真实性或质量。"
    }),
    clue: Object.freeze({
      code: "clue",
      label: "线索镜片",
      short: "按明确查询词直接匹配",
      boundary: "只做用户查询词的直接字段匹配；不扩展近义词，不调用模型，也不把匹配当成事实。"
    })
  });

  function renderWorkbench() {
    return `
      <details class="memory-lens-workbench" data-memory-lens-root>
        <summary>
          <span><strong>设备内可解释镜片</strong><small>四种确定性重排 · 默认零保存</small></span>
          <span aria-hidden="true">＋</span>
        </summary>
        <div class="memory-lens-body">
          <p class="memory-lens-boundary" id="memoryLensBoundary">镜片只重排你明确选择的已保存字段和已确认来源。它不是 embedding、生成模型或人物关系判断，也不会推断日期、情绪或事实。</p>
          <form data-memory-lens-form aria-describedby="memoryLensBoundary" novalidate>
            <fieldset class="memory-lens-picker">
              <legend>1 · 选择观察方式</legend>
              <div class="memory-lens-options">
                ${lensChoice("time", true)}
                ${lensChoice("cooccurrence")}
                ${lensChoice("evidence")}
                ${lensChoice("clue")}
              </div>
            </fieldset>
            <label class="memory-lens-query" data-memory-lens-query-wrap hidden>明确线索词
              <input type="search" name="query" maxlength="160" autocomplete="off" placeholder="用空格分隔 1–8 个直接匹配词" disabled />
              <small><span data-memory-lens-query-count>0</span> / 160 · 不扩展近义词，不读取情绪字段</small>
            </label>
            <fieldset class="memory-lens-scope">
              <legend>2 · 明确选择 2–20 件展品</legend>
              <div class="memory-lens-scope-actions">
                <button type="button" class="button secondary compact" data-memory-lens-refresh>读取当前馆藏</button>
                <button type="button" class="button text-button compact" data-memory-lens-select-first disabled>选择前 20 件</button>
                <button type="button" class="button text-button compact" data-memory-lens-clear disabled>清除选择</button>
              </div>
              <p class="memory-lens-scope-status" data-memory-lens-scope-status role="status" aria-live="polite">展开后读取可选展品；不会自动勾选。</p>
              <div class="memory-lens-memory-list" data-memory-lens-memory-list role="group" aria-label="可选展品"></div>
            </fieldset>
            <div class="memory-lens-actions">
              <button type="submit" class="button secondary" data-memory-lens-run disabled>生成未保存预览</button>
              <button type="button" class="button text-button" data-memory-lens-cancel hidden>取消本次计算</button>
              <span data-memory-lens-selection-count>已选 0 / 20</span>
            </div>
            <p class="memory-lens-status" data-memory-lens-status role="status" aria-live="polite" aria-atomic="true">先明确选择展品，再生成一次只读预览。</p>
          </form>
          <section class="memory-lens-output" data-memory-lens-output aria-labelledby="memoryLensOutputTitle" hidden>
            <header class="memory-lens-output-heading">
              <div><p class="eyebrow">LOCAL EXPLAINABLE VIEW</p><h3 id="memoryLensOutputTitle" tabindex="-1" data-memory-lens-output-title>镜片预览</h3></div>
              <div class="memory-lens-engine-badges" aria-label="计算边界">
                <span>本机确定性规则</span><span>0 次模型调用</span><span>本次不保存</span>
              </div>
            </header>
            <p class="memory-lens-active-boundary" data-memory-lens-active-boundary></p>
            <div class="memory-lens-groups" data-memory-lens-groups aria-label="重排分组"></div>
            <ol class="memory-lens-results" data-memory-lens-results aria-label="镜片重排结果"></ol>
            <details class="memory-lens-receipt">
              <summary>查看本次规则回执</summary>
              <dl data-memory-lens-receipt></dl>
            </details>
            <div class="memory-lens-curator-actions">
              <button type="button" class="button secondary" data-memory-lens-curate disabled>带入策展（未保存简报）</button>
              <p data-memory-lens-curate-status role="status" aria-live="polite">只把本次镜片、顺序和来源摘要交给策展输入区，不会保存或发布。</p>
            </div>
          </section>
        </div>
      </details>`;
  }

  function lensChoice(code, checked = false) {
    const lens = LENSES[code];
    return `<label class="memory-lens-choice">
      <input type="radio" name="lens" value="${code}" ${checked ? "checked" : ""} />
      <span><strong>${lens.label}</strong><small>${lens.short}</small><em>${lens.boundary}</em></span>
    </label>`;
  }

  function createController(options = {}) {
    const documentRef = options.document || (typeof document !== "undefined" ? document : null);
    const rootElement = options.root || documentRef?.querySelector?.("[data-memory-lens-root]");
    const loadMemories = typeof options.loadMemories === "function"
      ? options.loadMemories
      : typeof options.getMemories === "function"
        ? options.getMemories
        : () => options.memories || [];
    const buildPreview = typeof options.buildPreview === "function" ? options.buildPreview : null;
    const onCurate = typeof options.onCurate === "function" ? options.onCurate : null;
    const onOpenMemory = typeof options.onOpenMemory === "function" ? options.onOpenMemory : null;
    if (!documentRef || !rootElement) return null;
    const elements = collectElements(rootElement);
    const gate = createOperationGate(options.AbortController);
    const listeners = [];
    let destroyed = false;
    let loaded = false;
    let candidates = [];
    let candidatesById = new Map();
    let preview = null;
    let briefDelivered = false;

    listen(rootElement, "toggle", handleRootToggle);
    listen(elements.form, "submit", handleSubmit);
    listen(elements.form, "change", handleChange);
    listen(elements.form, "input", handleInput);
    listen(elements.form, "click", handleFormClick);
    listen(elements.output, "click", handleOutputClick);
    updateQueryAccess(false);
    updateControls();

    function listen(target, type, handler) {
      target.addEventListener(type, handler);
      listeners.push({ target, type, handler });
    }

    function handleRootToggle(event) {
      if (event.target !== rootElement) return;
      if (rootElement.open) {
        if (!loaded && !gate.busy()) refreshMemories();
      } else {
        if (gate.cancel()) setStatus(elements.status, "面板关闭，本次读取或计算已取消；过期结果不会进入页面。", "success");
        updateControls();
      }
    }

    function handleSubmit(event) {
      event.preventDefault();
      runPreview();
    }

    function handleChange(event) {
      if (event.target.name === "lens") {
        updateQueryAccess(event.target.value === "clue", true);
        clearPreview();
        setStatus(elements.status, "观察方式已切换；生成后仍只是一次未保存预览。");
        updateControls();
        return;
      }
      if (event.target.name === "memoryLensSource") {
        enforceSelectionLimit(event.target);
        clearPreview();
        updateControls();
      }
    }

    function handleInput(event) {
      if (event.target.name !== "query") return;
      elements.queryCount.textContent = String([...event.target.value].length);
      clearPreview();
      updateControls();
    }

    function handleFormClick(event) {
      if (event.target.closest("[data-memory-lens-refresh]")) refreshMemories();
      if (event.target.closest("[data-memory-lens-select-first]")) selectFirst();
      if (event.target.closest("[data-memory-lens-clear]")) clearSelection();
      if (event.target.closest("[data-memory-lens-cancel]")) cancelCurrent();
    }

    function handleOutputClick(event) {
      const memoryButton = event.target.closest("[data-memory-lens-memory]");
      if (memoryButton && onOpenMemory) {
        const memoryId = safeId(memoryButton.dataset.memoryLensMemory);
        if (memoryId) onOpenMemory(memoryId, memoryButton);
        return;
      }
      if (event.target.closest("[data-memory-lens-curate]")) deliverBrief();
    }

    async function refreshMemories() {
      if (destroyed) return;
      const selected = new Set(selectedIds());
      clearPreview();
      const operation = gate.begin("scope");
      setStatus(elements.scopeStatus, "正在读取当前设备里的可选展品…");
      updateControls();
      try {
        const payload = await loadMemories({ signal: operation.signal });
        if (!operation.isCurrent() || destroyed) return;
        const raw = Array.isArray(payload) ? payload : payload?.memories;
        const normalized = normalizeCandidates(raw);
        candidates = normalized.candidates;
        candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
        loaded = true;
        renderCandidates(selected);
        const hidden = normalized.total - candidates.length;
        setStatus(elements.scopeStatus, candidates.length
          ? `已读取 ${candidates.length} 件可选展品${hidden > 0 ? `；另有 ${hidden} 件未进入本次列表` : ""}。请明确勾选 2–20 件。`
          : "当前没有可用于镜片的已保存展品。", candidates.length ? "success" : "");
      } catch (error) {
        if (operation.isCurrent() && error?.name !== "AbortError") {
          loaded = false;
          candidates = [];
          candidatesById = new Map();
          renderCandidates(new Set());
          setStatus(elements.scopeStatus, `读取没有完成：${message(error)}`, "error");
        }
      } finally {
        operation.finish();
        if (!destroyed) updateControls();
      }
    }

    function renderCandidates(selected) {
      elements.memoryList.replaceChildren();
      const fragment = documentRef.createDocumentFragment();
      for (const candidate of candidates) {
        const label = element("label", "memory-lens-memory-choice");
        const input = element("input", "");
        input.type = "checkbox";
        input.name = "memoryLensSource";
        input.value = candidate.id;
        input.checked = selected.has(candidate.id);
        const copy = element("span", "");
        const title = element("strong", "");
        title.textContent = candidate.title;
        const meta = element("small", "");
        meta.textContent = candidate.date ? `已保存日期 · ${candidate.date}` : "日期字段为空或未标准化";
        copy.append(title, meta);
        label.append(input, copy);
        fragment.append(label);
      }
      elements.memoryList.append(fragment);
      updateControls();
    }

    function selectFirst() {
      if (gate.busy()) return;
      elements.memoryList.querySelectorAll('input[name="memoryLensSource"]').forEach((input, index) => {
        input.checked = index < MAX_MEMORIES;
      });
      clearPreview();
      setStatus(elements.status, "已按当前列表顺序明确选择前 20 件以内的展品；尚未生成预览。");
      updateControls();
    }

    function clearSelection() {
      if (gate.busy()) return;
      elements.memoryList.querySelectorAll('input[name="memoryLensSource"]:checked').forEach((input) => { input.checked = false; });
      clearPreview();
      setStatus(elements.status, "已清除本次选择；馆藏没有变化。");
      updateControls();
    }

    function enforceSelectionLimit(changed) {
      const selected = selectedIds();
      if (selected.length <= MAX_MEMORIES) return;
      changed.checked = false;
      setStatus(elements.status, "一次最多明确选择 20 件展品；刚才的第 21 项没有加入。", "error");
    }

    async function runPreview() {
      if (destroyed || gate.busy()) return;
      const lens = selectedLens();
      const ids = selectedIds();
      if (ids.length < MIN_MEMORIES || ids.length > MAX_MEMORIES) {
        setStatus(elements.status, "请明确选择 2–20 件展品。", "error");
        elements.memoryList.querySelector("input")?.focus();
        return;
      }
      let query = "";
      try {
        query = lens === "clue" ? validateClueQuery(elements.query.value) : "";
      } catch (error) {
        setStatus(elements.status, message(error), "error");
        elements.query.focus();
        return;
      }
      if (!buildPreview) {
        setStatus(elements.status, "设备内镜片计算器尚未接入；没有发送或保存任何内容。", "error");
        return;
      }
      clearPreview();
      const memories = ids.map((id) => candidatesById.get(id)?.raw).filter(Boolean);
      const request = Object.freeze({ lens, memories: Object.freeze(memories), ...(lens === "clue" ? { query } : {}) });
      const operation = gate.begin("preview");
      setStatus(elements.status, `正在用${LENSES[lens].label}执行设备内确定性重排…`);
      updateControls();
      try {
        const payload = await buildPreview(request, { signal: operation.signal, requestId: operation.id });
        if (!operation.isCurrent() || destroyed) return;
        preview = normalizePreview(payload?.preview || payload, { lens, query, memoryIds: ids });
        briefDelivered = false;
        renderPreview(preview);
        setStatus(elements.status, `已生成 ${preview.sourceCount} 件展品的未保存预览；未调用 embedding 或模型。`, "success");
      } catch (error) {
        if (operation.isCurrent() && error?.name !== "AbortError") {
          clearPreview();
          setStatus(elements.status, `预览没有完成：${friendlyError(error)}`, "error");
        }
      } finally {
        operation.finish();
        if (!destroyed) updateControls();
      }
    }

    function cancelCurrent() {
      if (!gate.busy()) return;
      gate.cancel();
      setStatus(elements.status, "已取消本次读取或计算；过期结果不会进入页面。", "success");
      updateControls();
    }

    function renderPreview(value) {
      elements.output.hidden = false;
      elements.outputTitle.textContent = `${value.lens.label} · ${value.sourceCount} 件展品`;
      elements.activeBoundary.textContent = value.lens.boundary;
      elements.groups.replaceChildren();
      for (const group of value.groups) {
        const article = element("article", "memory-lens-group");
        const heading = element("div", "");
        const title = element("strong", "");
        title.textContent = group.label;
        const count = element("span", "");
        count.textContent = `${group.memoryIds.length} 件`;
        heading.append(title, count);
        const reason = element("p", "");
        reason.textContent = group.reason;
        article.append(heading, reason);
        elements.groups.append(article);
      }
      elements.results.replaceChildren();
      for (const item of value.items) {
        const row = element("li", "memory-lens-result");
        const heading = element("div", "memory-lens-result-heading");
        const position = element("span", "memory-lens-position");
        position.textContent = String(item.position).padStart(2, "0");
        const title = onOpenMemory ? element("button", "button text-button memory-lens-memory-button") : element("strong", "");
        if (onOpenMemory) {
          title.type = "button";
          title.dataset.memoryLensMemory = item.memoryId;
          title.setAttribute("aria-label", `打开展品：${item.title}`);
        }
        title.textContent = item.title;
        heading.append(position, title);
        const reason = element("p", "");
        reason.textContent = item.reason;
        row.append(heading, reason);
        if (item.evidence.length) {
          const evidence = element("ul", "memory-lens-evidence");
          evidence.setAttribute("aria-label", "重排依据");
          item.evidence.forEach((entry) => {
            const evidenceItem = element("li", "");
            const label = element("strong", "");
            label.textContent = entry.label;
            const valueText = element("span", "");
            valueText.textContent = entry.value;
            evidenceItem.append(label, valueText);
            evidence.append(evidenceItem);
          });
          row.append(evidence);
        }
        elements.results.append(row);
      }
      renderReceipt(value);
      elements.curate.disabled = !onCurate;
      elements.curateStatus.textContent = onCurate
        ? "只有点击按钮后，未保存简报才会交给策展输入区。"
        : "策展接线尚未启用；当前预览仍可独立验看。";
      elements.outputTitle.focus({ preventScroll: true });
    }

    function renderReceipt(value) {
      elements.receipt.replaceChildren();
      const entries = [
        ["规则引擎", value.engine.id],
        ["计算方式", "设备内确定性规则"],
        ["模型 / 工具调用", "0 / 0"],
        ["来源快照", value.sourceSnapshotSha256],
        ["本次请求", value.requestSha256],
        ["预览摘要", value.previewSha256]
      ];
      for (const [label, text] of entries) {
        const term = element("dt", "");
        term.textContent = label;
        const detail = element("dd", "");
        detail.textContent = text;
        elements.receipt.append(term, detail);
      }
    }

    async function deliverBrief() {
      if (!preview || !onCurate || briefDelivered) return;
      const brief = createCuratorBrief(preview);
      briefDelivered = true;
      elements.curate.disabled = true;
      elements.curateStatus.textContent = "正在把未保存简报带入策展输入区…";
      try {
        await onCurate(brief);
        if (destroyed || preview?.previewSha256 !== brief.previewSha256) return;
        elements.curateStatus.textContent = "未保存简报已带入策展输入区；它仍未保存、发布或改写任何展品。";
      } catch (error) {
        if (destroyed || preview?.previewSha256 !== brief.previewSha256) return;
        briefDelivered = false;
        elements.curate.disabled = false;
        elements.curateStatus.textContent = `简报没有带入：${message(error)}；没有保存任何内容。`;
      }
    }

    function clearPreview() {
      preview = null;
      briefDelivered = false;
      elements.output.hidden = true;
      elements.groups.replaceChildren();
      elements.results.replaceChildren();
      elements.receipt.replaceChildren();
      elements.curate.disabled = true;
    }

    function updateQueryAccess(clue, focus = false) {
      elements.queryWrap.hidden = !clue;
      elements.query.disabled = !clue || gate.busy();
      elements.query.required = clue;
      if (clue && focus) elements.query.focus();
    }

    function updateControls() {
      const busy = gate.busy();
      const selected = selectedIds().length;
      const clue = selectedLens() === "clue";
      elements.form.setAttribute("aria-busy", String(busy));
      elements.cancel.hidden = !busy;
      elements.cancel.disabled = !busy;
      elements.run.disabled = busy || !loaded || selected < MIN_MEMORIES || selected > MAX_MEMORIES || (clue && !elements.query.value.trim());
      elements.refresh.disabled = busy;
      elements.selectFirst.disabled = busy || !candidates.length;
      elements.clear.disabled = busy || !selected;
      elements.query.disabled = busy || !clue;
      elements.form.querySelectorAll('input[name="lens"], input[name="memoryLensSource"]').forEach((input) => { input.disabled = busy; });
      elements.selectionCount.textContent = `已选 ${selected} / ${MAX_MEMORIES}`;
    }

    function selectedLens() {
      const code = elements.form.elements.namedItem("lens")?.value;
      return Object.hasOwn(LENSES, code) ? code : "time";
    }

    function selectedIds() {
      return [...elements.memoryList.querySelectorAll('input[name="memoryLensSource"]:checked')]
        .map((input) => safeId(input.value)).filter(Boolean);
    }

    function element(tag, className) {
      const node = documentRef.createElement(tag);
      if (className) node.className = className;
      return node;
    }

    function invalidate() {
      gate.cancel();
      loaded = false;
      candidates = [];
      candidatesById = new Map();
      elements.memoryList.replaceChildren();
      clearPreview();
      setStatus(elements.scopeStatus, "馆藏范围已失效；展开或刷新后重新读取。", "");
      updateControls();
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      gate.destroy();
      listeners.forEach(({ target, type, handler }) => target.removeEventListener(type, handler));
      listeners.length = 0;
      clearPreview();
    }

    return Object.freeze({ destroy, invalidate, refresh: refreshMemories, renderWorkbench });
  }

  function collectElements(root) {
    const selectors = {
      form: "[data-memory-lens-form]",
      queryWrap: "[data-memory-lens-query-wrap]",
      query: 'input[name="query"]',
      queryCount: "[data-memory-lens-query-count]",
      refresh: "[data-memory-lens-refresh]",
      selectFirst: "[data-memory-lens-select-first]",
      clear: "[data-memory-lens-clear]",
      scopeStatus: "[data-memory-lens-scope-status]",
      memoryList: "[data-memory-lens-memory-list]",
      run: "[data-memory-lens-run]",
      cancel: "[data-memory-lens-cancel]",
      selectionCount: "[data-memory-lens-selection-count]",
      status: "[data-memory-lens-status]",
      output: "[data-memory-lens-output]",
      outputTitle: "[data-memory-lens-output-title]",
      activeBoundary: "[data-memory-lens-active-boundary]",
      groups: "[data-memory-lens-groups]",
      results: "[data-memory-lens-results]",
      receipt: "[data-memory-lens-receipt]",
      curate: "[data-memory-lens-curate]",
      curateStatus: "[data-memory-lens-curate-status]"
    };
    const elements = Object.fromEntries(Object.entries(selectors).map(([key, selector]) => [key, root.querySelector(selector)]));
    const missing = Object.entries(elements).filter(([, value]) => !value).map(([key]) => key);
    if (missing.length) throw lensError(`镜片工作台缺少 DOM：${missing.join("、")}`, "MEMORY_LENS_DOM_MISSING");
    return elements;
  }

  function normalizeCandidates(input) {
    const source = Array.isArray(input) ? input : [];
    const candidates = [];
    const seen = new Set();
    for (const value of source) {
      if (candidates.length >= MAX_CANDIDATES) break;
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const id = safeId(value.id);
      if (!id || seen.has(id)) continue;
      const title = boundedDisplayText(value.title, 160);
      if (!title) continue;
      seen.add(id);
      candidates.push(Object.freeze({
        id,
        title,
        date: boundedDisplayText(value.date, 40),
        updatedAt: boundedDisplayText(value.updatedAt, 40),
        raw: value
      }));
    }
    return Object.freeze({ candidates: Object.freeze(candidates), total: source.length });
  }

  function normalizePreview(input, expected = {}) {
    requirePlainObject(input, "预览");
    if (input.format !== PREVIEW_FORMAT || input.version !== PREVIEW_VERSION) {
      throw lensError("镜片预览格式或版本不受支持。", "MEMORY_LENS_PREVIEW_INVALID");
    }
    requirePlainObject(input.engine, "规则引擎");
    if (input.engine.id !== ENGINE_ID || input.engine.kind !== ENGINE_KIND || input.engine.externalModel !== false ||
        input.engine.toolCalls !== 0 || input.engine.persisted !== false || input.engine.boundary !== ENGINE_BOUNDARY) {
      throw lensError("镜片结果没有满足设备内确定性、零模型和零持久化边界。", "MEMORY_LENS_ENGINE_INVALID");
    }
    requirePlainObject(input.lens, "镜片");
    const code = String(input.lens.code || "");
    const definition = LENSES[code];
    if (!definition || input.lens.label !== definition.label || input.lens.boundary !== definition.boundary ||
        (expected.lens && expected.lens !== code)) {
      throw lensError("返回的镜片与本次明确选择不一致。", "MEMORY_LENS_PREVIEW_INVALID");
    }
    const query = requireText(input.query ?? "", "查询词", 0, 160, true);
    const expectedQuery = String(expected.query || "");
    if ((code === "clue" && query !== expectedQuery) || (code !== "clue" && query !== "")) {
      throw lensError("镜片结果的查询词与本次请求不一致。", "MEMORY_LENS_PREVIEW_INVALID");
    }
    const queryTerms = normalizeTextArray(input.queryTerms, "查询词列表", 8, 40, true);
    if ((code === "clue" && !queryTerms.length) || (code !== "clue" && queryTerms.length)) {
      throw lensError("镜片结果包含意外的查询词。", "MEMORY_LENS_PREVIEW_INVALID");
    }
    if (code === "clue" && !sameStrings(queryTerms, splitClueTerms(query))) {
      throw lensError("镜片结果改变了用户明确输入的线索词。", "MEMORY_LENS_PREVIEW_INVALID");
    }
    const sourceCount = requireInteger(input.sourceCount, "来源数量", MIN_MEMORIES, MAX_MEMORIES);
    const expectedIds = Array.isArray(expected.memoryIds) ? expected.memoryIds.map(safeId).filter(Boolean).sort() : [];
    const sourceRefs = normalizeSourceRefs(input.sourceRefs, sourceCount);
    const sourceIds = sourceRefs.map((entry) => entry.memoryId).sort();
    if (expectedIds.length && !sameStrings(sourceIds, expectedIds)) {
      throw lensError("镜片结果扩大、缩小或替换了用户明确选择的来源范围。", "MEMORY_LENS_SOURCE_SCOPE_INVALID");
    }
    const groups = normalizeGroups(input.groups, new Set(sourceIds));
    const items = normalizeItems(input.items, new Set(sourceIds));
    if (items.length !== sourceCount || !sameStrings(items.map((item) => item.memoryId).sort(), sourceIds)) {
      throw lensError("镜片结果没有逐件覆盖明确选择的展品。", "MEMORY_LENS_SOURCE_SCOPE_INVALID");
    }
    validateMembership(groups, items);
    const value = {
      format: PREVIEW_FORMAT,
      version: PREVIEW_VERSION,
      engine: { id: ENGINE_ID, kind: ENGINE_KIND, externalModel: false, toolCalls: 0, persisted: false, boundary: ENGINE_BOUNDARY },
      lens: { code, label: definition.label, boundary: definition.boundary },
      query,
      queryTerms,
      sourceCount,
      sourceRefs,
      sourceSnapshotSha256: requireSha256(input.sourceSnapshotSha256, "来源快照"),
      requestSha256: requireSha256(input.requestSha256, "请求摘要"),
      previewSha256: requireSha256(input.previewSha256, "预览摘要"),
      groups,
      items
    };
    return deepFreeze(value);
  }

  function normalizeSourceRefs(input, count) {
    if (!Array.isArray(input) || input.length !== count || !isDenseArray(input)) {
      throw lensError("镜片来源回执不完整。", "MEMORY_LENS_SOURCE_SCOPE_INVALID");
    }
    const seen = new Set();
    return input.map((entry) => {
      requirePlainObject(entry, "来源回执");
      const memoryId = safeId(entry.memoryId);
      if (!memoryId || seen.has(memoryId) || !isTimestamp(entry.updatedAt)) {
        throw lensError("镜片来源回执包含无效或重复展品。", "MEMORY_LENS_SOURCE_SCOPE_INVALID");
      }
      seen.add(memoryId);
      return { memoryId, updatedAt: entry.updatedAt };
    });
  }

  function normalizeGroups(input, sourceIds) {
    if (!Array.isArray(input) || !input.length || input.length > 256 || !isDenseArray(input)) {
      throw lensError("镜片分组超出边界。", "MEMORY_LENS_PREVIEW_INVALID");
    }
    const seenKeys = new Set();
    return input.map((group, index) => {
      requirePlainObject(group, "镜片分组");
      if (group.position !== index + 1 || !Array.isArray(group.memoryIds) || !isDenseArray(group.memoryIds)) {
        throw lensError("镜片分组顺序无效。", "MEMORY_LENS_PREVIEW_INVALID");
      }
      const memoryIds = group.memoryIds.map(safeId);
      if (!memoryIds.length || memoryIds.some((id) => !id || !sourceIds.has(id)) || new Set(memoryIds).size !== memoryIds.length) {
        throw lensError("镜片分组引用了范围外或重复展品。", "MEMORY_LENS_SOURCE_SCOPE_INVALID");
      }
      const key = requireText(group.key, "分组键", 1, 200, true);
      if (seenKeys.has(key)) throw lensError("镜片分组键重复。", "MEMORY_LENS_PREVIEW_INVALID");
      seenKeys.add(key);
      return {
        position: group.position,
        key,
        label: requireText(group.label, "分组标题", 1, 240, true),
        reason: requireText(group.reason, "分组解释", 1, 2000, false),
        memoryIds
      };
    });
  }

  function normalizeItems(input, sourceIds) {
    if (!Array.isArray(input) || input.length > MAX_MEMORIES || !isDenseArray(input)) {
      throw lensError("镜片结果条目超出边界。", "MEMORY_LENS_PREVIEW_INVALID");
    }
    const seen = new Set();
    return input.map((item, index) => {
      requirePlainObject(item, "镜片条目");
      const memoryId = safeId(item.memoryId);
      if (item.position !== index + 1 || !memoryId || !sourceIds.has(memoryId) || seen.has(memoryId)) {
        throw lensError("镜片条目顺序或来源范围无效。", "MEMORY_LENS_SOURCE_SCOPE_INVALID");
      }
      seen.add(memoryId);
      const groupKeys = normalizeTextArray(item.groupKeys, "条目分组键", 24, 200, true);
      if (!groupKeys.length || new Set(groupKeys).size !== groupKeys.length) {
        throw lensError("镜片条目缺少分组或包含重复分组。", "MEMORY_LENS_PREVIEW_INVALID");
      }
      return {
        position: item.position,
        memoryId,
        title: requireText(item.title, "展品标题", 1, 160, true),
        groupKeys,
        reason: requireText(item.reason, "条目解释", 1, 3000, false),
        evidence: normalizeEvidence(item.evidence)
      };
    });
  }

  function normalizeEvidence(input) {
    if (!Array.isArray(input) || input.length > 24 || !isDenseArray(input)) {
      throw lensError("镜片依据超出边界。", "MEMORY_LENS_PREVIEW_INVALID");
    }
    return input.map((entry) => {
      requirePlainObject(entry, "镜片依据");
      return {
        field: requireText(entry.field, "依据字段", 1, 80, true),
        label: requireText(entry.label, "依据标签", 1, 120, true),
        value: requireText(entry.value, "依据值", 1, 4000, false)
      };
    });
  }

  function createCuratorBrief(preview) {
    const value = normalizePreview(preview, {
      lens: preview?.lens?.code,
      query: preview?.query,
      memoryIds: preview?.sourceRefs?.map((entry) => entry.memoryId)
    });
    return deepFreeze({
      format: CURATOR_BRIEF_FORMAT,
      version: 1,
      state: "unsaved-preview",
      persisted: false,
      engine: ENGINE_ID,
      lens: { ...value.lens },
      query: value.query,
      sourceRefs: value.sourceRefs.map((entry) => ({ ...entry })),
      sourceSnapshotSha256: value.sourceSnapshotSha256,
      previewSha256: value.previewSha256,
      orderedMemoryIds: value.items.map((item) => item.memoryId),
      groupSummaries: value.groups.map((group) => ({ key: group.key, label: group.label, memoryIds: [...group.memoryIds] })),
      boundary: "这只是由设备内确定性规则生成的未保存简报；策展仍需用户决定，不能据此认定事实或人物关系。"
    });
  }

  function validateClueQuery(value) {
    if (typeof value !== "string" || value.length > 320 || SINGLE_LINE_CONTROL_PATTERN.test(value)) {
      throw lensError("线索词格式无效。", "MEMORY_LENS_QUERY_INVALID");
    }
    const query = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
    const length = [...query].length;
    if (length < 1 || length > 160) throw lensError("线索查询需包含 1–160 个字符。", "MEMORY_LENS_QUERY_INVALID");
    const terms = splitClueTerms(query);
    if (!terms.length || terms.length > 8) throw lensError("请明确输入 1–8 个线索词。", "MEMORY_LENS_QUERY_INVALID");
    return query;
  }

  function splitClueTerms(query) {
    const seen = new Set();
    const terms = [];
    String(query || "").split(" ").forEach((term) => {
      const key = term.normalize("NFKC").toLowerCase();
      if ([...term].length > 40) throw lensError("每个线索词最多 40 个字符。", "MEMORY_LENS_QUERY_INVALID");
      if (term && !seen.has(key)) {
        seen.add(key);
        terms.push(term);
      }
    });
    return terms;
  }

  function validateMembership(groups, items) {
    const byKey = new Map(groups.map((group) => [group.key, new Set(group.memoryIds)]));
    for (const item of items) {
      for (const key of item.groupKeys) {
        if (!byKey.get(key)?.has(item.memoryId)) {
          throw lensError("镜片条目与分组回执不一致。", "MEMORY_LENS_PREVIEW_INVALID");
        }
      }
    }
    for (const group of groups) {
      for (const memoryId of group.memoryIds) {
        const item = items.find((candidate) => candidate.memoryId === memoryId);
        if (!item?.groupKeys.includes(group.key)) {
          throw lensError("镜片分组与条目回执不一致。", "MEMORY_LENS_PREVIEW_INVALID");
        }
      }
    }
  }

  function createOperationGate(AbortControllerCtor) {
    const Controller = AbortControllerCtor || (typeof AbortController !== "undefined" ? AbortController : null);
    if (!Controller) throw lensError("当前环境不支持可取消请求。", "MEMORY_LENS_ABORT_UNAVAILABLE");
    let serial = 0;
    let current = null;
    let destroyed = false;
    function begin(kind = "operation") {
      if (destroyed) throw lensError("镜片控制器已经销毁。", "MEMORY_LENS_CONTROLLER_DESTROYED");
      current?.controller.abort();
      const record = { id: ++serial, kind, controller: new Controller() };
      current = record;
      return Object.freeze({
        id: record.id,
        kind,
        signal: record.controller.signal,
        isCurrent: () => !destroyed && current === record && !record.controller.signal.aborted,
        finish: () => { if (current === record) current = null; }
      });
    }
    function cancel() {
      if (!current) return false;
      const record = current;
      current = null;
      record.controller.abort();
      serial += 1;
      return true;
    }
    function destroy() {
      if (destroyed) return;
      cancel();
      destroyed = true;
    }
    return Object.freeze({ begin, busy: () => Boolean(current), cancel, destroy });
  }

  function setStatus(target, text, tone = "") {
    target.textContent = text;
    target.classList.toggle("is-error", tone === "error");
    target.classList.toggle("is-success", tone === "success");
  }

  function requirePlainObject(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw lensError(`${label}必须是对象。`, "MEMORY_LENS_PREVIEW_INVALID");
    }
  }

  function requireText(value, label, minimum, maximum, singleLine) {
    if (typeof value !== "string" || value.length > maximum * 2) {
      throw lensError(`${label}不是受限文字。`, "MEMORY_LENS_PREVIEW_INVALID");
    }
    const length = [...value].length;
    const pattern = singleLine ? SINGLE_LINE_CONTROL_PATTERN : CONTROL_PATTERN;
    if (length < minimum || length > maximum || pattern.test(value) || (singleLine && value.includes("\n"))) {
      throw lensError(`${label}不是规范文字。`, "MEMORY_LENS_PREVIEW_INVALID");
    }
    return value;
  }

  function normalizeTextArray(input, label, maximumItems, maximumText, singleLine) {
    if (!Array.isArray(input) || input.length > maximumItems || !isDenseArray(input)) {
      throw lensError(`${label}超出边界。`, "MEMORY_LENS_PREVIEW_INVALID");
    }
    return input.map((value) => requireText(value, label, 1, maximumText, singleLine));
  }

  function requireInteger(value, label, minimum, maximum) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
      throw lensError(`${label}超出边界。`, "MEMORY_LENS_PREVIEW_INVALID");
    }
    return value;
  }

  function requireSha256(value, label) {
    if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
      throw lensError(`${label}不是有效 SHA-256。`, "MEMORY_LENS_PREVIEW_INVALID");
    }
    return value;
  }

  function safeId(value) {
    const id = String(value || "").trim();
    return ID_PATTERN.test(id) ? id : "";
  }

  function boundedDisplayText(value, maximum) {
    const text = String(value || "").replace(/[\u0000-\u001F\u007F]/gu, " ").trim();
    return [...text].slice(0, maximum).join("");
  }

  function isTimestamp(value) {
    if (typeof value !== "string" || !TIMESTAMP_PATTERN.test(value)) return false;
    const parsed = new Date(value);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
  }

  function isDenseArray(value) {
    if (!Array.isArray(value)) return false;
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) return false;
    }
    return true;
  }

  function sameStrings(left, right) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }

  function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
    return value;
  }

  function friendlyError(error) {
    const code = String(error?.code || "");
    if (code === "MEMORY_LENS_SOURCE_SCOPE_INVALID") return "返回结果没有保持你明确选择的展品范围，已拒绝展示。";
    if (code === "MEMORY_LENS_ENGINE_INVALID") return "返回结果不符合设备内确定性、零模型和零持久化边界，已拒绝展示。";
    return message(error);
  }

  function message(error) {
    return String(error?.message || error || "未知错误");
  }

  function lensError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  return Object.freeze({
    PREVIEW_FORMAT,
    PREVIEW_VERSION,
    ENGINE_ID,
    ENGINE_KIND,
    ENGINE_BOUNDARY,
    CURATOR_BRIEF_FORMAT,
    LENSES,
    LIMITS: Object.freeze({ minMemories: MIN_MEMORIES, maxMemories: MAX_MEMORIES, maxCandidates: MAX_CANDIDATES }),
    renderWorkbench,
    createController,
    normalizeCandidates,
    normalizePreview,
    createCuratorBrief,
    validateClueQuery,
    createOperationGate
  });
}));
