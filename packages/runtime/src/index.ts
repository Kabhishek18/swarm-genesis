export { OllamaChat } from "./ollama.js";
export { runOllamaLoop, assemblePrompt } from "./loop.js";
export {
  wrapPlaybook,
  wrapAdapter,
  withSimulatedThoughts,
  ollamaAvailable,
  ollamaReviewer,
  simulatedDuplicateReviewer,
  childLoopAdapter,
} from "./wrap.js";
export { OLLAMA_TOOLS, executeCappedTool, buildSubagentDef } from "./tools.js";
export {
  ollamaHost,
  ollamaModel,
  ollamaDisabled,
  DEFAULT_OLLAMA_HOST,
  DEFAULT_OLLAMA_MODEL,
  CHILD_LOOP_MAX_STEPS,
} from "./config.js";
