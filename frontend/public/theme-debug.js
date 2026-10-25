// A read-only report of how this browser resolves light and dark, for diagnosing a page that paints half dark. Nothing is sent anywhere.
var rows = [];
function add(name, value) { rows.push(name + ": " + value); }
try { add("prefers-color-scheme dark", matchMedia("(prefers-color-scheme: dark)").matches); } catch (e) { add("prefers-color-scheme", "error"); }
try { add("saved palette", localStorage.getItem("maipai.shell.palette")); add("saved theme", localStorage.getItem("vite-ui-theme")); add("device appearance", localStorage.getItem("maipai.ui.appearance.device")); } catch (e) { add("storage", "blocked"); }
add("user agent", navigator.userAgent);
add("viewport", innerWidth + "x" + innerHeight);
document.getElementById("out").textContent = rows.join("\n") + "\n\nOpen the app in another tab, then reload this page to see the class the app set.";
try {
  var frame = document.createElement("iframe");
  frame.src = "/";
  frame.style.cssText = "width:1px;height:1px;border:0;position:absolute;left:-10px";
  frame.onload = function () {
    setTimeout(function () {
      try {
        var d = frame.contentDocument, root = d.documentElement, cs = function (el, v) { return frame.contentWindow.getComputedStyle(el).getPropertyValue(v).trim(); };
        var more = ["", "app html class: " + root.className, "app body class: " + d.body.className,
          "--page: " + cs(root, "--page"), "--background: " + cs(d.body, "--background"), "--foreground: " + cs(d.body, "--foreground"), "--card: " + cs(d.body, "--card"),
          "body background: " + frame.contentWindow.getComputedStyle(d.body).backgroundColor, "body color: " + frame.contentWindow.getComputedStyle(d.body).color];
        document.getElementById("out").textContent += "\n" + more.join("\n");
      } catch (e) { document.getElementById("out").textContent += "\n(the app frame could not be read)"; }
    }, 2500);
  };
  document.body.appendChild(frame);
} catch (e) { /* the saved values above still show */ }
