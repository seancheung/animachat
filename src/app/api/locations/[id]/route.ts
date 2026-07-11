import { itemRoutes } from "@/lib/entityRoutes";
import { deleteLocation, getLocation, libraryReferences, saveLocation } from "@/lib/store";

export const { GET, PUT, DELETE } = itemRoutes(getLocation, saveLocation, deleteLocation, (id) =>
  libraryReferences("location", id)
);
