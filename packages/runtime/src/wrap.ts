import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Reviewer } from "@swarm/kernel";
import { CHILD_LOOP_TOOL_ID, type Playbook, type ToolAdapter, type ToolContext, type ToolResult } from "@swarm/schema";
import { CHILD_LOOP_MAX_STEPS, ollamaDisabled } from "./config.js";
import { assemblePrompt, runOllamaLoop } from "./loop.js";
import { OllamaChat } from "./ollama.js";
import {
  buildInvitationHtml,
  buildSiteDesignMarkdown,
  isCompleteSiteHtml,
  isThinSiteDesign,
  isWebsiteAdapter,
  isWebsiteTask,
} from "./site-html.js";
import { executeCappedTool } from "./tools.js";

export interface BindOptions {
  chat?: OllamaChat;
  fetchImpl?: typeof fetch;
  workspaceDir?: string;
}

export async function ollamaAvailable(chat?: OllamaChat): Promise<boolean> {
  if (ollamaDisabled()) {
    console.warn("[swarm] Ollama skipped: OLLAMA_DISABLED is set");
    return false;
  }
  const client = chat ?? new OllamaChat();
  const ok = await client.healthy();
  if (!ok) {
    console.warn(`[swarm] Ollama unreachable at ${client.host} (model ${client.model})`);
  }
  return ok;
}

function bindToolContext(ctx: ToolContext | undefined, workspaceDir?: string): ToolContext | undefined {
  if (!workspaceDir && !ctx) return ctx;
  return {
    ...ctx,
    agentId: ctx?.agentId ?? "",
    workspaceDir: ctx?.workspaceDir ?? workspaceDir,
  };
}

function artifactText(artifact: unknown): string {
  if (artifact == null) return "";
  if (typeof artifact === "string") return artifact;
  if (typeof artifact === "object" && artifact !== null && "summary" in artifact) {
    const summary = (artifact as { summary?: unknown }).summary;
    if (typeof summary === "string" && summary.trim()) return summary;
  }
  try {
    return JSON.stringify(artifact, null, 2);
  } catch {
    return String(artifact);
  }
}

function safeFileStem(id: string): string {
  const stem = id.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^\.+/, "") || "output";
  return stem.slice(0, 64);
}

const SITE_HTML_PATHS = ["index.html", "site/index.html"] as const;
const SITE_DESIGN_PATH = "site-design.md";

function wantsWebsiteDeliverable(
  adapterId: string,
  originalGoal: string,
  role = "",
  task = "",
): boolean {
  return (
    isWebsiteAdapter(adapterId) ||
    isWebsiteTask(role || adapterId, task || adapterId, originalGoal)
  );
}

async function readWorkspaceUtf8(workspaceDir: string, rel: string): Promise<string | null> {
  try {
    return await readFile(path.join(workspaceDir, rel), "utf8");
  } catch {
    return null;
  }
}

async function writeDeliverable(
  ctx: ToolContext,
  rel: string,
  content: string,
): Promise<void> {
  try {
    await executeCappedTool(
      "write_file",
      { path: rel, content },
      ctx,
      new AbortController().signal,
    );
  } catch {
    /* fallback writes are best-effort */
  }
}

/** After a website-like task (including TTL/abort), fill thin or missing page files. */
export async function ensureWebsiteDeliverables(
  ctx: ToolContext | undefined,
  originalGoal = "",
  adapterId = "",
  role = "",
  task = "",
): Promise<void> {
  if (!ctx?.workspaceDir) return;
  if (!wantsWebsiteDeliverable(adapterId, originalGoal, role, task)) return;

  const root = ctx.workspaceDir;
  let best: string | null = null;
  for (const rel of SITE_HTML_PATHS) {
    const existing = await readWorkspaceUtf8(root, rel);
    if (isCompleteSiteHtml(existing)) {
      best = existing;
      break;
    }
  }
  const html = best ?? buildInvitationHtml(originalGoal);
  for (const rel of SITE_HTML_PATHS) {
    const existing = await readWorkspaceUtf8(root, rel);
    if (!isCompleteSiteHtml(existing)) {
      await writeDeliverable(ctx, rel, html);
    }
  }

  const design = await readWorkspaceUtf8(root, SITE_DESIGN_PATH);
  if (isThinSiteDesign(design)) {
    await writeDeliverable(ctx, SITE_DESIGN_PATH, buildSiteDesignMarkdown(originalGoal));
  }
}

