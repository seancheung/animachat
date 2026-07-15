import fs from "node:fs";
import path from "node:path";
import { bad, handler } from "@/lib/api";
import { LOGS_DIR } from "@/lib/debugLog";

export const dynamic = "force-dynamic";

// Serves debug log files written by writeDebugLog. Not gated by
// DEBUG_RESPONSE_LOG: a link captured while logging was on keeps working.
export const GET = handler(
  async (_req: Request, { params }: { params: Promise<{ name: string }> }) => {
    const { name } = await params;
    // strict allowlist (no dots outside the extension, no separators) — the
    // route must never read outside LOGS_DIR
    if (!/^[a-z]+(-[a-zA-Z0-9]+)+\.log$/.test(name)) return bad("bad log name", 400);
    const file = path.join(LOGS_DIR, name);
    if (!fs.existsSync(file)) return bad("log not found", 404);
    return new Response(new Uint8Array(fs.readFileSync(file)), {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": `attachment; filename="${name}"`,
      },
    });
  }
);
