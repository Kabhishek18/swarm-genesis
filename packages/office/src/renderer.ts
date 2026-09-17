import { TILE, type Character, type OfficeLayout, type Station } from "./types.js";
import type { OfficeState } from "./office-state.js";

const PALETTE = {
  void: "#0d1117",
  floor: "#243044",
  floorAlt: "#1e2a3b",
  carpet: "#2b3d4f",
  carpetAlt: "#263646",
  wall: "#121821",
  wallTop: "#3a4a5c",
  grid: "#1a2433",
  wood: "#6b4a2b",
  woodDark: "#4a321c",
  screen: "#3d8bfd",
  screenDim: "#1b4f8a",
  shelf: "#8a6a3b",
  text: "#d7e0ea",
  mute: "#8b9bb0",
  alert: "#e24a4a",
  hq: "#c9a227",
};

function hsl(h: number, s: number, l: number): string {
  return `hsl(${h} ${s}% ${l}%)`;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.fillRect(x, y, w, h);
}

export function worldFromEvent(
  canvas: HTMLCanvasElement,
  layout: OfficeLayout,
  event: Pick<MouseEvent, "clientX" | "clientY">,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const scale = canvasScale(canvas, layout);
  const ox = (canvas.width / (window.devicePixelRatio || 1) - layout.width * TILE * scale) / 2;
  const oy = (canvas.height / (window.devicePixelRatio || 1) - layout.height * TILE * scale) / 2;
  return {
    x: (event.clientX - rect.left - ox) / scale,
    y: (event.clientY - rect.top - oy) / scale,
  };
}

function canvasScale(canvas: HTMLCanvasElement, layout: OfficeLayout): number {
  const cssW = canvas.width / (window.devicePixelRatio || 1);
  const cssH = canvas.height / (window.devicePixelRatio || 1);
  const sx = cssW / (layout.width * TILE);
  const sy = cssH / (layout.height * TILE);
  return Math.max(0.5, Math.min(sx, sy) * 0.92);
}

export function renderOffice(ctx: CanvasRenderingContext2D, office: OfficeState, now: number): void {
  const { layout } = office;
  const dpr = window.devicePixelRatio || 1;
  const cssW = ctx.canvas.width / dpr;
  const cssH = ctx.canvas.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = PALETTE.void;
  ctx.fillRect(0, 0, cssW, cssH);

  const scale = canvasScale(ctx.canvas, layout);
  const ox = Math.floor((cssW - layout.width * TILE * scale) / 2);
  const oy = Math.floor((cssH - layout.height * TILE * scale) / 2);
  ctx.translate(ox, oy);
  ctx.scale(scale, scale);

  drawTiles(ctx, layout);
  drawZones(ctx, layout);
  for (const station of layout.stations) {
    drawStation(ctx, station, now);
  }
  drawNesting(ctx, office);
  const sorted = [...office.characters.values()].sort((a, b) => a.y - b.y);
  for (const character of sorted) {
    drawCharacter(ctx, character, office.selectedId === character.agentId, now);
  }
}

