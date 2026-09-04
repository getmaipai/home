import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { SignIn } from "@/shell/SignIn";
import { Shell } from "@/shell/Shell";
import { ChatPage } from "@/apps/chat/ChatPage";
import { SettingsPage } from "@/apps/settings/SettingsPage";
import { Progress } from "@/kit/primitives/Progress";
import { api, type Roster } from "@/lib/api";

// Sign-in gate -> shell -> routed pages. A router (react-router-dom)
// landed with the Settings page, the second page to exist tonight -
// docs/UI.md's "don't invent ahead of need" is why it wasn't added for
// Chat alone.
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
    <BrowserRouter>
      <Shell person={person} onSignOut={() => api.logout().finally(() => setPerson(null))}>
        <Routes>
          <Route path="/" element={<ChatPage person={person} />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </Shell>
    </BrowserRouter>
  );
}
