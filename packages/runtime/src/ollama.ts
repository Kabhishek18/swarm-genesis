import { ollamaHost, ollamaModel } from "./config.js";

export interface OllamaToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown> | string;
  };
}

export interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: OllamaToolCall[];
}

export interface OllamaToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatTurn {
  message: OllamaMessage;
  tokens: number;
}

export interface OllamaChatOptions {
  host?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

function parseArgs(raw: Record<string, unknown> | string): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : { value: raw };
    } catch {
      return { value: raw };
    }
  }
  return raw ?? {};
}

export class OllamaChat {
  readonly host: string;
  readonly model: string;
  readonly fetchImpl: typeof fetch;

  constructor(options: OllamaChatOptions = {}) {
    this.host = (options.host ?? ollamaHost()).replace(/\/$/, "");
    this.model = options.model ?? ollamaModel();
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async healthy(signal?: AbortSignal): Promise<boolean> {
    try {
      const res = await this.fetchImpl(`${this.host}/api/tags`, {
        signal: timeoutSignal(8_000, signal),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async chat(
    messages: OllamaMessage[],
    tools: OllamaToolDef[],
    onDelta: (delta: string) => void,
    signal: AbortSignal,
  ): Promise<ChatTurn> {
    const res = await this.fetchImpl(`${this.host}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages,
        tools,
        stream: true,
      }),
      signal,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama chat failed (${res.status}): ${body.slice(0, 240)}`);
    }
    if (!res.body) {
      throw new Error("Ollama chat response had no body");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    const toolCalls: OllamaToolCall[] = [];
    let tokens = 0;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let chunk: {
          message?: { content?: string; tool_calls?: OllamaToolCall[] };
          eval_count?: number;
          prompt_eval_count?: number;
        };
        try {
          chunk = JSON.parse(trimmed) as typeof chunk;
        } catch {
          continue;
        }
        const delta = chunk.message?.content ?? "";
        if (delta) {
          content += delta;
          onDelta(delta);
        }
        if (chunk.message?.tool_calls?.length) {
          for (const call of chunk.message.tool_calls) {
            toolCalls.push({
              function: {
                name: call.function.name,
                arguments: parseArgs(call.function.arguments),
              },
            });
          }
        }
        tokens += (chunk.eval_count ?? 0) + (chunk.prompt_eval_count ?? 0);
      }
    }

    return {
      tokens: tokens || Math.max(32, Math.ceil(content.length / 4)),
      message: {
        role: "assistant",
        content,
        tool_calls: toolCalls.length ? toolCalls : undefined,
      },
    };
  }
}

function timeoutSignal(ms: number, parent?: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const onAbort = () => {
    clearTimeout(timer);
    controller.abort();
  };
  parent?.addEventListener("abort", onAbort, { once: true });
  if (parent?.aborted) onAbort();
  return controller.signal;
}
