import type { Playbook } from "@swarm/schema";
import { simulatedAdapter } from "./adapters.js";

const budget = {
  tokensLimit: 50_000,
  wallClockLimitMs: 800_000,
  maxLiveAgents: 12,
  maxConcurrentSubagents: 4,
  maxVisibleSubagents: 6,
  maxHandoffHops: 3,
  subagentTtlMs: 20_000,
} as const;

export const codeReviewPlaybook: Playbook = {
  id: "code-review",
  name: "Review code",
  trigger: "Read the change, list findings, and give a review verdict.",
  layoutId: "feature-dev",
  qualityBar: "Every finding cites a file or symbol; the verdict is approve, request-changes, or comment.",
  constraints: [
    "Do not rewrite the change unless the brief asks for a patch",
    "Forward the original review brief to every descendant",
    "Verdict cannot land until findings are written down",
  ],
  budget,
  domains: [
    { id: "architecture", name: "Architecture", orchestratorId: "architecture" },
    { id: "delivery", name: "Delivery", orchestratorId: "delivery" },
  ],
  agents: [
    {
      id: "meta",
      name: "Meta-Orchestrator",
      kind: "meta",
      role: "Root dispatcher",
      stationId: "hq",
      hue: 48,
    },
    {
      id: "architecture",
      name: "Architecture",
      kind: "domain-orchestrator",
      domainId: "architecture",
      role: "Read the change",
      stationId: "desk-arch",
      hue: 210,
    },
    {
      id: "delivery",
      name: "Delivery",
      kind: "domain-orchestrator",
      domainId: "delivery",
      role: "Review verdict",
      stationId: "desk-delivery",
      hue: 18,
    },
    {
      id: "backend",
      name: "Backend Agent",
      kind: "worker",
      domainId: "architecture",
      role: "Collect findings",
      stationId: "terminal-backend",
      hue: 145,
    },
  ],
  tasks: [
    {
      id: "read",
      title: "Read the change",
      assignee: "architecture",
      domainId: "architecture",
      dependsOn: [],
      toolId: "review-read",
      activity: "thinking",
      stationId: "desk-arch",
    },
    {
      id: "findings",
      title: "List review findings",
      assignee: "backend",
      domainId: "architecture",
      dependsOn: ["read"],
      toolId: "review-findings",
      activity: "fetching",
      stationId: "terminal-backend",
    },
    {
      id: "verdict",
      title: "Give a review verdict",
      assignee: "delivery",
      domainId: "delivery",
      dependsOn: ["findings"],
      toolId: "review-verdict",
      activity: "reviewing",
      stationId: "desk-delivery",
    },
  ],
  adapters: [
    simulatedAdapter("review-read", 2800, 2200, {
      summary:
        "Read: auth/routes.ts and auth/hash.ts. Change adds argon2id hashing and a login handler; tests not in the diff.",
    }),
    simulatedAdapter("review-findings", 3600, 2800, {
      summary:
        "Findings: (1) auth/hash.ts — no max password length. (2) auth/routes.ts — 401 body may leak whether the email exists.",
    }),
    simulatedAdapter("review-verdict", 2400, 2000, {
      summary:
        "Verdict: request-changes. Address password length and 401 email enumeration before merge.",
    }),
  ],
};
