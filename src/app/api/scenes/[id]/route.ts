import { itemRoutes } from "@/lib/entityRoutes";
import { deleteScene, getScene, libraryReferences, saveScene } from "@/lib/store";

export const { GET, PUT, DELETE } = itemRoutes(getScene, saveScene, deleteScene, (id) =>
  libraryReferences("scene", id)
);
