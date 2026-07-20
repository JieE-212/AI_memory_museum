"use strict";

const os = require("node:os");
const path = require("node:path");
const { defineConfig } = require("@playwright/test");

const runToken = safeRunToken(process.env.BROWSER_GATE_RUN_TOKEN || "manual");
const tempRoot = path.join(os.tmpdir(), `ai-memory-museum-browser-gate-${runToken}`);
const baseURL = validBaseURL(process.env.BROWSER_GATE_BASE_URL) || "http://127.0.0.1:43117";

module.exports = defineConfig({
  testDir: path.join(__dirname, "specs"),
  outputDir: path.join(tempRoot, "results"),
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL,
    browserName: "chromium",
    colorScheme: "light",
    locale: "zh-CN",
    reducedMotion: "reduce",
    serviceWorkers: "block",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off"
  },
  projects: [
    { name: "desktop-1265", use: { viewport: { width: 1265, height: 720 } } },
    { name: "mobile-390", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: "mobile-320", use: { viewport: { width: 320, height: 700 }, isMobile: true, hasTouch: true } }
  ]
});

function validBaseURL(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "http:" && url.hostname === "127.0.0.1" && url.port ? url.origin : "";
  } catch {
    return "";
  }
}

function safeRunToken(value) {
  const normalized = String(value || "").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80);
  return normalized || "manual";
}
