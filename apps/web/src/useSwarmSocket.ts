import { useEffect, useRef, useState } from "react";
import { applyEvent } from "@swarm/kernel";
import { emptySnapshot, type RunSnapshot, type SwarmEvent } from "@swarm/schema";

interface GatewayMessage {
  type: "event" | "snapshot" | "run" | "error" | "hello";
  event?: SwarmEvent;
  snapshot?: RunSnapshot;
  runId?: string;
  error?: string;
}

function cloneSnapshot(snapshot: RunSnapshot): RunSnapshot {
  return {
    ...snapshot,
    agents: [...snapshot.agents],
    tasks: [...snapshot.tasks],
    alerts: [...snapshot.alerts],
    domains: [...snapshot.domains],
    handoffs: [...snapshot.handoffs],
    votes: [...(snapshot.votes ?? [])],
  };
}

export function useSwarmSocket() {
  const [snapshot, setSnapshot] = useState<RunSnapshot>(emptySnapshot());
  const [runId, setRunId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [liveModel, setLiveModel] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runIdRef = useRef<string | null>(null);

  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.host}/ws`);
    ws.onopen = () => {
      setConnected(true);
      void fetch("/api/runtime")
        .then((res) => res.json() as Promise<{ live?: boolean }>)
        .then((data) => setLiveModel(Boolean(data.live)))
        .catch(() => undefined);
    };
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
    ws.onmessage = (event) => {
      let message: GatewayMessage;
      try {
        message = JSON.parse(event.data as string) as GatewayMessage;
      } catch {
        return;
      }
      if (message.runId) {
        runIdRef.current = message.runId;
        setRunId(message.runId);
      }
      if (message.type === "event" && message.event) {
        if (message.runId && runIdRef.current && message.runId !== runIdRef.current) return;
        setSnapshot((prev) => cloneSnapshot(applyEvent(prev, message.event!)));
      } else if (message.type === "snapshot" && message.snapshot) {
        setSnapshot(cloneSnapshot(message.snapshot));
      } else if (message.type === "run") {
        setSnapshot(emptySnapshot());
        setError(null);
      } else if (message.type === "error" && message.error) {
        setError(message.error);
      }
    };
    return () => ws.close();
  }, []);

  async function start(playbookId: string, goal?: string): Promise<void> {
    setError(null);
    const response = await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playbookId, goal }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({ error: response.statusText }))) as {
        error?: string;
      };
      setError(body.error ?? "Failed to start run");
      return;
    }
    const data = (await response.json()) as { runId: string; live: boolean };
    runIdRef.current = data.runId;
    setRunId(data.runId);
    setLiveModel(data.live);
  }

  async function stop(): Promise<void> {
    const id = runIdRef.current;
    if (!id) return;
    await fetch(`/api/runs/${id}/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  }

  return { snapshot, runId, connected, liveModel, error, start, stop };
}
