"use strict";

const net = require("node:net");

const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const PLATFORM_HOST_ENV_KEYS = Object.freeze([
  "VERCEL_URL",
  "VERCEL_BRANCH_URL",
  "VERCEL_PROJECT_PRODUCTION_URL"
]);

class RequestSecurityError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = "RequestSecurityError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

/**
 * Build the request boundary once at startup. Local mode intentionally ignores
 * ALLOWED_HOSTS so a configuration typo cannot widen the loopback boundary.
 */
function createRequestSecurity(options = {}) {
  const deployment = Boolean(options.deployment);
  const configuredAuthorities = deployment
    ? collectDeploymentAuthorities(options.allowedHosts, options.platformHosts)
    : new Set();

  return Object.freeze({
    deployment,
    allowedAuthorities: Object.freeze([...configuredAuthorities]),
    validate(request) {
      const authority = validateHost(request, { deployment, configuredAuthorities });
      validateRequestTarget(request?.url);

      const protocol = deployment ? "https:" : "http:";
      if (!SAFE_METHODS.has(String(request?.method || "GET").toUpperCase())) {
        validateWriteProvenance(request, authority, protocol);
      }

      return Object.freeze({
        hostname: authority.hostname,
        port: authority.port,
        host: authority.authority,
        origin: `${protocol}//${authority.authority}`
      });
    }
  });
}

function platformHostsFromEnv(environment = process.env) {
  return PLATFORM_HOST_ENV_KEYS.map((key) => environment[key]).filter(Boolean);
}

function collectDeploymentAuthorities(allowedHosts, platformHosts) {
  const values = [
    ...splitConfiguredHosts(allowedHosts),
    ...splitConfiguredHosts(platformHosts)
  ];
  const authorities = new Set();
  for (const value of values) {
    const parsed = parseConfiguredAuthority(value);
    if (!parsed) continue;
    authorities.add(parsed.authority);
  }
  return authorities;
}

function splitConfiguredHosts(value) {
  if (Array.isArray(value)) return value.flatMap(splitConfiguredHosts);
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function parseConfiguredAuthority(value) {
  const input = String(value || "").trim();
  if (!input) return null;

  let authority = input;
  if (input.includes("://")) {
    let parsed;
    try {
      parsed = new URL(input);
    } catch {
      throw new TypeError(`部署主机配置无效：${input}`);
    }
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      throw new TypeError(`部署主机配置只能包含域名和可选端口：${input}`);
    }
    authority = parsed.host;
  }

  try {
    return parseAuthority(authority);
  } catch (error) {
    throw new TypeError(`部署主机配置无效：${input}（${error.message}）`);
  }
}

function validateHost(request, options) {
  const values = readHeaderValues(request, "host");
  if (values.length !== 1) {
    denyHost("请求必须仅包含一个 Host 头。");
  }

  let authority;
  try {
    authority = parseAuthority(values[0]);
  } catch {
    denyHost("Host 头格式无效。");
  }

  if (options.deployment) {
    if (!options.configuredAuthorities.has(authority.authority)) {
      denyHost("该部署主机未被明确允许。");
    }
  } else if (!LOCAL_HOSTNAMES.has(authority.hostname)) {
    denyHost("本地服务只接受 127.0.0.1、localhost 或 [::1]。");
  }

  return authority;
}

function validateRequestTarget(value) {
  const target = String(value || "");
  if (!target.startsWith("/") || target.startsWith("//") || target.includes("\\") || /[\r\n]/.test(target)) {
    throw new RequestSecurityError(400, "REQUEST_TARGET_INVALID", "请求目标格式无效。");
  }
}

