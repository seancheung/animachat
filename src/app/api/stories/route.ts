import { collectionRoutes } from "@/lib/entityRoutes";
import { listStories, saveStory } from "@/lib/store";

export const { GET, POST } = collectionRoutes(listStories, saveStory);
