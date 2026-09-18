import type { ConstraintEnvelope, ToolAdapter, ToolResult } from "@swarm/schema";

export function simulatedAdapter(
  id: string,
  tokens: number,
  latencyMs: number,
  artifact:
    | unknown
    | ((input: unknown, envelope: ConstraintEnvelope) => unknown),
): ToolAdapter {
  return {
    id,
    async execute(input, envelope, signal): Promise<ToolResult> {
      if (!envelope.originalGoal.trim()) {
        throw new Error("context-drift: ConstraintEnvelope.originalGoal is required");
      }
      const value =
        typeof artifact === "function"
          ? (artifact as (input: unknown, envelope: ConstraintEnvelope) => unknown)(
              input,
              envelope,
            )
          : artifact;
      if (signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      return { tokens, latencyMs, artifact: value };
    },
  };
}
