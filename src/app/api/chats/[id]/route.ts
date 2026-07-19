import { bad, handler, ok, type IdParams } from "@/lib/api";
import { buildContext, resolveStageAssets } from "@/lib/ai/prompts";
import { deleteChat, getChat, getDirectorRead, getScene, saveChat } from "@/lib/store";

export const GET = handler(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  const chat = await getChat(id);
  if (!chat) return bad("Chat not found", 404);
  const ctx = await buildContext(id);
  const stage = ctx.stage;
  // every scene id referenced by a stage event, resolved to a name (snapshot first,
  // then the library) — so the client never needs the scene list
  const sceneNameEntries: [string, string][] = [];
  for (const sid of [...new Set(ctx.messages.flatMap((m) => (m.sceneEvent?.sceneId ? [m.sceneEvent.sceneId] : [])))]) {
    const name = ctx.snapshot?.scenes.find((s) => s.id === sid)?.name ?? (await getScene(sid))?.name;
    if (name) sceneNameEntries.push([sid, name]);
  }
  return ok({
    chat,
    // bodies are paged separately (GET ./messages); this payload carries the sparse
    // whole-timeline projections the client folds — events and emotions, no prose
    messageCounts: {
      total: ctx.messages.length,
      timeline: ctx.messages.filter((m) => m.role !== "marker").length,
    },
    stageEvents: ctx.messages.flatMap((m) =>
      m.sceneEvent ? [{ id: m.id, position: m.position, sceneEvent: m.sceneEvent }] : []
    ),
    emotions: ctx.messages.flatMap((m) =>
      m.role === "character" && m.characterId
        ? [{ position: m.position, characterId: m.characterId, emotion: m.variants[m.activeVariant]?.emotion ?? null }]
        : []
    ),
    stage: { ...stage, ...(await resolveStageAssets(chat, stage)) },
    characters: ctx.characters,
    persona: ctx.persona,
    playedCharacter: ctx.playedCharacter,
    storyName: ctx.snapshot?.name ?? null,
    storyScenes: ctx.snapshot?.scenes ?? [],
    sceneNames: Object.fromEntries(sceneNameEntries),
    ended: ctx.ended,
    // the director's latest read of the current scene's exit condition (story mode;
    // null until a routed turn produces one, or after a scene change resets it)
    exitRead: ctx.snapshot && !ctx.ended ? await getDirectorRead(id, stage.sceneId) : null,
  });
});

/** Everything else — mode, characters, persona, story/scene/location, lorebooks,
 *  narrator, language, pov — is fixed at creation. The model stays editable: it's a
 *  cost/infrastructure knob, not fiction state. */
const MUTABLE_CHAT_FIELDS = ["title", "folder", "tags", "modelId", "charModels", "overrides"] as const;

export const PATCH = handler(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  if (!(await getChat(id))) return bad("Chat not found", 404);
  const body = await req.json();
  const patch: Record<string, unknown> = {};
  for (const k of MUTABLE_CHAT_FIELDS) if (k in body) patch[k] = body[k];
  return ok(await saveChat({ ...patch, id }));
});

export const DELETE = handler(async (_req: Request, { params }: IdParams) => {
  await deleteChat((await params).id);
  return ok({ ok: true });
});
