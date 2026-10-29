import { Tabs, TabsList, TabsTrigger } from "@maipai/ui/src/ui/tabs";
import { useNavigate } from "react-router-dom";

/** The Lists | Coming up switch, one definition for both Reminders pages. */
export function RemindersTabs({ value }: { value: "lists" | "coming-up" }) {
  const navigate = useNavigate();
  const go = (next: string) => {
    if (next !== value) navigate(next === "lists" ? "/reminders" : "/reminders/coming-up");
  };
  return (
    <nav aria-label="Reminders sections" className="px-4 py-2">
      <Tabs value={value} onValueChange={go}>
        <TabsList>
          <TabsTrigger value="lists" onClick={() => go("lists")}>Lists</TabsTrigger>
          <TabsTrigger value="coming-up" onClick={() => go("coming-up")}>Coming up</TabsTrigger>
        </TabsList>
      </Tabs>
    </nav>
  );
}
