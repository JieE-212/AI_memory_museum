(function initializeTimeIsleCoMemoryLetters(root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.TimeIsleCoMemoryLetters = factory();
}(typeof globalThis !== "undefined" ? globalThis : self, function createCoMemoryLettersModule() {
  "use strict";

  const hostGlobal = typeof globalThis !== "undefined" ? globalThis : {};
  const REPLY_PACKAGE_FORMAT = "time-isle.co-memory-reply-package";
  const REPLY_PACKAGE_CONTENT_TYPE = "application/vnd.time-isle.co-memory-reply-package+json";
  const REPLY_PACKAGE_VERSION = 1;
  const MAX_REPLY_PACKAGE_BYTES = 2 * 1024 * 1024;
  const MAX_CRYPTO_SOURCE_BYTES = 256 * 1024;
  const FORBIDDEN_OFFLINE_SOURCE = /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|localStorage|sessionStorage|indexedDB)\b/u;
  const MEMORY_ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/u;
  const MEMORY_ANCHOR_PATTERN = /^\[time-isle-memory-anchor:v1:([A-Za-z0-9_-]{1,120})\](?:\n|$)/u;

  function renderPanel(memory = {}) {
    const memoryId = safeMemoryId(memory.id);
    if (!memoryId) return "";
    const title = normalizeDisplayText(memory.title, "未命名展品", 160);
    return `
      <details class="co-memory-letter" data-co-memory-panel="${escapeHtml(memoryId)}">
        <summary>
          <span><strong>共忆信笺</strong><small>一问一答 · 加密但未签名</small></span>
          <span aria-hidden="true">＋</span>
        </summary>
        <div class="co-memory-letter-body">
          <p class="co-memory-boundary">邀请只带出你在这里明确填写的文字，以及一个不含标题或正文的本地归位码；不会自动带出整件展品、照片、声音、人物、日期或关系。请求与回复都只在浏览器内加解密，不会自动保存、发布或分享。如果你后续明确确认保存，解密后的问题与回答会进入本机 SQLite；加密保护的是馆外文件，不代表数据库已做静态加密。</p>
          <section class="co-memory-compose" aria-labelledby="coMemoryCompose-${escapeHtml(memoryId)}">
            <div class="co-memory-section-heading">
              <div><span class="co-memory-step">1</span><h3 id="coMemoryCompose-${escapeHtml(memoryId)}">写一封离线邀请</h3></div>
              <small>纯文字 · 最小披露</small>
            </div>
            <form data-co-memory-create-form novalidate>
              <label class="co-memory-title-choice">
                <input type="checkbox" name="includeTitle" />
                <span><strong>把展品标题带给对方</strong><small>${escapeHtml(title)} · 默认不带出</small></span>
              </label>
              <label>愿意带出的记忆片段
                <textarea name="evidence" maxlength="4000" required placeholder="只粘贴回答问题所必需的片段"></textarea>
                <small><span data-co-memory-evidence-count>0</span> / 4000 · 不会自动读取原记忆</small>
              </label>
              <label>想问对方的问题
                <textarea name="question" maxlength="1000" required placeholder="例如：你记得那天离开前，我们还聊了什么吗？"></textarea>
                <small><span data-co-memory-question-count>0</span> / 1000</small>
              </label>
              <label>补充说明 <span class="co-memory-optional">可选</span>
                <textarea name="contextNote" maxlength="1000" placeholder="只写对回答有帮助、并且你愿意带出馆外的信息"></textarea>
              </label>
              <div class="co-memory-passphrase-grid">
                <label>邀请口令
                  <input type="password" name="passphrase" minlength="12" maxlength="1024" autocomplete="new-password" required />
                </label>
                <label>再次输入口令
                  <input type="password" name="passphraseAgain" minlength="12" maxlength="1024" autocomplete="new-password" required />
                </label>
              </div>
              <p class="co-memory-security-note">请通过另一条渠道告诉朋友口令。AES-GCM 可保护内容并发现篡改，但信笺没有数字签名，不能证明回复者身份。</p>
              <button type="submit" class="button secondary" data-co-memory-create>下载单文件离线邀请</button>
              <p class="co-memory-status" data-co-memory-create-status role="status" aria-live="polite">生成后得到一个可断网打开的 HTML；下载不会撤回，请先核对披露内容。</p>
            </form>
          </section>
          <details class="co-memory-import">
            <summary>
              <span><strong>验看朋友的加密回信</strong><small>只预览，确认后才可交给保存接口</small></span>
              <span aria-hidden="true">＋</span>
            </summary>
            <form data-co-memory-import-form novalidate>
              <input class="sr-only" type="file" accept=".json,application/json,application/vnd.time-isle.co-memory-reply-package+json" tabindex="-1" data-co-memory-file />
              <div class="co-memory-file-row">
                <button type="button" class="button secondary compact" data-co-memory-pick>选择加密回信</button>
                <span data-co-memory-file-name>尚未选择文件</span>
              </div>
              <label>回信口令
                <input type="password" name="replyPassphrase" minlength="12" maxlength="1024" autocomplete="current-password" required />
              </label>
              <button type="submit" class="button secondary" data-co-memory-preview disabled>解锁并只预览</button>
              <p class="co-memory-status" data-co-memory-import-status role="status" aria-live="polite">错误口令、错配邀请或任何经过篡改的信封都会被拒绝。</p>
            </form>
            <div class="co-memory-preview" data-co-memory-preview-panel hidden></div>
          </details>
        </div>
      </details>`;
  }

  function createController(options = {}) {
    const documentRef = options.document || (typeof document !== "undefined" ? document : null);
    const cryptoApi = options.cryptoApi || hostGlobal.TimeIsleCoMemoryCrypto;
    const fetchImpl = options.fetch || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
    const confirmResponse = typeof options.confirmResponse === "function" ? options.confirmResponse : null;
    const onChanged = typeof options.onChanged === "function" ? options.onChanged : () => {};
    const download = typeof options.download === "function"
      ? options.download
      : (artifact) => downloadArtifact(documentRef, artifact, options);
    if (!documentRef || !isCryptoApi(cryptoApi)) return null;

    let demo = Boolean(options.demo);
    let session = null;
    let cachedCryptoSource = typeof options.cryptoSource === "string" ? requireTrustedCryptoSource(options.cryptoSource) : "";

    function setDemo(value) {
      demo = Boolean(value);
      if (session) updateSaveAccess(session);
    }

    function open(memory, container) {
      close();
      const memoryId = safeMemoryId(memory?.id);
      const panel = memoryId ? container?.querySelector?.(`[data-co-memory-panel="${memoryId}"]`) : null;
      if (!panel) return null;
      const controller = new AbortController();
      session = {
        memory: { id: memoryId, title: normalizeDisplayText(memory?.title, "", 160) },
        panel,
        controller,
        replyPackage: null,
        preview: null,
        generatedDigests: new Set(),
        fileReadNo: 0,
        busy: false
      };
      panel.addEventListener("input", handleInput, { signal: controller.signal });
      panel.addEventListener("click", handleClick, { signal: controller.signal });
      panel.addEventListener("change", handleChange, { signal: controller.signal });
      panel.addEventListener("submit", handleSubmit, { signal: controller.signal });
      panel.addEventListener("toggle", handlePanelToggle, { signal: controller.signal });
      updateSaveAccess(session);
      return session;
    }

    function close() {
      if (!session) return;
      clearSecrets(session, true);
      session.controller.abort();
      session = null;
    }

    function destroy() {
      close();
      cachedCryptoSource = "";
    }

    function handlePanelToggle(event) {
      const active = session;
      if (!active || event.target !== active.panel || active.panel.open) return;
      clearSecrets(active, false);
    }

    function handleInput(event) {
      const active = session;
      if (!active || !active.panel.contains(event.target)) return;
      if (event.target.name === "evidence") setCount(active, "[data-co-memory-evidence-count]", event.target.value);
      if (event.target.name === "question") setCount(active, "[data-co-memory-question-count]", event.target.value);
      if (event.target.matches("[data-co-memory-confirm-check]")) updateSaveAccess(active);
    }

    function handleClick(event) {
      const active = session;
      if (!active || !active.panel.contains(event.target)) return;
      if (event.target.closest("[data-co-memory-pick]")) {
        active.panel.querySelector("[data-co-memory-file]")?.click();
        return;
      }
      if (event.target.closest("[data-co-memory-dismiss-preview]")) {
        clearPreview(active);
        return;
      }
      if (event.target.closest("[data-co-memory-confirm-save]")) confirmPreview(active);
    }

    function handleChange(event) {
      const active = session;
      if (!active || !active.panel.contains(event.target)) return;
      if (event.target.matches("[data-co-memory-file]")) readSelectedReply(active, event.target.files?.[0]);
      if (event.target.matches("[data-co-memory-confirm-check]")) updateSaveAccess(active);
    }

    function handleSubmit(event) {
      const active = session;
      if (!active || !active.panel.contains(event.target)) return;
      if (event.target.matches("[data-co-memory-create-form]")) {
        event.preventDefault();
        createInvitation(active, event.target);
      }
      if (event.target.matches("[data-co-memory-import-form]")) {
        event.preventDefault();
        previewReply(active, event.target);
      }
    }

    async function createInvitation(active, form) {
      if (active.busy) return;
      const status = form.querySelector("[data-co-memory-create-status]");
      try {
        const values = new FormData(form);
        const passphrase = String(values.get("passphrase") || "");
        const repeated = String(values.get("passphraseAgain") || "");
        if (passphrase !== repeated) throw letterError("两次输入的邀请口令不一致。", "CO_MEMORY_PASSPHRASE_MISMATCH");
        const payload = createRequestPayload({
          memoryId: active.memory.id,
          letterId: cryptoApi.createLetterId(),
          question: values.get("question"),
          contextTitle: values.get("includeTitle") ? active.memory.title : "",
          contextNote: values.get("contextNote"),
          evidence: values.get("evidence")
        }, cryptoApi);
        active.busy = true;
        updateBusy(active);
        setStatus(status, "正在本机加密并封装离线邀请…");
        const envelope = await cryptoApi.createRequestEnvelope(payload, passphrase);
        if (!isCurrent(active)) return;
        const requestSha256 = envelope.binding.requestSha256;
        const cryptoSource = await loadCryptoSource();
        if (!isCurrent(active)) return;
        const html = createOfflineInvitationHtml(envelope, cryptoSource, cryptoApi);
        download({
          content: html,
          type: "text/html;charset=utf-8",
          fileName: `time-isle-co-memory-invitation-${payload.letterId.slice(-8)}.html`
        });
        active.generatedDigests.add(requestSha256);
        clearPasswordFields(form);
        setStatus(status, "离线邀请已生成。请先自行打开核对，再通过另一条渠道告知口令。", "success");
      } catch (error) {
        if (isCurrent(active)) setStatus(status, friendlyError(error), "error");
      } finally {
        active.busy = false;
        if (isCurrent(active)) updateBusy(active);
      }
    }

    async function loadCryptoSource() {
      if (cachedCryptoSource) return cachedCryptoSource;
      let source;
      if (typeof options.loadCryptoSource === "function") {
        source = await options.loadCryptoSource();
      } else {
        if (!fetchImpl) throw letterError("无法读取本站内置加密脚本。", "CO_MEMORY_CRYPTO_SOURCE_UNAVAILABLE");
        const response = await fetchImpl("/assets/co-memory-crypto.js", {
          method: "GET",
          headers: { Accept: "text/javascript" },
          credentials: "same-origin",
          cache: "force-cache"
        });
        if (!response.ok) throw letterError("无法读取本站内置加密脚本。", "CO_MEMORY_CRYPTO_SOURCE_UNAVAILABLE");
        source = await response.text();
      }
      cachedCryptoSource = requireTrustedCryptoSource(source);
      return cachedCryptoSource;
    }

    async function readSelectedReply(active, file) {
      const readNo = ++active.fileReadNo;
      const status = active.panel.querySelector("[data-co-memory-import-status]");
      const fileName = active.panel.querySelector("[data-co-memory-file-name]");
      const previewButton = active.panel.querySelector("[data-co-memory-preview]");
      clearPreview(active);
      active.replyPackage = null;
      previewButton.disabled = true;
      if (!file) {
        fileName.textContent = "尚未选择文件";
        return;
      }
      fileName.textContent = normalizeDisplayText(file.name, "加密回信", 120);
      try {
        if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_REPLY_PACKAGE_BYTES) {
          throw letterError("加密回信文件大小不受支持。", "CO_MEMORY_REPLY_PACKAGE_SIZE");
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (!isCurrent(active) || active.fileReadNo !== readNo) return;
        active.replyPackage = parseReplyPackageBytes(bytes, cryptoApi);
        previewButton.disabled = false;
        setStatus(status, "已读取加密信封；输入口令后只在当前页面验看。");
      } catch (error) {
        if (isCurrent(active) && active.fileReadNo === readNo) setStatus(status, friendlyError(error), "error");
      }
    }

    async function previewReply(active, form) {
      const status = form.querySelector("[data-co-memory-import-status]");
      if (active.busy || !active.replyPackage) return;
      try {
        active.busy = true;
        updateBusy(active);
        setStatus(status, "正在本机验真并解锁；不会上传或保存…");
        const passphrase = String(new FormData(form).get("replyPassphrase") || "");
        const opened = await openReplyPackage(active.replyPackage, passphrase, cryptoApi);
        if (!isCurrent(active)) return;
        const boundMemoryId = extractMemoryAnchor(opened.request.payload);
        if (!boundMemoryId || boundMemoryId !== active.memory.id) {
          throw letterError("这封回信不属于当前展品。", "CO_MEMORY_MEMORY_BINDING_INVALID");
        }
        active.preview = opened;
        clearPasswordFields(form);
        renderPreview(active);
        setStatus(status, active.generatedDigests.has(opened.requestSha256)
          ? "邀请与回信已匹配并通过完整性校验；尚未保存。"
          : "邀请、回信与当前展品归位码已匹配；请阅读原问题与片段后再决定。", "success");
      } catch (error) {
        if (isCurrent(active)) {
          clearPreview(active);
          setStatus(status, friendlyError(error), "error");
        }
      } finally {
        active.busy = false;
        if (isCurrent(active)) updateBusy(active);
      }
    }

    function renderPreview(active) {
      const target = active.panel.querySelector("[data-co-memory-preview-panel]");
      const opened = active.preview;
      if (!target || !opened) return;
      target.replaceChildren();
      target.hidden = false;
      const heading = element("div", "co-memory-preview-heading");
      const title = element("h4", "");
      title.textContent = "回信预览";
      title.tabIndex = -1;
      const badge = element("span", "co-memory-unverified-badge");
      badge.textContent = "自述 · 未核验";
      heading.append(title, badge);
      target.append(heading);
      target.append(labeledText("原问题", opened.request.payload.question));
      const evidence = element("div", "co-memory-preview-evidence");
      const evidenceTitle = element("strong", "");
      evidenceTitle.textContent = "邀请中实际带出的片段";
      evidence.append(evidenceTitle);
      for (const entry of opened.request.payload.context.evidence) {
        const quote = element("blockquote", "");
        quote.textContent = entry.text;
        evidence.append(quote);
      }
      target.append(evidence);
      target.append(labeledText("朋友填写的称呼（未核验）", opened.response.payload.identity.label || "未填写称呼"));
      target.append(labeledText("回复", opened.response.payload.answer));
      const boundary = element("p", "co-memory-preview-boundary");
      boundary.textContent = "这只能证明文件在共享口令保护下未被改动；它没有数字签名，不能证明回复者身份，也不会自动改写原记忆。";
      target.append(boundary);
      const confirmation = element("label", "co-memory-confirm-choice");
      const checkbox = element("input", "");
      checkbox.type = "checkbox";
      checkbox.dataset.coMemoryConfirmCheck = "";
      const confirmationText = element("span", "");
      confirmationText.textContent = "我已阅读原问题、披露片段与回复，愿意把它作为未核验来源交给保存接口。";
      confirmation.append(checkbox, confirmationText);
      target.append(confirmation);
      const actions = element("div", "co-memory-preview-actions");
      const save = element("button", "button secondary");
      save.type = "button";
      save.dataset.coMemoryConfirmSave = "";
      save.textContent = "确认保存为未核验来源";
      const dismiss = element("button", "button text-button");
      dismiss.type = "button";
      dismiss.dataset.coMemoryDismissPreview = "";
      dismiss.textContent = "关闭预览";
      actions.append(save, dismiss);
      target.append(actions);
      const status = element("p", "co-memory-status");
      status.dataset.coMemorySaveStatus = "";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      status.textContent = confirmResponse
        ? "只有勾选并点击确认后，内容才会交给保存接口。"
        : "保存接口尚未接入；当前只能验真和预览。";
      target.append(status);
      updateSaveAccess(active);
      title.focus?.({ preventScroll: true });
    }

    async function confirmPreview(active) {
      const status = active.panel.querySelector("[data-co-memory-save-status]");
      const checked = active.panel.querySelector("[data-co-memory-confirm-check]")?.checked;
      if (!active.preview || active.busy || demo || !confirmResponse || !checked) return;
      try {
        active.busy = true;
        updateBusy(active);
        setStatus(status, "正在提交你明确确认的未核验来源…");
        const result = await confirmResponse(
          createConfirmationContract(active.memory.id, active.preview),
          { signal: active.controller.signal }
        );
        if (!isCurrent(active)) return;
        setStatus(status, "已按你的确认保存为未核验来源；解密内容已进入本机 SQLite，原记忆没有被改写。", "success");
        const checkbox = active.panel.querySelector("[data-co-memory-confirm-check]");
        if (checkbox) checkbox.checked = false;
        active.preview.saved = true;
        onChanged(result);
      } catch (error) {
        if (isCurrent(active) && error?.name !== "AbortError") setStatus(status, `保存没有完成：${friendlyError(error)}`, "error");
      } finally {
        active.busy = false;
        if (isCurrent(active)) updateBusy(active);
      }
    }

    function element(tag, className) {
      const node = documentRef.createElement(tag);
      if (className) node.className = className;
      return node;
    }

    function labeledText(label, text) {
      const block = element("div", "co-memory-preview-field");
      const strong = element("strong", "");
      strong.textContent = label;
      const paragraph = element("p", "");
      paragraph.textContent = String(text || "");
      block.append(strong, paragraph);
      return block;
    }

    function updateSaveAccess(active) {
      const save = active.panel.querySelector("[data-co-memory-confirm-save]");
      if (!save) return;
      const checked = Boolean(active.panel.querySelector("[data-co-memory-confirm-check]")?.checked);
      save.disabled = demo || !confirmResponse || !checked || active.busy || Boolean(active.preview?.saved);
      save.title = demo ? "公开 Demo 不保存回信" : (!confirmResponse ? "保存接口尚未接入" : "");
    }

    function updateBusy(active) {
      active.panel.querySelectorAll("button, input, textarea").forEach((control) => {
        if (control.matches("[data-co-memory-preview]") && !active.replyPackage) control.disabled = true;
        else if (control.matches("[data-co-memory-confirm-save]")) return;
        else control.disabled = active.busy;
      });
      updateSaveAccess(active);
    }

    function clearPreview(active) {
      active.preview = null;
      const target = active.panel.querySelector("[data-co-memory-preview-panel]");
      if (target) {
        target.replaceChildren();
        target.hidden = true;
      }
    }

    function clearSecrets(active, discardFile) {
      active.panel.querySelectorAll('input[type="password"]').forEach((input) => { input.value = ""; });
      clearPreview(active);
      if (discardFile) {
        active.fileReadNo += 1;
        active.replyPackage = null;
        const file = active.panel.querySelector("[data-co-memory-file]");
        if (file) file.value = "";
      }
    }

    function isCurrent(active) {
      return session === active && !active.controller.signal.aborted;
    }

    return Object.freeze({ close, destroy, open, renderPanel, setDemo });
  }

  function createRequestPayload(input, cryptoApi) {
    requireCryptoApi(cryptoApi);
    const memoryId = safeMemoryId(input?.memoryId);
    if (!memoryId) throw letterError("需要一件有效展品来生成邀请。", "CO_MEMORY_MEMORY_BINDING_INVALID");
    const evidence = normalizeRequiredText(input?.evidence, "记忆片段", 4000);
    const note = normalizeOptionalText(input?.contextNote, 1000);
    const payload = {
      format: cryptoApi.REQUEST_FORMAT,
      version: cryptoApi.VERSION,
      letterId: input?.letterId || cryptoApi.createLetterId(),
      question: normalizeRequiredText(input?.question, "问题", 1000),
      context: {
        title: normalizeOptionalText(input?.contextTitle, 160),
        note: joinMemoryAnchor(memoryId, note),
        evidence: [{ key: "evidence-1", kind: "quote", text: evidence }]
      },
      boundary: cryptoApi.REQUEST_BOUNDARY
    };
    return cryptoApi.validateRequestPayload(payload);
  }

  function createResponsePayload(openedRequest, input, cryptoApi) {
    requireCryptoApi(cryptoApi);
    if (!openedRequest?.payload || typeof openedRequest.requestSha256 !== "string") {
      throw letterError("需要先验真并打开完整邀请。", "CO_MEMORY_REQUEST_REQUIRED");
    }
    const payload = {
      format: cryptoApi.RESPONSE_FORMAT,
      version: cryptoApi.VERSION,
      letterId: openedRequest.payload.letterId,
      responseId: input?.responseId || cryptoApi.createResponseId(),
      requestSha256: openedRequest.requestSha256,
      identity: {
        label: normalizeOptionalText(input?.identityLabel, 120),
        assurance: cryptoApi.IDENTITY_ASSURANCE,
        verified: false
      },
      answer: normalizeRequiredText(input?.answer, "回复", 8000),
      boundary: cryptoApi.RESPONSE_BOUNDARY
    };
    return cryptoApi.validateResponsePayload(payload);
  }

  function createReplyPackage(requestEnvelope, responseEnvelope, cryptoApi) {
    requireCryptoApi(cryptoApi);
    const request = cryptoApi.validateRequestEnvelope(requestEnvelope);
    const response = cryptoApi.validateResponseEnvelope(responseEnvelope);
    if (request.binding.requestSha256 !== response.binding.requestSha256) {
      throw letterError("回信与邀请不匹配。", "CO_MEMORY_REPLY_PACKAGE_BINDING_INVALID");
    }
    return {
      format: REPLY_PACKAGE_FORMAT,
      version: REPLY_PACKAGE_VERSION,
      contentType: REPLY_PACKAGE_CONTENT_TYPE,
      request,
      response
    };
  }

  function parseReplyPackage(input, cryptoApi) {
    requireCryptoApi(cryptoApi);
    if (!isPlainObject(input)) throw letterError("回信文件不是受支持的对象。", "CO_MEMORY_REPLY_PACKAGE_INVALID");
    assertExactKeys(input, ["format", "version", "contentType", "request", "response"]);
    if (input.format !== REPLY_PACKAGE_FORMAT || input.version !== REPLY_PACKAGE_VERSION || input.contentType !== REPLY_PACKAGE_CONTENT_TYPE) {
      throw letterError("回信文件格式或版本不受支持。", "CO_MEMORY_REPLY_PACKAGE_INVALID");
    }
    return createReplyPackage(input.request, input.response, cryptoApi);
  }

  function parseReplyPackageBytes(input, cryptoApi) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || 0);
    if (!bytes.byteLength || bytes.byteLength > MAX_REPLY_PACKAGE_BYTES) {
      throw letterError("加密回信文件大小不受支持。", "CO_MEMORY_REPLY_PACKAGE_SIZE");
    }
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw letterError("加密回信不是有效的 UTF-8 文件。", "CO_MEMORY_REPLY_PACKAGE_UTF8");
    }
    try {
      return parseReplyPackage(JSON.parse(text), cryptoApi);
    } catch (error) {
      if (String(error?.code || "").startsWith("CO_MEMORY_")) throw error;
      throw letterError("加密回信不是有效的 JSON 文件。", "CO_MEMORY_REPLY_PACKAGE_JSON");
    }
  }

  async function openReplyPackage(input, passphrase, cryptoApi) {
    const replyPackage = parseReplyPackage(input, cryptoApi);
    const request = await cryptoApi.openRequestEnvelope(replyPackage.request, passphrase);
    const response = await cryptoApi.openResponseEnvelope(replyPackage.response, passphrase, request);
    return { replyPackage, request, response, requestSha256: request.requestSha256 };
  }

  function createConfirmationContract(memoryId, opened) {
    const id = safeMemoryId(memoryId);
    if (!id || !opened?.request?.payload || !opened?.response?.payload || extractMemoryAnchor(opened.request.payload) !== id) {
      throw letterError("回信预览不完整，不能交给保存接口。", "CO_MEMORY_CONFIRMATION_INVALID");
    }
    const response = opened.response.payload;
    return Object.freeze({
      confirm: true,
      memoryId: id,
      requestSha256: opened.requestSha256,
      request: opened.request.payload,
      response,
      source: Object.freeze({
        kind: "co_memory_response",
        relationKind: "supplements",
        label: response.identity.label || "未署名共忆回信",
        excerpt: response.answer,
        identityAssurance: "self-asserted-unverified",
        identityVerified: false,
        encrypted: true,
        signed: false
      })
    });
  }

  function createOfflineInvitationHtml(requestEnvelope, cryptoSource, cryptoApi) {
    requireCryptoApi(cryptoApi);
    const envelope = cryptoApi.validateRequestEnvelope(requestEnvelope);
    const trustedSource = requireTrustedCryptoSource(cryptoSource).replace(/<\/script/giu, "<\\/script");
    const invitationJson = jsonForInlineScript(envelope);
    const nonce = "time-isle-offline-letter-v1";
    const runtime = `(${offlineInvitationRuntime.toString()})(${invitationJson});`.replace(/<\/script/giu, "<\\/script");
    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <meta name="referrer" content="no-referrer" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'none'; img-src 'none'; media-src 'none'; font-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'" />
  <title>时屿 · 加密共忆信笺</title>
  <style nonce="${nonce}">${offlineInvitationCss()}${offlineInvitationSafetyCss()}</style>
</head>
<body>
  <main>
    <header><span class="mark" aria-hidden="true">屿</span><div><p>TIME ISLE · OFFLINE LETTER</p><h1>一封加密共忆信笺</h1></div></header>
    <section class="card" id="unlockCard">
      <p class="eyebrow">先解锁邀请</p>
      <h2>内容只在这台设备上打开</h2>
      <p class="muted">这个 HTML 不会联网，也不会把口令或回答存进浏览器。请向邀请人从另一条渠道获取口令。</p>
      <form id="unlockForm">
        <label>邀请口令<input id="unlockPassphrase" type="password" minlength="12" maxlength="1024" autocomplete="current-password" required autofocus /></label>
        <button type="submit">解锁并阅读</button>
        <p class="status" id="unlockStatus" role="status" aria-live="polite">错误口令或被篡改的邀请会被拒绝。</p>
      </form>
    </section>
    <section class="card" id="replyCard" hidden>
      <div class="question-heading"><div><p class="eyebrow">邀请人想问</p><h2 id="question" tabindex="-1"></h2></div><span>加密 · 未签名</span></div>
      <div class="context" id="context"></div>
      <form id="replyForm">
        <label>希望邀请人如何称呼你 <small>可留空 · 自述且未核验</small><input id="identityLabel" maxlength="120" autocomplete="off" /></label>
        <label>你的回复<textarea id="answer" maxlength="8000" required placeholder="只写下你愿意交还给邀请人的内容"></textarea><small><span id="answerCount">0</span> / 8000</small></label>
        <p class="notice">导出的回复使用同一口令加密，并绑定这封邀请；它能发现篡改，但没有数字签名，不能证明你的身份。下载不会自动发送，也无法远程撤回。</p>
        <button type="submit">导出加密回复</button>
        <p class="status" id="replyStatus" role="status" aria-live="polite">填写内容只停留在当前页面，关闭后即不再保留。</p>
      </form>
    </section>
  </main>
  <footer>时屿 · 共忆信笺 v1 · 离线单文件</footer>
  <script nonce="${nonce}">${trustedSource}</script>
  <script nonce="${nonce}">${runtime}</script>
</body>
</html>`;
  }

  function offlineInvitationRuntime(invitation) {
    "use strict";
    const cryptoApi = globalThis.TimeIsleCoMemoryCrypto;
    const replyFormat = "time-isle.co-memory-reply-package";
    const replyContentType = "application/vnd.time-isle.co-memory-reply-package+json";
    const byId = (id) => document.getElementById(id);
    const unlockForm = byId("unlockForm");
    const replyForm = byId("replyForm");
    const unlockStatus = byId("unlockStatus");
    const replyStatus = byId("replyStatus");
    let openedRequest = null;
    let passphrase = "";

    unlockForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = unlockForm.querySelector("button");
      if (button.disabled) return;
      button.disabled = true;
      unlockStatus.textContent = "正在本机验真并解锁…";
      try {
        const candidate = byId("unlockPassphrase").value;
        openedRequest = await cryptoApi.openRequestEnvelope(invitation, candidate);
        passphrase = candidate;
        byId("unlockPassphrase").value = "";
        renderRequest(openedRequest.payload);
        byId("unlockCard").hidden = true;
        byId("replyCard").hidden = false;
        byId("question").focus({ preventScroll: true });
      } catch {
        openedRequest = null;
        passphrase = "";
        unlockStatus.textContent = "无法解锁：口令错误，或邀请已损坏、被篡改。没有读取任何内容。";
        button.disabled = false;
      }
    });

    byId("answer").addEventListener("input", () => {
      byId("answerCount").textContent = String([...byId("answer").value].length);
    });

    replyForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!openedRequest || !passphrase) return;
      const button = replyForm.querySelector("button");
      if (button.disabled) return;
      button.disabled = true;
      replyStatus.textContent = "正在本机加密回复…";
      try {
        const payload = {
          format: cryptoApi.RESPONSE_FORMAT,
          version: cryptoApi.VERSION,
          letterId: openedRequest.payload.letterId,
          responseId: cryptoApi.createResponseId(),
          requestSha256: openedRequest.requestSha256,
          identity: {
            label: byId("identityLabel").value.trim(),
            assurance: cryptoApi.IDENTITY_ASSURANCE,
            verified: false
          },
          answer: byId("answer").value.trim(),
          boundary: cryptoApi.RESPONSE_BOUNDARY
        };
        cryptoApi.validateResponsePayload(payload);
        const response = await cryptoApi.createResponseEnvelope(payload, passphrase, openedRequest);
        const replyPackage = {
          format: replyFormat,
          version: 1,
          contentType: replyContentType,
          request: invitation,
          response
        };
        const blob = new Blob([JSON.stringify(replyPackage, null, 2)], { type: `${replyContentType};charset=utf-8` });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `time-isle-co-memory-reply-${openedRequest.payload.letterId.slice(-8)}.json`;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
        replyStatus.textContent = "加密回复已导出。它没有自动发送；请把 JSON 文件交还邀请人。";
      } catch (error) {
        replyStatus.textContent = String(error?.code || "").startsWith("CO_MEMORY_")
          ? "回复未导出：请检查文字长度与内容后重试。"
          : "回复未导出；当前页面没有发送或保存任何内容。";
      } finally {
        button.disabled = false;
      }
    });

    function renderRequest(payload) {
      byId("question").textContent = payload.question;
      const context = byId("context");
      context.replaceChildren();
      if (payload.context.title) appendText(context, "展品标题", payload.context.title);
      const visibleNote = payload.context.note.replace(/^\[time-isle-memory-anchor:v1:[A-Za-z0-9_-]{1,120}\](?:\n|$)/u, "");
      if (visibleNote) appendText(context, "邀请人的说明", visibleNote);
      const evidenceTitle = document.createElement("strong");
      evidenceTitle.textContent = "邀请人明确带出的片段";
      context.append(evidenceTitle);
      payload.context.evidence.forEach((entry) => {
        const quote = document.createElement("blockquote");
        quote.textContent = entry.text;
        context.append(quote);
      });
    }

    function appendText(parent, label, text) {
      const field = document.createElement("div");
      const heading = document.createElement("strong");
      const paragraph = document.createElement("p");
      heading.textContent = label;
      paragraph.textContent = text;
      field.append(heading, paragraph);
      parent.append(field);
    }
  }

  function offlineInvitationCss() {
    return `:root{color-scheme:light;--paper:#f4f1ea;--surface:#fffdf8;--ink:#282722;--soft:#6d6a62;--line:#d9d3c6;--accent:#315f58;--accent-soft:#e5eeeb;font-family:Inter,"PingFang SC","Microsoft YaHei",sans-serif}*{box-sizing:border-box}body{min-width:280px;margin:0;background:var(--paper);color:var(--ink);line-height:1.65}main{width:min(720px,calc(100% - 32px));margin:0 auto;padding:max(32px,env(safe-area-inset-top)) max(0px,env(safe-area-inset-right)) 32px max(0px,env(safe-area-inset-left))}header{display:flex;align-items:center;gap:14px;margin-bottom:24px}.mark{display:grid;width:46px;height:46px;place-items:center;border:1px solid var(--ink);border-radius:50%;font-family:serif;font-size:1.25rem}header p,.eyebrow{margin:0;color:var(--accent);font-size:.7rem;font-weight:800;letter-spacing:.12em}h1,h2{margin:0;line-height:1.28}h1{font-size:clamp(1.35rem,5vw,2rem)}h2{font-size:clamp(1.15rem,4vw,1.55rem)}.card{padding:clamp(18px,4vw,30px);border:1px solid var(--line);border-radius:18px;background:var(--surface);box-shadow:0 12px 34px rgba(45,42,35,.06)}.muted,.notice,.status,label small{color:var(--soft);font-size:.8rem}.question-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.question-heading span{flex:0 0 auto;padding:4px 9px;border:1px solid var(--line);border-radius:999px;color:var(--soft);font-size:.7rem}form,.context{display:grid;gap:14px;margin-top:20px}label{display:grid;gap:6px;font-size:.82rem;font-weight:750}input,textarea,button{width:100%;min-height:48px;border:1px solid var(--line);border-radius:10px;font:inherit}input,textarea{padding:10px 12px;background:#fff;color:var(--ink)}textarea{min-height:150px;resize:vertical}button{padding:10px 16px;border-color:var(--accent);background:var(--accent);color:#fff;font-weight:800;cursor:pointer}button:disabled{cursor:wait;opacity:.58}input:focus-visible,textarea:focus-visible,button:focus-visible{outline:3px solid #9ab9b2;outline-offset:2px}.context{padding:16px;border:1px solid var(--line);border-radius:12px;background:#faf8f2}.context div{display:grid;gap:3px}.context p,.context blockquote,.notice,.status{margin:0;overflow-wrap:anywhere}.context blockquote{padding-left:12px;border-left:2px solid var(--accent);white-space:pre-wrap}.notice{padding:12px;border:1px solid var(--line);border-radius:10px;background:var(--accent-soft)}.status{min-height:24px}footer{padding:0 max(16px,env(safe-area-inset-right)) max(20px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));color:var(--soft);font-size:.7rem;text-align:center}[hidden]{display:none!important}@media(max-width:650px){main{width:100%;padding-right:max(16px,env(safe-area-inset-right));padding-left:max(16px,env(safe-area-inset-left))}.card{border-radius:14px}.question-heading{display:grid}.question-heading span{justify-self:start}}@media(max-width:390px){main{padding-right:max(12px,env(safe-area-inset-right));padding-left:max(12px,env(safe-area-inset-left))}.card{padding:16px}}@media(max-width:320px){header{align-items:flex-start}.mark{width:42px;height:42px}.card{padding:14px}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}`;
  }

  function offlineInvitationSafetyCss() {
    return `h1,h2{overflow-wrap:anywhere}.card,.question-heading,.question-heading>div,form,.context,label,input,textarea,button,.context div{min-width:0}h2:focus-visible{outline:3px solid #9ab9b2;outline-offset:2px}`;
  }

  function requireTrustedCryptoSource(value) {
    const source = String(value || "");
    const bytes = new TextEncoder().encode(source).byteLength;
    if (!bytes || bytes > MAX_CRYPTO_SOURCE_BYTES || !source.includes("TimeIsleCoMemoryCrypto") ||
        !source.includes("createResponseEnvelope") || FORBIDDEN_OFFLINE_SOURCE.test(source)) {
      throw letterError("内置加密脚本不符合离线邀请约束。", "CO_MEMORY_CRYPTO_SOURCE_INVALID");
    }
    return source;
  }

  function downloadArtifact(documentRef, artifact, options) {
    const BlobCtor = options.Blob || (typeof Blob !== "undefined" ? Blob : null);
    const urlApi = options.URL || (typeof URL !== "undefined" ? URL : null);
    if (!documentRef || !BlobCtor || !urlApi?.createObjectURL) {
      throw letterError("当前浏览器无法生成下载文件。", "CO_MEMORY_DOWNLOAD_UNAVAILABLE");
    }
    const blob = new BlobCtor([artifact.content], { type: artifact.type });
    const url = urlApi.createObjectURL(blob);
    const link = documentRef.createElement("a");
    link.href = url;
    link.download = artifact.fileName;
    link.hidden = true;
    documentRef.body.append(link);
    link.click();
    link.remove();
    (typeof setTimeout === "function" ? setTimeout : ((callback) => callback()))(() => urlApi.revokeObjectURL(url), 0);
  }

  function clearPasswordFields(form) {
    form?.querySelectorAll?.('input[type="password"]').forEach((input) => { input.value = ""; });
  }

  function setCount(active, selector, value) {
    const target = active.panel.querySelector(selector);
    if (target) target.textContent = String([...String(value || "")].length);
  }

  function setStatus(target, text, tone = "") {
    if (!target) return;
    target.textContent = text;
    target.classList.toggle("is-error", tone === "error");
    target.classList.toggle("is-success", tone === "success");
  }

  function friendlyError(error) {
    const code = String(error?.code || "");
    if (code === "CO_MEMORY_DECRYPT_FAILED") return "无法解锁：口令错误，或文件已损坏、被篡改。未导入任何内容。";
    if (code.includes("BINDING") || code === "CO_MEMORY_UNEXPECTED_INVITATION") return "邀请与回信不匹配，已拒绝导入。";
    if (code === "CO_MEMORY_PASSPHRASE_INVALID") return "口令至少需要 12 个字符，且不能包含控制字符。";
    return String(error?.message || error || "操作没有完成。未保存任何内容。");
  }

  function normalizeRequiredText(value, label, maximum) {
    const normalized = String(value || "").replace(/\r\n?/gu, "\n").trim();
    const length = [...normalized].length;
    if (!length || length > maximum) throw letterError(`${label}需在 1 到 ${maximum} 个字符之间。`, "CO_MEMORY_LETTER_TEXT_INVALID");
    return normalized;
  }

  function normalizeOptionalText(value, maximum) {
    const normalized = String(value || "").replace(/\r\n?/gu, "\n").trim();
    if ([...normalized].length > maximum) throw letterError(`可选文字不能超过 ${maximum} 个字符。`, "CO_MEMORY_LETTER_TEXT_INVALID");
    return normalized;
  }

  function normalizeDisplayText(value, fallback, maximum) {
    const text = String(value || "").replace(/[\u0000-\u001f\u007f]/gu, " ").trim();
    return [...text].slice(0, maximum).join("") || fallback;
  }

  function safeMemoryId(value) {
    const id = String(value || "").trim();
    return MEMORY_ID_PATTERN.test(id) ? id : "";
  }

  function joinMemoryAnchor(memoryId, note) {
    return `[time-isle-memory-anchor:v1:${memoryId}]${note ? `\n${note}` : ""}`;
  }

  function extractMemoryAnchor(payload) {
    const note = payload?.context?.note;
    if (typeof note !== "string") return "";
    return safeMemoryId(note.match(MEMORY_ANCHOR_PATTERN)?.[1]);
  }

  function isCryptoApi(value) {
    return Boolean(value && ["createLetterId", "createResponseId", "createRequestEnvelope", "openRequestEnvelope", "createResponseEnvelope", "openResponseEnvelope", "validateRequestEnvelope", "validateResponseEnvelope", "validateRequestPayload", "validateResponsePayload"].every((key) => typeof value[key] === "function"));
  }

  function requireCryptoApi(value) {
    if (!isCryptoApi(value)) throw letterError("共忆信笺加密核心不可用。", "CO_MEMORY_CRYPTO_UNAVAILABLE");
  }

  function assertExactKeys(value, expected) {
    const actual = Object.keys(value).sort();
    const wanted = [...expected].sort();
    if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
      throw letterError("回信文件包含缺少或不支持的字段。", "CO_MEMORY_REPLY_PACKAGE_INVALID");
    }
  }

  function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function jsonForInlineScript(value) {
    return JSON.stringify(value).replace(/</gu, "\\u003c").replace(/>/gu, "\\u003e").replace(/&/gu, "\\u0026").replace(/\u2028/gu, "\\u2028").replace(/\u2029/gu, "\\u2029");
  }

  function escapeHtml(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }

  function letterError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  return Object.freeze({
    REPLY_PACKAGE_FORMAT,
    REPLY_PACKAGE_CONTENT_TYPE,
    REPLY_PACKAGE_VERSION,
    MAX_REPLY_PACKAGE_BYTES,
    createController,
    renderPanel,
    createRequestPayload,
    createResponsePayload,
    createReplyPackage,
    parseReplyPackage,
    parseReplyPackageBytes,
    openReplyPackage,
    createConfirmationContract,
    createOfflineInvitationHtml,
    requireTrustedCryptoSource,
    extractMemoryAnchor
  });
}));
