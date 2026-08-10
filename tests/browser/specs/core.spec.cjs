"use strict";

const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;

const WCAG_AA_TAGS = Object.freeze(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"]);

const ROUTES = Object.freeze([
  { view: "collection", panel: "#view-collection" },
  { view: "compose", panel: "#view-compose" },
  { view: "reflect", panel: "#view-reflect" },
  { view: "data", panel: "#view-data" }
]);

test.describe("V17.1 interview-demo browser gate", () => {
  test("keeps four routes trusted and rejects every mutation before body reads", async ({ page, request }, testInfo) => {
    const runtimeErrors = captureRuntimeErrors(page);
    await openReadyDemo(page, "collection");
    const beforeHealth = await request.get("/api/health");
    const beforeStats = (await beforeHealth.json()).stats;

    const navigation = page.locator(".main-nav");
    await expect(navigation).toBeVisible();
    await expect(navigation.locator("[data-view]" )).toHaveCount(4);
    await expect(page.locator("#trustMode")).toHaveText("公开 Demo");
    await expect(page.locator("#trustMode")).toHaveAttribute("title", "公开只读 Demo");
    await expect(page.locator("#trustStorage")).toHaveText("临时样例");
    await expect(page.locator("#trustStorage")).toHaveAttribute("title", "虚构样例 · 临时实例");
    await expect(page.locator("#trustAi")).toHaveText("本地/设备");
    await expect(page.locator("#trustExternal")).toHaveText("不外发");
    await expect(page.locator("#trustEncryption")).toHaveText("未加密");

    for (const route of ROUTES) {
      await test.step(`route #${route.view}`, async () => {
        const button = navigation.locator(`[data-view="${route.view}"]`);
        await button.click();
        await expect(page).toHaveURL(new RegExp(`#${route.view}$`));
        await expect(button).toHaveAttribute("aria-current", "page");
        await expect(page.locator(route.panel)).toBeVisible();
        await expect(page.locator(`[data-view-panel]:visible`)).toHaveCount(1);
        await expect(page.locator("#trustBar")).toBeVisible();
        await expectNoPageOverflow(page, `${testInfo.project.name} #${route.view}`);
        const { violations } = await new AxeBuilder({ page }).withTags(WCAG_AA_TAGS).analyze();
        expect.soft(violations.length, formatAxeViolations(testInfo.project.name, route.view, violations)).toBe(0);
      });
    }

    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const blocked = await request.fetch("/api/memories/demo-childhood-rain", {
        method,
        headers: { Origin: new URL(page.url()).origin, "Content-Type": "application/json" },
        data: JSON.stringify({ rawContent: `browser gate must not read ${method}` })
      });
      expect(blocked.status()).toBe(403);
      expect(await blocked.json()).toMatchObject({
        code: "INTERVIEW_DEMO_READ_ONLY",
        interviewDemo: true,
        bodyBytesRead: 0,
        persistence: { wrote: false, scope: "none", fields: [] }
      });
    }
    const safeHead = await request.head("/api/health");
    expect(safeHead.status()).not.toBe(403);
    const afterHealth = await request.get("/api/health");
    expect((await afterHealth.json()).stats).toEqual(beforeStats);

    await expectNavigationLayout(page, testInfo.project.name.startsWith("mobile-"));
    expectNoRuntimeErrors(runtimeErrors, `${testInfo.project.name} primary routes`);
  });

  test("recovers search after two bounded GET failures without leaving stale cards", async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith("desktop-"), "Search fault injection only needs one browser profile.");
    let attempts = 0;
    await page.route("**/api/search?**", async (route) => {
      attempts += 1;
      if (attempts <= 2) {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "synthetic search outage" }) });
        return;
      }
      await route.continue();
    });
    await openReadyDemo(page, "collection");
    await expect(page.locator(".memory-card-button")).toHaveCount(4);
    await page.locator("#searchInput").fill("操场");
    await expect(page.locator("#searchErrorState")).toBeVisible({ timeout: 12_000 });
    await expect(page.locator("#memoryGrid .memory-card-button")).toHaveCount(0);
    await expect(page.locator("#collectionMoreButton")).toBeHidden();
    await expect(page.locator("#retrySearchButton")).toBeEnabled();
    expect(attempts).toBe(2);
    await page.locator("#retrySearchButton").click();
    await expect(page.locator("#searchErrorState")).toBeHidden();
    await expect(page.locator("#memoryGrid .memory-card-button").first()).toBeVisible();
    expect(attempts).toBe(3);
  });

  test("keeps guide validation accessible and only renders the latest question", async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith("desktop-"), "Guide response ordering only needs one browser profile.");
    await page.addInitScript(() => {
      const nativeFetch = globalThis.fetch.bind(globalThis);
      globalThis.fetch = (input, init = {}) => {
        const url = new URL(typeof input === "string" ? input : input.url, location.href);
        if (url.pathname !== "/api/demo/guide") return nativeFetch(input, init);
        const { signal: _ignoredSignal, ...withoutSignal } = init;
        return nativeFetch(input, withoutSignal);
      };
    });
    await page.route("**/api/demo/guide?**", async (route) => {
      const id = new URL(route.request().url()).searchParams.get("id");
      if (id === "growth") await new Promise((resolve) => setTimeout(resolve, 260));
      const marker = id === "warmth" ? "LATEST-WARMTH" : "STALE-GROWTH";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          question: marker,
          mode: "local-rules",
          answer: `${marker}。。`,
          citations: [{ id: "demo-family-noodles", title: marker, hall: "family", excerpt: "完全虚构引用", confidence: { label: "测试" }, reason: "浏览器反序夹具" }],
          followUps: [],
          execution: { engineId: "local-evidence-guide-v1", mode: "local-rules", externalRequestOccurred: false },
          persistence: { wrote: false, scope: "none", fields: [] },
          sample: true,
          readOnly: true,
          questionId: id
        })
      });
    });
    await openReadyDemo(page, "reflect");
    await page.locator("#guideAskButton").click();
    await expect(page.locator("#guideQuestion")).toBeFocused();
    await expect(page.locator("#guideQuestion")).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#guideQuestion")).toHaveAttribute("aria-describedby", "guideAnswer");
    await expect(page.locator("#guideAnswer")).toContainText("请先写下一个问题");

    await page.locator('[data-question-id="growth"]').click();
    await expect(page.locator("#guideForm")).toHaveAttribute("aria-busy", "true");
    await page.evaluate(() => {
      const form = document.querySelector("#guideForm");
      const question = document.querySelector("#guideQuestion");
      question.value = "推荐一件让我感到温暖的展品。";
      form.dataset.questionId = "warmth";
      form.requestSubmit();
    });
    await expect(page.locator("#guideAnswer")).toContainText("LATEST-WARMTH");
    await expect(page.locator("#guideAnswer")).not.toContainText("STALE-GROWTH");
    await page.waitForTimeout(350);
    await expect(page.locator("#guideAnswer")).toContainText("LATEST-WARMTH");
    await expect(page.locator("#guideAnswer")).not.toContainText("。。");
    await expect(page.locator("#citationList")).toContainText("LATEST-WARMTH");
    await expect(page.locator("#guideForm")).toHaveAttribute("aria-busy", "false");
    await expect(page.locator("#guideAskButton")).toBeEnabled();
    await expect(page.locator("#guideQuestion")).not.toHaveAttribute("aria-invalid", "true");
  });

  test("keeps advanced scripts cold, retries incomplete modules and lets the basic puzzle survive oral-history failure", async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith("desktop-"), "Lazy integration only needs one browser profile.");
    const advancedPaths = [
      "/assets/curator-agent.js", "/assets/capsule-crypto.js", "/assets/share-privacy.js", "/assets/capsules.js", "/assets/oral-histories.js",
      "/assets/media-evidence.js", "/assets/media-ocr.js", "/assets/media-lab.js", "/assets/revisions.js", "/assets/provenance.js",
      "/assets/co-memory-crypto.js", "/assets/co-memory-letter.js", "/assets/co-memory-host.js", "/assets/multi-perspective.js", "/assets/multi-perspective-host.js"
    ];
    const observed = [];
    let curatorAttempts = 0;
    let oralAttempts = 0;
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (advancedPaths.includes(pathname)) observed.push(pathname);
    });
    await page.route("**/assets/curator-agent.js?*", async (route) => {
      curatorAttempts += 1;
      if (curatorAttempts === 1) {
        await route.fulfill({ status: 200, contentType: "application/javascript", headers: { "Cache-Control": "no-store" }, body: "/* intentionally incomplete once */" });
        return;
      }
      await route.continue();
    });
    await page.route("**/assets/oral-histories.js?*", async (route) => {
      oralAttempts += 1;
      await route.fulfill({ status: 200, contentType: "application/javascript", headers: { "Cache-Control": "no-store" }, body: "/* intentionally incomplete for puzzle fallback */" });
    });
    await openReadyDemo(page, "reflect");
    await page.waitForLoadState("networkidle");
    expect(observed).toEqual([]);

    const more = page.locator("#moreRecallDetails");
    await openDetails(more);
    await expect.poll(() => [...new Set(observed)].sort()).toEqual([...advancedPaths].sort());
    const capsuleOrder = observed.filter((path) => ["/assets/capsule-crypto.js", "/assets/share-privacy.js", "/assets/capsules.js"].includes(path));
    expect(capsuleOrder.slice(0, 3)).toEqual(["/assets/capsule-crypto.js", "/assets/share-privacy.js", "/assets/capsules.js"]);
    const coMemoryOrder = observed.filter((path) => ["/assets/co-memory-crypto.js", "/assets/co-memory-letter.js", "/assets/co-memory-host.js"].includes(path));
    expect(coMemoryOrder.slice(0, 3)).toEqual(["/assets/co-memory-crypto.js", "/assets/co-memory-letter.js", "/assets/co-memory-host.js"]);
    const mediaLabOrder = observed.filter((path) => ["/assets/media-evidence.js", "/assets/media-ocr.js", "/assets/media-lab.js"].includes(path));
    expect(mediaLabOrder.slice(0, 3)).toEqual(["/assets/media-evidence.js", "/assets/media-ocr.js", "/assets/media-lab.js"]);
    await expect(page.locator("#toast")).toContainText("高级回看方式暂时未加载");
    await more.locator(":scope > summary").click();
    await more.locator(":scope > summary").click();
    await expect.poll(() => curatorAttempts).toBe(2);
    await expect.poll(() => oralAttempts).toBeGreaterThanOrEqual(2);
    await page.locator("#curatorAgentButton").click();
    await expect(page.locator("#curatorAgentDialog")).toBeVisible();
    await page.locator("#curatorAgentCloseButton").click();

    await page.locator('[data-insight-tab="routes"]').click();
    const routeCard = page.locator("#routesPanel [data-puzzle-left][data-puzzle-right]").first();
    await expect(routeCard).toBeVisible();
    await routeCard.click();
    await expect(page.locator("#puzzleDialog")).toBeVisible();
    await expect(page.locator("#puzzleBody .puzzle-source-grid")).toBeVisible();
    await expect(page.locator("#puzzleStatus")).toContainText("稳定线索");
    await expect(page.locator("#toast")).toContainText("基础拼图仍可查看");
    expect(oralAttempts).toBeGreaterThanOrEqual(3);
  });

  test("keeps mobile filters, details, touch targets and background scroll predictable", async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith("mobile-"), "Mobile geometry is covered by the three touch profiles.");
    await openReadyDemo(page, "collection");
    const firstCard = page.locator(".memory-card-button").first();
    expect((await firstCard.boundingBox()).y).toBeLessThanOrEqual(420);

    await page.locator("#collectionFilterButton").click();
    await expect(page.locator("#collectionFilterDialog")).toBeVisible();
    expect(await page.locator("#collectionFilterDialog").evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.locator("#collectionFilterDialog")).toBeHidden();
    await expect(page.locator("#collectionFilterButton")).toBeFocused();

    await page.locator('[data-view="compose"]').click();
    await expect(page.locator('[data-view-panel="compose"]')).toBeVisible();
    expect((await page.locator("#rawContent").boundingBox()).y).toBeLessThanOrEqual(340);
    await page.locator('[data-view="collection"]').click();
    await expect(page.locator('[data-view-panel="collection"]')).toBeVisible();

    const detailTrigger = page.locator(".memory-card-button").last();
    await detailTrigger.scrollIntoViewIfNeeded();
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await detailTrigger.evaluate((element) => {
      element.addEventListener("click", () => { window.__timeIsleDetailActivationScrollY = window.scrollY; }, { once: true, capture: true });
    });
    await detailTrigger.click();
    const activationScrollY = await page.evaluate(() => window.__timeIsleDetailActivationScrollY);
    expect(Number.isFinite(activationScrollY)).toBe(true);
    expect(Math.abs(activationScrollY - scrollBefore)).toBeLessThanOrEqual(8);
    const dialog = page.locator("#memoryDialog");
    await expect(dialog).toBeVisible();
    await expectDialogToFillViewport(page, dialog, `${testInfo.project.name} memory detail`);
    const detailGeometry = await dialog.evaluate((element) => {
      const body = element.querySelector("#dialogBody");
      const actions = element.querySelector(".dialog-actions");
      const maxScroll = Math.max(0, body.scrollHeight - body.clientHeight);
      body.scrollTop = Math.min(180, maxScroll);
      const actionsRect = actions.getBoundingClientRect();
      return {
        dialogOverflow: getComputedStyle(element).overflow,
        dialogScrollTop: element.scrollTop,
        bodyOverflowY: getComputedStyle(body).overflowY,
        bodyScrollTop: body.scrollTop,
        maxScroll,
        actionsBottom: actionsRect.bottom,
        viewportHeight: innerHeight,
        bodyPosition: getComputedStyle(document.body).position,
        bodyTop: document.body.style.top,
        windowScrollY: window.scrollY
      };
    });
    expect(detailGeometry.dialogOverflow).toBe("hidden");
    expect(detailGeometry.dialogScrollTop).toBe(0);
    expect(detailGeometry.bodyOverflowY).toBe("auto");
    expect(detailGeometry.maxScroll).toBeGreaterThan(0);
    expect(detailGeometry.bodyScrollTop).toBeGreaterThan(0);
    expect(detailGeometry.actionsBottom).toBeLessThanOrEqual(detailGeometry.viewportHeight + 1);
    expect(detailGeometry.bodyPosition).toBe("fixed");
    expect(detailGeometry.bodyTop).toBe(`-${activationScrollY}px`);
    expect(detailGeometry.windowScrollY).toBe(0);

    await page.locator('#memoryDialog button[aria-label="关闭详情"]').click();
    await expect(dialog).toBeHidden();
    await expect(detailTrigger).toBeFocused();
    await expect.poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - activationScrollY)).toBeLessThanOrEqual(1);

    if (["mobile-390", "mobile-320"].includes(testInfo.project.name)) {
      await detailTrigger.click();
      await expect(dialog).toBeVisible();
      await expect.poll(async () => page.locator("#dialogBody").evaluate((body) => body.scrollTop)).toBeLessThanOrEqual(1);
      await expect(page.locator("#dialogTitle")).toBeFocused();
      const retainedScrollTop = await page.locator("#dialogBody").evaluate((body) => {
        const next = Math.min(160, Math.max(0, body.scrollHeight - body.clientHeight));
        body.scrollTop = next;
        return next;
      });
      expect(retainedScrollTop).toBeGreaterThan(0);
      await page.waitForTimeout(50);
      expect(await page.locator("#dialogBody").evaluate((body) => body.scrollTop)).toBeGreaterThan(0);
      await page.locator('#memoryDialog button[aria-label="关闭详情"]').click();
      await expect(dialog).toBeHidden();
      await expect(detailTrigger).toBeFocused();
      await expect.poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - activationScrollY)).toBeLessThanOrEqual(1);
    }

    const touchLinks = await page.evaluate(() => {
      const host = document.createElement("div");
      host.innerHTML = '<p class="media-gallery-meta"><a href="#">查看原图</a></p><figure class="media-compare-side"><figcaption><a href="#">查看原图</a></figcaption></figure><a class="text-link" href="#">技术证据</a>';
      document.body.append(host);
      const result = [...host.querySelectorAll("a")].map((link) => {
        const rect = link.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      });
      host.remove();
      return { coarse: matchMedia("(pointer: coarse)").matches, points: navigator.maxTouchPoints, links: result };
    });
    expect(touchLinks.coarse).toBe(true);
    expect(touchLinks.points).toBeGreaterThan(0);
    for (const link of touchLinks.links) {
      expect(link.width).toBeGreaterThanOrEqual(44);
      expect(link.height).toBeGreaterThanOrEqual(44);
    }
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
    const interceptedSnapshot = Promise.withResolvers();
    const releaseSnapshot = Promise.withResolvers();
    const snapshotRouteDone = Promise.withResolvers();
    await page.route("**/api/semantic-recall/snapshot", async (route) => {
      interceptedSnapshot.resolve();
      try {
        await releaseSnapshot.promise;
        await route.fulfill({ status: 200, contentType: "application/json", body: delayedBody });
      } catch {
        // The page intentionally aborted this one pending response.
      } finally {
        snapshotRouteDone.resolve();
      }
    }, { times: 1 });
    const stopButton = page.locator("#semanticRecallStop");
    await page.locator("#semanticRecallPrepare").click();
    await interceptedSnapshot.promise;
    try {
      await expect(panel).toHaveAttribute("aria-busy", "true");
      await expect(stopButton).toBeVisible();
      await stopButton.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" }));
      await stopButton.click();
      await expect(panel).toHaveAttribute("aria-busy", "false");
      await expect(stopButton).toBeHidden();
      await expect(page.locator("#semanticRecallStatus")).toContainText("已停止，并清除了本次设备索引");
    } finally {
      releaseSnapshot.resolve();
    }
    await snapshotRouteDone.promise;
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

    await openDetails(page.locator("#moreRecallDetails"));
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
    await openDetails(page.locator("#moreRecallDetails"));
    await page.waitForLoadState("networkidle");

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
    await openDetails(page.locator(".detail-advanced"));
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

    await openDetails(page.locator(".project-backstage.security-backstage"));
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
      code: "INTERVIEW_DEMO_READ_ONLY",
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
    const inboxDialog = page.locator("#memoryInboxDialog");
    if ((page.viewportSize()?.width || Infinity) <= 640) await expectDialogToFillViewport(page, inboxDialog, `${testInfo.project.name} memory inbox`);
    else await expect(inboxDialog).toBeInViewport({ ratio: 1 });
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
    version: "17.1.2",
    schemaVersion: 19,
    mode: "interview-demo",
    storage: "ephemeral-sqlite"
  });
}

