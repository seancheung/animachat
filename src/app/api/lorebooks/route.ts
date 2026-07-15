import { collectionRoutes } from "@/lib/entityRoutes";
import { pageLorebooks, saveLorebook } from "@/lib/store";

export const { GET, POST } = collectionRoutes(pageLorebooks, saveLorebook);
