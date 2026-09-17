import type { RunSnapshot } from "@swarm/schema";
import { findPath, walkable } from "./pathfinding.js";
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
    let bestDist = 24;
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
    if (best) {
      this.selectedId = best.agentId;
      return this.selectedId;
    }

    for (const station of this.layout.stations) {
      const sx = station.x * TILE;
      const sy = station.y * TILE;
      const seatX = station.seatX * TILE + 8;
      const seatY = station.seatY * TILE + 8;
      const minX = Math.min(sx - 4, seatX - 16);
      const maxX = Math.max(sx + TILE * 2 + 4, seatX + 16);
      const minY = Math.min(sy - 8, seatY - 16);
      const maxY = Math.max(sy + TILE * 2, seatY + 16);
      const hitDesk = worldX >= minX && worldX <= maxX && worldY >= minY && worldY <= maxY;
      const hitSeat = Math.hypot(worldX - seatX, worldY - seatY) < 20;
      if (!hitDesk && !hitSeat) continue;
      const occupant = this.occupantAt(station.id);
      this.selectedId = occupant?.agentId ?? null;
      return this.selectedId;
    }

    this.selectedId = null;
    return null;
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
      const bubble = lastBubble(agent.thoughts.at(-1)?.delta, agent.currentStep);
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
          currentTool: agent.currentTool,
          bubble,
        };
        if (agent.kind === "subagent" && station) {
          character.x = station.seatX * TILE;
          character.y = station.seatY * TILE;
          character.anim = "type";
        }
        this.characters.set(agent.id, character);
      } else {
        existing.name = agent.name;
        existing.activity = agent.activity;
        existing.hue = agent.hue;
        existing.stationId = agent.stationId;
        existing.currentTool = agent.currentTool;
        existing.bubble = bubble;
        existing.parentId = agent.parentId;
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

    this.assignSeats();

    const alerted = new Set(
      snapshot.alerts
        .filter(
          (alert) =>
            alert.code === "handoff-loop" || alert.code === "budget" || alert.level === "critical",
        )
        .flatMap((alert) => alert.agentIds),
    );
    const globalAlarm = snapshot.alerts.some(
      (alert) => (alert.code === "handoff-loop" || alert.code === "budget") && alert.agentIds.length === 0,
    );
    for (const station of this.layout.stations) {
      const occupants = snapshot.agents.filter((agent) => agent.stationId === station.id);
      station.alert =
        occupants.some((agent) => alerted.has(agent.id)) || (globalAlarm && station.type === "hq");
    }
    for (const character of this.characters.values()) {
      character.blocked =
        alerted.has(character.agentId) || (globalAlarm && character.kind === "meta");
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

  private occupantAt(stationId: string): Character | undefined {
    const station = this.station(stationId);
    let best: Character | undefined;
    let bestDist = Infinity;
    for (const character of this.characters.values()) {
      if (character.stationId !== stationId || !character.visible || character.despawn > 0) continue;
      const dx = character.x - (station?.seatX ?? 0) * TILE;
      const dy = character.y - (station?.seatY ?? 0) * TILE;
      const dist = Math.hypot(dx, dy);
      if (dist < bestDist) {
        bestDist = dist;
        best = character;
      }
    }
    return best;
  }

  private assignSeats(): void {
    const groups = new Map<string, Character[]>();
    for (const character of this.characters.values()) {
      if (!character.visible || character.despawn > 0) continue;
      const list = groups.get(character.stationId) ?? [];
      list.push(character);
      groups.set(character.stationId, list);
    }
    for (const [stationId, occupants] of groups) {
      const station = this.station(stationId);
      if (!station) continue;
      const tiles = queueTiles(this.layout, station.seatX, station.seatY, occupants.length);
      occupants.forEach((character, index) => {
        const dest = tiles[index] ?? tiles[tiles.length - 1] ?? { x: station.seatX, y: station.seatY };
        this.retarget(character, dest);
      });
    }
  }

  private retarget(character: Character, dest: { x: number; y: number }): void {
    if (
      character.targetTile &&
      character.targetTile.x === dest.x &&
      character.targetTile.y === dest.y &&
      (character.path.length > 0 ||
        (Math.round(character.x / TILE) === dest.x && Math.round(character.y / TILE) === dest.y))
    ) {
      return;
    }
    character.targetTile = dest;
    const fromX = Math.round(character.x / TILE);
    const fromY = Math.round(character.y / TILE);
    character.path = findPath(this.layout, fromX, fromY, dest.x, dest.y);
    if (character.path.length === 0) {
      character.x = dest.x * TILE;
      character.y = dest.y * TILE;
      character.anim = activityAnim(character.activity);
    }
  }
}

function lastBubble(thought?: string, step?: string): string | undefined {
  const text = (thought && thought.trim()) || step;
  if (!text) return undefined;
  return text.length > 28 ? `${text.slice(0, 26)}...` : text;
}

function queueTiles(
  layout: OfficeLayout,
  seatX: number,
  seatY: number,
  needed: number,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [{ x: seatX, y: seatY }];
  const seen = new Set([`${seatX},${seatY}`]);
  const seats = new Set(layout.stations.map((station) => `${station.seatX},${station.seatY}`));
  for (let radius = 1; radius <= 4 && out.length < needed; radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
        const x = seatX + dx;
        const y = seatY + dy;
        const id = `${x},${y}`;
        if (seen.has(id) || seats.has(id) || !walkable(layout, x, y)) continue;
        seen.add(id);
        out.push({ x, y });
        if (out.length >= needed) return out;
      }
    }
  }
  return out;
}
