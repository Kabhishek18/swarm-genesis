import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function defaultRunsDir(): string {
  if (process.env.SWARM_RUNS) return process.env.SWARM_RUNS;
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  return path.join(root, "data", "runs");
}

export function isSafeRunId(id: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(id);
}

export function runWorkspaceDir(runsDir: string, runId: string): string {
  if (!isSafeRunId(runId)) {
    throw new Error("invalid run id");
  }
  return path.resolve(runsDir, runId);
}

export async function listWorkspaceFiles(
  dir: string,
): Promise<{ path: string; bytes: number }[]> {
  const files: { path: string; bytes: number }[] = [];
  await walk(dir, dir, files);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

async function walk(
  root: string,
  current: string,
  files: { path: string; bytes: number }[],
): Promise<void> {
  let entries;
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw error;
    throw error;
  }
  for (const entry of entries) {
    const abs = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await walk(root, abs, files);
      continue;
    }
    if (!entry.isFile()) continue;
    const info = await stat(abs);
    const rel = path.relative(root, abs).split(path.sep).join("/");
    files.push({ path: rel, bytes: info.size });
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(at = new Date()): { time: number; date: number } {
  const time =
    ((at.getHours() & 0x1f) << 11) |
    ((at.getMinutes() & 0x3f) << 5) |
    (Math.floor(at.getSeconds() / 2) & 0x1f);
  const date =
    (((at.getFullYear() - 1980) & 0x7f) << 9) |
    (((at.getMonth() + 1) & 0xf) << 5) |
    (at.getDate() & 0x1f);
  return { time, date };
}

export async function zipDirectory(dir: string): Promise<Buffer> {
  const listed = await listWorkspaceFiles(dir);
  const { time, date } = dosDateTime();
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const file of listed) {
    const data = await readFile(path.join(dir, file.path));
    const name = Buffer.from(file.path, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(1 << 11, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const localEntry = Buffer.concat([local, name, data]);
    locals.push(localEntry);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(1 << 11, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, name]));
    offset += localEntry.length;
  }

  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(listed.length, 8);
  eocd.writeUInt16LE(listed.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralDir, eocd]);
}

export async function ensureRunWorkspace(runsDir: string, runId: string): Promise<string> {
  const dir = runWorkspaceDir(runsDir, runId);
  await mkdir(dir, { recursive: true });
  return dir;
}
