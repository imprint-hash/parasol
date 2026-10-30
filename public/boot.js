// Runs before first paint (plain script, not a module) so the saved theme,
// low-vision mode and text size apply without a flash. a11y.js takes over after.
(function () {
  var p = {};
  try { p = (JSON.parse(localStorage.getItem("parasol.v1")) || {}).prefs || {}; } catch (e) {}
  var d = document.documentElement;
  var mq = function (q) { return window.matchMedia && window.matchMedia(q).matches; };
  var dark = p.theme === "dark-gentle" || (p.theme !== "light" && mq("(prefers-color-scheme: dark)"));
  d.setAttribute("data-theme", dark ? "dark" : "light");
  var lv = p.lowVision === true || (p.lowVision == null && mq("(prefers-contrast: more)"));
  if (lv) d.setAttribute("data-lv", "1");
  var s = Number(p.textScale);
  if (s >= 1 && s <= 2) d.style.fontSize = s * 100 + "%";
})();
