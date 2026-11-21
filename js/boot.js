/* 启动入口：必须放在所有模块之后 */
(function () {
  var started = false;
  function start() {
    if (started) return;
    started = true;
    G.Game.init();
  }
  // 加载遮罩：模型全部就绪或超时后淡出（file:// 下 ESM 被拦截，永远等不到事件，靠超时兜底）
  var loadingDone = false;
  function hideLoading() {
    if (loadingDone) return;
    loadingDone = true;
    var el = document.getElementById('loading');
    if (!el) return;
    el.style.transition = 'opacity .5s';
    el.style.opacity = '0';
    window.setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 550);
  }
  window.addEventListener('hospital-models-ready', hideLoading, { once: true });
  window.setTimeout(hideLoading, 3000);

  // Wait briefly for the bundled GLB renderer. file:// still falls back to the
  // original renderer, because browsers block ES modules from local files.
  window.addEventListener('hospital-renderer-ready', start, { once: true });
  window.setTimeout(start, 1800);
})();
