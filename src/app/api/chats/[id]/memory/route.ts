import { bad, handler, ok, type IdParams } from "@/lib/api";
import { memoryProgress } from "@/lib/ai/memory";
import {
  getChat,
  getCharacter,
  getCharRelationship,
  getMindState,
  getOffscreenNote,
  getRelationship,
  getSummary,
  listCharRelationships,
  listStoryBonds,
} from "@/lib/store";

/** Read-only inspection of a chat's memory: the rolling summary plus, per character,
 *  relationship states, state of mind and off-screen note. Drawer-only data, fetched
 *  when its Memory tab opens — deliberately kept out of the hot chat payload. */
export const GET = handler(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  const chat = await getChat(id);
  if (!chat) return bad("Chat not found", 404);

  // the user side: persona↔character, or the played character's char↔char pairs
  const relationshipEntries: (readonly [string, unknown])[] = [];
  for (const cid of chat.characterIds) {
    const r = chat.personaCharacterId
      ? await getCharRelationship(cid, chat.personaCharacterId)
      : chat.personaId
        ? await getRelationship(cid, chat.personaId)
        : null;
    if (r) relationshipEntries.push([cid, r] as const);
  }
  // each chat character's view of the other chat characters
  const charRelationshipEntries: (readonly [string, unknown[]])[] = [];
  for (const cid of chat.characterIds) {
    const rels = (await listCharRelationships(cid)).filter((r) => chat.characterIds.includes(r.otherId));
    const mapped = [];
    for (const r of rels)
      mapped.push({ ...r, otherName: (await getCharacter(r.otherId))?.name ?? chat.nameSnapshots[r.otherId] ?? "?" });
    if (mapped.length) charRelationshipEntries.push([cid, mapped] as const);
  }
  // aliveness state, per character × this chat (absent rows simply don't appear —
  // playthroughs and trait-off characters never have any)
  const mindStates: { characterId: string; content: string; updatedAt: number }[] = [];
  const offscreenNotes: { characterId: string; content: string; createdAt: number }[] = [];
  for (const cid of chat.characterIds) {
    const m = await getMindState(cid, id);
    if (m?.content) mindStates.push({ characterId: cid, content: m.content, updatedAt: m.updatedAt });
    const o = await getOffscreenNote(cid, id);
    if (o?.content) offscreenNotes.push({ characterId: cid, content: o.content, createdAt: o.createdAt });
  }
  return ok({
    summary: (await getSummary(id)).content,
    relationships: Object.fromEntries(relationshipEntries),
    charRelationships: Object.fromEntries(charRelationshipEntries),
    mindStates,
    offscreenNotes,
    // story-local bonds (playthroughs only — empty everywhere else)
    storyBonds: chat.mode === "story" ? await listStoryBonds(id) : [],
    // the two-stage march toward the next summarization pass (null = no memory model)
    progress: await memoryProgress(id),
  });
});
