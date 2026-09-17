import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyEvent } from "@swarm/kernel";
import { emptySnapshot } from "@swarm/schema";
import { EventStore } from "./store.js";

describe("EventStore persist/replay", () => {
  it("appends events and replays the same snapshot", async () => {
    const dbPath = path.join(os.tmpdir(), `swarm-test-${Date.now()}.db`);
    const store = await EventStore.open(dbPath);
    const runId = "run-test";
    await store.createRun(runId, "feature-dev", 1);

    const started = {
      type: "run.started" as const,
      runId,
      playbookId: "feature-dev",
      playbookName: "Feature",
      layoutId: "feature-dev",
      goal: "Build auth",
      envelope: {
        originalGoal: "Build auth",
        qualityBar: "tests",
        constraints: ["keep goal"],
      },
      budget: emptySnapshot().budget,
      at: 1,
    };
    const thought = {
      type: "agent.thought" as const,
      agentId: "meta",
      delta: "planning",
      at: 2,
    };
    const vote = {
      type: "task.vote" as const,
      taskId: "qa",
      voterId: "architecture",
      vote: "reject" as const,
      reason: "hash mismatch",
      at: 3,
    };
    const completed = { type: "run.completed" as const, runId, at: 4 };

    await store.append(runId, started);
    await store.append(runId, {
      type: "agent.spawned",
      agent: {
        id: "meta",
        name: "Meta",
        kind: "meta",
        role: "root",
        stationId: "hq",
        activity: "thinking",
        hue: 48,
        envelope: started.envelope,
        steps: [],
        thoughts: [],
        children: [],
        spawnedAt: 1,
        visible: true,
      },
      at: 2,
    });
    await store.append(runId, thought);
    await store.append(runId, vote);
    await store.append(runId, completed);

    const replayed = await store.snapshot(runId);
    const expected = (await store.events(runId)).reduce(applyEvent, emptySnapshot());
    expect(replayed.status).toBe("completed");
    expect(replayed.goal).toBe("Build auth");
    expect(replayed.agents[0]?.thoughts[0]?.delta).toBe("planning");
    expect(replayed.votes[0]?.vote).toBe("reject");
    expect(replayed).toEqual(expected);
  });
});
