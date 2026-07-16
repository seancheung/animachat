import { handler, ok, type IdParams } from "@/lib/api";
import {
  deleteCharRelationships,
  deleteRelationships,
  getCharacter,
  getPersona,
  listCharRelationships,
  listRelationships,
} from "@/lib/store";

export const GET = handler(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  return ok({
    personas: await Promise.all(
      (await listRelationships(id)).map(async (r) => ({
        ...r,
        personaName: (await getPersona(r.personaId))?.name ?? "?",
      }))
    ),
    characters: await Promise.all(
      (await listCharRelationships(id)).map(async (r) => ({
        ...r,
        otherName: (await getCharacter(r.otherId))?.name ?? "?",
      }))
    ),
  });
});

/** Reset all relationship data for this character (personas and other characters). */
export const DELETE = handler(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  await deleteRelationships(id);
  await deleteCharRelationships(id);
  return ok({ ok: true });
});
