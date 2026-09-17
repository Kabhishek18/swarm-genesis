import type { RunSnapshot } from "@swarm/schema";
import { findPath } from "./pathfinding.js";
import { getLayout } from "./layouts.js";
import {
  activityAnim,
  TILE,
  type Character,
  type OfficeLayout,
  type Station,
} from "./types.js";

const SPEED = 72;
const DESPAWN_MS = 280;

export class OfficeState {
  layout: OfficeLayout;
  characters = new Map<string, Character>();
  selectedId: string | null = null;
  private time = 0;

  constructor(layoutId = "feature-dev") {
    this.layout = getLayout(layoutId);
  }

  setLayout(layoutId: string): void {
    this.layout = getLayout(layoutId);
    this.characters.clear();
    this.selectedId = null;
  }

  station(id: string): Station | undefined {
    return this.layout.stations.find((station) => station.id === id);
  }

  pick(worldX: number, worldY: number): string | null {
    let best: Character | undefined;
    let bestDist = 12;
    for (const character of this.characters.values()) {
      if (!character.visible || character.despawn > 0) continue;
      const dx = character.x + 8 - worldX;
      const dy = character.y + 8 - worldY;
      const dist = Math.hypot(dx, dy);
      if (dist < bestDist) {
        bestDist = dist;
        best = character;
      }
    }
    this.selectedId = best?.agentId ?? null;
    return this.selectedId;
  }

  sync(snapshot: RunSnapshot): void {
    if (snapshot.layoutId && snapshot.layoutId !== this.layout.id) {
      this.setLayout(snapshot.layoutId);
    }

    const live = new Set<string>();
    for (const agent of snapshot.agents) {
      if (agent.kind === "subagent" && !agent.visible) continue;
      live.add(agent.id);
      const existing = this.characters.get(agent.id);
      const station = this.station(agent.stationId) ?? this.layout.stations[0];
      if (!existing) {
        const spawn = this.layout.spawn;
        const character: Character = {
          agentId: agent.id,
          name: agent.name,
          kind: agent.kind,
          hue: agent.hue,
          activity: agent.activity,
          stationId: agent.stationId,
          x: spawn.x * TILE,
          y: spawn.y * TILE,
          path: [],
          facing: 1,
          anim: "walk",
          frame: 0,
          spawnFlash: agent.kind === "subagent" ? 1 : 0.35,
          despawn: 0,
          visible: true,
          parentId: agent.parentId,
        };
        if (agent.kind === "subagent" && station) {
          character.x = station.seatX * TILE;
          character.y = station.seatY * TILE;
          character.anim = "type";
        } else {
          this.retarget(character, agent.stationId);
        }
        this.characters.set(agent.id, character);
      } else {
        existing.name = agent.name;
        existing.activity = agent.activity;
        existing.hue = agent.hue;
        if (existing.stationId !== agent.stationId || existing.path.length === 0) {
          existing.stationId = agent.stationId;
          this.retarget(existing, agent.stationId);
        }
        if (existing.path.length === 0) {
          existing.anim = activityAnim(agent.activity);
        }
      }
    }

    for (const [id, character] of this.characters) {
      if (!live.has(id) && character.despawn === 0) {
        character.despawn = 0.001;
        character.anim = "despawn";
        character.path = [];
      }
    }

    const alerted = new Set(
      snapshot.alerts
        .filter((alert) => alert.code === "handoff-loop")
        .flatMap((alert) => alert.agentIds),
    );
    for (const station of this.layout.stations) {
      const occupants = snapshot.agents.filter((agent) => agent.stationId === station.id);
      station.alert = occupants.some((agent) => alerted.has(agent.id));
    }
  }

  update(dt: number): void {
    this.time += dt;
    for (const character of this.characters.values()) {
      character.frame += dt * (character.anim === "type" ? 8 : 6);
      if (character.spawnFlash > 0) {
        character.spawnFlash = Math.max(0, character.spawnFlash - dt * 2.4);
      }
      if (character.despawn > 0) {
        character.despawn += dt * 1000;
        if (character.despawn >= DESPAWN_MS) {
          this.characters.delete(character.agentId);
        }
        continue;
      }
      if (character.path.length === 0) continue;
      const next = character.path[0];
      const tx = next.x * TILE;
      const ty = next.y * TILE;
      const dx = tx - character.x;
      const dy = ty - character.y;
      const dist = Math.hypot(dx, dy);
      character.anim = "walk";
      if (dx !== 0) character.facing = dx > 0 ? 1 : -1;
      const step = SPEED * dt;
      if (dist <= step) {
        character.x = tx;
        character.y = ty;
        character.path.shift();
        if (character.path.length === 0) {
          character.anim = activityAnim(character.activity);
        }
      } else {
        character.x += (dx / dist) * step;
        character.y += (dy / dist) * step;
      }
    }
  }

  private retarget(character: Character, stationId: string): void {
    const station = this.station(stationId);
    if (!station) return;
    const fromX = Math.round(character.x / TILE);
    const fromY = Math.round(character.y / TILE);
    character.path = findPath(this.layout, fromX, fromY, station.seatX, station.seatY);
    if (character.path.length === 0) {
      character.x = station.seatX * TILE;
      character.y = station.seatY * TILE;
      character.anim = activityAnim(character.activity);
    }
  }
}
