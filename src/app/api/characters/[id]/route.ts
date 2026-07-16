import { itemRoutes } from "@/lib/entityRoutes";
import { deleteCharacter, getCharacter, saveCharacter } from "@/lib/store";

// nothing authored references library characters anymore (stories embed copies) —
// deletion never blocks; chats degrade fail-soft via nameSnapshots
export const { GET, PUT, DELETE } = itemRoutes(getCharacter, saveCharacter, deleteCharacter);
