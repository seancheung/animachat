import { bad, handler, ok } from "@/lib/api";
import { manuscriptToStoryDraft, storyToManuscriptDraft } from "@/lib/studioAdapt";
import { getManuscript, getStory, saveManuscript, saveStory } from "@/lib/store";

export const POST = handler(async (req: Request) => {
  const body = await req.json();
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return bad("project id required");

  if (body.sourceType === "story") {
    const source = await getStory(id);
    if (!source) return bad("interactive story not found", 404);
    const manuscript = await saveManuscript(storyToManuscriptDraft(source));
    return ok({ type: "manuscript", id: manuscript.id });
  }

  if (body.sourceType === "manuscript") {
    const source = await getManuscript(id);
    if (!source) return bad("manuscript not found", 404);
    const story = await saveStory(manuscriptToStoryDraft(source));
    return ok({ type: "story", id: story.id });
  }

  return bad("sourceType must be story or manuscript");
});
