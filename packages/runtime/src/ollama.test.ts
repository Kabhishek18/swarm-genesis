import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { runOllamaLoop } from "./loop.js";
import { OllamaChat } from "./ollama.js";
import { wrapPlaybook } from "./wrap.js";
import { simulatedAdapter } from "@swarm/playbooks";

function ndjson(chunks: unknown[]): string {
  return chunks.map((chunk) => JSON.stringify(chunk)).join("\n") + "\n";
}

function startFixture(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((done, fail) => {
            server.close((err) => (err ? fail(err) : done()));
          }),
      });
    });
  });
}

describe("Ollama tool loop", () => {
  it("streams thoughts, executes a capped tool, then returns a JSON artifact", async () => {
    let turns = 0;
    const fixture = await startFixture((req, res) => {
      if (req.url === "/api/tags") {
        res.writeHead(200).end(JSON.stringify({ models: [] }));
        return;
      }
      if (req.method !== "POST" || req.url !== "/api/chat") {
        res.writeHead(404).end();
        return;
      }
      turns += 1;
      res.writeHead(200, { "Content-Type": "application/x-ndjson" });
      if (turns === 1) {
        res.end(
          ndjson([
            { message: { role: "assistant", content: "Let me " } },
            { message: { role: "assistant", content: "extract." } },
            {
              message: {
                role: "assistant",
                content: "",
                tool_calls: [
                  {
                    function: {
                      name: "json_extract",
                      arguments: { json: "{\"price\":42}", path: "price" },
                    },
                  },
                ],
              },
            },
            { done: true, eval_count: 12, prompt_eval_count: 40 },
          ]),
        );
        return;
      }
      res.end(
        ndjson([
          { message: { role: "assistant", content: "{\"ok\":true,\"price\":42}" } },
          { done: true, eval_count: 8, prompt_eval_count: 20 },
        ]),
      );
    });

    try {
      const thoughts: string[] = [];
      const chat = new OllamaChat({ host: fixture.url, model: "fixture" });
      const result = await runOllamaLoop(
        chat,
        {
          role: "Scraper",
          task: "scrape-pages",
          input: { target: "Northwind" },
          envelope: {
            originalGoal: "Price the five competitors",
            qualityBar: "USD prices",
            constraints: ["Keep the original brief"],
          },
        },
        {
          agentId: "scraper-1",
          onThought: (delta) => thoughts.push(delta),
        },
        new AbortController().signal,
      );
      expect(thoughts.join("")).toContain("Let me extract.");
      expect(thoughts).toContain("tool:json_extract");
      expect(result.artifact).toEqual({ ok: true, price: 42 });
      expect(result.tokens).toBeGreaterThan(0);
      expect(turns).toBe(2);
    } finally {
      await fixture.close();
    }
  });

  it("falls back to the simulated adapter when Ollama is down", async () => {
    const playbook = {
      id: "tiny",
      name: "Tiny",
      trigger: "Do the thing",
      layoutId: "feature-dev",
      qualityBar: "done",
      constraints: ["stay on goal"],
      domains: [],
      agents: [],
      tasks: [],
      budget: {
        tokensLimit: 1000,
        wallClockLimitMs: 10_000,
        maxLiveAgents: 4,
        maxConcurrentSubagents: 1,
        maxVisibleSubagents: 2,
        maxHandoffHops: 3,
        subagentTtlMs: 1000,
      },
      adapters: [simulatedAdapter("ping", 10, 0, { pong: true })],
    };
    const bound = await wrapPlaybook(playbook, {
      chat: new OllamaChat({ host: "http://127.0.0.1:1" }),
    });
    expect(bound.live).toBe(false);
    const thoughts: string[] = [];
    const result = await bound.playbook.adapters[0].execute(
      {},
      { originalGoal: "Do the thing", qualityBar: "done", constraints: ["stay on goal"] },
      new AbortController().signal,
      { agentId: "a", onThought: (delta) => thoughts.push(delta) },
    );
    expect(result.artifact).toEqual({ pong: true });
    expect(thoughts[0]).toMatch(/^simulated:/);
  });

  it("spawn_subagent returns the child payload from the tool context", async () => {
    const { executeCappedTool } = await import("./tools.js");
    const artifact = await executeCappedTool(
      "spawn_subagent",
      { id: "kid", name: "Kid", toolId: "noop" },
      {
        agentId: "parent",
        spawnSubagent: async () => ({ summarized: true }),
      },
      new AbortController().signal,
    );
    expect(artifact).toEqual({
      spawned: "kid",
      name: "Kid",
      role: null,
      parentAgentId: "parent",
      summary: JSON.stringify({ summarized: true }),
      artifact: { summarized: true },
    });
  });

  it("spawn_subagent with taskDescription/role maps onto the child loop adapter", async () => {
    const { executeCappedTool, buildSubagentDef } = await import("./tools.js");
    const { CHILD_LOOP_TOOL_ID } = await import("@swarm/schema");
    const def = buildSubagentDef({
      taskDescription: "check auth tests",
      role: "qa_tester",
      contextPayload: "suite=unit",
    });
    expect(def.toolId).toBe(CHILD_LOOP_TOOL_ID);
    expect(def.name).toBe("qa_tester");
    expect(def.toolInput).toEqual({
      taskDescription: "check auth tests",
      role: "qa_tester",
      contextPayload: "suite=unit",
    });

    const artifact = await executeCappedTool(
      "spawn_subagent",
      { taskDescription: "check auth tests", role: "qa_tester", contextPayload: "suite=unit" },
      {
        agentId: "parent",
        spawnSubagent: async (child) => {
          expect(child.toolId).toBe(CHILD_LOOP_TOOL_ID);
          expect(child.role).toBe("qa_tester");
          return { summary: "all green", originalGoal: "auth" };
        },
      },
      new AbortController().signal,
    );
    expect(artifact).toMatchObject({
      name: "qa_tester",
      role: "qa_tester",
      parentAgentId: "parent",
      summary: "all green",
      artifact: { summary: "all green", originalGoal: "auth" },
    });
  });

  it("caps an isolated child Ollama loop at maxTurns", async () => {
    let turns = 0;
    const fixture = await startFixture((req, res) => {
      if (req.url === "/api/tags") {
        res.writeHead(200).end(JSON.stringify({ models: [] }));
        return;
      }
      if (req.method !== "POST" || req.url !== "/api/chat") {
        res.writeHead(404).end();
        return;
      }
      turns += 1;
      res.writeHead(200, { "Content-Type": "application/x-ndjson" });
      res.end(
        ndjson([
          {
            message: {
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  function: {
                    name: "scratchpad_write",
                    arguments: { note: `turn-${turns}` },
                  },
                },
              ],
            },
          },
          { done: true, eval_count: 4, prompt_eval_count: 8 },
        ]),
      );
    });

    try {
      const chat = new OllamaChat({ host: fixture.url, model: "fixture" });
      const result = await runOllamaLoop(
        chat,
        {
          role: "qa_tester",
          task: "spot-check hashing",
          input: { originalGoal: "Ship auth" },
          envelope: {
            originalGoal: "Ship auth",
            qualityBar: "tests",
            constraints: ["Keep the original brief"],
          },
        },
        { agentId: "child-1" },
        new AbortController().signal,
        fetch,
        { maxTurns: 3 },
      );
      expect(turns).toBe(3);
      expect(result.artifact).toEqual({ ok: true, task: "spot-check hashing" });
    } finally {
      await fixture.close();
    }
  });

  it("wrapPlaybook registers a simulated child loop that forwards the original goal", async () => {
    const { CHILD_LOOP_TOOL_ID } = await import("@swarm/schema");
    const playbook = {
      id: "tiny",
      name: "Tiny",
      trigger: "Do the thing",
      layoutId: "feature-dev",
      qualityBar: "done",
      constraints: ["stay on goal"],
      domains: [],
      agents: [],
      tasks: [],
      budget: {
        tokensLimit: 1000,
        wallClockLimitMs: 10_000,
        maxLiveAgents: 4,
        maxConcurrentSubagents: 1,
        maxVisibleSubagents: 2,
        maxHandoffHops: 3,
        subagentTtlMs: 1000,
      },
      adapters: [simulatedAdapter("ping", 10, 0, { pong: true })],
    };
    const bound = await wrapPlaybook(playbook, {
      chat: new OllamaChat({ host: "http://127.0.0.1:1" }),
    });
    const child = bound.playbook.adapters.find((adapter) => adapter.id === CHILD_LOOP_TOOL_ID);
    expect(child).toBeTruthy();
    const result = await child!.execute(
      { taskDescription: "review the patch", role: "qa_tester", contextPayload: "diff" },
      { originalGoal: "Ship auth", qualityBar: "tests", constraints: ["stay on goal"] },
      new AbortController().signal,
      { agentId: "kid" },
    );
    expect(result.artifact).toMatchObject({
      role: "qa_tester",
      taskDescription: "review the patch",
      originalGoal: "Ship auth",
      contextPayload: "diff",
    });
    expect(String((result.artifact as { summary: string }).summary)).toContain("review the patch");
  });
});
