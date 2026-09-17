import { describe, expect, it } from "vitest";
import { CHILD_LOOP_TOOL_ID } from "@swarm/schema";
import { SwarmKernel } from "./index.js";

describe("spawn_subagent child loop", () => {
  it("runs the child loop adapter and returns a structured summary", async () => {
    const kernel = new SwarmKernel();
    const playbook = {
      id: "spawn-child-loop",
      name: "Spawn child loop",
      trigger: "ship auth",
      layoutId: "feature-dev",
      qualityBar: "tests",
      constraints: ["keep goal"],
      budget: {
        tokensLimit: 1000,
        wallClockLimitMs: 10_000,
        maxLiveAgents: 8,
        maxConcurrentSubagents: 2,
        maxVisibleSubagents: 2,
        maxHandoffHops: 3,
        subagentTtlMs: 5_000,
      },
      domains: [{ id: "lab", name: "Lab", orchestratorId: "orch" }],
      agents: [
        { id: "meta", name: "Meta", kind: "meta" as const, role: "root", stationId: "hq", hue: 40 },
        {
          id: "orch",
          name: "Orch",
          kind: "domain-orchestrator" as const,
          domainId: "lab",
          role: "orch",
          stationId: "desk-arch",
          hue: 200,
        },
        {
          id: "worker",
          name: "Worker",
          kind: "worker" as const,
          domainId: "lab",
          role: "parent",
          stationId: "terminal-backend",
          hue: 120,
        },
      ],
      tasks: [
        {
          id: "parent-task",
          title: "Spawn a QA child",
          assignee: "worker",
          domainId: "lab",
          dependsOn: [],
          toolId: "parent-tool",
          activity: "thinking" as const,
        },
      ],
      adapters: [
        {
          id: "parent-tool",
          async execute(
            _input: unknown,
            _env: { originalGoal: string },
            _signal: AbortSignal,
            ctx?: { spawnSubagent?: (def: import("@swarm/schema").SubagentDef) => Promise<unknown> },
          ) {
            const artifact = await ctx?.spawnSubagent?.({
              id: "qa-kid",
              name: "QA Tester",
              role: "qa_tester",
              taskDescription: "Run the auth unit tests",
              contextPayload: "focus=password hashing",
            });
            return { tokens: 2, latencyMs: 0, artifact };
          },
        },
        {
          id: CHILD_LOOP_TOOL_ID,
          async execute(input: unknown, env: { originalGoal: string }) {
            const payload = input as {
              taskDescription?: string;
              role?: string;
              contextPayload?: string;
            };
            return {
              tokens: 5,
              latencyMs: 0,
              artifact: {
                summary: `${payload.role} finished ${payload.taskDescription}`,
                originalGoal: env.originalGoal,
                contextPayload: payload.contextPayload,
              },
            };
          },
        },
      ],
    };
    await kernel.start(playbook, { timeScale: 200, simulatedDuplicates: false });
    const spawned = kernel.log.events.find((event) => event.type === "subagent.spawned");
    expect(spawned?.type).toBe("subagent.spawned");
    if (spawned?.type === "subagent.spawned") {
      expect(spawned.parentAgentId).toBe("worker");
      expect(spawned.agent.role).toBe("qa_tester");
    }
    const completed = kernel.log.events.find((event) => event.type === "subagent.completed");
    expect(completed?.type).toBe("subagent.completed");
    if (completed?.type === "subagent.completed") {
      expect(completed.parentAgentId).toBe("worker");
      expect(completed.artifact).toEqual({
        summary: "qa_tester finished Run the auth unit tests",
        originalGoal: "ship auth",
        contextPayload: "focus=password hashing",
      });
    }
    expect(kernel.log.events.some((event) => event.type === "agent.despawned")).toBe(true);
    const parentStep = kernel.log.events.find(
      (event) =>
        event.type === "agent.step" && event.agentId === "worker" && event.step === "parent-tool returned",
    );
    expect(parentStep?.type).toBe("agent.step");
    if (parentStep?.type === "agent.step") {
      expect(parentStep.payload).toContain("qa_tester finished");
    }
  });
});
