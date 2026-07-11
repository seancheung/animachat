import { itemRoutes } from "@/lib/entityRoutes";
import { deleteCharacter, getCharacter, libraryReferences, saveCharacter } from "@/lib/store";

export const { GET, PUT, DELETE } = itemRoutes(getCharacter, saveCharacter, deleteCharacter, (id) =>
  libraryReferences("character", id)
);
