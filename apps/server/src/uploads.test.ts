import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildGateway } from "./gateway.js";
import { EventStore } from "./store.js";
import { extractUpload, MAX_UPLOAD_BYTES } from "./uploads.js";

function makePdfWithText(text: string): Buffer {
  const escaped = text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
    `4 0 obj\n<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += object;
  }
  const xrefStart = Buffer.byteLength(body, "latin1");
  let xref = "xref\n0 6\n0000000000 65535 f \n";
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(body + xref + trailer, "latin1");
}

function multipartFile(filename: string, content: Buffer, mime: string) {
  const boundary = "----swarmtestboundary";
  return {
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
        "utf8",
      ),
      content,
      Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
    ]),
  };
}

describe("upload extract", () => {
  it("reads .txt and .md as UTF-8 text", async () => {
    const txt = await extractUpload({
      buffer: Buffer.from("hello café", "utf8"),
      filename: "note.txt",
      mimetype: "text/plain",
    });
    expect(txt).toMatchObject({ kind: "text", name: "note.txt", text: "hello café" });

    const md = await extractUpload({
      buffer: Buffer.from("# Title\n\nbody", "utf8"),
      filename: "doc.md",
      mimetype: "text/markdown",
    });
    expect(md.kind).toBe("text");
    expect(md.text).toContain("# Title");
  });

  it("decodes text as UTF-8, not UTF-16", async () => {
    const utf8 = Buffer.from("swarm", "utf8");
    const extracted = await extractUpload({
      buffer: utf8,
      filename: "a.txt",
      mimetype: "text/plain",
    });
    expect(extracted.text).toBe("swarm");
    expect(extracted.text).not.toBe(utf8.toString("utf16le"));
  });

  it("extracts text from a PDF in-process", async () => {
    const extracted = await extractUpload({
      buffer: makePdfWithText("Hello Swarm Upload"),
      filename: "brief.pdf",
      mimetype: "application/pdf",
    });
    expect(extracted.kind).toBe("pdf");
    expect(extracted.text).toContain("Hello Swarm Upload");
  });

  it("returns an image note without vision OCR", async () => {
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const extracted = await extractUpload({
      buffer,
      filename: "shot.png",
      mimetype: "image/png",
    });
    expect(extracted.kind).toBe("image");
    expect(extracted.text).toBe(
      `[Attached image: shot.png (image/png, ${buffer.byteLength} bytes). This model cannot view pixels; use the filename and the user's brief.]`,
    );
  });
});

describe("POST /api/uploads", () => {
  const cleanup: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanup.length) {
      await cleanup.pop()?.();
    }
  });

  async function startApp() {
    const dir = await mkdtemp(path.join(os.tmpdir(), "swarm-uploads-"));
    const store = await EventStore.open(":memory:");
    const app = await buildGateway(store, { uploadDir: dir });
    await app.ready();
    cleanup.push(async () => {
      await app.close();
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    });
    return app;
  }

  it("extracts a UTF-8 text file", async () => {
    const app = await startApp();
    const req = multipartFile("notes.txt", Buffer.from("brief for the swarm", "utf8"), "text/plain");
    const res = await app.inject({ method: "POST", url: "/api/uploads", ...req });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string; name: string; kind: string; text: string };
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(body).toMatchObject({
      name: "notes.txt",
      kind: "text",
      text: "brief for the swarm",
    });
  });

  it("rejects files over 10MB with 400", async () => {
    const app = await startApp();
    const req = multipartFile("huge.txt", Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0x61), "text/plain");
    const res = await app.inject({ method: "POST", url: "/api/uploads", ...req });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "file too large" });
  });

  it("rejects unsupported types with 400", async () => {
    const app = await startApp();
    const req = multipartFile("payload.exe", Buffer.from("MZ"), "application/octet-stream");
    const res = await app.inject({ method: "POST", url: "/api/uploads", ...req });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "unsupported type" });
  });
});
