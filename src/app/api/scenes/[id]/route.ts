import { itemRoutes } from "@/lib/entityRoutes";
import { deleteScene, getScene, saveScene } from "@/lib/store";

// nothing authored references library scenes anymore (stories embed copies) —
// deletion never blocks
export const { GET, PUT, DELETE } = itemRoutes(getScene, saveScene, deleteScene);
