import { collectionRoutes } from "@/lib/entityRoutes";
import { listLorebooks, saveLorebook } from "@/lib/store";

export const { GET, POST } = collectionRoutes(listLorebooks, saveLorebook);
