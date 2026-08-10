"use strict";

const { test, expect } = require("@playwright/test");

const WRITABLE_BASE_URL = requireWritableBaseURL(process.env.BROWSER_GATE_WRITABLE_BASE_URL);

test.describe("V17.1 isolated writable journeys", () => {
  test("saves raw text and photo first, optionally organizes the same exhibit, then finds it after refresh", async ({ page }, testInfo) => {
    const runtimeErrors = captureRuntimeErrors(page);
    const token = `${testInfo.project.name}-${Date.now()}`;
    const keyword = `萤火码头${token.replace(/[^a-zA-Z0-9]/g, "")}`;
    const rawContent = `完全虚构的测试记忆：我在${keyword}等到一盏迟到的纸灯，旁边有人把橘子分成了四瓣。`;
    const amendedRawContent = `${rawContent} 后来我又补记：风把票根吹进了蓝色铁盒。`;

    await openReadyWritable(page, "compose");
    await expect(page.locator("#trustMode")).toHaveText("私人本地");
    await expect(page.locator("#trustDetails > summary")).toHaveAccessibleName(/保存位置本机 SQLite \+ 媒体目录/u);
    await expect(page.locator("#trustEncryption")).toHaveText("未加密");
    await expect(page.locator("#trustDetails > summary")).toHaveAccessibleName(/静态加密未做静态加密/u);
    await page.locator("#saveOriginalButton").click();
    await expect(page.locator("#rawContent")).toBeFocused();
    await expect(page.locator("#rawContent")).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#rawContent")).toHaveAttribute("aria-describedby", "analyzeStatus");
    await expect(page.locator("#analyzeStatus")).toContainText("请先写下一段记忆正文");

    const png = await page.evaluate((seed) => {
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      const context = canvas.getContext("2d");
      context.fillStyle = "#efe2c8";
      context.fillRect(0, 0, 64, 64);
      const color = [...seed].reduce((value, character) => (value * 33 + character.codePointAt(0)) >>> 0, 5381);
      context.fillStyle = `rgb(${color & 255}, ${(color >>> 8) & 255}, ${(color >>> 16) & 255})`;
      context.fillRect(14, 14, 36, 36);
      return canvas.toDataURL("image/png").split(",")[1];
    }, token);
    await page.locator("#photoInput").setInputFiles({
      name: `synthetic-${token}.png`,
      mimeType: "image/png",
      buffer: Buffer.from(png, "base64")
    });
    await expect(page.locator("#photoTray li")).toHaveCount(1);
    await page.locator("#rawContent").fill(rawContent);
    await expect(page.locator("#rawContent")).not.toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#rawContent")).not.toHaveAttribute("aria-describedby", "analyzeStatus");

    const createResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.origin === WRITABLE_BASE_URL && url.pathname === "/api/memories" && response.request().method() === "POST";
    });
    await page.locator("#saveOriginalButton").click();
    const createResponse = await createResponsePromise;
    expect(createResponse.status()).toBe(201);
    const created = await createResponse.json();
    const memoryId = created.memory.id;
    expect(created.memory.rawContent).toBe(rawContent);
    await expect(page.locator("#saveOriginalButton")).toHaveText("原文已保存", { timeout: 20_000 });
    await expect.poll(async () => {
      const response = await page.request.get(`${WRITABLE_BASE_URL}/api/memories/${encodeURIComponent(memoryId)}`);
      const payload = await response.json();
      return payload.memory.media?.length || 0;
    }, { timeout: 20_000 }).toBe(1);

    let markAnalyzeReachedServer;
    const analyzeReachedServer = new Promise((resolve) => { markAnalyzeReachedServer = resolve; });
    await page.route("**/api/analyze", async (route) => {
      const response = await route.fetch();
      markAnalyzeReachedServer();
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.fulfill({ response });
    }, { times: 1 });
    const analyzeResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.origin === WRITABLE_BASE_URL && url.pathname === "/api/analyze" && response.request().method() === "POST";
    });
    await page.locator("#analyzeButton").click();
    await analyzeReachedServer;
    await page.locator("#rawContent").fill(amendedRawContent);
    const analyzeResponse = await analyzeResponsePromise;
    expect(analyzeResponse.status()).toBe(200);
    expect(await analyzeResponse.json()).toMatchObject({
      persistence: { wrote: false, scope: "none", fields: [] },
      execution: { mode: "local-rules", externalRequestOccurred: false }
    });
    await expect(page.locator("#analyzeStatus")).toContainText("旧结果未采用");
    await expect(page.locator("#saveMemoryButton")).not.toContainText("确认整理");
    const reanalyzeResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.origin === WRITABLE_BASE_URL && url.pathname === "/api/analyze" && response.request().method() === "POST";
    });
    await page.locator("#analyzeButton").click();
    const reanalyzeResponse = await reanalyzeResponsePromise;
    expect(reanalyzeResponse.status()).toBe(200);
    const reanalysis = await reanalyzeResponse.json();
    expect(reanalysis.executionReceipt).toMatchObject({ memoryId, feature: "organize" });
    await expect(page.locator("#saveMemoryButton")).toContainText("确认整理");
    const organizedTitle = await page.locator("#draftTitleInput").inputValue();
    const organizedExhibit = await page.locator("#draftExhibitText").inputValue();
    await page.locator("#draftTitleInput").fill("");
    await page.locator("#draftExhibitText").fill("");
    await page.locator("#saveMemoryButton").click();
    await expect(page.locator("#draftTitleInput")).toBeFocused();
    await expect(page.locator("#draftTitleInput")).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#draftTitleInput")).toHaveAttribute("aria-describedby", "analyzeStatus");
    await page.locator("#draftTitleInput").fill(organizedTitle);
    await expect(page.locator("#draftTitleInput")).not.toHaveAttribute("aria-invalid", "true");
    await page.locator("#saveMemoryButton").click();
    await expect(page.locator("#draftExhibitText")).toBeFocused();
    await expect(page.locator("#draftExhibitText")).toHaveAttribute("aria-invalid", "true");
    await page.locator("#draftExhibitText").fill(organizedExhibit);
    await expect(page.locator("#draftExhibitText")).not.toHaveAttribute("aria-invalid", "true");
    const updateResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.origin === WRITABLE_BASE_URL && url.pathname === `/api/memories/${memoryId}` && response.request().method() === "PUT";
    });
    await page.locator("#saveMemoryButton").click();
    const updateResponse = await updateResponsePromise;
    expect(updateResponse.status()).toBe(200);
    const updated = await updateResponse.json();
    expect(updated.memory.id).toBe(memoryId);
    expect(updated.memory.rawContent).toBe(amendedRawContent);
    expect(updated.persistence.fields).toContain("organize-run");
    await expect(page).toHaveURL(/#collection$/);

    const allMemories = await page.request.get(`${WRITABLE_BASE_URL}/api/memories`);
    const sameMemories = (await allMemories.json()).memories.filter((memory) => memory.id === memoryId);
    expect(sameMemories).toHaveLength(1);
    expect(sameMemories[0].media).toHaveLength(1);

    const searchResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.origin === WRITABLE_BASE_URL && url.pathname === "/api/search" && url.searchParams.get("query") === keyword;
    });
    await page.locator("#searchInput").fill(keyword);
    await searchResponsePromise;
    const card = page.locator(`.memory-card-button[data-memory-id="${memoryId}"]`);
    await expect(card).toBeVisible();
    expect(updated.memory.tags).toContain(updated.memory.emotions[0]);
    const expectedFacets = [];
    const expectedFacetKeys = new Set();
    for (const [values, type] of [[updated.memory.emotions, "情绪"], [updated.memory.tags, "标签"]]) {
      for (const value of values || []) {
        const label = String(value || "").trim().replace(/\s+/gu, " ");
        const key = label.normalize("NFKC").toLocaleLowerCase("zh-CN");
        if (!label || expectedFacetKeys.has(key)) continue;
        expectedFacetKeys.add(key);
        expectedFacets.push({ label, ariaLabel: `${type}：${label}` });
      }
    }
    const renderedFacets = await card.locator("xpath=..").locator(".tag").evaluateAll((chips) => chips.map((chip) => ({
      label: chip.textContent.trim(),
      ariaLabel: chip.getAttribute("aria-label")
    })));
    expect(renderedFacets).toEqual(expectedFacets.slice(0, 4));
    expect(renderedFacets.filter((facet) => facet.label === updated.memory.emotions[0])).toHaveLength(1);
    await card.click();
    await expect(page.locator("#memoryDialog")).toBeVisible();
    await expect(page.locator("#dialogBody .detail-raw")).toContainText("蓝色铁盒");
    await expect(page.locator("#dialogBody img.time-isle-media-image")).toHaveCount(1);
    await page.locator('#memoryDialog button[aria-label="关闭详情"]').click();

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("#runtimeBadge")).toHaveClass(/is-ready/);
    const reopened = page.locator(`.memory-card-button[data-memory-id="${memoryId}"]`);
    await expect(reopened).toBeVisible();
    await reopened.click();
    await expect(page.locator("#dialogBody .detail-raw")).toContainText("蓝色铁盒");
    await expect(page.locator("#dialogBody img.time-isle-media-image")).toHaveCount(1);
    await expectNoPageOverflow(page, `${testInfo.project.name} writable journey`);
    expectNoRuntimeErrors(runtimeErrors, `${testInfo.project.name} writable journey`);
  });

  test("fails closed when the writable origin cannot prove its runtime trust", async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith("desktop-"), "Trust failure behavior only needs one browser profile.");
    let trustAttempts = 0;
    const writes = [];
    page.on("request", (request) => {
      if (!["GET", "HEAD"].includes(request.method())) writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
    });
    await page.route("**/api/runtime/trust", async (route) => {
      trustAttempts += 1;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "synthetic trust outage" }) });
    });
    const response = await page.goto(`${WRITABLE_BASE_URL}/#compose`, { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    await expect(page.locator("#runtimeBadge")).toHaveClass(/is-error/);
    await expect(page.locator("#runtimeBadge")).toContainText("信任状态待确认");
    expect(trustAttempts).toBe(2);
    await expect(page.locator("#trustBar")).toHaveAttribute("data-audience", "unknown");
    for (const id of ["trustMode", "trustStorage", "trustAi", "trustExternal", "trustEncryption"]) {
      await expect(page.locator(`#${id}`)).toHaveText("无法确认");
    }
    await expect(page.locator("#rawContent")).toHaveAttribute("readonly", "");
    await expect(page.locator("#saveOriginalButton")).toBeDisabled();
    await expect(page.locator("#importFile")).toBeDisabled();
    await expect(page.locator("#purgeButton")).toBeDisabled();
    await expect(page.locator("#organizeExternalDisclosure")).toBeHidden();
    await expect(page.locator("#guideExternalDisclosure")).toBeHidden();
    expect(writes).toEqual([]);

    await page.unroute("**/api/runtime/trust");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("#runtimeBadge")).toHaveClass(/is-ready/);
    await expect(page.locator("#trustMode")).toHaveText("私人本地");
    await expect(page.locator("#rawContent")).not.toHaveAttribute("readonly", "");
    await expect(page.locator("#saveOriginalButton")).toBeEnabled();
  });

  test("guards microphone capture on navigation, late choices and backgrounding without losing older clips", async ({ page }, testInfo) => {
    const runtimeErrors = captureRuntimeErrors(page);
    await installTrackProbe(page);
    await page.context().grantPermissions(["microphone"], { origin: WRITABLE_BASE_URL });
    await openReadyWritable(page, "compose");
    const rawContent = `完全虚构的录音守卫测试记忆：${testInfo.project.name}-${Date.now()}。`;
    const createResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.origin === WRITABLE_BASE_URL && url.pathname === "/api/memories" && response.request().method() === "POST";
    });
    await page.locator("#rawContent").fill(rawContent);
    await page.locator("#saveOriginalButton").click();
    const createResponse = await createResponsePromise;
    expect(createResponse.status()).toBe(201);
    expect((await createResponse.json()).memory.rawContent).toBe(rawContent);
    await expect(page.locator("#saveOriginalButton")).toHaveText("原文已保存", { timeout: 20_000 });
    await expect(page.locator("#memoryForm")).not.toHaveAttribute("aria-busy", "true");
    await expect(page.locator("#originalSavedStatus")).toBeVisible();
    await expect(page.locator("#postSaveTools")).toBeVisible();
    expect(await page.evaluate(() => globalThis.__timeIsleTrackRecords?.length || 0)).toBe(0);
    await page.locator(".voice-field > summary").click();
    await expect(page.locator("#voiceRecordButton")).toHaveText("开始录音");
    await expect(page.locator("#voiceRecordButton")).toBeEnabled();
    const uploadResponses = [];
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (url.origin === WRITABLE_BASE_URL && url.pathname === "/api/voice/uploads" && response.request().method() === "POST") uploadResponses.push(response);
    });

    await startRecording(page);
    await page.locator('[data-view="collection"]').click();
    await expect(page.locator("#recordingLeaveDialog")).toBeVisible();
    await expect(page).toHaveURL(/#compose$/);
    await page.locator("#recordingLeaveContinue").click();
    await expect(page.locator("#recordingLeaveDialog")).not.toBeVisible();
    await expect(page.locator("#voiceRecording")).toBeVisible();
    await expectLatestTrackState(page, "live");

    await page.waitForTimeout(600);
    const firstUpload = page.waitForResponse(isVoiceUploadResponse);
    await page.locator('[data-view="collection"]').click();
    await page.locator("#recordingLeaveKeep").click();
    const firstUploadResponse = await firstUpload;
    expect(firstUploadResponse.status()).toBe(201);
    const firstAssetId = (await firstUploadResponse.json()).asset.id;
    await expect(page).toHaveURL(/#collection$/, { timeout: 15_000 });
    await page.locator('[data-view="compose"]').click();
    await expect(page.locator("#voiceList .voice-item")).toHaveCount(1);
    await expect(page.locator("#voiceList .voice-item-meta")).toContainText("已就绪");
    await expectLatestTrackState(page, "ended");
    await expectVoiceAssetsAvailable(page, [firstAssetId]);

    await startRecording(page);
    await page.waitForTimeout(600);
    const uploadsBeforeDiscard = uploadResponses.length;
    await page.locator('[data-view="collection"]').click();
    await page.locator("#recordingLeaveDiscard").click();
    await expect(page).toHaveURL(/#collection$/);
    await page.locator('[data-view="compose"]').click();
    await expect(page.locator("#voiceList .voice-item")).toHaveCount(1);
    await expectLatestTrackState(page, "ended");
    await page.waitForTimeout(500);
    expect(uploadResponses).toHaveLength(uploadsBeforeDiscard);
    await expectVoiceAssetsAvailable(page, [firstAssetId]);

    await startRecording(page);
    await page.waitForTimeout(600);
    const backgroundUpload = page.waitForResponse(isVoiceUploadResponse);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const backgroundUploadResponse = await backgroundUpload;
    expect(backgroundUploadResponse.status()).toBe(201);
    const backgroundAssetId = (await backgroundUploadResponse.json()).asset.id;
    expect(backgroundAssetId).not.toBe(firstAssetId);
    await expect(page.locator("#voiceRecording")).toBeHidden({ timeout: 15_000 });
    await expect(page.locator("#voiceList .voice-item")).toHaveCount(2);
    await expect(page.locator("#voiceList .voice-item-meta")).toHaveCount(2);
    await expect(page.locator("#voiceList .voice-item-meta").nth(1)).toContainText("已就绪");
    await expectLatestTrackState(page, "ended");
    await expectVoiceAssetsAvailable(page, [firstAssetId, backgroundAssetId]);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expectNoPageOverflow(page, `${testInfo.project.name} recording guard`);
    expectNoRuntimeErrors(runtimeErrors, `${testInfo.project.name} recording guard`);

    await startRecording(page);
    await page.waitForTimeout(600);
    const uploadsBeforePageHide = uploadResponses.length;
    await page.goto(`${WRITABLE_BASE_URL}/offline.html`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
    expect(uploadResponses).toHaveLength(uploadsBeforePageHide);
    await expectVoiceAssetsAvailable(page, [firstAssetId, backgroundAssetId]);
  });
});

