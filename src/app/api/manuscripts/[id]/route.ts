import { itemRoutes } from "@/lib/entityRoutes";
import { deleteManuscript, getManuscript, saveManuscript } from "@/lib/store";

export const { GET, PUT, DELETE } = itemRoutes(getManuscript, saveManuscript, deleteManuscript);