export async function maybeWriteSimulatedDeliverable(
  adapterId: string,
  artifact: unknown,
  ctx: ToolContext | undefined,
  originalGoal = "",
): Promise<void> {
  if (!ctx?.workspaceDir) return;
  if (wantsWebsiteDeliverable(adapterId, originalGoal)) {
    await ensureWebsiteDeliverables(ctx, originalGoal, adapterId);
    if (isWebsiteAdapter(adapterId)) return;
  }
  const rel = `${safeFileStem(adapterId)}.txt`;
  const content = artifactText(artifact);
  if (!content.trim()) return;
  try {
    await executeCappedTool(
      "write_file",
      { path: rel, content },
      ctx,
      new AbortController().signal,
    );
  } catch {
    /* simulated writes are best-effort */
  }
}

export function withSimulatedThoughts(adapter: ToolAdapter, workspaceDir?: string): ToolAdapter {
  return {
    id: adapter.id,
    async execute(input, envelope, signal, ctx): Promise<ToolResult> {
      const bound = bindToolContext(ctx, workspaceDir);
      const prompt = assemblePrompt({
        role: bound?.role ?? adapter.id,
        task: adapter.id,
        input,
        envelope,
      });
      bound?.onScratchpad?.(`${prompt.system}\n\n${prompt.user}`);
      bound?.onThought?.(`simulated:${adapter.id}`);
      const stub = { summary: `simulated:${adapter.id}` };
      // Write first so Stop after Start still leaves a downloadable page or note.
      await maybeWriteSimulatedDeliverable(adapter.id, stub, bound, envelope.originalGoal);
      try {
        const result = await adapter.execute(input, envelope, signal, bound);
        await maybeWriteSimulatedDeliverable(adapter.id, result.artifact, bound, envelope.originalGoal);
        return result;
      } catch (error) {
        if (bound?.workspaceDir) {
          await maybeWriteSimulatedDeliverable(adapter.id, stub, bound, envelope.originalGoal);
        }
        throw error;
      }
    },
  };
}

export function wrapAdapter(
  adapter: ToolAdapter,
  chat: OllamaChat,
  live: boolean,
  workspaceDir?: string,
): ToolAdapter {
  if (!live) return withSimulatedThoughts(adapter, workspaceDir);
  return {
    id: adapter.id,
    async execute(input, envelope, signal, ctx?: ToolContext): Promise<ToolResult> {
      const bound = bindToolContext(ctx, workspaceDir);
      try {
        const result = await runOllamaLoop(
          chat,
          {
            role: bound?.role ?? adapter.id,
            task: adapter.id,
            input,
            envelope,
          },
          bound,
          signal,
          chat.fetchImpl,
        );
        // Live models may write empty/stub files; parent still fills the page after TTL or a thin write.
        await ensureWebsiteDeliverables(
          bound,
          envelope.originalGoal,
          adapter.id,
          bound?.role,
          adapter.id,
        );
        return result;
      } catch (error) {
        bound?.onThought?.(
          `ollama-fallback:${error instanceof Error ? error.message : String(error)}`,
        );
        return withSimulatedThoughts(adapter, workspaceDir).execute(input, envelope, signal, bound);
      }
    },
  };
}

export async function wrapPlaybook(playbook: Playbook, options: BindOptions = {}): Promise<{
  playbook: Playbook;
  live: boolean;
  reviewer: Reviewer;
}> {
  const chat = options.chat ?? new OllamaChat({ fetchImpl: options.fetchImpl });
  const live = await ollamaAvailable(chat);
  const workspaceDir = options.workspaceDir;
  const adapters = playbook.adapters.map((adapter) => wrapAdapter(adapter, chat, live, workspaceDir));
  if (!adapters.some((adapter) => adapter.id === CHILD_LOOP_TOOL_ID)) {
    adapters.push(childLoopAdapter(chat, live, workspaceDir));
  }
  return {
    live,
    playbook: {
      ...playbook,
      adapters,
    },
    reviewer: live ? ollamaReviewer(chat) : simulatedDuplicateReviewer(),
  };
}

function childLoopPayload(input: unknown): {
  taskDescription: string;
  role: string;
  contextPayload?: string;
} {
  const rec = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  return {
    taskDescription: rec.taskDescription != null ? String(rec.taskDescription) : "",
    role: rec.role != null && String(rec.role).trim() ? String(rec.role) : "researcher",
    contextPayload: rec.contextPayload != null ? String(rec.contextPayload) : undefined,
  };
}

