import { collectionRoutes } from "@/lib/entityRoutes";
import { listCharacters, saveCharacter } from "@/lib/store";

export const { GET, POST } = collectionRoutes(listCharacters, saveCharacter);
