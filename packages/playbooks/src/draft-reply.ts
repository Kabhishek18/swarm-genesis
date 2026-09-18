import type { Playbook } from "@swarm/schema";
import { simulatedAdapter } from "./adapters.js";

const budget = {
  tokensLimit: 40_000,
  wallClockLimitMs: 700_000,
  maxLiveAgents: 12,
  maxConcurrentSubagents: 4,
  maxVisibleSubagents: 6,
  maxHandoffHops: 3,
  subagentTtlMs: 16_000,
} as const;

export const draftReplyPlaybook: Playbook = {
  id: "draft-reply",
  name: "Draft a reply",
  trigger: "Read the incoming message, draft a reply, and check the tone.",
  layoutId: "writing-room",
  qualityBar: "The reply answers the ask and matches the requested tone.",
  constraints: [
    "Keep the original message in every sub-agent envelope",
    "Do not promise dates or prices that are not in the brief",
    "Tone check cannot pass if the draft is dismissive or over-commits",
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
      role: "Read incoming context",
      stationId: "desk-outline",
      hue: 195,
    },
    {
      id: "draft",
      name: "Draft Writer",
      kind: "domain-orchestrator",
      domainId: "draft",
      role: "Draft the reply",
      stationId: "desk-draft",
      hue: 125,
    },
    {
      id: "edit",
      name: "Editor",
      kind: "domain-orchestrator",
      domainId: "edit",
      role: "Tone and send-ready check",
      stationId: "desk-edit",
      hue: 32,
    },
  ],
  tasks: [
    {
      id: "read-context",
      title: "Read the incoming context",
      assignee: "outline",
      domainId: "outline",
      dependsOn: [],
      toolId: "reply-context",
      activity: "thinking",
      stationId: "desk-outline",
    },
    {
      id: "draft",
      title: "Draft the reply",
      assignee: "draft",
      domainId: "draft",
      dependsOn: ["read-context"],
      toolId: "reply-draft",
      activity: "fetching",
      stationId: "terminal-draft",
    },
    {
      id: "tone-check",
      title: "Check tone before send",
      assignee: "edit",
      domainId: "edit",
      dependsOn: ["draft"],
      toolId: "reply-tone",
      activity: "reviewing",
      stationId: "desk-edit",
    },
  ],
  adapters: [
    simulatedAdapter("reply-context", 2400, 1800, {
      summary:
        "Context: customer asks whether last week's outage is resolved and wants a status they can share internally.",
    }),
    simulatedAdapter("reply-draft", 3200, 2600, {
      summary:
        "Draft: thank them, confirm the incident is closed, list the two mitigations, and offer a follow-up if anything still fails.",
    }),
    simulatedAdapter("reply-tone", 2200, 1800, {
      summary:
        "Tone check: calm and direct, no over-promise on dates. Ready to send with a short subject line.",
    }),
  ],
};