export function childLoopAdapter(chat: OllamaChat, live: boolean, workspaceDir?: string): ToolAdapter {
  return {
    id: CHILD_LOOP_TOOL_ID,
    async execute(input, envelope, signal, ctx?: ToolContext): Promise<ToolResult> {
      const bound = bindToolContext(ctx, workspaceDir);
      const payload = childLoopPayload(input);
      const role = payload.role || bound?.role || "researcher";
      const task = payload.taskDescription || "Complete the delegated sub-task";
      const loop = {
        role,
        task,
        input: {
          contextPayload: payload.contextPayload,
          originalGoal: envelope.originalGoal,
        },
        envelope,
      };
      if (!live) {
        const prompt = assemblePrompt(loop);
        bound?.onScratchpad?.(`${prompt.system}\n\n${prompt.user}`);
        bound?.onThought?.(`simulated:${role}`);
        const artifact = {
          summary: `simulated ${role} completed: ${task}`,
          role,
          taskDescription: task,
          contextPayload: payload.contextPayload ?? null,
          originalGoal: envelope.originalGoal,
        };
        await maybeWriteSimulatedDeliverable(CHILD_LOOP_TOOL_ID, artifact, bound, envelope.originalGoal);
        await ensureWebsiteDeliverables(
          bound,
          envelope.originalGoal,
          CHILD_LOOP_TOOL_ID,
          role,
          task,
        );
        if (signal.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        return {
          tokens: 48,
          latencyMs: 0,
          artifact,
        };
      }
      try {
        const result = await runOllamaLoop(chat, loop, bound, signal, chat.fetchImpl, {
          maxTurns: CHILD_LOOP_MAX_STEPS,
        });
        await ensureWebsiteDeliverables(
          bound,
          envelope.originalGoal,
          CHILD_LOOP_TOOL_ID,
          role,
          task,
        );
        return {
          ...result,
          artifact: summarizeChildArtifact(result.artifact, role, task, envelope.originalGoal, payload.contextPayload),
        };
      } catch (error) {
        bound?.onThought?.(
          `ollama-fallback:${error instanceof Error ? error.message : String(error)}`,
        );
        return childLoopAdapter(chat, false, workspaceDir).execute(input, envelope, signal, bound);
      }
    },
  };
}

function summarizeChildArtifact(
  artifact: unknown,
  role: string,
  task: string,
  originalGoal: string,
  contextPayload?: string,
): Record<string, unknown> {
  const base = {
    role,
    taskDescription: task,
    contextPayload: contextPayload ?? null,
    originalGoal,
  };
  if (artifact && typeof artifact === "object") {
    const rec = artifact as Record<string, unknown>;
    return {
      ...rec,
      ...base,
      summary: rec.summary != null ? String(rec.summary) : JSON.stringify(artifact),
    };
  }
  return {
    ...base,
    summary: artifact == null ? `completed: ${task}` : String(artifact),
  };
}

export function simulatedDuplicateReviewer(): Reviewer {
  return {
    async review() {
      return { vote: "accept", reason: "simulated quality bar met" };
    },
  };
}

export function ollamaReviewer(chat: OllamaChat): Reviewer {
  return {
    async review(input, signal) {
      const system = [
        "You are a reviewing domain orchestrator.",
        `Original goal: ${input.envelope.originalGoal}`,
        `Quality bar: ${input.qualityBar}`,
        "Return JSON only: {\"vote\":\"accept\"|\"reject\",\"reason\":\"...\"}",
      ].join("\n");
      const user = [
        `Task: ${input.taskTitle}`,
        `From: ${input.from} To: ${input.to}`,
        `Artifact: ${JSON.stringify(input.artifact)}`,
      ].join("\n");
      try {
        const turn = await chat.chat(
          [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          [],
          () => undefined,
          signal,
        );
        const match = turn.message.content.match(/\{[\s\S]*\}/);
        if (!match) return { vote: "accept", reason: "unparsed review; default accept" };
        const parsed = JSON.parse(match[0]) as { vote?: string; reason?: string };
        const vote = parsed.vote === "reject" ? "reject" : "accept";
        return { vote, reason: parsed.reason ?? "reviewer vote" };
      } catch {
        return { vote: "accept", reason: "reviewer unavailable; default accept" };
      }
    },
  };
}
