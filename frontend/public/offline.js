// The offline page's one job: while Home restarts or updates, ask it every
// few seconds (3 s, easing to 10 s) and reload the moment it answers. Any
// HTTP answer counts, a 401 included. The reload is a navigation, which the
// service worker serves network-first, so the new build loads after an update.
(function () {
  var attempt = 0;
  function ask() {
    fetch("/api/health", { cache: "no-store" }).then(function () {
      window.location.reload();
    }, function () {
      attempt += 1;
      setTimeout(ask, attempt < 5 ? 3000 : attempt < 10 ? 5000 : 10000);
    });
  }
  setTimeout(ask, 3000);
})();
