import { createContext } from "react";
import type { Roster } from "@/lib/api";

export type ProjectPageValue = { person: Roster; folderId: string; folderName?: string };
export const PageContext = createContext<ProjectPageValue | null>(null);
