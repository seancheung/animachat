import { collectionRoutes } from "@/lib/entityRoutes";
import { pageFictions, saveFiction } from "@/lib/store";

export const { GET, POST } = collectionRoutes(pageFictions, saveFiction);
