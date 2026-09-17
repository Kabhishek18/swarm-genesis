export type AgentKind = "meta" | "domain-orchestrator" | "worker" | "subagent";

export type AgentActivity =
  | "thinking"
  | "fetching"
  | "idling"
  | "reviewing"
  | "spawning";

export type StationType = "hq" | "desk" | "terminal" | "archive" | "testBay";

export type RunStatus = "idle" | "running" | "completed" | "failed";

export type TaskStatus =
  | "queued"
  | "locked"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type AlertLevel = "info" | "warn" | "critical";

export interface ConstraintEnvelope {
  originalGoal: string;
  qualityBar: string;
  constraints: string[];
}

export interface Budget {
  tokensUsed: number;
  tokensLimit: number;
  wallClockMs: number;
  wallClockLimitMs: number;
  maxLiveAgents: number;
  liveAgents: number;
  maxConcurrentSubagents: number;
  liveSubagents: number;
  maxVisibleSubagents: number;
  maxHandoffHops: number;
  subagentTtlMs: number;
}

export interface ToolResult {
  tokens: number;
  latencyMs: number;
  artifact: unknown;
}

export interface ToolAdapter {
  id: string;
  execute(
    input: unknown,
    envelope: ConstraintEnvelope,
    signal: AbortSignal,
  ): Promise<ToolResult>;
}

export interface AgentDef {
  id: string;
  name: string;
  kind: Exclude<AgentKind, "subagent">;
  domainId?: string;
  role: string;
  stationId: string;
  hue: number;
}

export interface SubagentDef {
  id: string;
  name: string;
  toolId: string;
  toolInput?: unknown;
  stationId?: string;
}

export interface HandoffDef {
  to: string;
  reason: string;
  /** Replay the same artifact hash to trip the infinite-handoff guard. */
  duplicate?: boolean;
}

export interface TaskDef {
  id: string;
  title: string;
  assignee: string;
  domainId: string;
  dependsOn: string[];
  toolId?: string;
  toolInput?: unknown;
  activity: AgentActivity;
  stationId?: string;
  subagents?: SubagentDef[];
  review?: boolean;
  handoff?: HandoffDef;
}

export interface DomainDef {
  id: string;
  name: string;
  orchestratorId: string;
}

export interface Playbook {
  id: string;
  name: string;
  trigger: string;
  layoutId: string;
  qualityBar: string;
  constraints: string[];
  domains: DomainDef[];
  agents: AgentDef[];
  tasks: TaskDef[];
  adapters: ToolAdapter[];
  budget: Omit<
    Budget,
    "tokensUsed" | "wallClockMs" | "liveAgents" | "liveSubagents"
  >;
}

export interface AgentSnapshot {
  id: string;
  name: string;
  kind: AgentKind;
  domainId?: string;
  parentId?: string;
  role: string;
  stationId: string;
  activity: AgentActivity;
  hue: number;
  envelope: ConstraintEnvelope;
  currentTool?: string;
  currentStep?: string;
  steps: string[];
  contextPayload?: string;
  spawnedAt: number;
  visible: boolean;
}

export interface TaskSnapshot {
  id: string;
  title: string;
  assignee: string;
  domainId: string;
  dependsOn: string[];
  status: TaskStatus;
  activity: AgentActivity;
  stationId?: string;
  outputHash?: string;
  error?: string;
}

export interface DomainSnapshot {
  id: string;
  name: string;
  orchestratorId: string;
  open: boolean;
  queued: number;
  locked: number;
  running: number;
  completed: number;
}

export interface Alert {
  id: string;
  level: AlertLevel;
  code:
    | "handoff-loop"
    | "budget"
    | "spawn-cap"
    | "ttl"
    | "context-drift"
    | "info";
  message: string;
  agentIds: string[];
  at: number;
}

export interface HandoffRecord {
  id: string;
  from: string;
  to: string;
  taskId: string;
  reason: string;
  hop: number;
  rejected: boolean;
  at: number;
}

export interface RunSnapshot {
  runId: string;
  playbookId: string;
  playbookName: string;
  layoutId: string;
  status: RunStatus;
  goal: string;
  envelope: ConstraintEnvelope;
  budget: Budget;
  domains: DomainSnapshot[];
  agents: AgentSnapshot[];
  tasks: TaskSnapshot[];
  alerts: Alert[];
  handoffs: HandoffRecord[];
  startedAt?: number;
  finishedAt?: number;
}

export type SwarmEvent =
  | {
      type: "run.started";
      runId: string;
      playbookId: string;
      playbookName: string;
      layoutId: string;
      goal: string;
      envelope: ConstraintEnvelope;
      budget: Budget;
      at: number;
    }
  | { type: "run.completed"; runId: string; at: number }
  | { type: "run.failed"; runId: string; error: string; at: number }
  | { type: "run.budget.updated"; budget: Budget; at: number }
  | {
      type: "run.alert";
      alert: Alert;
      at: number;
    }
  | {
      type: "domain.opened";
      domain: DomainSnapshot;
      at: number;
    }
  | { type: "domain.closed"; domainId: string; at: number }
  | { type: "task.queued"; task: TaskSnapshot; at: number }
  | { type: "task.locked"; taskId: string; at: number }
  | { type: "task.unlocked"; taskId: string; at: number }
  | { type: "task.started"; taskId: string; agentId: string; at: number }
  | {
      type: "task.completed";
      taskId: string;
      outputHash: string;
      at: number;
    }
  | { type: "task.failed"; taskId: string; error: string; at: number }
  | {
      type: "task.handoff";
      handoff: HandoffRecord;
      at: number;
    }
  | {
      type: "task.handoff.rejected";
      handoff: HandoffRecord;
      at: number;
    }
  | { type: "agent.spawned"; agent: AgentSnapshot; at: number }
  | {
      type: "agent.activity";
      agentId: string;
      activity: AgentActivity;
      stationId: string;
      step?: string;
      at: number;
    }
  | {
      type: "agent.tool.started";
      agentId: string;
      toolId: string;
      input?: unknown;
      at: number;
    }
  | {
      type: "agent.tool.ended";
      agentId: string;
      toolId: string;
      tokens: number;
      at: number;
    }
  | {
      type: "agent.step";
      agentId: string;
      step: string;
      payload?: string;
      at: number;
    }
  | { type: "agent.despawned"; agentId: string; at: number };

export function emptySnapshot(): RunSnapshot {
  return {
    runId: "",
    playbookId: "",
    playbookName: "",
    layoutId: "",
    status: "idle",
    goal: "",
    envelope: { originalGoal: "", qualityBar: "", constraints: [] },
    budget: {
      tokensUsed: 0,
      tokensLimit: 0,
      wallClockMs: 0,
      wallClockLimitMs: 0,
      maxLiveAgents: 0,
      liveAgents: 0,
      maxConcurrentSubagents: 0,
      liveSubagents: 0,
      maxVisibleSubagents: 6,
      maxHandoffHops: 3,
      subagentTtlMs: 12_000,
    },
    domains: [],
    agents: [],
    tasks: [],
    alerts: [],
    handoffs: [],
  };
}

export function hashArtifact(artifact: unknown): string {
  const text = JSON.stringify(artifact);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}
