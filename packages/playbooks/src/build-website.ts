import type { ConstraintEnvelope, Playbook } from "@swarm/schema";
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

export const buildWebsitePlaybook: Playbook = {
  id: "build-website",
  name: "Build a website",
  trigger: "Design, mark up, and copy-edit a short website from the brief.",
  layoutId: "website-studio",
  qualityBar:
    "The page follows the design, HTML is complete enough to open, and copy matches the brief without invented claims.",
  constraints: [
    "Keep the original brief in every sub-agent envelope",
    "Do not invent products, prices, or dates that are not in the brief",
    "Copy pass cannot invent sections the design did not specify",
  ],
  budget,
  domains: [
    { id: "design", name: "Design", orchestratorId: "design" },
    { id: "frontend", name: "Frontend", orchestratorId: "frontend" },
    { id: "copy", name: "Copy", orchestratorId: "copy" },
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
      id: "design",
      name: "Design Lead",
      kind: "domain-orchestrator",
      domainId: "design",
      role: "Layout and visual structure",
      stationId: "desk-design",
      hue: 210,
    },
    {
      id: "frontend",
      name: "Frontend Lead",
      kind: "domain-orchestrator",
      domainId: "frontend",
      role: "Page structure review",
      stationId: "desk-frontend",
      hue: 145,
    },
    {
      id: "copy",
      name: "Copy Lead",
      kind: "domain-orchestrator",
      domainId: "copy",
      role: "Voice and copy pass",
      stationId: "desk-copy",
      hue: 32,
    },
    {
      id: "html",
      name: "HTML Agent",
      kind: "worker",
      domainId: "frontend",
      role: "Markup the page",
      stationId: "terminal-html",
      hue: 125,
    },
  ],
  tasks: [
    {
      id: "design",
      title: "Design the page",
      assignee: "design",
      domainId: "design",
      dependsOn: [],
      toolId: "site-design",
      activity: "thinking",
      stationId: "desk-design",
    },
    {
      id: "html",
      title: "Write the HTML",
      assignee: "html",
      domainId: "frontend",
      dependsOn: ["design"],
      toolId: "site-html",
      activity: "fetching",
      stationId: "terminal-html",
    },
    {
      id: "copy-pass",
      title: "Copy pass",
      assignee: "copy",
      domainId: "copy",
      dependsOn: ["html"],
      toolId: "site-copy",
      activity: "reviewing",
      stationId: "desk-copy",
    },
  ],
  adapters: [
    simulatedAdapter("site-design", 2800, 2200, (_input: unknown, envelope: ConstraintEnvelope) => ({
      summary: `Design: hero, couple/event blocks, date, venue, RSVP, and footer from: ${envelope.originalGoal}`,
    })),
    simulatedAdapter("site-html", 4200, 3400, (_input: unknown, envelope: ConstraintEnvelope) => ({
      summary: `HTML: complete index.html with inline CSS from the brief (${envelope.originalGoal})`,
      path: "index.html",
    })),
    simulatedAdapter("site-copy", 3000, 2400, (_input: unknown, envelope: ConstraintEnvelope) => ({
      summary: `Copy pass: headlines and RSVP copy stay faithful to: ${envelope.originalGoal}`,
    })),
  ],
};
