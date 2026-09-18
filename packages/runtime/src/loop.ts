import type { ConstraintEnvelope, ToolContext, ToolResult } from "@swarm/schema";
import { OllamaChat, type OllamaMessage } from "./ollama.js";
import { isWebsiteTask } from "./site-html.js";
import { executeCappedTool, OLLAMA_TOOLS } from "./tools.js";
import { MAX_TOOL_TURNS } from "./config.js";

export interface LoopInput {
  role: string;
  task: string;
  input: unknown;
  envelope: ConstraintEnvelope;
}

export function assemblePrompt(input: LoopInput): { system: string; user: string } {
  const constraints = input.envelope.constraints.map((item) => `- ${item}`).join("\n");
  const website = isWebsiteTask(input.role, input.task, input.envelope.originalGoal);
  const system = [
    `You are ${input.role} in a multi-orchestrator agent office.`,
    `Original goal: ${input.envelope.originalGoal}`,
    `Quality bar: ${input.envelope.qualityBar}`,
    "Constraints:",
    constraints || "- none",
    "Use only the provided tools. Never request a shell, filesystem, or database runner.",
    "Write deliverables with write_file using relative paths and only .html .css .js .md .txt .json. Still no general shell, filesystem, or database access.",
    website
      ? "This is a website/HTML task. Call write_file with path index.html (and site/index.html if you nest files) and a COMPLETE valid HTML document: doctype, html, head, body, inline CSS in a style tag, an h1, and visible sections derived from the original goal. Also write site-design.md as a real markdown outline (headings and layout sections from the brief). Never write an empty file, whitespace-only content, the word null, a one-line comment, JSON-only content, or a stub. After the page is written, reply with a compact JSON summary — the HTML file is the deliverable, not the JSON."
      : "When the task is done, reply with a compact JSON artifact and no further tool calls.",
  ].join("\n");
  const user = [`Task: ${input.task}`, `Input: ${JSON.stringify(input.input ?? null)}`].join("\n");
  return { system, user };
}

export interface LoopOptions {
  maxTurns?: number;
}

export async function runOllamaLoop(
  chat: OllamaChat,
  loop: LoopInput,
  ctx: ToolContext | undefined,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
  options: LoopOptions = {},
): Promise<ToolResult> {
  const { system, user } = assemblePrompt(loop);
  ctx?.onScratchpad?.(`${system}\n\n${user}`);

  const messages: OllamaMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  let tokens = 0;
  let artifact: unknown = { ok: true, task: loop.task };
  const maxTurns = options.maxTurns ?? MAX_TOOL_TURNS;

  for (let turn = 0; turn < maxTurns; turn++) {
    const result = await chat.chat(
      messages,
      OLLAMA_TOOLS,
      (delta) => ctx?.onThought?.(delta),
      signal,
    );
    tokens += result.tokens;
    messages.push(result.message);

    const calls = result.message.tool_calls ?? [];
    if (!calls.length) {
      artifact = parseArtifact(result.message.content) ?? { text: result.message.content, task: loop.task };
      break;
    }

    for (const call of calls) {
      const name = call.function.name;
      const args =
        typeof call.function.arguments === "string"
          ? (JSON.parse(call.function.arguments) as Record<string, unknown>)
          : call.function.arguments;
      ctx?.onThought?.(`tool:${name}`);
      let output: unknown;
      try {
        output = await executeCappedTool(name, args, ctx, signal, fetchImpl);
      } catch (error) {
        output = { error: error instanceof Error ? error.message : String(error) };
      }
      messages.push({
        role: "tool",
        content: JSON.stringify(output),
      });
    }
  }

  return { tokens: tokens || 800, latencyMs: 0, artifact };
}

function parseArtifact(content: string): unknown {
  const trimmed = content.trim();
  if (!trimmed) return null;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}
