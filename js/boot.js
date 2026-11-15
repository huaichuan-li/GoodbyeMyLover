/* 启动入口：必须放在所有模块之后 */
(function () {
  function start() { G.Game.init(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
