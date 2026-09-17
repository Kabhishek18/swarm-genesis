import type {
  AgentSnapshot,
  DomainSnapshot,
  RunSnapshot,
  SwarmEvent,
  TaskSnapshot,
} from "@swarm/schema";
import { emptySnapshot } from "@swarm/schema";

function recountDomains(snapshot: RunSnapshot): DomainSnapshot[] {
  return snapshot.domains.map((domain) => {
    const tasks = snapshot.tasks.filter((task) => task.domainId === domain.id);
    return {
      ...domain,
      queued: tasks.filter((task) => task.status === "queued").length,
      locked: tasks.filter((task) => task.status === "locked").length,
      running: tasks.filter((task) => task.status === "running").length,
      completed: tasks.filter((task) => task.status === "completed").length,
    };
  });
}

function liveCounts(agents: AgentSnapshot[]): {
  liveAgents: number;
  liveSubagents: number;
} {
  return {
    liveAgents: agents.length,
    liveSubagents: agents.filter((agent) => agent.kind === "subagent").length,
  };
}

function withAgentDefaults(agent: AgentSnapshot): AgentSnapshot {
  return {
    ...agent,
    thoughts: agent.thoughts ?? [],
    children: agent.children ?? [],
  };
}

function patchAgent(
  snapshot: RunSnapshot,
  agentId: string,
  patch: Partial<AgentSnapshot>,
): RunSnapshot {
  return {
    ...snapshot,
    agents: snapshot.agents.map((agent) =>
      agent.id === agentId ? { ...agent, ...patch } : agent,
    ),
  };
}

function patchTask(
  snapshot: RunSnapshot,
  taskId: string,
  patch: Partial<TaskSnapshot>,
): RunSnapshot {
  return {
    ...snapshot,
    tasks: snapshot.tasks.map((task) =>
      task.id === taskId ? { ...task, ...patch } : task,
    ),
  };
}

export function applyEvent(prev: RunSnapshot, event: SwarmEvent): RunSnapshot {
  switch (event.type) {
    case "run.started": {
      const next: RunSnapshot = {
        ...emptySnapshot(),
        runId: event.runId,
        playbookId: event.playbookId,
        playbookName: event.playbookName,
        layoutId: event.layoutId,
        status: "running",
        goal: event.goal,
        envelope: event.envelope,
        budget: event.budget,
        startedAt: event.at,
      };
      return next;
    }
    case "run.completed":
      return { ...prev, status: "completed", finishedAt: event.at };
    case "run.failed":
      return { ...prev, status: "failed", finishedAt: event.at };
    case "run.budget.updated":
      return { ...prev, budget: event.budget };
    case "run.alert":
      return { ...prev, alerts: [...prev.alerts, event.alert] };
    case "domain.opened":
      return {
        ...prev,
        domains: [...prev.domains.filter((d) => d.id !== event.domain.id), event.domain],
      };
    case "domain.closed":
      return {
        ...prev,
        domains: prev.domains.map((domain) =>
          domain.id === event.domainId ? { ...domain, open: false } : domain,
        ),
      };
    case "task.queued": {
      const next = {
        ...prev,
        tasks: [...prev.tasks.filter((t) => t.id !== event.task.id), event.task],
      };
      return { ...next, domains: recountDomains(next) };
    }
    case "task.locked": {
      const next = patchTask(prev, event.taskId, { status: "locked" });
      return { ...next, domains: recountDomains(next) };
    }
    case "task.unlocked": {
      const next = patchTask(prev, event.taskId, { status: "queued" });
      return { ...next, domains: recountDomains(next) };
    }
    case "task.started": {
      const next = patchTask(prev, event.taskId, { status: "running" });
      return { ...next, domains: recountDomains(next) };
    }
    case "task.completed": {
      const next = patchTask(prev, event.taskId, {
        status: "completed",
        outputHash: event.outputHash,
      });
      return { ...next, domains: recountDomains(next) };
    }
    case "task.failed": {
      const next = patchTask(prev, event.taskId, {
        status: "failed",
        error: event.error,
      });
      return { ...next, domains: recountDomains(next) };
    }
    case "task.handoff":
    case "task.handoff.rejected":
      return { ...prev, handoffs: [...prev.handoffs, event.handoff] };
    case "task.vote": {
      const vote = {
        taskId: event.taskId,
        voterId: event.voterId,
        vote: event.vote,
        reason: event.reason,
        at: event.at,
      };
      return {
        ...patchTask(prev, event.taskId, { lastVote: vote }),
        votes: [...prev.votes, vote],
      };
    }
    case "agent.spawned": {
      const incoming = withAgentDefaults(event.agent);
      let agents = [...prev.agents.filter((agent) => agent.id !== incoming.id), incoming];
      if (incoming.parentId) {
        agents = agents.map((agent) =>
          agent.id === incoming.parentId
            ? {
                ...agent,
                children: agent.children.includes(incoming.id)
                  ? agent.children
                  : [...agent.children, incoming.id],
              }
            : agent,
        );
      }
      const counts = liveCounts(agents);
      return {
        ...prev,
        agents,
        budget: { ...prev.budget, ...counts },
      };
    }
    case "agent.activity":
      return patchAgent(prev, event.agentId, {
        activity: event.activity,
        stationId: event.stationId,
        currentStep: event.step ?? prev.agents.find((a) => a.id === event.agentId)?.currentStep,
      });
    case "agent.tool.started":
      return patchAgent(prev, event.agentId, { currentTool: event.toolId });
    case "agent.tool.ended":
      return patchAgent(prev, event.agentId, { currentTool: undefined });
    case "agent.step":
      return patchAgent(prev, event.agentId, {
        currentStep: event.step,
        contextPayload: event.payload,
        steps: [
          ...(prev.agents.find((a) => a.id === event.agentId)?.steps ?? []),
          event.step,
        ],
      });
    case "agent.thought": {
      const current = prev.agents.find((agent) => agent.id === event.agentId);
      const thoughts = [...(current?.thoughts ?? []), { delta: event.delta, at: event.at }].slice(
        -48,
      );
      return patchAgent(prev, event.agentId, { thoughts });
    }
    case "agent.scratchpad":
      return patchAgent(prev, event.agentId, { scratchpad: event.prompt });
    case "agent.despawned": {
      const agents = prev.agents
        .filter((agent) => agent.id !== event.agentId)
        .map((agent) => ({
          ...agent,
          children: agent.children.filter((id) => id !== event.agentId),
        }));
      const counts = liveCounts(agents);
      return {
        ...prev,
        agents,
        budget: { ...prev.budget, ...counts },
      };
    }
    default:
      return prev;
  }
}
