import { MessageCircle, Send, LogOut, User, Loader2, HelpCircle, Settings, type LucideIcon } from "lucide-react";

// docs/UI.md: "Icons: lucide only, by name... no other icon set." The kit
// owns the name -> component registry so app code (and, later, JSON page
// data) references an icon by its lucide kebab-case name and never
// imports lucide-react directly. Grows as pages need more; nothing here
// is speculative.
const REGISTRY: Record<string, LucideIcon> = {
  "message-circle": MessageCircle,
  send: Send,
  "log-out": LogOut,
  user: User,
  loader: Loader2,
  settings: Settings,
};

export function getIcon(name: string): LucideIcon {
  return REGISTRY[name] ?? HelpCircle;
}
