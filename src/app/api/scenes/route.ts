import { collectionRoutes } from "@/lib/entityRoutes";
import { listScenes, saveScene } from "@/lib/store";

export const { GET, POST } = collectionRoutes(listScenes, saveScene);
