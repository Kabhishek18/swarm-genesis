import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildGateway } from "./gateway.js";
import { EventStore } from "./store.js";
import { executeCappedTool } from "@swarm/runtime";

describe("run workspace zip", () => {
  it("404s when the run directory is missing", async () => {
    process.env.OLLAMA_DISABLED = "1";
    const dbPath = path.join(os.tmpdir(), `swarm-zip-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
    const runsDir = await mkdtemp(path.join(os.tmpdir(), "swarm-runs-"));
    const store = await EventStore.open(dbPath);
    const app = await buildGateway(store, { runsDir });
    try {
      const missing = await app.inject({ method: "GET", url: "/api/runs/run-missing/files.zip" });
      expect(missing.statusCode).toBe(404);
      const list = await app.inject({ method: "GET", url: "/api/runs/run-missing/files" });
      expect(list.statusCode).toBe(404);
    } finally {
      await app.close();
      await rm(runsDir, { recursive: true, force: true });
    }
  });

  it("writes a txt file and serves a zip that contains it", async () => {
    process.env.OLLAMA_DISABLED = "1";
    const dbPath = path.join(os.tmpdir(), `swarm-zip-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
    const runsDir = await mkdtemp(path.join(os.tmpdir(), "swarm-runs-"));
    const store = await EventStore.open(dbPath);
    const app = await buildGateway(store, { runsDir });
    const runId = "run-zip";
    const workspaceDir = path.join(runsDir, runId);
    await mkdir(workspaceDir, { recursive: true });
    try {
      const content = "hello workspace";
      await executeCappedTool(
        "write_file",
        { path: "notes.txt", content },
        { agentId: "writer", workspaceDir },
        new AbortController().signal,
      );

      const listed = await app.inject({ method: "GET", url: `/api/runs/${runId}/files` });
      expect(listed.statusCode).toBe(200);
      expect(listed.json()).toEqual({
        files: [{ path: "notes.txt", bytes: Buffer.byteLength(content, "utf8") }],
      });

      const zip = await app.inject({ method: "GET", url: `/api/runs/${runId}/files.zip` });
      expect(zip.statusCode).toBe(200);
      expect(String(zip.headers["content-type"])).toContain("application/zip");
      const body = zip.rawPayload.toString("utf8");
      expect(body).toContain("notes.txt");
      expect(body).toContain(content);
    } finally {
      await app.close();
      await rm(runsDir, { recursive: true, force: true });
    }
  });

  it("hydrates snapshot.files from disk even without file.written events", async () => {
    process.env.OLLAMA_DISABLED = "1";
    const dbPath = path.join(os.tmpdir(), `swarm-hydrate-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
    const runsDir = await mkdtemp(path.join(os.tmpdir(), "swarm-runs-"));
    const store = await EventStore.open(dbPath);
    const app = await buildGateway(store, { runsDir });
    const runId = "run-hydrate";
    const workspaceDir = path.join(runsDir, runId);
    await mkdir(workspaceDir, { recursive: true });
    const html = "<!doctype html><title>stub</title>";
    await writeFile(path.join(workspaceDir, "index.html"), html, "utf8");
    await store.createRun(runId, "build-website", Date.now());
    try {
      const listed = await app.inject({ method: "GET", url: `/api/runs/${runId}/files` });
      expect(listed.statusCode).toBe(200);
      expect(listed.json()).toEqual({
        files: [{ path: "index.html", bytes: Buffer.byteLength(html, "utf8") }],
      });

      const got = await app.inject({ method: "GET", url: `/api/runs/${runId}` });
      expect(got.statusCode).toBe(200);
      expect(got.json().snapshot.files).toEqual([
        { path: "index.html", bytes: Buffer.byteLength(html, "utf8") },
      ]);

      const zip = await app.inject({ method: "GET", url: `/api/runs/${runId}/files.zip` });
      expect(zip.statusCode).toBe(200);
      expect(zip.rawPayload.toString("utf8")).toContain("index.html");
    } finally {
      await app.close();
      await rm(runsDir, { recursive: true, force: true });
    }
  });

  it("rejects writing outside the run dir", async () => {
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "swarm-ws-"));
    try {
      await writeFile(path.join(workspaceDir, "keep.txt"), "safe", "utf8");
      await expect(
        executeCappedTool(
          "write_file",
          { path: "../escape.txt", content: "bad" },
          { agentId: "writer", workspaceDir },
          new AbortController().signal,
        ),
      ).rejects.toThrow(/traversal/i);
    } finally {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });
});
