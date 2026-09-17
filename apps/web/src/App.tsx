import { useEffect, useMemo, useRef, useState } from "react";
import { SwarmKernel } from "@swarm/kernel";
import { emptySnapshot, type RunSnapshot } from "@swarm/schema";
import { getPlaybook, playbooks } from "@swarm/playbooks";
import { OfficeCanvas } from "./OfficeCanvas";
import { Hud } from "./Hud";

export function App() {
  const kernelRef = useRef<SwarmKernel | null>(null);
  if (!kernelRef.current) kernelRef.current = new SwarmKernel();
  const kernel = kernelRef.current;

  const [playbookId, setPlaybookId] = useState(playbooks[0].id);
  const [snapshot, setSnapshot] = useState<RunSnapshot>(emptySnapshot());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const running = snapshot.status === "running";

  useEffect(() => {
    return kernel.subscribe((_event, next) => {
      setSnapshot({
        ...next,
        agents: [...next.agents],
        tasks: [...next.tasks],
        alerts: [...next.alerts],
        domains: [...next.domains],
        handoffs: [...next.handoffs],
      });
    });
  }, [kernel]);

  const selected = useMemo(
    () => snapshot.agents.find((agent) => agent.id === selectedId) ?? null,
    [snapshot.agents, selectedId],
  );

  async function start() {
    if (running) return;
    const playbook = getPlaybook(playbookId);
    setSelectedId(null);
    void kernel.start(playbook).catch((error: unknown) => {
      console.error(error);
    });
  }

  function stop() {
    kernel.stop();
  }

  return (
    <div className="app">
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
            onChange={(event) => setPlaybookId(event.target.value)}
          >
            {playbooks.map((playbook) => (
              <option key={playbook.id} value={playbook.id}>
                {playbook.name}
              </option>
            ))}
          </select>
        </label>
        <div className="actions">
          <button type="button" className="primary" onClick={start} disabled={running}>
            Start run
          </button>
          <button type="button" onClick={stop} disabled={!running}>
            Stop
          </button>
        </div>
        <StatusChip snapshot={snapshot} />
      </header>
      <Hud snapshot={snapshot} selected={selected} />
      <OfficeCanvas
        snapshot={snapshot}
        layoutId={snapshot.layoutId || playbookId}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />
    </div>
  );
}

function StatusChip({ snapshot }: { snapshot: RunSnapshot }) {
  return <div className={`chip ${snapshot.status}`}>{snapshot.status || "idle"}</div>;
}
