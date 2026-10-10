import { useNavigate } from "react-router-dom";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import { useTabItem } from "@/shell/tabIdentity";

/** Any signed-in address no route matches, including old /next bookmarks. */
export function NotFoundPage() {
  useTabItem("Page not found");
  const navigate = useNavigate();
  return (
    <EmptyState
      icon="inbox"
      text="That page does not exist. The link may be old or mistyped. Go to Home and pick it from the menu."
      actionLabel="Go to Home"
      onAction={() => navigate("/")}
    />
  );
}
