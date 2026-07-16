import { itemRoutes } from "@/lib/entityRoutes";
import { deleteStory, getStory, saveStory } from "@/lib/store";

// GET returns the full self-contained document (embedded cast/scenes/locations/
// lorebooks); stories reference nothing and are referenced by nothing, so
// deletion never blocks — playthroughs run on their own snapshots
export const { GET, PUT, DELETE } = itemRoutes(getStory, saveStory, deleteStory);
