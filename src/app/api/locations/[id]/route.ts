import { itemRoutes } from "@/lib/entityRoutes";
import { deleteLocation, getLocation, saveLocation } from "@/lib/store";

export const { GET, PUT, DELETE } = itemRoutes(getLocation, saveLocation, deleteLocation);
