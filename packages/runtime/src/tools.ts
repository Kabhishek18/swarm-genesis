import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { CHILD_LOOP_TOOL_ID, type SubagentDef, type ToolContext } from "@swarm/schema";
import type { OllamaToolDef } from "./ollama.js";
import { FETCH_SIZE_CAP, FETCH_TIMEOUT_MS } from "./config.js";

export const WRITE_FILE_EXTS = [".html", ".css", ".js", ".md", ".txt", ".json"] as const;

export const OLLAMA_TOOLS: OllamaToolDef[] = [
  {
    type: "function",
    function: {
      name: "web_fetch",
      description: "Fetch a URL with a timeout and 64KB size cap. Use for market pages, not a general shell.",
      parameters: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "json_extract",
      description: "Parse JSON and read a dotted path (e.g. rows.0.price).",
      parameters: {
        type: "object",
        properties: {
          json: { type: "string" },
          path: { type: "string" },
        },
        required: ["json"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "scratchpad_write",
      description: "Persist a note on the current agent's scratchpad.",
      parameters: {
        type: "object",
        properties: { note: { type: "string" } },
        required: ["note"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Write a non-empty UTF-8 deliverable under the run workspace. Relative paths only; extensions .html .css .js .md .txt .json. Content must not be empty or whitespace-only. Not a general filesystem.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "spawn_subagent",
      description:
        "Request an ephemeral sub-agent. Pass a playbook toolId, or taskDescription+role for an isolated child loop. The kernel still enforces TTL and spawn caps.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          toolId: { type: "string" },
          toolInput: { type: "object" },
          stationId: { type: "string" },
          taskDescription: { type: "string" },
          role: { type: "string" },
          contextPayload: { type: "string" },
        },
      },
    },
  },
];

const ALLOWED = new Set(OLLAMA_TOOLS.map((tool) => tool.function.name));

export function resolveWorkspaceFile(
  workspaceDir: string | undefined,
  relPath: string,
): { abs: string; rel: string } {
  if (!workspaceDir?.trim()) {
    throw new Error("write_file requires a workspace directory");
  }
  if (!relPath.trim()) {
    throw new Error("write_file path is empty");
  }
  const trimmed = relPath.trim().replace(/\\/g, "/");
  if (path.isAbsolute(trimmed) || trimmed.startsWith("/") || /^[a-zA-Z]:/.test(trimmed)) {
    throw new Error("write_file rejects absolute paths");
  }
  if (trimmed.split("/").some((part) => part === ".." || part === "")) {
    throw new Error("write_file rejects path traversal");
  }
  const ext = path.posix.extname(trimmed).toLowerCase();
  if (!WRITE_FILE_EXTS.includes(ext as (typeof WRITE_FILE_EXTS)[number])) {
    throw new Error(`write_file allows only ${WRITE_FILE_EXTS.join(", ")}`);
  }
  const root = path.resolve(workspaceDir);
  const abs = path.resolve(root, trimmed);
  const relative = path.relative(root, abs);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("write_file rejects path traversal");
  }
  return { abs, rel: relative.split(path.sep).join("/") };
}

export async function executeCappedTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext | undefined,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  if (!ALLOWED.has(name)) {
    throw new Error(`Tool ${name} is not in the capped runtime set`);
  }
  switch (name) {
    case "web_fetch":
      return webFetch(String(args.url ?? ""), signal, fetchImpl);
    case "json_extract":
      return jsonExtract(String(args.json ?? ""), args.path ? String(args.path) : undefined);
    case "scratchpad_write": {
      const note = String(args.note ?? "");
      ctx?.onScratchpad?.(note);
      return { written: true, bytes: note.length };
    }
    case "write_file":
      return writeWorkspaceFile(String(args.path ?? ""), args.content == null ? "" : String(args.content), ctx);
    case "spawn_subagent": {
      const def = buildSubagentDef(args);
      const artifact = await ctx?.spawnSubagent?.(def);
      return {
        spawned: def.id,
        name: def.name,
        role: def.role ?? null,
        parentAgentId: ctx?.agentId ?? null,
        summary: childSummary(artifact),
        artifact: artifact ?? null,
      };
    }
    default:
      throw new Error(`Tool ${name} is not implemented`);
  }
}

export async function writeWorkspaceFile(
  relPath: string,
  content: string,
  ctx: ToolContext | undefined,
): Promise<{ written: true; path: string; bytes: number }> {
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("write_file rejects empty content");
  }
  const { abs, rel } = resolveWorkspaceFile(ctx?.workspaceDir, relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
  const bytes = Buffer.byteLength(content, "utf8");
  ctx?.onFileWritten?.(rel, bytes);
  return { written: true, path: rel, bytes };
}

function optionalString(value: unknown): string | undefined {
  if (value == null) return undefined;
  const text = String(value);
  return text.trim() ? text : undefined;
}

export function buildSubagentDef(args: Record<string, unknown>): SubagentDef {
  const taskDescription = optionalString(args.taskDescription);
  const role = optionalString(args.role);
  const contextPayload = optionalString(args.contextPayload);
  const playbookToolId = optionalString(args.toolId);
  const useChildLoop = Boolean(taskDescription || role) && !playbookToolId;
  if (!playbookToolId && !useChildLoop) {
    throw new Error("spawn_subagent requires toolId or taskDescription/role");
  }
  return {
    id: String(args.id ?? `sub-${Date.now()}`),
    name: String(args.name ?? role ?? "subagent"),
    toolId: useChildLoop ? CHILD_LOOP_TOOL_ID : playbookToolId,
    toolInput: useChildLoop
      ? {
          taskDescription: taskDescription ?? "",
          role: role ?? "researcher",
          contextPayload,
        }
      : args.toolInput,
    stationId: optionalString(args.stationId),
    taskDescription,
    role,
    contextPayload,
  };
}

function childSummary(artifact: unknown): string {
  if (artifact == null) return "";
  if (typeof artifact === "string") return artifact;
  if (typeof artifact === "object" && "summary" in artifact) {
    const summary = (artifact as { summary: unknown }).summary;
    if (summary != null) return String(summary);
  }
  try {
    return JSON.stringify(artifact);
  } catch {
    return String(artifact);
  }
}

async function webFetch(url: string, signal: AbortSignal, fetchImpl: typeof fetch): Promise<unknown> {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("web_fetch only allows http(s) URLs");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    const buf = new Uint8Array(await res.arrayBuffer());
    const sliced = buf.byteLength > FETCH_SIZE_CAP ? buf.slice(0, FETCH_SIZE_CAP) : buf;
    const text = new TextDecoder().decode(sliced);
    return {
      status: res.status,
      truncated: buf.byteLength > FETCH_SIZE_CAP,
      bytes: sliced.byteLength,
      body: text,
    };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

function jsonExtract(raw: string, path?: string): unknown {
  const parsed = JSON.parse(raw) as unknown;
  if (!path) return parsed;
  return path.split(".").reduce<unknown>((cursor, key) => {
    if (cursor == null) return undefined;
    if (Array.isArray(cursor)) return cursor[Number(key)];
    if (typeof cursor === "object") return (cursor as Record<string, unknown>)[key];
    return undefined;
  }, parsed);
}
