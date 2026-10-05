import { useState } from "react";
import { useAui } from "@assistant-ui/react";
import { useQuery } from "@tanstack/react-query";
import { ToolError } from "@maipai/ui/src/elements/tool-error";
import { api, type TurnErrorDetail } from "@/lib/api";

/** Admin only: this component is mounted only for an admin's failed tool call. */
export function AdminToolError({ turnId }: { turnId: string }) {
  const aui = useAui();
  const [retrying, setRetrying] = useState(false);
  const query = useQuery<TurnErrorDetail>({
    queryKey: ["turn-error-detail", turnId],
    queryFn: () => api.turnErrorDetail(turnId),
  });

  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      await aui.message().reload();
    } finally {
      setRetrying(false);
    }
  };

  if (query.isLoading) return <p className="text-muted-foreground text-base">Reading tool details…</p>;
  if (query.isError || !query.data) return <p className="text-muted-foreground text-base">Tool details could not be read.</p>;
  if (!Array.isArray(query.data.tools) || query.data.tools.length === 0) return null;

  return (
    <div className="flex w-full flex-col gap-2">
      {query.data.tools.map((tool) => (
        <ToolError
          key={tool.call_id}
          name={tool.tool_id}
          target={tool.kind}
          message={tool.error_text ?? tool.kind}
          attempt={1}
          maxAttempts={1}
          retrying={retrying}
          onRetry={retry}
        />
      ))}
    </div>
  );
}
