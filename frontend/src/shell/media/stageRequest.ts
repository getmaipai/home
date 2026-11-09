// NOW-PLAYING-01: the kit's Now Playing asks its host to open the Up next list (`MediaHost.openQueue`). The host lives above the page and
// the full-screen stage lives in the Music page's player section, so the ask crosses through this one small store: the host calls
// `requestStage("queue")`, the section sees the new number and opens the stage on that view. Nothing is kept between page visits.
import { useSyncExternalStore } from "react";

export type StageView = "scene" | "lyrics" | "queue";
export interface StageRequest { seq: number; view: StageView }

let request: StageRequest = { seq: 0, view: "scene" };
const listeners = new Set<() => void>();

export const getStageRequest = (): StageRequest => request;
export function requestStage(view: StageView): void {
  request = { seq: request.seq + 1, view };
  listeners.forEach((listener) => listener());
}
export function useStageRequest(): StageRequest {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, getStageRequest, getStageRequest);
}
