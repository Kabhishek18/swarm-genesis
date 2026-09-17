export const DEFAULT_OLLAMA_HOST = "http://127.0.0.1:11434";
export const DEFAULT_OLLAMA_MODEL = "llama3.1";

export function ollamaHost(): string {
  return (process.env.OLLAMA_HOST?.trim() || DEFAULT_OLLAMA_HOST).replace(/\/$/, "");
}

export function ollamaModel(): string {
  return process.env.OLLAMA_MODEL?.trim() || DEFAULT_OLLAMA_MODEL;
}

export function ollamaDisabled(): boolean {
  const value = process.env.OLLAMA_DISABLED?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export const FETCH_TIMEOUT_MS = 8_000;
export const FETCH_SIZE_CAP = 64_000;
export const MAX_TOOL_TURNS = 6;
