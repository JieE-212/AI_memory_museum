(function initializeTimeIsleSharePrivacy(root, factory) {
  "use strict";
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.TimeIsleSharePrivacy = api;
})(typeof globalThis !== "undefined" ? globalThis : self, function createSharePrivacyModule(host) {
  "use strict";

  const FORMAT = "time-isle.offline-exhibit";
  const LEGACY_VERSION = 1;
  const VERSION = 2;
  const DEFAULT_PUBLIC_TITLE = "时屿加密分享";
  const DEFAULT_PUBLIC_NOTE = "这是一份口令加密的离线展览。";
  const DEFAULT_FILE_TITLE = "time-isle-private-share";
  const IMMEDIATE_OPEN_SENTINEL = "1970-01-01T00:00:00.000Z";
  const RECEIPT_BOUNDARY = "下载后无法撤回；知道口令的人仍可以复制、转发或截图。";
  const DEFAULT_IDS = Object.freeze({
    panel: "sharePrivacyPanel",
    heading: "sharePrivacyTitle",
    form: "sharePrivacyForm",
    status: "sharePrivacyStatus",
    publicTitle: "sharePublicTitle",
    publicNote: "sharePublicNote",
    fileTitle: "shareFileTitle",
    audience: "shareAudience",
    purpose: "sharePurpose",
    exhibitTitle: "shareExhibitTitle",
    exhibitTheme: "shareExhibitTheme",
    exhibitOpening: "shareExhibitOpening",
    content: "sharePrivacyContent",
    receipt: "shareReceiptPreview",
    acknowledge: "sharePrivacyAcknowledge",
    confirm: "sharePrivacyConfirm",
    cancel: "sharePrivacyCancel"
  });

  function normalizeSourceSnapshot(value = {}) {
    const source = isPlainObject(value) ? value : {};
    let itemNumber = 0;
    return {
      format: FORMAT,
      version: LEGACY_VERSION,
      title: text(source.title),
      theme: text(source.theme),
      opening: text(source.opening),
      sections: array(source.sections).map((section, sectionIndex) => ({
        key: `section-${sectionIndex + 1}`,
        title: text(section?.title),
        summary: text(section?.summary),
        items: array(section?.items).map((item) => {
          itemNumber += 1;
          const hasConfirmedQuotes = Array.isArray(item?.confirmedQuotes);
          const quoteSource = item?.confirmedQuotes || item?.citations || [];
          const hasConfirmedTranscripts = Array.isArray(item?.confirmedTranscripts) || item?.confirmedTranscript !== undefined;
          const transcriptSource = item?.confirmedTranscripts || (item?.confirmedTranscript ? [item.confirmedTranscript] : item?.transcripts || []);
          return {
            key: `item-${itemNumber}`,
            title: text(item?.title),
            excerpt: text(item?.excerpt),
            curatorNote: text(item?.curatorNote),
            confirmedQuotes: array(quoteSource)
              .filter((quote) => hasConfirmedQuotes || quote?.evidenceValid === true)
              .map((quote) => text(typeof quote === "string" ? quote : quote?.quote || quote?.text))
              .filter(Boolean),
            confirmedTranscripts: array(transcriptSource)
              .filter((transcript) => hasConfirmedTranscripts || (isPlainObject(transcript) && (transcript.status === "confirmed" || transcript.confirmed === true)))
              .map((transcript) => text(typeof transcript === "string" ? transcript : transcript?.text))
              .filter(Boolean),
            mediaKeys: []
          };
        })
      }))
    };
  }

  function assembleLegacyPayload(snapshotValue, packedMediaValue) {
    const snapshot = normalizeSourceSnapshot(snapshotValue);
    const itemKeys = new Set(snapshot.sections.flatMap((section) => section.items.map((item) => item.key)));
    const media = array(packedMediaValue).map((item, index) => {
      const itemKey = safeAnonymousKey(item?.itemKey);
      const width = positiveInteger(item?.width);
      const height = positiveInteger(item?.height);
      const byteSize = positiveInteger(item?.byteSize);
      const dataBase64 = text(item?.dataBase64);
      if (!itemKey || !itemKeys.has(itemKey) || item?.mimeType !== "image/webp" || !width || !height || !byteSize || !dataBase64) {
        throw new Error("离线展览包含无效的安全展示图。");
      }
      return {
        key: `media-${index + 1}`,
        itemKey,
        caption: text(item?.caption),
        alt: text(item?.alt || item?.altText),
        mimeType: "image/webp",
        width,
        height,
        byteSize,
        dataBase64
      };
    });
    const mediaKeysByItem = new Map();
    media.forEach((entry) => {
      const keys = mediaKeysByItem.get(entry.itemKey) || [];
      keys.push(entry.key);
      mediaKeysByItem.set(entry.itemKey, keys);
    });
    snapshot.sections.forEach((section) => section.items.forEach((item) => {
      item.mediaKeys = mediaKeysByItem.get(item.key) || [];
    }));
    return { ...snapshot, media };
  }

  function createShareDraft(input = {}) {
    const legacy = input?.payload
      ? normalizeLegacyPayload(input.payload)
      : assembleLegacyPayload(input?.snapshot, input?.media);
    const mediaByKey = new Map(legacy.media.map((entry) => [entry.key, entry]));
    return {
      publicTitle: DEFAULT_PUBLIC_TITLE,
      publicNote: DEFAULT_PUBLIC_NOTE,
      fileTitle: DEFAULT_FILE_TITLE,
      audience: "",
      purpose: "",
      title: legacy.title || "一场记忆展览",
      theme: legacy.theme,
      opening: legacy.opening,
      acknowledged: false,
      sections: legacy.sections.map((section) => ({
        selected: false,
        title: section.title || "未命名章节",
        summary: section.summary,
        items: section.items.map((item) => ({
          selected: false,
          title: item.title || "未命名展项",
          excerpt: item.excerpt,
          curatorNote: item.curatorNote,
          quotes: item.confirmedQuotes.map((value) => ({ selected: false, value })),
          transcripts: item.confirmedTranscripts.map((value) => ({ selected: false, value })),
          media: item.mediaKeys.map((key) => mediaByKey.get(key)).filter(Boolean).map((value) => ({ selected: false, value }))
        }))
      }))
    };
  }

  function projectSharePayload(draft) {
    if (!isPlainObject(draft)) throw reviewError("分享草稿无效。", "SHARE_DRAFT_INVALID");
    const audience = requireNarrative(draft.audience, "请填写这次分享给谁看。", 1, 120);
    const purpose = requireNarrative(draft.purpose, "请填写这次分享的用途。", 1, 240);
    const payload = {
      format: FORMAT,
      version: VERSION,
      title: requireNarrative(draft.title, "加密展览需要一个标题。", 1, 120),
      theme: requireNarrative(draft.theme, "展览主题过长。", 0, 120),
      opening: requireNarrative(draft.opening, "展览开场过长。", 0, 1200),
      sections: [],
      media: [],
      shareReceipt: null
    };
    let itemNumber = 0;
    let mediaNumber = 0;
    let quoteCount = 0;
    let transcriptCount = 0;
    for (const sourceSection of array(draft.sections).filter((section) => section?.selected)) {
      const selectedItems = array(sourceSection.items).filter((item) => item?.selected);
      if (!selectedItems.length) continue;
      const section = {
        key: `section-${payload.sections.length + 1}`,
        title: requireNarrative(sourceSection.title, "已选择的章节需要标题。", 1, 120),
        summary: requireNarrative(sourceSection.summary, "章节摘要过长。", 0, 800),
        items: []
      };
      for (const sourceItem of selectedItems) {
        itemNumber += 1;
        const itemKey = `item-${itemNumber}`;
        const confirmedQuotes = array(sourceItem.quotes).filter((entry) => entry?.selected).map((entry) => requireEvidence(entry.value));
        const confirmedTranscripts = array(sourceItem.transcripts).filter((entry) => entry?.selected).map((entry) => requireEvidence(entry.value));
        quoteCount += confirmedQuotes.length;
        transcriptCount += confirmedTranscripts.length;
        const mediaKeys = [];
        for (const sourceMedia of array(sourceItem.media).filter((entry) => entry?.selected)) {
          const value = normalizePackedMedia(sourceMedia.value, itemKey, ++mediaNumber);
          payload.media.push(value);
          mediaKeys.push(value.key);
        }
        section.items.push({
          key: itemKey,
          title: requireNarrative(sourceItem.title, "已选择的展项需要标题。", 1, 120),
          excerpt: requireNarrative(sourceItem.excerpt, "展项摘录过长。", 0, 1200),
          curatorNote: requireNarrative(sourceItem.curatorNote, "策展说明过长。", 0, 1200),
          confirmedQuotes,
          confirmedTranscripts,
          mediaKeys
        });
      }
      payload.sections.push(section);
    }
    if (!payload.sections.length || !itemNumber) {
      throw reviewError("请至少选择 1 个章节和其中 1 件展品。", "SHARE_SELECTION_EMPTY");
    }
    if (quoteCount + transcriptCount < 1) {
      throw reviewError("请至少保留 1 条已确认引用或文字稿。", "SHARE_EVIDENCE_REQUIRED");
    }
    payload.shareReceipt = {
      audience,
      purpose,
      counts: {
        sections: payload.sections.length,
        items: itemNumber,
        quotes: quoteCount,
        transcripts: transcriptCount,
        media: payload.media.length
      },
      boundary: RECEIPT_BOUNDARY
    };
    return {
      payload,
      shell: {
        title: requirePublicText(draft.publicTitle, "公开标题", 1, 120),
        note: requirePublicText(draft.publicNote, "公开说明", 0, 240),
        opensAt: IMMEDIATE_OPEN_SENTINEL
      },
      fileTitle: safeFileTitle(draft.fileTitle)
    };
  }

  function createController(options = {}) {
    const documentRef = options.document || host.document;
    const elements = resolveElements(documentRef, { ...DEFAULT_IDS, ...(options.ids || {}) });
    if (!elements) return null;
    const onConfirm = typeof options.onConfirm === "function" ? options.onConfirm : () => {};
    const onDirty = typeof options.onDirty === "function" ? options.onDirty : () => {};
    const onCancel = typeof options.onCancel === "function" ? options.onCancel : () => {};
    let draft = null;
    let confirmed = false;
    let returnFocus = null;
    let destroyed = false;

    elements.form.addEventListener("input", handleEdit);
    elements.form.addEventListener("change", handleEdit);
    elements.form.addEventListener("submit", handleSubmit);
    elements.cancel.addEventListener("click", handleCancel);

    function begin(input, trigger) {
      if (destroyed) return null;
      clear(false);
      draft = createShareDraft(input);
      returnFocus = trigger?.isConnected ? trigger : null;
      populateStaticFields();
      renderContent();
      renderReceipt();
      elements.panel.hidden = false;
      elements.panel.open = true;
      setStatus("素材已经在浏览器内读取完成；请逐项决定这次真正分享什么。");
      host.requestAnimationFrame?.(() => elements.heading.focus({ preventScroll: true }));
      return cloneJson(draft);
    }

    function populateStaticFields() {
      elements.publicTitle.value = draft.publicTitle;
      elements.publicNote.value = draft.publicNote;
      elements.fileTitle.value = draft.fileTitle;
      elements.audience.value = draft.audience;
      elements.purpose.value = draft.purpose;
      elements.exhibitTitle.value = draft.title;
      elements.exhibitTheme.value = draft.theme;
      elements.exhibitOpening.value = draft.opening;
      elements.acknowledge.checked = false;
    }

    function handleEdit(event) {
      if (!draft || destroyed) return;
      const target = event.target;
      if (target === elements.acknowledge) {
        draft.acknowledged = target.checked;
        if (!target.checked) markDirty();
        return;
      }
      updateDraft(target);
      markDirty();
      if (target.matches("[data-share-select]")) renderContent(target.id);
      renderReceipt();
    }

    function updateDraft(target) {
      const staticField = new Map([
        [elements.publicTitle, "publicTitle"], [elements.publicNote, "publicNote"],
        [elements.fileTitle, "fileTitle"], [elements.audience, "audience"],
        [elements.purpose, "purpose"], [elements.exhibitTitle, "title"],
        [elements.exhibitTheme, "theme"], [elements.exhibitOpening, "opening"]
      ]).get(target);
      if (staticField) return void (draft[staticField] = target.value);
      const sectionIndex = numberIndex(target.dataset.shareSection);
      if (sectionIndex < 0 || !draft.sections[sectionIndex]) return;
      const section = draft.sections[sectionIndex];
      const itemIndex = numberIndex(target.dataset.shareItem);
      if (target.dataset.shareSelect === "section") {
        section.selected = target.checked;
        if (!target.checked) section.items.forEach(clearItemSelections);
        return;
      }
      if (itemIndex < 0 || !section.items[itemIndex]) {
        if (target.dataset.shareField) section[target.dataset.shareField] = target.value;
        return;
      }
      const item = section.items[itemIndex];
      if (target.dataset.shareSelect === "item") {
        item.selected = target.checked;
        if (!target.checked) clearItemSelections(item);
        return;
      }
      if (target.dataset.shareField) return void (item[target.dataset.shareField] = target.value);
      const evidenceIndex = numberIndex(target.dataset.shareEvidence);
      const kind = target.dataset.shareKind;
      const list = kind === "quote" ? item.quotes : kind === "transcript" ? item.transcripts : kind === "media" ? item.media : null;
      if (list?.[evidenceIndex]) list[evidenceIndex].selected = target.checked;
    }

    function clearItemSelections(item) {
      item.selected = false;
      [...item.quotes, ...item.transcripts, ...item.media].forEach((entry) => { entry.selected = false; });
    }

    function markDirty() {
      const wasConfirmed = confirmed;
      confirmed = false;
      draft.acknowledged = false;
      elements.acknowledge.checked = false;
      if (wasConfirmed) setStatus("内容已变更；请重新核对并确认。", false);
      onDirty();
    }

    function renderContent(focusId) {
      if (!draft) return;
      elements.content.innerHTML = draft.sections.map((section, sectionIndex) => renderSection(section, sectionIndex)).join("");
      if (focusId) host.requestAnimationFrame?.(() => documentRef.getElementById(focusId)?.focus({ preventScroll: true }));
    }

    function renderSection(section, sectionIndex) {
      const sectionId = `share-section-${sectionIndex}`;
      return `<article class="share-review-section${section.selected ? " is-selected" : ""}">
        <label class="share-review-select" for="${sectionId}"><input id="${sectionId}" type="checkbox" data-share-select="section" data-share-section="${sectionIndex}"${section.selected ? " checked" : ""}><span><strong>加入这个章节</strong><small>章节被加入后，仍需逐件选择展品。</small></span></label>
        <div class="share-review-fields">
          ${textarea("章节标题", section.title, sectionIndex, -1, "title", 120, !section.selected)}
          ${textarea("章节摘要", section.summary, sectionIndex, -1, "summary", 800, !section.selected)}
        </div>
        <div class="share-review-items">${section.items.map((item, itemIndex) => renderItem(item, sectionIndex, itemIndex, section.selected)).join("")}</div>
      </article>`;
    }

    function renderItem(item, sectionIndex, itemIndex, sectionSelected) {
      const enabled = sectionSelected && item.selected;
      const itemId = `share-item-${sectionIndex}-${itemIndex}`;
      return `<article class="share-review-item${enabled ? " is-selected" : ""}">
        <label class="share-review-select" for="${itemId}"><input id="${itemId}" type="checkbox" data-share-select="item" data-share-section="${sectionIndex}" data-share-item="${itemIndex}"${item.selected ? " checked" : ""}${sectionSelected ? "" : " disabled"}><span><strong>加入这件展品</strong><small>确认用于展览，不等于同意分享。</small></span></label>
        <div class="share-review-fields">
          ${textarea("展项标题", item.title, sectionIndex, itemIndex, "title", 120, !enabled)}
          ${textarea("展项摘录", item.excerpt, sectionIndex, itemIndex, "excerpt", 1200, !enabled)}
          ${textarea("策展说明", item.curatorNote, sectionIndex, itemIndex, "curatorNote", 1200, !enabled)}
        </div>
        ${renderEvidence("已确认原文引用", item.quotes, "quote", sectionIndex, itemIndex, enabled)}
        ${renderEvidence("已确认声音文字稿", item.transcripts, "transcript", sectionIndex, itemIndex, enabled)}
        ${renderMedia(item.media, sectionIndex, itemIndex, enabled)}
      </article>`;
    }

    function renderEvidence(label, entries, kind, sectionIndex, itemIndex, enabled) {
      if (!entries.length) return `<p class="share-review-empty">没有可选${escapeHtml(label)}。</p>`;
      return `<fieldset class="share-review-evidence"><legend>${escapeHtml(label)}</legend>${entries.map((entry, evidenceIndex) => `
        <label><input type="checkbox" data-share-kind="${kind}" data-share-section="${sectionIndex}" data-share-item="${itemIndex}" data-share-evidence="${evidenceIndex}"${entry.selected ? " checked" : ""}${enabled ? "" : " disabled"}><span>${escapeHtml(entry.value)}</span></label>`).join("")}</fieldset>`;
    }

    function renderMedia(entries, sectionIndex, itemIndex, enabled) {
      if (!entries.length) return '<p class="share-review-empty">没有带入编辑台的安全展示图。</p>';
      return `<fieldset class="share-review-evidence share-review-media"><legend>安全展示图</legend>${entries.map((entry, evidenceIndex) => {
        const media = entry.value;
        return `<label><input type="checkbox" data-share-kind="media" data-share-section="${sectionIndex}" data-share-item="${itemIndex}" data-share-evidence="${evidenceIndex}"${entry.selected ? " checked" : ""}${enabled ? "" : " disabled"}><span><img src="data:image/webp;base64,${escapeHtml(media.dataBase64)}" alt="${escapeHtml(media.alt)}"><strong>${escapeHtml(media.caption || "安全展示图")}</strong><small>${media.width} × ${media.height} · 仅保留或移除</small></span></label>`;
      }).join("")}</fieldset>`;
    }

    function renderReceipt() {
      if (!draft) return;
      const counts = draftCounts(draft);
      elements.receipt.innerHTML = `<section><strong>无需口令即可看到</strong><p>${escapeHtml(draft.publicTitle || "（未填写公开标题）")}</p><small>${escapeHtml(draft.publicNote || "没有公开说明")} · 立即可打开</small></section>
        <section><strong>输入口令后才能看到</strong><p>${counts.sections} 章 · ${counts.items} 件展品 · ${counts.quotes} 条引用 · ${counts.transcripts} 份文字稿 · ${counts.media} 张展示图</p><small>受众：${escapeHtml(draft.audience || "尚未填写")} · 用途：${escapeHtml(draft.purpose || "尚未填写")}</small></section>
        <section><strong>始终不会加入</strong><p>原图、EXIF/GPS、原始音频、草稿、Agent 日志、内部 ID、URL、SHA 与未选择原文。</p><small>${escapeHtml(RECEIPT_BOUNDARY)}</small></section>`;
    }

    function handleSubmit(event) {
      event.preventDefault();
      if (!draft || destroyed) return;
      if (!elements.acknowledge.checked) {
        setStatus("请先确认已逐项核对三层清单。", true);
        elements.acknowledge.focus();
        return;
      }
      try {
        const result = projectSharePayload(draft);
        confirmed = true;
        draft.acknowledged = true;
        setStatus("内容已确认；现在进入口令步骤不会再发送网络请求。", false, true);
        onConfirm(result);
      } catch (error) {
        confirmed = false;
        setStatus(error.message, true);
        elements.content.focus({ preventScroll: true });
      }
    }

    function handleCancel() {
      if (!draft || destroyed) return;
      const target = returnFocus;
      clear(false);
      onCancel();
      host.requestAnimationFrame?.(() => target?.isConnected && target.focus({ preventScroll: true }));
    }

    function clear(restoreFocus = false) {
      const target = returnFocus;
      draft = null;
      confirmed = false;
      returnFocus = null;
      elements.form.reset();
      elements.content.replaceChildren();
      elements.receipt.replaceChildren();
      elements.panel.open = false;
      elements.panel.hidden = true;
      setStatus("");
      if (restoreFocus) host.requestAnimationFrame?.(() => target?.isConnected && target.focus({ preventScroll: true }));
    }

    function setStatus(value, error = false, success = false) {
      elements.status.textContent = value;
      elements.status.classList.toggle("is-error", error);
      elements.status.classList.toggle("is-success", success);
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      clear(false);
      elements.form.removeEventListener("input", handleEdit);
      elements.form.removeEventListener("change", handleEdit);
      elements.form.removeEventListener("submit", handleSubmit);
      elements.cancel.removeEventListener("click", handleCancel);
    }

    return Object.freeze({ begin, clear, destroy, getDraft: () => draft ? cloneJson(draft) : null, isConfirmed: () => confirmed });
  }

  function normalizeLegacyPayload(value) {
    if (!isPlainObject(value) || value.format !== FORMAT || value.version !== LEGACY_VERSION || !Array.isArray(value.sections) || !Array.isArray(value.media)) {
      throw new Error("分享素材不是受支持的离线展览。");
    }
    return assembleLegacyPayload(value, value.media);
  }

  function normalizePackedMedia(value, itemKey, sequence) {
    if (!isPlainObject(value) || value.mimeType !== "image/webp") throw reviewError("安全展示图无效。", "SHARE_MEDIA_INVALID");
    const width = positiveInteger(value.width), height = positiveInteger(value.height), byteSize = positiveInteger(value.byteSize);
    const dataBase64 = text(value.dataBase64);
    if (!width || !height || !byteSize || !dataBase64) throw reviewError("安全展示图无效。", "SHARE_MEDIA_INVALID");
    return {
      key: `media-${sequence}`,
      itemKey,
      caption: requireNarrative(value.caption, "图片说明过长。", 0, 500),
      alt: requireNarrative(value.alt, "图片替代文字过长。", 0, 500),
      mimeType: "image/webp",
      width,
      height,
      byteSize,
      dataBase64
    };
  }

  function draftCounts(draft) {
    let sections = 0, items = 0, quotes = 0, transcripts = 0, media = 0;
    for (const section of array(draft.sections).filter((entry) => entry?.selected)) {
      const selectedItems = array(section.items).filter((entry) => entry?.selected);
      if (!selectedItems.length) continue;
      sections += 1;
      items += selectedItems.length;
      for (const item of selectedItems) {
        quotes += array(item.quotes).filter((entry) => entry?.selected).length;
        transcripts += array(item.transcripts).filter((entry) => entry?.selected).length;
        media += array(item.media).filter((entry) => entry?.selected).length;
      }
    }
    return { sections, items, quotes, transcripts, media };
  }

  function textarea(label, value, sectionIndex, itemIndex, field, maxlength, disabled) {
    const item = itemIndex >= 0 ? ` data-share-item="${itemIndex}"` : "";
    return `<label><span>${escapeHtml(label)}</span><textarea maxlength="${maxlength}" data-share-section="${sectionIndex}"${item} data-share-field="${field}"${disabled ? " disabled" : ""}>${escapeHtml(value)}</textarea></label>`;
  }

  function requireNarrative(value, message, minimum, maximum) {
    const result = text(value).replace(/\r\n?/gu, "\n").trim();
    if (Array.from(result).length < minimum || Array.from(result).length > maximum || hasControl(result)) throw reviewError(message, "SHARE_TEXT_INVALID");
    return result;
  }

  function requireEvidence(value) {
    return requireNarrative(value, "已确认引用或文字稿无效。", 1, 4000);
  }

  function requirePublicText(value, label, minimum, maximum) {
    const result = text(value).replace(/\s+/gu, " ").trim();
    if (Array.from(result).length < minimum || Array.from(result).length > maximum || hasControl(result)) {
      throw reviewError(`${label}无效。`, "SHARE_SHELL_INVALID");
    }
    return result;
  }

  function safeFileTitle(value) {
    const normalized = text(value || DEFAULT_FILE_TITLE).normalize("NFKC").replace(/\.html$/iu, "")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "-").replace(/\s+/gu, "-").replace(/-+/gu, "-").replace(/^[.-]+|[.-]+$/gu, "");
    const result = Array.from(normalized).slice(0, 80).join("");
    return result || DEFAULT_FILE_TITLE;
  }

  function safeAnonymousKey(value) {
    const key = text(value).trim();
    return /^(?:section|item|media)-[a-zA-Z0-9_-]{1,80}$/u.test(key) ? key : "";
  }

  function positiveInteger(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : 0;
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

  function numberIndex(value) {
    return /^\d+$/u.test(String(value ?? "")) ? Number(value) : -1;
  }

  function array(value) { return Array.isArray(value) ? value : []; }
  function text(value) { return String(value ?? ""); }
  function isPlainObject(value) { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
  function hasControl(value) { return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value); }
  function cloneJson(value) { return JSON.parse(JSON.stringify(value)); }
  function reviewError(message, code) { const error = new Error(message); error.code = code; return error; }
  function escapeHtml(value) {
    return text(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }

  return Object.freeze({
    DEFAULT_FILE_TITLE,
    DEFAULT_PUBLIC_NOTE,
    DEFAULT_PUBLIC_TITLE,
    FORMAT,
    IMMEDIATE_OPEN_SENTINEL,
    LEGACY_VERSION,
    RECEIPT_BOUNDARY,
    VERSION,
    assembleLegacyPayload,
    createController,
    createShareDraft,
    normalizeSourceSnapshot,
    projectSharePayload
  });
});
