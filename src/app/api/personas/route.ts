import { collectionRoutes } from "@/lib/entityRoutes";
import { pagePersonas, savePersona } from "@/lib/store";

export const { GET, POST } = collectionRoutes(pagePersonas, savePersona);
