import { bad, handler, ok, type IdParams } from "@/lib/api";
import { computeStage, resolveStageAssets } from "@/lib/ai/prompts";
import {
  deleteChat,
  getChat,
  getCharacter,
  getPersona,
  getRelationship,
  getStory,
  getScene,
  listCharRelationships,
  listCheckpoints,
  listMessages,
  saveChat,
} from "@/lib/store";
import type { Character } from "@/lib/types";

export const GET = handler(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  const chat = getChat(id);
  if (!chat) return bad("Chat not found", 404);
  const messages = listMessages(id);
  const stage = computeStage(chat, messages);
  const story = chat.storyId ? getStory(chat.storyId) : null;
  return ok({
    chat,
    messages,
    stage: { ...stage, ...resolveStageAssets(stage) },
    characters: chat.characterIds.map(getCharacter).filter((c): c is Character => !!c),
    persona: chat.personaId ? getPersona(chat.personaId) : null,
    story,
    storyScenes: story ? story.sceneIds.map((sid) => getScene(sid)).filter(Boolean) : [],
    checkpoints: listCheckpoints(id),
    relationships: chat.personaId
      ? Object.fromEntries(
          chat.characterIds
            .map((cid) => [cid, getRelationship(cid, chat.personaId!)] as const)
            .filter(([, r]) => r)
        )
      : {},
    // each chat character's view of the other chat characters
    charRelationships: Object.fromEntries(
      chat.characterIds.map((cid) => [
        cid,
        listCharRelationships(cid)
          .filter((r) => chat.characterIds.includes(r.otherId))
          .map((r) => ({ ...r, otherName: getCharacter(r.otherId)?.name ?? "?" })),
      ])
    ),
  });
});

/** Everything else — mode, characterIds, storyId/sceneId/locationId, language, pov — is fixed at creation. */
const MUTABLE_CHAT_FIELDS = [
  "title",
  "folder",
  "tags",
  "modelId",
  "charModels",
  "narratorEnabled",
  "lorebookIds",
  "personaId",
  "overrides",
] as const;

export const PATCH = handler(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  if (!getChat(id)) return bad("Chat not found", 404);
  const body = await req.json();
  const patch: Record<string, unknown> = {};
  for (const k of MUTABLE_CHAT_FIELDS) if (k in body) patch[k] = body[k];
  return ok(saveChat({ ...patch, id }));
});

export const DELETE = handler(async (_req: Request, { params }: IdParams) => {
  deleteChat((await params).id);
  return ok({ ok: true });
});
