import { bad, handler, ok, type IdParams } from "@/lib/api";
import { computeStage, resolveStageAssets } from "@/lib/ai/prompts";
import { appendMessage, getChat, getScene, getStory, listMessages } from "@/lib/store";

/** Append a user message or a manual scene/location switch marker. */
export const POST = handler(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const chat = getChat(id);
  if (!chat) return bad("Chat not found", 404);
  const b = await req.json();

  if (b.role === "marker") {
    if (!b.sceneEvent?.kind) return bad("sceneEvent required for marker");
    const ev = b.sceneEvent;
    // mode rules: scene switching exists only in story mode, within the story's scenes
    if (ev.kind !== "scene") return bad("Locations are fixed for this chat mode");
    if (chat.mode !== "story" || !chat.storyId) return bad("Scene switching is only available in story mode");
    const story = getStory(chat.storyId);
    if (!story?.sceneIds.includes(ev.sceneId)) return bad("Scene is not part of this chat's story");
    if (ev.locationId === undefined) {
      ev.locationId = getScene(ev.sceneId)?.locationId ?? null;
    }
    const msg = appendMessage({ chatId: id, role: "marker", content: "", sceneEvent: ev });
    const stage = computeStage(chat, listMessages(id));
    return ok({ message: msg, stage: { ...stage, ...resolveStageAssets(stage) } });
  }

  if (typeof b.content !== "string" || !b.content.trim()) return bad("content required");
  const msg = appendMessage({ chatId: id, role: "user", content: b.content.trim() });
  return ok({ message: msg });
});