function drawNesting(ctx: CanvasRenderingContext2D, office: OfficeState): void {
  ctx.save();
  ctx.strokeStyle = "rgba(125, 211, 252, 0.35)";
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 2]);
  for (const child of office.characters.values()) {
    if (!child.parentId || !child.visible || child.despawn > 0) continue;
    const parent = office.characters.get(child.parentId);
    if (!parent || !parent.visible || parent.despawn > 0) continue;
    ctx.beginPath();
    ctx.moveTo(parent.x + 8, parent.y + 8);
    ctx.lineTo(child.x + 8, child.y + 8);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPlaque(ctx: CanvasRenderingContext2D, x: number, y: number, label: string): void {
  ctx.fillStyle = "#0d1117";
  ctx.fillRect(x + 1, y + 18, label.length * 4 + 4, 7);
  ctx.fillStyle = PALETTE.text;
  ctx.font = "5px monospace";
  ctx.fillText(label, x + 3, y + 24);
}

function drawTiles(ctx: CanvasRenderingContext2D, layout: OfficeLayout): void {
  for (let y = 0; y < layout.height; y++) {
    for (let x = 0; x < layout.width; x++) {
      const tile = layout.tiles[y][x];
      const px = x * TILE;
      const py = y * TILE;
      if (tile === "wall") {
        ctx.fillStyle = PALETTE.wall;
        ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = PALETTE.wallTop;
        ctx.fillRect(px, py, TILE, 3);
        continue;
      }
      ctx.fillStyle =
        tile === "carpet"
          ? PALETTE.carpet
          : tile === "carpetAlt"
            ? PALETTE.carpetAlt
            : tile === "floorAlt"
              ? PALETTE.floorAlt
              : PALETTE.floor;
      ctx.fillRect(px, py, TILE, TILE);
    }
  }
}

function drawZones(ctx: CanvasRenderingContext2D, layout: OfficeLayout): void {
  for (const zone of layout.zones) {
    const warm = zone.id === "delivery" || zone.id === "synthesis";
    ctx.fillStyle = warm ? "rgba(92, 48, 22, 0.28)" : "rgba(24, 64, 96, 0.28)";
    ctx.fillRect(zone.x * TILE, zone.y * TILE, zone.w * TILE, zone.h * TILE);
    ctx.fillStyle = PALETTE.text;
    ctx.font = "8px monospace";
    ctx.fillText(zone.name.toUpperCase(), zone.x * TILE + 4, zone.y * TILE + 10);
  }
}

function drawStation(ctx: CanvasRenderingContext2D, station: Station, now: number): void {
  const x = station.x * TILE;
  const y = station.y * TILE;
  if (station.alert) {
    ctx.fillStyle = PALETTE.alert;
    ctx.globalAlpha = 0.35 + Math.sin(now / 180) * 0.2;
    ctx.fillRect(x - 4, y - 4, TILE * 2 + 8, TILE * 2 + 8);
    ctx.globalAlpha = 1;
  }
  switch (station.type) {
    case "hq":
      drawDesk(ctx, x, y, PALETTE.hq, true, now);
      drawPlaque(ctx, x, y, "CMD");
      break;
    case "desk":
      drawDesk(ctx, x, y, PALETTE.wood, true, now);
      drawPlaque(ctx, x, y, "ORCH");
      break;
    case "terminal":
    case "testBay":
      drawTerminal(ctx, x, y, station.type === "testBay", now);
      drawPlaque(ctx, x, y, station.type === "testBay" ? "SUB" : "WK");
      break;
    case "archive":
      drawArchive(ctx, x, y);
      break;
    default:
      break;
  }
  ctx.fillStyle = PALETTE.text;
  ctx.font = "6px monospace";
  ctx.fillText(station.name, x - 2, y - 4);
}

function drawDesk(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  screen: boolean,
  now: number,
): void {
  ctx.fillStyle = PALETTE.woodDark;
  ctx.fillRect(x + 2, y + 18, 4, 6);
  ctx.fillRect(x + 26, y + 18, 4, 6);
  ctx.fillStyle = color;
  roundRect(ctx, x, y + 6, 32, 14);
  if (screen) {
    ctx.fillStyle = PALETTE.woodDark;
    ctx.fillRect(x + 8, y - 2, 16, 12);
    ctx.fillStyle = (now / 400) % 2 < 1 ? PALETTE.screen : PALETTE.screenDim;
    ctx.fillRect(x + 10, y, 12, 8);
  }
}

function drawTerminal(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  testBay: boolean,
  now: number,
): void {
  ctx.fillStyle = "#151b24";
  ctx.fillRect(x, y, 20, 18);
  ctx.fillStyle = testBay ? "#3ecf8e" : PALETTE.screen;
  const blink = Math.floor(now / 160) % 4;
  ctx.fillRect(x + 2, y + 2, 16, 10);
  ctx.fillStyle = "#0b1220";
  ctx.fillRect(x + 3, y + 3 + blink, 14, 1);
  ctx.fillStyle = "#2a3344";
  ctx.fillRect(x + 2, y + 14, 16, 3);
}

function drawArchive(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = PALETTE.shelf;
  ctx.fillRect(x, y, 14, 22);
  ctx.fillStyle = PALETTE.woodDark;
  for (let i = 0; i < 3; i++) {
    ctx.fillRect(x + 1, y + 3 + i * 6, 12, 4);
  }
}

function drawCharacter(
  ctx: CanvasRenderingContext2D,
  character: Character,
  selected: boolean,
  now: number,
): void {
  const alpha =
    character.despawn > 0 ? Math.max(0, 1 - character.despawn / 280) : 1;
  ctx.globalAlpha = alpha;
  const x = Math.round(character.x);
  const y = Math.round(character.y);
  const bounce =
    character.anim === "walk" ? ((Math.floor(character.frame) % 2) * 1) : 0;
  const typePulse = character.anim === "type" ? Math.floor(now / 120) % 2 : 0;

  if (character.spawnFlash > 0) {
    ctx.fillStyle = "#ffffff";
    ctx.globalAlpha = character.spawnFlash * alpha;
    ctx.fillRect(x - 2, y - 2, 20, 22);
    ctx.globalAlpha = alpha;
  }

  if (selected) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x - 1, y + 16, 18, 2);
  }

  const body = hsl(character.hue, 55, character.kind === "subagent" ? 62 : 48);
  const head = hsl(character.hue, 25, 78);
  const shadow = hsl(character.hue, 55, 28);

  if (character.kind === "subagent") {
    ctx.fillStyle = body;
    ctx.fillRect(x + 4, y + 6 - bounce, 8, 8);
    ctx.fillStyle = head;
    ctx.fillRect(x + 5, y + 2 - bounce, 6, 5);
    ctx.fillStyle = "#111";
    ctx.fillRect(x + 6, y + 4 - bounce, 1, 1);
    ctx.fillRect(x + 9, y + 4 - bounce, 1, 1);
  } else {
    ctx.fillStyle = shadow;
    ctx.fillRect(x + 3, y + 16, 10, 2);
    ctx.fillStyle = head;
    ctx.fillRect(x + 4, y + 1 - bounce, 8, 6);
    ctx.fillStyle = "#1b1b1b";
    ctx.fillRect(x + 5, y + 3 - bounce, 2, 2);
    ctx.fillRect(x + 9, y + 3 - bounce, 2, 2);
    ctx.fillStyle = body;
    ctx.fillRect(x + 3, y + 7 - bounce, 10, 7);
    ctx.fillStyle = shadow;
    const gait = Math.floor(character.frame) % 2;
    if (character.anim === "walk") {
      ctx.fillRect(x + 3 + gait, y + 14 - bounce, 3, 3);
      ctx.fillRect(x + 10 - gait, y + 14 - bounce, 3, 3);
    } else {
      ctx.fillRect(x + 4, y + 14, 3, 3);
      ctx.fillRect(x + 9, y + 14, 3, 3);
    }
    if (character.anim === "type") {
      ctx.fillStyle = hsl(character.hue, 40, 70);
      ctx.fillRect(x + 12, y + 9 - typePulse, 3, 2);
    }
    if (character.kind === "domain-orchestrator" || character.kind === "meta") {
      ctx.fillStyle = character.kind === "meta" ? PALETTE.hq : hsl(character.hue, 70, 60);
      ctx.fillRect(x + 4, y - 1 - bounce, 8, 2);
    }
  }

  if (character.blocked) {
    ctx.strokeStyle = PALETTE.alert;
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 1, y - 1, 18, 20);
  }

  drawActivityBadge(ctx, character, x, y, now);

  ctx.fillStyle = PALETTE.text;
  ctx.font = "6px monospace";
  ctx.fillText(character.name, x - 6, y - 4);

  if (character.currentTool) {
    const label = character.currentTool.slice(0, 10);
    ctx.fillStyle = "#0b1220";
    ctx.fillRect(x - 2, y - 16, label.length * 4 + 6, 8);
    ctx.fillStyle = "#3d8bfd";
    ctx.fillRect(x - 2, y - 16, 2, 8);
    ctx.fillStyle = "#d7e0ea";
    ctx.fillText(label, x + 2, y - 10);
  }

  if (character.bubble) {
    const label = character.bubble;
    const bx = character.currentTool ? x + 16 : x - 4;
    const by = character.currentTool ? y - 6 : y - 22;
    const w = Math.min(72, label.length * 4 + 8);
    ctx.fillStyle = "#f4f7fb";
    ctx.fillRect(bx, by, w, 10);
    ctx.fillStyle = "#0d1117";
    ctx.fillText(label, bx + 2, by + 8);
  }

  ctx.globalAlpha = 1;
}


