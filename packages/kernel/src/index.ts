import type {
  AgentDef,
  AgentSnapshot,
  Budget,
  ConstraintEnvelope,
  Playbook,
  SubagentDef,
  SwarmEvent,
  TaskDef,
  TaskSnapshot,
  ToolAdapter,
} from "@swarm/schema";
import { hashArtifact } from "@swarm/schema";
import { EventLog, type EventListener } from "./event-log.js";

export interface KernelOptions {
  /** Divides simulated tool latency. Tests use a large scale. */
  timeScale?: number;
  now?: () => number;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function requireEnvelope(envelope: ConstraintEnvelope): void {
  if (!envelope.originalGoal.trim()) {
    throw new Error("ConstraintEnvelope missing originalGoal");
  }
}

export class SwarmKernel {
  readonly log = new EventLog();
  private adapters = new Map<string, ToolAdapter>();
  private abort?: AbortController;
  private inFlight = new Set<Promise<void>>();
  private busy = new Set<string>();
  private handoffHops = new Map<string, number>();
  private handoffHashes = new Set<string>();
  private startedAt = 0;
  private clock = () => Date.now();
  private timeScale = 1;
  private tickTimer?: ReturnType<typeof setInterval>;
  private subagentWaiters: Array<() => void> = [];
  private subagentSlots = 0;

  subscribe(listener: EventListener): () => void {
    return this.log.subscribe(listener);
  }

  getSnapshot() {
    return this.log.getSnapshot();
  }

  stop(): void {
    this.abort?.abort();
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = undefined;
    }
  }

