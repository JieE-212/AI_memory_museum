"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { test, expect } = require("@playwright/test");

const root = path.resolve(__dirname, "../../..");
const wakeupUrl = pathToFileURL(path.join(root, "deploy", "cloudbase", "wakeup", "index.html")).href;
const probePng = fs.readFileSync(path.join(root, "public", "assets", "time-isle-192.png"));
const primaryOrigin = "https://shiyu-memory-demo-d3di282387d5c7-1456049152.ap-shanghai.app.tcloudbase.com";

test("CloudBase 唤醒入口保持有限尝试、明确兜底与三档响应式", async ({ page }) => {
  const errors = [];
  const probeRequests = [];
  let probeReady = false;
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.route(`${primaryOrigin}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/assets/time-isle-192.png") {
      probeRequests.push(url.href);
      if (probeReady) {
        await route.fulfill({ status: 200, contentType: "image/png", body: probePng });
      } else {
        await route.fulfill({ status: 503, contentType: "text/html; charset=utf-8", body: "<h1>cold start</h1>" });
      }
      return;
    }
    if (url.pathname === "/") {
      await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: "<!doctype html><title>CloudBase ready</title><h1>ready</h1>" });
      return;
    }
    await route.abort();
  });

  await page.goto(wakeupUrl, { waitUntil: "load" });
  await expect(page.getByRole("heading", { name: "让展馆醒来，再从容进入。" })).toBeVisible();
  await expect(page.getByRole("button", { name: "唤醒并进入" })).toBeVisible();
  await page.waitForTimeout(300);
  expect(probeRequests).toHaveLength(0);

  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    buttonHeights: [...document.querySelectorAll(".button")].map((element) => element.getBoundingClientRect().height)
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
  expect(layout.buttonHeights.every((height) => height >= 44)).toBe(true);

  await page.getByRole("button", { name: "唤醒并进入" }).click();
  await expect(page.getByRole("status")).toContainText("展馆暂时没有回应", { timeout: 25_000 });
  expect(probeRequests).toHaveLength(3);
  await page.waitForTimeout(500);
  expect(probeRequests).toHaveLength(3);
  await expect(page.getByRole("button", { name: "再次唤醒" })).toBeEnabled();
  await expect(page.getByRole("link", { name: "打开 Vercel 备用入口" })).toHaveAttribute("href", "https://ai-memory-museum-demo.vercel.app/#reflect");

  probeReady = true;
  await page.getByRole("button", { name: "再次唤醒" }).click();
  await page.waitForURL(`${primaryOrigin}/#reflect`, { timeout: 10_000 });
  expect(probeRequests).toHaveLength(4);
  const expectedColdStartErrors = errors.filter((message) => message.includes("status of 503"));
  const unexpectedErrors = errors.filter((message) => !message.includes("status of 503"));
  expect(expectedColdStartErrors).toHaveLength(3);
  expect(unexpectedErrors).toEqual([]);
});
