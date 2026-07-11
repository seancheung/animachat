import { itemRoutes } from "@/lib/entityRoutes";
import { deleteLorebook, getLorebook, libraryReferences, saveLorebook } from "@/lib/store";

export const { GET, PUT, DELETE } = itemRoutes(getLorebook, saveLorebook, deleteLorebook, (id) =>
  libraryReferences("lorebook", id)
);
