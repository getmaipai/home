import { createContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type HealthStatus } from "@/lib/api";
import { chatAvailability } from "@/apps/chat/chatAvailability";

export const ChatAvailabilityContext = createContext<"ready" | "starting" | "unavailable">("ready");

export function useChatAvailability() {
  const query = useQuery<HealthStatus>({
    queryKey: ["health"],
    queryFn: () => api.health(),
    retry: false,
    refetchInterval: (current) => chatAvailability(current.state.data?.engines?.chat) === "unavailable" ? 5_000 : 15_000,
  });
  return chatAvailability(query.data?.engines?.chat);
}
