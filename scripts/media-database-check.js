"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { initializeMediaDatabase } = require("../lib/media-database");

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "time-isle-media-db-"));
const databasePath = path.join(temporaryDirectory, "media-check.sqlite");
const fixedNow = "2026-07-12T12:00:00.000Z";
let assertions = 0;
let db = null;
let failure = null;

try {
  db = new DatabaseSync(databasePath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE memories (id TEXT PRIMARY KEY);
    INSERT INTO memories (id) VALUES ('memory-one'), ('memory-two');
  `);

  let transactionDepth = 0;
  let idSequence = 0;
  const media = initializeMediaDatabase({
    db,
    now: () => fixedNow,
    createId: (prefix) => `${prefix}-${++idSequence}`,
    withTransaction: (operation) => {
      if (transactionDepth > 0) return operation();
      db.exec("BEGIN");
      transactionDepth += 1;
      try {
        const result = operation();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      } finally {
        transactionDepth -= 1;
      }
    }
  });

  checkSchema(db);

  const incompleteHash = digest("incomplete-preserve");
  checkThrows(
    () => media.createMediaAsset(
      sourceAsset("incomplete-preserve", { contentSha256: incompleteHash, status: "ready" }),
      [originalVariant("incomplete-preserve", incompleteHash)]
    ),
    (error) => /requires these variants/.test(error.message),
    "preserve_original cannot become ready without display and thumb variants"
  );
  checkEqual(media.getMediaAssetByHash(incompleteHash), null, "failed ready creation is rolled back atomically");

  const preserve = createReadyAsset(media, "preserve", "preserve_original");
  checkEqual(preserve.status, "ready", "complete preserve_original asset is ready");
  checkDeepEqual(
    preserve.variants.map((variant) => variant.kind),
    ["original", "display", "thumb"],
    "preserve_original retains all three variants"
  );

  const canonicalHash = digest("canonical-display-source");
  const canonicalDisplay = media.createMediaAsset(
    sourceAsset("canonical-display", {
      contentSha256: canonicalHash,
      width: 1200,
      height: 900,
      status: "ready"
    }),
    [
      originalVariant("canonical-display", canonicalHash),
      displayVariant("canonical-display"),
      thumbVariant("canonical-display")
    ]
  );
  const canonicalOriginal = canonicalDisplay.variants.find((variant) => variant.kind === "original");
  const canonicalDisplayVariant = canonicalDisplay.variants.find((variant) => variant.kind === "display");
  checkDeepEqual(
    [canonicalDisplay.width, canonicalDisplay.height],
    [canonicalDisplayVariant.width, canonicalDisplayVariant.height],
    "asset canonical dimensions may follow the orientation-normalized display variant"
  );
  checkDeepEqual(
    [canonicalOriginal.width, canonicalOriginal.height],
    [1600, 1200],
    "original variant retains its different source dimensions"
  );
  checkDeepEqual(
    [canonicalOriginal.sha256, canonicalOriginal.mimeType, canonicalOriginal.byteSize],
    [canonicalDisplay.contentSha256, canonicalDisplay.sourceMimeType, canonicalDisplay.sourceByteSize],
    "original identity still matches the asset hash, MIME type and source byte size"
  );

  const sanitized = createReadyAsset(media, "sanitized", "sanitized_only");
  checkEqual(sanitized.status, "ready", "sanitized_only asset can become ready");
  checkDeepEqual(
    sanitized.variants.map((variant) => variant.kind),
    ["display", "thumb"],
    "sanitized_only does not require an original variant"
  );

  checkThrows(
    () => media.createMediaAsset(sourceAsset("duplicate", {
      contentSha256: preserve.contentSha256,
      status: "staging"
    })),
    (error) => error.code === "MEDIA_ASSET_HASH_EXISTS",
    "content hashes are unique"
  );
  checkEqual(media.getMediaAssetByHash(preserve.contentSha256).id, preserve.id, "hash lookup still identifies the first asset");

  const firstLink = media.attachMedia("memory-one", preserve.id, { caption: "第一张照片" });
  checkEqual(firstLink.role, "cover", "the first attached photo becomes the cover");
  const secondLink = media.attachMedia("memory-one", sanitized.id, { role: "cover", position: 0 });
  checkEqual(secondLink.role, "cover", "a newly selected cover is saved");
  let memoryOneMedia = media.listMediaForMemory("memory-one");
  checkEqual(memoryOneMedia.filter((item) => item.role === "cover").length, 1, "a memory has exactly one cover");
  checkDeepEqual(memoryOneMedia.map((item) => item.position), [0, 1], "attach normalizes positions");
  checkEqual(memoryOneMedia[0].assetId, sanitized.id, "requested insertion position is honored");

  memoryOneMedia = media.reorderMemoryMedia("memory-one", [preserve.id, sanitized.id]);
  checkDeepEqual(memoryOneMedia.map((item) => item.assetId), [preserve.id, sanitized.id], "explicit ordering is persisted");
  checkDeepEqual(memoryOneMedia.map((item) => item.position), [0, 1], "reordered positions remain contiguous");
  checkEqual(memoryOneMedia.find((item) => item.assetId === sanitized.id).role, "cover", "reordering does not silently change the cover");

  memoryOneMedia = media.replaceMemoryMedia("memory-one", [
    { assetId: sanitized.id, role: "gallery", position: 0, caption: "消毒副本" },
    { assetId: preserve.id, role: "cover", position: 1, backNote: "照片背面的故事" }
  ]);
  checkDeepEqual(memoryOneMedia.map((item) => item.assetId), [sanitized.id, preserve.id], "replacement uses input order");
  checkDeepEqual(memoryOneMedia.map((item) => item.position), [0, 1], "replacement normalizes positions");
  checkEqual(memoryOneMedia[1].role, "cover", "replacement saves the explicit cover");
  checkEqual(memoryOneMedia[1].backNote, "照片背面的故事", "replacement preserves the photo-back note");
  const beforePositionMismatch = memoryOneMedia.map(({ assetId, position, role }) => ({ assetId, position, role }));
  checkThrows(
    () => media.replaceMemoryMedia("memory-one", [
      { assetId: sanitized.id, role: "gallery", position: 1 },
      { assetId: preserve.id, role: "cover", position: 0 }
    ]),
    (error) => error.code === "MEMORY_MEDIA_POSITION_MISMATCH",
    "replacement rejects declared positions that contradict array order"
  );
  checkDeepEqual(
    media.listMediaForMemory("memory-one").map(({ assetId, position, role }) => ({ assetId, position, role })),
    beforePositionMismatch,
    "a position contract rejection leaves existing associations unchanged"
  );

  const limitAssets = Array.from({ length: 5 }, (_, index) => (
    createReadyAsset(media, `limit-${index + 3}`, "preserve_original")
  ));
  limitAssets.slice(0, 4).forEach((asset) => media.attachMedia("memory-one", asset.id));
  checkEqual(media.listMediaForMemory("memory-one").length, 6, "a memory accepts exactly six media associations");
  checkThrows(
    () => media.attachMedia("memory-one", limitAssets[4].id),
    (error) => error.code === "MEMORY_MEDIA_LIMIT_EXCEEDED" && error.details.limit === 6,
    "attaching a seventh distinct asset is rejected by the database service"
  );
  media.attachMedia("memory-one", sanitized.id, { caption: "达到上限后仍可更新" });
  checkEqual(media.listMediaForMemory("memory-one").length, 6, "updating an existing association does not consume another slot");
  checkThrows(
    () => media.replaceMemoryMedia("memory-one", [sanitized, preserve, ...limitAssets].map((asset) => ({ assetId: asset.id }))),
    (error) => error.code === "MEMORY_MEDIA_LIMIT_EXCEEDED",
    "bulk replacement cannot bypass the six-photo invariant"
  );

  media.attachMedia("memory-two", preserve.id);
  const preserveUsage = media.getMediaUsage(preserve.id);
  checkEqual(preserveUsage.memoryCount, 2, "usage counts a shared asset once per memory");
  checkDeepEqual(preserveUsage.memoryIds, ["memory-one", "memory-two"], "usage reports every referencing memory");
  checkEqual(preserveUsage.variantCount, 3, "usage reports variant count");
  check(
    media.getMediaUsage().some((usage) => usage.assetId === preserve.id && usage.memoryCount === 2),
    "collection usage includes shared assets"
  );
  checkThrows(
    () => media.deleteMediaAsset(preserve.id),
    (error) => error.code === "MEDIA_ASSET_IN_USE" && error.details.memoryCount === 2,
    "shared assets cannot be deleted"
  );

  const observation = media.saveMediaObservation(preserve.id, {
    kind: "region",
    source: "user",
    value: { x: 0.1, y: 0.2, width: 0.3, height: 0.4, label: "旧校门" },
    status: "suggested",
    confidence: 0.8
  });
  checkEqual(media.getMediaObservation(observation.id).value.label, "旧校门", "observation values round-trip as JSON");
  const confirmedObservation = media.saveMediaObservation({
    id: observation.id,
    assetId: preserve.id,
    kind: "region",
    source: "user",
    value: observation.value,
    status: "confirmed",
    confidence: 1,
    sensitive: false
  });
  checkEqual(confirmedObservation.status, "confirmed", "observations can be updated");
  checkEqual(media.listMediaObservations({ assetId: preserve.id, status: "confirmed" }).length, 1, "observation filters work");
  checkEqual(media.getMediaUsage(preserve.id).observationCount, 1, "usage includes observations");
  checkEqual(media.deleteMediaObservation(observation.id).id, observation.id, "observations can be deleted");
  checkEqual(media.getMediaObservation(observation.id), null, "deleted observations are absent");

  checkThrows(
    () => media.saveMediaObservation({
      id: "observation-invalid-gps",
      assetId: preserve.id,
      kind: "gps_coordinates",
      source: "user",
      value: { latitude: 31.2, longitude: 121.5 },
      status: "confirmed",
      sensitive: false,
      metadata: {}
    }),
    (error) => error.code === "MEDIA_OBSERVATION_PRIVACY_INVALID",
    "GPS observations cannot bypass EXIF, sensitive and suggested semantics"
  );
  checkEqual(media.getMediaObservation("observation-invalid-gps"), null, "rejected GPS observations leave no database row");
  checkThrows(
    () => media.saveMediaObservation({
      id: "observation-sensitive-exif-sanitized",
      assetId: sanitized.id,
      kind: "gps_coordinates",
      source: "exif",
      value: { latitude: 31.2, longitude: 121.5 },
      status: "suggested",
      sensitive: true,
      metadata: {}
    }),
    (error) => error.code === "MEDIA_OBSERVATION_PRIVACY_INVALID",
    "sanitized-only assets reject every sensitive EXIF observation"
  );
  checkEqual(media.getMediaObservation("observation-sensitive-exif-sanitized"), null, "rejected sensitive EXIF observations leave no database row");
  checkThrows(
    () => media.saveMediaObservation({
      id: "observation-exif-kind-alias",
      assetId: preserve.id,
      kind: "gps_location",
      source: "exif",
      value: { latitude: 31.2, longitude: 121.5 },
      status: "suggested",
      sensitive: false,
      metadata: {}
    }),
    (error) => error.code === "MEDIA_OBSERVATION_PRIVACY_INVALID",
    "an unknown EXIF kind cannot disguise coordinates as public metadata"
  );
  checkEqual(media.getMediaObservation("observation-exif-kind-alias"), null, "unknown EXIF kinds leave no database row");
  checkThrows(
    () => media.saveMediaObservation({
      id: "observation-captured-at-extra-key",
      assetId: preserve.id,
      kind: "captured_at",
      source: "exif",
      value: {
        localDateTime: "2024-02-29T13:45:06",
        date: "2024-02-29",
        timezone: { kind: "offset", value: "+08:00" },
        latitude: 31.2
      },
      status: "suggested",
      sensitive: false,
      metadata: {}
    }),
    (error) => error.code === "MEDIA_OBSERVATION_PRIVACY_INVALID",
    "allowed EXIF kinds reject extra keys that could smuggle coordinates"
  );
  checkEqual(media.getMediaObservation("observation-captured-at-extra-key"), null, "malformed captured_at observations leave no database row");
  const validGps = media.saveMediaObservation({
    id: "observation-valid-gps",
    assetId: preserve.id,
    kind: "gps_coordinates",
    source: "exif",
    value: { latitude: 31.2, longitude: 121.5 },
    status: "suggested",
    sensitive: true,
    metadata: {}
  });
  checkEqual(validGps.kind, "gps_coordinates", "preserved originals may keep a correctly gated GPS suggestion");
  media.deleteMediaObservation(validGps.id);

  const stale = media.createMediaAsset(sourceAsset("stale", {
    status: "staging",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z"
  }));
  const fresh = media.createMediaAsset(sourceAsset("fresh", { status: "staging" }));
  const unreferencedIds = media.listUnreferencedMediaAssets({ limit: 100 }).map((asset) => asset.id);
  check(unreferencedIds.includes(stale.id), "unreferenced query includes stale staging assets");
  check(unreferencedIds.includes(fresh.id), "unreferenced query includes fresh staging assets");
  check(!unreferencedIds.includes(preserve.id), "unreferenced query excludes shared assets");
  const staleIds = media.listStaleMediaAssets({ before: "2026-07-11T00:00:00.000Z" }).map((asset) => asset.id);
  check(staleIds.includes(stale.id), "stale query includes old staging assets");
  check(!staleIds.includes(fresh.id), "stale query excludes fresh staging assets");
  checkEqual(media.deleteMediaAsset(stale.id).id, stale.id, "unreferenced assets can be deleted safely");
  checkEqual(media.getMediaAsset(stale.id), null, "deleted unreferenced assets are absent");
} catch (error) {
  failure = error;
} finally {
  if (db) {
    try {
      db.close();
    } catch {
      // Cleanup below is still attempted if SQLite already closed the handle.
    }
  }
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

if (failure) throw failure;
checkEqual(fs.existsSync(databasePath), false, "temporary database is removed");
console.log(`media-database-check: ${assertions} assertions passed`);

function checkSchema(database) {
  const tables = database.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name LIKE 'media_%' OR type = 'table' AND name = 'memory_media'
    ORDER BY name
  `).all().map((row) => row.name);
  checkDeepEqual(
    tables,
    ["media_assets", "media_observations", "media_variants", "memory_media"],
    "V4 creates exactly the four media tables"
  );
  const indexes = new Set(database.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'
  `).all().map((row) => row.name));
  for (const indexName of [
    "idx_media_assets_status_updated",
    "idx_media_variants_asset",
    "idx_memory_media_memory_position",
    "idx_memory_media_asset",
    "idx_memory_media_one_cover",
    "idx_media_observations_asset"
  ]) {
    check(indexes.has(indexName), `schema contains ${indexName}`);
  }
  const coverIndexSql = database.prepare("SELECT sql FROM sqlite_master WHERE name = 'idx_memory_media_one_cover'").get()?.sql || "";
  check(/UNIQUE/i.test(coverIndexSql) && /WHERE role = 'cover'/i.test(coverIndexSql), "cover uniqueness is enforced by a partial unique index");
}

function createReadyAsset(media, label, privacyMode) {
  const asset = sourceAsset(label, { privacyMode, status: "ready" });
  const variants = privacyMode === "preserve_original"
    ? [originalVariant(label, asset.contentSha256), displayVariant(label), thumbVariant(label)]
    : [displayVariant(label), thumbVariant(label)];
  return media.createMediaAsset(asset, variants);
}

function sourceAsset(label, overrides = {}) {
  return {
    contentSha256: digest(`${label}-source`),
    originalName: `${label}.jpg`,
    sourceMimeType: "image/jpeg",
    sourceByteSize: 4096,
    width: 1600,
    height: 1200,
    privacyMode: "preserve_original",
    status: "staging",
    ...overrides
  };
}

function originalVariant(label, contentSha256) {
  return {
    kind: "original",
    storageKey: `original/${label}.jpg`,
    mimeType: "image/jpeg",
    byteSize: 4096,
    width: 1600,
    height: 1200,
    sha256: contentSha256
  };
}

function displayVariant(label) {
  return {
    kind: "display",
    storageKey: `display/${label}.webp`,
    mimeType: "image/webp",
    byteSize: 2048,
    width: 1200,
    height: 900,
    sha256: digest(`${label}-display`)
  };
}

function thumbVariant(label) {
  return {
    kind: "thumb",
    storageKey: `thumb/${label}.webp`,
    mimeType: "image/webp",
    byteSize: 512,
    width: 320,
    height: 240,
    sha256: digest(`${label}-thumb`)
  };
}

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function check(condition, message) {
  assert.ok(condition, message);
  assertions += 1;
}

function checkEqual(actual, expected, message) {
  assert.equal(actual, expected, message);
  assertions += 1;
}

function checkDeepEqual(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
  assertions += 1;
}

function checkThrows(operation, predicate, message) {
  let thrown = null;
  try {
    operation();
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown && predicate(thrown), message);
  assertions += 1;
}