function drawActivityBadge(
  ctx: CanvasRenderingContext2D,
  character: Character,
  x: number,
  y: number,
  now: number,
): void {
  const kind = character.kind === "meta" || character.kind === "domain-orchestrator" ? "ORCH" : character.kind === "subagent" ? "SUB" : "WK";
  ctx.fillStyle = character.kind === "meta" ? PALETTE.hq : character.kind === "subagent" ? "#7dd3fc" : "#9aa4b2";
  ctx.font = "5px monospace";
  ctx.fillText(kind, x + 12, y - 5);

  if (character.activity === "idling") return;
  const bx = x + 14;
  const by = y - 2;
  ctx.fillStyle = "#0b1220";
  ctx.fillRect(bx, by, 6, 6);
  if (character.activity === "thinking") {
    ctx.strokeStyle = "#3d8bfd";
    ctx.beginPath();
    ctx.arc(bx + 3, by + 3, 2, 0, Math.PI * (0.5 + (now / 180) % 2));
    ctx.stroke();
  } else if (character.activity === "fetching") {
    ctx.fillStyle = "#3ecf8e";
    ctx.fillRect(bx + 1, by + 1, 4, 2);
    ctx.fillRect(bx + 1, by + 4, 3, 1);
  } else if (character.activity === "reviewing") {
    ctx.fillStyle = "#f0c674";
    ctx.fillRect(bx + 1, by + 2, 4, 2);
  } else if (character.activity === "spawning") {
    ctx.fillStyle = "#7dd3fc";
    ctx.fillRect(bx + 2, by + 1, 2, 4);
    ctx.fillRect(bx + 1, by + 2, 4, 2);
  }
}
