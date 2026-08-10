"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { Readable } = require("node:stream");
const { createStaticResponder } = require("../lib/static-response");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "time-isle-static-response-"));
const smallSource = Buffer.from("const museum = '时屿';\n".repeat(80), "utf8");
const largeSource = Buffer.alloc(1024 * 1024 + 64, 0x61);
fs.writeFileSync(path.join(root, "asset.js"), smallSource);
fs.writeFileSync(path.join(root, "large.txt"), largeSource);

let streamFailure = "";
let streamOpenCount = 0;
const serveStatic = createStaticResponder({
  publicDir: root,
  getPolicy: (relative) => ({
    contentType: relative.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/plain; charset=utf-8",
    cacheControl: "public, max-age=60",
    serviceWorkerAllowed: false
  }),
  httpError: (statusCode, message) => Object.assign(new Error(message), { statusCode }),
  createReadStream: (filePath) => {
    streamOpenCount += 1;
    if (streamFailure === "before") return new Readable({ read() { this.destroy(Object.assign(new Error("before first byte"), { code: "EIO" })); } });
    if (streamFailure === "after") {
      let sent = false;
      return new Readable({
        read() {
          if (sent) return;
          sent = true;
          this.push(Buffer.from("partial"));
          setImmediate(() => this.destroy(Object.assign(new Error("after first byte"), { code: "EIO" })));
        }
      });
    }
    return fs.createReadStream(filePath);
  }
});

const server = http.createServer((request, response) => {
  try {
    serveStatic(request, response, new URL(request.url, "http://127.0.0.1").pathname);
  } catch (error) {
    response.statusCode = error.statusCode || 500;
    response.end(error.message);
  }
});

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  server.close();
  fs.rmSync(root, { recursive: true, force: true });
});

async function main() {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  const identity = await request(port, "/asset.js");
  assert.equal(identity.statusCode, 200);
  assert.deepEqual(identity.body, smallSource);
  assert.equal(identity.headers["content-encoding"], undefined);
  assert.equal(identity.headers.vary, "Accept-Encoding");
  assert.match(identity.headers.etag, /^W\//u);

  const gzip = await request(port, "/asset.js", { "Accept-Encoding": "gzip" });
  assert.equal(gzip.statusCode, 200);
  assert.equal(gzip.headers["content-encoding"], "gzip");
  assert.deepEqual(zlib.gunzipSync(gzip.body), smallSource);
  assert.notEqual(gzip.headers.etag, identity.headers.etag);

  const forbiddenGzip = await request(port, "/asset.js", { "Accept-Encoding": "gzip;q=0, identity;q=1" });
  assert.deepEqual(forbiddenGzip.body, smallSource);
  assert.equal(forbiddenGzip.headers["content-encoding"], undefined);
  assert.equal(forbiddenGzip.headers.etag, identity.headers.etag);

  const prefersIdentity = await request(port, "/asset.js", { "Accept-Encoding": "gzip;q=0.1, identity;q=1" });
  assert.equal(prefersIdentity.headers["content-encoding"], undefined);
  assert.deepEqual(prefersIdentity.body, smallSource);

  const unacceptable = await request(port, "/asset.js", { "Accept-Encoding": "gzip;q=0, identity;q=0" });
  assert.equal(unacceptable.statusCode, 406);
  const wildcardUnacceptable = await request(port, "/asset.js", { "Accept-Encoding": "*;q=0" });
  assert.equal(wildcardUnacceptable.statusCode, 406);

  const notModified = await request(port, "/asset.js", {
    "Accept-Encoding": "gzip",
    "If-None-Match": gzip.headers.etag.replace(/^W\//u, "")
  });
  assert.equal(notModified.statusCode, 304);
  assert.equal(notModified.body.length, 0);
  assert.equal(notModified.headers["content-length"], undefined);
  const wildcardNotModified = await request(port, "/asset.js", { "If-None-Match": "*" });
  assert.equal(wildcardNotModified.statusCode, 304);

  const head = await request(port, "/asset.js", { "Accept-Encoding": "gzip" }, "HEAD");
  assert.equal(head.statusCode, 200);
  assert.equal(head.body.length, 0);
  assert.equal(Number(head.headers["content-length"]), gzip.body.length);

  const large = await request(port, "/large.txt", { "Accept-Encoding": "gzip" });
  assert.equal(large.statusCode, 200);
  assert.equal(large.headers["content-encoding"], undefined);
  assert.equal(large.headers.vary, "Accept-Encoding");
  assert.deepEqual(large.body, largeSource);

  const streamsBeforeHead = streamOpenCount;
  const largeHead = await request(port, "/large.txt", {}, "HEAD");
  assert.equal(largeHead.statusCode, 200);
  assert.equal(streamOpenCount, streamsBeforeHead, "大文件 HEAD 不应打开读取流");

  streamFailure = "before";
  const failedBeforeBody = await request(port, "/large.txt");
  assert.equal(failedBeforeBody.statusCode, 500);
  assert.match(failedBeforeBody.body.toString("utf8"), /静态资源暂时无法读取/u);
  assert.equal(failedBeforeBody.headers["content-length"], undefined);

  streamFailure = "after";
  await assert.rejects(request(port, "/large.txt"), /aborted|ECONNRESET|after first byte/iu);
  streamFailure = "";

  console.log("Static response checks passed: weighted negotiation, 406, representation ETag, 304, HEAD and stream failures.");
}

function request(port, pathname, headers = {}, method = "GET") {
  return new Promise((resolve, reject) => {
    const outgoing = http.request({ host: "127.0.0.1", port, path: pathname, method, headers }, (incoming) => {
      const chunks = [];
      incoming.on("data", (chunk) => chunks.push(chunk));
      incoming.on("aborted", () => reject(new Error("response aborted")));
      incoming.on("error", reject);
      incoming.on("end", () => resolve({
        statusCode: incoming.statusCode,
        headers: incoming.headers,
        body: Buffer.concat(chunks)
      }));
    });
    outgoing.on("error", reject);
    outgoing.end();
  });
}
