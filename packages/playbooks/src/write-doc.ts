import type { Playbook } from "@swarm/schema";
import { simulatedAdapter } from "./adapters.js";

const budget = {
  tokensLimit: 50_000,
  wallClockLimitMs: 800_000,
  maxLiveAgents: 12,
  maxConcurrentSubagents: 4,
  maxVisibleSubagents: 6,
  maxHandoffHops: 3,
  subagentTtlMs: 16_000,
} as const;

export const writeDocPlaybook: Playbook = {
  id: "write-doc",
  name: "Write a document",
  trigger: "Outline, draft, and edit a short document from the brief.",
  layoutId: "writing-room",
  qualityBar: "The draft follows the outline, and the edit pass is readable without invented sources.",
  constraints: [
    "Keep the original brief in every sub-agent envelope",
    "Do not invent citations or facts that are not in the brief",
    "Flag gaps instead of filling them with speculation",
  ],
  budget,
  domains: [
    { id: "outline", name: "Outline", orchestratorId: "outline" },
    { id: "draft", name: "Draft", orchestratorId: "draft" },
    { id: "edit", name: "Edit", orchestratorId: "edit" },
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
      id: "outline",
      name: "Outline Lead",
      kind: "domain-orchestrator",
      domainId: "outline",
      role: "Outline and coverage",
      stationId: "desk-outline",
      hue: 195,
    },
    {
      id: "draft",
      name: "Draft Writer",
      kind: "domain-orchestrator",
      domainId: "draft",
      role: "Draft from outline",
      stationId: "desk-draft",
      hue: 125,
    },
    {
      id: "edit",
      name: "Editor",
      kind: "domain-orchestrator",
      domainId: "edit",
      role: "Edit for clarity",
      stationId: "desk-edit",
      hue: 32,
    },
  ],
  tasks: [
    {
      id: "outline",
      title: "Outline the document",
      assignee: "outline",
      domainId: "outline",
      dependsOn: [],
      toolId: "doc-outline",
      activity: "thinking",
      stationId: "desk-outline",
    },
    {
      id: "draft",
      title: "Draft from the outline",
      assignee: "draft",
      domainId: "draft",
      dependsOn: ["outline"],
      toolId: "doc-draft",
      activity: "fetching",
      stationId: "terminal-draft",
    },
    {
      id: "edit",
      title: "Edit for clarity and gaps",
      assignee: "edit",
      domainId: "edit",
      dependsOn: ["draft"],
      toolId: "doc-edit",
      activity: "reviewing",
      stationId: "desk-edit",
    },
  ],
  adapters: [
    simulatedAdapter("doc-outline", 2600, 2000, {
      summary:
        "Outline: purpose, audience, three sections (context, steps, next actions), plus an open-questions list.",
    }),
    simulatedAdapter("doc-draft", 4200, 3400, {
      summary:
        "Draft: short intro, numbered steps that match the outline, and a next-actions close. No extra sources added.",
    }),
    simulatedAdapter("doc-edit", 3000, 2400, {
      summary:
        "Edit: tightened headings, cut repetition, flagged two brief gaps instead of filling them.",
    }),
  ],
};
