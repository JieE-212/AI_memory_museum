const assert = require("assert");
const {
  COORDINATE_SPACE,
  buildImageRegionObservation,
  normalizeRegion,
  publicImageRegion
} = require("../lib/media-evidence");

let checks = 0;
const ok = (condition, message) => { assert.ok(condition, message); checks += 1; };
const throwsStatus = (fn, status) => {
  assert.throws(fn, (error) => error.statusCode === status);
  checks += 1;
};

const asset = {
  id: "asset-region-test",
  status: "ready",
  contentSha256: "a".repeat(64),
  width: 1200,
  height: 800
};

const region = normalizeRegion({ x: 0.25, y: 0.1, width: 0.5, height: 0.4 }, asset);
ok(region.x * asset.width === 300, "x maps to canonical pixels");
ok(region.y * asset.height === 80, "y maps to canonical pixels");
ok(region.width * asset.width === 600, "width maps to canonical pixels");
ok(region.height * asset.height === 320, "height maps to canonical pixels");

for (const invalid of [
  { x: -0.1, y: 0, width: 0.2, height: 0.2 },
  { x: 0, y: 0, width: 0, height: 0.2 },
  { x: 0.9, y: 0, width: 0.2, height: 0.2 },
  { x: 0, y: 0.9, width: 0.2, height: 0.2 },
  { x: Number.NaN, y: 0, width: 0.2, height: 0.2 },
  { x: 0, y: 0, width: 0.001, height: 0.001 }
]) throwsStatus(() => normalizeRegion(invalid, asset), 400);

const input = {
  label: "旧校门",
  regionType: "location",
  note: "用户确认这是毕业照片中的校门",
  region
};
const observation = buildImageRegionObservation(input, { asset, memoryId: "memory-region-test" });
ok(observation.kind === "image_region", "observation kind is stable");
ok(observation.status === "confirmed", "manual region is confirmed by user");
ok(observation.value.locator.coordinateSpace === COORDINATE_SPACE, "coordinate space is versioned");
ok(observation.value.sourceHash === `sha256:${asset.contentSha256}`, "source hash is anchored");
ok(observation.value.integrityStatus === "source_verified", "geometry integrity is explicit");
ok(observation.value.semanticStatus === "user_confirmed", "semantic confirmation is separate");
ok(observation.metadata.memoryId === "memory-region-test", "memory scope is retained");

const publicValue = publicImageRegion({
  ...observation,
  id: "observation-region-test",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
}, { assetId: asset.id, contentSha256: asset.contentSha256, width: asset.width, height: asset.height, urls: { display: "/display" } });
ok(publicValue.integrityStatus === "source_verified", "matching hash remains verified");
ok(publicValue.media.urls.display === "/display", "public evidence keeps safe media URL");

const invalidated = publicImageRegion({ ...observation, id: "observation-region-test" }, {
  assetId: asset.id,
  contentSha256: "b".repeat(64),
  urls: {}
});
ok(invalidated.integrityStatus === "source_invalidated", "changed hash invalidates old region");
throwsStatus(() => buildImageRegionObservation({ ...input, label: "" }, { asset, memoryId: "memory-region-test" }), 400);
throwsStatus(() => buildImageRegionObservation(input, { asset: { ...asset, status: "staging" }, memoryId: "memory-region-test" }), 409);
throwsStatus(() => buildImageRegionObservation(input, { asset, memoryId: "" }), 400);

console.log(`media-evidence-check: ${checks} assertions passed`);
