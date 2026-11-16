/* 启动入口：必须放在所有模块之后 */
(function () {
  var started = false;
  function start() {
    if (started) return;
    started = true;
    G.Game.init();
  }
  // Wait briefly for the bundled GLB renderer. file:// still falls back to the
  // original renderer, because browsers block ES modules from local files.
  window.addEventListener('hospital-renderer-ready', start, { once: true });
  window.setTimeout(start, 1800);
})();
