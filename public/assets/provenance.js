(function provenanceModule(root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.TimeIsleProvenance = factory();
}(typeof globalThis !== "undefined" ? globalThis : self, function createProvenanceModule() {
  "use strict";

  const RELATIONS = Object.freeze([
    { value: "supports", label: "支持这条说法" },
    { value: "supplements", label: "补充背景" },
    { value: "different_record", label: "留有另一种记录" }
  ]);
  const RELATION_SET = new Set(RELATIONS.map((item) => item.value));

  function renderPanel(memory = {}) {
    const id = safeId(memory.id);
    if (!id) return "";
    return `
      <details class="provenance-passport" data-provenance-passport="${id}">
        <summary>
          <span><strong>来源护照</strong><small data-provenance-summary>展开后读取人工主张与可核对来源</small></span>
          <span aria-hidden="true">＋</span>
        </summary>
        <div class="provenance-passport-body" data-provenance-body>
          <p class="provenance-status" role="status" aria-live="polite">尚未读取来源护照。</p>
        </div>
      </details>`;
  }

  function createController(options = {}) {
    const documentRef = options.document || (typeof document !== "undefined" ? document : null);
    const fetchImpl = options.fetch || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
    const onChanged = typeof options.onChanged === "function" ? options.onChanged : () => {};
    if (!documentRef || !fetchImpl) return null;
    const element = (tag, className) => createElementNode(documentRef, tag, className);
    const actionButton = (label, action, claim, extraClass = "") => createActionButton(documentRef, label, action, claim, extraClass);
    const relationSelect = () => createRelationSelect(documentRef);
    const numberInput = (labelText, key, minimum, maximum) => createNumberInput(documentRef, labelText, key, minimum, maximum);
    let demo = Boolean(options.demo);
    let session = null;

    function setDemo(value) {
      demo = Boolean(value);
    }

    function open(memory, container) {
      close();
      const panel = container?.querySelector?.(`[data-provenance-passport="${safeId(memory?.id)}"]`);
      if (!panel) return;
      const body = panel.querySelector("[data-provenance-body]");
      const summary = panel.querySelector("[data-provenance-summary]");
      const controller = new AbortController();
      session = { memory, panel, body, summary, controller, loaded: false, passport: null, candidates: [], selected: [] };
      panel.addEventListener("toggle", () => {
        if (panel.open && !session.loaded) load(session);
      }, { signal: controller.signal });
      body.addEventListener("click", handleClick, { signal: controller.signal });
      body.addEventListener("change", handleChange, { signal: controller.signal });
    }

    function close() {
      if (!session) return;
      session.controller.abort();
      session.selected.length = 0;
      session.passport = null;
      session.candidates.length = 0;
      session = null;
    }

    function refresh() { return session ? load(session) : Promise.resolve(); }

    async function load(active, focusCreate = false) {
      active.loaded = true;
      setStatus(active, "正在核对来源与主张账本…");
      try {
        const [passportPayload, sourcePayload] = await Promise.all([
          requestJson(`/api/provenance/memories/${encodeURIComponent(active.memory.id)}`),
          requestJson(`/api/provenance/memories/${encodeURIComponent(active.memory.id)}/sources`)
        ]);
        if (session !== active) return;
        active.passport = passportPayload.passport || passportPayload;
        active.candidates = Array.isArray(sourcePayload.sources) ? sourcePayload.sources : [];
        active.selected = [];
        render(active);
        if (focusCreate) active.body.querySelector("[data-provenance-statement]")?.focus();
      } catch (error) {
        if (error.name !== "AbortError" && session === active) setStatus(active, error.message, true);
      }
    }

    function render(active) {
      const passport = active.passport || { claims: [], summary: {} };
      const claims = Array.isArray(passport.claims) ? passport.claims : [];
      const counts = passport.summary || {};
      active.summary.textContent = summaryText(counts, claims);
      active.body.replaceChildren();

      const boundary = element("p", "provenance-boundary");
      boundary.textContent = "这里确认的是“这条说法与这些来源有关”，不是事实认证、可信度评分或公证。来源变化只会提示重新核对，不会改写原记忆。";
      active.body.append(boundary);

      const claimList = element("div", "provenance-claim-list");
      claimList.dataset.provenanceClaims = "";
      if (!claims.length) {
        const empty = element("p", "provenance-empty");
        empty.textContent = "还没有人工主张。来源可以先存在，不会自动生成结论。";
        claimList.append(empty);
      } else {
        claims.forEach((claim) => claimList.append(renderClaim(claim)));
      }
      active.body.append(claimList);

      if (!demo && !passport.synthetic) active.body.append(renderComposer(active));
      else {
        const note = element("p", "provenance-demo-note");
        note.textContent = "公开 Demo 只展示合成来源护照；新建、确认和撤回均保持零写入。";
        active.body.append(note);
      }
      const status = element("p", "provenance-status");
      status.dataset.provenanceStatus = "";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      active.body.append(status);
    }

    function renderClaim(claim) {
      const article = element("article", "provenance-claim");
      article.dataset.claimId = safeId(claim.id);
      const heading = element("header", "provenance-claim-heading");
      const statement = element("strong", "");
      statement.textContent = String(claim.statement || "未命名主张");
      const badge = element("span", `provenance-state is-${statusName(claim)}`);
      badge.textContent = statusLabel(claim);
      heading.append(statement, badge);
      article.append(heading);
      if (claim.needsReview) {
        const review = element("p", "provenance-review-note");
        review.textContent = "来源后来发生变化，需要重新核对；这不表示主张为假。";
        article.append(review);
      }
      const sources = element("ul", "provenance-source-list");
      for (const source of Array.isArray(claim.sources) ? claim.sources : []) {
        const item = element("li", "provenance-source");
        const title = element("strong", "");
        title.textContent = `${relationLabel(source.relationKind)} · ${String(source.label || source.kind || "来源")}`;
        const excerpt = element("span", "");
        excerpt.textContent = String(source.excerpt || source.summary || "已保存来源快照");
        const integrity = element("small", "");
        integrity.textContent = integrityLabel(source.integrityStatus);
        item.append(title, excerpt, integrity);
        sources.append(item);
      }
      article.append(sources);
      if (!demo && !claim.synthetic && !claim.needsReview && ["draft", "confirmed"].includes(statusName(claim))) {
        const actions = element("div", "provenance-actions");
        if (statusName(claim) === "draft") actions.append(actionButton("确认这条主张", "confirm", claim));
        actions.append(actionButton(statusName(claim) === "draft" ? "放弃草稿" : "撤回主张", "withdraw", claim, "text-button"));
        article.append(actions);
      }
      return article;
    }

    function renderComposer(active) {
      const details = element("details", "provenance-composer");
      const summary = documentRef.createElement("summary");
      const summaryTextNode = documentRef.createElement("span");
      const strong = documentRef.createElement("strong");
      strong.textContent = "新建一条主张";
      const small = documentRef.createElement("small");
      small.textContent = "先存为草稿，之后再单独确认";
      summaryTextNode.append(strong, small);
      const plus = documentRef.createElement("span");
      plus.setAttribute("aria-hidden", "true");
      plus.textContent = "＋";
      summary.append(summaryTextNode, plus);
      details.append(summary);
      const form = element("form", "provenance-form");
      form.dataset.provenanceForm = "";
      form.addEventListener("submit", (event) => { event.preventDefault(); createClaim(active); }, { signal: active.controller.signal });

      const statementLabel = documentRef.createElement("label");
      statementLabel.textContent = "你要记录的说法";
      const statement = documentRef.createElement("textarea");
      statement.dataset.provenanceStatement = "";
      statement.maxLength = 1000;
      statement.required = true;
      statement.placeholder = "只写你愿意亲自确认、并能回到来源核对的说法。";
      statementLabel.append(statement);
      form.append(statementLabel);

      form.append(renderMemoryTextPicker(active));
      const sourceBox = element("fieldset", "provenance-source-picker");
      const legend = documentRef.createElement("legend");
      legend.textContent = "其它已保存来源（可选）";
      sourceBox.append(legend);
      const available = active.candidates.filter((candidate) => candidate.kind !== "memory_text");
      if (!available.length) {
        const empty = element("p", "provenance-empty");
        empty.textContent = "当前没有其它已确认的照片区域、声音选段、口述史、共忆回信或文档摘录。";
        sourceBox.append(empty);
      } else {
        available.forEach((candidate, index) => sourceBox.append(renderSourceChoice(candidate, index)));
      }
      form.append(sourceBox);
      const selected = element("div", "provenance-selected");
      selected.dataset.provenanceSelected = "";
      selected.textContent = "尚未选择来源。";
      form.append(selected);
      const button = documentRef.createElement("button");
      button.type = "submit";
      button.className = "button primary";
      button.textContent = "保存为待确认草稿";
      form.append(button);
      details.append(form);
      return details;
    }

    function renderMemoryTextPicker(active) {
      const fieldset = element("fieldset", "provenance-text-picker");
      const legend = documentRef.createElement("legend");
      legend.textContent = "引用当前原文（至少选择一项来源）";
      const textarea = documentRef.createElement("textarea");
      textarea.readOnly = true;
      textarea.dataset.provenanceRawText = "";
      textarea.value = String(active.memory.rawContent || "");
      textarea.setAttribute("aria-label", "当前展品原文，可选择精确片段");
      const inputs = element("div", "provenance-offsets");
      inputs.append(numberInput("起点", "start", 0, textarea.value.length), numberInput("终点", "end", 0, textarea.value.length));
      const button = documentRef.createElement("button");
      button.type = "button";
      button.className = "button secondary compact";
      button.dataset.provenanceUseText = "";
      button.textContent = "使用所选原文";
      fieldset.append(legend, textarea, inputs, button);
      return fieldset;
    }

    function renderSourceChoice(candidate, index) {
      const row = element("div", "provenance-source-choice");
      const label = documentRef.createElement("label");
      const checkbox = documentRef.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.provenanceSourceIndex = String(index);
      const text = documentRef.createElement("span");
      text.textContent = `${String(candidate.label || candidate.kind || "来源")} · ${String(candidate.excerpt || candidate.summary || "可核对来源")}`;
      label.append(checkbox, text);
      const select = relationSelect();
      select.dataset.provenanceRelationIndex = String(index);
      row.dataset.candidate = JSON.stringify(candidate);
      row.append(label, select);
      return row;
    }

    function handleChange(event) {
      if (!session || !event.target.matches("[data-provenance-source-index], [data-provenance-relation-index]")) return;
      syncSelectedCandidates(session);
    }

    function handleClick(event) {
      if (!session) return;
      const useText = event.target.closest("[data-provenance-use-text]");
      if (useText) return selectMemoryText(session);
      const action = event.target.closest("[data-provenance-action]");
      if (action) decideClaim(session, action);
    }

    function selectMemoryText(active) {
      const textarea = active.body.querySelector("[data-provenance-raw-text]");
      const startInput = active.body.querySelector('[data-provenance-offset="start"]');
      const endInput = active.body.querySelector('[data-provenance-offset="end"]');
      const start = textarea.selectionStart !== textarea.selectionEnd ? textarea.selectionStart : Number(startInput.value);
      const end = textarea.selectionStart !== textarea.selectionEnd ? textarea.selectionEnd : Number(endInput.value);
      try {
        const source = buildMemoryTextSelection(active.memory, start, end);
        active.selected = active.selected.filter((item) => item.sourceKind !== "memory_text");
        active.selected.unshift({ ...source, relationKind: "supports" });
        startInput.value = String(start);
        endInput.value = String(end);
        renderSelected(active);
        setStatus(active, "已选择逐字原文；仍需保存草稿并单独确认。", false);
      } catch (error) {
        setStatus(active, error.message, true);
      }
    }

    function syncSelectedCandidates(active) {
      const textSources = active.selected.filter((item) => item.sourceKind === "memory_text");
      const others = [];
      active.body.querySelectorAll(".provenance-source-choice").forEach((row) => {
        const checkbox = row.querySelector("[data-provenance-source-index]");
        if (!checkbox.checked) return;
        let candidate;
        try { candidate = JSON.parse(row.dataset.candidate || "{}"); } catch { return; }
        const relationKind = row.querySelector("select")?.value || "supports";
        others.push(toSourceRequest(candidate, relationKind));
      });
      active.selected = [...textSources, ...others];
      renderSelected(active);
    }

    function renderSelected(active) {
      const selected = active.body.querySelector("[data-provenance-selected]");
      if (!selected) return;
      selected.replaceChildren();
      if (!active.selected.length) {
        selected.textContent = "尚未选择来源。";
        return;
      }
      const list = documentRef.createElement("ul");
      active.selected.forEach((source) => {
        const item = documentRef.createElement("li");
        item.textContent = `${relationLabel(source.relationKind)} · ${source.sourceKind === "memory_text" ? "逐字原文" : source.label || source.sourceKind}`;
        list.append(item);
      });
      selected.append(list);
    }

    async function createClaim(active) {
      const statement = active.body.querySelector("[data-provenance-statement]")?.value.trim();
      if (!statement || !active.selected.length) {
        setStatus(active, "请写下主张，并至少选择一项可核对来源。", true);
        return;
      }
      setBusy(active, true);
      try {
        await requestJson(`/api/provenance/memories/${encodeURIComponent(active.memory.id)}/claims`, {
          method: "POST",
          headers: { "Idempotency-Key": randomKey("claim-create") },
          body: JSON.stringify({ confirm: true, statement, sources: active.selected })
        });
        await Promise.resolve(onChanged(active.memory.id));
        await load(active);
        setStatus(active, "主张已保存为草稿；还没有确认。", false);
      } catch (error) {
        setStatus(active, error.message, true);
      } finally {
        if (session === active) setBusy(active, false);
      }
    }

    async function decideClaim(active, button) {
      const claimId = safeId(button.closest("[data-claim-id]")?.dataset.claimId);
      const action = button.dataset.provenanceAction;
      const claim = active.passport.claims.find((item) => item.id === claimId);
      if (!claim || !["confirm", "withdraw"].includes(action)) return;
      button.disabled = true;
      try {
        await requestJson(`/api/provenance/claims/${encodeURIComponent(claimId)}/${action}`, {
          method: "POST",
          headers: { "If-Match": claim.etag, "Idempotency-Key": randomKey(`claim-${action}`) },
          body: JSON.stringify({ confirm: true })
        });
        await Promise.resolve(onChanged(active.memory.id));
        await load(active);
        setStatus(active, action === "confirm" ? "你已确认这条主张与所列来源的关系；这不是事实认证。" : "主张已撤回，历史仍可回看。", false);
      } catch (error) {
        button.disabled = false;
        setStatus(active, error.message, true);
      }
    }

    function setBusy(active, busy) {
      active.body.querySelectorAll("button, textarea, input, select").forEach((control) => { control.disabled = Boolean(busy); });
    }

    function setStatus(active, message, error = false) {
      const status = active.body.querySelector("[data-provenance-status]") || active.body.querySelector(".provenance-status");
      if (!status) return;
      status.textContent = String(message || "");
      status.classList.toggle("is-error", Boolean(error));
    }

    async function requestJson(url, init = {}) {
      const headers = { Accept: "application/json", ...(init.headers || {}) };
      if (init.body !== undefined) headers["Content-Type"] = "application/json";
      const response = await fetchImpl(url, { ...init, headers, signal: session?.controller.signal });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(payload.error || `来源护照请求失败（${response.status}）`);
        error.code = payload.code || "PROVENANCE_REQUEST_FAILED";
        throw error;
      }
      return payload;
    }

    return Object.freeze({ close, open, refresh, setDemo });
  }

  function buildMemoryTextSelection(memory, startValue, endValue) {
    const text = String(memory?.rawContent || "");
    const startOffset = Number(startValue);
    const endOffset = Number(endValue);
    if (!safeId(memory?.id) || !Number.isSafeInteger(startOffset) || !Number.isSafeInteger(endOffset) ||
        startOffset < 0 || endOffset <= startOffset || endOffset > text.length || endOffset - startOffset > 4000) {
      throw new Error("请选择 1 至 4000 个 UTF-16 字符的原文区间。");
    }
    const excerpt = text.slice(startOffset, endOffset);
    if (!excerpt.trim()) throw new Error("所选原文不能只有空白。");
    return {
      sourceKind: "memory_text",
      sourceKey: `memory:${memory.id}`,
      anchorKey: "",
      relationKind: "supports",
      locator: { memoryId: memory.id, startOffset, endOffset, offsetUnit: "utf16-code-unit" },
      label: "当前展品逐字原文"
    };
  }

  function toSourceRequest(candidate, relationKind) {
    const relation = RELATION_SET.has(relationKind) ? relationKind : "supports";
    return {
      sourceKind: String(candidate.kind || candidate.sourceKind || ""),
      sourceKey: String(candidate.sourceKey || ""),
      anchorKey: String(candidate.anchorKey || ""),
      relationKind: relation,
      locator: candidate.locator && typeof candidate.locator === "object" ? candidate.locator : {},
      label: String(candidate.label || "来源")
    };
  }

  function createActionButton(documentRef, label, action, claim, extraClass = "") {
    const button = documentRef.createElement("button");
    button.type = "button";
    button.className = `button ${extraClass || "secondary"} compact`;
    button.dataset.provenanceAction = action;
    button.textContent = label;
    button.disabled = Boolean(claim.needsReview);
    return button;
  }

  function createRelationSelect(documentRef) {
    const select = documentRef.createElement("select");
    select.setAttribute("aria-label", "这项来源与主张的关系");
    RELATIONS.forEach((relation) => {
      const option = documentRef.createElement("option");
      option.value = relation.value;
      option.textContent = relation.label;
      select.append(option);
    });
    return select;
  }

  function createNumberInput(documentRef, labelText, key, minimum, maximum) {
    const label = documentRef.createElement("label");
    label.textContent = labelText;
    const input = documentRef.createElement("input");
    input.type = "number";
    input.min = String(minimum);
    input.max = String(maximum);
    input.value = key === "start" ? "0" : String(maximum);
    input.dataset.provenanceOffset = key;
    label.append(input);
    return label;
  }

  function statusName(claim) {
    if (claim.needsReview) return "needs-review";
    return ["draft", "confirmed", "withdrawn"].includes(claim.status) ? claim.status : "draft";
  }

  function statusLabel(claim) {
    return ({ draft: "待确认", confirmed: "你已确认来源关系", withdrawn: "已撤回", "needs-review": "来源待复核" })[statusName(claim)];
  }

  function integrityLabel(status) {
    return ({ source_verified: "当前来源可核对", archived_verified: "入馆时已核对 · 原文件未保留", source_changed: "来源已变化", source_missing: "来源已缺失" })[status] || "来源状态待核对";
  }

  function relationLabel(value) {
    return RELATIONS.find((item) => item.value === value)?.label || "关联来源";
  }

  function summaryText(summary, claims) {
    const total = Number(summary.claims ?? summary.claimCount ?? claims.length) || 0;
    const review = Number(summary.needsReview ?? summary.needsReviewCount) || claims.filter((item) => item.needsReview).length;
    return `${total} 条人工主张${review ? ` · ${review} 条待复核` : " · 来源变化时会提示"}`;
  }

  function createElementNode(documentRef, tag, className) {
    const node = documentRef.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function safeId(value) {
    const id = String(value || "");
    return /^[a-zA-Z0-9_-]{1,120}$/u.test(id) ? id : "";
  }

  function randomKey(prefix) {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return `${prefix}-${crypto.randomUUID()}`;
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  return Object.freeze({ RELATIONS, buildMemoryTextSelection, createController, renderPanel, toSourceRequest });
}));
