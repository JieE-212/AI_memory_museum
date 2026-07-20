"use strict";

const { applyMigrations } = require("./migrations");

const PROVENANCE_CO_MEMORY_SCHEMA_VERSION = 18;

const PROVENANCE_CO_MEMORY_MIGRATION = Object.freeze({
  version: PROVENANCE_CO_MEMORY_SCHEMA_VERSION,
  name: "co-memory-response-as-independent-provenance-source",
  up(db) {
    db.exec(`
      DROP TRIGGER provenance_source_update_immutable;
      DROP TRIGGER provenance_source_set_frozen;
      DROP INDEX idx_provenance_sources_claim;
      DROP INDEX idx_provenance_sources_anchor;

      ALTER TABLE provenance_claim_sources RENAME TO provenance_claim_sources_v16;

      CREATE TABLE provenance_claim_sources (
        id TEXT PRIMARY KEY,
        claim_id TEXT NOT NULL,
        position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 7),
        relation_kind TEXT NOT NULL CHECK (relation_kind IN ('supports', 'supplements', 'different_record')),
        source_kind TEXT NOT NULL CHECK (source_kind IN (
          'memory_text', 'document_excerpt', 'image_region', 'voice_segment',
          'oral_history_excerpt', 'co_memory_response'
        )),
        source_key TEXT NOT NULL,
        anchor_key TEXT NOT NULL,
        origin_ref_json TEXT NOT NULL CHECK (json_valid(origin_ref_json) AND json_type(origin_ref_json) = 'object'),
        locator_json TEXT NOT NULL CHECK (json_valid(locator_json) AND json_type(locator_json) = 'object'),
        snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json) AND json_type(snapshot_json) = 'object'),
        snapshot_sha256 TEXT NOT NULL CHECK (
          length(snapshot_sha256) = 64 AND snapshot_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
        sensitive INTEGER NOT NULL DEFAULT 0 CHECK (sensitive IN (0, 1)),
        created_at TEXT NOT NULL,
        UNIQUE (claim_id, position),
        UNIQUE (claim_id, anchor_key),
        FOREIGN KEY (claim_id) REFERENCES provenance_claims(id) ON DELETE CASCADE
      );

      INSERT INTO provenance_claim_sources (
        id, claim_id, position, relation_kind, source_kind, source_key, anchor_key,
        origin_ref_json, locator_json, snapshot_json, snapshot_sha256, sensitive, created_at
      )
      SELECT
        id, claim_id, position, relation_kind, source_kind, source_key, anchor_key,
        origin_ref_json, locator_json, snapshot_json, snapshot_sha256, sensitive, created_at
      FROM provenance_claim_sources_v16;

      DROP TABLE provenance_claim_sources_v16;

      CREATE INDEX idx_provenance_sources_claim
        ON provenance_claim_sources(claim_id, position, id);
      CREATE INDEX idx_provenance_sources_anchor
        ON provenance_claim_sources(source_kind, anchor_key, claim_id);

      CREATE TRIGGER provenance_source_update_immutable
      BEFORE UPDATE ON provenance_claim_sources
      BEGIN
        SELECT RAISE(ABORT, 'PROVENANCE_SOURCE_IMMUTABLE');
      END;

      CREATE TRIGGER provenance_source_set_frozen
      BEFORE INSERT ON provenance_claim_sources
      WHEN EXISTS (SELECT 1 FROM provenance_claim_events event WHERE event.claim_id = new.claim_id)
      BEGIN
        SELECT RAISE(ABORT, 'PROVENANCE_SOURCE_SET_FROZEN');
      END;
    `);
  }
});

function initializeProvenanceCoMemoryMigration(options = {}) {
  if (!options.db || typeof options.db.exec !== "function" || typeof options.db.prepare !== "function") {
    throw new TypeError("initializeProvenanceCoMemoryMigration requires a synchronous SQLite database.");
  }
  return applyMigrations({
    db: options.db,
    baselineVersion: 4,
    migrations: [PROVENANCE_CO_MEMORY_MIGRATION],
    supportedVersion: Math.max(PROVENANCE_CO_MEMORY_SCHEMA_VERSION, Number(options.schemaVersion) || PROVENANCE_CO_MEMORY_SCHEMA_VERSION),
    now: typeof options.now === "function" ? options.now : () => new Date().toISOString()
  });
}

module.exports = {
  PROVENANCE_CO_MEMORY_MIGRATION,
  PROVENANCE_CO_MEMORY_SCHEMA_VERSION,
  initializeProvenanceCoMemoryMigration
};