function validateWriteProvenance(request, authority, protocol) {
  const origins = readHeaderValues(request, "origin");
  if (origins.length !== 1) {
    denyWrite("写请求必须包含唯一的同源 Origin。", "ORIGIN_REQUIRED");
  }

  let origin;
  try {
    origin = new URL(origins[0]);
  } catch {
    denyWrite("Origin 格式无效。", "ORIGIN_INVALID");
  }
  if (
    origin.protocol !== protocol ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    denyWrite("Origin 与当前服务不同源。", "ORIGIN_MISMATCH");
  }

  let originAuthority;
  try {
    originAuthority = parseAuthority(origin.host);
  } catch {
    denyWrite("Origin 格式无效。", "ORIGIN_INVALID");
  }
  if (
    originAuthority.hostname !== authority.hostname ||
    effectivePort(originAuthority.port, protocol) !== effectivePort(authority.port, protocol)
  ) {
    denyWrite("Origin 与当前服务不同源。", "ORIGIN_MISMATCH");
  }

  const fetchSites = readHeaderValues(request, "sec-fetch-site");
  if (fetchSites.length > 1) {
    denyWrite("Sec-Fetch-Site 请求头重复。", "FETCH_SITE_INVALID");
  }
  if (fetchSites.length === 1 && fetchSites[0].trim().toLowerCase() !== "same-origin") {
    denyWrite("浏览器已将该写请求标记为非同源。", "FETCH_SITE_MISMATCH");
  }
}

function parseAuthority(value) {
  const input = String(value || "");
  if (!input || input !== input.trim() || /[\s\\/@?#]/.test(input)) {
    throw new TypeError("主机为空或包含非法字符");
  }

  let hostname;
  let portText = "";
  if (input.startsWith("[")) {
    const close = input.indexOf("]");
    if (close < 0) throw new TypeError("IPv6 缺少右方括号");
    hostname = input.slice(1, close).toLowerCase();
    const suffix = input.slice(close + 1);
    if (suffix && !suffix.startsWith(":")) throw new TypeError("IPv6 主机后缀无效");
    portText = suffix ? suffix.slice(1) : "";
    if (net.isIP(hostname) !== 6) throw new TypeError("IPv6 地址无效");
  } else {
    if ((input.match(/:/g) || []).length > 1) throw new TypeError("IPv6 必须使用方括号");
    const separator = input.lastIndexOf(":");
    hostname = (separator >= 0 ? input.slice(0, separator) : input).toLowerCase();
    portText = separator >= 0 ? input.slice(separator + 1) : "";
    if (!isValidHostname(hostname)) throw new TypeError("主机名无效");
  }

  let port = null;
  if (portText) {
    if (!/^\d{1,5}$/.test(portText)) throw new TypeError("端口无效");
    port = Number(portText);
    if (port < 1 || port > 65535) throw new TypeError("端口超出范围");
  } else if (input.endsWith(":")) {
    throw new TypeError("端口为空");
  }

  const host = net.isIP(hostname) === 6 ? `[${hostname}]` : hostname;
  return Object.freeze({
    hostname,
    port,
    authority: port === null ? host : `${host}:${port}`
  });
}

function isValidHostname(hostname) {
  if (!hostname || hostname.length > 253) return false;
  if (net.isIP(hostname) === 4) {
    return hostname.split(".").every((part) => String(Number(part)) === part);
  }
  return hostname.split(".").every((label) => (
    label.length >= 1 &&
    label.length <= 63 &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  ));
}

function readHeaderValues(request, name) {
  const values = [];
  const rawHeaders = request?.rawHeaders;
  if (Array.isArray(rawHeaders) && rawHeaders.length) {
    for (let index = 0; index + 1 < rawHeaders.length; index += 2) {
      if (String(rawHeaders[index]).toLowerCase() === name) values.push(String(rawHeaders[index + 1]));
    }
    if (values.length) return values;
  }

  const headers = request?.headers || {};
  const value = headers[name] ?? headers[Object.keys(headers).find((key) => key.toLowerCase() === name)];
  if (Array.isArray(value)) return value.map(String);
  return value === undefined || value === null ? [] : [String(value)];
}

function effectivePort(port, protocol) {
  if (port !== null) return port;
  return protocol === "https:" ? 443 : 80;
}

function denyHost(message) {
  throw new RequestSecurityError(421, "HOST_NOT_ALLOWED", message);
}

function denyWrite(message, code) {
  throw new RequestSecurityError(403, code, message);
}

module.exports = {
  RequestSecurityError,
  createRequestSecurity,
  parseAuthority,
  platformHostsFromEnv
};
