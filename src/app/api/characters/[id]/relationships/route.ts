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
    personas: listRelationships(id).map((r) => ({
      ...r,
      personaName: getPersona(r.personaId)?.name ?? "?",
    })),
    characters: listCharRelationships(id).map((r) => ({
      ...r,
      otherName: getCharacter(r.otherId)?.name ?? "?",
    })),
  });
});

/** Reset all relationship data for this character (personas and other characters). */
export const DELETE = handler(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  deleteRelationships(id);
  deleteCharRelationships(id);
  return ok({ ok: true });
});
