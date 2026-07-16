import { itemRoutes } from "@/lib/entityRoutes";
import { deleteLorebook, getLorebook, saveLorebook } from "@/lib/store";

// nothing authored references library lorebooks anymore (stories embed copies) —
// deletion never blocks
export const { GET, PUT, DELETE } = itemRoutes(getLorebook, saveLorebook, deleteLorebook);
