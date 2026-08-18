import { itemRoutes } from "@/lib/entityRoutes";
import { deleteFiction, getFiction, saveFiction } from "@/lib/store";

export const { GET, PUT, DELETE } = itemRoutes(getFiction, saveFiction, deleteFiction);
