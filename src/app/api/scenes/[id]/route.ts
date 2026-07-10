import { itemRoutes } from "@/lib/entityRoutes";
import { deleteScene, getScene, saveScene } from "@/lib/store";

export const { GET, PUT, DELETE } = itemRoutes(getScene, saveScene, deleteScene);
