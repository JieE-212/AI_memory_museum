(function initializeTimeIsleExhibitions(global) {
  "use strict";

  const REQUIRED_IDS = {
    studioButton: "exhibitionStudioButton",
    dialog: "exhibitionDialog",
    dialogTitle: "exhibitionDialogTitle",
    form: "exhibitionForm",
    theme: "exhibitionTheme",
    memoryChoices: "exhibitionMemoryChoices",
    preview: "exhibitionPreview",
    previewStatus: "exhibitionPreviewStatus",
    generateButton: "exhibitionGenerateButton",
    saveActions: "exhibitionSaveActions",
    saveButton: "exhibitionSaveButton",
    shelf: "exhibitionShelf"
  };

  const MIN_SELECTION = 2;
  const MAX_SELECTION = 12;
  const staleRequest = Symbol("stale exhibition request");

  function createController(options = {}) {
    const documentRef = options.document || global.document;
    const fetchImpl = options.fetch || global.fetch?.bind(global);
    if (!documentRef || !fetchImpl) throw new Error("主题展览工作室缺少浏览器能力。");

    const elements = Object.fromEntries(Object.entries(REQUIRED_IDS).map(([key, id]) => [
      key,
      documentRef.getElementById(id)
    ]));
    const missing = Object.entries(elements).filter(([, element]) => !element).map(([, element], index) => element || Object.values(REQUIRED_IDS)[index]);
    if (missing.length) {
      const names = Object.entries(elements).filter(([, element]) => !element).map(([key]) => REQUIRED_IDS[key]);
      throw new Error(`主题展览工作室缺少 DOM：${names.join("、")}`);
    }

    let demo = Boolean(options.demo);
    let destroyed = false;
    let session = 0;
    let memoriesLoaded = false;
    let shelfLoaded = false;
    let memories = [];
    let exhibitions = [];
    let preview = null;
    let previewSignature = "";
    let editingId = "";
    let readingId = "";
    let busyPreview = false;
    let busyMutation = false;
    let busyDetail = false;
    let lastTrigger = null;
    let focusAfterBack = null;
    let suppressFocusRestore = false;
    const requests = new Map();
    const listeners = [];

    configureDom();
    bindEvents();
    renderMemoryChoices();
    renderShelf();
    renderAccess();

    function configureDom() {
      elements.dialog.setAttribute("aria-labelledby", elements.dialogTitle.id);
      elements.theme.maxLength = Math.min(Number(elements.theme.maxLength) || 60, 60);
      elements.previewStatus.setAttribute("role", "status");
      elements.previewStatus.setAttribute("aria-live", "polite");
      elements.previewStatus.setAttribute("aria-atomic", "true");
      elements.preview.hidden = true;
      elements.shelf.hidden = false;
      elements.saveButton.type = "button";
    }

    function bindEvents() {
      listen(elements.studioButton, "click", open);
      listen(elements.form, "submit", generatePreview);
      listen(elements.form, "input", handleFormMutation);
      listen(elements.form, "change", handleFormMutation);
      listen(elements.saveButton, "click", savePreview);
      listen(elements.dialog, "click", handleDialogClick);
      listen(elements.dialog, "cancel", (event) => {
        if (busyMutation) event.preventDefault();
      });
      listen(elements.dialog, "close", handleDialogClose);
    }

    function listen(target, type, handler, listenerOptions) {
      target.addEventListener(type, handler, listenerOptions);
      listeners.push({ target, type, handler, listenerOptions });
    }

    function open(event) {
      if (destroyed) return;
      lastTrigger = event?.currentTarget || documentRef.activeElement || elements.studioButton;
      if (!elements.dialog.open) elements.dialog.showModal();
      startSession();
      showWorkspace();
      setStatus("正在准备主题与馆藏…");
      loadWorkspace();
      global.requestAnimationFrame?.(() => elements.theme.focus({ preventScroll: true }));
    }

    async function loadWorkspace(force = false) {
      const run = session;
      const tasks = [];
      if (force || !memoriesLoaded) tasks.push(loadMemories(run));
      if (force || !shelfLoaded) tasks.push(loadShelf(run));
      if (!tasks.length) {
        setStatus(workspaceHint());
        return;
      }
      await Promise.allSettled(tasks);
      if (!isCurrent(run)) return;
      setStatus(workspaceHint());
      renderAccess();
    }

    async function loadMemories(run) {
      try {
        const payload = await requestJson("memories", "/api/memories", {}, run);
        if (!isCurrent(run)) return;
        memories = Array.isArray(payload?.memories) ? payload.memories : [];
        memoriesLoaded = true;
        renderMemoryChoices(selectedMemoryIds());
      } catch (error) {
        if (isExpectedCancellation(error)) return;
        elements.memoryChoices.innerHTML = `<div class="exhibition-empty"><strong>暂时无法读取展品</strong><span>${escapeHtml(message(error))}</span><button type="button" class="button secondary" data-exhibition-retry="memories">重新读取</button></div>`;
      }
    }

    async function loadShelf(run) {
      try {
        const payload = await requestJson("shelf", "/api/exhibitions", {}, run);
        if (!isCurrent(run)) return;
        exhibitions = Array.isArray(payload?.exhibitions) ? payload.exhibitions : [];
        shelfLoaded = true;
        renderShelf();
      } catch (error) {
        if (isExpectedCancellation(error)) return;
        elements.shelf.innerHTML = `<div class="exhibition-shelf-heading"><h3>已保存展览</h3></div><div class="exhibition-empty"><strong>展览书架暂时无法读取</strong><span>${escapeHtml(message(error))}</span><button type="button" class="button secondary" data-exhibition-retry="shelf">重新读取</button></div>`;
      }
    }

    function renderMemoryChoices(preferredIds = []) {
      const selected = new Set(preferredIds.map(String));
      if (!memoriesLoaded) {
        elements.memoryChoices.innerHTML = '<div class="exhibition-empty is-loading" role="status">打开工作室后再读取馆藏，不影响其他页面。</div>';
        return;
      }
      if (memories.length < MIN_SELECTION) {
        elements.memoryChoices.innerHTML = '<div class="exhibition-empty"><strong>至少需要两件展品</strong><span>继续记录记忆后，就能把它们策展成一条有出处的故事。</span></div>';
        return;
      }

      elements.memoryChoices.innerHTML = `
        <fieldset class="exhibition-choice-fieldset">
          <legend>选择 ${MIN_SELECTION}–${MAX_SELECTION} 件来源展品</legend>
          <div class="exhibition-choice-meta"><span>每一段策展文字都应能回到原始记录。</span><strong data-exhibition-choice-count aria-live="polite">0 件已选</strong></div>
          <div class="exhibition-choice-list">
            ${memories.map((memory, index) => renderMemoryChoice(memory, index, selected.has(String(memory.id)))).join("")}
          </div>
        </fieldset>`;
      updateChoiceAccess();
    }

    function renderMemoryChoice(memory, index, checked) {
      const title = String(memory?.title || `第 ${index + 1} 件展品`);
      const note = [formatDate(memory?.date), ...(memory?.people || []).slice(0, 2), memory?.location]
        .filter(Boolean)
        .join(" · ") || "打开后可核对原始记忆";
      const thumbnail = safeMediaUrl(memory?.mediaSummary?.coverThumbnailUrl || memory?.media?.find?.((item) => item.role === "cover")?.urls?.thumb);
      return `<label class="exhibition-choice">
        <input type="checkbox" name="exhibitionMemory" value="${escapeHtml(memory?.id || "")}"${checked ? " checked" : ""} />
        ${thumbnail ? `<span class="exhibition-choice-image"><img src="${escapeHtml(thumbnail)}" alt="" loading="lazy" decoding="async" /></span>` : '<span class="exhibition-choice-image is-empty" aria-hidden="true">◇</span>'}
        <span class="exhibition-choice-copy"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(note)}</small></span>
      </label>`;
    }

    function handleFormMutation(event) {
      if (event.target?.matches?.('input[name="exhibitionMemory"]')) updateChoiceAccess();
      if (preview && currentSignature() !== previewSignature) {
        preview = null;
        previewSignature = "";
        elements.preview.hidden = true;
        setStatus("选材或主题已经变化，请重新生成预览后再保存。");
      }
      renderAccess();
    }

    function updateChoiceAccess() {
      const checked = selectedMemoryIds();
      const atLimit = checked.length >= MAX_SELECTION;
      elements.memoryChoices.querySelectorAll('input[name="exhibitionMemory"]').forEach((input) => {
        input.disabled = busyMutation || busyPreview || busyDetail || (atLimit && !input.checked);
      });
      const count = elements.memoryChoices.querySelector("[data-exhibition-choice-count]");
      if (count) count.textContent = `${checked.length} 件已选`;
    }

    async function generatePreview(event) {
      event.preventDefault();
      if (destroyed || busyPreview || busyMutation) return;
      const input = selectionInput();
      if (!validateSelection(input, true)) return;

      const run = session;
      const submittedSignature = currentSignature();
      busyPreview = true;
      preview = null;
      previewSignature = "";
      elements.preview.hidden = true;
      setStatus("正在按原始记录编排开场、章节与引用…");
      renderAccess();
      try {
        const payload = await requestJson("preview", "/api/exhibitions/preview", {
          method: "POST",
          body: JSON.stringify({ theme: input.theme, memoryIds: input.memoryIds })
        }, run);
        if (!isCurrent(run)) return;
        if (currentSignature() !== submittedSignature) {
          setStatus("主题或选材已经变化，请为当前内容重新生成预览。", true);
          return;
        }
        preview = normalizeExhibition(payload?.preview || payload);
        previewSignature = submittedSignature;
        renderExhibition(preview, { preview: true });
        setStatus(demo
          ? "预览已生成。公开 Demo 不保存私人展览。"
          : "预览已生成；核对标题、开场与引用后再保存。", false, true);
        elements.preview.querySelector("[data-exhibition-reader-title]")?.focus({ preventScroll: true });
      } catch (error) {
        if (!isExpectedCancellation(error)) setStatus(`预览生成失败：${message(error)}`, true);
      } finally {
        if (isCurrent(run)) {
          busyPreview = false;
          updateChoiceAccess();
          renderAccess();
        }
      }
    }

    async function savePreview() {
      if (destroyed || demo || busyMutation || busyPreview) return;
      const input = selectionInput();
      if (!preview || previewSignature !== currentSignature()) {
        setStatus("请先为当前选材生成并核对预览。", true);
        elements.generateButton.focus();
        return;
      }
      if (!validateSelection(input, true)) return;

      const run = session;
      busyMutation = true;
      setStatus(editingId ? "正在更新主题展览…" : "正在保存主题展览…");
      renderAccess();
      try {
        const targetId = editingId;
        const payload = await requestJson("mutation", targetId ? `/api/exhibitions/${encodeURIComponent(targetId)}` : "/api/exhibitions", {
          method: targetId ? "PUT" : "POST",
          body: JSON.stringify({
            theme: input.theme,
            memoryIds: input.memoryIds,
            title: preview.title,
            opening: preview.opening,
            mode: preview.mode,
            sections: preview.sections,
            confirm: true
          })
        }, run);
        if (!isCurrent(run)) return;
        const saved = normalizeExhibition(payload?.exhibition || payload);
        editingId = "";
        readingId = saved.id;
        preview = saved;
        previewSignature = currentSignature();
        shelfLoaded = false;
        renderExhibition(saved, { persisted: true, reading: true });
        elements.form.hidden = true;
        elements.shelf.hidden = true;
        elements.dialogTitle.textContent = saved.title || "主题展览";
        setStatus("主题展览已保存。", false, true);
        notifyChanged(targetId ? "updated" : "created", saved);
        await loadShelf(run);
        if (isCurrent(run)) elements.preview.querySelector("[data-exhibition-reader-title]")?.focus({ preventScroll: true });
      } catch (error) {
        if (!isExpectedCancellation(error)) setStatus(`保存失败：${message(error)}`, true);
      } finally {
        if (isCurrent(run)) {
          busyMutation = false;
          updateChoiceAccess();
          renderAccess();
        }
      }
    }

    async function readExhibition(id, trigger) {
      if (!id || busyDetail || busyMutation) return;
      focusAfterBack = trigger || null;
      const run = session;
      busyDetail = true;
      setStatus("正在展开主题展览…");
      renderAccess();
      try {
        const payload = await requestJson("detail", `/api/exhibitions/${encodeURIComponent(id)}`, {}, run);
        if (!isCurrent(run)) return;
        const exhibition = normalizeExhibition(payload?.exhibition || payload);
        readingId = exhibition.id || id;
        renderExhibition(exhibition, { persisted: true, reading: true });
        elements.form.hidden = true;
        elements.shelf.hidden = true;
        elements.dialogTitle.textContent = exhibition.title || "主题展览";
        setStatus("展览中的每一项均可回到来源展品核对。", false, true);
        elements.preview.querySelector("[data-exhibition-reader-title]")?.focus({ preventScroll: true });
      } catch (error) {
        if (!isExpectedCancellation(error)) setStatus(`展览读取失败：${message(error)}`, true);
      } finally {
        if (isCurrent(run)) {
          busyDetail = false;
          renderAccess();
        }
      }
    }

    async function editExhibition(id, trigger) {
      if (!id || demo || busyDetail || busyMutation) return;
      focusAfterBack = trigger || null;
      const run = session;
      busyDetail = true;
      setStatus("正在载入展览选材…");
      renderAccess();
      try {
        if (!memoriesLoaded) await loadMemories(run);
        const payload = await requestJson("detail", `/api/exhibitions/${encodeURIComponent(id)}`, {}, run);
        if (!isCurrent(run)) return;
        const exhibition = normalizeExhibition(payload?.exhibition || payload);
        editingId = exhibition.id || id;
        readingId = "";
        preview = null;
        previewSignature = "";
        elements.theme.value = exhibition.theme || "";
        renderMemoryChoices(exhibition.memoryIds);
        showWorkspace();
        elements.preview.hidden = true;
        setStatus("展览已载入。调整后请重新生成预览，才能保存更新。");
        elements.theme.focus({ preventScroll: true });
      } catch (error) {
        if (!isExpectedCancellation(error)) setStatus(`展览载入失败：${message(error)}`, true);
      } finally {
        if (isCurrent(run)) {
          busyDetail = false;
          updateChoiceAccess();
          renderAccess();
        }
      }
    }

    async function deleteExhibition(id, trigger) {
      if (!id || demo || busyMutation) return;
      const item = exhibitions.find((exhibition) => String(exhibition.id) === String(id));
      if (!global.confirm(`确定删除《${item?.title || "这场主题展览"}》吗？来源展品不会被删除。`)) return;
      trigger?.setAttribute?.("aria-busy", "true");
      const run = session;
      busyMutation = true;
      setStatus("正在删除主题展览…");
      renderAccess();
      try {
        await requestJson("mutation", `/api/exhibitions/${encodeURIComponent(id)}`, { method: "DELETE" }, run);
        if (!isCurrent(run)) return;
        exhibitions = exhibitions.filter((exhibition) => String(exhibition.id) !== String(id));
        renderShelf();
        if (readingId === id) {
          preview = null;
          previewSignature = "";
          elements.preview.innerHTML = "";
          showWorkspace();
        }
        setStatus("主题展览已删除；来源展品保持不变。", false, true);
        notifyChanged("deleted", { id });
        const nextFocus = elements.shelf.querySelector("[data-exhibition-read]") || elements.theme;
        nextFocus?.focus({ preventScroll: true });
      } catch (error) {
        if (!isExpectedCancellation(error)) setStatus(`删除失败：${message(error)}`, true);
      } finally {
        if (isCurrent(run)) {
          busyMutation = false;
          renderAccess();
          trigger?.removeAttribute?.("aria-busy");
        }
      }
    }

    function renderExhibition(exhibition, context = {}) {
      const sections = exhibition.sections || [];
      const sourceCount = new Set(sections.flatMap((section) => section.items.map((item) => item.memoryId)).filter(Boolean)).size;
      const confirmation = exhibition.requiresConfirmation
        ? '<p class="exhibition-boundary"><strong>待你确认</strong><span>这是依据原始记录生成的策展预览，不会自动保存或改写来源展品。</span></p>'
        : '<p class="exhibition-boundary is-confirmed"><strong>已确认展览</strong><span>展览与来源展品分别保存，原始记录未被改写。</span></p>';
      elements.preview.innerHTML = `
        <article class="exhibition-reader" data-exhibition-reader>
          <header class="exhibition-reader-heading">
            <p class="eyebrow">${context.persisted ? "Curated exhibition" : "Exhibition preview"}</p>
            <h3 tabindex="-1" data-exhibition-reader-title>${escapeHtml(exhibition.title || exhibition.theme || "未命名主题展览")}</h3>
            <p class="exhibition-opening">${escapeHtml(exhibition.opening || "这场展览正在等待一句开场。")}</p>
            <div class="exhibition-reader-meta"><span>${escapeHtml(exhibition.theme || "未注明主题")}</span><span>${sourceCount || exhibition.memoryIds.length} 件来源展品</span></div>
          </header>
          ${confirmation}
          <div class="exhibition-sections">
            ${sections.length ? sections.map(renderSection).join("") : '<div class="exhibition-empty">暂时没有可展示的章节。</div>'}
          </div>
          ${exhibition.guidance ? `<p class="exhibition-guidance">${escapeHtml(exhibition.guidance)}</p>` : ""}
          ${context.reading ? `<div class="exhibition-reader-actions">
            <button type="button" class="button secondary" data-exhibition-back>返回工作室</button>
            ${!demo && exhibition.id ? `<button type="button" class="button secondary" data-exhibition-edit="${escapeHtml(exhibition.id)}">继续编辑</button><button type="button" class="button danger" data-exhibition-delete="${escapeHtml(exhibition.id)}">删除展览</button>` : ""}
          </div>` : ""}
        </article>`;
      elements.preview.hidden = false;
    }

    function renderSection(section, sectionIndex) {
      const headingId = `exhibitionSectionHeading${sectionIndex}`;
      return `<section class="exhibition-section" aria-labelledby="${headingId}">
        <div class="exhibition-section-heading"><span>${String(sectionIndex + 1).padStart(2, "0")}</span><div><h4 id="${headingId}">${escapeHtml(section.title || `第 ${sectionIndex + 1} 章`)}</h4>${section.summary ? `<p>${escapeHtml(section.summary)}</p>` : ""}</div></div>
        <div class="exhibition-section-items">${(section.items || []).map((item, itemIndex) => renderSectionItem(item, itemIndex)).join("")}</div>
      </section>`;
    }

    function renderSectionItem(item, itemIndex) {
      const citations = Array.isArray(item.citations) ? item.citations : [];
      return `<article class="exhibition-source-card">
        <div class="exhibition-source-kicker"><span>来源 ${itemIndex + 1}</span>${item.memoryId ? `<button type="button" data-exhibition-memory="${escapeHtml(item.memoryId)}">打开来源展品</button>` : ""}</div>
        <h5>${escapeHtml(item.title || "未命名展品")}</h5>
        ${item.excerpt ? `<p class="exhibition-source-excerpt">${escapeHtml(item.excerpt)}</p>` : ""}
        ${item.curatorNote ? `<p class="exhibition-curator-note"><strong>策展说明</strong>${escapeHtml(item.curatorNote)}</p>` : ""}
        ${citations.length ? `<details class="exhibition-citations"><summary>查看引用依据（${citations.length}）</summary><div>${citations.map(renderCitation).join("")}</div></details>` : ""}
      </article>`;
    }

    function renderCitation(citation) {
      const valid = citation.evidenceValid === true;
      const field = citation.field === "rawContent" ? "原始记忆" : citation.field || "来源记录";
      return `<blockquote class="exhibition-citation${valid ? "" : " is-unverified"}">
        <p>“${escapeHtml(citation.quote || "引用文字暂不可用")}”</p>
        <footer>${escapeHtml(field)} · ${valid ? "原文锚点有效" : "锚点待重新核对"}</footer>
      </blockquote>`;
    }

    function renderShelf() {
      const heading = '<div class="exhibition-shelf-heading"><div><p class="eyebrow">Saved exhibitions</p><h3 tabindex="-1">已保存展览</h3></div></div>';
      if (!shelfLoaded) {
        elements.shelf.innerHTML = `${heading}<div class="exhibition-empty is-loading" role="status">打开工作室后读取已保存展览。</div>`;
        return;
      }
      if (!exhibitions.length) {
        elements.shelf.innerHTML = `${heading}<div class="exhibition-empty"><strong>还没有保存的主题展览</strong><span>从上方选择 2–12 件展品，先生成预览再决定是否保存。</span></div>`;
        return;
      }
      elements.shelf.innerHTML = `${heading}<div class="exhibition-shelf-list">${exhibitions.map((exhibition) => {
        const itemCount = Number(exhibition.itemCount || exhibition.memoryIds?.length || 0);
        return `<article class="exhibition-shelf-item">
          <div><small>${escapeHtml(exhibition.theme || "主题展览")}${itemCount ? ` · ${itemCount} 件展品` : ""}</small><h4>${escapeHtml(exhibition.title || "未命名主题展览")}</h4>${exhibition.updatedAt || exhibition.createdAt ? `<time datetime="${escapeHtml(exhibition.updatedAt || exhibition.createdAt)}">${escapeHtml(formatDate(exhibition.updatedAt || exhibition.createdAt))}</time>` : ""}</div>
          <div class="exhibition-shelf-actions"><button type="button" class="button secondary" data-exhibition-read="${escapeHtml(exhibition.id)}">阅读</button>${demo ? "" : `<button type="button" class="button text-button" data-exhibition-edit="${escapeHtml(exhibition.id)}">编辑</button><button type="button" class="button text-button is-danger" data-exhibition-delete="${escapeHtml(exhibition.id)}" aria-label="删除展览《${escapeHtml(exhibition.title || "未命名主题展览")}》">删除</button>`}</div>
        </article>`;
      }).join("")}</div>`;
    }

    function handleDialogClick(event) {
      const close = event.target.closest("[data-exhibition-close]");
      if (close) {
        event.preventDefault();
        if (!busyMutation) elements.dialog.close();
        return;
      }
      const retry = event.target.closest("[data-exhibition-retry]");
      if (retry) {
        if (retry.dataset.exhibitionRetry === "memories") loadMemories(session);
        else loadShelf(session);
        return;
      }
      const memoryLink = event.target.closest("[data-exhibition-memory]");
      if (memoryLink) {
        suppressFocusRestore = true;
        elements.dialog.close();
        options.onOpenMemory?.(memoryLink.dataset.exhibitionMemory);
        return;
      }
      const read = event.target.closest("[data-exhibition-read]");
      if (read) {
        readExhibition(read.dataset.exhibitionRead, read);
        return;
      }
      const edit = event.target.closest("[data-exhibition-edit]");
      if (edit) {
        editExhibition(edit.dataset.exhibitionEdit, edit);
        return;
      }
      const remove = event.target.closest("[data-exhibition-delete]");
      if (remove) {
        deleteExhibition(remove.dataset.exhibitionDelete, remove);
        return;
      }
      if (event.target.closest("[data-exhibition-back]")) showWorkspace(true);
    }

    function showWorkspace(restoreFocus = false) {
      readingId = "";
      elements.form.hidden = false;
      elements.shelf.hidden = false;
      elements.dialogTitle.textContent = editingId ? "编辑主题展览" : "主题展览工作室";
      if (!preview || restoreFocus) elements.preview.hidden = true;
      if (restoreFocus) {
        const target = focusAfterBack?.isConnected ? focusAfterBack : elements.theme;
        global.requestAnimationFrame?.(() => target.focus({ preventScroll: true }));
      }
      renderAccess();
    }

    function renderAccess() {
      const input = selectionInput();
      const validSelection = input.theme.length > 0 && input.memoryIds.length >= MIN_SELECTION && input.memoryIds.length <= MAX_SELECTION;
      const busy = busyPreview || busyMutation || busyDetail;
      elements.theme.disabled = busy;
      elements.generateButton.disabled = busy || !validSelection;
      elements.generateButton.textContent = busyPreview ? "正在生成…" : "生成展览预览";
      elements.saveActions.hidden = elements.form.hidden || elements.preview.hidden || Boolean(readingId);
      elements.saveButton.disabled = busy || demo || Boolean(readingId) || !preview || previewSignature !== currentSignature();
      elements.saveButton.textContent = demo ? "Demo 仅预览" : editingId ? "保存更新" : "保存主题展览";
      elements.saveButton.title = demo ? "公开 Demo 不保存私人展览" : "核对预览后保存";
      updateChoiceAccess();
      elements.dialog.setAttribute("aria-busy", busy ? "true" : "false");
    }

    function validateSelection(input, focusInvalid) {
      if (!input.theme) {
        setStatus("请先写下这场展览的主题。", true);
        if (focusInvalid) elements.theme.focus();
        return false;
      }
      if (input.memoryIds.length < MIN_SELECTION || input.memoryIds.length > MAX_SELECTION) {
        setStatus(`请选择 ${MIN_SELECTION}–${MAX_SELECTION} 件来源展品。`, true);
        if (focusInvalid) elements.memoryChoices.querySelector('input[name="exhibitionMemory"]:not(:disabled)')?.focus();
        return false;
      }
      return true;
    }

    function selectionInput() {
      return { theme: String(elements.theme.value || "").trim(), memoryIds: selectedMemoryIds() };
    }

    function selectedMemoryIds() {
      return [...elements.memoryChoices.querySelectorAll('input[name="exhibitionMemory"]:checked')]
        .map((input) => String(input.value || ""))
        .filter(Boolean)
        .slice(0, MAX_SELECTION);
    }

    function currentSignature() {
      const input = selectionInput();
      return JSON.stringify([input.theme, [...input.memoryIds].sort()]);
    }

    function workspaceHint() {
      if (!memoriesLoaded) return "馆藏仍未就绪，请重新读取。";
      if (memories.length < MIN_SELECTION) return "至少保存两件展品后，才能生成主题展览。";
      return demo ? "选择来源展品并生成预览；Demo 不会保存。" : "选择来源展品，先生成并核对预览，再决定是否保存。";
    }

    function setStatus(text, isError = false, isSuccess = false) {
      elements.previewStatus.textContent = text;
      elements.previewStatus.classList.toggle("is-error", Boolean(isError));
      elements.previewStatus.classList.toggle("is-success", Boolean(isSuccess));
    }

    function setDemo(value) {
      demo = Boolean(value);
      if (demo && busyMutation) {
        startSession();
        busyMutation = false;
      }
      renderShelf();
      renderAccess();
    }

    async function refresh() {
      memoriesLoaded = false;
      shelfLoaded = false;
      preview = null;
      previewSignature = "";
      if (!elements.dialog.open) {
        renderMemoryChoices();
        renderShelf();
        return;
      }
      startSession();
      showWorkspace();
      await loadWorkspace(true);
    }

    function handleDialogClose() {
      startSession();
      busyPreview = false;
      busyMutation = false;
      busyDetail = false;
      const target = lastTrigger?.isConnected ? lastTrigger : elements.studioButton;
      lastTrigger = null;
      editingId = "";
      readingId = "";
      preview = null;
      previewSignature = "";
      focusAfterBack = null;
      elements.form.reset();
      elements.form.hidden = false;
      elements.preview.innerHTML = "";
      elements.preview.hidden = true;
      elements.shelf.hidden = false;
      renderMemoryChoices();
      renderAccess();
      if (suppressFocusRestore) suppressFocusRestore = false;
      else global.requestAnimationFrame?.(() => target.focus({ preventScroll: true }));
    }

    function startSession() {
      session += 1;
      requests.forEach((request) => request.controller.abort());
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

    function isExpectedCancellation(error) {
      return error === staleRequest || error?.name === "AbortError";
    }

    function notifyChanged(type, exhibition) {
      Promise.resolve(options.onChanged?.({ type, exhibition })).catch(() => {});
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      startSession();
      listeners.forEach(({ target, type, handler, listenerOptions }) => target.removeEventListener(type, handler, listenerOptions));
      listeners.length = 0;
      if (elements.dialog.open) elements.dialog.close();
    }

    return Object.freeze({ open, refresh, setDemo, destroy });
  }

  function normalizeExhibition(value = {}) {
    const source = value && typeof value === "object" ? value : {};
    const sections = (Array.isArray(source.sections) ? source.sections : []).map((section, sectionIndex) => ({
      id: String(section?.id || `section-${sectionIndex + 1}`),
      title: String(section?.title || `第 ${sectionIndex + 1} 章`),
      summary: String(section?.summary || ""),
      items: (Array.isArray(section?.items) ? section.items : []).map((item) => ({
        memoryId: String(item?.memoryId || item?.id || ""),
        title: String(item?.title || "未命名展品"),
        excerpt: String(item?.excerpt || ""),
        curatorNote: String(item?.curatorNote || ""),
        citations: (Array.isArray(item?.citations) ? item.citations : []).map((citation) => ({
          quote: String(citation?.quote || ""),
          startOffset: Number.isInteger(citation?.startOffset) ? citation.startOffset : null,
          endOffset: Number.isInteger(citation?.endOffset) ? citation.endOffset : null,
          evidenceValid: citation?.evidenceValid === true,
          field: String(citation?.field || "rawContent")
        }))
      }))
    }));
    const memoryIds = Array.isArray(source.memoryIds)
      ? source.memoryIds.map(String)
      : Array.isArray(source.selection?.memoryIds)
        ? source.selection.memoryIds.map(String)
        : sections.flatMap((section) => section.items.map((item) => item.memoryId));
    return {
      id: String(source.id || ""),
      title: String(source.title || ""),
      theme: String(source.theme || ""),
      opening: String(source.opening || ""),
      mode: String(source.mode || ""),
      status: String(source.status || ""),
      requiresConfirmation: source.requiresConfirmation !== false || sections.some((section) => (
        section.items.some((item) => item.citations.some((citation) => citation.evidenceValid !== true))
      )),
      guidance: String(source.guidance || ""),
      sections,
      memoryIds: [...new Set(memoryIds.filter(Boolean))],
      createdAt: String(source.createdAt || ""),
      updatedAt: String(source.updatedAt || "")
    };
  }

  function parseJson(text) {
    try { return JSON.parse(text); } catch { return { error: text }; }
  }

  function safeMediaUrl(value) {
    const url = String(value || "").trim();
    return /^\/(?!\/)/.test(url) || /^blob:/i.test(url) || /^data:image\/(?:png|jpeg|webp);/i.test(url) ? url : "";
  }

  function formatDate(value) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toLocaleDateString("zh-CN", { year: "numeric", month: "short", day: "numeric" });
    const text = String(value || "").trim();
    return text.length > 10 ? text.slice(0, 10) : text;
  }

  function message(error) {
    return String(error?.message || error || "未知错误");
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  global.TimeIsleExhibitions = Object.freeze({ createController, normalizeExhibition });
})(typeof window !== "undefined" ? window : globalThis);
