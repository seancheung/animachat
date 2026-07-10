import { collectionRoutes } from "@/lib/entityRoutes";
import { listPersonas, savePersona } from "@/lib/store";

export const { GET, POST } = collectionRoutes(listPersonas, savePersona);
