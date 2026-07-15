import { collectionRoutes } from "@/lib/entityRoutes";
import { pageStories, saveStory } from "@/lib/store";

export const { GET, POST } = collectionRoutes(pageStories, saveStory);
