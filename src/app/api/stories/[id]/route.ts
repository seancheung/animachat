import { itemRoutes } from "@/lib/entityRoutes";
import { deleteStory, getStory, saveStory } from "@/lib/store";

export const { GET, PUT, DELETE } = itemRoutes(getStory, saveStory, deleteStory);
