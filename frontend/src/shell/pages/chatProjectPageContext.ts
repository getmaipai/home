import { createContext } from "react";
import type { Roster } from "@/lib/api";

export type ProjectPageValue = { person: Roster; folderId: string };
export const PageContext = createContext<ProjectPageValue | null>(null);
