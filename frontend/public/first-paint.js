// Runs before the first paint (the page CSP blocks inline scripts, so this is a same-origin file). It sets the light or dark
// class from the saved choice, else the device, so the kit's page color and the look's colors never disagree on first paint.
try {
  var root = document.documentElement;
  var saved = JSON.parse(localStorage.getItem("maipai.shell.palette") || "null");
  var dark = saved && typeof saved.dark === "boolean" ? saved.dark : matchMedia("(prefers-color-scheme: dark)").matches;
  root.classList.add(dark ? "dark" : "light");
} catch { /* main.tsx sets the class again */ }
// Ask who is signed in now, while the app's code is still downloading, instead of after it has run. api.me() takes this answer once
// (src/lib/earlyMe.ts); any miss, error or old answer falls back to the normal request. Same-origin, cookie only: nothing new is sent.
try {
  if (location.pathname.indexOf("/setup") !== 0) {
    window.__maipaiEarlyMe = { at: Date.now(), answer: fetch("/api/auth/me", { credentials: "include", headers: { "content-type": "application/json" } }).then(function (res) { return res.ok ? res.json() : null; }).catch(function () { return null; }) };
  }
} catch { /* api.me() asks again */ }
