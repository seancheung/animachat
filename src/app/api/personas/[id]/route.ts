import { itemRoutes } from "@/lib/entityRoutes";
import { deletePersona, getPersona, savePersona } from "@/lib/store";

export const { GET, PUT, DELETE } = itemRoutes(getPersona, savePersona, deletePersona);
