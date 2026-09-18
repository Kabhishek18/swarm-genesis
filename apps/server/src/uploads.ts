import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractText, getDocumentProxy } from "unpdf";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type UploadKind = "pdf" | "text" | "image";

export interface UploadResult {
  id: string;
  name: string;
  kind: UploadKind;
  text: string;
}

export class UploadError extends Error {
  readonly status = 400 as const;

  constructor(message: string) {
    super(message);
    this.name = "UploadError";
  }
}

const TEXT_EXTS = new Set([".txt", ".md"]);
const PDF_EXTS = new Set([".pdf"]);
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

export function defaultUploadDir(): string {
  if (process.env.SWARM_UPLOADS) return process.env.SWARM_UPLOADS;
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  return path.join(root, "data", "uploads");
}

function fileExt(filename: string): string {
  return path.extname(filename).toLowerCase();
}

export function classifyUpload(filename: string, mimetype: string): UploadKind | null {
  const ext = fileExt(filename);
  const mime = (mimetype ?? "").toLowerCase().split(";")[0]?.trim() ?? "";
  if (PDF_EXTS.has(ext) || mime === "application/pdf") return "pdf";
  if (TEXT_EXTS.has(ext) || mime === "text/plain" || mime === "text/markdown" || mime === "text/x-markdown") {
    return "text";
  }
  if (
    IMAGE_EXTS.has(ext) ||
    mime === "image/png" ||
    mime === "image/jpeg" ||
    mime === "image/jpg" ||
    mime === "image/webp"
  ) {
    return "image";
  }
  return null;
}

export function imageAttachmentNote(name: string, type: string, size: number): string {
  return `[Attached image: ${name} (${type}, ${size} bytes). This model cannot view pixels; use the filename and the user's brief.]`;
}

function imageType(filename: string, mimetype: string): string {
  const mime = (mimetype || "").split(";")[0]?.trim().toLowerCase();
  if (mime === "image/jpg") return "image/jpeg";
  if (mime === "image/png" || mime === "image/jpeg" || mime === "image/webp") return mime;
  const ext = fileExt(filename);
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return mime || "image/png";
}

export async function extractPdfText(buffer: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  const merged = Array.isArray(text) ? text.join("\n") : text;
  return merged.replace(/\u0000/g, "").trim();
}

export async function extractUpload(opts: {
  buffer: Buffer;
  filename: string;
  mimetype: string;
}): Promise<{ kind: UploadKind; name: string; text: string }> {
  const name = path.basename(opts.filename || "upload");
  if (opts.buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new UploadError("file too large");
  }
  const kind = classifyUpload(name, opts.mimetype);
  if (!kind) {
    throw new UploadError("unsupported type");
  }
  if (kind === "text") {
    return { kind, name, text: opts.buffer.toString("utf8") };
  }
  if (kind === "image") {
    return {
      kind,
      name,
      text: imageAttachmentNote(name, imageType(name, opts.mimetype), opts.buffer.byteLength),
    };
  }
  try {
    return { kind, name, text: await extractPdfText(opts.buffer) };
  } catch {
    throw new UploadError("unable to extract PDF text");
  }
}

function storedExtension(kind: UploadKind, filename: string): string {
  const ext = fileExt(filename);
  if (kind === "pdf") return ".pdf";
  if (kind === "text") return TEXT_EXTS.has(ext) ? ext : ".txt";
  if (IMAGE_EXTS.has(ext)) return ext;
  return ".png";
}

export async function saveUpload(opts: {
  buffer: Buffer;
  filename: string;
  mimetype: string;
  uploadDir: string;
}): Promise<UploadResult> {
  const extracted = await extractUpload(opts);
  const id = randomUUID();
  await mkdir(opts.uploadDir, { recursive: true });
  const dest = path.join(opts.uploadDir, `${id}${storedExtension(extracted.kind, extracted.name)}`);
  await writeFile(dest, opts.buffer);
  return { id, name: extracted.name, kind: extracted.kind, text: extracted.text };
}

export function isOversizeError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { code?: string; statusCode?: number };
  return (
    err.code === "FST_REQ_FILE_TOO_LARGE" ||
    err.code === "FST_ERR_CTP_BODY_TOO_LARGE" ||
    err.statusCode === 413
  );
}
