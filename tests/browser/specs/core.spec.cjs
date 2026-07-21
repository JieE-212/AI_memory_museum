"use strict";

const { test, expect } = require("@playwright/test");

const ROUTES = Object.freeze([
  { view: "collection", panel: "#view-collection" },
  { view: "compose", panel: "#view-compose" },
  { view: "reflect", panel: "#view-reflect" },
  { view: "data", panel: "#view-data" }
]);

test.describe("V17 interview-demo browser gate", () => {
  test("starts the isolated Demo and keeps all four primary routes usable", async ({ page }, testInfo) => {
    const runtimeErrors = captureRuntimeErrors(page);
    await openReadyDemo(page, "collection");

    const navigation = page.locator(".main-nav");
    await expect(navigation).toBeVisible();
    await expect(navigation.locator("[data-view]" )).toHaveCount(4);

    for (const route of ROUTES) {
      await test.step(`route #${route.view}`, async () => {
        const button = navigation.locator(`[data-view="${route.view}"]`);
        await button.click();
        await expect(page).toHaveURL(new RegExp(`#${route.view}$`));
        await expect(button).toHaveAttribute("aria-current", "page");
        await expect(page.locator(route.panel)).toBeVisible();
        await expect(page.locator(`[data-view-panel]:visible`)).toHaveCount(1);
        await expectNoPageOverflow(page, `${testInfo.project.name} #${route.view}`);
      });
    }

    await expectNavigationLayout(page, testInfo.project.name.startsWith("mobile-"));
    expectNoRuntimeErrors(runtimeErrors, `${testInfo.project.name} primary routes`);
  });

  test("keeps semantic recall opt-in and runs the pinned model without third-party requests", async ({ page }, testInfo) => {
    const runtimeErrors = captureRuntimeErrors(page);
    const observed = [];
    const allNetworkOrigins = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.protocol === "http:" || url.protocol === "https:") allNetworkOrigins.push(url.origin);
      if (url.pathname.startsWith("/api/semantic-recall") || url.pathname.startsWith("/assets/models/v17/") ||
          url.pathname.startsWith("/assets/vendor/transformers-3.8.1/")) {
        observed.push({ origin: url.origin, method: request.method(), path: url.pathname });
      }
    });
    await openReadyDemo(page, "reflect");
    const panel = page.locator("#semanticRecallDetails");
    await expect(panel).not.toHaveAttribute("open", "");
    expect(observed).toEqual([]);
    await panel.locator(":scope > summary").click();
    await expect(panel).toHaveAttribute("open", "");
    await page.waitForTimeout(150);
    expect(observed).toEqual([]);
    expect([...new Set(allNetworkOrigins)]).toEqual([new URL(page.url()).origin]);
    await page.evaluate(() => {
      const long = "没有空格的超长记忆线索".repeat(60);
      window.TimeIsleSemanticRecall.renderResults([
        { rank: 1, memoryId: "memory-long-layout", title: long, excerpt: long, tags: [long], similarity: 0.5 }
      ], () => {}, document.querySelector("#semanticRecallResults"), document);
    });
    const longResultLayout = await page.locator("#semanticRecallResults .semantic-recall-result").evaluate((card) => ({
      cardScrollWidth: card.scrollWidth,
      cardClientWidth: card.clientWidth,
      buttonScrollWidth: card.firstElementChild.scrollWidth,
      buttonClientWidth: card.firstElementChild.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth
    }));
    expect(longResultLayout.cardScrollWidth).toBeLessThanOrEqual(longResultLayout.cardClientWidth);
    expect(longResultLayout.buttonScrollWidth).toBeLessThanOrEqual(longResultLayout.buttonClientWidth);
    expect(longResultLayout.documentScrollWidth).toBeLessThanOrEqual(longResultLayout.viewportWidth);
    await expectNoPageOverflow(page, `${testInfo.project.name} semantic disclosure`);

    if (!testInfo.project.name.startsWith("desktop-")) {
      expectNoRuntimeErrors(runtimeErrors, `${testInfo.project.name} semantic disclosure`);
      return;
    }

    const storageBefore = await page.evaluate(async () => ({
      local: Object.keys(localStorage).sort(),
      session: Object.keys(sessionStorage).sort(),
      indexedDb: typeof indexedDB.databases === "function" ? (await indexedDB.databases()).map((item) => item.name || "").sort() : [],
      cacheStorage: await caches.keys()
    }));
    const delayedSnapshot = await page.request.get("/api/semantic-recall/snapshot");
    expect(delayedSnapshot.status()).toBe(200);
    const delayedBody = await delayedSnapshot.text();
    await page.route("**/api/semantic-recall/snapshot", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      try {
        await route.fulfill({ status: 200, contentType: "application/json", body: delayedBody });
      } catch {
        // The page intentionally aborted this one pending response.
      }
    }, { times: 1 });
    await page.locator("#semanticRecallPrepare").click();
    await expect(page.locator("#semanticRecallStop")).toBeVisible();
    await page.locator("#semanticRecallStop").click();
    await page.waitForTimeout(350);
    expect(observed.some((item) => item.path.startsWith("/assets/models/v17/") || item.path.startsWith("/assets/vendor/transformers-3.8.1/"))).toBe(false);

    await page.locator("#semanticRecallPrepare").click();
    await expect(page.locator("#semanticRecallStatus")).toContainText("设备语义已准备", { timeout: 40_000 });
    const maximumInputTokens = Number(await panel.getAttribute("data-semantic-max-tokens"));
    expect(maximumInputTokens).toBeGreaterThan(0);
    expect(maximumInputTokens).toBeLessThanOrEqual(512);
    expect(observed.some((item) => item.path === "/api/semantic-recall/snapshot" && item.method === "GET")).toBe(true);
    expect(observed.some((item) => item.path.endsWith("/onnx/model_quantized.onnx"))).toBe(true);
    expect(observed.every((item) => item.origin === new URL(page.url()).origin)).toBe(true);
    expect([...new Set(allNetworkOrigins)]).toEqual([new URL(page.url()).origin]);

    const naturalDescription = "最迷茫的时候朋友一直陪着听我说话";
    await page.locator("#semanticRecallQuery").fill(naturalDescription);
    await page.locator("#semanticRecallSubmit").click();
    const results = page.locator("#semanticRecallResults .semantic-recall-result");
    await expect(results).toHaveCount(4, { timeout: 15_000 });
    await expect(results.first()).toContainText("低谷里打来的电话");
    expect(observed.every((item) => !decodeURIComponent(item.path).includes(naturalDescription))).toBe(true);
    expect([...new Set(allNetworkOrigins)]).toEqual([new URL(page.url()).origin]);
    await expect(page.locator("#semanticRecallStatus")).toContainText("不是事实、关系或真实性判断");
    await page.locator("#semanticRecallClear").click();
    await expect(page.locator("#semanticRecallResults")).toBeHidden();
    await expect(page.locator("#semanticRecallQuery")).toHaveValue("");
    const storageAfter = await page.evaluate(async () => ({
      local: Object.keys(localStorage).sort(),
      session: Object.keys(sessionStorage).sort(),
      indexedDb: typeof indexedDB.databases === "function" ? (await indexedDB.databases()).map((item) => item.name || "").sort() : [],
      cacheStorage: await caches.keys()
    }));
    expect(storageAfter).toEqual(storageBefore);
    expectNoRuntimeErrors(runtimeErrors, `${testInfo.project.name} semantic inference`);
  });

  test("loads only the synthetic curator sample and rejects persistence", async ({ page, request }, testInfo) => {
    const runtimeErrors = captureRuntimeErrors(page);
    const before = await request.get("/api/curator-agent/runs?limit=20");
    expect(before.status()).toBe(200);
    await expectRunsEmpty(before);

    await openReadyDemo(page, "reflect");
    const observed = [];
    page.on("request", (browserRequest) => {
      const url = new URL(browserRequest.url());
      if (url.pathname.startsWith("/api/curator-agent")) {
        observed.push({ method: browserRequest.method(), path: `${url.pathname}${url.search}` });
      }
    });

    const sampleResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === "GET" && url.pathname === "/api/curator-agent/sample";
    });
    await page.locator("#curatorAgentButton").click();
    const sampleResponse = await sampleResponsePromise;
    expect(sampleResponse.status()).toBe(200);
    const sample = await sampleResponse.json();
    expect(sample).toMatchObject({
      demo: true,
      synthetic: true,
      run: { id: "curator-demo-sample" }
    });

    await expect(page.locator("#curatorAgentDialog")).toBeVisible();
    await expect(page.locator("#curatorAgentWorkspace")).toBeVisible();
    await expect(page.locator("#curatorAgentProposal")).toBeVisible();
    await expect(page.locator("#curatorAgentStatus")).toContainText("只读");
    await expect(page.locator("#curatorAgentStartButton")).toBeDisabled();

    const decisions = page.locator("#curatorAgentDecisionList [data-curator-action]");
    expect(await decisions.count()).toBeGreaterThan(0);
    for (let index = 0; index < await decisions.count(); index += 1) {
      await expect(decisions.nth(index)).toBeDisabled();
    }
    expect(observed).toEqual([{ method: "GET", path: "/api/curator-agent/sample" }]);
    await expectNoPageOverflow(page, `${testInfo.project.name} curator dialog`);

    await page.locator("#curatorAgentCloseButton").click();
    await expect(page.locator("#curatorAgentDialog")).not.toBeVisible();
    await expect(page.locator("#curatorAgentButton")).toBeFocused();

    const blocked = await request.post("/api/curator-agent/runs", {
      headers: {
        Origin: new URL(page.url()).origin,
        "Idempotency-Key": `browser-gate-${testInfo.project.name}`
      },
      data: { intent: "draft_exhibition", query: "must stay read only" }
    });
    expect(blocked.status()).toBe(403);
    expect(await blocked.json()).toMatchObject({ interviewDemo: true });

    const after = await request.get("/api/curator-agent/runs?limit=20");
    expect(after.status()).toBe(200);
    await expectRunsEmpty(after);
    expectNoRuntimeErrors(runtimeErrors, `${testInfo.project.name} curator sample`);
  });

  test("runs all four device-local memory lenses as explicit zero-save GET previews", async ({ page }, testInfo) => {
    const runtimeErrors = captureRuntimeErrors(page);
    await openReadyDemo(page, "reflect");

    const workbench = page.locator("[data-memory-lens-root]");
    await expect(workbench).toBeVisible();
    expect(await workbench.evaluate((element) => element.open)).toBe(false);
    await expect(workbench.locator('input[name="memoryLensSource"]')).toHaveCount(0);
    await page.waitForLoadState("networkidle");

    const observed = [];
    page.on("request", (browserRequest) => {
      const url = new URL(browserRequest.url());
      if (url.pathname.startsWith("/api/")) {
        observed.push({ method: browserRequest.method(), path: url.pathname, lens: url.searchParams.get("lens") });
      }
    });

    await workbench.locator(":scope > summary").click();
    const sources = workbench.locator('input[name="memoryLensSource"]');
    await expect(sources).toHaveCount(4);
    await expect(workbench.locator('input[name="memoryLensSource"]:checked')).toHaveCount(0);
    await sources.nth(0).check();
    await sources.nth(1).check();
    await expect(workbench.locator("[data-memory-lens-selection-count]")).toHaveText("已选 2 / 20");

    for (const lens of ["time", "cooccurrence", "evidence", "clue"]) {
      await test.step(`${lens} lens`, async () => {
        await workbench.locator(`input[name="lens"][value="${lens}"]`).check();
        if (lens === "clue") await workbench.locator('input[name="query"]').fill("校园 告别");
        const responsePromise = page.waitForResponse((response) => {
          const url = new URL(response.url());
          return response.request().method() === "GET" &&
            url.pathname === "/api/memory-lens/preview" && url.searchParams.get("lens") === lens;
        });
        await workbench.locator("[data-memory-lens-run]").click();
        const response = await responsePromise;
        expect(response.status()).toBe(200);
        expect((await response.json()).execution).toMatchObject({
          source: "server-read-saved-memories",
          deterministic: true,
          externalModel: false,
          modelCalls: 0,
          toolCalls: 0,
          persisted: false
        });
        const output = workbench.locator("[data-memory-lens-output]");
        await expect(output).toBeVisible();
        await expect(output).toContainText("0 次模型调用");
        await expect(output).toContainText("本次不保存");
        await expect(output.locator("[data-memory-lens-results] > li")).toHaveCount(2);
        await expectNoPageOverflow(page, `${testInfo.project.name} ${lens} memory lens`);
      });
    }

    expect(observed).toEqual([
      { method: "GET", path: "/api/memories", lens: null },
      { method: "GET", path: "/api/memory-lens/preview", lens: "time" },
      { method: "GET", path: "/api/memory-lens/preview", lens: "cooccurrence" },
      { method: "GET", path: "/api/memory-lens/preview", lens: "evidence" },
      { method: "GET", path: "/api/memory-lens/preview", lens: "clue" }
    ]);
    expectNoRuntimeErrors(runtimeErrors, `${testInfo.project.name} memory lenses`);
  });

  test("opens a synthetic multi-perspective comparison and only hands off to existing read views", async ({ page }, testInfo) => {
    const runtimeErrors = captureRuntimeErrors(page);
    await openReadyDemo(page, "collection");
    await page.locator(".memory-card-button").first().click();
    await expect(page.locator("#memoryDialog")).toBeVisible();
    const panel = page.locator("[data-multi-perspective]");
    await expect(panel).toHaveCount(1);
    expect(await panel.evaluate((element) => element.open)).toBe(false);
    await page.waitForLoadState("networkidle");

    const writes = [];
    page.on("request", (browserRequest) => {
      if (browserRequest.method() !== "GET") writes.push({ method: browserRequest.method(), path: new URL(browserRequest.url()).pathname });
    });
    const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname.startsWith("/api/multi-perspective/memories/"));
    await panel.locator(":scope > summary").click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ preview: { synthetic: true, execution: { externalModel: false, modelCalls: 0, toolCalls: 0, persisted: false } } });
    await expect(panel).toContainText("公开 Demo 的合成对照");
    await expect(panel).toContainText("身份未核验");
    await expect(panel).toContainText("0 次模型调用");
    await expect(panel.locator(".multi-perspective-card")).toHaveCount(2);
    await expectNoPageOverflow(page, `${testInfo.project.name} multi-perspective detail`);

    await panel.locator('[data-multi-perspective-handoff="provenance"]').click();
    expect(await page.locator("[data-provenance-passport]").evaluate((element) => element.open)).toBe(true);
    await panel.locator('[data-multi-perspective-handoff="revisions"]').click();
    expect(await page.locator(".memory-revision-panel").evaluate((element) => element.open)).toBe(true);
    await panel.locator('[data-multi-perspective-handoff="puzzle"]').click();
    await expect(page.locator("#memoryDialog")).not.toBeVisible();
    await expect(page).toHaveURL(/#reflect$/);
    expect(writes).toEqual([]);
    expectNoRuntimeErrors(runtimeErrors, `${testInfo.project.name} multi-perspective detail`);
  });

  test("keeps lock and both recovery rehearsals disabled with zero body reads in Demo", async ({ page, request }, testInfo) => {
    const runtimeErrors = captureRuntimeErrors(page);
    await openReadyDemo(page, "data");

    const before = await request.get("/api/museum-lock");
    expect(before.status()).toBe(200);
    const beforePayload = await before.json();
    expect(beforePayload).toMatchObject({ demo: true, persisted: false });

    const panel = page.locator("#museumLockPanel");
    expect(await panel.evaluate((element) => element.open)).toBe(false);
    await expect(page.locator("#museumLockState")).toHaveText("Demo 只读");
    await panel.locator(":scope > summary").click();
    await expect(page.locator("#museumLockPassphrase")).toBeDisabled();
    await expect(page.locator("#museumLockPassphraseConfirm")).toBeDisabled();
    await expect(page.locator("#museumLockAction")).toBeDisabled();
    await expect(page.locator("#isolatedRecoveryFile")).toBeDisabled();
    await expect(page.locator('label[for="isolatedRecoveryFile"]')).toHaveAttribute("aria-disabled", "true");
    await expect(page.locator("#structuralRecoveryFile")).toBeDisabled();
    await expect(page.locator('label[for="structuralRecoveryFile"]')).toHaveAttribute("aria-disabled", "true");
    expect(await page.locator(".structural-recovery-legacy").evaluate((element) => element.open)).toBe(false);
    await expect(page.locator("#museumLockStatus")).toContainText("公开 Demo 不接收口令");
    await expect(page.locator("#isolatedRecoveryStatus")).toContainText("公开 Demo 不读取、暂存或恢复私人备份");
    await expect(page.locator("#structuralRecoveryStatus")).toContainText("公开 Demo 不暂存私人备份");

    const lock = await request.post("/api/museum-lock/lock", {
      headers: { Origin: new URL(page.url()).origin },
      data: {
        confirmation: "LOCK_MUSEUM_WRITES",
        expectedRevision: beforePayload.state.revision,
        operationId: `browser-lock-${testInfo.project.name}`,
        passphrase: "demo-must-not-read-this-passphrase"
      }
    });
    expect(lock.status()).toBe(403);
    expect(await lock.json()).toMatchObject({ interviewDemo: true, bodyBytesRead: 0 });

    const drill = await request.post("/api/recovery-drills/structural", {
      headers: {
        Origin: new URL(page.url()).origin,
        "Content-Type": "application/octet-stream"
      },
      data: Buffer.from("demo-must-not-stage-this-archive")
    });
    expect(drill.status()).toBe(403);
    expect(await drill.json()).toMatchObject({ interviewDemo: true, bodyBytesRead: 0 });

    const isolated = await request.post("/api/recovery-drills/isolated-restore", {
      headers: {
        Origin: new URL(page.url()).origin,
        "Content-Type": "application/octet-stream"
      },
      data: Buffer.from("demo-must-not-restore-this-archive")
    });
    expect(isolated.status()).toBe(403);
    expect(await isolated.json()).toMatchObject({
      code: "ISOLATED_RECOVERY_DEMO_READ_ONLY",
      interviewDemo: true,
      bodyBytesRead: 0
    });

    const after = await request.get("/api/museum-lock");
    expect(after.status()).toBe(200);
    expect((await after.json()).state).toEqual(beforePayload.state);
    await expectNoPageOverflow(page, `${testInfo.project.name} museum lock`);
    expectNoRuntimeErrors(runtimeErrors, `${testInfo.project.name} museum lock`);
  });

  test("keeps the document inbox synthetic, read-only and zero-persistence", async ({ page, request }, testInfo) => {
    const runtimeErrors = captureRuntimeErrors(page);
    const before = await request.get("/api/memory-inbox?status=pending");
    expect(before.status()).toBe(200);
    expect(await before.json()).toMatchObject({ items: [], counts: { sources: 0, items: 0, pending: 0 }, demo: true });

    await openReadyDemo(page, "compose");
    await page.locator("#memoryInboxEntry summary").click();
    await page.locator("#memoryInboxOpenButton").click();
    await expect(page.locator("#memoryInboxDialog")).toBeVisible();
    await expect(page.locator("#memoryInboxFile")).toBeDisabled();
    await expect(page.locator("#memoryInboxDemoNote")).toBeVisible();
    const candidates = page.locator("#memoryInboxCandidates .memory-inbox-candidate");
    expect(await candidates.count()).toBeGreaterThan(0);
    for (let index = 0; index < await candidates.count(); index += 1) {
      await expect(candidates.nth(index).locator("button")).toBeDisabled();
    }
    if (testInfo.project.name.startsWith("mobile-")) {
      await expectDialogToFillViewport(page, page.locator("#memoryInboxDialog"), `${testInfo.project.name} memory inbox`);
    }
    await expectNoPageOverflow(page, `${testInfo.project.name} memory inbox`);

    const blocked = await request.post("/api/memory-inbox/items", {
      headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": `inbox-gate-${testInfo.project.name}` },
      data: { confirm: true }
    });
    expect(blocked.status()).toBe(403);
    expect(await blocked.json()).toMatchObject({ interviewDemo: true });

    await page.locator("[data-memory-inbox-close]").click();
    await expect(page.locator("#memoryInboxDialog")).not.toBeVisible();
    await expect(page.locator("#memoryInboxOpenButton")).toBeFocused();
    const after = await request.get("/api/memory-inbox?status=pending");
    expect(await after.json()).toMatchObject({ items: [], counts: { sources: 0, items: 0, pending: 0 } });
    expectNoRuntimeErrors(runtimeErrors, `${testInfo.project.name} memory inbox sample`);
  });
});

