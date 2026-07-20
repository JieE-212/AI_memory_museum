(function initializeTimeIsleCuratorAgent(global) {
  "use strict";

  const domIds = Object.freeze({
    entryButton: "curatorAgentButton",
    dialog: "curatorAgentDialog",
    dialogTitle: "curatorAgentDialogTitle",
    closeButton: "curatorAgentCloseButton",
    status: "curatorAgentStatus",
    brief: "curatorAgentBrief",
    demoBadge: "curatorAgentDemoBadge",
    form: "curatorAgentForm",
    theme: "curatorAgentTheme",
    sourcePicker: "curatorAgentSourcePicker",
    sourceStatus: "curatorAgentSourceStatus",
    sourceList: "curatorAgentSourceList",
    startButton: "curatorAgentStartButton",
    workspace: "curatorAgentWorkspace",
    newButton: "curatorAgentNewButton",
    progress: "curatorAgentProgress",
    proposal: "curatorAgentProposal",
    proposalState: "curatorAgentProposalState",
    proposalPreview: "curatorAgentProposalPreview",
    citations: "curatorAgentCitations",
    citationList: "curatorAgentCitationList",
    decisions: "curatorAgentDecisions",
    decisionList: "curatorAgentDecisionList",
    share: "curatorAgentShare",
    shareButton: "curatorAgentShareButton",
    technical: "curatorAgentTechnical",
    budget: "curatorAgentBudget",
    trace: "curatorAgentTrace",
    evaluationButton: "curatorAgentEvaluationButton",
    recentButton: "curatorAgentRecentButton",
    evaluation: "curatorAgentEvaluation",
    recent: "curatorAgentRecent"
  });

  const MAX_SELECTED_SOURCES = 6;
  const MIN_SELECTED_SOURCES = 2;
  const DEFAULT_BUDGETS = Object.freeze({ maxSteps: 6, maxToolCalls: 4, maxDurationMs: 2000, maxSources: 6 });
  const RUNNING_STATUSES = new Set(["created", "queued", "running", "executing"]);
  const COMPLETE_STATUSES = new Set(["completed", "complete", "awaiting_review", "decided"]);
  const staleRequest = Object.freeze({ name: "StaleCuratorAgentRequest" });

  function createController(options = {}) {
    const documentRef = options.document || global.document;
    const fetchImpl = options.fetch || global.fetch?.bind(global);
    const elements = options.elements || resolveElements(documentRef, options.ids || domIds);
    if (!documentRef || typeof fetchImpl !== "function" || !elements) return null;

    let demo = Boolean(options.demo);
    let destroyed = false;
    let busy = false;
    let closing = false;
    let session = 0;
    let mutationSequence = 0;
    let workspace = normalizeWorkspace({});
    let etag = "";
    let memories = [];
    let memoriesLoaded = false;
    let lastTrigger = null;
    let publishedExhibitionId = "";
    const requests = new Map();
    const listeners = [];

    configureDom();
    bindEvents();
    resetWorkspace();

    function configureDom() {
      elements.dialog.setAttribute("aria-labelledby", elements.dialogTitle.id);
      elements.dialog.setAttribute("aria-busy", "false");
      elements.theme.maxLength = Math.min(Number(elements.theme.maxLength) || 60, 60);
      elements.status.setAttribute("aria-atomic", "true");
    }

    function bindEvents() {
      listen(elements.entryButton, "click", open);
      listen(elements.closeButton, "click", requestClose);
      listen(elements.dialog, "cancel", (event) => {
        event.preventDefault();
        requestClose();
      });
      listen(elements.dialog, "close", handleDialogClose);
      listen(elements.form, "submit", startProposal);
      listen(elements.sourcePicker, "toggle", handleSourcePickerToggle);
      listen(elements.sourceList, "change", handleSourceSelection);
      listen(elements.newButton, "click", beginNewProposal);
      listen(elements.decisionList, "click", handleDecisionClick);
      listen(elements.citationList, "click", handleCitationClick);
      listen(elements.shareButton, "click", openPrivacyEditor);
      listen(elements.evaluationButton, "click", loadEvaluation);
      listen(elements.recentButton, "click", loadRecentRuns);
      listen(elements.recent, "click", handleRecentClick);
    }

    function listen(target, type, handler, listenerOptions) {
      if (!target?.addEventListener) return;
      target.addEventListener(type, handler, listenerOptions);
      listeners.push({ target, type, handler, listenerOptions });
    }

    async function open(eventOrTrigger) {
      if (destroyed) return;
      lastTrigger = eventOrTrigger?.currentTarget || eventOrTrigger || documentRef.activeElement || elements.entryButton;
      if (!elements.dialog.open) elements.dialog.showModal();
      global.requestAnimationFrame?.(() => elements.dialogTitle.focus({ preventScroll: true }));
      if (demo) await loadSample();
      else setStatus("填写主题即可开始；限定来源是可选项。助手只会先生成提案。", false);
    }

    async function preselectSources(handoff, trigger) {
      if (destroyed) return;
      if (demo) throw new Error("公开 Demo 不接收本地镜片简报。");
      const memoryIds = Array.isArray(handoff?.memoryIds)
        ? [...new Set(handoff.memoryIds.map((value) => safeId(value)).filter(Boolean))]
        : [];
      if (memoryIds.length < MIN_SELECTED_SOURCES || memoryIds.length > MAX_SELECTED_SOURCES) {
        throw new Error(`镜片简报必须明确包含 ${MIN_SELECTED_SOURCES}–${MAX_SELECTED_SOURCES} 件展品。`);
      }
      await open(trigger || elements.entryButton);
      if (!memoriesLoaded) await loadMemories();
      const available = new Set(memories.map((memory) => memory.id));
      if (memoryIds.some((memoryId) => !available.has(memoryId))) {
        throw new Error("镜片简报中的展品已经变化，请重新生成镜片后再带入策展。");
      }
      elements.sourceList.querySelectorAll('input[name="curatorAgentSource"]').forEach((input) => {
        input.checked = memoryIds.includes(input.value);
      });
      elements.sourcePicker.open = true;
      updateSourceStatus();
      if (!String(elements.theme.value || "").trim()) {
        const label = String(handoff?.lens?.label || "镜片").trim().slice(0, 24);
        elements.theme.value = `${label}里的记忆线索`.slice(0, 60);
      }
      setStatus(`已带入 ${memoryIds.length} 件明确选择的展品；简报仍未保存，也不会自动运行。`, false, true);
      elements.theme.focus({ preventScroll: true });
    }

    async function loadSample() {
      const run = startSession();
      setBusy(true);
      setStatus("正在读取只读策展示例…");
      try {
        const response = await requestJson("sample", "/api/curator-agent/sample", {}, run);
        if (!isCurrent(run)) return;
        acceptWorkspace(response);
        elements.brief.hidden = true;
        renderWorkspace();
        setStatus("这是预先生成的只读示例；不会创建运行、保存展览或改变馆藏。", false, true);
      } catch (error) {
        if (!isExpectedCancellation(error)) setStatus(`示例读取失败：${errorMessage(error)}`, true);
      } finally {
        if (isCurrent(run)) setBusy(false);
      }
    }

    async function handleSourcePickerToggle() {
      if (!elements.sourcePicker.open || memoriesLoaded || demo || destroyed) return;
      await loadMemories();
    }

    async function loadMemories() {
      const run = session;
      elements.sourceStatus.textContent = "正在只读读取馆藏目录…";
      try {
        const response = await requestJson("memories", "/api/memories", {}, run);
        if (!isCurrent(run)) return;
        const payload = response.payload || {};
        memories = normalizeMemories(payload.memories || payload);
        memoriesLoaded = true;
        renderSourceChoices();
      } catch (error) {
        if (!isExpectedCancellation(error)) elements.sourceStatus.textContent = `馆藏目录读取失败：${errorMessage(error)}`;
      }
    }

    function renderSourceChoices() {
      elements.sourceList.innerHTML = memories.length ? memories.map((memory) => `
        <label class="curator-agent-source-choice">
          <input type="checkbox" name="curatorAgentSource" value="${escapeHtml(memory.id)}" />
          <span><strong>${escapeHtml(memory.title || "未命名展品")}</strong><small>${escapeHtml(memory.summary || "只读作为本次提案来源")}</small></span>
        </label>`).join("") : '<div class="curator-agent-empty">馆藏中还没有可供策展的展品。</div>';
      updateSourceStatus();
    }

    function handleSourceSelection(event) {
      const input = event.target?.closest?.('input[name="curatorAgentSource"]');
      if (!input) return;
      const selected = selectedMemoryIds();
      if (selected.length > MAX_SELECTED_SOURCES) {
        input.checked = false;
        elements.sourceStatus.textContent = `一次最多限定 ${MAX_SELECTED_SOURCES} 件来源；刚才的选择未加入。`;
        return;
      }
      updateSourceStatus();
    }

    function updateSourceStatus() {
      const count = selectedMemoryIds().length;
      elements.sourceStatus.textContent = count
        ? `已选择 ${count} 件；限定来源时至少选择 ${MIN_SELECTED_SOURCES} 件、最多 ${MAX_SELECTED_SOURCES} 件。`
        : `可选择 ${MIN_SELECTED_SOURCES}–${MAX_SELECTED_SOURCES} 件；不选择时由助手只读查找。`;
    }

    async function startProposal(event) {
      event?.preventDefault?.();
      if (destroyed || busy || demo) return;
      const theme = String(elements.theme.value || "").trim();
      const memoryIds = selectedMemoryIds();
      if (!theme) {
        setStatus("请先写下这场展览想讲的主题。", true);
        elements.theme.focus();
        return;
      }
      if (memoryIds.length === 1) {
        setStatus("限定来源至少需要 2 件；也可以取消选择，让助手在馆藏中查找。", true);
        elements.sourcePicker.open = true;
        return;
      }

      const run = startSession();
      workspace = normalizeWorkspace({ run: { status: "created", request: { theme, memoryIds } } });
      etag = "";
      publishedExhibitionId = "";
      elements.brief.hidden = true;
      renderWorkspace("brief");
      setBusy(true);
      setStatus("正在建立这次只读策展任务…");
      try {
        const body = {
          intent: "draft_exhibition",
          query: theme,
          theme,
          ...(memoryIds.length ? { memoryIds } : {})
        };
        const created = await requestJson("mutation", "/api/curator-agent/runs", {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey("create") },
          body: JSON.stringify(body)
        }, run);
        if (!isCurrent(run)) return;
        acceptWorkspace(created);
        renderWorkspace("read");
        setStatus("助手正在只读查阅来源并整理章节…");
        const executed = await requestJson("mutation", `/api/curator-agent/runs/${encodeURIComponent(workspace.run.id)}/execute`, {
          method: "POST",
          headers: mutationHeaders("execute"),
          body: JSON.stringify({ confirm: true })
        }, run);
        if (!isCurrent(run)) return;
        acceptWorkspace(executed);
        renderWorkspace();
        setStatus(workspace.proposal
          ? "提案已生成，尚未保存。请展开决定区逐项确认。"
          : "这次提案尚未完成，可在技术详情中查看执行轨迹。", !workspace.proposal, Boolean(workspace.proposal));
      } catch (error) {
        if (!isExpectedCancellation(error) && isCurrent(run)) {
          if (isSourceStale(error)) markWorkspaceStale();
          renderWorkspace();
          setStatus(`提案未完成：${errorMessage(error)}`, true);
        }
      } finally {
        if (isCurrent(run)) setBusy(false);
      }
    }

    function acceptWorkspace(response) {
      workspace = normalizeWorkspace(response?.payload || response || {});
      etag = response?.etag || workspace.etag || etagForRun(workspace.run);
      publishedExhibitionId = findExhibitionId(workspace, "publish_exhibition") || publishedExhibitionId;
    }

    function renderWorkspace(forcedStage) {
      const hasRun = Boolean(workspace.run.id || workspace.proposal);
      elements.workspace.hidden = !hasRun;
      elements.proposal.hidden = !workspace.proposal;
      elements.decisions.hidden = !workspace.proposal;
      elements.demoBadge.hidden = !demo;
      elements.startButton.disabled = busy || demo;
      elements.newButton.disabled = busy;
      renderProgress(forcedStage || stageForWorkspace(workspace, busy));
      renderProposal();
      renderDecisions();
      renderTechnical();
      renderShare();
      renderAccess();
    }

    function renderProgress(activeStage) {
      const order = ["brief", "read", "propose", "decide"];
      const activeIndex = Math.max(0, order.indexOf(activeStage));
      [...elements.progress.querySelectorAll("[data-curator-stage]")].forEach((item) => {
        const index = order.indexOf(item.dataset.curatorStage);
        item.classList.toggle("is-complete", index < activeIndex);
        if (index === activeIndex) item.setAttribute("aria-current", "step");
        else item.removeAttribute("aria-current");
      });
    }

    function renderProposal() {
      if (!workspace.proposal) {
        elements.proposalPreview.innerHTML = "";
        elements.citationList.innerHTML = "";
        return;
      }
      const preview = workspace.proposal.preview;
      const savedId = findExhibitionId(workspace, "save_exhibition");
      const publishId = findExhibitionId(workspace, "publish_exhibition");
      elements.proposalState.textContent = publishId ? "已发布到本馆" : savedId ? "已保存为草稿" : "尚未保存";
      elements.proposalState.classList.toggle("is-saved", Boolean(savedId || publishId));
      const sections = preview.sections.map((section, index) => `
        <section class="curator-agent-preview-section">
          <h5>${String(index + 1).padStart(2, "0")} · ${escapeHtml(section.title || `第 ${index + 1} 章`)}</h5>
          ${section.summary ? `<p>${escapeHtml(section.summary)}</p>` : ""}
          <div class="curator-agent-preview-items">${section.items.map((item) => `
            <article class="curator-agent-preview-item">
              <strong>${escapeHtml(item.title || "未命名展品")}</strong>
              ${item.excerpt ? `<p>${escapeHtml(item.excerpt)}</p>` : ""}
              ${item.curatorNote ? `<p><small>策展说明：</small>${escapeHtml(item.curatorNote)}</p>` : ""}
            </article>`).join("")}</div>
        </section>`).join("");
      elements.proposalPreview.innerHTML = `
        <header class="curator-agent-preview-hero">
          <h4>${escapeHtml(preview.title || workspace.run.request.theme || "未命名策展提案")}</h4>
          ${preview.opening ? `<p>${escapeHtml(preview.opening)}</p>` : ""}
        </header>
        <div class="curator-agent-preview-sections">${sections || '<div class="curator-agent-empty">提案暂未生成章节。</div>'}</div>`;
      renderCitations();
    }

    function renderCitations() {
      const citations = collectCitations(workspace.proposal);
      const refs = workspace.proposal.sourceRefs;
      const refMarkup = refs.map((ref) => {
        const memory = memories.find((item) => item.id === ref.memoryId);
        return `<article class="curator-agent-citation-group">
          <h5>${escapeHtml(memory?.title || ref.title || "馆藏来源")}</h5>
          <small>来源快照已绑定，提案生成后不会被静默替换。</small>
          ${ref.memoryId && typeof options.onOpenMemory === "function" ? `<button type="button" class="button text-button compact" data-curator-memory="${escapeHtml(ref.memoryId)}">打开这件展品</button>` : ""}
        </article>`;
      }).join("");
      const citationMarkup = citations.map((group) => `<article class="curator-agent-citation-group">
        <h5>${escapeHtml(group.title || "引用依据")}</h5>
        ${group.memoryId && typeof options.onOpenMemory === "function" ? `<button type="button" class="button text-button compact" data-curator-memory="${escapeHtml(group.memoryId)}">打开来源展品</button>` : ""}
        ${group.quotes.map((quote) => `<blockquote>“${escapeHtml(quote)}”</blockquote>`).join("")}
      </article>`).join("");
      elements.citationList.innerHTML = citationMarkup || refMarkup || '<div class="curator-agent-empty">这份提案没有可展示的引用。</div>';
    }

    function renderDecisions() {
      if (!workspace.proposal) {
        elements.decisionList.innerHTML = "";
        return;
      }
      const stale = workspace.freshness === "stale";
      const canDecide = !demo && !workspace.historical && workspace.allowDecisions && !stale && !busy;
      const saveDecision = latestDecision(workspace.decisions, "save_exhibition");
      const relationshipDecision = latestDecision(workspace.decisions, "confirm_relationship");
      const publishDecision = latestDecision(workspace.decisions, "publish_exhibition");
      const savedId = findExhibitionId(workspace, "save_exhibition");
      const cards = [];
      if (stale) cards.push('<p class="curator-agent-stale-note">馆藏来源已变化。这份提案仍可只读回看，但不能继续决定；请点击“提出新主题”重新提案。</p>');

      cards.push(`<article class="curator-agent-decision-card">
        <h5>保存这场展览</h5>
        <p>只保存为本馆草稿，不会自动发布或分享。</p>
        ${saveDecision ? decisionResult(saveDecision, "草稿已保存", "已决定不保存") : `<div class="curator-agent-decision-actions"><button type="button" class="button primary" data-curator-action="save_exhibition" data-curator-decision="approve" ${canDecide && actionEnabled("save_exhibition") ? "" : "disabled"}>保存为草稿</button></div>`}
      </article>`);

      const relationships = workspace.proposal.relationships;
      relationships.forEach((relation, index) => {
        cards.push(`<article class="curator-agent-decision-card">
          <h5>${escapeHtml(relation.title || `候选关系 ${index + 1}`)}</h5>
          <p>${escapeHtml(relation.description || "这只是候选联系，必须由你亲自确认。")}</p>
          ${relationshipDecision ? decisionResult(relationshipDecision, "关系已确认", "已决定不采用") : `<div class="curator-agent-decision-actions">
            <button type="button" class="button secondary" data-curator-action="confirm_relationship" data-curator-decision="approve" ${canDecide && actionEnabled("confirm_relationship") ? "" : "disabled"}>确认关系</button>
            <button type="button" class="button text-button" data-curator-action="confirm_relationship" data-curator-decision="reject" ${canDecide && actionEnabled("confirm_relationship") ? "" : "disabled"}>不采用</button>
          </div>`}
        </article>`);
      });

      cards.push(`<article class="curator-agent-decision-card">
        <h5>发布到本馆</h5>
        <p>只有先保存草稿后，才可以单独发布；发布仍不会自动分享。</p>
        ${publishDecision ? decisionResult(publishDecision, "已发布到本馆", "已决定暂不发布") : `<div class="curator-agent-decision-actions"><button type="button" class="button secondary" data-curator-action="publish_exhibition" data-curator-decision="approve" ${canDecide && savedId && actionEnabled("publish_exhibition") ? "" : "disabled"}>发布到本馆</button></div>`}
      </article>`);
      elements.decisionList.innerHTML = cards.join("");
    }

    function decisionResult(decision, approvedText, rejectedText) {
      const approved = decision.decision === "approve";
      return `<p class="curator-agent-decision-result">${escapeHtml(approved ? approvedText : rejectedText)}</p>`;
    }

    function actionEnabled(name) {
      const action = workspace.proposal.actions.find((item) => item.action === name);
      return !action || action.enabled !== false;
    }

    async function handleDecisionClick(event) {
      const button = event.target?.closest?.("[data-curator-action][data-curator-decision]");
      if (!button || busy || demo || workspace.freshness === "stale") return;
      await decide(button.dataset.curatorAction, button.dataset.curatorDecision, button);
    }

    async function decide(action, decision, trigger) {
      if (!workspace.run.id || !etag) {
        setStatus("运行版本缺失，请重新读取或提出一份新提案。", true);
        return;
      }
      const run = session;
      setBusy(true);
      setStatus(decision === "reject" ? "正在记录你的不采用决定…" : "正在执行这一项明确决定…");
      try {
        const response = await requestJson("decision", `/api/curator-agent/runs/${encodeURIComponent(workspace.run.id)}/decisions`, {
          method: "POST",
          headers: mutationHeaders(`${action}-${decision}`),
          body: JSON.stringify({ action, decision, confirm: true })
        }, run);
        if (!isCurrent(run)) return;
        acceptWorkspace(response);
        renderWorkspace("decide");
        const labels = {
          save_exhibition: "草稿保存决定已记录。",
          confirm_relationship: decision === "approve" ? "候选关系已由你确认。" : "候选关系已决定不采用。",
          publish_exhibition: "展览已发布到本馆；分享仍需另行进入隐私编辑台。"
        };
        setStatus(labels[action] || "决定已记录。", false, true);
        trigger?.focus?.({ preventScroll: true });
      } catch (error) {
        if (!isExpectedCancellation(error) && isCurrent(run)) {
          if (isSourceStale(error)) {
            markWorkspaceStale();
            renderWorkspace("decide");
            setStatus("馆藏来源已经变化；当前提案保留为只读，请重新提案。", true);
          } else if (error.status === 409 || error.status === 412) {
            setStatus("这次运行已在别处更新；请从最近记录重新读取后再决定。", true);
          } else setStatus(`决定未完成：${errorMessage(error)}`, true);
        }
      } finally {
        if (isCurrent(run)) setBusy(false);
      }
    }

    function markWorkspaceStale() {
      workspace = Object.freeze({ ...workspace, freshness: "stale", allowDecisions: false });
    }

    function renderTechnical() {
      const budgets = { ...DEFAULT_BUDGETS, ...(workspace.run.budgets || {}) };
      const usage = workspace.run.usage || {};
      elements.budget.innerHTML = [
        ["步骤", `${numberOrZero(usage.steps)} / ${budgetValue(budgets, "maxSteps", "steps", 6)}`],
        ["只读查阅", `${numberOrZero(usage.toolCalls)} / ${budgetValue(budgets, "maxToolCalls", "toolCalls", 4)}`],
        ["执行时间", `${numberOrZero(usage.durationMs)} / ${budgetValue(budgets, "maxDurationMs", "durationMs", 2000)} ms`],
        ["来源", `${sourceCount(workspace)} / ${budgetValue(budgets, "maxSources", "sources", 6)}`]
      ].map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");
      elements.trace.innerHTML = workspace.steps.length ? workspace.steps.map((step) => `<li><strong>${escapeHtml(friendlyStep(step))}</strong>${step.summary ? `<small>${escapeHtml(step.summary)}</small>` : ""}</li>`).join("") : '<li><span>尚无查阅轨迹。</span></li>';
      elements.evaluationButton.disabled = demo || busy || !workspace.run.id || !COMPLETE_STATUSES.has(workspace.run.status);
      elements.recentButton.disabled = demo || busy;
    }

    function renderShare() {
      publishedExhibitionId = findExhibitionId(workspace, "publish_exhibition") || publishedExhibitionId;
      elements.share.hidden = !publishedExhibitionId;
      elements.shareButton.disabled = busy || !publishedExhibitionId;
    }

    function openPrivacyEditor(event) {
      if (!publishedExhibitionId || typeof options.onOpenShare !== "function") return;
      const trigger = event?.currentTarget || elements.shareButton;
      elements.dialog.close();
      options.onOpenShare(publishedExhibitionId, trigger);
    }

    async function handleCitationClick(event) {
      const button = event.target?.closest?.("[data-curator-memory]");
      if (!button || typeof options.onOpenMemory !== "function") return;
      const memoryId = safeId(button.dataset.curatorMemory);
      if (!memoryId) return;
      await options.onOpenMemory(memoryId);
    }

    async function loadEvaluation() {
      if (demo || busy || !workspace.run.id) return;
      const run = session;
      setBusy(true);
      elements.evaluation.textContent = "正在离线重放这次策展记录…";
      try {
        const response = await requestJson("evaluation", `/api/curator-agent/runs/${encodeURIComponent(workspace.run.id)}/evaluation`, {}, run);
        if (!isCurrent(run)) return;
        if (response.etag) etag = response.etag;
        const evaluation = normalizeEvaluation(response.payload?.evaluation || response.payload);
        renderEvaluation(evaluation);
      } catch (error) {
        if (!isExpectedCancellation(error)) elements.evaluation.textContent = `校验失败：${errorMessage(error)}`;
      } finally {
        if (isCurrent(run)) setBusy(false);
      }
    }

    function renderEvaluation(evaluation) {
      const valid = evaluation.valid === true;
      elements.evaluation.innerHTML = `<div class="curator-agent-evaluation-card ${valid ? "is-valid" : "is-invalid"}">
        <strong>${valid ? "离线重放一致" : "离线重放需要复核"}</strong>
        <span>${escapeHtml(evaluation.summary || (valid ? "步骤、来源快照与提案摘要可以重复校验。" : "至少一项校验未通过；不会自动修改提案。"))}</span>
      </div>`;
    }

    async function loadRecentRuns() {
      if (demo || busy) return;
      const run = session;
      setBusy(true);
      elements.recent.textContent = "正在读取最近的本机策展记录…";
      try {
        const response = await requestJson("recent", "/api/curator-agent/runs?limit=20", {}, run);
        if (!isCurrent(run)) return;
        const list = normalizeRuns(response.payload?.runs || response.payload);
        renderRecentRuns(list);
      } catch (error) {
        if (!isExpectedCancellation(error)) elements.recent.textContent = `最近记录读取失败：${errorMessage(error)}`;
      } finally {
        if (isCurrent(run)) setBusy(false);
      }
    }

    function renderRecentRuns(runs) {
      elements.recent.innerHTML = runs.length ? runs.map((run) => `
        <article class="curator-agent-recent-item" data-curator-run="${escapeHtml(run.id)}" data-curator-version="${escapeHtml(String(run.version || 1))}">
          <h5>${escapeHtml(run.request.theme || run.request.query || "未命名策展任务")}</h5>
          <span>${escapeHtml(runStatusLabel(run.status))} · ${escapeHtml(formatDate(run.updatedAt || run.createdAt))}</span>
          <small>本机运行记录不会进入展览分享。</small>
          <div class="curator-agent-recent-actions">
            <button type="button" class="button secondary compact" data-curator-run-open="${escapeHtml(run.id)}">只读查看</button>
            <button type="button" class="button text-button compact" data-curator-run-delete="${escapeHtml(run.id)}">删除记录</button>
          </div>
        </article>`).join("") : '<div class="curator-agent-empty">还没有本机策展记录。</div>';
    }

    async function handleRecentClick(event) {
      const openButton = event.target?.closest?.("[data-curator-run-open]");
      if (openButton) {
        await openRecentRun(openButton.dataset.curatorRunOpen);
        return;
      }
      const deleteButton = event.target?.closest?.("[data-curator-run-delete]");
      if (deleteButton) {
        showDeleteConfirmation(deleteButton);
        return;
      }
      const confirmButton = event.target?.closest?.("[data-curator-run-delete-confirm]");
      if (confirmButton) {
        await deleteRecentRun(confirmButton);
        return;
      }
      const cancelButton = event.target?.closest?.("[data-curator-run-delete-cancel]");
      if (cancelButton) cancelButton.closest(".curator-agent-delete-confirm")?.remove();
    }

    async function openRecentRun(id) {
      const runId = safeId(id);
      if (!runId || busy) return;
      const run = session;
      setBusy(true);
      setStatus("正在只读读取这次策展记录…");
      try {
        const response = await requestJson("recent-detail", `/api/curator-agent/runs/${encodeURIComponent(runId)}`, {}, run);
        if (!isCurrent(run)) return;
        acceptWorkspace(response);
        workspace = Object.freeze({ ...workspace, historical: true, allowDecisions: false });
        elements.brief.hidden = true;
        renderWorkspace();
        setStatus("已打开历史提案；它保持只读。新提案会创建新的运行。", false, true);
      } catch (error) {
        if (!isExpectedCancellation(error)) setStatus(`记录读取失败：${errorMessage(error)}`, true);
      } finally {
        if (isCurrent(run)) setBusy(false);
      }
    }

    function showDeleteConfirmation(button) {
      const article = button.closest("[data-curator-run]");
      if (!article || article.querySelector(".curator-agent-delete-confirm")) return;
      article.insertAdjacentHTML("beforeend", `<div class="curator-agent-delete-confirm">
        <span>只删除这条 Agent 运行记录，不删除馆藏或展览。</span>
        <button type="button" class="button danger compact" data-curator-run-delete-confirm="${escapeHtml(article.dataset.curatorRun)}">确认删除</button>
        <button type="button" class="button text-button compact" data-curator-run-delete-cancel>取消</button>
      </div>`);
    }

    async function deleteRecentRun(button) {
      if (demo || busy) return;
      const article = button.closest("[data-curator-run]");
      const runId = safeId(button.dataset.curatorRunDeleteConfirm);
      if (!article || !runId) return;
      const version = positiveInteger(article.dataset.curatorVersion) || 1;
      const run = session;
      setBusy(true);
      try {
        await requestJson("delete", `/api/curator-agent/runs/${encodeURIComponent(runId)}`, {
          method: "DELETE",
          headers: {
            "If-Match": `"curator-agent-${runId}-v${version}"`,
            "Idempotency-Key": idempotencyKey("delete")
          },
          body: JSON.stringify({ confirm: true })
        }, run);
        if (!isCurrent(run)) return;
        article.remove();
        if (workspace.run.id === runId) {
          busy = false;
          resetWorkspace({ preserveMemories: true });
        }
        setStatus("这条本机 Agent 运行记录已删除；馆藏与展览未改变。", false, true);
      } catch (error) {
        if (!isExpectedCancellation(error)) setStatus(`记录删除失败：${errorMessage(error)}`, true);
      } finally {
        if (isCurrent(run)) setBusy(false);
      }
    }

    async function requestClose() {
      if (closing || destroyed) return;
      closing = true;
      if (!demo && workspace.run.id && RUNNING_STATUSES.has(workspace.run.status)) {
        setStatus("正在尝试取消尚未完成的策展任务…");
        abortRequests();
        try {
          await requestJson("cancel", `/api/curator-agent/runs/${encodeURIComponent(workspace.run.id)}/cancel`, {
            method: "POST",
            headers: mutationHeaders("cancel"),
            body: JSON.stringify({ confirm: true })
          }, session);
        } catch (error) {
          if (!isExpectedCancellation(error)) console.warn("策展任务关闭时未能确认取消：", errorMessage(error));
        }
      }
      if (elements.dialog.open) elements.dialog.close();
      closing = false;
    }

    function handleDialogClose() {
      startSession();
      closing = false;
      const target = lastTrigger?.isConnected ? lastTrigger : elements.entryButton;
      lastTrigger = null;
      resetWorkspace();
      global.requestAnimationFrame?.(() => target?.focus?.({ preventScroll: true }));
    }

    function beginNewProposal() {
      if (busy) return;
      startSession();
      resetWorkspace({ preserveMemories: true });
      elements.theme.focus({ preventScroll: true });
    }

    function resetWorkspace(options = {}) {
      workspace = normalizeWorkspace({});
      etag = "";
      publishedExhibitionId = "";
      busy = false;
      elements.form.reset();
      elements.brief.hidden = false;
      elements.workspace.hidden = true;
      elements.proposal.hidden = true;
      elements.decisions.hidden = true;
      elements.share.hidden = true;
      elements.sourcePicker.open = false;
      elements.technical.open = false;
      elements.proposalPreview.innerHTML = "";
      elements.citationList.innerHTML = "";
      elements.decisionList.innerHTML = "";
      elements.evaluation.innerHTML = "";
      elements.recent.innerHTML = "";
      elements.trace.innerHTML = "";
      elements.budget.innerHTML = "";
      elements.demoBadge.hidden = !demo;
      elements.theme.disabled = demo;
      elements.sourcePicker.hidden = demo;
      elements.startButton.disabled = demo;
      elements.startButton.textContent = demo ? "Demo 仅展示提案" : "生成一份策展提案";
      if (!options.preserveMemories) {
        memories = [];
        memoriesLoaded = false;
        elements.sourceList.innerHTML = "";
      } else renderSourceChoices();
      updateSourceStatus();
      setStatus(demo ? "打开后只会读取一份预置示例。" : "");
      renderTechnical();
      renderShare();
      renderAccess();
    }

    function setDemo(value) {
      const next = Boolean(value);
      if (demo === next) return;
      demo = next;
      if (elements.dialog.open) {
        resetWorkspace();
        if (demo) loadSample();
      } else resetWorkspace();
    }

    function setBusy(value) {
      busy = Boolean(value);
      renderAccess();
      if (workspace.proposal) renderDecisions();
      renderTechnical();
      renderShare();
    }

    function renderAccess() {
      elements.dialog.setAttribute("aria-busy", busy ? "true" : "false");
      elements.startButton.disabled = busy || demo;
      elements.newButton.disabled = busy;
      elements.closeButton.disabled = closing;
      elements.theme.disabled = busy || demo;
      [...elements.sourceList.querySelectorAll("input")].forEach((input) => { input.disabled = busy || demo; });
    }

    function setStatus(text, isError = false, isSuccess = false) {
      elements.status.textContent = String(text || "");
      elements.status.classList.toggle("is-error", Boolean(isError));
      elements.status.classList.toggle("is-success", Boolean(isSuccess));
    }

    function selectedMemoryIds() {
      return [...elements.sourceList.querySelectorAll('input[name="curatorAgentSource"]:checked')]
        .map((input) => safeId(input.value))
        .filter(Boolean);
    }

    function mutationHeaders(scope) {
      return {
        "If-Match": etag || etagForRun(workspace.run),
        "Idempotency-Key": idempotencyKey(scope)
      };
    }

    function idempotencyKey(scope) {
      mutationSequence += 1;
      const random = typeof global.crypto?.randomUUID === "function"
        ? global.crypto.randomUUID()
        : `${Date.now().toString(36)}-${mutationSequence.toString(36)}`;
      return `curator-${String(scope || "mutation").slice(0, 32)}-${random}`;
    }

    async function requestJson(key, url, requestOptions = {}, run = session) {
      requests.get(key)?.abort();
      const controller = new AbortController();
      requests.set(key, controller);
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
        const responseEtag = response.headers?.get?.("etag") || payload?.etag || "";
        if (!response.ok) {
          const error = new Error(payload?.error?.message || payload?.error || payload?.message || `请求失败（${response.status}）`);
          error.status = response.status;
          error.code = payload?.code || payload?.error?.code || "";
          error.payload = payload;
          throw error;
        }
        if (!isCurrent(run) || requests.get(key) !== controller) throw staleRequest;
        return { payload, etag: responseEtag };
      } finally {
        if (requests.get(key) === controller) requests.delete(key);
      }
    }

    function startSession() {
      session += 1;
      abortRequests();
      return session;
    }

    function abortRequests() {
      requests.forEach((controller) => controller.abort());
      requests.clear();
    }

    function isCurrent(run) {
      return !destroyed && run === session;
    }

    function isExpectedCancellation(error) {
      return error === staleRequest || error?.name === "AbortError";
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      startSession();
      listeners.forEach(({ target, type, handler, listenerOptions }) => target.removeEventListener(type, handler, listenerOptions));
      listeners.length = 0;
      if (elements.dialog.open) elements.dialog.close();
    }

    return Object.freeze({ open, preselectSources, setDemo, destroy });
  }

  function normalizeWorkspace(value) {
    const envelope = value && typeof value === "object" ? value : {};
    const source = envelope.workspace && typeof envelope.workspace === "object" ? envelope.workspace : envelope;
    const runSource = source.run && typeof source.run === "object" ? source.run : source;
    const run = normalizeRun(runSource);
    const proposalSource = source.proposal && typeof source.proposal === "object" ? source.proposal : null;
    const freshnessValue = String(source.freshness?.status || source.freshness || runSource.freshness?.status || runSource.freshness || "").toLowerCase();
    const stale = source.sourceStale === true || runSource.sourceStale === true || ["stale", "source_stale", "changed", "needs_review"].includes(freshnessValue);
    const historical = source.historical === true || run.historical === true;
    return Object.freeze({
      run,
      steps: normalizeSteps(source.steps || runSource.steps),
      proposal: proposalSource ? normalizeProposal(proposalSource) : null,
      decisions: normalizeDecisions(source.decisions || runSource.decisions),
      evaluation: source.evaluation || null,
      freshness: stale ? "stale" : "fresh",
      historical,
      allowDecisions: source.allowDecisions !== false && run.allowDecisions !== false && !stale && !historical,
      etag: String(source.etag || envelope.etag || "")
    });
  }

  function normalizeRun(value) {
    const source = value && typeof value === "object" ? value : {};
    const request = source.request && typeof source.request === "object" ? source.request : {};
    return Object.freeze({
      id: safeId(source.id || source.runId),
      status: String(source.status || "").toLowerCase(),
      version: positiveInteger(source.version) || 0,
      request: Object.freeze({
        theme: String(request.theme || request.query || source.theme || ""),
        query: String(request.query || request.theme || source.query || ""),
        memoryIds: normalizeIds(request.memoryIds || source.memoryIds)
      }),
      budgets: normalizeBudget(source.budgets || source.budget),
      usage: normalizeUsage(source.usage),
      historical: source.historical === true,
      allowDecisions: source.allowDecisions !== false,
      needsReview: source.needsReview === true,
      createdAt: String(source.createdAt || ""),
      updatedAt: String(source.updatedAt || "")
    });
  }

  function normalizeProposal(value) {
    const source = value && typeof value === "object" ? value : {};
    const relations = Array.isArray(source.relationships) ? source.relationships : source.relation ? [source.relation] : [];
    return Object.freeze({
      id: safeId(source.id || source.proposalId),
      proposalSha256: safeHash(source.proposalSha256),
      sourceSetSha256: safeHash(source.sourceSetSha256),
      sourceRefs: normalizeSourceRefs(source.sourceRefs || source.sources),
      preview: normalizePreview(source.preview || source.exhibition || source),
      relationships: relations.map(normalizeRelationship).filter((item) => item.status !== "invalid"),
      actions: normalizeActions(source.actions),
      createdAt: String(source.createdAt || "")
    });
  }

  function normalizePreview(value) {
    const source = value && typeof value === "object" ? value : {};
    const sections = (Array.isArray(source.sections) ? source.sections : []).map((section, sectionIndex) => ({
      id: safeId(section?.id) || `section-${sectionIndex + 1}`,
      title: String(section?.title || `第 ${sectionIndex + 1} 章`),
      summary: String(section?.summary || ""),
      items: (Array.isArray(section?.items) ? section.items : []).map((item) => ({
        memoryId: safeId(item?.memoryId || item?.id),
        title: String(item?.title || "未命名展品"),
        excerpt: String(item?.excerpt || item?.summary || ""),
        curatorNote: String(item?.curatorNote || item?.note || ""),
        citations: normalizeCitations(item?.citations || item?.evidence)
      }))
    }));
    return Object.freeze({
      title: String(source.title || source.name || ""),
      theme: String(source.theme || ""),
      opening: String(source.opening || source.introduction || source.summary || ""),
      sections
    });
  }

  function normalizeCitations(value) {
    return (Array.isArray(value) ? value : []).map((citation) => ({
      memoryId: safeId(citation?.memoryId || citation?.sourceId),
      quote: String(typeof citation === "string" ? citation : citation?.quote || citation?.text || ""),
      field: String(citation?.field || "rawContent"),
      evidenceValid: citation?.evidenceValid !== false
    })).filter((citation) => citation.quote);
  }

  function normalizeSourceRefs(value) {
    return (Array.isArray(value) ? value : []).map((ref) => ({
      memoryId: safeId(ref?.memoryId || ref?.id),
      title: String(ref?.title || ref?.memoryTitle || ""),
      updatedAt: String(ref?.updatedAt || ""),
      rawSha256: safeHash(ref?.rawSha256 || ref?.sha256)
    })).filter((ref) => ref.memoryId);
  }

  function normalizeRelationship(value) {
    const source = value && typeof value === "object" ? value : {};
    return Object.freeze({
      id: safeId(source.id || source.relationshipId),
      status: String(source.status || "candidate"),
      title: String(source.title || source.label || "候选记忆关系"),
      description: String(source.description || source.reason || source.rationale || source.summary || "")
    });
  }

  function normalizeActions(value) {
    const allowed = new Set(["save_exhibition", "confirm_relationship", "publish_exhibition"]);
    return (Array.isArray(value) ? value : []).map((action) => ({
      action: String(action?.action || action?.type || ""),
      enabled: action?.enabled !== false,
      requiresConfirmation: action?.requiresConfirmation !== false,
      dependsOn: String(action?.dependsOn || "")
    })).filter((action) => allowed.has(action.action));
  }

  function normalizeDecisions(value) {
    return (Array.isArray(value) ? value : []).map((decision) => ({
      id: safeId(decision?.id || decision?.decisionId),
      action: String(decision?.action || ""),
      decision: String(decision?.decision || decision?.result || ""),
      status: String(decision?.status || ""),
      outcome: decision?.outcome && typeof decision.outcome === "object" ? decision.outcome : {},
      createdAt: String(decision?.createdAt || "")
    })).filter((decision) => decision.action);
  }

  function normalizeSteps(value) {
    return (Array.isArray(value) ? value : []).map((step, index) => ({
      index: Number.isSafeInteger(Number(step?.position)) && Number(step.position) >= 0
        ? Number(step.position) + 1
        : positiveInteger(step?.index || step?.step) || index + 1,
      status: String(step?.status || "completed"),
      tool: String(step?.tool || step?.toolName || step?.kind || ""),
      label: String(step?.label || step?.title || ""),
      summary: String(step?.summary || step?.resultSummary || step?.message || "")
    }));
  }

  function normalizeBudget(value) {
    const source = value && typeof value === "object" ? value : {};
    return Object.freeze({
      maxSteps: positiveInteger(source.maxSteps || source.steps) || DEFAULT_BUDGETS.maxSteps,
      maxToolCalls: positiveInteger(source.maxToolCalls || source.toolCalls || source.reads) || DEFAULT_BUDGETS.maxToolCalls,
      maxDurationMs: positiveInteger(source.maxDurationMs || source.durationMs || source.timeMs) || DEFAULT_BUDGETS.maxDurationMs,
      maxSources: positiveInteger(source.maxSources || source.maxMemories || source.sources) || DEFAULT_BUDGETS.maxSources
    });
  }

  function normalizeUsage(value) {
    const source = value && typeof value === "object" ? value : {};
    return Object.freeze({
      steps: numberOrZero(source.steps || source.stepCount),
      toolCalls: numberOrZero(source.toolCalls || source.reads || source.toolCallCount),
      durationMs: numberOrZero(source.durationMs || source.elapsedMs),
      sources: numberOrZero(source.sources || source.sourceCount)
    });
  }

  function normalizeMemories(value) {
    return (Array.isArray(value) ? value : []).map((memory) => ({
      id: safeId(memory?.id),
      title: String(memory?.title || "未命名展品"),
      summary: truncate(memory?.exhibitText || memory?.rawContent || memory?.summary || "", 92)
    })).filter((memory) => memory.id);
  }

  function normalizeRuns(value) {
    return (Array.isArray(value) ? value : []).map(normalizeRun).filter((run) => run.id);
  }

  function normalizeEvaluation(value) {
    const source = value && typeof value === "object" ? value : {};
    const checks = Array.isArray(source.checks) ? source.checks : [];
    const valid = source.passed === true || source.valid === true || source.replayMatched === true || (checks.length > 0 && checks.every((check) => check?.valid === true || check?.passed === true));
    return { valid, summary: String(source.summary || source.message || "") };
  }

  function collectCitations(proposal) {
    if (!proposal) return [];
    const groups = [];
    proposal.preview.sections.forEach((section) => section.items.forEach((item) => {
      const quotes = item.citations.filter((citation) => citation.evidenceValid).map((citation) => citation.quote);
      if (quotes.length) groups.push({ memoryId: item.memoryId, title: item.title, quotes });
    }));
    return groups;
  }

  function latestDecision(decisions, action) {
    return [...decisions].reverse().find((decision) => decision.action === action) || null;
  }

  function findExhibitionId(workspace, action) {
    const decision = latestDecision(workspace.decisions, action);
    return safeId(decision?.outcome?.exhibitionId || decision?.outcome?.id || "");
  }

  function stageForWorkspace(workspace, busy) {
    if (workspace.proposal) return "decide";
    if (workspace.steps.length) return busy ? "propose" : "read";
    if (RUNNING_STATUSES.has(workspace.run.status)) return "read";
    return "brief";
  }

  function friendlyStep(step) {
    if (step.label) return step.label;
    const labels = {
      list_memories: "查阅馆藏目录",
      search_memories: "按主题寻找来源",
      search_memory_summaries: "按主题寻找馆藏摘要",
      read_memory_evidence: "读取展品的原文依据",
      get_relationship_candidates: "查看有依据的候选联系",
      read_confirmed_relationships: "核对已经确认的记忆关系",
      read_exhibition_summaries: "核对既有展览，避免重复叙事",
      compose_proposal: "整理不可变策展提案"
    };
    return labels[step.tool] || `完成第 ${step.index} 步只读查阅`;
  }

  function sourceCount(workspace) {
    return workspace.proposal?.sourceRefs.length || workspace.run.usage.sources || workspace.run.request.memoryIds.length || 0;
  }

  function budgetValue(budgets, preferred, fallback, defaultValue) {
    return positiveInteger(budgets?.[preferred] || budgets?.[fallback]) || defaultValue;
  }

  function etagForRun(run) {
    return run?.id && run?.version ? `"curator-agent-${run.id}-v${run.version}"` : "";
  }

  function isSourceStale(error) {
    return error?.code === "CURATOR_AGENT_SOURCE_STALE" || error?.payload?.code === "CURATOR_AGENT_SOURCE_STALE";
  }

  function runStatusLabel(status) {
    const labels = { created: "待执行", queued: "等待中", running: "执行中", executing: "执行中", completed: "提案完成", complete: "提案完成", awaiting_review: "等待决定", cancelled: "已取消", failed: "未完成", decided: "已决定" };
    return labels[status] || "本机记录";
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "时间未记录";
    return date.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  function resolveElements(documentRef, ids) {
    if (!documentRef?.getElementById) return null;
    const elements = {};
    for (const [name, id] of Object.entries(ids)) {
      const element = documentRef.getElementById(id);
      if (!element) return null;
      elements[name] = element;
    }
    return elements;
  }

  function safeId(value) {
    const id = String(value || "").trim();
    return /^[a-zA-Z0-9_-]{1,160}$/u.test(id) ? id : "";
  }

  function safeHash(value) {
    const hash = String(value || "").toLowerCase();
    return /^[a-f0-9]{64}$/u.test(hash) ? hash : "";
  }

  function normalizeIds(value) {
    return [...new Set((Array.isArray(value) ? value : []).map(safeId).filter(Boolean))].slice(0, MAX_SELECTED_SOURCES);
  }

  function positiveInteger(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : 0;
  }

  function numberOrZero(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
  }

  function truncate(value, limit) {
    const text = String(value || "").replace(/\s+/gu, " ").trim();
    return Array.from(text).length > limit ? `${Array.from(text).slice(0, limit).join("")}…` : text;
  }

  function parseJson(text) {
    try { return JSON.parse(text); } catch { return { error: text }; }
  }

  function errorMessage(error) {
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

  global.TimeIsleCuratorAgent = Object.freeze({ createController, normalizeWorkspace, domIds });
})(typeof window !== "undefined" ? window : globalThis);
