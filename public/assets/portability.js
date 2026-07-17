(function initializeTimeIslePortability(global) {
  "use strict";

  function createController(options = {}) {
    const documentRef = options.document || global.document;
    const fetchImpl = options.fetch || global.fetch?.bind(global);
    if (!documentRef || !fetchImpl) throw new Error("完整备份控制器缺少浏览器能力。");
    const elements = {
      full: documentRef.querySelector("#exportButton"),
      redacted: documentRef.querySelector("#exportRedactedButton"),
      input: documentRef.querySelector("#archiveImportFile"),
      status: documentRef.querySelector("#dataActionStatus"),
      otherActions: [...documentRef.querySelectorAll("#purgeButton, #exportJsonButton, #exportRedactedJsonButton, #importFile")]
    };
    if (Object.values(elements).some((element) => !element)) throw new Error("完整备份控制器缺少页面入口。");
    let demo = Boolean(options.demo);
    let busy = false;
    let session = 0;
    let activeRequest = null;
    const listeners = [];

    bind(elements.full, "click", () => exportArchive("full"));
    bind(elements.redacted, "click", () => exportArchive("redacted"));
    bind(elements.input, "change", importArchive);
    renderAccess();

    function bind(target, type, handler) {
      target.addEventListener(type, handler);
      listeners.push({ target, type, handler });
    }

    async function exportArchive(mode) {
      if (busy) return;
      const run = ++session;
      const suffix = mode === "redacted" ? "?mode=redacted" : "";
      const exportUrl = `/api/archive/export${suffix}`;
      const suggestedName = `time-isle-${mode}-${new Date().toISOString().slice(0, 10)}.time-isle`;
      let writable = null;
      setBusy(true);
      setStatus(mode === "redacted" ? "正在准备不含照片的脱敏归档…" : "正在校验并打包馆藏与照片…");
      try {
        const savePicker = typeof options.showSaveFilePicker === "function"
          ? options.showSaveFilePicker
          : typeof global.showSaveFilePicker === "function"
            ? global.showSaveFilePicker.bind(global)
            : null;
        if (typeof savePicker !== "function") {
          triggerNativeDownload(exportUrl, suggestedName, documentRef);
          setStatus("归档已交给浏览器流式下载；完成前请勿关闭下载任务。", false, true);
          return;
        }
        const handle = await savePicker({
          suggestedName,
          types: [{
            description: "时屿完整归档",
            accept: { "application/vnd.time-isle": [".time-isle"] }
          }]
        });
        if (run !== session) return;
        activeRequest?.abort();
        activeRequest = new AbortController();
        writable = await handle.createWritable();
        const response = await fetchImpl(exportUrl, {
          headers: { Accept: "application/vnd.time-isle" },
          signal: activeRequest.signal
        });
        if (!response.ok) throw new Error(await responseError(response));
        if (!response.body || typeof response.body.pipeTo !== "function") {
          try { await writable?.abort?.(); } catch { /* browser may already have aborted it */ }
          writable = null;
          activeRequest.abort();
          triggerNativeDownload(exportUrl, suggestedName, documentRef);
          setStatus("当前浏览器不支持直接写入文件，已改用浏览器原生流式下载；完成前请勿关闭下载任务。", false, true);
          return;
        }
        await response.body.pipeTo(writable, { signal: activeRequest.signal });
        writable = null;
        if (run !== session) return;
        setStatus(mode === "redacted"
          ? "脱敏 .time-isle 已下载；归档物理上不包含图片文件。"
          : "完整 .time-isle 已下载，包含馆藏、照片、图片线索与时光拼图，请妥善保管。", false, true);
      } catch (error) {
        try { await writable?.abort?.(); } catch { /* browser may already have aborted it */ }
        if (run === session) {
          if (error?.name === "AbortError") setStatus("已取消归档导出。", false, false);
          else setStatus(`导出失败：${message(error)}`, true);
        }
      } finally {
        if (run === session) {
          activeRequest = null;
          setBusy(false);
        }
      }
    }

    async function importArchive(event) {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file || demo || busy) return;
      if (!String(file.name || "").toLowerCase().endsWith(".time-isle")) {
        setStatus("请选择扩展名为 .time-isle 的完整备份。", true);
        return;
      }
      const confirmed = global.confirm("恢复会先完整校验归档，再把其中展品作为新副本加入当前馆藏；相同图片会复用。是否继续？");
      if (!confirmed) {
        setStatus("已取消恢复。", false, false);
        return;
      }
      const run = ++session;
      activeRequest?.abort();
      activeRequest = new AbortController();
      setBusy(true);
      setStatus(`正在校验并恢复 ${file.name}；任何损坏都会整批取消…`);
      try {
        const response = await fetchImpl("/api/archive/restore", {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream", Accept: "application/json" },
          body: file,
          signal: activeRequest.signal
        });
        const result = await readJson(response);
        if (!response.ok) throw new Error(result.error || "完整备份恢复失败。");
        if (run !== session) return;
        await options.onRestored?.(result);
        const mediaNote = result.media?.links ? `、${result.media.links} 条照片关联` : "";
        const puzzleNote = result.archaeology?.events ? `、${result.archaeology.events} 组时光拼图` : "";
        setStatus(`已原子恢复 ${result.imported || 0} 件展品${mediaNote}${puzzleNote}。`, false, true);
      } catch (error) {
        if (run === session && error?.name !== "AbortError") setStatus(`恢复失败，未保留不完整数据：${message(error)}`, true);
      } finally {
        if (run === session) {
          activeRequest = null;
          setBusy(false);
        }
      }
    }

    function setBusy(value) {
      busy = Boolean(value);
      renderAccess();
    }

    function setDemo(value) {
      demo = Boolean(value);
      if (demo) {
        session += 1;
        activeRequest?.abort();
        activeRequest = null;
        busy = false;
      }
      renderAccess();
    }

    function renderAccess() {
      elements.full.disabled = busy;
      elements.redacted.disabled = busy;
      elements.input.disabled = demo || busy;
      elements.otherActions.forEach((element) => {
        element.disabled = busy || (demo && ["purgeButton", "importFile"].includes(element.id));
      });
      const label = elements.input.previousElementSibling;
      label?.classList.toggle("is-disabled", demo || busy);
      label?.setAttribute("aria-disabled", String(demo || busy));
      label && (label.title = demo ? "公开 Demo 已禁用恢复" : busy ? "另一项备份操作正在进行" : "恢复完整备份");
      const legacyImport = documentRef.querySelector('label[for="importFile"]');
      legacyImport?.classList.toggle("is-disabled", demo || busy);
      legacyImport?.setAttribute("aria-disabled", String(demo || busy));
    }

    function setStatus(text, isError = false, isSuccess = false) {
      elements.status.textContent = text;
      elements.status.classList.toggle("is-error", isError);
      elements.status.classList.toggle("is-success", isSuccess);
    }

    function destroy() {
      session += 1;
      activeRequest?.abort();
      listeners.forEach(({ target, type, handler }) => target.removeEventListener(type, handler));
      listeners.length = 0;
    }

    return Object.freeze({ setDemo, destroy, exportArchive });
  }

  async function responseError(response) {
    const body = await readJson(response);
    return body.error || `请求失败（${response.status}）`;
  }

  async function readJson(response) {
    try { return await response.json(); } catch { return {}; }
  }

  function triggerNativeDownload(url, filename, documentRef) {
    const link = documentRef.createElement("a");
    link.href = url;
    link.download = filename;
    documentRef.body.appendChild(link);
    link.click();
    link.remove();
  }

  function message(error) {
    return String(error?.message || error || "未知错误");
  }

  global.TimeIslePortability = Object.freeze({ createController });
})(typeof window !== "undefined" ? window : globalThis);
