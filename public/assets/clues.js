(function initializeTimeIsleClues(global) {
  "use strict";

  const DIALOG_IDS = Object.freeze({
    dialog: "entityDialog",
    title: "entityDialogTitle",
    kind: "entityDialogKind",
    status: "entityDialogStatus",
    body: "entityDialogBody"
  });
  const ENTITY_TYPES = Object.freeze({
    person: { label: "人物", glyph: "人" },
    place: { label: "地点", glyph: "地" },
    theme: { label: "主题", glyph: "题" }
  });
  const CONFIDENCE = Object.freeze({
    strong: "直接依据",
    medium: "多项线索",
    weak: "延伸线索"
  });
  const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/;
  const staleRequest = Symbol("stale clue request");

  function normalizeSearchResponse(payload = {}) {
    const source = payload && typeof payload === "object" ? payload : {};
    const results = (Array.isArray(source.results) ? source.results : []).map(normalizeSearchResult).filter((item) => item.memory.id);
    const rawEngine = source.engine && typeof source.engine === "object" ? source.engine : {};
    return {
      query: String(source.query || ""),
      count: results.length,
      results,
      engine: {
        mode: "clue",
        label: String(rawEngine.label || "字段与线索检索"),
        fts: String(rawEngine.fts || "fts5-trigram"),
        shortQueryFallback: rawEngine.shortQueryFallback === true
      }
    };
  }

  function normalizeSearchResult(value = {}) {
    const source = value && typeof value === "object" ? value : {};
    const memory = source.memory && typeof source.memory === "object" ? source.memory : {};
    const confidenceSource = typeof source.confidence === "object" ? source.confidence.level : source.confidence;
    return {
      memory,
      score: Number.isFinite(Number(source.score)) ? Number(source.score) : 0,
      matchedTerms: uniqueStrings(source.matchedTerms, 24),
      matchedFields: uniqueStrings(source.matchedFields, 16),
      confidence: ["strong", "medium", "weak"].includes(confidenceSource) ? confidenceSource : "weak",
      reason: String(source.reason || (typeof source.confidence === "object" ? source.confidence.reason : "") || "根据馆藏中的直接线索找到。"),
      evidence: normalizeEvidence(source.evidence),
      entityRefs: normalizeEntityRefs(source.entityRefs)
    };
  }

  function renderSearchEvidence(result, options = {}) {
    const value = normalizeSearchResult(result);
    const chips = value.entityRefs.map((entity) => {
      const type = ENTITY_TYPES[entity.type] || ENTITY_TYPES.theme;
      return `<button type="button" class="clue-entity-chip" data-entity-id="${escapeHtml(entity.id)}" aria-label="打开${type.label}档案：${escapeHtml(entity.label)}"><span aria-hidden="true">${type.glyph}</span>${escapeHtml(entity.label)}</button>`;
    }).join("");
    const evidence = value.evidence.length
      ? value.evidence.map((item) => `<li><span>${escapeHtml(item.label)}</span>${item.term ? `<small>命中“${escapeHtml(item.term)}”</small>` : ""}</li>`).join("")
      : value.matchedFields.map((field) => `<li><span>${escapeHtml(fieldLabel(field))}</span></li>`).join("");
    const fallback = options.shortQueryFallback === true
      ? '<span class="clue-fallback-note">短词已使用兼容检索</span>'
      : "";
    return `<section class="clue-search-evidence" aria-label="这条结果的匹配依据">
      <div class="clue-reason"><span class="clue-confidence is-${value.confidence}">${CONFIDENCE[value.confidence]}</span><span>${escapeHtml(value.reason)}</span>${fallback}</div>
      ${chips ? `<div class="clue-entity-chips" aria-label="相关人物、地点和主题">${chips}</div>` : ""}
      ${evidence ? `<details class="clue-evidence-details"><summary>查看匹配依据</summary><ul>${evidence}</ul></details>` : ""}
    </section>`;
  }

  function createEntityDialogController(options = {}) {
    const documentRef = options.document || global.document;
    const fetchImpl = options.fetch || global.fetch?.bind(global);
    if (!documentRef || !fetchImpl) throw new Error("实体档案缺少浏览器能力。");
    const elements = Object.fromEntries(Object.entries(DIALOG_IDS).map(([key, id]) => [key, documentRef.getElementById(id)]));
    const missing = Object.entries(elements).filter(([, element]) => !element).map(([key]) => DIALOG_IDS[key]);
    if (missing.length) throw new Error(`实体档案缺少 DOM：${missing.join("、")}`);

    let demo = Boolean(options.demo);
    let destroyed = false;
    let session = 0;
    let currentId = "";
    let profile = null;
    let lastTrigger = null;
    let lastTriggerEntityId = "";
    let mutationBusy = false;
    let aliasPreview = null;
    let mergePreview = null;
    let pendingAliasDelete = "";
    let mergeCandidatesLoaded = false;
    let mergeCandidates = [];
    const requests = new Map();
    const listeners = [];

    configureDom();
    bindEvents();

    function configureDom() {
      elements.dialog.setAttribute("aria-labelledby", elements.title.id);
      elements.status.setAttribute("role", "status");
      elements.status.setAttribute("aria-live", "polite");
      elements.status.setAttribute("aria-atomic", "true");
      elements.body.setAttribute("aria-live", "off");
      elements.body.setAttribute("aria-busy", "false");
    }

    function bindEvents() {
      listen(documentRef, "click", handleDocumentClick);
      listen(elements.dialog, "click", handleDialogClick);
      listen(elements.dialog, "submit", handleDialogSubmit);
      listen(elements.dialog, "input", handleDialogInput);
      listen(elements.dialog, "change", handleDialogInput);
      listen(elements.dialog, "toggle", handleDetailsToggle, true);
      listen(elements.dialog, "cancel", (event) => {
        if (mutationBusy) event.preventDefault();
      });
      listen(elements.dialog, "close", restoreFocus);
    }

    function listen(target, type, handler, listenerOptions) {
      target.addEventListener(type, handler, listenerOptions);
      listeners.push({ target, type, handler, listenerOptions });
    }

    function handleDocumentClick(event) {
      const trigger = closest(event.target, "[data-entity-id]");
      if (!trigger || elements.dialog.contains(trigger)) return;
      const id = String(trigger.dataset.entityId || "");
      if (!ID_PATTERN.test(id)) return;
      event.preventDefault();
      open(id, trigger);
    }

    async function handleDialogClick(event) {
      const closeButton = closest(event.target, "[data-entity-close]");
      if (closeButton) {
        event.preventDefault();
        if (!mutationBusy) close();
        return;
      }
      const retry = closest(event.target, "[data-entity-retry]");
      if (retry) {
        event.preventDefault();
        await loadProfile();
        return;
      }
      const memoryButton = closest(event.target, "[data-clue-memory-id]");
      if (memoryButton) {
        event.preventDefault();
        const memoryId = String(memoryButton.dataset.clueMemoryId || "");
        const onOpenMemory = options.onOpenMemory || options.onMemoryOpen;
        if (typeof onOpenMemory === "function") {
          close();
          onOpenMemory(memoryId, memoryButton);
        }
        return;
      }
      const entityButton = closest(event.target, "[data-entity-id]");
      if (entityButton) {
        event.preventDefault();
        const id = String(entityButton.dataset.entityId || "");
        if (ID_PATTERN.test(id) && id !== currentId) await open(id, entityButton, { preserveTrigger: true });
        return;
      }
      const aliasConfirmButton = closest(event.target, "[data-alias-confirm]");
      if (aliasConfirmButton) {
        event.preventDefault();
        await confirmAlias();
        return;
      }
      const aliasDeleteButton = closest(event.target, "[data-alias-delete]");
      if (aliasDeleteButton) {
        event.preventDefault();
        await requestAliasDelete(aliasDeleteButton);
        return;
      }
      const mergeConfirmButton = closest(event.target, "[data-merge-confirm]");
      if (mergeConfirmButton) {
        event.preventDefault();
        await confirmMerge();
      }
    }

    async function handleDialogSubmit(event) {
      const aliasForm = closest(event.target, "[data-entity-alias-form]");
      if (aliasForm) {
        event.preventDefault();
        await previewAlias(aliasForm);
        return;
      }
      const mergeForm = closest(event.target, "[data-entity-merge-form]");
      if (mergeForm) {
        event.preventDefault();
        await previewMerge(mergeForm);
      }
    }

    function handleDialogInput(event) {
      if (closest(event.target, "[data-alias-input]")) clearAliasPreview();
      if (closest(event.target, "[data-merge-source]")) clearMergePreview();
    }

    function handleDetailsToggle(event) {
      const details = closest(event.target, "[data-entity-merge-details]");
      if (details?.open && !mergeCandidatesLoaded && !requests.has("merge-candidates")) loadMergeCandidates();
    }

    async function open(id, trigger, openOptions = {}) {
      if (!ID_PATTERN.test(String(id || ""))) throw new Error("实体 ID 无效。");
      if (!openOptions.preserveTrigger) {
        lastTrigger = trigger || documentRef.activeElement;
        lastTriggerEntityId = String(trigger?.dataset?.entityId || "");
      }
      startSession();
      currentId = String(id);
      profile = null;
      resetDrafts();
      elements.title.textContent = "实体档案";
      elements.kind.textContent = "Memory clue";
      showDialog();
      renderLoading();
      await loadProfile();
    }

    async function loadProfile() {
      const run = session;
      renderLoading();
      try {
        const payload = await requestJson("profile", `/api/entities/${encodeURIComponent(currentId)}`, {}, run);
        if (!isCurrent(run)) return;
        const value = payload?.entity || payload?.profile;
        if (!value?.id) {
          profile = null;
          renderEmpty();
          return;
        }
        profile = normalizeProfile(value);
        elements.title.textContent = profile.label;
        elements.kind.textContent = `${typeLabel(profile.type)}档案`;
        renderProfile();
        focusHeading();
      } catch (error) {
        if (isExpectedCancellation(error) || !isCurrent(run)) return;
        profile = null;
        renderError(message(error));
      }
    }

    function renderLoading() {
      setStatus("正在整理这份实体档案…");
      elements.body.setAttribute("aria-busy", "true");
      elements.body.innerHTML = '<div class="clue-dialog-state" role="status"><span aria-hidden="true">◇</span><p>正在汇集相关记忆与可回看的依据…</p></div>';
    }

    function renderEmpty() {
      setStatus("这份实体档案暂时没有可展示的内容。");
      elements.body.setAttribute("aria-busy", "false");
      elements.body.innerHTML = '<div class="clue-dialog-state"><span aria-hidden="true">◇</span><strong>档案还是空的</strong><p>它可能刚被合并，或相关记忆已经删除。</p><button type="button" class="button secondary" data-entity-close>返回馆藏</button></div>';
    }

    function renderError(errorMessage) {
      setStatus(`实体档案加载失败：${errorMessage}`, true);
      elements.body.setAttribute("aria-busy", "false");
      elements.body.innerHTML = `<div class="clue-dialog-state is-error"><span aria-hidden="true">!</span><strong>暂时没有打开这份档案</strong><p>${escapeHtml(errorMessage)}</p><button type="button" class="button secondary" data-entity-retry>重新加载</button></div>`;
    }

    function renderProfile() {
      if (!profile) return renderEmpty();
      const references = profile.memories.length
        ? profile.memories.map(renderMemoryReference).join("")
        : '<div class="clue-profile-empty"><span aria-hidden="true">◇</span><p>暂时没有关联记忆。</p></div>';
      const aliases = profile.aliases.length
        ? profile.aliases.map(renderAlias).join("")
        : '<p class="clue-profile-empty compact">还没有经过确认的别名。</p>';
      const demoNote = demo ? '<p class="clue-demo-note">公开 Demo 可以完成预览，但不会保存别名、删除或合并操作。</p>' : "";
      elements.body.setAttribute("aria-busy", "false");
      elements.body.innerHTML = `<article class="clue-profile">
        <header class="clue-profile-summary">
          <span class="clue-profile-glyph is-${profile.type}" aria-hidden="true">${ENTITY_TYPES[profile.type].glyph}</span>
          <div><p>${escapeHtml(profile.description || profile.summary || `${profile.label}在馆藏中的记忆线索`)}</p><span>${profile.memoryCount} 段相关记忆${profile.aliases.length ? ` · ${profile.aliases.length} 个别名` : ""}</span></div>
        </header>
        ${profile.reasons.length ? `<ul class="clue-profile-reasons">${profile.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul>` : ""}
        <section class="clue-profile-memories" aria-labelledby="entityMemoryHeading"><h3 id="entityMemoryHeading">相关记忆</h3><div>${references}</div></section>
        <details class="clue-manage-details">
          <summary>别名与称呼</summary>
          <div class="clue-manage-panel">
            <div class="clue-alias-list" aria-label="已确认别名">${aliases}</div>
            <form data-entity-alias-form>
              <label>补充一个别名<input data-alias-input name="alias" type="text" maxlength="80" autocomplete="off" placeholder="例如：外婆、老家" /></label>
              <button type="submit" class="button secondary" data-entity-mutation>先预览影响</button>
            </form>
            <div class="clue-preview-slot" data-alias-preview-slot aria-live="polite"></div>
          </div>
        </details>
        <details class="clue-manage-details" data-entity-merge-details>
          <summary>合并重复档案</summary>
          <div class="clue-manage-panel">
            <p>把另一个同类档案并入“${escapeHtml(profile.label)}”。旧人物、地点和标签字段会保留原样。</p>
            <form data-entity-merge-form>
              <label>选择要并入的档案<select data-merge-source name="sourceEntityId" data-entity-mutation><option value="">展开后加载同类档案…</option></select></label>
              <button type="submit" class="button secondary" data-entity-mutation>先预览合并</button>
            </form>
            <div class="clue-preview-slot" data-merge-preview-slot aria-live="polite"></div>
          </div>
        </details>
        ${demoNote}
      </article>`;
      setStatus(`${profile.label}档案已打开。`);
      renderAccess();
    }

    function renderMemoryReference(memory) {
      const details = [memory.date, memory.location].filter(Boolean).join(" · ");
      return `<button type="button" class="clue-memory-reference" data-clue-memory-id="${escapeHtml(memory.id)}"><span>${escapeHtml(memory.title || "未命名记忆")}</span>${details ? `<small>${escapeHtml(details)}</small>` : ""}</button>`;
    }

    function renderAlias(alias) {
      const canDelete = ID_PATTERN.test(alias.id);
      return `<span class="clue-alias"><span>${escapeHtml(alias.label)}</span>${canDelete ? `<button type="button" data-alias-delete="${escapeHtml(alias.id)}" data-entity-mutation ${demo ? "disabled" : ""} aria-label="删除别名 ${escapeHtml(alias.label)}">×</button>` : ""}</span>`;
    }

    async function previewAlias(form) {
      if (!profile || mutationBusy) return;
      const input = form.querySelector("[data-alias-input]");
      const alias = String(input?.value || "").replace(/\s+/g, " ").trim();
      if (!alias) return setStatus("请先输入一个要核对的别名。", true);
      setMutationBusy(true, "正在预览别名影响…");
      try {
        const payload = await requestJson("alias-preview", `/api/entities/${encodeURIComponent(currentId)}/aliases/preview`, jsonRequest({ alias }));
        aliasPreview = { alias, preview: payload?.preview || {}, warning: String(payload?.warning || "") };
        renderAliasPreview();
        setStatus("预览已完成；确认内容后才能保存。 ");
      } catch (error) {
        if (!isExpectedCancellation(error)) renderInlineError("alias", message(error));
      } finally {
        setMutationBusy(false);
      }
    }

    function renderAliasPreview() {
      const slot = elements.body.querySelector("[data-alias-preview-slot]");
      if (!slot || !aliasPreview) return;
      slot.innerHTML = `<div class="clue-confirm-card"><strong>将“${escapeHtml(aliasPreview.alias)}”作为别名</strong><p>${escapeHtml(previewSummary(aliasPreview.preview, "alias"))}</p><p class="clue-warning">${escapeHtml(aliasPreview.warning || "预览不会修改旧人物、地点或标签字段。")}</p><button type="button" class="button primary" data-alias-confirm data-entity-mutation ${demo ? "disabled" : ""}>${demo ? "Demo 不保存" : "确认保存别名"}</button></div>`;
      renderAccess();
    }

    async function confirmAlias() {
      if (!profile || !aliasPreview || mutationBusy || demo) return;
      const draft = aliasPreview;
      setMutationBusy(true, "正在保存已确认的别名…");
      try {
        await requestJson("alias-mutation", `/api/entities/${encodeURIComponent(currentId)}/aliases`, jsonRequest({ alias: draft.alias, confirm: true }));
        aliasPreview = null;
        await loadProfile();
        notifyDataChanged("alias-added");
        setStatus("别名已保存。旧人物、地点和标签字段没有被改写。");
      } catch (error) {
        if (!isExpectedCancellation(error)) renderInlineError("alias", message(error));
      } finally {
        setMutationBusy(false);
      }
    }

    async function requestAliasDelete(button) {
      if (!profile || mutationBusy || demo) return;
      const aliasId = String(button.dataset.aliasDelete || "");
      if (!ID_PATTERN.test(aliasId)) return setStatus("别名 ID 无效。", true);
      if (pendingAliasDelete !== aliasId) {
        pendingAliasDelete = aliasId;
        elements.body.querySelectorAll("[data-alias-delete]").forEach((candidate) => {
          candidate.classList.toggle("is-confirming", candidate === button);
          candidate.textContent = candidate === button ? "确认" : "×";
        });
        setStatus("再点一次“确认”才会删除这个别名。 ");
        return;
      }
      setMutationBusy(true, "正在删除已确认的别名…");
      try {
        await requestJson("alias-mutation", `/api/entities/${encodeURIComponent(currentId)}/aliases/${encodeURIComponent(aliasId)}`, jsonRequest({ confirm: true }, "DELETE"));
        pendingAliasDelete = "";
        await loadProfile();
        notifyDataChanged("alias-deleted");
        setStatus("别名已删除。旧人物、地点和标签字段没有被改写。");
      } catch (error) {
        if (!isExpectedCancellation(error)) setStatus(`删除没有完成：${message(error)}`, true);
      } finally {
        setMutationBusy(false);
      }
    }

    async function loadMergeCandidates() {
      if (!profile || mergeCandidatesLoaded) return;
      const select = elements.body.querySelector("[data-merge-source]");
      if (select) select.innerHTML = '<option value="">正在加载同类档案…</option>';
      try {
        const payload = await requestJson("merge-candidates", `/api/entities?type=${encodeURIComponent(profile.type)}&limit=100`);
        mergeCandidates = (Array.isArray(payload?.entities) ? payload.entities : []).map(normalizeProfile).filter((item) => item.id && item.id !== currentId && item.type === profile.type);
        mergeCandidatesLoaded = true;
        renderMergeCandidates();
      } catch (error) {
        if (isExpectedCancellation(error)) return;
        if (select) select.innerHTML = '<option value="">档案加载失败，请收起后重试</option>';
        setStatus(`同类档案加载失败：${message(error)}`, true);
      }
    }

    function renderMergeCandidates() {
      const select = elements.body.querySelector("[data-merge-source]");
      if (!select) return;
      select.innerHTML = mergeCandidates.length
        ? `<option value="">请选择</option>${mergeCandidates.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)} · ${item.memoryCount} 段记忆</option>`).join("")}`
        : '<option value="">没有其他同类档案</option>';
      select.disabled = mutationBusy || !mergeCandidates.length;
    }

    async function previewMerge(form) {
      if (!profile || mutationBusy) return;
      const sourceEntityId = String(form.querySelector("[data-merge-source]")?.value || "");
      if (!ID_PATTERN.test(sourceEntityId)) return setStatus("请先选择要并入的同类档案。", true);
      setMutationBusy(true, "正在预览合并影响…");
      try {
        const payload = await requestJson("merge-preview", `/api/entities/${encodeURIComponent(currentId)}/merge/preview`, jsonRequest({ sourceEntityId }));
        mergePreview = { sourceEntityId, preview: payload?.preview || {}, warning: String(payload?.warning || "") };
        renderMergePreview();
        setStatus("合并预览已完成；请核对后再次确认。 ");
      } catch (error) {
        if (!isExpectedCancellation(error)) renderInlineError("merge", message(error));
      } finally {
        setMutationBusy(false);
      }
    }

    function renderMergePreview() {
      const slot = elements.body.querySelector("[data-merge-preview-slot]");
      if (!slot || !mergePreview) return;
      const source = mergeCandidates.find((item) => item.id === mergePreview.sourceEntityId);
      slot.innerHTML = `<div class="clue-confirm-card"><strong>把“${escapeHtml(source?.label || mergePreview.sourceEntityId)}”并入“${escapeHtml(profile.label)}”</strong><p>${escapeHtml(previewSummary(mergePreview.preview, "merge"))}</p><p class="clue-warning">${escapeHtml(mergePreview.warning || "预览不会修改旧人物、地点或标签字段。")}</p><button type="button" class="button primary" data-merge-confirm data-entity-mutation ${demo ? "disabled" : ""}>${demo ? "Demo 不保存" : "确认合并档案"}</button></div>`;
      renderAccess();
    }

    async function confirmMerge() {
      if (!profile || !mergePreview || mutationBusy || demo) return;
      const draft = mergePreview;
      setMutationBusy(true, "正在合并已确认的实体档案…");
      try {
        const payload = await requestJson("merge-mutation", `/api/entities/${encodeURIComponent(currentId)}/merge`, jsonRequest({ sourceEntityId: draft.sourceEntityId, confirm: true }));
        currentId = String(payload?.redirectEntityId || currentId);
        mergePreview = null;
        await loadProfile();
        notifyDataChanged("entities-merged");
        setStatus("实体档案已合并。旧人物、地点和标签字段仍保留原样。");
      } catch (error) {
        if (!isExpectedCancellation(error)) renderInlineError("merge", message(error));
      } finally {
        setMutationBusy(false);
      }
    }

    function clearAliasPreview() {
      if (!aliasPreview) return;
      aliasPreview = null;
      const slot = elements.body.querySelector("[data-alias-preview-slot]");
      if (slot) slot.innerHTML = "";
    }

    function clearMergePreview() {
      if (!mergePreview) return;
      mergePreview = null;
      const slot = elements.body.querySelector("[data-merge-preview-slot]");
      if (slot) slot.innerHTML = "";
    }

    function renderInlineError(kind, errorMessage) {
      const slot = elements.body.querySelector(`[data-${kind}-preview-slot]`);
      if (slot) slot.innerHTML = `<p class="clue-inline-error" role="alert">${escapeHtml(errorMessage)}</p>`;
      setStatus(errorMessage, true);
    }

    function setMutationBusy(value, statusText = "") {
      mutationBusy = Boolean(value);
      elements.body.setAttribute("aria-busy", String(mutationBusy));
      if (statusText) setStatus(statusText);
      renderAccess();
    }

    function renderAccess() {
      elements.body.querySelectorAll("[data-entity-mutation]").forEach((control) => {
        const persistent = control.matches("[data-alias-confirm], [data-merge-confirm], [data-alias-delete]");
        control.disabled = mutationBusy || (demo && persistent) || (control.matches("[data-merge-source]") && mergeCandidatesLoaded && !mergeCandidates.length);
      });
      elements.dialog.querySelectorAll("[data-entity-close]").forEach((button) => {
        button.disabled = mutationBusy;
      });
    }

    function setStatus(text, isError = false) {
      elements.status.textContent = String(text || "");
      elements.status.classList.toggle("is-error", Boolean(isError));
    }

    function resetDrafts() {
      aliasPreview = null;
      mergePreview = null;
      pendingAliasDelete = "";
      mergeCandidatesLoaded = false;
      mergeCandidates = [];
      mutationBusy = false;
    }

    function notifyDataChanged(action) {
      if (typeof options.onDataChanged !== "function") return;
      try {
        Promise.resolve(options.onDataChanged({ action, entityId: currentId })).catch(() => {});
      } catch {
        // The entity mutation already succeeded; host refresh failure stays non-blocking.
      }
    }

    function showDialog() {
      if (elements.dialog.open) return;
      if (typeof elements.dialog.showModal === "function") elements.dialog.showModal();
      else elements.dialog.setAttribute("open", "");
    }

    function close() {
      startSession();
      if (typeof elements.dialog.close === "function" && elements.dialog.open) elements.dialog.close();
      else {
        elements.dialog.removeAttribute("open");
        restoreFocus();
      }
    }

    function restoreFocus() {
      const replacement = !lastTrigger?.isConnected && ID_PATTERN.test(lastTriggerEntityId)
        ? documentRef.querySelector(`[data-entity-id="${lastTriggerEntityId}"]`)
        : null;
      const target = lastTrigger?.isConnected ? lastTrigger : replacement;
      if (target && typeof target.focus === "function") target.focus();
      lastTrigger = null;
      lastTriggerEntityId = "";
    }

    function focusHeading() {
      elements.title.setAttribute("tabindex", "-1");
      elements.title.focus({ preventScroll: true });
    }

    function setDemo(value) {
      const next = Boolean(value);
      if (next === demo) return;
      demo = next;
      if (profile && elements.dialog.open) renderProfile();
    }

    async function refresh() {
      if (!currentId || !elements.dialog.open) return null;
      return loadProfile();
    }

    function startSession() {
      session += 1;
      requests.forEach(({ controller }) => controller.abort());
      requests.clear();
    }

    async function requestJson(key, url, requestOptions = {}, run = session) {
      requests.get(key)?.controller.abort();
      const controller = new AbortController();
      const token = Symbol(key);
      requests.set(key, { controller, token });
      try {
        const response = await fetchImpl(url, {
          ...requestOptions,
          signal: controller.signal,
          headers: {
            Accept: "application/json",
            ...(requestOptions.body ? { "Content-Type": "application/json" } : {}),
            ...(requestOptions.headers || {})
          }
        });
        const text = await response.text();
        const payload = text ? parseJson(text) : {};
        if (!response.ok) throw new Error(payload?.error || payload?.message || `请求失败（${response.status}）`);
        if (!isCurrent(run) || requests.get(key)?.token !== token) throw staleRequest;
        return payload;
      } finally {
        if (requests.get(key)?.token === token) requests.delete(key);
      }
    }

    function isCurrent(run) {
      return !destroyed && run === session;
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      startSession();
      listeners.forEach(({ target, type, handler, listenerOptions }) => target.removeEventListener(type, handler, listenerOptions));
      listeners.length = 0;
    }

    return Object.freeze({ open, close, refresh, setDemo, destroy });
  }

  function normalizeProfile(value = {}) {
    const source = value && typeof value === "object" ? value : {};
    const type = normalizeType(source.type || source.kind);
    const aliases = (Array.isArray(source.aliases) ? source.aliases : []).map((item) => (
      typeof item === "string"
        ? { id: "", label: item }
        : { id: String(item?.id || item?.aliasId || ""), label: String(item?.label || item?.value || item?.alias || "") }
    )).filter((item) => item.label);
    const rawMemories = source.memories || source.memoryRefs || source.relatedMemories || source.references;
    const memories = (Array.isArray(rawMemories) ? rawMemories : []).map((item) => {
      const memory = item?.memory && typeof item.memory === "object" ? item.memory : item;
      return {
        id: String(memory?.id || memory?.memoryId || ""),
        title: String(memory?.title || memory?.label || "未命名记忆"),
        date: String(memory?.date || ""),
        location: String(memory?.location || "")
      };
    }).filter((item) => item.id);
    return {
      ...source,
      id: String(source.id || source.entityId || ""),
      type,
      label: String(source.label || source.name || source.canonicalName || "未命名线索"),
      description: String(source.description || ""),
      summary: String(source.summary || ""),
      aliases,
      memories,
      memoryCount: Number.isFinite(Number(source.memoryCount)) ? Number(source.memoryCount) : memories.length,
      reasons: uniqueStrings(source.reasons || source.evidenceReasons, 8)
    };
  }

  function normalizeEvidence(value) {
    return (Array.isArray(value) ? value : []).slice(0, 24).map((item) => ({
      kind: String(item?.kind || "field"),
      field: String(item?.field || ""),
      term: String(item?.term || ""),
      label: String(item?.label || fieldLabel(item?.field) || item?.term || "线索命中")
    }));
  }

  function normalizeEntityRefs(value) {
    return (Array.isArray(value) ? value : []).slice(0, 24).map((item) => ({
      id: String(item?.id || item?.entityId || ""),
      type: normalizeType(item?.type || item?.kind),
      label: String(item?.label || item?.name || item?.canonicalName || "未命名线索")
    })).filter((item) => ID_PATTERN.test(item.id));
  }

  function previewSummary(preview, kind) {
    const source = preview && typeof preview === "object" ? preview : {};
    if (source.message || source.summary) return String(source.message || source.summary);
    const count = Number(source.affectedMemoryCount ?? source.memoryCount ?? source.movedMemoryCount);
    if (Number.isFinite(count)) return kind === "merge" ? `预计会把 ${count} 段实体关联转入当前档案。` : `预计会关联 ${count} 段记忆。`;
    return kind === "merge" ? "来源档案将并入当前档案，确认前不会写入。" : "这个称呼只会成为实体别名，确认前不会写入。";
  }

  function fieldLabel(value) {
    return ({
      title: "标题",
      rawContent: "原始故事",
      exhibitText: "展品说明",
      people: "人物",
      location: "地点",
      tags: "标签",
      entity: "实体档案"
    })[String(value || "")] || String(value || "匹配字段");
  }

  function typeLabel(type) {
    return (ENTITY_TYPES[type] || ENTITY_TYPES.theme).label;
  }

  function normalizeType(value) {
    const type = String(value || "").toLowerCase();
    if (["person", "people"].includes(type)) return "person";
    if (["place", "location"].includes(type)) return "place";
    return "theme";
  }

  function uniqueStrings(value, maximum) {
    return [...new Set((Array.isArray(value) ? value : []).map((item) => String(item || "").trim()).filter(Boolean))].slice(0, maximum);
  }

  function jsonRequest(body, method = "POST") {
    return { method, body: JSON.stringify(body) };
  }

  function parseJson(text) {
    try { return JSON.parse(text); } catch { return { error: text }; }
  }

  function message(error) {
    return String(error?.message || error || "未知错误");
  }

  function isExpectedCancellation(error) {
    return error === staleRequest || error?.name === "AbortError";
  }

  function closest(target, selector) {
    return typeof target?.closest === "function" ? target.closest(selector) : null;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  global.TimeIsleClues = Object.freeze({
    DIALOG_IDS,
    createEntityDialogController,
    normalizeSearchResponse,
    renderSearchEvidence
  });
})(typeof window !== "undefined" ? window : globalThis);
