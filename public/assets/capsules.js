(function initTimeIsleCapsules(global) {
  "use strict";

  const MAX_IMAGES = 24;
  const MAX_PLAINTEXT_BYTES = 32 * 1024 * 1024;
  const MIN_PASSPHRASE = 12;
  const ID_PATTERN = /^[a-zA-Z0-9_-]{1,120}$/u;
  const DEFAULT_IDS = Object.freeze({
    studioButton: "capsuleStudioButton",
    dialog: "capsuleDialog",
    dialogTitle: "capsuleDialogTitle",
    status: "capsuleStatus",
    shelf: "capsuleShelf",
    reader: "capsuleReader",
    createPanel: "capsuleCreatePanel",
    form: "capsuleForm",
    exhibitionSelect: "capsuleExhibitionSelect",
    candidateStatus: "capsuleCandidateStatus",
    candidateList: "capsuleCandidateList",
    title: "capsuleTitle",
    shellMessage: "capsuleShellMessage",
    opensOn: "capsuleOpensOn",
    timezone: "capsuleTimezone",
    sealButton: "capsuleSealButton",
    prepareExportButton: "capsulePrepareExportButton",
    exportPanel: "capsuleExportPanel",
    exportTitle: "capsuleExportTitle",
    passphrase: "capsulePassphrase",
    passphraseConfirm: "capsulePassphraseConfirm",
    downloadButton: "capsuleDownloadButton",
    cancelExportButton: "capsuleCancelExportButton"
  });

  function createController(options = {}) {
    const documentRef = options.document || global.document;
    const fetchImpl = options.fetch || global.fetch?.bind(global);
    const cryptoModule = options.cryptoModule || global.TimeIsleCapsuleCrypto;
    const elements = resolveElements(documentRef, options.ids || DEFAULT_IDS);
    if (!documentRef || typeof fetchImpl !== "function" || !elements || !cryptoModule) return null;

    let demo = Boolean(options.demo);
    let destroyed = false;
    let session = 0;
    let busy = false;
    let lastTrigger = null;
    let capsules = [];
    let exhibitions = [];
    let candidates = { media: [], transcripts: [] };
    let openedMaterial = null;
    let preparedMaterial = null;
    let readerReturnTarget = null;
    let materialRead = null;
    const requests = new Map();
    const listeners = [];

    initializeFields();
    bindEvents();
    renderShelf();
    renderCandidates();
    renderAccess();

    function initializeFields() {
      elements.timezone.value = resolvedTimezone();
      elements.opensOn.min = tomorrowIso();
      if (!elements.opensOn.value) elements.opensOn.value = tomorrowIso();
    }

    function bindEvents() {
      listen(elements.studioButton, "click", () => open(elements.studioButton));
      listen(elements.dialog, "click", handleDialogClick);
      listen(elements.dialog, "cancel", (event) => { event.preventDefault(); closeDialog(); });
      listen(elements.dialog, "close", handleDialogClose);
      listen(elements.exhibitionSelect, "change", handleExhibitionChange);
      listen(elements.form, "submit", sealCapsule);
      listen(elements.prepareExportButton, "click", prepareExhibitionExport);
      listen(elements.downloadButton, "click", downloadPreparedExhibit);
      listen(elements.cancelExportButton, "click", cancelPreparedExport);
    }

    function listen(target, type, handler, listenerOptions) {
      if (!target?.addEventListener) return;
      target.addEventListener(type, handler, listenerOptions);
      listeners.push({ target, type, handler, listenerOptions });
    }

    async function open(trigger) {
      if (destroyed || busy) return;
      lastTrigger = trigger || elements.studioButton;
      clearReader();
      clearPreparedExport();
      if (!elements.dialog.open) elements.dialog.showModal();
      global.requestAnimationFrame?.(() => elements.dialogTitle.focus({ preventScroll: true }));
      await loadWorkspace();
    }

    async function loadWorkspace() {
      const run = startSession();
      setBusy(true);
      setStatus("正在读取胶囊外壳与已确认展览…");
      try {
        const [capsulePayload, exhibitionPayload] = await Promise.all([
          requestJson("capsules", "/api/capsules", {}, run),
          requestJson("exhibitions", "/api/exhibitions?status=published&limit=200", {}, run)
        ]);
        if (!isCurrent(run)) return;
        capsules = normalizeCapsules(capsulePayload?.capsules || capsulePayload);
        exhibitions = normalizeExhibitions(exhibitionPayload?.exhibitions || exhibitionPayload);
        renderShelf();
        renderExhibitionOptions();
        setStatus(workspaceStatus());
      } catch (error) {
        if (!isExpectedCancellation(error)) setStatus(`读取失败：${message(error)}`, true);
      } finally {
        if (isCurrent(run)) setBusy(false);
      }
    }

    async function handleExhibitionChange() {
      clearPreparedExport();
      candidates = { media: [], transcripts: [] };
      renderCandidates();
      const exhibitionId = safeId(elements.exhibitionSelect.value);
      if (!exhibitionId) {
        elements.candidateStatus.textContent = "选择展览后，再决定哪些安全素材可以进入胶囊或分享包。";
        return;
      }
      const selected = exhibitions.find((item) => item.id === exhibitionId);
      if (selected && !elements.title.value.trim()) elements.title.value = selected.title ? `留给未来的《${selected.title}》` : "留给未来的一场展览";
      const run = session;
      setBusy(true);
      elements.candidateStatus.textContent = "正在读取可安全选择的展示图与已确认文字稿…";
      try {
        const payload = await requestJson(
          "candidates",
          `/api/offline-exhibits/candidates?exhibitionId=${encodeURIComponent(exhibitionId)}`,
          {},
          run
        );
        if (!isCurrent(run)) return;
        candidates = normalizeCandidates(payload?.candidates || payload);
        renderCandidates();
        const total = candidates.media.length + candidates.transcripts.length;
        elements.candidateStatus.textContent = total
          ? `可选 ${candidates.media.length} 张安全展示图、${candidates.transcripts.length} 份已确认文字稿；默认均不加入。`
          : "这场展览没有额外安全素材；仍可封存或导出纯文字展览。";
      } catch (error) {
        if (!isExpectedCancellation(error)) elements.candidateStatus.textContent = `安全素材读取失败：${message(error)}`;
      } finally {
        if (isCurrent(run)) setBusy(false);
      }
    }

    async function sealCapsule(event) {
      event.preventDefault();
      if (destroyed || busy || demo) return;
      const exhibitionId = safeId(elements.exhibitionSelect.value);
      const title = String(elements.title.value || "").trim();
      const shellMessage = String(elements.shellMessage.value || "").trim();
      const opensOn = String(elements.opensOn.value || "").trim();
      const timezone = String(elements.timezone.value || "").trim();
      if (!exhibitionId || !title || !/^\d{4}-\d{2}-\d{2}$/u.test(opensOn) || !timezone) {
        setStatus("请先选择展览，并填写胶囊标题、开启日期与时区。", true);
        return;
      }
      if (opensOn < tomorrowIso()) {
        setStatus("胶囊开启日至少应是明天；如果想现在分享，请使用加密离线展览。", true);
        elements.opensOn.focus();
        return;
      }
      const selection = selectedCandidateIds();
      const run = session;
      setBusy(true);
      setStatus("正在封存安全快照…");
      try {
        const payload = await requestJson("seal", "/api/capsules", {
          method: "POST",
          body: JSON.stringify({
            exhibitionId,
            title,
            shellMessage,
            opensOn,
            timezone,
            mediaAssetIds: selection.mediaAssetIds,
            transcriptAssetIds: selection.transcriptAssetIds,
            confirm: true
          })
        }, run);
        const capsule = normalizeCapsule(payload?.capsule || payload);
        if (capsule.id) capsules = [capsule, ...capsules.filter((item) => item.id !== capsule.id)];
        renderShelf();
        elements.form.reset();
        initializeFields();
        candidates = { media: [], transcripts: [] };
        renderExhibitionOptions();
        renderCandidates();
        elements.createPanel.open = false;
        setStatus("胶囊已经封存；开启日前，接口只会返回外壳。", false, true);
        options.onChanged?.({ type: "created", capsule });
      } catch (error) {
        if (!isExpectedCancellation(error)) setStatus(`封存失败：${message(error)}`, true);
      } finally {
        if (isCurrent(run)) setBusy(false);
      }
    }

    async function prepareExhibitionExport() {
      if (destroyed || busy) return;
      const sourceId = safeId(elements.exhibitionSelect.value);
      if (!sourceId) {
        setStatus("请先选择一场已确认展览。", true);
        elements.exhibitionSelect.focus();
        return;
      }
      const selection = selectedCandidateIds();
      const run = session;
      clearPassphrases();
      setBusy(true);
      setStatus("正在准备已明确选择的安全素材；此阶段不会读取口令…");
      try {
        const response = await requestJson("material", "/api/offline-exhibits/material", {
          method: "POST",
          body: JSON.stringify({
            sourceType: "exhibition",
            sourceId,
            mediaAssetIds: selection.mediaAssetIds,
            transcriptAssetIds: selection.transcriptAssetIds,
            confirm: true
          })
        }, run);
        preparedMaterial = await hydrateMaterial(response?.material || response, run);
        showExportPanel();
        setStatus("安全素材已经读取完成；现在设置口令不会再发起网络请求。", false, true);
      } catch (error) {
        if (!isExpectedCancellation(error) && isCurrent(run)) {
          clearPreparedExport();
          setStatus(`准备失败：${message(error)}`, true);
        }
      } finally {
        if (isCurrent(run)) setBusy(false);
      }
    }

    async function prepareOpenedCapsuleExport(capsuleId) {
      if (destroyed || busy || !openedMaterial || openedMaterial.capsuleId !== capsuleId) return;
      const run = session;
      clearPassphrases();
      setBusy(true);
      setStatus("正在读取胶囊中已封存的安全展示图；此阶段不会读取口令…");
      try {
        preparedMaterial = await hydrateMaterial(openedMaterial.material, run);
        showExportPanel();
        setStatus("胶囊素材已经读取完成；现在设置口令不会再发起网络请求。", false, true);
      } catch (error) {
        if (!isExpectedCancellation(error) && isCurrent(run)) {
          clearPreparedExport();
          setStatus(`准备失败：${message(error)}`, true);
        }
      } finally {
        if (isCurrent(run)) setBusy(false);
      }
    }

    async function hydrateMaterial(value, run = session) {
      cancelMaterialRead();
      const controller = new AbortController();
      const token = Symbol("capsule-material");
      materialRead = { controller, token };
      const material = normalizeMaterial(value);
      const media = material.media;
      if (media.length > MAX_IMAGES) throw new Error(`一次最多导出 ${MAX_IMAGES} 张安全展示图。`);
      let totalBytes = utf8Bytes(JSON.stringify(material.snapshot));
      const packedMedia = [];
      for (const item of media) {
        const url = safeDisplayUrl(item.contentUrl);
        if (!url || item.mimeType !== "image/webp") throw new Error("分享素材包含非安全展示图地址或格式。");
        const response = await fetchImpl(url, { headers: { Accept: "image/webp" }, cache: "no-store", signal: controller.signal });
        assertCurrentMaterialRead(run, token);
        if (!response.ok) throw new Error(`安全展示图读取失败（${response.status}）。`);
        const mimeType = String(response.headers?.get?.("content-type") || item.mimeType).split(";")[0].trim().toLowerCase();
        if (mimeType !== "image/webp") throw new Error("安全展示图响应格式无效。");
        const bytes = new Uint8Array(await response.arrayBuffer());
        assertCurrentMaterialRead(run, token);
        if (!bytes.length || (item.byteSize && bytes.length !== item.byteSize)) throw new Error("安全展示图字节数与清单不一致。");
        const hash = await sha256Hex(bytes);
        if (item.sha256 && hash !== item.sha256) throw new Error("安全展示图完整性校验失败。");
        totalBytes += bytes.length;
        if (totalBytes > MAX_PLAINTEXT_BYTES) throw new Error("离线展览素材超过 32 MiB，请减少选择的图片。");
        packedMedia.push({
          key: `media-${packedMedia.length + 1}`,
          itemKey: item.itemKey,
          caption: item.caption,
          alt: item.altText,
          mimeType: "image/webp",
          width: item.width,
          height: item.height,
          byteSize: bytes.length,
          dataBase64: bytesToBase64(bytes)
        });
      }
      assertCurrentMaterialRead(run, token);
      const payload = assembleOfflinePayload(material.snapshot, packedMedia);
      const result = { payload, shell: material.shell, fileTitle: material.shell.title || material.snapshot.title || "时屿离线展览" };
      if (materialRead?.token === token) materialRead = null;
      return result;
    }

    function showExportPanel() {
      elements.exportPanel.hidden = false;
      global.requestAnimationFrame?.(() => elements.passphrase.focus({ preventScroll: true }));
    }

    async function downloadPreparedExhibit() {
      if (destroyed || busy || !preparedMaterial) return;
      const run = session;
      const passphrase = String(elements.passphrase.value || "");
      const confirmation = String(elements.passphraseConfirm.value || "");
      if (passphrase.length < MIN_PASSPHRASE) {
        setStatus(`口令至少需要 ${MIN_PASSPHRASE} 个字符。`, true);
        elements.passphrase.focus();
        return;
      }
      if (passphrase !== confirmation) {
        setStatus("两次输入的口令不一致。", true);
        elements.passphraseConfirm.focus();
        return;
      }
      setBusy(true);
      setStatus("正在浏览器内加密单文件展览…");
      try {
        const envelope = await encryptPrepared(preparedMaterial, passphrase);
        if (!isCurrent(run)) throw staleRequest;
        const html = createOfflineHtml(envelope);
        if (!isCurrent(run)) throw staleRequest;
        triggerDownload(html, `${safeFilename(preparedMaterial.fileTitle)}.html`);
        setStatus("加密离线展览已生成；请通过另一条安全渠道告知收件人口令。", false, true);
        clearPreparedExport();
      } catch (error) {
        if (!isExpectedCancellation(error) && isCurrent(run)) setStatus(`生成失败：${message(error)}`, true);
      } finally {
        if (isCurrent(run)) {
          clearPassphrases();
          setBusy(false);
        }
      }
    }

    async function encryptPrepared(prepared, passphrase) {
      if (typeof cryptoModule.encryptPayload === "function") {
        return cryptoModule.encryptPayload(prepared.payload, passphrase, toCryptoShell(prepared.shell, prepared.fileTitle));
      }
      if (typeof cryptoModule.encryptMaterial === "function") {
        return cryptoModule.encryptMaterial(prepared.payload, { passphrase, shell: toCryptoShell(prepared.shell, prepared.fileTitle) });
      }
      if (typeof cryptoModule.encrypt === "function") {
        return cryptoModule.encrypt(prepared.payload, passphrase, toCryptoShell(prepared.shell, prepared.fileTitle));
      }
      throw new Error("当前浏览器缺少时屿加密模块。");
    }

    function createOfflineHtml(envelope) {
      const create = cryptoModule.createOfflineHtml || cryptoModule.buildOfflineHtml || cryptoModule.renderOfflineHtml;
      if (typeof create !== "function") throw new Error("当前版本无法生成离线单文件。");
      return create(envelope);
    }

    function triggerDownload(html, filename) {
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const urlApi = options.URL || global.URL;
      const url = urlApi.createObjectURL(blob);
      const anchor = documentRef.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.rel = "noopener";
      documentRef.body.append(anchor);
      anchor.click();
      anchor.remove();
      global.setTimeout?.(() => urlApi.revokeObjectURL(url), 1500);
    }

    async function openCapsule(id, trigger) {
      const capsuleId = safeId(id);
      if (!capsuleId || busy) return;
      const shell = capsules.find((item) => item.id === capsuleId);
      if (shell?.needsReview) return setStatus("这枚胶囊的展示素材已变化，需要复核后才能再次开启。", true);
      if (!shell?.available) {
        setStatus("这枚胶囊还没有到开启日；当前只读取外壳。", false);
        return;
      }
      const run = session;
      setBusy(true);
      setStatus("正在开启胶囊…");
      try {
        const payload = await requestJson("capsule-content", `/api/capsules/${encodeURIComponent(capsuleId)}/content`, {}, run);
        const material = normalizeCapsuleContent(payload, shell);
        openedMaterial = { capsuleId, material };
        renderReader(shell, material, trigger);
        setStatus("胶囊已经到期并打开。日期是仪式门槛；加密分享仍需另设口令。", false, true);
      } catch (error) {
        if (!isExpectedCancellation(error)) setStatus(`打开失败：${message(error)}`, true);
      } finally {
        if (isCurrent(run)) setBusy(false);
      }
    }

    async function deleteCapsule(id, trigger) {
      const capsuleId = safeId(id);
      if (!capsuleId || busy || demo) return;
      const capsule = capsules.find((item) => item.id === capsuleId);
      if (!global.confirm?.(`确定删除胶囊《${capsule?.title || "未命名胶囊"}》吗？来源展览不会被删除。`)) return;
      const run = session;
      trigger?.setAttribute?.("aria-busy", "true");
      setBusy(true);
      setStatus("正在删除胶囊…");
      try {
        await requestJson("delete", `/api/capsules/${encodeURIComponent(capsuleId)}`, { method: "DELETE" }, run);
        capsules = capsules.filter((item) => item.id !== capsuleId);
        if (openedMaterial?.capsuleId === capsuleId) clearReader();
        renderShelf();
        setStatus("胶囊已删除；来源展览保持不变。", false, true);
        options.onChanged?.({ type: "deleted", id: capsuleId });
      } catch (error) {
        if (!isExpectedCancellation(error)) setStatus(`删除失败：${message(error)}`, true);
      } finally {
        trigger?.removeAttribute?.("aria-busy");
        if (isCurrent(run)) setBusy(false);
      }
    }

    function handleDialogClick(event) {
      if (event.target.closest("[data-capsule-close]")) {
        closeDialog();
        return;
      }
      const openButton = event.target.closest("[data-capsule-open]");
      if (openButton) {
        openCapsule(openButton.dataset.capsuleOpen, openButton);
        return;
      }
      const deleteButton = event.target.closest("[data-capsule-delete]");
      if (deleteButton) {
        deleteCapsule(deleteButton.dataset.capsuleDelete, deleteButton);
        return;
      }
      if (event.target.closest("[data-capsule-back]")) {
        const returnTarget = readerReturnTarget;
        clearReader();
        const focusTarget = returnTarget?.isConnected ? returnTarget : elements.shelf.querySelector("[data-capsule-open]");
        global.requestAnimationFrame?.(() => focusTarget?.focus({ preventScroll: true }));
        return;
      }
      const prepareButton = event.target.closest("[data-capsule-prepare-export]");
      if (prepareButton) prepareOpenedCapsuleExport(safeId(prepareButton.dataset.capsulePrepareExport));
    }

    function renderShelf() {
      const heading = '<div class="capsule-section-heading"><div><p class="eyebrow">Sealed memories</p><h3 id="capsuleShelfTitle">我的时光胶囊</h3></div></div>';
      if (!capsules.length) {
        elements.shelf.innerHTML = `${heading}<div class="capsule-empty"><strong>还没有时光胶囊</strong><span>从一场已确认展览开始，把愿意留下的内容封存到未来。</span></div>`;
        return;
      }
      elements.shelf.innerHTML = `${heading}<div class="capsule-shelf-list">${capsules.map((capsule) => {
        const canOpen = capsule.available && !capsule.needsReview;
        const stateLabel = capsule.needsReview ? "需要复核" : capsule.available ? "可以开启" : "尚未开启";
        return `
        <article class="capsule-card${canOpen ? "" : " is-locked"}">
          <div class="capsule-card-meta"><strong>${stateLabel}</strong><time datetime="${escapeHtml(capsule.opensOn)}">${escapeHtml(formatDate(capsule.opensOn))}</time></div>
          <h4>${escapeHtml(capsule.title || "未命名胶囊")}</h4>
          <p>${escapeHtml(capsule.shellMessage || "这枚胶囊把想说的话留给了开启的那一天。")}</p>
          <div class="capsule-card-actions">
            ${canOpen ? `<button type="button" class="button primary compact" data-capsule-open="${escapeHtml(capsule.id)}">打开胶囊</button>` : `<span class="capsule-countdown">${capsule.needsReview ? "展示素材变化后需复核" : "到期前只展示外壳"}</span>`}
            ${demo ? "" : `<button type="button" class="button text-button compact is-danger" data-capsule-delete="${escapeHtml(capsule.id)}" aria-label="删除胶囊《${escapeHtml(capsule.title || "未命名胶囊")}》">删除</button>`}
          </div>
        </article>`;
      }).join("")}</div>`;
    }

    function renderExhibitionOptions() {
      const selected = safeId(elements.exhibitionSelect.value);
      elements.exhibitionSelect.innerHTML = '<option value="">先选择一场已确认展览</option>' + exhibitions.map((item) => (
        `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title || item.theme || "未命名主题展览")}</option>`
      )).join("");
      if (selected && exhibitions.some((item) => item.id === selected)) elements.exhibitionSelect.value = selected;
    }

    function renderCandidates() {
      const renderGroup = (legend, name, items, type) => `
        <fieldset class="capsule-candidate-group">
          <legend>${escapeHtml(legend)}</legend>
          <div class="capsule-candidate-list">${items.length ? items.map((item) => `
            <label class="capsule-candidate">
              <input type="checkbox" name="${name}" value="${escapeHtml(item.assetId)}" />
              <span><strong>${escapeHtml(item.label || item.title || (type === "media" ? "安全展示图" : "已确认文字稿"))}</strong><small>${escapeHtml(item.description || item.preview || (type === "media" ? "WebP 安全展示版本" : "仅文字，不携带原始音频"))}</small></span>
            </label>`).join("") : `<div class="capsule-empty">没有可选${escapeHtml(legend)}</div>`}</div>
        </fieldset>`;
      if (!candidates.media.length && !candidates.transcripts.length) {
        elements.candidateList.innerHTML = "";
        return;
      }
      elements.candidateList.innerHTML = `<div class="capsule-candidate-groups">${renderGroup("安全展示图", "capsuleMedia", candidates.media, "media")}${renderGroup("已确认文字稿", "capsuleTranscript", candidates.transcripts, "transcript")}</div>`;
    }

    function renderReader(shell, material, trigger) {
      readerReturnTarget = trigger?.isConnected ? trigger : null;
      const snapshot = material.snapshot;
      const mediaByItem = new Map();
      material.media.forEach((item) => {
        const list = mediaByItem.get(item.itemKey) || [];
        list.push(item);
        mediaByItem.set(item.itemKey, list);
      });
      elements.reader.innerHTML = `
        <header class="capsule-reader-hero">
          <p class="eyebrow">Opened time capsule</p>
          <h3 tabindex="-1">${escapeHtml(snapshot.title || shell.title || "已开启胶囊")}</h3>
          <p>${escapeHtml(snapshot.opening || shell.shellMessage || "")}</p>
        </header>
        <div>${(snapshot.sections || []).map((section, sectionIndex) => `
          <section class="capsule-reader-section">
            <header><h4>${String(sectionIndex + 1).padStart(2, "0")} · ${escapeHtml(section.title || `第 ${sectionIndex + 1} 章`)}</h4>${section.summary ? `<p>${escapeHtml(section.summary)}</p>` : ""}</header>
            <div class="capsule-reader-items">${(section.items || []).map((item) => renderReaderItem(item, mediaByItem.get(item.key) || [])).join("")}</div>
          </section>`).join("")}</div>
        <div class="capsule-reader-actions">
          <button type="button" class="button secondary" data-capsule-back>返回胶囊书架</button>
          <button type="button" class="button primary" data-capsule-prepare-export="${escapeHtml(shell.id)}">导出加密离线展览</button>
        </div>`;
      elements.shelf.hidden = true;
      elements.createPanel.hidden = true;
      elements.reader.hidden = false;
      global.requestAnimationFrame?.(() => elements.reader.querySelector("h3")?.focus({ preventScroll: true }));
    }

    function renderReaderItem(item, media) {
      const images = media.filter((entry) => safeDisplayUrl(entry.contentUrl)).map((entry) => (
        `<figure><img src="${escapeHtml(entry.contentUrl)}" alt="${escapeHtml(entry.altText || entry.caption || "胶囊中的安全展示图")}" loading="lazy" /><figcaption>${escapeHtml(entry.caption || "")}</figcaption></figure>`
      )).join("");
      const citations = (item.confirmedQuotes || item.citations || []).map((citation) => `<blockquote>“${escapeHtml(typeof citation === "string" ? citation : citation.quote || citation.text || "")}”</blockquote>`).join("");
      const transcripts = (item.confirmedTranscripts || item.transcripts || []).map((transcript) => `<div class="capsule-transcript"><strong>已确认文字稿</strong><p>${escapeHtml(typeof transcript === "string" ? transcript : transcript.text || "")}</p></div>`).join("");
      return `<article class="capsule-reader-item">${images}<h5>${escapeHtml(item.title || "未命名展项")}</h5>${item.excerpt ? `<p>${escapeHtml(item.excerpt)}</p>` : ""}${item.curatorNote ? `<p><strong>策展说明</strong> ${escapeHtml(item.curatorNote)}</p>` : ""}${citations}${transcripts}</article>`;
    }

    function renderAccess() {
      elements.sealButton.disabled = busy || demo;
      elements.sealButton.textContent = demo ? "Demo 不保存胶囊" : "确认并封存";
      elements.prepareExportButton.disabled = busy || !safeId(elements.exhibitionSelect.value);
      elements.downloadButton.disabled = busy || !preparedMaterial;
      elements.cancelExportButton.disabled = busy;
      elements.exhibitionSelect.disabled = busy;
      elements.dialog.setAttribute("aria-busy", busy ? "true" : "false");
      elements.exportPanel.setAttribute("aria-busy", busy ? "true" : "false");
    }

    function setBusy(value) {
      busy = Boolean(value);
      renderAccess();
    }

    function selectedCandidateIds() {
      return {
        mediaAssetIds: checkedValues('input[name="capsuleMedia"]'),
        transcriptAssetIds: checkedValues('input[name="capsuleTranscript"]')
      };
    }

    function checkedValues(selector) {
      return [...elements.candidateList.querySelectorAll(`${selector}:checked`)]
        .map((input) => safeId(input.value))
        .filter(Boolean);
    }

    function clearReader() {
      openedMaterial = null;
      readerReturnTarget = null;
      elements.reader.innerHTML = "";
      elements.reader.hidden = true;
      elements.shelf.hidden = false;
      elements.createPanel.hidden = false;
    }

    function cancelPreparedExport() {
      if (busy) return;
      clearPreparedExport();
      setStatus("已取消本次加密导出；口令输入已清空。", false);
    }

    function clearPreparedExport() {
      cancelMaterialRead();
      preparedMaterial = null;
      elements.exportPanel.hidden = true;
      clearPassphrases();
      renderAccess();
    }

    function clearPassphrases() { elements.passphrase.value = ""; elements.passphraseConfirm.value = ""; }

    function closeDialog() { cancelActiveWork(); if (elements.dialog.open) elements.dialog.close(); }

    function handleDialogClose() {
      startSession();
      clearReader();
      clearPreparedExport();
      candidates = { media: [], transcripts: [] };
      renderCandidates();
      elements.form.reset();
      elements.createPanel.open = false;
      initializeFields();
      setBusy(false);
      setStatus("");
      const target = lastTrigger?.isConnected ? lastTrigger : elements.studioButton;
      lastTrigger = null;
      global.requestAnimationFrame?.(() => target.focus({ preventScroll: true }));
    }

    function setStatus(text, isError = false, isSuccess = false) {
      elements.status.textContent = text;
      elements.status.classList.toggle("is-error", Boolean(isError));
      elements.status.classList.toggle("is-success", Boolean(isSuccess));
    }

    function workspaceStatus() {
      if (demo) return exhibitions.length ? "公开 Demo 可演示安全素材选择与本地加密，但不会保存胶囊。" : "公开 Demo 不保存胶囊；先策划一场示例展览即可体验本地加密流程。";
      if (!exhibitions.length) return "先在主题展览工作室保存并确认一场展览，再来封存或分享。";
      return `已读取 ${capsules.length} 枚胶囊与 ${exhibitions.length} 场可用展览。`;
    }

    function setDemo(value) {
      demo = Boolean(value);
      renderShelf();
      renderAccess();
    }

    async function refresh() {
      if (!elements.dialog.open) return;
      await loadWorkspace();
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      startSession();
      clearPreparedExport();
      listeners.forEach(({ target, type, handler, listenerOptions }) => target.removeEventListener(type, handler, listenerOptions));
      listeners.length = 0;
      if (elements.dialog.open) elements.dialog.close();
    }

    function startSession() { session += 1; cancelActiveWork(); return session; }

    function cancelActiveWork() {
      requests.forEach((entry) => entry.controller.abort());
      requests.clear();
      cancelMaterialRead();
    }

    function cancelMaterialRead() { materialRead?.controller.abort(); materialRead = null; }

    function assertCurrentMaterialRead(run, token) { if (!isCurrent(run) || materialRead?.token !== token) throw staleRequest; }

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

    return Object.freeze({ open, refresh, setDemo, destroy });
  }

  const staleRequest = Object.freeze({ name: "StaleCapsuleRequest" });

  function resolveElements(documentRef, ids) {
    if (!documentRef?.getElementById) return null;
    const result = {};
    for (const [name, id] of Object.entries(ids)) {
      const element = documentRef.getElementById(id);
      if (!element) return null;
      result[name] = element;
    }
    return result;
  }

  function normalizeCapsules(value) {
    return (Array.isArray(value) ? value : []).map(normalizeCapsule).filter((item) => item.id);
  }

  function normalizeCapsule(value = {}) {
    const source = value && typeof value === "object" ? value : {};
    return {
      id: safeId(source.id),
      title: String(source.title || ""),
      shellMessage: String(source.shellMessage || source.message || ""),
      opensOn: String(source.opensOn || ""),
      timezone: String(source.timezone || source.openingTimezone || ""),
      available: source.available === true,
      ceremonialGate: source.ceremonialGate !== false,
      needsReview: source.needsReview === true,
      createdAt: String(source.createdAt || "")
    };
  }

  function normalizeExhibitions(value) {
    return (Array.isArray(value) ? value : []).map((item) => ({
      id: safeId(item?.id),
      title: String(item?.title || ""),
      theme: String(item?.theme || ""),
      status: String(item?.status || ""),
      needsReview: item?.needsReview === true
    })).filter((item) => item.id && (!item.status || item.status === "published") && !item.needsReview);
  }

  function normalizeCandidates(value = {}) {
    const source = value && typeof value === "object" ? value : {};
    return {
      media: normalizeCandidateList(source.media || source.images, "media").slice(0, MAX_IMAGES),
      transcripts: normalizeCandidateList(source.transcripts || source.confirmedTranscripts, "transcript")
    };
  }

  function normalizeCandidateList(value, kind) {
    return (Array.isArray(value) ? value : []).map((item) => ({
      assetId: safeId(item?.assetId || item?.id),
      label: String(item?.label || item?.title || ""),
      title: String(item?.title || ""),
      description: String(item?.description || item?.memoryTitle || item?.caption || ""),
      preview: kind === "transcript" ? String(item?.preview || item?.textPreview || "").slice(0, 160) : ""
    })).filter((item) => item.assetId);
  }

  function normalizeCapsuleContent(value, shell) {
    const source = value?.content || value?.material || value?.payload || value || {};
    const material = normalizeMaterial({
      ...source,
      shell: value?.capsule || source.shell || shell,
      snapshot: source.snapshot || source.exhibit || source.payload,
      media: source.media || value?.media
    });
    return material;
  }

  function normalizeMaterial(value = {}) {
    const source = value && typeof value === "object" ? value : {};
    const snapshot = normalizeSnapshot(source.snapshot || source.exhibit || source.payload || {});
    const shellSource = source.shell || {};
    const shell = {
      title: String(shellSource.title || snapshot.title || "时屿离线展览"),
      shellMessage: String(shellSource.shellMessage || ""),
      opensOn: String(shellSource.opensOn || ""),
      timezone: String(shellSource.timezone || ""),
      ceremonialGate: shellSource.ceremonialGate !== false
    };
    const media = (Array.isArray(source.media) ? source.media : []).map((item, index) => ({
      key: safeAnonymousKey(item?.key) || `media-${index + 1}`,
      itemKey: safeAnonymousKey(item?.itemKey),
      position: Number.isSafeInteger(item?.position) ? item.position : index,
      caption: String(item?.caption || ""),
      altText: String(item?.altText || ""),
      mimeType: String(item?.mimeType || "image/webp").toLowerCase(),
      byteSize: positiveInteger(item?.byteSize),
      width: positiveInteger(item?.width),
      height: positiveInteger(item?.height),
      sha256: safeSha256(item?.sha256),
      contentUrl: String(item?.contentUrl || item?.url || "")
    })).filter((item) => item.itemKey && item.contentUrl);
    return { snapshot, shell, media };
  }

  function normalizeSnapshot(value = {}) {
    const source = value && typeof value === "object" ? value : {};
    let itemNumber = 0;
    return {
      format: "time-isle.offline-exhibit",
      version: 1,
      title: String(source.title || ""),
      theme: String(source.theme || ""),
      opening: String(source.opening || ""),
      sections: (Array.isArray(source.sections) ? source.sections : []).map((section, sectionIndex) => ({
        key: safeAnonymousKey(section?.key) || `section-${sectionIndex + 1}`,
        title: String(section?.title || ""),
        summary: String(section?.summary || ""),
        items: (Array.isArray(section?.items) ? section.items : []).map((item) => {
          itemNumber += 1;
          const hasConfirmedTranscripts = Array.isArray(item?.confirmedTranscripts) || item?.confirmedTranscript !== undefined;
          const transcriptSource = item?.confirmedTranscripts || (item?.confirmedTranscript ? [item.confirmedTranscript] : item?.transcripts || []);
          const hasConfirmedQuotes = Array.isArray(item?.confirmedQuotes);
          const quoteSource = item?.confirmedQuotes || item?.citations || [];
          return {
            key: safeAnonymousKey(item?.key) || `item-${itemNumber}`,
            title: String(item?.title || ""),
            excerpt: String(item?.excerpt || ""),
            curatorNote: String(item?.curatorNote || ""),
            confirmedQuotes: (Array.isArray(quoteSource) ? quoteSource : [])
              .filter((quote) => hasConfirmedQuotes || quote?.evidenceValid === true)
              .map((quote) => String(typeof quote === "string" ? quote : quote?.quote || quote?.text || ""))
              .filter(Boolean),
            confirmedTranscripts: (Array.isArray(transcriptSource) ? transcriptSource : [])
              .filter((transcript) => hasConfirmedTranscripts || (typeof transcript === "object" && (transcript?.status === "confirmed" || transcript?.confirmed === true)))
              .map((transcript) => String(typeof transcript === "string" ? transcript : transcript?.text || ""))
              .filter(Boolean),
            mediaKeys: []
          };
        })
      }))
    };
  }

  function assembleOfflinePayload(snapshotValue, packedMediaValue) {
    const copy = JSON.parse(JSON.stringify(normalizeSnapshot(snapshotValue)));
    const itemKeys = new Set(copy.sections.flatMap((section) => section.items.map((item) => item.key)));
    const media = (Array.isArray(packedMediaValue) ? packedMediaValue : []).map((item, index) => {
      const itemKey = safeAnonymousKey(item?.itemKey);
      const width = positiveInteger(item?.width), height = positiveInteger(item?.height);
      const byteSize = positiveInteger(item?.byteSize), dataBase64 = String(item?.dataBase64 || "");
      if (!itemKey || !itemKeys.has(itemKey) || item?.mimeType !== "image/webp" ||
          !width || !height || !byteSize || !dataBase64) {
        throw new Error("离线展览包含无效的安全展示图。");
      }
      return {
        key: `media-${index + 1}`, itemKey,
        caption: String(item?.caption || ""), alt: String(item?.alt || item?.altText || ""),
        mimeType: "image/webp", width, height, byteSize, dataBase64
      };
    });
    const keysByItem = new Map();
    media.forEach((entry) => {
      const keys = keysByItem.get(entry.itemKey) || [];
      keys.push(entry.key);
      keysByItem.set(entry.itemKey, keys);
    });
    copy.sections.forEach((section) => section.items.forEach((item) => {
      item.mediaKeys = keysByItem.get(item.key) || [];
    }));
    return { ...copy, media };
  }

  function toCryptoShell(shell, fallbackTitle) {
    const title = String(shell?.title || fallbackTitle || "时屿离线展览").trim().slice(0, 120) || "时屿离线展览";
    const note = String(shell?.shellMessage || shell?.note || "这是一份来自时屿的口令加密离线展览。").trim().slice(0, 240);
    let opensAt = String(shell?.opensAt || "");
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(opensAt)) {
      opensAt = shell?.opensOn
        ? zonedMidnightIso(shell.opensOn, shell.timezone || resolvedTimezone())
        : new Date(Date.now() - 1000).toISOString();
    }
    return { title, note, opensAt };
  }

  function zonedMidnightIso(dateText, timezone) {
    const match = String(dateText || "").match(/^(\d{4})-(\d{2})-(\d{2})$/u);
    if (!match) return new Date(Date.now() - 1000).toISOString();
    const desired = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0);
    let guess = desired;
    try {
      const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
      });
      for (let iteration = 0; iteration < 3; iteration += 1) {
        const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]));
        const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
        guess += desired - represented;
      }
      return new Date(guess).toISOString();
    } catch {
      return new Date(desired).toISOString();
    }
  }

  function resolvedTimezone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai"; } catch { return "Asia/Shanghai"; }
  }

  function tomorrowIso() {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function safeId(value) {
    const id = String(value || "").trim();
    return ID_PATTERN.test(id) ? id : "";
  }

  function safeAnonymousKey(value) {
    const key = String(value || "").trim();
    return /^(?:section|item|media|transcript)-[a-zA-Z0-9_-]{1,80}$/u.test(key) ? key : "";
  }

  function safeSha256(value) {
    const hash = String(value || "").toLowerCase();
    return /^[a-f0-9]{64}$/u.test(hash) ? hash : "";
  }

  function safeDisplayUrl(value) {
    const url = String(value || "");
    return /^\/api\/media\/[a-zA-Z0-9_-]{1,120}\/display(?:\?[^#]*)?$/u.test(url) ? url : "";
  }

  function positiveInteger(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : 0;
  }

  async function sha256Hex(bytes) {
    const subtle = global.crypto?.subtle;
    if (!subtle) throw new Error("当前浏览器不支持安全哈希校验。");
    const digest = new Uint8Array(await subtle.digest("SHA-256", bytes));
    return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
  }

  function bytesToBase64(bytes) {
    let binary = "";
    const chunk = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunk) {
      binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunk)));
    }
    return global.btoa(binary);
  }

  function utf8Bytes(text) {
    return new TextEncoder().encode(String(text || "")).length;
  }

  function safeFilename(value) {
    const name = String(value || "时屿离线展览")
      .normalize("NFKC")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "-")
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 80);
    return name || "时屿离线展览";
  }

  function formatDate(value) {
    const text = String(value || "");
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
    return match ? `${match[1]} 年 ${Number(match[2])} 月 ${Number(match[3])} 日` : text;
  }

  function parseJson(text) {
    try { return JSON.parse(text); } catch { return { error: text }; }
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

  global.TimeIsleCapsules = Object.freeze({
    assembleOfflinePayload,
    createController,
    normalizeCapsule,
    normalizeMaterial,
    normalizeSnapshot
  });
})(typeof window !== "undefined" ? window : globalThis);
