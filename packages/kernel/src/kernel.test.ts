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

  it("replays the event log to the same snapshot", async () => {
    const kernel = new SwarmKernel();
    await kernel.start(featureDevPlaybook, { timeScale: 200 });
    const live = kernel.getSnapshot();
    const replayed = kernel.log.events.reduce(applyEvent, emptySnapshot());
    expect(replayed.status).toBe(live.status);
    expect(replayed.tasks.map((task) => task.status)).toEqual(live.tasks.map((task) => task.status));
    expect(replayed.alerts.length).toBe(live.alerts.length);
  });
});
