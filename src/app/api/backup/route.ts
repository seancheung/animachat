import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { handler } from "@/lib/api";
import { ASSETS_DIR, DATA_DIR, getDb } from "@/lib/db";

/** Full backup: the SQLite db + every asset, as one archive. */
export const GET = handler(async () => {
  const db = getDb();
  db.pragma("wal_checkpoint(TRUNCATE)");
  const zip = new JSZip();
  zip.file("animachat.db", fs.readFileSync(path.join(DATA_DIR, "animachat.db")));
  if (fs.existsSync(ASSETS_DIR)) {
    for (const f of fs.readdirSync(ASSETS_DIR)) {
      zip.file(`assets/${f}`, fs.readFileSync(path.join(ASSETS_DIR, f)));
    }
  }
  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="animachat-backup-${stamp}.zip"`,
    },
  });
});
