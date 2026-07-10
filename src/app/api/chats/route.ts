import { handler, ok } from "@/lib/api";
import { appendMessage, getCharacter, listChats, listMessages, saveChat } from "@/lib/store";

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
  const chat = saveChat({
    title: b.title || "New chat",
    characterIds: b.characterIds ?? [],
    personaId: b.personaId ?? null,
    storyId: b.storyId ?? null,
    sceneId: b.sceneId ?? null,
    locationId: b.locationId ?? null,
    lorebookIds: b.lorebookIds ?? [],
    narratorEnabled: !!b.narratorEnabled,
    language: b.language ?? "",
    pov: b.pov ?? "",
    modelId: b.modelId ?? null,
    charModels: b.charModels ?? {},
    folder: b.folder ?? "",
    tags: b.tags ?? [],
  });
  // greetings open the chat
  for (const cid of chat.characterIds) {
    const c = getCharacter(cid);
    if (c?.greeting) {
      appendMessage({
        chatId: chat.id,
        role: "character",
        characterId: cid,
        content: c.greeting,
        emotion: "neutral",
      });
    }
  }
  return ok(chat);
});
