import { useEffect, useState } from "react";
import { SignIn } from "@/shell/SignIn";
import { Shell } from "@/shell/Shell";
import { ChatPage } from "@/apps/chat/ChatPage";
import { Progress } from "@/kit/primitives/Progress";
import { api, type Roster } from "@/lib/api";

// Sign-in gate -> shell -> Chat, the one page that exists. No router
// installed yet: with exactly one destination there is nothing to route
// between, and docs/UI.md's "don't invent ahead of need" applies to
// routing too - add one (react-router-dom) the moment a second page does.
export function App() {
  const [person, setPerson] = useState<Roster | null | undefined>(undefined);

  useEffect(() => {
    api
      .me()
      .then(setPerson)
      .catch(() => setPerson(null));
  }, []);

  if (person === undefined) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Progress mode="spinner" label="Loading MaiPai Home" />
      </div>
    );
  }

  if (person === null) {
    return <SignIn onSignedIn={() => api.me().then(setPerson).catch(() => setPerson(null))} />;
  }

  return (
    <Shell person={person} onSignOut={() => api.logout().finally(() => setPerson(null))}>
      <ChatPage person={person} />
    </Shell>
  );
}
