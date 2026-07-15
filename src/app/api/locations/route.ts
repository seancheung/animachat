import { collectionRoutes } from "@/lib/entityRoutes";
import { pageLocations, saveLocation } from "@/lib/store";

export const { GET, POST } = collectionRoutes(pageLocations, saveLocation);
