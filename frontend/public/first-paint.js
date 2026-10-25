// Runs before the first paint (the page CSP blocks inline scripts, so this is a same-origin file). It sets the light or dark
// class from the saved choice, else the device, so the kit's page color and the look's colors never disagree on first paint.
try {
  var root = document.documentElement;
  var saved = JSON.parse(localStorage.getItem("maipai.shell.palette") || "null");
  var dark = saved && typeof saved.dark === "boolean" ? saved.dark : matchMedia("(prefers-color-scheme: dark)").matches;
  root.classList.add(dark ? "dark" : "light");
} catch { /* main.tsx sets the class again */ }
