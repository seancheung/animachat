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
  });
});

export const PATCH = handler(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  if (!getChat(id)) return bad("Chat not found", 404);
  const body = await req.json();
  return ok(saveChat({ ...body, id }));
});

export const DELETE = handler(async (_req: Request, { params }: IdParams) => {
  deleteChat((await params).id);
  return ok({ ok: true });
});
