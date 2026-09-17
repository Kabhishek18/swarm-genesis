import { useMemo, useState } from "react";
import { playbooks } from "@swarm/playbooks";
import type { RunSnapshot } from "@swarm/schema";
import { OfficeCanvas } from "./OfficeCanvas";
import { Hud, InspectionDrawer } from "./Hud";
import { useSwarmSocket } from "./useSwarmSocket";

export function App() {
  const { snapshot, connected, liveModel, error, start, stop } = useSwarmSocket();
  const [playbookId, setPlaybookId] = useState(playbooks[0].id);
  const [goal, setGoal] = useState(playbooks[0].trigger);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const running = snapshot.status === "running";

  const selected = useMemo(
    () => snapshot.agents.find((agent) => agent.id === selectedId) ?? null,
    [snapshot.agents, selectedId],
  );

  async function onStart() {
    if (running) return;
    setSelectedId(null);
    try {
      await start(playbookId, goal);
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div className={selected ? "app inspecting" : "app"}>
      <header className="topbar">
        <div>
          <div className="brand">SWARM GENESIS</div>
          <div className="sub">Multi-orchestrator OS · pixel office</div>
        </div>
        <label className="picker">
          Playbook
          <select
            value={playbookId}
            disabled={running}
            onChange={(event) => {
              const nextId = event.target.value;
              setPlaybookId(nextId);
              const next = playbooks.find((playbook) => playbook.id === nextId);
              if (next) setGoal(next.trigger);
            }}
          >
            {playbooks.map((playbook) => (
              <option key={playbook.id} value={playbook.id}>
                {playbook.name}
              </option>
            ))}
          </select>
        </label>
        <label className="picker goal-picker">
          Brief
          <input
            type="text"
            value={goal}
            disabled={running}
            onChange={(event) => setGoal(event.target.value)}
            aria-label="Run brief"
          />
        </label>
        <div className="actions">
          <button type="button" className="primary" onClick={() => void onStart()} disabled={running}>
            Start run
          </button>
          <button type="button" onClick={() => void stop()} disabled={!running}>
            Stop
          </button>
        </div>
        <div className={`chip ${connected ? "ok" : "failed"}`}>{connected ? "gateway" : "offline"}</div>
        <div className={`chip ${liveModel ? "running" : ""}`}>
          {liveModel ? "ollama" : liveModel === false ? "simulated" : "runtime"}
        </div>
        <StatusChip snapshot={snapshot} />
        {error ? <div className="banner bad">{error}</div> : null}
      </header>
      <Hud snapshot={snapshot} />
      <OfficeCanvas
        snapshot={snapshot}
        layoutId={snapshot.layoutId || playbookId}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />
      {selected ? (
        <InspectionDrawer snapshot={snapshot} selected={selected} onClose={() => setSelectedId(null)} />
      ) : null}
    </div>
  );
}

function StatusChip({ snapshot }: { snapshot: RunSnapshot }) {
  return <div className={`chip ${snapshot.status}`}>{snapshot.status || "idle"}</div>;
}
