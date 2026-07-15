import { collectionRoutes } from "@/lib/entityRoutes";
import { pageCharacters, saveCharacter } from "@/lib/store";

export const { GET, POST } = collectionRoutes(pageCharacters, saveCharacter);
