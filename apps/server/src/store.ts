import { createClient, type Client } from "@libsql/client";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { applyEvent } from "@swarm/kernel";
import { emptySnapshot, type RunSnapshot, type SwarmEvent } from "@swarm/schema";

export class EventStore {
  private client: Client;

  constructor(dbPath: string) {
    const url =
      dbPath === ":memory:" ? "file::memory:" : pathToFileURL(path.resolve(dbPath)).href;
    this.client = createClient({ url });
  }

  static async open(dbPath: string): Promise<EventStore> {
    if (dbPath !== ":memory:") {
      await mkdir(path.dirname(dbPath), { recursive: true });
    }
    const store = new EventStore(dbPath);
    await store.init();
    return store;
  }

  async init(): Promise<void> {
    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        playbook_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        at INTEGER NOT NULL
      )
    `);
  }

  async createRun(runId: string, playbookId: string, at: number): Promise<void> {
    await this.client.execute({
      sql: "INSERT OR REPLACE INTO runs (id, playbook_id, status, created_at) VALUES (?, ?, ?, ?)",
      args: [runId, playbookId, "running", at],
    });
  }

  async setStatus(runId: string, status: string): Promise<void> {
    await this.client.execute({
      sql: "UPDATE runs SET status = ? WHERE id = ?",
      args: [status, runId],
    });
  }

  async append(runId: string, event: SwarmEvent): Promise<void> {
    const seqRow = await this.client.execute({
      sql: "SELECT COALESCE(MAX(seq), 0) AS max_seq FROM events WHERE run_id = ?",
      args: [runId],
    });
    const seq = Number(seqRow.rows[0]?.max_seq ?? 0) + 1;
    await this.client.execute({
      sql: "INSERT INTO events (run_id, seq, type, payload, at) VALUES (?, ?, ?, ?, ?)",
      args: [runId, seq, event.type, JSON.stringify(event), "at" in event ? event.at : Date.now()],
    });
  }

  async events(runId: string): Promise<SwarmEvent[]> {
    const result = await this.client.execute({
      sql: "SELECT payload FROM events WHERE run_id = ? ORDER BY seq ASC",
      args: [runId],
    });
    return result.rows.map((row) => JSON.parse(String(row.payload)) as SwarmEvent);
  }

  async snapshot(runId: string): Promise<RunSnapshot> {
    const events = await this.events(runId);
    return events.reduce(applyEvent, emptySnapshot());
  }

  async latestRunId(): Promise<string | null> {
    const result = await this.client.execute(
      "SELECT id FROM runs ORDER BY created_at DESC LIMIT 1",
    );
    const id = result.rows[0]?.id;
    return id ? String(id) : null;
  }
}
