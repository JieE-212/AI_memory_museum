"use strict";

const LOCAL_BIND_HOSTS = new Set(["127.0.0.1", "::1"]);
const PUBLIC_BIND_HOSTS = new Set([...LOCAL_BIND_HOSTS, "0.0.0.0", "::"]);
const TRUE_FLAGS = new Set(["1", "true", "yes", "on"]);
const FALSE_FLAGS = new Set(["0", "false", "no", "off"]);

function resolveRuntimeDeployment(environment = process.env, options = {}) {
  const isVercelRuntime = Boolean(environment.VERCEL);
  const standalonePublic = !isVercelRuntime && parseOptionalFlag(environment.PUBLIC_DEPLOYMENT, "PUBLIC_DEPLOYMENT");
  const publicDeployment = isVercelRuntime || standalonePublic;
  const bindHost = isVercelRuntime ? "127.0.0.1" : resolveBindHost(environment.BIND_HOST, standalonePublic);
  const port = isVercelRuntime ? 3000 : resolvePort(environment.PORT);

  if (standalonePublic && options.interviewDemo !== true) {
    throw new TypeError("Standalone public deployment requires INTERVIEW_DEMO=true.");
  }
  if (standalonePublic && !splitValues(environment.ALLOWED_HOSTS).length) {
    throw new TypeError("Standalone public deployment requires at least one exact ALLOWED_HOSTS value.");
  }

  return Object.freeze({ bindHost, isVercelRuntime, port, publicDeployment, standalonePublic });
}

function parseOptionalFlag(value, name) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return false;
  if (TRUE_FLAGS.has(normalized)) return true;
  if (FALSE_FLAGS.has(normalized)) return false;
  throw new TypeError(`${name} must be one of: true, false, 1, 0, yes, no, on, off.`);
}

function resolveBindHost(value, standalonePublic) {
  const bindHost = String(value || "127.0.0.1").trim() || "127.0.0.1";
  const allowed = standalonePublic ? PUBLIC_BIND_HOSTS : LOCAL_BIND_HOSTS;
  if (!allowed.has(bindHost)) {
    throw new TypeError(`BIND_HOST ${bindHost} is not allowed in ${standalonePublic ? "public" : "local"} mode.`);
  }
  return bindHost;
}

function resolvePort(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return 3000;
  if (!/^\d{1,5}$/.test(normalized)) throw new TypeError("PORT must be an integer from 1 to 65535.");
  const port = Number(normalized);
  if (port < 1 || port > 65535) throw new TypeError("PORT must be an integer from 1 to 65535.");
  return port;
}

function splitValues(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

module.exports = { resolveRuntimeDeployment };
