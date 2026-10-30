import { readFile } from "node:fs/promises";
import pg from "pg";
import { fieldNote, observation, reviewRecord, scientificFinding, sieDecisionRecord, voiceUtterance } from "@nexus/schemas";
import type { FieldNote, Observation, ScientificFinding, SieDecisionRecord, VoiceUtterance } from "@nexus/schemas";
import type { z } from "zod";
import type { ReviewRecord, Store } from "./store.js";
import { withReview } from "./store.js";

/** Postgres-backed store. Every document is re-parsed on read so a bad row never reaches a client. */
export class PgStore implements Store {
  constructor(private readonly pool: pg.Pool) {}

  static async connect(url: string): Promise<PgStore> {
    const pool = new pg.Pool({ connectionString: url, max: 10 });
    const sql = await readFile(new URL("./migrations/001_init.sql", import.meta.url), "utf8");
    await pool.query(sql);
    return new PgStore(pool);
  }

  async createObservation(o: Observation) {
    await this.pool.query("INSERT INTO observations (id, site_id, doc) VALUES ($1, $2, $3)", [o.id, o.siteId, o]);
  }
  async getObservation(id: string) {
    return this.one("SELECT doc FROM observations WHERE id = $1", [id], observation);
  }
  async createUtterance(u: VoiceUtterance) {
    await this.pool.query("INSERT INTO utterances (id, session_id, doc) VALUES ($1, $2, $3)", [u.id, u.sessionId, u]);
  }
  async getUtterance(id: string) {
    return this.one("SELECT doc FROM utterances WHERE id = $1", [id], voiceUtterance);
  }
  async createFieldNote(n: FieldNote) {
    await this.pool.query("INSERT INTO field_notes (id, observation_id, doc) VALUES ($1, $2, $3)", [n.id, n.observationId, n]);
  }
  async listFieldNotes(observationId: string) {
    return this.many("SELECT doc FROM field_notes WHERE observation_id = $1 ORDER BY created_at", [observationId], fieldNote);
  }
  async saveFinding(f: ScientificFinding) {
    await this.pool.query(
      `INSERT INTO findings (id, observation_id, status, doc, updated_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, doc = EXCLUDED.doc, updated_at = EXCLUDED.updated_at
       WHERE findings.status <> 'reviewed'`,
      [f.id, f.observationId, f.status, f, f.updatedAt],
    );
  }
  async getFinding(id: string) {
    return this.one("SELECT doc FROM findings WHERE id = $1", [id], scientificFinding);
  }
  async listFindings(filter: { observationId?: string }) {
    return filter.observationId
      ? this.many("SELECT doc FROM findings WHERE observation_id = $1 ORDER BY updated_at", [filter.observationId], scientificFinding)
      : this.many("SELECT doc FROM findings ORDER BY updated_at", [], scientificFinding);
  }
  async applyReview(r: ReviewRecord) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Row lock + status check makes the "awaiting review" test and the update atomic.
      const cur = await client.query("SELECT doc FROM findings WHERE id = $1 AND status = 'ready_for_review' FOR UPDATE", [r.findingId]);
      const row: unknown = cur.rows[0]?.doc;
      if (row === undefined) {
        await client.query("ROLLBACK");
        return undefined;
      }
      const updated = withReview(scientificFinding.parse(row), r);
      await client.query("UPDATE findings SET status = $2, doc = $3, updated_at = $4 WHERE id = $1", [
        updated.id,
        updated.status,
        updated,
        updated.updatedAt,
      ]);
      await client.query("INSERT INTO reviews (finding_id, session_id, doc) VALUES ($1, $2, $3)", [r.findingId, r.sessionId, r]);
      await client.query("COMMIT");
      return updated;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  async listReviews(sessionId: string) {
    return this.many("SELECT doc FROM reviews WHERE session_id = $1 ORDER BY id", [sessionId], reviewRecord);
  }
  async appendSieDecision(r: SieDecisionRecord) {
    await this.pool.query("INSERT INTO sie_decisions (id, subject_id, doc) VALUES ($1, $2, $3)", [r.id, r.subjectId, r]);
  }
  async getSieDecision(id: string) {
    return this.one("SELECT doc FROM sie_decisions WHERE id = $1", [id], sieDecisionRecord);
  }
  async close() {
    await this.pool.end();
  }

  private async one<T extends z.ZodTypeAny>(sql: string, params: unknown[], schema: T): Promise<z.infer<T> | undefined> {
    const res = await this.pool.query(sql, params);
    const row: unknown = res.rows[0]?.doc;
    return row === undefined ? undefined : schema.parse(row);
  }
  private async many<T extends z.ZodTypeAny>(sql: string, params: unknown[], schema: T): Promise<z.infer<T>[]> {
    const res = await this.pool.query(sql, params);
    return res.rows.map((r: { doc: unknown }) => schema.parse(r.doc));
  }
}
