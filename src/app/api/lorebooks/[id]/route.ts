import { itemRoutes } from "@/lib/entityRoutes";
import { deleteLorebook, getLorebook, saveLorebook } from "@/lib/store";

export const { GET, PUT, DELETE } = itemRoutes(getLorebook, saveLorebook, deleteLorebook);
