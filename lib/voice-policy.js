"use strict";

const MAX_VOICE_BYTES = 12 * 1024 * 1024;
const MAX_VOICE_DURATION_MS = 180_000;
const MAX_VOICES_PER_MEMORY = 3;
const DEFAULT_VOICE_STALE_STAGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_VOICE_TRASH_GRACE_MS = 24 * 60 * 60 * 1000;

const VOICE_MIME_TYPES = Object.freeze(["audio/webm", "audio/mp4"]);
const VOICE_FORMATS = Object.freeze({
  "audio/webm": Object.freeze({ container: "webm", codec: "opus", extension: "webm" }),
  "audio/mp4": Object.freeze({ container: "mp4", codec: "aac", extension: "m4a" })
});

const DEFAULT_VOICE_POLICY = Object.freeze({
  allowedMimeTypes: VOICE_MIME_TYPES,
  maxBytes: MAX_VOICE_BYTES,
  maxDurationMs: MAX_VOICE_DURATION_MS,
  maxVoicesPerMemory: MAX_VOICES_PER_MEMORY,
  staleStageMs: DEFAULT_VOICE_STALE_STAGE_MS,
  trashGraceMs: DEFAULT_VOICE_TRASH_GRACE_MS
});

function normalizeVoicePolicy(options = {}) {
  return Object.freeze({
    allowedMimeTypes: VOICE_MIME_TYPES,
    maxBytes: positiveIntegerAtMost(options.maxBytes, MAX_VOICE_BYTES),
    maxDurationMs: positiveIntegerAtMost(options.maxDurationMs, MAX_VOICE_DURATION_MS),
    maxVoicesPerMemory: positiveIntegerAtMost(options.maxVoicesPerMemory, MAX_VOICES_PER_MEMORY),
    staleStageMs: positiveInteger(options.staleStageMs, DEFAULT_VOICE_STALE_STAGE_MS),
    trashGraceMs: nonNegativeInteger(options.trashGraceMs, DEFAULT_VOICE_TRASH_GRACE_MS)
  });
}

function positiveIntegerAtMost(value, hardLimit) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) return hardLimit;
  return Math.min(number, hardLimit);
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function nonNegativeInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

module.exports = {
  MAX_VOICE_BYTES,
  MAX_VOICE_DURATION_MS,
  MAX_VOICES_PER_MEMORY,
  DEFAULT_VOICE_STALE_STAGE_MS,
  DEFAULT_VOICE_TRASH_GRACE_MS,
  VOICE_MIME_TYPES,
  VOICE_FORMATS,
  DEFAULT_VOICE_POLICY,
  normalizeVoicePolicy
};
