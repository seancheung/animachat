import { handler, ok, pageOpts } from "@/lib/api";
import { pageStories, saveStory } from "@/lib/store";
import type { Story } from "@/lib/types";

/** Grid-row projection: a story document embeds full sheets and can be large, so
 *  the list serves counts, cast names, and a cover asset instead of the document
 *  (the editor page fetches the whole thing via /api/stories/[id]). */
function storyListItem(s: Story) {
  const first = s.scenes[0];
  const firstLocation = first?.locationId ? s.locations.find((l) => l.id === first.locationId) : null;
  const lead = s.characters[0];
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    destination: s.destination,
    tags: s.tags,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    castCount: s.characters.length,
    sceneCount: s.scenes.length,
    castNames: s.characters.map((c) => c.name),
    // cover: the opening scene's artwork (location precedence, like the stage),
    // else the lead character's sprite/avatar
    coverAsset:
      firstLocation?.artworkAsset ??
      first?.artworkAsset ??
      lead?.sprites?.neutral ??
      lead?.avatarAsset ??
      null,
  };
}

export const GET = handler((req: Request) => {
  const page = pageStories(pageOpts(req));
  return ok({ items: page.items.map(storyListItem), nextCursor: page.nextCursor });
});

export const POST = handler(async (req: Request) => {
  const body = await req.json();
  delete body.id; // creation never trusts a client id
  return ok(saveStory(body));
});
