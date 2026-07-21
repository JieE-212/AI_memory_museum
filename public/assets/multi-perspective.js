(function initializeTimeIsleMultiPerspective(root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.TimeIsleMultiPerspective = factory();
}(typeof globalThis !== "undefined" ? globalThis : self, function createMultiPerspectiveModule() {
  "use strict";

  const FORMAT = "time-isle.multi-perspective-preview";
  const VERSION = 1;
  const ENGINE = "deterministic-multi-perspective-v1";
  const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/u;
  const HASH_PATTERN = /^[a-f0-9]{64}$/u;
  const RELATIONS = new Set(["supports", "supplements", "different_record"]);
  const INTEGRITY = new Set(["source_verified", "archived_verified", "source_changed", "source_missing"]);

  function renderPanel(memory = {}) {
    const id = safeId(memory.id);
    if (!id) return "";
    return `<details class="multi-perspective-panel" data-multi-perspective="${id}">
      <summary>
        <span><strong>多视角记忆对照</strong><small data-multi-perspective-summary>把当前记录、编辑年轮和亲友回信放在一起看</small></span>
        <span aria-hidden="true">＋</span>
      </summary>
      <div class="multi-perspective-body" data-multi-perspective-body>
        <p class="multi-perspective-status" data-multi-perspective-status role="status" aria-live="polite" aria-atomic="true">展开后读取只读对照；不会自动保存或判断谁对谁错。</p>
      </div>
    </details>`;
  }

  function createController(options = {}) {
    const documentRef = options.document || (typeof document !== "undefined" ? document : null);
    const loadPreview = typeof options.loadPreview === "function" ? options.loadPreview : null;
    const onHandoff = typeof options.onHandoff === "function" ? options.onHandoff : () => false;
    if (!documentRef || !loadPreview) return null;
    let session = null;

    function open(memory, container) {
      close();
      const memoryId = safeId(memory?.id);
      const panel = container?.querySelector?.(`[data-multi-perspective="${memoryId}"]`);
      if (!memoryId || !panel) return;
      const controller = new AbortController();
      session = {
        memoryId,
        panel,
        body: panel.querySelector("[data-multi-perspective-body]"),
        summary: panel.querySelector("[data-multi-perspective-summary]"),
        controller,
        loaded: false,
        busy: false,
        preview: null
      };
      panel.addEventListener("toggle", handleToggle, { signal: controller.signal });
      panel.addEventListener("click", handleClick, { signal: controller.signal });
    }

    function close() {
      if (!session) return;
      session.controller.abort();
      session.preview = null;
      session = null;
    }

    function refresh() {
      if (!session || !session.panel.open) return Promise.resolve(null);
      return load(session, true);
    }

    function handleToggle(event) {
      const active = session;
      if (!active || event.target !== active.panel || !active.panel.open || active.loaded || active.busy) return;
      void load(active, false);
    }

    function handleClick(event) {
      const active = session;
      if (!active || active.busy) return;
      if (event.target.closest("[data-multi-perspective-retry]")) return void load(active, true);
      const action = event.target.closest("[data-multi-perspective-handoff]");
      if (!action) return;
      const kind = String(action.dataset.multiPerspectiveHandoff || "");
      if (!["provenance", "revisions", "puzzle"].includes(kind)) return;
      const completed = onHandoff(kind, { memoryId: active.memoryId, panel: active.panel, trigger: action });
      if (completed === false) setStatus(active, "没有找到对应入口；其它对照内容仍可继续阅读。", "error");
    }

    async function load(active, force) {
      if (!active || session !== active || active.busy) return null;
      if (force) active.loaded = false;
      active.busy = true;
      active.body.setAttribute("aria-busy", "true");
      setStatus(active, "正在读取本机已有记录与人工来源关系…");
      try {
        const payload = await loadPreview(active.memoryId, { signal: active.controller.signal });
        if (session !== active || active.controller.signal.aborted) return null;
        const preview = normalizePreview(payload?.preview || payload, active.memoryId);
        active.preview = preview;
        active.loaded = true;
        renderPreview(active, preview);
        return preview;
      } catch (error) {
        if (session !== active || error?.name === "AbortError") return null;
        renderError(active, error);
        return null;
      } finally {
        if (session === active) {
          active.busy = false;
          active.body.setAttribute("aria-busy", "false");
        }
      }
    }

    function renderPreview(active, preview) {
      active.body.replaceChildren();
      active.summary.textContent = summaryCopy(preview);
      const intro = element(documentRef, "p", "multi-perspective-intro");
      intro.textContent = "可以把它理解成一张‘同一件事的多栏对照表’：这里负责把记录摆在一起并标清来源，不负责宣布谁对谁错。";
      active.body.append(intro);
      if (preview.synthetic) {
        const demo = element(documentRef, "p", "multi-perspective-demo");
        demo.textContent = "这是公开 Demo 的合成对照，不是从私人数据库读取的内容，也不会保存任何操作。";
        active.body.append(demo);
      }
      active.body.append(renderPerspectiveSection(documentRef, preview));
      active.body.append(renderClaimsSection(documentRef, preview));
      active.body.append(renderHistorySection(documentRef, preview));
      active.body.append(renderTimeSection(documentRef, preview));
      active.body.append(renderActions(documentRef, preview));
      const receipt = element(documentRef, "details", "multi-perspective-receipt");
      const receiptSummary = documentRef.createElement("summary");
      receiptSummary.textContent = "查看只读计算边界";
      const receiptText = documentRef.createElement("p");
      receiptText.textContent = `固定规则 · 0 次模型调用 · 0 次工具调用 · 本次不保存 · 回执 ${preview.receipt.previewSha256.slice(0, 12)}…`;
      receipt.append(receiptSummary, receiptText);
      active.body.append(receipt);
    }

    function renderError(active, error) {
      active.loaded = false;
      active.body.replaceChildren();
      const status = element(documentRef, "p", "multi-perspective-status is-error");
      status.dataset.multiPerspectiveStatus = "";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      status.textContent = `对照没有读取完成：${boundedText(error?.message || "请稍后重试。", 240)}`;
      const retry = element(documentRef, "button", "button secondary compact");
      retry.type = "button";
      retry.dataset.multiPerspectiveRetry = "";
      retry.textContent = "重新读取";
      active.body.append(status, retry);
    }

    function setStatus(active, message, tone = "") {
      const status = active.body.querySelector("[data-multi-perspective-status]");
      if (!status) return;
      status.textContent = String(message || "");
      status.classList.toggle("is-error", tone === "error");
    }

    return Object.freeze({ close, open, refresh, renderPanel });
  }

  function renderPerspectiveSection(documentRef, preview) {
    const section = element(documentRef, "section", "multi-perspective-section");
    section.setAttribute("aria-labelledby", "multiPerspectiveViewsTitle");
    const heading = sectionHeading(documentRef, "multiPerspectiveViewsTitle", "这些记录来自哪里", `${preview.summary.perspectiveCount} 个当前可读视角`);
    section.append(heading);
    const visible = preview.perspectives.slice(0, 3);
    const grid = element(documentRef, "div", "multi-perspective-grid");
    visible.forEach((item) => grid.append(renderPerspectiveCard(documentRef, item)));
    section.append(grid);
    const remaining = preview.perspectives.slice(3);
    if (remaining.length) {
      const more = element(documentRef, "details", "multi-perspective-more");
      const summary = documentRef.createElement("summary");
      summary.textContent = `查看其余 ${remaining.length} 个视角`;
      const moreGrid = element(documentRef, "div", "multi-perspective-grid");
      remaining.forEach((item) => moreGrid.append(renderPerspectiveCard(documentRef, item)));
      more.append(summary, moreGrid);
      section.append(more);
    }
    if (preview.perspectivesTruncated) {
      const note = element(documentRef, "p", "multi-perspective-note");
      note.textContent = "回信较多，本页只展示固定数量的最近预览；总数仍保留在摘要中。";
      section.append(note);
    }
    return section;
  }

  function renderPerspectiveCard(documentRef, item) {
    const card = element(documentRef, "article", `multi-perspective-card is-${item.kind === "co_memory_response" ? "reply" : "owner"}`);
    const header = element(documentRef, "header", "multi-perspective-card-heading");
    const title = documentRef.createElement("strong");
    title.textContent = item.label;
    const badge = element(documentRef, "span", "multi-perspective-badge");
    badge.textContent = item.kind === "co_memory_response" ? "身份未核验" : "馆主当前记录";
    header.append(title, badge);
    card.append(header);
    if (item.question) {
      const question = element(documentRef, "p", "multi-perspective-question");
      question.textContent = `当时的问题：${item.question}${item.questionTruncated ? "…" : ""}`;
      card.append(question);
    }
    const excerpt = documentRef.createElement("blockquote");
    excerpt.textContent = `${item.excerpt}${item.excerptTruncated ? "…" : ""}`;
    card.append(excerpt);
    const boundary = element(documentRef, "p", "multi-perspective-card-boundary");
    boundary.textContent = item.identity.boundary;
    card.append(boundary);
    const state = element(documentRef, "small", "multi-perspective-relation-state");
    state.textContent = item.relationState === "linked-by-confirmed-provenance"
      ? "已在来源护照中建立人工关系"
      : item.kind === "co_memory_response"
        ? "尚未建立对照关系"
        : "尚未绑定亲友回信关系";
    card.append(state);
    return card;
  }

  function renderClaimsSection(documentRef, preview) {
    const section = element(documentRef, "section", "multi-perspective-section");
    const heading = sectionHeading(documentRef, "", "已经确认的来源关系", preview.summary.claimCount
      ? `${preview.summary.claimCount} 条关系${preview.summary.needsReviewCount ? ` · ${preview.summary.needsReviewCount} 条待复核` : ""}`
      : "不会从文字中自动生成");
    section.append(heading);
    if (!preview.comparisonClaims.length) {
      const empty = element(documentRef, "p", "multi-perspective-empty");
      empty.textContent = preview.summary.replyCount
        ? "回信已经入馆，但你还没有在来源护照中确认它支持、补充或留下哪一种记录。"
        : "还没有其它视角。可以先生成共忆信笺，或在来源护照里整理已有来源。";
      section.append(empty);
      return section;
    }
    const list = element(documentRef, "div", "multi-perspective-claim-list");
    preview.comparisonClaims.forEach((claim) => {
      const article = element(documentRef, "article", `multi-perspective-claim${claim.needsReview ? " needs-review" : ""}`);
      const title = documentRef.createElement("strong");
      title.textContent = claim.statement;
      const boundary = documentRef.createElement("p");
      boundary.textContent = claim.boundary;
      const sources = documentRef.createElement("ul");
      claim.sources.forEach((source) => {
        const item = documentRef.createElement("li");
        const label = documentRef.createElement("strong");
        label.textContent = `${source.relationLabel} · ${source.label}`;
        const excerpt = documentRef.createElement("span");
        excerpt.textContent = source.excerpt;
        const integrity = documentRef.createElement("small");
        integrity.textContent = integrityCopy(source.integrityStatus);
        item.append(label, excerpt, integrity);
        sources.append(item);
      });
      article.append(title, boundary, sources);
      list.append(article);
    });
    section.append(list);
    if (preview.comparisonClaimsTruncated) {
      const note = element(documentRef, "p", "multi-perspective-note");
      note.textContent = "关系较多，本页只展示固定数量；来源护照仍保留完整账本。";
      section.append(note);
    }
    return section;
  }

  function renderHistorySection(documentRef, preview) {
    const section = element(documentRef, "section", "multi-perspective-section compact");
    section.append(sectionHeading(documentRef, "", "我的编辑年轮", preview.summary.revisionCount
      ? `${preview.summary.revisionCount} 个较早版本`
      : "当前没有较早版本"));
    const boundary = element(documentRef, "p", "multi-perspective-note");
    boundary.textContent = "这是同一位馆主对展品的编辑历史，不等于另一人的记忆。";
    section.append(boundary);
    if (preview.editHistory.length) {
      const list = element(documentRef, "ol", "multi-perspective-history");
      preview.editHistory.slice(0, 3).forEach((revision) => {
        const item = documentRef.createElement("li");
        const title = documentRef.createElement("strong");
        title.textContent = `第 ${revision.revisionNo} 版 · ${revision.title}`;
        const copy = documentRef.createElement("span");
        copy.textContent = revision.excerpt;
        item.append(title, copy);
        list.append(item);
      });
      section.append(list);
    }
    return section;
  }

  function renderTimeSection(documentRef, preview) {
    const section = element(documentRef, "section", "multi-perspective-time");
    const title = documentRef.createElement("strong");
    title.textContent = "当前时间判断";
    const copy = documentRef.createElement("p");
    copy.textContent = describeTime(preview.timeContext);
    const boundary = documentRef.createElement("small");
    boundary.textContent = preview.timeContext.boundary;
    section.append(title, copy, boundary);
    return section;
  }

  function renderActions(documentRef, preview) {
    const section = element(documentRef, "section", "multi-perspective-actions");
    const provenance = actionButton(documentRef, "去来源护照整理关系", "provenance", "secondary");
    const revisions = actionButton(documentRef, "查看完整记忆年轮", "revisions", "text-button");
    const puzzle = actionButton(documentRef, "去时光拼图继续核对", "puzzle", "text-button");
    section.append(provenance, revisions, puzzle);
    const note = documentRef.createElement("p");
    note.textContent = preview.synthetic
      ? "公开 Demo 只演示跳转位置，不创建、确认或保存任何关系。"
      : "这些按钮只打开已有工具；不会自动建立关系、恢复版本或保存时间判断。";
    section.append(note);
    return section;
  }

  function actionButton(documentRef, label, kind, style) {
    const button = element(documentRef, "button", `button ${style} compact`);
    button.type = "button";
    button.dataset.multiPerspectiveHandoff = kind;
    button.textContent = label;
    return button;
  }

  function sectionHeading(documentRef, id, titleCopy, metaCopy) {
    const header = element(documentRef, "header", "multi-perspective-section-heading");
    const title = documentRef.createElement("h3");
    if (id) title.id = id;
    title.textContent = titleCopy;
    const meta = documentRef.createElement("span");
    meta.textContent = metaCopy;
    header.append(title, meta);
    return header;
  }

  function describeTime(context) {
    const calibration = context.calibration;
    if (!calibration) return context.memoryDate ? `展品日期记录为 ${context.memoryDate}；尚未保存独立时间判断。` : "展品日期仍为空，也没有独立时间判断。";
    if (context.needsReview) return "来源后来发生变化；旧时间判断仍保留，但需要重新核对。";
    if (calibration.resolutionKind === "alternatives") return `目前保留多种时间记录（${calibration.selectedSourceCount} 条来源），不判断哪一种更准确。`;
    if (calibration.resolutionKind === "uncertain") return "你已明确选择仍不确定。";
    const interval = calibration.intervalStart === calibration.intervalEnd
      ? calibration.intervalStart
      : `${calibration.intervalStart} 至 ${calibration.intervalEnd}`;
    return `你保存的时间判断是 ${interval || "未填写范围"}。`;
  }

  function summaryCopy(preview) {
    return `${preview.summary.perspectiveCount} 个可读视角 · ${preview.summary.claimCount} 条人工关系${preview.summary.needsReviewCount ? ` · ${preview.summary.needsReviewCount} 条待复核` : ""}`;
  }

  function integrityCopy(value) {
    return ({
      source_verified: "当前来源可核对",
      archived_verified: "保存时来源已核对",
      source_changed: "来源后来变化",
      source_missing: "来源已缺失"
    })[value] || "来源待核对";
  }

  function normalizePreview(value, expectedMemoryId) {
    if (!plainObject(value) || value.format !== FORMAT || value.version !== VERSION || value.target?.type !== "memory" ||
        safeId(value.target?.id) !== safeId(expectedMemoryId) || value.execution?.engine !== ENGINE ||
        value.execution?.deterministic !== true || value.execution?.externalModel !== false ||
        value.execution?.modelCalls !== 0 || value.execution?.toolCalls !== 0 || value.execution?.persisted !== false ||
        !HASH_PATTERN.test(String(value.receipt?.sourceSnapshotSha256 || "")) ||
        !HASH_PATTERN.test(String(value.receipt?.previewSha256 || ""))) {
      throw uiError("服务器返回的多视角对照边界无效。", "MULTI_PERSPECTIVE_RESPONSE_INVALID");
    }
    const perspectives = normalizeArray(value.perspectives, 13, normalizePerspective, "perspectives");
    const ids = new Set();
    perspectives.forEach((item) => {
      if (ids.has(item.id)) throw uiError("多视角对照包含重复视角。", "MULTI_PERSPECTIVE_RESPONSE_INVALID");
      ids.add(item.id);
    });
    const comparisonClaims = normalizeArray(value.comparisonClaims, 20, normalizeClaim, "comparisonClaims");
    const editHistory = normalizeArray(value.editHistory, 8, normalizeRevision, "editHistory");
    const summary = normalizeSummary(value.summary);
    const timeContext = normalizeTimeContext(value.timeContext);
    return deepFreeze({
      format: FORMAT,
      version: VERSION,
      synthetic: value.synthetic === true,
      target: { type: "memory", id: expectedMemoryId, title: boundedText(value.target.title, 160) || "未命名记忆" },
      summary,
      perspectives,
      perspectivesTruncated: value.perspectivesTruncated === true,
      comparisonClaims,
      comparisonClaimsTruncated: value.comparisonClaimsTruncated === true,
      editHistory,
      editHistoryTruncated: value.editHistoryTruncated === true,
      timeContext,
      receipt: {
        sourceSnapshotSha256: value.receipt.sourceSnapshotSha256,
        previewSha256: value.receipt.previewSha256
      },
      execution: { ...value.execution }
    });
  }

  function normalizePerspective(item) {
    if (!plainObject(item) || !/^perspective-(?:current|reply-\d{2})$/u.test(String(item.id || "")) ||
        !["owner_current", "co_memory_response"].includes(item.kind)) {
      throw uiError("视角卡格式无效。", "MULTI_PERSPECTIVE_RESPONSE_INVALID");
    }
    const reply = item.kind === "co_memory_response";
    if (reply && (item.identity?.assurance !== "self-asserted-unverified" || item.identity?.verified !== false ||
        item.identity?.signed !== false || item.identity?.encryptedTransport !== true)) {
      throw uiError("亲友回信身份边界无效。", "MULTI_PERSPECTIVE_RESPONSE_INVALID");
    }
    return {
      id: item.id,
      kind: item.kind,
      label: boundedText(item.label, 120) || (reply ? "未署名共忆回信" : "我的当前记录"),
      question: boundedText(item.question, 500),
      questionTruncated: item.questionTruncated === true,
      excerpt: boundedText(item.excerpt, 800) || "未保留可预览文字",
      excerptTruncated: item.excerptTruncated === true,
      relationState: item.relationState === "linked-by-confirmed-provenance" ? item.relationState : "unlinked",
      identity: {
        assurance: String(item.identity?.assurance || ""),
        verified: reply ? false : null,
        signed: reply ? false : null,
        encryptedTransport: reply,
        boundary: boundedText(item.identity?.boundary, 240) || (reply ? "称呼来自回信人自述，身份未核验，文件未签名。" : "馆主当前记录。")
      }
    };
  }

  function normalizeClaim(item) {
    if (!plainObject(item) || !/^comparison-\d{2}$/u.test(String(item.id || "")) ||
        !["confirmed", "needsReview"].includes(item.status)) {
      throw uiError("来源关系格式无效。", "MULTI_PERSPECTIVE_RESPONSE_INVALID");
    }
    return {
      id: item.id,
      statement: boundedText(item.statement, 1000) || "未命名来源主张",
      needsReview: item.needsReview === true,
      boundary: boundedText(item.boundary, 240),
      sources: normalizeArray(item.sources, 8, (source) => {
        if (!plainObject(source) || !RELATIONS.has(source.relationKind) || !INTEGRITY.has(source.integrityStatus)) {
          throw uiError("来源关系包含未支持的标签。", "MULTI_PERSPECTIVE_RESPONSE_INVALID");
        }
        return {
          kind: boundedText(source.kind, 40),
          relationKind: source.relationKind,
          relationLabel: boundedText(source.relationLabel, 80),
          label: boundedText(source.label, 120),
          excerpt: boundedText(source.excerpt, 800),
          integrityStatus: source.integrityStatus,
          perspectiveId: /^perspective-(?:current|reply-\d{2})$/u.test(String(source.perspectiveId || "")) ? source.perspectiveId : ""
        };
      }, "claim.sources")
    };
  }

  function normalizeRevision(item) {
    if (!plainObject(item) || !/^edit-\d{2}$/u.test(String(item.id || "")) || item.kind !== "owner_revision" ||
        item.authorBoundary !== "same-owner-edit-history") {
      throw uiError("编辑年轮格式无效。", "MULTI_PERSPECTIVE_RESPONSE_INVALID");
    }
    return {
      id: item.id,
      kind: item.kind,
      revisionNo: positiveInteger(item.revisionNo),
      changeKind: boundedText(item.changeKind, 40),
      title: boundedText(item.title, 160) || "未命名记忆",
      date: boundedText(item.date, 40),
      excerpt: boundedText(item.excerpt, 800),
      authorBoundary: item.authorBoundary
    };
  }

  function normalizeSummary(value) {
    if (!plainObject(value)) throw uiError("对照摘要无效。", "MULTI_PERSPECTIVE_RESPONSE_INVALID");
    return {
      perspectiveCount: count(value.perspectiveCount, 101),
      replyCount: count(value.replyCount, 100),
      linkedReplyCount: count(value.linkedReplyCount, 100),
      unlinkedReplyCount: count(value.unlinkedReplyCount, 100),
      claimCount: count(value.claimCount, 100),
      revisionCount: count(value.revisionCount, 10_000),
      needsReviewCount: count(value.needsReviewCount, 100)
    };
  }

  function normalizeTimeContext(value) {
    if (!plainObject(value)) throw uiError("时间判断格式无效。", "MULTI_PERSPECTIVE_RESPONSE_INVALID");
    const calibration = plainObject(value.calibration) ? {
      targetType: ["memory", "event"].includes(value.calibration.targetType) ? value.calibration.targetType : "memory",
      resolutionKind: ["year", "month", "day", "range", "alternatives", "uncertain"].includes(value.calibration.resolutionKind)
        ? value.calibration.resolutionKind
        : "uncertain",
      intervalStart: boundedText(value.calibration.intervalStart, 20),
      intervalEnd: boundedText(value.calibration.intervalEnd, 20),
      selectedSourceCount: count(value.calibration.selectedSourceCount, 100)
    } : null;
    return {
      memoryDate: boundedText(value.memoryDate, 40),
      calibration,
      needsReview: value.needsReview === true && Boolean(calibration),
      boundary: boundedText(value.boundary, 240) || "这里只显示你保存的时间判断；不会改写原文或展品日期。"
    };
  }

  function normalizeArray(value, maximum, mapper, label) {
    if (!Array.isArray(value) || value.length > maximum) throw uiError(`${label} 超出安全边界。`, "MULTI_PERSPECTIVE_RESPONSE_INVALID");
    const output = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) throw uiError(`${label} 不是连续列表。`, "MULTI_PERSPECTIVE_RESPONSE_INVALID");
      output.push(mapper(value[index], index));
    }
    return output;
  }

  function count(value, maximum) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0 || number > maximum) {
      throw uiError("对照计数无效。", "MULTI_PERSPECTIVE_RESPONSE_INVALID");
    }
    return number;
  }

  function positiveInteger(value) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 1) throw uiError("年轮序号无效。", "MULTI_PERSPECTIVE_RESPONSE_INVALID");
    return number;
  }

  function element(documentRef, tag, className) {
    const node = documentRef.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function safeId(value) {
    const id = String(value || "");
    return ID_PATTERN.test(id) ? id : "";
  }

  function boundedText(value, maximum) {
    return [...String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, " ").trim()]
      .slice(0, maximum).join("");
  }

  function plainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
      [Object.prototype, null].includes(Object.getPrototypeOf(value));
  }

  function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
    return value;
  }

  function uiError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  return Object.freeze({ createController, normalizePreview, renderPanel });
}));
