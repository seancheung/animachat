import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { bad, handler, ok } from "@/lib/api";
import { ASSETS_DIR, DATA_DIR, closeDb, getDb } from "@/lib/db";

/** Restore a full backup archive, replacing the current database and assets. */
export const POST = handler(async (req: Request) => {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return bad("file field is required");
  const zip = await JSZip.loadAsync(Buffer.from(await file.arrayBuffer()));
  const dbFile = zip.file("animachat.db");
  if (!dbFile) return bad("Not an AnimaChat backup: animachat.db missing");
  const dbBuf = await dbFile.async("nodebuffer");

  closeDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = path.join(DATA_DIR, `animachat.db${suffix}`);
    if (fs.existsSync(p)) fs.rmSync(p);
  }
  fs.writeFileSync(path.join(DATA_DIR, "animachat.db"), dbBuf);
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  const writes: Promise<void>[] = [];
  zip.folder("assets")?.forEach((name, f) => {
    if (f.dir || !/^[a-f0-9]{32}$/.test(name)) return;
    writes.push(
      f.async("nodebuffer").then((buf) => {
        fs.writeFileSync(path.join(ASSETS_DIR, name), buf);
      })
    );
  });
  await Promise.all(writes);
  getDb(); // reopen + run migrations
  return ok({ ok: true });
});
