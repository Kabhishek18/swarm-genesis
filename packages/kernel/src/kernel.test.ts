import { describe, expect, it } from "vitest";
import { SwarmKernel, applyEvent } from "./index.js";
import { emptySnapshot } from "@swarm/schema";
import { featureDevPlaybook, marketIntelPlaybook } from "@swarm/playbooks";

describe("SwarmKernel", () => {
  it("runs feature-dev, despawns sub-agents, and forwards the envelope", async () => {
    const kernel = new SwarmKernel();
    await kernel.start(featureDevPlaybook, { timeScale: 200 });
    const snap = kernel.getSnapshot();
    expect(snap.status).toBe("completed");
    expect(snap.agents.some((agent) => agent.kind === "subagent")).toBe(false);
    expect(snap.tasks.every((task) => task.status === "completed")).toBe(true);
    const spawned = kernel.log.events.filter((event) => event.type === "agent.spawned");
    expect(spawned.length).toBeGreaterThan(5);
    for (const event of spawned) {
      if (event.type !== "agent.spawned") continue;
      expect(event.agent.envelope.originalGoal).toBe(featureDevPlaybook.trigger);
    }
    const despawns = kernel.log.events.filter((event) => event.type === "agent.despawned");
    const subSpawns = spawned.filter(
      (event) => event.type === "agent.spawned" && event.agent.kind === "subagent",
    );
    expect(despawns.length).toBe(subSpawns.length);
    expect(subSpawns.length).toBe(2);
    expect(kernel.log.events.some((event) => event.type === "subagent.spawned")).toBe(true);
    expect(
      kernel.log.events.some(
        (event) => event.type === "subagent.completed" || event.type === "subagent.terminated",
      ),
    ).toBe(true);
    expect(kernel.log.events.some((event) => event.type === "task.delegated")).toBe(true);
    expect(kernel.log.events.some((event) => event.type === "orchestrator.review")).toBe(true);
    const architecture = snap.agents.find((agent) => agent.id === "architecture");
    const backend = snap.agents.find((agent) => agent.id === "backend");
    expect(architecture?.parentId).toBe("meta");
    expect(backend?.parentId).toBe("architecture");
  });

  it("trips the infinite handoff guard and lets meta override", async () => {
    const kernel = new SwarmKernel();
    await kernel.start(featureDevPlaybook, { timeScale: 200 });
    const rejected = kernel.getSnapshot().handoffs.filter((item) => item.rejected);
    expect(rejected.length).toBeGreaterThan(0);
    expect(kernel.getSnapshot().alerts.some((alert) => alert.code === "handoff-loop")).toBe(true);
    expect(kernel.getSnapshot().status).toBe("completed");
  });

  it("runs market-intel scrapers concurrently then merges", async () => {
    const kernel = new SwarmKernel();
    await kernel.start(marketIntelPlaybook, { timeScale: 200 });
    const snap = kernel.getSnapshot();
    expect(snap.status).toBe("completed");
    const scrapeStarts = kernel.log.events.filter(
      (event) =>
        event.type === "task.started" &&
        (event.taskId === "scrape-a" || event.taskId === "scrape-b" || event.taskId === "scrape-c"),
    );
    expect(scrapeStarts.length).toBe(3);
    const first = scrapeStarts[0];
    const last = scrapeStarts[2];
    if (first?.type === "task.started" && last?.type === "task.started") {
      expect(Math.abs(last.at - first.at)).toBeLessThan(50);
    }
    expect(snap.agents.some((agent) => agent.kind === "subagent")).toBe(false);
    expect(snap.budget.tokensUsed).toBeGreaterThan(20_000);
  });

  it("trips the breaker when review votes keep rejecting the same artifact", async () => {
    const kernel = new SwarmKernel();
    const playbook = {
      ...featureDevPlaybook,
      tasks: featureDevPlaybook.tasks.map((task) =>
        task.id === "quality-pingpong" && task.handoff
          ? { ...task, handoff: { ...task.handoff, duplicate: false } }
          : task,
      ),
    };
    await kernel.start(playbook, {
      timeScale: 200,
      simulatedDuplicates: false,
      reviewer: {
        async review() {
          return { vote: "reject", reason: "quality bar missed" };
        },
      },
    });
    const snap = kernel.getSnapshot();
    expect(snap.votes.some((vote) => vote.vote === "reject")).toBe(true);
    expect(snap.alerts.some((alert) => alert.code === "handoff-loop")).toBe(true);
    expect(snap.status).toBe("completed");
  });

  it("projects thought, scratchpad, and vote events", () => {
    let snap = emptySnapshot();
    snap = applyEvent(snap, {
      type: "run.started",
      runId: "run-1",
      playbookId: "p",
      playbookName: "P",
      layoutId: "p",
      goal: "g",
      envelope: { originalGoal: "g", qualityBar: "q", constraints: [] },
      budget: emptySnapshot().budget,
      at: 1,
    });
    snap = applyEvent(snap, {
      type: "agent.spawned",
      agent: {
        id: "a",
        name: "A",
        kind: "worker",
        role: "r",
        stationId: "s",
        activity: "thinking",
        hue: 1,
        envelope: { originalGoal: "g", qualityBar: "q", constraints: [] },
        steps: [],
        thoughts: [],
        children: [],
        spawnedAt: 1,
        visible: true,
      },
      at: 2,
    });
    snap = applyEvent(snap, { type: "agent.thought", agentId: "a", delta: "hmm", at: 3 });
    snap = applyEvent(snap, { type: "agent.scratchpad", agentId: "a", prompt: "sys", at: 4 });
    snap = applyEvent(snap, {
      type: "task.vote",
      taskId: "t",
      voterId: "a",
      vote: "reject",
      reason: "nope",
      at: 5,
    });
    const agent = snap.agents[0];
    expect(agent?.thoughts[0]?.delta).toBe("hmm");
    expect(agent?.scratchpad).toBe("sys");
    expect(snap.votes[0]?.vote).toBe("reject");
    snap = applyEvent(snap, { type: "file.written", path: "notes.txt", bytes: 5, at: 6 });
    expect(snap.files).toEqual([{ path: "notes.txt", bytes: 5 }]);
    snap = applyEvent(snap, { type: "file.written", path: "notes.txt", bytes: 9, at: 7 });
    expect(snap.files).toEqual([{ path: "notes.txt", bytes: 9 }]);
  });

  it("spawn_subagent returns the child artifact and emits lifecycle events", async () => {
    const kernel = new SwarmKernel();
    const envelope = { originalGoal: "summarize", qualityBar: "brief", constraints: ["keep goal"] };
    const playbook = {
      id: "spawn-return",
      name: "Spawn return",
      trigger: "summarize",
      layoutId: "feature-dev",
      qualityBar: "brief",
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
          title: "Spawn a summarizer",
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
          async execute(_input: unknown, _env: typeof envelope, _signal: AbortSignal, ctx?: { spawnSubagent?: (def: { id: string; name: string; toolId: string }) => Promise<unknown> }) {
            const artifact = await ctx?.spawnSubagent?.({
              id: "child",
              name: "Summarizer",
              toolId: "child-tool",
            });
            return { tokens: 2, latencyMs: 0, artifact };
          },
        },
        {
          id: "child-tool",
          async execute() {
            return { tokens: 3, latencyMs: 0, artifact: { summarized: true, lines: 50 } };
          },
        },
      ],
    };
    await kernel.start(playbook, { timeScale: 200, simulatedDuplicates: false });
    const completed = kernel.log.events.find((event) => event.type === "subagent.completed");
    expect(completed?.type).toBe("subagent.completed");
    if (completed?.type === "subagent.completed") {
      expect(completed.parentAgentId).toBe("worker");
      expect(completed.artifact).toEqual({ summarized: true, lines: 50 });
    }
    const parentStep = kernel.log.events.find(
      (event) => event.type === "agent.step" && event.agentId === "worker" && event.step === "parent-tool returned",
    );
    expect(parentStep?.type).toBe("agent.step");
    if (parentStep?.type === "agent.step") {
      expect(parentStep.payload).toContain("summarized");
    }
  });

  it("replays the event log to the same snapshot", async () => {
    const kernel = new SwarmKernel();
    await kernel.start(featureDevPlaybook, { timeScale: 200 });
    const live = kernel.getSnapshot();
    const replayed = kernel.log.events.reduce(applyEvent, emptySnapshot());
    expect(replayed.status).toBe(live.status);
    expect(replayed.tasks.map((task) => task.status)).toEqual(live.tasks.map((task) => task.status));
    expect(replayed.alerts.length).toBe(live.alerts.length);
  });

  it("emits file.written into the snapshot when onFileWritten fires", async () => {
    const kernel = new SwarmKernel();
    const envelope = { originalGoal: "write notes", qualityBar: "txt", constraints: ["keep goal"] };
    const playbook = {
      id: "file-write",
      name: "File write",
      trigger: "write notes",
      layoutId: "feature-dev",
      qualityBar: "txt",
      constraints: ["keep goal"],
      budget: {
        tokensLimit: 1000,
        wallClockLimitMs: 10_000,
        maxLiveAgents: 8,
        maxConcurrentSubagents: 1,
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
          role: "writer",
          stationId: "terminal-backend",
          hue: 120,
        },
      ],
      tasks: [
        {
          id: "write",
          title: "Write notes",
          assignee: "worker",
          domainId: "lab",
          dependsOn: [],
          toolId: "note-tool",
          activity: "thinking" as const,
        },
      ],
      adapters: [
        {
          id: "note-tool",
          async execute(
            _input: unknown,
            _env: typeof envelope,
            _signal: AbortSignal,
            ctx?: { onFileWritten?: (path: string, bytes: number) => void },
          ) {
            ctx?.onFileWritten?.("notes.txt", 12);
            return { tokens: 1, latencyMs: 0, artifact: { summary: "wrote notes.txt" } };
          },
        },
      ],
    };
    await kernel.start(playbook, { timeScale: 200, simulatedDuplicates: false, runId: "run-files" });
    const snap = kernel.getSnapshot();
    expect(snap.files).toEqual([{ path: "notes.txt", bytes: 12 }]);
    expect(kernel.log.events.some((event) => event.type === "file.written")).toBe(true);
  });
});
