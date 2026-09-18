import type { OfficeLayout, TileKind } from "./types.js";

export function fillRoom(
  width: number,
  height: number,
  paint?: (x: number, y: number) => TileKind | undefined,
): TileKind[][] {
  const tiles: TileKind[][] = [];
  for (let y = 0; y < height; y++) {
    const row: TileKind[] = [];
    for (let x = 0; x < width; x++) {
      const custom = paint?.(x, y);
      if (custom) {
        row.push(custom);
        continue;
      }
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        row.push("wall");
      } else {
        row.push((x + y) % 2 === 0 ? "floor" : "floorAlt");
      }
    }
    tiles.push(row);
  }
  return tiles;
}

function doorway(tiles: TileKind[][], x: number, y: number): void {
  if (tiles[y]?.[x]) tiles[y][x] = (x + y) % 2 === 0 ? "floor" : "floorAlt";
}

export const featureDevLayout: OfficeLayout = {
  id: "feature-dev",
  name: "Delivery Floor",
  width: 32,
  height: 18,
  tiles: [],
  spawn: { x: 16, y: 16 },
  zones: [
    { id: "architecture", name: "Architecture", x: 1, y: 1, w: 14, h: 10 },
    { id: "delivery", name: "Delivery", x: 17, y: 1, w: 14, h: 10 },
    { id: "test", name: "Test Bay", x: 17, y: 12, w: 14, h: 5 },
  ],
  stations: [
    { id: "hq", type: "hq", name: "Meta HQ", x: 14, y: 2, seatX: 15, seatY: 4 },
    {
      id: "desk-arch",
      type: "desk",
      name: "Desk A · Architecture",
      x: 4,
      y: 4,
      seatX: 5,
      seatY: 6,
      domainId: "architecture",
    },
    {
      id: "desk-delivery",
      type: "desk",
      name: "Desk B · Delivery",
      x: 24,
      y: 4,
      seatX: 25,
      seatY: 6,
      domainId: "delivery",
    },
    {
      id: "architecture-archive",
      type: "archive",
      name: "Schema shelves",
      x: 2,
      y: 8,
      seatX: 3,
      seatY: 9,
      domainId: "architecture",
    },
    {
      id: "delivery-archive",
      type: "archive",
      name: "Build logs",
      x: 28,
      y: 8,
      seatX: 27,
      seatY: 9,
      domainId: "delivery",
    },
    {
      id: "terminal-backend",
      type: "terminal",
      name: "Backend bay",
      x: 3,
      y: 13,
      seatX: 4,
      seatY: 14,
      domainId: "architecture",
    },
    {
      id: "terminal-db",
      type: "terminal",
      name: "DB bay",
      x: 8,
      y: 13,
      seatX: 9,
      seatY: 14,
      domainId: "architecture",
    },
    {
      id: "terminal-qa",
      type: "terminal",
      name: "QA console",
      x: 18,
      y: 13,
      seatX: 19,
      seatY: 14,
      domainId: "delivery",
    },
    {
      id: "test-bay-1",
      type: "testBay",
      name: "Unit runner",
      x: 23,
      y: 13,
      seatX: 23,
      seatY: 14,
      domainId: "delivery",
    },
    {
      id: "test-bay-2",
      type: "testBay",
      name: "Fuzzer",
      x: 27,
      y: 13,
      seatX: 27,
      seatY: 14,
      domainId: "delivery",
    },
  ],
};

featureDevLayout.tiles = fillRoom(32, 18, (x, y) => {
  if (x === 16 && y > 0 && y < 12) return "wall";
  if (x === 16 && y === 7) return "floor";
  if (x >= 1 && x <= 14 && y >= 1 && y <= 10) return (x + y) % 2 === 0 ? "carpet" : "carpetAlt";
  if (x >= 17 && x <= 30 && y >= 1 && y <= 10) return (x + y) % 2 === 0 ? "carpet" : "carpetAlt";
  return undefined;
});
doorway(featureDevLayout.tiles, 16, 7);

