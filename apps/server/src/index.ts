import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildGateway } from "./gateway.js";
import { EventStore } from "./store.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const dbPath = process.env.SWARM_DB ?? path.join(root, "data", "swarm.db");
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";

const store = await EventStore.open(dbPath);
const app = await buildGateway(store);

await app.listen({ port, host });
console.log(`Swarm gateway http://${host}:${port}  db=${dbPath}`);
console.log(
  `Ollama ${process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434"} model=${process.env.OLLAMA_MODEL ?? "llama3.1"}`,
);