async function openReadyDemo(page, route) {
  const response = await page.goto(`/#${route}`, { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await expect(page.locator("#runtimeBadge")).toHaveClass(/is-ready/);
  await expect(page.locator("#demoNotice")).not.toHaveAttribute("hidden", "");
  await expect(page.locator(`[data-view-panel="${route}"]`)).toBeVisible();

  const health = await page.request.get("/api/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({
    ok: true,
    version: "17.0.0",
    schemaVersion: 19,
    mode: "interview-demo",
    storage: "ephemeral-sqlite"
  });
}

async function expectNavigationLayout(page, mobile) {
  const layout = await page.locator(".main-nav").evaluate((navigation) => {
    const navRect = navigation.getBoundingClientRect();
    const buttons = [...navigation.querySelectorAll("[data-view]")].map((button) => {
      const rect = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      return {
        width: rect.width,
        height: rect.height,
        justifyContent: style.justifyContent,
        textAlign: style.textAlign
      };
    });
    return {
      position: getComputedStyle(navigation).position,
      viewportWidth: document.documentElement.clientWidth,
      viewportHeight: window.innerHeight,
      rect: { left: navRect.left, right: navRect.right, bottom: navRect.bottom },
      buttons
    };
  });

  if (!mobile) {
    expect(layout.position).not.toBe("fixed");
    return;
  }

  expect(layout.position).toBe("fixed");
  expect(Math.abs(layout.rect.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(layout.viewportWidth - layout.rect.right)).toBeLessThanOrEqual(1);
  expect(Math.abs(layout.viewportHeight - layout.rect.bottom)).toBeLessThanOrEqual(1);
  expect(Math.max(...layout.buttons.map((button) => button.width)) - Math.min(...layout.buttons.map((button) => button.width))).toBeLessThanOrEqual(2);
  for (const button of layout.buttons) {
    expect(button.height).toBeGreaterThanOrEqual(44);
    expect(button.justifyContent).toBe("center");
    expect(button.textAlign).toBe("center");
  }
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

async function expectDialogToFillViewport(page, dialog, context) {
  const geometry = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      viewportWidth: document.documentElement.clientWidth,
      viewportHeight: window.innerHeight,
      rect: { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left }
    };
  });
  expect.soft(Math.abs(geometry.rect.left), `${context}: left edge`).toBeLessThanOrEqual(1);
  expect.soft(Math.abs(geometry.rect.top), `${context}: top edge`).toBeLessThanOrEqual(1);
  expect.soft(Math.abs(geometry.viewportWidth - geometry.rect.right), `${context}: right edge`).toBeLessThanOrEqual(1);
  expect.soft(Math.abs(geometry.viewportHeight - geometry.rect.bottom), `${context}: bottom edge`).toBeLessThanOrEqual(1);
}

async function expectRunsEmpty(response) {
  const payload = await response.json();
  expect(payload).toMatchObject({ demo: true, runs: [] });
}

function captureRuntimeErrors(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

function expectNoRuntimeErrors(errors, context) {
  expect(errors, `${context}: console error/pageerror`).toEqual([]);
}
