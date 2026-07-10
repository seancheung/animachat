import { handler, ok, type IdParams } from "@/lib/api";
import { deleteRelationships, getPersona, listRelationships } from "@/lib/store";

export const GET = handler(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  return ok(
    listRelationships(id).map((r) => ({
      ...r,
      personaName: getPersona(r.personaId)?.name ?? "?",
    }))
  );
});

/** Reset all relationship data for this character. */
export const DELETE = handler(async (_req: Request, { params }: IdParams) => {
  deleteRelationships((await params).id);
  return ok({ ok: true });
});
