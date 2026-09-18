import type { Playbook } from "@swarm/schema";
import { simulatedAdapter } from "./adapters.js";

const budget = {
  tokensLimit: 60_000,
  wallClockLimitMs: 900_000,
  maxLiveAgents: 12,
  maxConcurrentSubagents: 4,
  maxVisibleSubagents: 6,
  maxHandoffHops: 3,
  subagentTtlMs: 20_000,
} as const;

export const bugFixPlaybook: Playbook = {
  id: "bug-fix",
  name: "Fix a bug",
  trigger: "Reproduce the reported bug and land a focused patch.",
  layoutId: "feature-dev",
  qualityBar: "A written repro, a scoped patch, and a verification note must land together.",
  constraints: [
    "Do not expand the fix into a new feature",
    "Forward the original bug report to every descendant",
    "Verification cannot pass until the repro steps fail before the patch and succeed after",
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
      role: "Intake and scoping",
      stationId: "desk-arch",
      hue: 210,
    },
    {
      id: "delivery",
      name: "Delivery",
      kind: "domain-orchestrator",
      domainId: "delivery",
      role: "Pipelines, merge, errors",
      stationId: "desk-delivery",
      hue: 18,
    },
    {
      id: "backend",
      name: "Backend Agent",
      kind: "worker",
      domainId: "architecture",
      role: "Patch the failing path",
      stationId: "terminal-backend",
      hue: 145,
    },
    {
      id: "qa",
      name: "QA Agent",
      kind: "worker",
      domainId: "delivery",
      role: "Reproduce and verify",
      stationId: "terminal-qa",
      hue: 330,
    },
  ],
  tasks: [
    {
      id: "intake",
      title: "Capture the bug report",
      assignee: "architecture",
      domainId: "architecture",
      dependsOn: [],
      toolId: "bug-intake",
      activity: "thinking",
      stationId: "desk-arch",
    },
    {
      id: "reproduce",
      title: "Reproduce the failure",
      assignee: "qa",
      domainId: "delivery",
      dependsOn: ["intake"],
      toolId: "bug-reproduce",
      activity: "fetching",
      stationId: "terminal-qa",
    },
    {
      id: "patch",
      title: "Apply a focused patch",
      assignee: "backend",
      domainId: "architecture",
      dependsOn: ["reproduce"],
      toolId: "bug-patch",
      activity: "fetching",
      stationId: "terminal-backend",
    },
    {
      id: "verify",
      title: "Verify the fix against the repro",
      assignee: "qa",
      domainId: "delivery",
      dependsOn: ["patch"],
      toolId: "bug-verify",
      activity: "fetching",
      stationId: "terminal-qa",
    },
  ],
  adapters: [
    simulatedAdapter("bug-intake", 2800, 2200, {
      summary:
        "Bug intake: session cookie expires after 5 minutes instead of 24 hours; users drop out mid-form.",
    }),
    simulatedAdapter("bug-reproduce", 3600, 2800, {
      summary:
        "Reproduced: login with a valid session, wait 6 minutes, next API call returns 401. Expected: still authenticated.",
    }),
    simulatedAdapter("bug-patch", 4800, 3600, {
      summary:
        "Patch: TTL on session mint now uses the configured 24h maxAge. No protocol or schema change.",
    }),
    simulatedAdapter("bug-verify", 3200, 2600, {
      summary:
        "Verified: same repro now stays authenticated past 6 minutes. Pre-patch 401, post-patch 200.",
    }),
  ],
};
