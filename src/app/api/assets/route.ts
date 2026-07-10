import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { bad, handler, ok } from "@/lib/api";
import { ASSETS_DIR } from "@/lib/db";
import { registerAsset } from "@/lib/store";

export const POST = handler(async (req: Request) => {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return bad("file field is required");
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > 50 * 1024 * 1024) return bad("file too large (max 50MB)");
  const id = crypto.createHash("sha256").update(buf).digest("hex").slice(0, 32);
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  fs.writeFileSync(path.join(ASSETS_DIR, id), buf);
  registerAsset(id, file.name, file.type || "application/octet-stream", buf.length);
  return ok({ id, filename: file.name, mime: file.type, size: buf.length });
});
