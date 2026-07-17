(function capsuleCryptoModule(root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("node:crypto").webcrypto);
    return;
  }
  root.TimeIsleCapsuleCrypto = factory(root.crypto);
}(typeof globalThis !== "undefined" ? globalThis : self, function createCapsuleCrypto(webCrypto) {
  "use strict";

  const FORMAT = "time-isle.offline-capsule";
  const VERSION = 1;
  const CONTENT_TYPE = "application/vnd.time-isle.offline-exhibit+json";
  const PBKDF2_ITERATIONS = 310000;
  const SALT_BYTES = 16;
  const IV_BYTES = 12;
  const KEY_BITS = 256;
  const TAG_BITS = 128;
  const MIN_PASSPHRASE_LENGTH = 12;
  const MAX_PASSPHRASE_LENGTH = 1024;
  const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
  const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8", { fatal: true });

  function makeHeader() {
    return {
      format: FORMAT,
      version: VERSION,
      contentType: CONTENT_TYPE,
      kdf: {
        name: "PBKDF2",
        hash: "SHA-256",
        iterations: PBKDF2_ITERATIONS,
        saltBytes: SALT_BYTES
      },
      cipher: {
        name: "AES-GCM",
        keyBits: KEY_BITS,
        ivBytes: IV_BYTES,
        tagBits: TAG_BITS
      }
    };
  }

  async function createEnvelope(payload, passphrase, shell) {
    const cryptoApi = requireCrypto();
    const password = requirePassphrase(passphrase);
    const safePayload = cloneJson(payload, "payload");
    const safeShell = normalizeShell(shell, false);
    const header = makeHeader();
    const salt = randomBytes(cryptoApi, SALT_BYTES);
    const iv = randomBytes(cryptoApi, IV_BYTES);
    const key = await deriveKey(cryptoApi, password, salt, ["encrypt"]);
    const plaintext = encoder.encode(JSON.stringify(safePayload));
    const additionalData = authenticatedBytes(header, safeShell);
    const encrypted = await cryptoApi.subtle.encrypt({
      name: "AES-GCM",
      iv,
      additionalData,
      tagLength: TAG_BITS
    }, key, plaintext);
    return {
      header,
      shell: safeShell,
      salt: toBase64Url(salt),
      iv: toBase64Url(iv),
      ciphertext: toBase64Url(new Uint8Array(encrypted))
    };
  }

  async function openEnvelope(input, passphrase) {
    const cryptoApi = requireCrypto();
    const password = requirePassphrase(passphrase);
    const envelope = validateEnvelope(input);
    const salt = fromBase64Url(envelope.salt, SALT_BYTES, "salt");
    const iv = fromBase64Url(envelope.iv, IV_BYTES, "iv");
    const ciphertext = fromBase64Url(envelope.ciphertext, null, "ciphertext");
    if (ciphertext.byteLength <= TAG_BITS / 8) {
      throw capsuleError("The capsule ciphertext is invalid.", "CAPSULE_ENVELOPE_INVALID");
    }
    try {
      const key = await deriveKey(cryptoApi, password, salt, ["decrypt"]);
      const decrypted = await cryptoApi.subtle.decrypt({
        name: "AES-GCM",
        iv,
        additionalData: authenticatedBytes(envelope.header, envelope.shell),
        tagLength: TAG_BITS
      }, key, ciphertext);
      const text = decoder.decode(decrypted);
      return cloneJson(JSON.parse(text), "decrypted payload");
    } catch (error) {
      if (error?.code === "CAPSULE_JSON_INVALID") throw error;
      throw capsuleError(
        "Unable to unlock this capsule. The passphrase or capsule may be incorrect.",
        "CAPSULE_DECRYPT_FAILED"
      );
    }
  }

  function validateEnvelope(input) {
    assertPlainObject(input, "envelope");
    assertExactKeys(input, ["header", "shell", "salt", "iv", "ciphertext"], "envelope");
    const header = normalizeHeader(input.header);
    const shell = normalizeShell(input.shell, true);
    const salt = requireBase64Url(input.salt, "salt");
    const iv = requireBase64Url(input.iv, "iv");
    const ciphertext = requireBase64Url(input.ciphertext, "ciphertext");
    fromBase64Url(salt, SALT_BYTES, "salt");
    fromBase64Url(iv, IV_BYTES, "iv");
    if (fromBase64Url(ciphertext, null, "ciphertext").byteLength <= TAG_BITS / 8) {
      throw capsuleError("The capsule ciphertext is invalid.", "CAPSULE_ENVELOPE_INVALID");
    }
    return { header, shell, salt, iv, ciphertext };
  }

  function normalizeHeader(input) {
    assertPlainObject(input, "header");
    assertExactKeys(input, ["format", "version", "contentType", "kdf", "cipher"], "header");
    assertPlainObject(input.kdf, "header.kdf");
    assertExactKeys(input.kdf, ["name", "hash", "iterations", "saltBytes"], "header.kdf");
    assertPlainObject(input.cipher, "header.cipher");
    assertExactKeys(input.cipher, ["name", "keyBits", "ivBytes", "tagBits"], "header.cipher");
    const expected = makeHeader();
    if (
      input.format !== expected.format ||
      input.version !== expected.version ||
      input.contentType !== expected.contentType ||
      input.kdf.name !== expected.kdf.name ||
      input.kdf.hash !== expected.kdf.hash ||
      input.kdf.iterations !== expected.kdf.iterations ||
      input.kdf.saltBytes !== expected.kdf.saltBytes ||
      input.cipher.name !== expected.cipher.name ||
      input.cipher.keyBits !== expected.cipher.keyBits ||
      input.cipher.ivBytes !== expected.cipher.ivBytes ||
      input.cipher.tagBits !== expected.cipher.tagBits
    ) {
      throw capsuleError("The capsule cryptographic header is unsupported.", "CAPSULE_ENVELOPE_INVALID");
    }
    return expected;
  }

  function normalizeShell(input, validating) {
    assertPlainObject(input, "shell");
    assertExactKeys(input, ["title", "note", "opensAt"], "shell");
    const title = requireText(input.title, "shell.title", 1, 120, validating);
    const note = requireText(input.note, "shell.note", 0, 240, validating);
    if (typeof input.opensAt !== "string" || !ISO_TIMESTAMP_PATTERN.test(input.opensAt)) {
      throw capsuleError("shell.opensAt must be a canonical UTC timestamp.", "CAPSULE_SHELL_INVALID");
    }
    const parsed = new Date(input.opensAt);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== input.opensAt) {
      throw capsuleError("shell.opensAt must be a canonical UTC timestamp.", "CAPSULE_SHELL_INVALID");
    }
    return { title, note, opensAt: input.opensAt };
  }

  function authenticatedBytes(header, shell) {
    return encoder.encode(JSON.stringify({ header, shell }));
  }

  async function deriveKey(cryptoApi, passphrase, salt, usages) {
    const material = await cryptoApi.subtle.importKey(
      "raw",
      encoder.encode(passphrase),
      { name: "PBKDF2" },
      false,
      ["deriveKey"]
    );
    return cryptoApi.subtle.deriveKey({
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256"
    }, material, { name: "AES-GCM", length: KEY_BITS }, false, usages);
  }

  function requirePassphrase(value) {
    if (typeof value !== "string") {
      throw capsuleError("A passphrase is required.", "CAPSULE_PASSPHRASE_INVALID");
    }
    const length = Array.from(value).length;
    if (length < MIN_PASSPHRASE_LENGTH || length > MAX_PASSPHRASE_LENGTH) {
      throw capsuleError(
        `The passphrase must contain ${MIN_PASSPHRASE_LENGTH} to ${MAX_PASSPHRASE_LENGTH} characters.`,
        "CAPSULE_PASSPHRASE_INVALID"
      );
    }
    return value;
  }

  function requireCrypto() {
    if (!webCrypto?.subtle || typeof webCrypto.getRandomValues !== "function") {
      throw capsuleError("Web Crypto is unavailable.", "CAPSULE_CRYPTO_UNAVAILABLE");
    }
    return webCrypto;
  }

  function randomBytes(cryptoApi, length) {
    const bytes = new Uint8Array(length);
    cryptoApi.getRandomValues(bytes);
    return bytes;
  }

  function cloneJson(value, label) {
    assertJsonValue(value, label, new Set(), 0);
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      throw capsuleError(`${label} is not valid JSON.`, "CAPSULE_JSON_INVALID");
    }
  }

  function assertJsonValue(value, label, ancestors, depth) {
    if (depth > 40) throw capsuleError(`${label} is nested too deeply.`, "CAPSULE_JSON_INVALID");
    if (value === null || typeof value === "string" || typeof value === "boolean") return;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw capsuleError(`${label} contains a non-finite number.`, "CAPSULE_JSON_INVALID");
      return;
    }
    if (typeof value !== "object") throw capsuleError(`${label} is not JSON-safe.`, "CAPSULE_JSON_INVALID");
    if (ancestors.has(value)) throw capsuleError(`${label} contains a cycle.`, "CAPSULE_JSON_INVALID");
    ancestors.add(value);
    if (Array.isArray(value)) {
      value.forEach((item, index) => assertJsonValue(item, `${label}[${index}]`, ancestors, depth + 1));
    } else {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        throw capsuleError(`${label} must contain plain objects only.`, "CAPSULE_JSON_INVALID");
      }
      for (const [key, item] of Object.entries(value)) {
        if (["__proto__", "prototype", "constructor"].includes(key)) {
          throw capsuleError(`${label} contains an unsafe key.`, "CAPSULE_JSON_INVALID");
        }
        assertJsonValue(item, `${label}.${key}`, ancestors, depth + 1);
      }
    }
    ancestors.delete(value);
  }

  function requireText(value, label, minimum, maximum, validating) {
    if (typeof value !== "string") throw capsuleError(`${label} must be text.`, "CAPSULE_SHELL_INVALID");
    const text = validating ? value : value.replace(/\s+/gu, " ").trim();
    if (validating && text !== text.trim()) {
      throw capsuleError(`${label} is not canonical text.`, "CAPSULE_SHELL_INVALID");
    }
    const length = Array.from(text).length;
    if (length < minimum || length > maximum || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(text)) {
      throw capsuleError(`${label} has an invalid length or characters.`, "CAPSULE_SHELL_INVALID");
    }
    return text;
  }

  function requireBase64Url(value, label) {
    if (typeof value !== "string" || !BASE64URL_PATTERN.test(value) || value.length % 4 === 1) {
      throw capsuleError(`${label} is not canonical base64url.`, "CAPSULE_ENVELOPE_INVALID");
    }
    return value;
  }

  function toBase64Url(value) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    const encoded = typeof btoa === "function"
      ? btoa(binary)
      : Buffer.from(bytes).toString("base64");
    return encoded.replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
  }

  function fromBase64Url(value, expectedLength, label) {
    requireBase64Url(value, label);
    const base64 = value.replace(/-/gu, "+").replace(/_/gu, "/") + "=".repeat((4 - value.length % 4) % 4);
    let bytes;
    try {
      if (typeof atob === "function") {
        const binary = atob(base64);
        bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      } else {
        bytes = new Uint8Array(Buffer.from(base64, "base64"));
      }
    } catch {
      throw capsuleError(`${label} is not valid base64url.`, "CAPSULE_ENVELOPE_INVALID");
    }
    if (toBase64Url(bytes) !== value || (expectedLength !== null && bytes.byteLength !== expectedLength)) {
      throw capsuleError(`${label} has an invalid encoding or length.`, "CAPSULE_ENVELOPE_INVALID");
    }
    return bytes;
  }

  function assertPlainObject(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw capsuleError(`${label} must be an object.`, "CAPSULE_ENVELOPE_INVALID");
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw capsuleError(`${label} must be a plain object.`, "CAPSULE_ENVELOPE_INVALID");
    }
  }

  function assertExactKeys(value, expected, label) {
    const actual = Object.keys(value).sort();
    const wanted = [...expected].sort();
    if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
      throw capsuleError(`${label} contains unsupported fields.`, "CAPSULE_ENVELOPE_INVALID");
    }
  }

  function createOfflineHtml(input) {
    const envelope = validateEnvelope(input);
    const embedded = escapeEmbeddedJson(JSON.stringify(envelope));
    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src blob: data:; media-src blob: data:; connect-src 'none'; font-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'">
  <meta name="referrer" content="no-referrer">
  <title>时屿 · 离线时间胶囊</title>
  <style>
    :root{color-scheme:light;--paper:#f8f6f1;--ink:#26302d;--soft:#6f7772;--line:#ddd8cd;--accent:#42665b;--card:#fffdf8;--danger:#8a4740}*{box-sizing:border-box}html,body{min-height:100%;background:var(--paper);color:var(--ink)}html{font-family:ui-serif,"Noto Serif SC","Songti SC",serif}body{margin:0}button,input{font:inherit}[hidden]{display:none!important}.page{width:min(46rem,100%);margin:0 auto;padding:max(2rem,env(safe-area-inset-top)) 1.15rem max(4rem,env(safe-area-inset-bottom))}.shell{text-align:center;padding:clamp(2.5rem,10vh,6rem) 0 2rem}.eyebrow{margin:0 0 .8rem;color:var(--accent);font:600 .76rem/1.2 ui-sans-serif,system-ui,sans-serif;letter-spacing:.18em}.shell h1{margin:0;font-size:clamp(2rem,8vw,3.5rem);font-weight:500;line-height:1.15}.shell-note{max-width:32rem;margin:1rem auto 0;color:var(--soft);line-height:1.8}.gate,.unlock{max-width:30rem;margin:1.3rem auto 0;padding:1.2rem;border:1px solid var(--line);border-radius:1.2rem;background:var(--card);box-shadow:0 1rem 3rem rgba(38,48,45,.05)}.gate time{display:block;margin-top:.45rem;color:var(--accent);font-weight:600}.unlock label{display:block;margin-bottom:.55rem;text-align:left;font:600 .82rem/1.4 ui-sans-serif,system-ui,sans-serif}.unlock-row{display:flex;gap:.55rem}.unlock input{min-width:0;flex:1;border:1px solid var(--line);border-radius:.8rem;background:#fff;padding:.82rem 1rem;color:var(--ink)}.unlock button{border:0;border-radius:.8rem;background:var(--accent);color:#fff;padding:.82rem 1.1rem;cursor:pointer}.unlock button:disabled{opacity:.58}.status{min-height:1.4em;margin:.7rem 0 0;color:var(--danger);font:500 .82rem/1.5 ui-sans-serif,system-ui,sans-serif}.exhibit{padding-top:1rem}.exhibit-header{padding:1rem 0 2.2rem;border-bottom:1px solid var(--line)}.exhibit-header h2{margin:0;font-size:clamp(1.7rem,6vw,2.5rem);font-weight:500}.theme{margin:.55rem 0;color:var(--accent);font:600 .8rem/1.4 ui-sans-serif,system-ui,sans-serif;letter-spacing:.08em}.opening{margin:1.2rem 0 0;color:var(--soft);line-height:1.9}.section{padding:2.5rem 0;border-bottom:1px solid var(--line)}.section-index{color:var(--accent);font:600 .75rem/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.16em}.section h3{margin:.5rem 0;font-size:1.5rem;font-weight:500}.section-summary{margin:.5rem 0 1.6rem;color:var(--soft);line-height:1.75}.item{margin-top:1rem;padding:1.2rem;border:1px solid var(--line);border-radius:1.1rem;background:var(--card)}.item h4{margin:0;font-size:1.15rem;font-weight:600}.excerpt,.curator-note,.quote,.transcript{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.8}.excerpt{margin:.85rem 0}.curator-note{margin:.8rem 0 0;padding-left:.8rem;border-left:2px solid var(--line);color:var(--soft);font-size:.92rem}.quotes,.transcripts{margin-top:1rem;padding-top:.9rem;border-top:1px dashed var(--line)}.quotes h5,.transcripts h5{margin:0 0 .45rem;color:var(--accent);font:600 .78rem/1.4 ui-sans-serif,system-ui,sans-serif;letter-spacing:.08em}.quote{margin:.5rem 0;padding:.65rem .8rem;border-left:2px solid var(--accent);color:var(--soft)}.media{display:grid;gap:.8rem;margin-top:1rem}.media figure{margin:0}.media img{display:block;width:100%;height:auto;border-radius:.8rem;background:#ece9e1}.media figcaption{margin-top:.45rem;color:var(--soft);font-size:.82rem;line-height:1.5}.transcript{margin:.45rem 0;color:var(--soft);font-size:.92rem}@media(max-width:32rem){.unlock-row{flex-direction:column}.unlock button{width:100%}.page{padding-inline:.9rem}.item{padding:1rem}}
  </style>
</head>
<body>
  <main class="page">
    <header class="shell" aria-labelledby="shellTitle">
      <p class="eyebrow">TIME ISLE · OFFLINE CAPSULE</p>
      <h1 id="shellTitle"></h1>
      <p class="shell-note" id="shellNote"></p>
      <section class="gate" id="dateGate"><span>这枚胶囊会在约定日期之后接受口令。</span><time id="opensAt"></time></section>
      <form class="unlock" id="unlockForm" hidden autocomplete="off">
        <label for="passphrase">输入只属于你的开启口令</label>
        <div class="unlock-row"><input id="passphrase" type="password" minlength="12" maxlength="1024" required autocomplete="new-password" spellcheck="false"><button id="unlockButton" type="submit">开启胶囊</button></div>
        <p class="status" id="unlockStatus" role="status" aria-live="polite"></p>
      </form>
    </header>
    <article class="exhibit" id="exhibit" hidden aria-live="polite"></article>
  </main>
  <script type="application/json" id="capsuleEnvelope">${embedded}</script>
  <script>
  (()=>{"use strict";
    const envelope=JSON.parse(document.getElementById("capsuleEnvelope").textContent),shellTitle=document.getElementById("shellTitle"),shellNote=document.getElementById("shellNote"),dateGate=document.getElementById("dateGate"),opensAt=document.getElementById("opensAt"),form=document.getElementById("unlockForm"),passphrase=document.getElementById("passphrase"),button=document.getElementById("unlockButton"),status=document.getElementById("unlockStatus"),exhibit=document.getElementById("exhibit"),encoder=new TextEncoder(),objectUrls=new Set();
    shellTitle.textContent=envelope.shell.title;shellNote.textContent=envelope.shell.note;opensAt.dateTime=envelope.shell.opensAt;opensAt.textContent=new Intl.DateTimeFormat("zh-CN",{dateStyle:"long",timeStyle:"short"}).format(new Date(envelope.shell.opensAt));
    function refreshGate(){const waiting=Date.now()<Date.parse(envelope.shell.opensAt);dateGate.hidden=!waiting;form.hidden=waiting||!exhibit.hidden;if(!waiting&&exhibit.hidden)passphrase.focus();}
    function decode(value){const base64=value.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-value.length%4)%4),binary=atob(base64),bytes=new Uint8Array(binary.length);for(let index=0;index<binary.length;index+=1)bytes[index]=binary.charCodeAt(index);return bytes;}
    async function unlock(password){const material=await crypto.subtle.importKey("raw",encoder.encode(password),{name:"PBKDF2"},false,["deriveKey"]),key=await crypto.subtle.deriveKey({name:"PBKDF2",salt:decode(envelope.salt),iterations:310000,hash:"SHA-256"},material,{name:"AES-GCM",length:256},false,["decrypt"]),aad=encoder.encode(JSON.stringify({header:envelope.header,shell:envelope.shell})),plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:decode(envelope.iv),additionalData:aad,tagLength:128},key,decode(envelope.ciphertext));return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(plain));}
    function element(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=String(text);return node;}
    function releaseUrls(){for(const value of objectUrls)URL.revokeObjectURL(value);objectUrls.clear();}
    function assertPayload(data){if(!data||data.format!=="time-isle.offline-exhibit"||data.version!==1||!Array.isArray(data.sections)||!Array.isArray(data.media))throw new Error("invalid");}
    function imageFigure(media){if(media.mimeType!=="image/webp"||typeof media.dataBase64!=="string")throw new Error("invalid");const binary=atob(media.dataBase64),bytes=new Uint8Array(binary.length);for(let index=0;index<binary.length;index+=1)bytes[index]=binary.charCodeAt(index);const objectUrl=URL.createObjectURL(new Blob([bytes],{type:"image/webp"})),figure=element("figure"),image=element("img");objectUrls.add(objectUrl);image.alt=String(media.alt||"");image.loading="lazy";image.decoding="async";image.width=Number(media.width)||1;image.height=Number(media.height)||1;const release=()=>{URL.revokeObjectURL(objectUrl);objectUrls.delete(objectUrl);};image.addEventListener("load",release,{once:true});image.addEventListener("error",release,{once:true});image.src=objectUrl;figure.append(image);if(media.caption)figure.append(element("figcaption","",media.caption));return figure;}
    function render(data){assertPayload(data);releaseUrls();exhibit.replaceChildren();const header=element("header","exhibit-header");header.append(element("h2","",data.title));if(data.theme)header.append(element("p","theme",data.theme));if(data.opening)header.append(element("p","opening",data.opening));exhibit.append(header);const mediaByKey=new Map(data.media.map(value=>[value.key,value]));data.sections.forEach((section,sectionIndex)=>{const sectionNode=element("section","section"),items=Array.isArray(section.items)?section.items:[];sectionNode.append(element("span","section-index",String(sectionIndex+1).padStart(2,"0")),element("h3","",section.title));if(section.summary)sectionNode.append(element("p","section-summary",section.summary));items.forEach(item=>{const itemNode=element("article","item");itemNode.append(element("h4","",item.title));if(item.excerpt)itemNode.append(element("p","excerpt",item.excerpt));if(item.curatorNote)itemNode.append(element("p","curator-note",item.curatorNote));if(Array.isArray(item.confirmedQuotes)&&item.confirmedQuotes.length){const quotes=element("section","quotes");quotes.append(element("h5","","已确认原文引用"));item.confirmedQuotes.forEach(text=>quotes.append(element("blockquote","quote",text)));itemNode.append(quotes);}if(Array.isArray(item.mediaKeys)&&item.mediaKeys.length){const gallery=element("div","media");item.mediaKeys.forEach(key=>{const media=mediaByKey.get(key);if(!media||media.itemKey!==item.key)throw new Error("invalid");gallery.append(imageFigure(media));});itemNode.append(gallery);}if(Array.isArray(item.confirmedTranscripts)&&item.confirmedTranscripts.length){const transcripts=element("section","transcripts");transcripts.append(element("h5","","确认声音文字"));item.confirmedTranscripts.forEach(text=>transcripts.append(element("p","transcript",text)));itemNode.append(transcripts);}sectionNode.append(itemNode);});exhibit.append(sectionNode);});exhibit.hidden=false;dateGate.hidden=true;form.hidden=true;}
    form.addEventListener("submit",async event=>{event.preventDefault();status.textContent="";if(Date.now()<Date.parse(envelope.shell.opensAt)){refreshGate();return;}const password=passphrase.value;if(Array.from(password).length<12){status.textContent="口令至少需要 12 个字符。";return;}button.disabled=true;button.textContent="正在开启…";try{const payload=await unlock(password);render(payload);passphrase.value="";}catch{releaseUrls();exhibit.replaceChildren();exhibit.hidden=true;passphrase.value="";status.textContent="无法开启。请检查口令，或确认文件没有被改动。";}finally{button.disabled=false;button.textContent="开启胶囊";}});
    window.addEventListener("beforeunload",releaseUrls,{once:true});refreshGate();window.setInterval(refreshGate,30000);
  })();
  </script>
</body>
</html>`;
  }

  function escapeEmbeddedJson(value) {
    return value
      .replace(/&/gu, "\\u0026")
      .replace(/</gu, "\\u003c")
      .replace(/>/gu, "\\u003e")
      .replace(/\u2028/gu, "\\u2028")
      .replace(/\u2029/gu, "\\u2029");
  }

  function capsuleError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  return Object.freeze({
    FORMAT,
    VERSION,
    CONTENT_TYPE,
    PBKDF2_ITERATIONS,
    SALT_BYTES,
    IV_BYTES,
    KEY_BITS,
    TAG_BITS,
    MIN_PASSPHRASE_LENGTH,
    createEnvelope,
    openEnvelope,
    encryptPayload: createEnvelope,
    decryptPayload: openEnvelope,
    validateEnvelope,
    createOfflineHtml
  });
}));
