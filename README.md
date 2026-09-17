# swarm-genesis

Multi-orchestrator agent OS with a Pixel Agents-style office. A Fastify gateway owns the run: the kernel splits a goal into domains, an Ollama runtime (or simulated playbooks) executes capped tools, events append to SQLite, and the HUD/canvas project that log onto desks, terminals, and ephemeral sub-agent sprites.

## Run it

```bash
npm install
npm test
npm run dev
```

`npm run dev` starts the Event Gateway on `http://127.0.0.1:8787` and Vite on `http://127.0.0.1:5173` (Vite proxies `/api` and `/ws`). Open the Vite URL, pick a playbook, click **Start run**, then click a sprite or desk to open the thought-stream drawer.

With Ollama down, the office still completes using simulated adapters.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Ollama HTTP API |
| `OLLAMA_MODEL` | `llama3.1` | Chat model |
| `OLLAMA_DISABLED` | unset | `1`/`true` forces simulated playbooks |
| `PORT` | `8787` | Gateway port |
| `SWARM_DB` | `data/swarm.db` | Append-only SQLite event log |

Provider is **Ollama only** (no LangChain). Tools are capped to `web_fetch`, `json_extract`, `scratchpad_write`, and `spawn_subagent`. Unrestricted shell stays out.

## Architecture

```
Browser HUD + office  --WS /ws-->  Event Gateway (apps/server)
                                 |  REST start/stop
                                 |  SQLite event log
                                 v
                              SwarmKernel
                                 v
                         packages/runtime
                         Ollama chat+tools
                                 v
                      localhost:11434  (or simulated fallback)
```

| Layer | Kernel | Office |
| --- | --- | --- |
| Meta-orchestrator | Domain split, global budget, alerts | HQ desk |
| Domain orchestrators | Task queues, dependency locks, review votes | Named desks |
| Workers | Tools, steps, thought stream | Walking sprites |
| Sub-agents | Single-turn, TTL, spawn cap | Pop-in helpers |

All mutations append to the event log. The React HUD and Canvas 2D office never talk to agents directly; they apply `SwarmEvent`s (including `agent.thought`, `agent.scratchpad`, and `task.vote`).

Guards baked into the kernel:

- **Infinite handoff loop** — hop cap plus identical-output detection. LLM/simulated review votes emit `task.vote`; reject requeues until the breaker trips. Meta overrides and the HUD/desks flash.
- **UI flooding** — concurrent sub-agent cap, visible sprite cap, mandatory despawn on complete/TTL.
- **Context drift** — `ConstraintEnvelope.originalGoal` is required on every spawn and tool call.
- **Desk collision** — one occupant per seat; extras pathfind to adjacent queue tiles.

## Packages

- `packages/schema` — events, envelope, budgets, `ToolAdapter`
- `packages/kernel` — DAG scheduler, handoff guard, event log
- `packages/runtime` — Ollama chat+tools loop and simulated fallback
- `packages/playbooks` — feature-dev and market-intel demos
- `packages/office` — tile maps, pathfinding, Canvas 2D renderer
- `apps/server` — Fastify Event Gateway, WebSocket stream, SQLite persist/replay
- `apps/web` — playbook picker, HUD drawer, office canvas (`useSwarmSocket`)
