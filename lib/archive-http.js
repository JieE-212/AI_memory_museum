"use strict";

const fs = require("node:fs");
const { pipeline } = require("node:stream/promises");

async function withRequestAbort(request, response, operation) {
  if (!request || !response || typeof operation !== "function") throw new TypeError("Archive HTTP dependencies are required.");
  const controller = new AbortController();
  let completed = false;
  const abort = () => {
    if (!completed && !response.writableFinished && !controller.signal.aborted) controller.abort(new Error("Archive request was interrupted."));
  };
  request.once("aborted", abort);
  response.once("close", abort);
  try {
    const result = await operation(controller.signal);
    completed = true;
    return result;
  } finally {
    completed = true;
    request.off("aborted", abort);
    response.off("close", abort);
  }
}

async function sendArchiveFile(response, archive, mode, options = {}) {
  if (!archive || typeof archive.path !== "string" || !Number.isSafeInteger(archive.length) || archive.length < 0) {
    throw new TypeError("Archive file descriptor is invalid.");
  }
  const date = new Date().toISOString().slice(0, 10);
  response.statusCode = 200;
  response.setHeader("Content-Type", "application/vnd.time-isle");
  response.setHeader("Content-Length", String(archive.length));
  response.setHeader("Content-Disposition", `attachment; filename="time-isle-${mode}-${date}.time-isle"`);
  response.setHeader("Cache-Control", "no-store");
  await pipeline(fs.createReadStream(archive.path), response, { signal: options.signal });
}

module.exports = { sendArchiveFile, withRequestAbort };