export const marketIntelLayout: OfficeLayout = {
  id: "market-intel",
  name: "Intelligence Floor",
  width: 32,
  height: 18,
  tiles: [],
  spawn: { x: 16, y: 16 },
  zones: [
    { id: "research", name: "Research", x: 1, y: 1, w: 14, h: 16 },
    { id: "synthesis", name: "Synthesis", x: 17, y: 1, w: 14, h: 16 },
  ],
  stations: [
    { id: "hq", type: "hq", name: "Meta HQ", x: 14, y: 1, seatX: 15, seatY: 3 },
    {
      id: "desk-research",
      type: "desk",
      name: "Research Director",
      x: 4,
      y: 3,
      seatX: 5,
      seatY: 5,
      domainId: "research",
    },
    {
      id: "desk-synthesis",
      type: "desk",
      name: "Synthesis Editor",
      x: 24,
      y: 3,
      seatX: 25,
      seatY: 5,
      domainId: "synthesis",
    },
    {
      id: "research-archive",
      type: "archive",
      name: "Coverage files",
      x: 2,
      y: 7,
      seatX: 3,
      seatY: 8,
      domainId: "research",
    },
    {
      id: "synthesis-archive",
      type: "archive",
      name: "Fact archive",
      x: 28,
      y: 7,
      seatX: 27,
      seatY: 8,
      domainId: "synthesis",
    },
    {
      id: "terminal-web-1",
      type: "terminal",
      name: "Web 1",
      x: 3,
      y: 12,
      seatX: 4,
      seatY: 13,
      domainId: "research",
    },
    {
      id: "terminal-web-2",
      type: "terminal",
      name: "Web 2",
      x: 7,
      y: 12,
      seatX: 8,
      seatY: 13,
      domainId: "research",
    },
    {
      id: "terminal-web-3",
      type: "terminal",
      name: "Web 3",
      x: 11,
      y: 12,
      seatX: 12,
      seatY: 13,
      domainId: "research",
    },
    {
      id: "terminal-facts",
      type: "terminal",
      name: "Fact-check",
      x: 22,
      y: 12,
      seatX: 23,
      seatY: 13,
      domainId: "synthesis",
    },
  ],
};

marketIntelLayout.tiles = fillRoom(32, 18, (x, y) => {
  if (x === 16 && y > 3 && y < 17) return "wall";
  if (x === 16 && y === 10) return "floor";
  if (x >= 1 && x <= 14 && y >= 1 && y <= 16) return (x + y) % 2 === 0 ? "carpet" : "carpetAlt";
  if (x >= 17 && x <= 30 && y >= 1 && y <= 16) return (x + y) % 2 === 0 ? "carpet" : "carpetAlt";
  return undefined;
});
doorway(marketIntelLayout.tiles, 16, 10);

export const websiteStudioLayout: OfficeLayout = {
  id: "website-studio",
  name: "Studio Floor",
  width: 32,
  height: 18,
  tiles: [],
  spawn: { x: 16, y: 16 },
  zones: [
    { id: "design", name: "Design", x: 1, y: 1, w: 14, h: 10 },
    { id: "frontend", name: "Frontend", x: 17, y: 1, w: 14, h: 10 },
    { id: "copy", name: "Copy", x: 17, y: 12, w: 14, h: 5 },
  ],
  stations: [
    { id: "hq", type: "hq", name: "Meta HQ", x: 14, y: 2, seatX: 15, seatY: 4 },
    {
      id: "desk-design",
      type: "desk",
      name: "Desk · Design",
      x: 4,
      y: 4,
      seatX: 5,
      seatY: 6,
      domainId: "design",
    },
    {
      id: "desk-frontend",
      type: "desk",
      name: "Desk · Frontend",
      x: 24,
      y: 4,
      seatX: 25,
      seatY: 6,
      domainId: "frontend",
    },
    {
      id: "design-archive",
      type: "archive",
      name: "Moodboard shelves",
      x: 2,
      y: 8,
      seatX: 3,
      seatY: 9,
      domainId: "design",
    },
    {
      id: "frontend-archive",
      type: "archive",
      name: "Component shelf",
      x: 28,
      y: 8,
      seatX: 27,
      seatY: 9,
      domainId: "frontend",
    },
    {
      id: "terminal-design",
      type: "terminal",
      name: "Layout bay",
      x: 3,
      y: 13,
      seatX: 4,
      seatY: 14,
      domainId: "design",
    },
    {
      id: "terminal-html",
      type: "terminal",
      name: "HTML bay",
      x: 22,
      y: 6,
      seatX: 23,
      seatY: 7,
      domainId: "frontend",
    },
    {
      id: "desk-copy",
      type: "desk",
      name: "Desk · Copy",
      x: 24,
      y: 13,
      seatX: 25,
      seatY: 15,
      domainId: "copy",
    },
    {
      id: "terminal-copy",
      type: "terminal",
      name: "Copy console",
      x: 18,
      y: 13,
      seatX: 19,
      seatY: 14,
      domainId: "copy",
    },
  ],
};