async function openDetails(details) {
  await expect(details).toHaveCount(1);
  if (!(await details.evaluate((element) => element.open))) {
    await details.locator(":scope > summary").click();
  }
  await expect(details).toHaveAttribute("open", "");
}

async function expectNavigationLayout(page, mobile) {
  const layout = await page.locator(".main-nav").evaluate((navigation) => {
    const navRect = navigation.getBoundingClientRect();
    const buttons = [...navigation.querySelectorAll("[data-view]")].map((button) => {
      const rect = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return {
        width: rect.width,
        height: rect.height,
        justifyContent: style.justifyContent,
        textAlign: style.textAlign,
        centerHitsButton: button === hit || button.contains(hit)
      };
    });
    return {
      position: getComputedStyle(navigation).position,
      viewportWidth: document.documentElement.clientWidth,
      viewportHeight: window.innerHeight,
      rect: { left: navRect.left, right: navRect.right, bottom: navRect.bottom },
      buttons,
      pointerCoarse: matchMedia("(pointer: coarse)").matches,
      maxTouchPoints: navigator.maxTouchPoints,
      bodyPaddingBottom: Number.parseFloat(getComputedStyle(document.body).paddingBottom) || 0,
      navHeight: navRect.height
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
  expect(layout.pointerCoarse).toBe(true);
  expect(layout.maxTouchPoints).toBeGreaterThan(0);
  expect(layout.bodyPaddingBottom).toBeGreaterThanOrEqual(layout.navHeight);
  expect(Math.max(...layout.buttons.map((button) => button.width)) - Math.min(...layout.buttons.map((button) => button.width))).toBeLessThanOrEqual(2);
  for (const button of layout.buttons) {
    expect(button.height).toBeGreaterThanOrEqual(44);
    expect(button.justifyContent).toBe("center");
    expect(button.textAlign).toBe("center");
    expect(button.centerHitsButton).toBe(true);
  }
}

async function expectNoPageOverflow(page, context) {
  const dimensions = await page.evaluate(() => {
    const clientWidth = document.documentElement.clientWidth;
    const layoutViewportWidth = Math.max(clientWidth, window.innerWidth || 0);
    const allowedWidth = Math.max(clientWidth + 1, layoutViewportWidth);
    const offenders = [...document.body.querySelectorAll("*")].flatMap((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || (rect.left >= -1 && rect.right <= allowedWidth)) return [];
      const label = `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${[...element.classList].slice(0, 2).map((name) => `.${name}`).join("")}`;
      return [{ label, left: Math.round(rect.left * 10) / 10, right: Math.round(rect.right * 10) / 10, width: Math.round(rect.width * 10) / 10 }];
    }).slice(0, 8);
    return {
      clientWidth,
      layoutViewportWidth,
      allowedWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      offenders
    };
  });
  const evidence = dimensions.offenders.length ? `; offenders ${JSON.stringify(dimensions.offenders)}` : "";
  expect.soft(dimensions.scrollWidth, `${context}: document overflow${evidence}`).toBeLessThanOrEqual(dimensions.allowedWidth);
  expect.soft(dimensions.bodyScrollWidth, `${context}: body overflow${evidence}`).toBeLessThanOrEqual(dimensions.allowedWidth);
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

function formatAxeViolations(project, view, violations) {
  if (!violations.length) return `${project} #${view}: WCAG AA violations`;
  const details = violations.map((violation) => {
    const nodes = violation.nodes.map((node) => `${node.target.join(" ")}: ${node.failureSummary || "检查失败"}`).join(" | ");
    return `${violation.id} [${violation.impact || "unknown"}] ${violation.helpUrl} — ${nodes}`;
  });
  return `${project} #${view}: WCAG AA violations\n${details.join("\n")}`;
}