async function openReadyWritable(page, route) {
  const response = await page.goto(`${WRITABLE_BASE_URL}/#${route}`, { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await expect(page.locator("#runtimeBadge")).toHaveClass(/is-ready/);
  await expect(page.locator(`[data-view-panel="${route}"]`)).toBeVisible();
  const trust = await page.request.get(`${WRITABLE_BASE_URL}/api/runtime/trust`);
  expect(trust.status()).toBe(200);
  expect(await trust.json()).toMatchObject({
    appVersion: "17.1.2",
    schemaVersion: 19,
    audience: "private-local",
    storage: { visitorWritesAllowed: true, durability: "persistent" },
    encryptionAtRest: { enabled: false },
    pwa: { nativeApp: false, responsiveWeb: true }
  });
}

async function startRecording(page) {
  await page.locator("#voiceRecordButton").click();
  await expect(page.locator("#voiceRecording")).toBeVisible({ timeout: 10_000 });
}

async function installTrackProbe(page) {
  await page.addInitScript(() => {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.getUserMedia || globalThis.__timeIsleTrackProbeInstalled) return;
    globalThis.__timeIsleTrackProbeInstalled = true;
    globalThis.__timeIsleTrackRecords = [];
    const original = mediaDevices.getUserMedia.bind(mediaDevices);
    mediaDevices.getUserMedia = async (...args) => {
      const stream = await original(...args);
      for (const track of stream.getTracks()) {
        const record = { track, stopCalls: 0 };
        const stop = track.stop.bind(track);
        track.stop = () => { record.stopCalls += 1; stop(); };
        globalThis.__timeIsleTrackRecords.push(record);
      }
      return stream;
    };
  });
}

async function expectLatestTrackState(page, state) {
  await expect.poll(() => page.evaluate(() => {
    const record = globalThis.__timeIsleTrackRecords?.at(-1);
    return record ? { readyState: record.track.readyState, stopCalls: record.stopCalls } : null;
  })).toMatchObject({ readyState: state, stopCalls: state === "ended" ? 1 : 0 });
}

async function expectVoiceAssetsAvailable(page, assetIds) {
  const statuses = await Promise.all(assetIds.map(async (assetId) => {
    const response = await page.request.head(`${WRITABLE_BASE_URL}/api/voice/assets/${encodeURIComponent(assetId)}/content`);
    return response.status();
  }));
  expect(statuses).toEqual(assetIds.map(() => 200));
}

function isVoiceUploadResponse(response) {
  const url = new URL(response.url());
  return url.origin === WRITABLE_BASE_URL && url.pathname === "/api/voice/uploads" && response.request().method() === "POST";
}

async function expectNoPageOverflow(page, context) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth
  }));
  expect.soft(dimensions.scrollWidth, `${context}: document overflow`).toBeLessThanOrEqual(dimensions.clientWidth + 1);
  expect.soft(dimensions.bodyScrollWidth, `${context}: body overflow`).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

function captureRuntimeErrors(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("response", async (response) => {
    if (response.status() < 400) return;
    const url = new URL(response.url());
    let detail = "";
    try { detail = (await response.text()).slice(0, 240); } catch { /* response body may be unavailable */ }
    errors.push(`response: ${response.status()} ${url.pathname}${url.search} ${detail}`.trim());
  });
  return errors;
}

function expectNoRuntimeErrors(errors, context) {
  expect(errors, `${context}: console error/pageerror`).toEqual([]);
}

function requireWritableBaseURL(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol === "http:" && url.hostname === "127.0.0.1" && url.port) return url.origin;
  } catch {
    // Fall through to the explicit configuration error below.
  }
  throw new Error("BROWSER_GATE_WRITABLE_BASE_URL must be an isolated 127.0.0.1 origin.");
}
