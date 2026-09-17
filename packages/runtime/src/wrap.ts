import type { Reviewer } from "@swarm/kernel";
import { CHILD_LOOP_TOOL_ID, type Playbook, type ToolAdapter, type ToolContext, type ToolResult } from "@swarm/schema";
import { CHILD_LOOP_MAX_STEPS, ollamaDisabled } from "./config.js";
import { assemblePrompt, runOllamaLoop } from "./loop.js";
import { OllamaChat } from "./ollama.js";

export interface BindOptions {
  chat?: OllamaChat;
  fetchImpl?: typeof fetch;
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

export function withSimulatedThoughts(adapter: ToolAdapter): ToolAdapter {
  return {
    id: adapter.id,
    async execute(input, envelope, signal, ctx): Promise<ToolResult> {
      const prompt = assemblePrompt({
        role: ctx?.role ?? adapter.id,
        task: adapter.id,
        input,
        envelope,
      });
      ctx?.onScratchpad?.(`${prompt.system}\n\n${prompt.user}`);
      ctx?.onThought?.(`simulated:${adapter.id}`);
      return adapter.execute(input, envelope, signal, ctx);
    },
  };
}

export function wrapAdapter(adapter: ToolAdapter, chat: OllamaChat, live: boolean): ToolAdapter {
  if (!live) return withSimulatedThoughts(adapter);
  return {
    id: adapter.id,
    async execute(input, envelope, signal, ctx?: ToolContext): Promise<ToolResult> {
      try {
        return await runOllamaLoop(
          chat,
          {
            role: ctx?.role ?? adapter.id,
            task: adapter.id,
            input,
            envelope,
          },
          ctx,
          signal,
          chat.fetchImpl,
        );
      } catch (error) {
        ctx?.onThought?.(
          `ollama-fallback:${error instanceof Error ? error.message : String(error)}`,
        );
        return withSimulatedThoughts(adapter).execute(input, envelope, signal, ctx);
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
  const adapters = playbook.adapters.map((adapter) => wrapAdapter(adapter, chat, live));
  if (!adapters.some((adapter) => adapter.id === CHILD_LOOP_TOOL_ID)) {
    adapters.push(childLoopAdapter(chat, live));
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

export function childLoopAdapter(chat: OllamaChat, live: boolean): ToolAdapter {
  return {
    id: CHILD_LOOP_TOOL_ID,
    async execute(input, envelope, signal, ctx?: ToolContext): Promise<ToolResult> {
      const payload = childLoopPayload(input);
      const role = payload.role || ctx?.role || "researcher";
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
        ctx?.onScratchpad?.(`${prompt.system}\n\n${prompt.user}`);
        ctx?.onThought?.(`simulated:${role}`);
        return {
          tokens: 48,
          latencyMs: 0,
          artifact: {
            summary: `simulated ${role} completed: ${task}`,
            role,
            taskDescription: task,
            contextPayload: payload.contextPayload ?? null,
            originalGoal: envelope.originalGoal,
          },
        };
      }
      try {
        const result = await runOllamaLoop(chat, loop, ctx, signal, chat.fetchImpl, {
          maxTurns: CHILD_LOOP_MAX_STEPS,
        });
        return {
          ...result,
          artifact: summarizeChildArtifact(result.artifact, role, task, envelope.originalGoal, payload.contextPayload),
        };
      } catch (error) {
        ctx?.onThought?.(
          `ollama-fallback:${error instanceof Error ? error.message : String(error)}`,
        );
        return childLoopAdapter(chat, false).execute(input, envelope, signal, ctx);
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
