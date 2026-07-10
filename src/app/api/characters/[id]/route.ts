import { itemRoutes } from "@/lib/entityRoutes";
import { deleteCharacter, getCharacter, saveCharacter } from "@/lib/store";

export const { GET, PUT, DELETE } = itemRoutes(getCharacter, saveCharacter, deleteCharacter);
