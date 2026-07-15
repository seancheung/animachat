import { bad, handler, ok, type IdParams } from "@/lib/api";
import { buildContext, computeStage, resolveStageAssets } from "@/lib/ai/prompts";
import {
  deleteChat,
  getChat,
  getCharacter,
  getCharRelationship,
  getRelationship,
  getScene,
  listCharRelationships,
  saveChat,
} from "@/lib/store";

export const GET = handler(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  const chat = getChat(id);
  if (!chat) return bad("Chat not found", 404);
  const ctx = buildContext(id);
  const stage = ctx.stage;
  return ok({
    chat,
    messages: ctx.messages,
    stage: { ...stage, ...resolveStageAssets(chat, stage) },
    characters: ctx.characters,
    persona: ctx.persona,
    playedCharacter: ctx.playedCharacter,
    storyName: ctx.snapshot?.name ?? null,
    storyScenes: ctx.snapshot?.scenes.map(({ scene }) => scene) ?? [],
    // every scene id referenced by a stage event, resolved to a name (snapshot first,
    // then the library) — so the client never needs the scene list
    sceneNames: Object.fromEntries(
      [...new Set(ctx.messages.flatMap((m) => (m.sceneEvent?.sceneId ? [m.sceneEvent.sceneId] : [])))].flatMap(
        (sid) => {
          const name =
            ctx.snapshot?.scenes.find(({ scene }) => scene.id === sid)?.scene.name ?? getScene(sid)?.name;
          return name ? [[sid, name]] : [];
        }
      )
    ),
    ended: ctx.ended,
    // the user side: persona↔character, or the played character's char↔char pairs
    relationships: Object.fromEntries(
      chat.characterIds
        .map((cid) => [
          cid,
          chat.personaCharacterId
            ? getCharRelationship(cid, chat.personaCharacterId)
            : chat.personaId
              ? getRelationship(cid, chat.personaId)
              : null,
        ] as const)
        .filter(([, r]) => r)
    ),
    // each chat character's view of the other chat characters
    charRelationships: Object.fromEntries(
      chat.characterIds.map((cid) => [
        cid,
        listCharRelationships(cid)
          .filter((r) => chat.characterIds.includes(r.otherId))
          .map((r) => ({ ...r, otherName: getCharacter(r.otherId)?.name ?? chat.nameSnapshots[r.otherId] ?? "?" })),
      ])
    ),
  });
});

/** Everything else — mode, characters, persona, story/scene/location, lorebooks,
 *  narrator, language, pov — is fixed at creation. The model stays editable: it's a
 *  cost/infrastructure knob, not fiction state. */
const MUTABLE_CHAT_FIELDS = ["title", "folder", "tags", "modelId", "charModels", "overrides"] as const;

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