websiteStudioLayout.tiles = fillRoom(32, 18, (x, y) => {
  if (x === 16 && y > 0 && y < 12) return "wall";
  if (y === 11 && x >= 17 && x <= 30) return "wall";
  if (x >= 1 && x <= 14 && y >= 1 && y <= 10) return (x + y) % 2 === 0 ? "carpet" : "carpetAlt";
  if (x >= 17 && x <= 30 && y >= 1 && y <= 10) return (x + y) % 2 === 0 ? "carpet" : "carpetAlt";
  if (x >= 17 && x <= 30 && y >= 12 && y <= 16) return (x + y) % 2 === 0 ? "carpet" : "carpetAlt";
  return undefined;
});
doorway(websiteStudioLayout.tiles, 16, 7);
doorway(websiteStudioLayout.tiles, 23, 11);

export const writingRoomLayout: OfficeLayout = {
  id: "writing-room",
  name: "Writing Floor",
  width: 32,
  height: 18,
  tiles: [],
  spawn: { x: 16, y: 16 },
  zones: [
    { id: "outline", name: "Outline", x: 1, y: 1, w: 14, h: 10 },
    { id: "draft", name: "Draft", x: 17, y: 1, w: 14, h: 10 },
    { id: "edit", name: "Edit", x: 17, y: 12, w: 14, h: 5 },
  ],
  stations: [
    { id: "hq", type: "hq", name: "Meta HQ", x: 14, y: 2, seatX: 15, seatY: 4 },
    {
      id: "desk-outline",
      type: "desk",
      name: "Desk · Outline",
      x: 4,
      y: 4,
      seatX: 5,
      seatY: 6,
      domainId: "outline",
    },
    {
      id: "desk-draft",
      type: "desk",
      name: "Desk · Draft",
      x: 24,
      y: 4,
      seatX: 25,
      seatY: 6,
      domainId: "draft",
    },
    {
      id: "outline-archive",
      type: "archive",
      name: "Brief shelves",
      x: 2,
      y: 8,
      seatX: 3,
      seatY: 9,
      domainId: "outline",
    },
    {
      id: "draft-archive",
      type: "archive",
      name: "Draft stacks",
      x: 28,
      y: 8,
      seatX: 27,
      seatY: 9,
      domainId: "draft",
    },
    {
      id: "terminal-outline",
      type: "terminal",
      name: "Outline bay",
      x: 3,
      y: 13,
      seatX: 4,
      seatY: 14,
      domainId: "outline",
    },
    {
      id: "terminal-draft",
      type: "terminal",
      name: "Draft bay",
      x: 22,
      y: 6,
      seatX: 23,
      seatY: 7,
      domainId: "draft",
    },
    {
      id: "desk-edit",
      type: "desk",
      name: "Desk · Edit",
      x: 24,
      y: 13,
      seatX: 25,
      seatY: 15,
      domainId: "edit",
    },
    {
      id: "terminal-edit",
      type: "terminal",
      name: "Edit console",
      x: 18,
      y: 13,
      seatX: 19,
      seatY: 14,
      domainId: "edit",
    },
  ],
};

writingRoomLayout.tiles = fillRoom(32, 18, (x, y) => {
  if (x === 16 && y > 0 && y < 12) return "wall";
  if (y === 11 && x >= 17 && x <= 30) return "wall";
  if (x >= 1 && x <= 14 && y >= 1 && y <= 10) return (x + y) % 2 === 0 ? "carpet" : "carpetAlt";
  if (x >= 17 && x <= 30 && y >= 1 && y <= 10) return (x + y) % 2 === 0 ? "carpet" : "carpetAlt";
  if (x >= 17 && x <= 30 && y >= 12 && y <= 16) return (x + y) % 2 === 0 ? "carpet" : "carpetAlt";
  return undefined;
});
doorway(writingRoomLayout.tiles, 16, 7);
doorway(writingRoomLayout.tiles, 23, 11);

export const layouts: OfficeLayout[] = [
  featureDevLayout,
  marketIntelLayout,
  websiteStudioLayout,
  writingRoomLayout,
];

export function getLayout(id: string): OfficeLayout {
  return layouts.find((layout) => layout.id === id) ?? featureDevLayout;
}
