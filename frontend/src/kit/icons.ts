import {
  MessageCircle,
  Send,
  LogOut,
  User,
  Users,
  Loader2,
  HelpCircle,
  Settings,
  Brain,
  Archive,
  CheckCircle2,
  ChevronDown,
  AlertTriangle,
  Volume2,
  type LucideIcon,
} from "lucide-react";

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
  users: Users,
  loader: Loader2,
  settings: Settings,
  brain: Brain,
  archive: Archive,
  check: CheckCircle2,
  "chevron-down": ChevronDown,
  "alert-triangle": AlertTriangle,
  "volume-2": Volume2,
};

export function getIcon(name: string): LucideIcon {
  return REGISTRY[name] ?? HelpCircle;
}
