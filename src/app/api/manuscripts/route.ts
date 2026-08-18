import { collectionRoutes } from "@/lib/entityRoutes";
import { pageManuscripts, saveManuscript } from "@/lib/store";

export const { GET, POST } = collectionRoutes(pageManuscripts, saveManuscript);
