"use strict";

const packageManifest = require("../package.json");

const APP_VERSION = String(packageManifest.version || "").trim();
const SCHEMA_VERSION = 20;

if (!/^\d+\.\d+\.\d+$/u.test(APP_VERSION)) throw new Error("package.json 缺少有效的语义化版本号。");

module.exports = Object.freeze({ APP_VERSION, SCHEMA_VERSION });
