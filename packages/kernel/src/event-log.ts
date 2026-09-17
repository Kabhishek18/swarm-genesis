import type { RunSnapshot, SwarmEvent } from "@swarm/schema";
import { emptySnapshot } from "@swarm/schema";
import { applyEvent } from "./projector.js";

export type EventListener = (event: SwarmEvent, snapshot: RunSnapshot) => void;

export class EventLog {
  readonly events: SwarmEvent[] = [];
  private snapshot: RunSnapshot = emptySnapshot();
  private listeners = new Set<EventListener>();

  getSnapshot(): RunSnapshot {
    return this.snapshot;
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  append(event: SwarmEvent): RunSnapshot {
    this.events.push(event);
    this.snapshot = applyEvent(this.snapshot, event);
    for (const listener of this.listeners) {
      listener(event, this.snapshot);
    }
    return this.snapshot;
  }

  reset(): void {
    this.events.length = 0;
    this.snapshot = emptySnapshot();
  }

  replay(): RunSnapshot {
    this.snapshot = this.events.reduce(applyEvent, emptySnapshot());
    return this.snapshot;
  }
}
