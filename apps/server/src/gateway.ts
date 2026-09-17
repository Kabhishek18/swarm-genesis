import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { SwarmKernel } from "@swarm/kernel";
import { getPlaybook, playbooks } from "@swarm/playbooks";
import { ollamaAvailable, ollamaDisabled, ollamaHost, ollamaModel, wrapPlaybook } from "@swarm/runtime";
import { emptySnapshot, type RunSnapshot, type SwarmEvent } from "@swarm/schema";
import { EventStore } from "./store.js";

export interface GatewayMessage {
  type: "event" | "snapshot" | "run" | "error" | "hello";
  event?: SwarmEvent;
  snapshot?: RunSnapshot;
  runId?: string;
  live?: boolean;
  error?: string;
}

export interface GatewayCommand {
  type: "start" | "stop" | "START_RUN";
  playbookId?: string;
  goal?: string;
  prompt?: string;
  orchestrator?: string;
  runId?: string;
}

interface LiveRun {
  id: string;
  kernel: SwarmKernel;
  stopping?: boolean;
}

export async function buildGateway(store: EventStore): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(websocket);

  app.addHook("onRequest", async (request) => {
    if (request.method === "POST" && !request.headers["content-type"]) {
      request.headers["content-type"] = "application/json";
    }
  });

  const sockets = new Set<{ send: (data: string) => void }>();
  const runs = new Map<string, LiveRun>();
  let currentRunId: string | null = null;
  let snapshotTimer: ReturnType<typeof setInterval> | undefined;

  const broadcast = (message: GatewayMessage) => {
    const payload = JSON.stringify(message);
    for (const socket of sockets) {
      try {
        socket.send(payload);
      } catch {
        sockets.delete(socket);
      }
    }
  };

  const tickSnapshots = () => {
    if (snapshotTimer) return;
    snapshotTimer = setInterval(() => {
      const live = currentRunId ? runs.get(currentRunId) : undefined;
      if (!live) return;
      broadcast({ type: "snapshot", snapshot: live.kernel.getSnapshot(), runId: live.id });
    }, 1000);
  };

  function resolvePlaybookId(playbookId?: string, orchestrator?: string): string {
    const requested = playbookId?.trim();
    if (requested) {
      try {
        getPlaybook(requested);
        return requested;
      } catch {
        /* fall through to orchestrator / default */
      }
    }
    const orch = orchestrator?.trim();
    if (orch) {
      try {
        getPlaybook(orch);
        return orch;
      } catch {
        /* map role aliases onto existing playbooks */
      }
      const lower = orch.toLowerCase();
      if (lower === "lead_architect" || lower === "architecture" || lower === "meta") {
        return "feature-dev";
      }
      const matched = playbooks.find(
        (item) =>
          item.domains.some((domain) => domain.id === orch || domain.orchestratorId === orch) ||
          item.agents.some((agent) => agent.id === orch),
      );
      if (matched) return matched.id;
    }
    return "feature-dev";
  }

  function resolveStart(command: GatewayCommand): { playbookId: string; goal?: string } {
    const goal = (command.prompt ?? command.goal)?.trim() || undefined;
    return { playbookId: resolvePlaybookId(command.playbookId, command.orchestrator), goal };
  }

  app.get("/api/playbooks", async () => ({
    playbooks: playbooks.map((item) => ({ id: item.id, name: item.name })),
  }));

  app.get("/api/runtime", async () => {
    const disabled = ollamaDisabled();
    const live = disabled ? false : await ollamaAvailable();
    return {
      disabled,
      live,
      host: ollamaHost(),
      model: ollamaModel(),
    };
  });

  async function startRun(playbookId: string, goal?: string): Promise<{ runId: string; live: boolean }> {
    const base = getPlaybook(playbookId);
    const playbook = {
      ...base,
      trigger: goal?.trim() || base.trigger,
    };
    for (const existing of runs.values()) {
      existing.kernel.stop();
    }
    runs.clear();
    const bound = await wrapPlaybook(playbook);
    const kernel = new SwarmKernel();
    const runId = `run-${Date.now()}`;
    console.log(
      `[swarm] run ${runId} live=${bound.live} disabled=${ollamaDisabled()} host=${ollamaHost()} model=${ollamaModel()}`,
    );
    currentRunId = runId;
    runs.set(runId, { id: runId, kernel });
    await store.createRun(runId, playbook.id, Date.now());

    kernel.subscribe((event, snapshot) => {
      void store.append(runId, event).catch(() => undefined);
      if (event.type === "run.completed" || event.type === "run.failed") {
        void store.setStatus(runId, snapshot.status);
      }
      broadcast({ type: "event", event, runId });
    });

    broadcast({ type: "run", runId, snapshot: emptySnapshot(), live: bound.live });
    tickSnapshots();

    void kernel
      .start(bound.playbook, {
        runId,
        reviewer: bound.reviewer,
        simulatedDuplicates: !bound.live,
      })
      .catch((error: unknown) => {
        broadcast({
          type: "error",
          runId,
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return { runId, live: bound.live };
  }

  async function stopRun(id: string | null): Promise<{ runId: string; status: string } | null> {
    if (!id) return null;
    const live = runs.get(id);
    if (!live) return null;
    live.kernel.stop();
    live.stopping = true;
    await store.setStatus(id, "failed");
    return { runId: id, status: "stopped" };
  }

  app.get("/api/runs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const live = runs.get(id);
    if (live) return { runId: id, snapshot: live.kernel.getSnapshot() };
    try {
      const snapshot = await store.snapshot(id);
      return { runId: id, snapshot };
    } catch {
      return reply.code(404).send({ error: "run not found" });
    }
  });

  app.post("/api/runs", async (request, reply) => {
    const body = (request.body ?? {}) as { playbookId?: string; goal?: string };
    if (!body.playbookId) {
      return reply.code(400).send({ error: "playbookId required" });
    }
    return startRun(body.playbookId, body.goal);
  });

  app.post("/api/runs/:id/stop", async (request, reply) => {
    const { id } = request.params as { id: string };
    const stopped = await stopRun(id);
    if (!stopped) return reply.code(404).send({ error: "run not found" });
    return stopped;
  });

  app.get("/ws", { websocket: true }, (socket) => {
    sockets.add(socket);
    const live = currentRunId ? runs.get(currentRunId) : undefined;
    socket.send(
      JSON.stringify({
        type: "hello",
        runId: live?.id,
        snapshot: live?.kernel.getSnapshot(),
      } satisfies GatewayMessage),
    );
    if (live) {
      socket.send(
        JSON.stringify({
          type: "snapshot",
          runId: live.id,
          snapshot: live.kernel.getSnapshot(),
        } satisfies GatewayMessage),
      );
    }
    socket.on("message", (raw) => {
      let command: GatewayCommand;
      try {
        command = JSON.parse(String(raw)) as GatewayCommand;
      } catch {
        socket.send(JSON.stringify({ type: "error", error: "invalid command" } satisfies GatewayMessage));
        return;
      }
      if (command.type === "start" || command.type === "START_RUN") {
        if (command.type === "start" && !command.playbookId) {
          socket.send(JSON.stringify({ type: "error", error: "playbookId required" } satisfies GatewayMessage));
          return;
        }
        const resolved = resolveStart(command);
        void startRun(resolved.playbookId, resolved.goal).catch((error: unknown) => {
          socket.send(
            JSON.stringify({
              type: "error",
              error: error instanceof Error ? error.message : String(error),
            } satisfies GatewayMessage),
          );
        });
        return;
      }
      if (command.type === "stop") {
        void stopRun(command.runId ?? currentRunId).then((stopped) => {
          if (!stopped) {
            socket.send(JSON.stringify({ type: "error", error: "run not found" } satisfies GatewayMessage));
          }
        });
      }
    });
    socket.on("close", () => {
      sockets.delete(socket);
    });
  });

  app.addHook("onClose", async () => {
    if (snapshotTimer) clearInterval(snapshotTimer);
    for (const live of runs.values()) live.kernel.stop();
  });

  return app;
}
