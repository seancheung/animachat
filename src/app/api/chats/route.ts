import { bad, handler, ok } from "@/lib/api";
import { substitutePlaceholders } from "@/lib/ai/placeholders";
import {
  appendMessage,
  getCharacter,
  getLocation,
  getPersona,
  getScene,
  getStory,
  listChats,
  listMessages,
  saveChat,
} from "@/lib/store";
import type { ChatMode } from "@/lib/types";

export const GET = handler(() => {
  const chats = listChats().map((c) => {
    const msgs = listMessages(c.id);
    const last = [...msgs].reverse().find((m) => m.role !== "marker");
    return {
      ...c,
      messageCount: msgs.length,
      lastMessage: last ? (last.variants[last.activeVariant]?.content ?? "").slice(0, 120) : "",
      characterNames: c.characterIds.map((id) => getCharacter(id)?.name ?? "?"),
    };
  });
  return ok(chats);
});

export const POST = handler(async (req: Request) => {
  const b = await req.json();
  const mode: ChatMode = ["story", "scene", "location", "casual"].includes(b.mode) ? b.mode : "casual";

  // mode rules: story = story required (+ optional starting scene from it);
  // scene = one fixed scene; location = one fixed location; casual = none.
  let storyId: string | null = null;
  let sceneId: string | null = null;
  let locationId: string | null = null;
  if (mode === "story") {
    const story = b.storyId ? getStory(b.storyId) : null;
    if (!story) return bad("Story mode requires a story");
    storyId = story.id;
    if (b.sceneId) {
      if (!story.sceneIds.includes(b.sceneId)) return bad("Starting scene must belong to the story");
      sceneId = b.sceneId;
    }
  } else if (mode === "scene") {
    if (!b.sceneId || !getScene(b.sceneId)) return bad("Scene mode requires a scene");
    sceneId = b.sceneId;
  } else if (mode === "location") {
    if (!b.locationId || !getLocation(b.locationId)) return bad("Location mode requires a location");
    locationId = b.locationId;
  }

  const chat = saveChat({
    title: b.title || "New chat",
    mode,
    characterIds: b.characterIds ?? [],
    personaId: b.personaId ?? null,
    storyId,
    sceneId,
    locationId,
    lorebookIds: b.lorebookIds ?? [],
    narratorEnabled: !!b.narratorEnabled,
    language: b.language ?? "",
    pov: b.pov ?? "",
    modelId: b.modelId ?? null,
    charModels: b.charModels ?? {},
    folder: b.folder ?? "",
    tags: b.tags ?? [],
  });

  // greetings can be disabled at creation so the user speaks first (default on)
  if (b.greetings === false) return ok(chat);

  // initial stage values for greeting placeholder substitution
  const persona = chat.personaId ? getPersona(chat.personaId) : null;
  const story = storyId ? getStory(storyId) : null;
  const startScene = sceneId ? getScene(sceneId) : story?.sceneIds[0] ? getScene(story.sceneIds[0]) : null;
  const startLocation = locationId
    ? getLocation(locationId)
    : startScene?.locationId
      ? getLocation(startScene.locationId)
      : null;
  const characterNames = chat.characterIds.map((id) => getCharacter(id)?.name ?? "?");

  for (const cid of chat.characterIds) {
    const c = getCharacter(cid);
    if (c?.greeting) {
      appendMessage({
        chatId: chat.id,
        role: "character",
        characterId: cid,
        content: substitutePlaceholders(c.greeting, {
          characterNames,
          userName: persona?.name,
          locationName: startLocation?.name,
          sceneName: startScene?.name,
          storyName: story?.name,
        }),
        emotion: "neutral",
      });
    }
  }
  return ok(chat);
});
