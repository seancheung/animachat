import { collectionRoutes } from "@/lib/entityRoutes";
import { listLocations, saveLocation } from "@/lib/store";

export const { GET, POST } = collectionRoutes(listLocations, saveLocation);
