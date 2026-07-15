import { bad, handler, ok, type IdParams } from "@/lib/api";
import { itemRoutes } from "@/lib/entityRoutes";
import { deleteStory, getCharacter, getLorebook, getScene, getStory, saveStory } from "@/lib/store";

export const { PUT, DELETE } = itemRoutes(getStory, saveStory, deleteStory);

/** Story plus resolved cast/scene name refs, so pickers don't need the full lists. */
export const GET = handler(async (_req: Request, { params }: IdParams) => {
  const story = getStory((await params).id);
  if (!story) return bad("not found", 404);
  return ok({
    ...story,
    castRefs: story.characterIds.map((id) => ({ id, name: getCharacter(id)?.name ?? "?" })),
    sceneRefs: story.scenes.map((e) => ({ id: e.sceneId, name: getScene(e.sceneId)?.name ?? "?" })),
    lorebookRefs: story.lorebookIds.map((id) => ({ id, name: getLorebook(id)?.name ?? "?" })),
  });
});
