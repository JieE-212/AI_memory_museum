(function initializeTimeIsleMediaIntelligence(global) {
  "use strict";

  function capturedAtHint(item) {
    return (Array.isArray(item?.hints) ? item.hints : []).find((hint) => (
      hint?.kind === "captured_at" && !hint.sensitive && hint.value?.localDateTime
    )) || null;
  }

  function renderExifHints(item, options = {}) {
    const captured = capturedAtHint(item);
    const hasSensitiveLocation = (Array.isArray(item?.hints) ? item.hints : [])
      .some((hint) => hint?.kind === "gps_coordinates" && hint.sensitive);
    const lines = [];
    if (captured) {
      const localDateTime = String(captured.value.localDateTime);
      const timezone = captured.value.timezone?.kind === "offset"
        ? ` ${captured.value.timezone.value}`
        : "（原图未记录时区）";
      const alreadyUsed = item?.metadata?.capturedAtSource === "exif-confirmed-by-user"
        && item.capturedAt === localDateTime;
      const disabled = options.demo || options.busy ? " disabled" : "";
      lines.push(`<p><span>原图提供拍摄时间线索：<time datetime="${escapeAttribute(localDateTime)}">${escapeHtml(localDateTime.replace("T", " "))}</time>${escapeHtml(timezone)}</span>${alreadyUsed ? "<strong>已采用</strong>" : `<button type="button" class="text-link" data-photo-hint-action="use-captured-at"${disabled}>采用这条线索</button>`}</p>`);
    }
    if (hasSensitiveLocation) {
      lines.push("<p><span>原图含敏感位置坐标；时屿不会自动读取为地点，也不会联网反查。</span><strong>默认不使用</strong></p>");
    }
    return lines.join("");
  }

  function createFingerprintSample(source, documentRef) {
    if (!source || !documentRef) throw new Error("无法创建图片指纹采样。");
    const width = 9;
    const height = 8;
    const canvas = documentRef.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
    if (!context) throw new Error("当前浏览器无法生成图片检索指纹。");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(source, 0, 0, width, height);
    const bytes = context.getImageData(0, 0, width, height).data;
    let binary = "";
    for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
    canvas.width = 1;
    canvas.height = 1;
    if (typeof global.btoa !== "function") throw new Error("当前浏览器无法编码图片检索指纹。");
    return { width, height, rgbaBase64: global.btoa(binary) };
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  global.TimeIsleMediaIntelligence = Object.freeze({
    capturedAtHint,
    renderExifHints,
    createFingerprintSample
  });
})(typeof window !== "undefined" ? window : globalThis);
