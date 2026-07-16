import { bad, handler, ok, type IdParams } from "@/lib/api";
import { AiConfigError } from "@/lib/ai/client";
import { runReturnPass } from "@/lib/ai/offscreen";
import { getChat } from "@/lib/store";

export const dynamic = "force-dynamic";

/** The user returned to a chat after a real-time gap: generate the opted-in
 *  characters' off-screen life notes and name who (if anyone) texts first.
 *  The eligibility rules live server-side (runReturnPass) — calling this on an
 *  ineligible chat is a cheap no-op, so the client may fire it optimistically. */
export const POST = handler(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  if (!(await getChat(id))) return bad("Chat not found", 404);
  try {
    return ok(await runReturnPass(id));
  } catch (e) {
    // no model configured (or the call failed): a return without notes is just
    // a normal chat-open — never an error banner in the user's face
    if (e instanceof AiConfigError) return ok({ generated: [], texter: null });
    throw e;
  }
});
