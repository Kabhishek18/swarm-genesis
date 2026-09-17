import os from "node:os";
import path from "node:path";
import { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import { buildGateway } from "./gateway.js";
import { EventStore } from "./store.js";

describe("gateway websocket commands", () => {
  async function withGateway(
    send: Record<string, unknown>,
  ): Promise<Array<{ type?: string; runId?: string; error?: string }>> {
    process.env.OLLAMA_DISABLED = "1";
    const dbPath = path.join(os.tmpdir(), `swarm-ws-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
    const store = await EventStore.open(dbPath);
    const app = await buildGateway(store);
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address() as AddressInfo;
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
      const messages: Array<{ type?: string; runId?: string; error?: string }> = [];
      ws.on("message", (raw) => {
        messages.push(JSON.parse(String(raw)) as { type?: string; runId?: string; error?: string });
      });
      await new Promise<void>((resolve, reject) => {
        ws.on("open", resolve);
        ws.on("error", reject);
      });
      ws.send(JSON.stringify(send));
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timed out waiting for run")), 8_000);
        const tick = () => {
          if (messages.some((item) => item.type === "run")) {
            clearTimeout(timer);
            resolve();
            return;
          }
          if (messages.some((item) => item.type === "error")) {
            clearTimeout(timer);
            reject(new Error(messages.find((item) => item.type === "error")?.error ?? "ws error"));
            return;
          }
          setTimeout(tick, 50);
        };
        tick();
      });
      ws.close();
      return messages;
    } finally {
      await app.close();
    }
  }

  it("starts a playbook from an inbound start command", async () => {
    const messages = await withGateway({ type: "start", playbookId: "feature-dev", goal: "WS start test" });
    expect(messages.some((item) => item.type === "hello")).toBe(true);
    expect(messages.some((item) => item.type === "run" && Boolean(item.runId))).toBe(true);
  });

  it("starts a live-or-simulated run from START_RUN with a free-form prompt", async () => {
    const messages = await withGateway({
      type: "START_RUN",
      prompt: "Build login with hashed passwords",
    });
    expect(messages.some((item) => item.type === "run" && Boolean(item.runId))).toBe(true);
  });

  it("maps START_RUN orchestrator lead_architect onto the feature-dev playbook", async () => {
    const messages = await withGateway({
      type: "START_RUN",
      prompt: "Design the auth module",
      orchestrator: "lead_architect",
    });
    expect(messages.some((item) => item.type === "run" && Boolean(item.runId))).toBe(true);
  });
});
