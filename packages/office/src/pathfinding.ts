import type { OfficeLayout } from "./types.js";

const DIRS = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

export function walkable(layout: OfficeLayout, x: number, y: number): boolean {
  const tile = layout.tiles[y]?.[x];
  return tile !== undefined && tile !== "wall";
}

export function findPath(
  layout: OfficeLayout,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): { x: number; y: number }[] {
  const start = { x: fromX, y: fromY };
  const goal = { x: toX, y: toY };
  if (start.x === goal.x && start.y === goal.y) return [];
  if (!walkable(layout, goal.x, goal.y)) return [];

  const key = (x: number, y: number) => `${x},${y}`;
  const seen = new Set<string>([key(start.x, start.y)]);
  const queue: { x: number; y: number }[] = [start];
  const parent = new Map<string, string>();

  while (queue.length) {
    const current = queue.shift();
    if (!current) break;
    if (current.x === goal.x && current.y === goal.y) break;
    for (const dir of DIRS) {
      const nx = current.x + dir.x;
      const ny = current.y + dir.y;
      const id = key(nx, ny);
      if (seen.has(id) || !walkable(layout, nx, ny)) continue;
      seen.add(id);
      parent.set(id, key(current.x, current.y));
      queue.push({ x: nx, y: ny });
    }
  }

  const goalKey = key(goal.x, goal.y);
  if (!parent.has(goalKey) && (start.x !== goal.x || start.y !== goal.y)) {
    return [];
  }

  const path: { x: number; y: number }[] = [];
  let cursor = goalKey;
  const startKey = key(start.x, start.y);
  while (cursor !== startKey) {
    const [x, y] = cursor.split(",").map(Number);
    path.push({ x, y });
    const prev = parent.get(cursor);
    if (!prev) break;
    cursor = prev;
  }
  path.reverse();
  return path;
}