  async start(playbook: Playbook, options: KernelOptions = {}): Promise<void> {
    this.stop();
    this.log.reset();
    this.adapters = new Map(playbook.adapters.map((adapter) => [adapter.id, adapter]));
    this.busy.clear();
    this.inFlight.clear();
    this.handoffHops.clear();
    this.handoffHashes.clear();
    this.subagentWaiters = [];
    this.subagentSlots = 0;
    this.timeScale = options.timeScale ?? 1;
    this.clock = options.now ?? Date.now;
    this.abort = new AbortController();
    const signal = this.abort.signal;
    this.startedAt = this.clock();

    const envelope: ConstraintEnvelope = {
      originalGoal: playbook.trigger,
      qualityBar: playbook.qualityBar,
      constraints: playbook.constraints,
    };
    requireEnvelope(envelope);

    const budget: Budget = {
      ...playbook.budget,
      tokensUsed: 0,
      wallClockMs: 0,
      liveAgents: 0,
      liveSubagents: 0,
    };

    this.emit({
      type: "run.started",
      runId: `run-${this.startedAt}`,
      playbookId: playbook.id,
      playbookName: playbook.name,
      layoutId: playbook.layoutId,
      goal: playbook.trigger,
      envelope,
      budget,
      at: this.startedAt,
    });

    this.tickTimer = setInterval(() => {
      if (signal.aborted) return;
      this.emitBudget();
    }, 250);

    try {
      await this.bootstrap(playbook, envelope, signal);
      await this.loop(playbook, envelope, signal);
      if (!signal.aborted) {
        for (const domain of playbook.domains) {
          this.emit({ type: "domain.closed", domainId: domain.id, at: this.clock() });
        }
        this.emit({ type: "run.completed", runId: this.log.getSnapshot().runId, at: this.clock() });
      }
    } catch (error) {
      if (isAbortError(error)) {
        this.emit({
          type: "run.failed",
          runId: this.log.getSnapshot().runId,
          error: "stopped",
          at: this.clock(),
        });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.emit({
        type: "run.failed",
        runId: this.log.getSnapshot().runId,
        error: message,
        at: this.clock(),
      });
      throw error;
    } finally {
      if (this.tickTimer) {
        clearInterval(this.tickTimer);
        this.tickTimer = undefined;
      }
    }
  }

  private emit(event: SwarmEvent): void {
    this.log.append(event);
  }

  private emitBudget(): void {
    const snapshot = this.log.getSnapshot();
    if (snapshot.status !== "running") return;
    this.emit({
      type: "run.budget.updated",
      budget: {
        ...snapshot.budget,
        wallClockMs: this.clock() - this.startedAt,
        liveAgents: snapshot.agents.length,
        liveSubagents: snapshot.agents.filter((a) => a.kind === "subagent").length,
      },
      at: this.clock(),
    });
  }

  private spawnFromDef(
    def: AgentDef,
    envelope: ConstraintEnvelope,
    activity: AgentSnapshot["activity"] = "idling",
  ): void {
    requireEnvelope(envelope);
    const agent: AgentSnapshot = {
      id: def.id,
      name: def.name,
      kind: def.kind,
      domainId: def.domainId,
      role: def.role,
      stationId: def.stationId,
      activity,
      hue: def.hue,
      envelope: { ...envelope, constraints: [...envelope.constraints] },
      steps: [`spawned as ${def.role}`],
      spawnedAt: this.clock(),
      visible: true,
    };
    this.emit({ type: "agent.spawned", agent, at: this.clock() });
  }

  private async bootstrap(
    playbook: Playbook,
    envelope: ConstraintEnvelope,
    signal: AbortSignal,
  ): Promise<void> {
    const meta = playbook.agents.find((agent) => agent.kind === "meta");
    if (!meta) throw new Error("Playbook is missing a meta orchestrator");
    this.spawnFromDef(meta, envelope, "thinking");
    this.emit({
      type: "agent.step",
      agentId: meta.id,
      step: "Decomposing goal into operational domains",
      payload: envelope.originalGoal,
      at: this.clock(),
    });
    await this.delay(900, signal);

    for (const domain of playbook.domains) {
      this.emit({
        type: "domain.opened",
        domain: {
          id: domain.id,
          name: domain.name,
          orchestratorId: domain.orchestratorId,
          open: true,
          queued: 0,
          locked: 0,
          running: 0,
          completed: 0,
        },
        at: this.clock(),
      });
      const orch = playbook.agents.find((agent) => agent.id === domain.orchestratorId);
      if (!orch) throw new Error(`Missing orchestrator ${domain.orchestratorId}`);
      this.spawnFromDef(orch, envelope, "thinking");
      this.emit({
        type: "agent.step",
        agentId: orch.id,
        step: `Opened domain ${domain.name}`,
        at: this.clock(),
      });
    }

    for (const worker of playbook.agents.filter((agent) => agent.kind === "worker")) {
      this.spawnFromDef(worker, envelope, "idling");
    }

    for (const task of playbook.tasks) {
      const snapshot: TaskSnapshot = {
        id: task.id,
        title: task.title,
        assignee: task.assignee,
        domainId: task.domainId,
        dependsOn: task.dependsOn,
        status: task.dependsOn.length ? "locked" : "queued",
        activity: task.activity,
        stationId: task.stationId,
      };
      this.emit({ type: "task.queued", task: snapshot, at: this.clock() });
      if (snapshot.status === "locked") {
        this.emit({ type: "task.locked", taskId: task.id, at: this.clock() });
      }
    }

    this.emit({
      type: "agent.activity",
      agentId: meta.id,
      activity: "reviewing",
      stationId: meta.stationId,
      step: "Dispatching domain tracks",
      at: this.clock(),
    });
  }

  private async loop(
    playbook: Playbook,
    envelope: ConstraintEnvelope,
    signal: AbortSignal,
  ): Promise<void> {
    while (!signal.aborted) {
      this.unlockReadyTasks();
      this.guardBudget(playbook);
      const runnable = this.runnableTasks(playbook);
      for (const task of runnable) {
        const work = this.executeTask(playbook, task, envelope, signal).finally(() => {
          this.inFlight.delete(work);
        });
        this.inFlight.add(work);
      }

      if (this.inFlight.size === 0) {
        const tasks = this.log.getSnapshot().tasks;
        const unfinished = tasks.filter(
          (task) => task.status !== "completed" && task.status !== "failed" && task.status !== "cancelled",
        );
        if (unfinished.length === 0) return;
        const blocked = unfinished.every((task) => task.status === "locked");
        if (blocked) {
          throw new Error("Deadlock: remaining tasks are locked with no running work");
        }
        await this.delay(40, signal);
        continue;
      }

      await Promise.race([...this.inFlight, this.delay(80, signal)]);
    }
  }

  private guardBudget(playbook: Playbook): void {
    const snapshot = this.log.getSnapshot();
    const wall = this.clock() - this.startedAt;
    if (snapshot.budget.tokensUsed > snapshot.budget.tokensLimit) {
      this.alert("budget", "critical", "Token budget exhausted", [playbook.agents[0]?.id ?? "meta"]);
      throw new Error("Token budget exhausted");
    }
    if (wall > snapshot.budget.wallClockLimitMs) {
      this.alert("budget", "critical", "Wall-clock budget exhausted", []);
      throw new Error("Wall-clock budget exhausted");
    }
  }

  private unlockReadyTasks(): void {
    const snapshot = this.log.getSnapshot();
    const completed = new Set(
      snapshot.tasks.filter((task) => task.status === "completed").map((task) => task.id),
    );
    for (const task of snapshot.tasks) {
      if (task.status !== "locked") continue;
      if (task.dependsOn.every((id) => completed.has(id))) {
        this.emit({ type: "task.unlocked", taskId: task.id, at: this.clock() });
      }
    }
  }

  private runnableTasks(playbook: Playbook): TaskDef[] {
    const snapshot = this.log.getSnapshot();
    const completed = new Set(
      snapshot.tasks.filter((task) => task.status === "completed").map((task) => task.id),
    );
    return playbook.tasks.filter((def) => {
      const current = snapshot.tasks.find((task) => task.id === def.id);
      if (!current || current.status !== "queued") return false;
      if (this.busy.has(def.assignee)) return false;
      return def.dependsOn.every((id) => completed.has(id));
    });
  }

  private async executeTask(
    playbook: Playbook,
    task: TaskDef,
    envelope: ConstraintEnvelope,
    signal: AbortSignal,
  ): Promise<void> {
    requireEnvelope(envelope);
    this.busy.add(task.assignee);
    const agent = playbook.agents.find((item) => item.id === task.assignee);
    if (!agent) {
      this.busy.delete(task.assignee);
      throw new Error(`Unknown assignee ${task.assignee}`);
    }

    const stationId = task.stationId ?? agent.stationId;
    this.emit({ type: "task.started", taskId: task.id, agentId: agent.id, at: this.clock() });
    this.emit({
      type: "agent.activity",
      agentId: agent.id,
      activity: task.activity,
      stationId,
      step: task.title,
      at: this.clock(),
    });
    this.emit({
      type: "agent.step",
      agentId: agent.id,
      step: task.title,
      payload: envelope.originalGoal,
      at: this.clock(),
    });

    let artifact: unknown = { task: task.id, ok: true };
    try {
      if (task.review) {
        await this.delay(1200, signal);
        this.emit({
          type: "agent.step",
          agentId: agent.id,
          step: `Validating merge gate for ${task.title}`,
          at: this.clock(),
        });
      }

      if (task.toolId) {
        artifact = await this.runTool(agent.id, task.toolId, task.toolInput, envelope, signal);
      } else {
        await this.delay(task.review ? 800 : 600, signal);
      }

      if (task.subagents?.length) {
        this.emit({
          type: "agent.activity",
          agentId: agent.id,
          activity: "spawning",
          stationId,
          step: `Spawning ${task.subagents.length} sub-agents`,
          at: this.clock(),
        });
        await Promise.all(
          task.subagents.map((sub) =>
            this.runSubagent(playbook, agent, sub, envelope, signal),
          ),
        );
      }

      if (task.handoff) {
        artifact = await this.handleHandoff(playbook, task, agent.id, artifact, envelope, signal);
      }

      this.emit({
        type: "task.completed",
        taskId: task.id,
        outputHash: hashArtifact(artifact),
        at: this.clock(),
      });
      this.emit({
        type: "agent.activity",
        agentId: agent.id,
        activity: "idling",
        stationId: this.idleStation(playbook, agent),
        at: this.clock(),
      });
    } catch (error) {
      if (isAbortError(error)) return;
      const message = error instanceof Error ? error.message : String(error);
      this.emit({ type: "task.failed", taskId: task.id, error: message, at: this.clock() });
      throw error;
    } finally {
      this.busy.delete(task.assignee);
    }
  }

  private idleStation(_playbook: Playbook, agent: AgentDef): string {
    if (agent.kind === "worker" && agent.domainId) {
      return `${agent.domainId}-archive`;
    }
    return agent.stationId;
  }

  private async handleHandoff(
    playbook: Playbook,
    task: TaskDef,
    from: string,
    artifact: unknown,
    envelope: ConstraintEnvelope,
    signal: AbortSignal,
  ): Promise<unknown> {
    const handoff = task.handoff;
    if (!handoff) return artifact;
    const attempts = handoff.duplicate ? this.log.getSnapshot().budget.maxHandoffHops : 1;
    let lastArtifact = artifact;
    for (let i = 0; i < attempts; i++) {
      lastArtifact = await this.emitHandoffAttempt(
        playbook,
        task,
        from,
        handoff.duplicate ? { ping: "same-revision" } : lastArtifact,
        envelope,
        signal,
      );
      const rejected = this.log
        .getSnapshot()
        .handoffs.some((item) => item.taskId === task.id && item.rejected);
      if (rejected) break;
    }
    return lastArtifact;
  }

  private async emitHandoffAttempt(
    playbook: Playbook,
    task: TaskDef,
    from: string,
    artifact: unknown,
    envelope: ConstraintEnvelope,
    signal: AbortSignal,
  ): Promise<unknown> {
    const handoff = task.handoff;
    if (!handoff) return artifact;
    const lineage = `${from}:${handoff.to}:${task.id}`;
    const hop = (this.handoffHops.get(lineage) ?? 0) + 1;
    this.handoffHops.set(lineage, hop);
    const key = `${from}:${handoff.to}:${hashArtifact(artifact)}`;
    const snapshot = this.log.getSnapshot();
    const maxHops = snapshot.budget.maxHandoffHops;
    const duplicate = this.handoffHashes.has(key);
    this.handoffHashes.add(key);

    const record = {
      id: `hand-${task.id}-${hop}`,
      from,
      to: handoff.to,
      taskId: task.id,
      reason: handoff.reason,
      hop,
      rejected: false,
      at: this.clock(),
    };

    if (hop >= maxHops || duplicate) {
      const rejected = { ...record, rejected: true };
      this.emit({ type: "task.handoff.rejected", handoff: rejected, at: this.clock() });
      this.alert(
        "handoff-loop",
        "critical",
        duplicate
          ? `Infinite handoff loop on ${task.title}: identical output bounced ${from} ↔ ${handoff.to}`
          : `Handoff hop ${hop} exceeded cap ${maxHops} on ${task.title}`,
        [from, handoff.to],
      );
      const meta = playbook.agents.find((agent) => agent.kind === "meta");
      if (meta) {
        this.emit({
          type: "agent.step",
          agentId: meta.id,
          step: `Meta override: accepting ${task.title} after handoff halt`,
          at: this.clock(),
        });
      }
      await this.delay(400, signal);
      return artifact;
    }

    this.emit({ type: "task.handoff", handoff: record, at: this.clock() });
    this.emit({
      type: "agent.activity",
      agentId: from,
      activity: "reviewing",
      stationId: playbook.agents.find((a) => a.id === from)?.stationId ?? "",
      step: `Handing ${task.title} to ${handoff.to} (hop ${hop})`,
      at: this.clock(),
    });
    const target = playbook.agents.find((agent) => agent.id === handoff.to);
    if (target) {
      this.emit({
        type: "agent.activity",
        agentId: target.id,
        activity: "reviewing",
        stationId: target.stationId,
        step: `Reviewing handoff: ${handoff.reason}`,
        at: this.clock(),
      });
      this.emit({
        type: "agent.step",
        agentId: target.id,
        step: `Reviewing handoff: ${handoff.reason}`,
        payload: envelope.originalGoal,
        at: this.clock(),
      });
    }
    await this.delay(900, signal);
    return artifact;
  }

  private async runSubagent(
    _playbook: Playbook,
    parent: AgentDef,
    sub: SubagentDef,
    envelope: ConstraintEnvelope,
    signal: AbortSignal,
  ): Promise<void> {
    if (!sub) return;
    requireEnvelope(envelope);
    await this.acquireSubagentSlot(signal);
    const snapshot = this.log.getSnapshot();
    const visibleCount = snapshot.agents.filter((agent) => agent.kind === "subagent" && agent.visible).length;
    const visible = visibleCount < snapshot.budget.maxVisibleSubagents;
    if (!visible) {
      this.alert(
        "spawn-cap",
        "warn",
        `Sub-agent ${sub.name} queued behind visible sprite cap (${snapshot.budget.maxVisibleSubagents})`,
        [parent.id],
      );
    }

    const agent: AgentSnapshot = {
      id: `${parent.id}:${sub.id}:${this.clock()}`,
      name: sub.name,
      kind: "subagent",
      domainId: parent.domainId,
      parentId: parent.id,
      role: "ephemeral-tool",
      stationId: sub.stationId ?? parent.stationId,
      activity: "fetching",
      hue: (parent.hue + 40) % 360,
      envelope: { ...envelope, constraints: [...envelope.constraints] },
      steps: [`spawned by ${parent.name}`],
      spawnedAt: this.clock(),
      visible,
    };
    this.emit({ type: "agent.spawned", agent, at: this.clock() });

    const ttl = snapshot.budget.subagentTtlMs;
    const ttlAbort = new AbortController();
    const onParentAbort = () => ttlAbort.abort();
    signal.addEventListener("abort", onParentAbort, { once: true });
    const ttlTimer = setTimeout(() => {
      this.alert("ttl", "warn", `Sub-agent ${sub.name} hit TTL and was despawned`, [agent.id]);
      ttlAbort.abort();
    }, ttl / this.timeScale);

    try {
      await this.runTool(agent.id, sub.toolId, sub.toolInput, envelope, ttlAbort.signal);
    } catch (error) {
      if (!isAbortError(error)) throw error;
    } finally {
      clearTimeout(ttlTimer);
      signal.removeEventListener("abort", onParentAbort);
      this.emit({ type: "agent.despawned", agentId: agent.id, at: this.clock() });
      this.releaseSubagentSlot();
    }
  }

  private async acquireSubagentSlot(signal: AbortSignal): Promise<void> {
    const cap = this.log.getSnapshot().budget.maxConcurrentSubagents;
    while (this.subagentSlots >= cap) {
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          reject(new DOMException("Aborted", "AbortError"));
        };
        if (signal.aborted) {
          onAbort();
          return;
        }
        this.subagentWaiters.push(resolve);
        signal.addEventListener(
          "abort",
          () => {
            this.subagentWaiters = this.subagentWaiters.filter((waiter) => waiter !== resolve);
            onAbort();
          },
          { once: true },
        );
      });
    }
    this.subagentSlots += 1;
  }

  private releaseSubagentSlot(): void {
    this.subagentSlots = Math.max(0, this.subagentSlots - 1);
    const next = this.subagentWaiters.shift();
    next?.();
  }

  private async runTool(
    agentId: string,
    toolId: string,
    input: unknown,
    envelope: ConstraintEnvelope,
    signal: AbortSignal,
  ): Promise<unknown> {
    const adapter = this.adapters.get(toolId);
    if (!adapter) throw new Error(`Unknown tool ${toolId}`);
    requireEnvelope(envelope);
    this.emit({ type: "agent.tool.started", agentId, toolId, input, at: this.clock() });
    const result = await adapter.execute(input, envelope, signal);
    await this.delay(result.latencyMs, signal);
    const snapshot = this.log.getSnapshot();
    this.emit({
      type: "run.budget.updated",
      budget: {
        ...snapshot.budget,
        tokensUsed: snapshot.budget.tokensUsed + result.tokens,
        wallClockMs: this.clock() - this.startedAt,
      },
      at: this.clock(),
    });
    this.emit({
      type: "agent.tool.ended",
      agentId,
      toolId,
      tokens: result.tokens,
      at: this.clock(),
    });
    this.emit({
      type: "agent.step",
      agentId,
      step: `${toolId} returned`,
      payload: typeof result.artifact === "string" ? result.artifact : JSON.stringify(result.artifact),
      at: this.clock(),
    });
    return result.artifact;
  }

  private async delay(ms: number, signal: AbortSignal): Promise<void> {
    await sleep(ms / this.timeScale, signal);
  }

  private alert(
    code: "handoff-loop" | "budget" | "spawn-cap" | "ttl" | "context-drift" | "info",
    level: "info" | "warn" | "critical",
    message: string,
    agentIds: string[],
  ): void {
    this.emit({
      type: "run.alert",
      alert: {
        id: `alert-${this.clock()}-${code}`,
        level,
        code,
        message,
        agentIds,
        at: this.clock(),
      },
      at: this.clock(),
    });
  }
}

export { EventLog } from "./event-log.js";
export { applyEvent } from "./projector.js";
