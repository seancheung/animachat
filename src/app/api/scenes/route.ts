import { collectionRoutes } from "@/lib/entityRoutes";
import { pageScenes, saveScene } from "@/lib/store";

export const { GET, POST } = collectionRoutes(pageScenes, saveScene);
