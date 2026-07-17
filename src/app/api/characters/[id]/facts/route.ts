import { handler, ok, pageOpts, type IdParams } from "@/lib/api";
import { pageFacts } from "@/lib/store";

/** Read-only: the character's extracted facts (cross-chat memory), newest first.
 *  Inspection only — facts are maintained by the memory pass, never hand-edited. */
export const GET = handler(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const { limit, cursor } = pageOpts(req);
  return ok(await pageFacts(id, { limit, cursor }));
});
