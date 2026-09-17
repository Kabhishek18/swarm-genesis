import type { AgentActivity, AgentKind, StationType } from "@swarm/schema";

export const TILE = 16;

export type TileKind = "floor" | "floorAlt" | "wall" | "carpet" | "carpetAlt";

export interface Station {
  id: string;
  type: StationType;
  name: string;
  x: number;
  y: number;
  seatX: number;
  seatY: number;
  domainId?: string;
  alert?: boolean;
}

export interface Zone {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OfficeLayout {
  id: string;
  name: string;
  width: number;
  height: number;
  tiles: TileKind[][];
  stations: Station[];
  zones: Zone[];
  spawn: { x: number; y: number };
}

export type CharAnim = "idle" | "walk" | "sit" | "type" | "read" | "despawn";

export interface Character {
  agentId: string;
  name: string;
  kind: AgentKind;
  hue: number;
  activity: AgentActivity;
  stationId: string;
  x: number;
  y: number;
  path: { x: number; y: number }[];
  facing: 1 | -1;
  anim: CharAnim;
  frame: number;
  spawnFlash: number;
  despawn: number;
  visible: boolean;
  parentId?: string;
}

export function activityAnim(activity: AgentActivity): CharAnim {
  switch (activity) {
    case "thinking":
    case "reviewing":
      return "read";
    case "fetching":
    case "spawning":
      return "type";
    default:
      return "idle";
  }
}
