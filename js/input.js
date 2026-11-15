/* 键位表 + 输入缓冲环（按键带时间戳，QTE 判定与帧率解耦） */
(function () {
  var G = window.G = window.G || {};
  var C = G.DATA.config;

  var MAP = {
    KeyW: 'p1', KeyA: 'p1', KeyS: 'p1', KeyD: 'p1',
    KeyQ: 'p1', KeyF: 'p1', Space: 'p1', ShiftLeft: 'p1', KeyR: 'p1',
    ArrowUp: 'p2', ArrowDown: 'p2', ArrowLeft: 'p2', ArrowRight: 'p2',
    KeyE: 'p2', Enter: 'p2', ShiftRight: 'p2',
    Tab: 'sys', KeyV: 'sys', KeyM: 'sys', KeyH: 'sys', KeyP: 'sys',
    Escape: 'sys', Digit1: 'sys', Digit2: 'sys', Digit3: 'sys',
    Numpad1: 'sys', Numpad2: 'sys', Numpad3: 'sys'
  };
  var BLOCK = { Space: 1, Tab: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, Enter: 1 };

  var Input = G.Input = {
    down: {}, presses: [], buffer: [],
    attach: function () {
      window.addEventListener('keydown', function (e) {
        if (BLOCK[e.code]) e.preventDefault();
        if (e.repeat) return;                        // 重复判断交给浏览器：避免丢 keyup 后该键被永久吞掉
        Input.down[e.code] = true;
        var ev = { code: e.code, owner: MAP[e.code] || 'sys', t: performance.now() / 1000 };
        Input.presses.push(ev);
        Input.buffer.push(ev);
        if (Input.buffer.length > 64) Input.buffer.shift();
      });
      window.addEventListener('keyup', function (e) { Input.down[e.code] = false; });
      window.addEventListener('blur', function () { Input.down = {}; });
      window.addEventListener('pointerdown', function () { G.Audio.unlock(); });
    },
    isDown: function (code) { return !!Input.down[code]; },
    ownerOf: function (code) { return MAP[code] || 'sys'; },
    drain: function () { var p = Input.presses; Input.presses = []; return p; },
    takeBufferSince: function (t) {
      return Input.buffer.filter(function (e) { return e.t >= t; });
    },
    /* 移动向量：返回归一化前的原始方向 */
    axis: function (role) {
      var x = 0, y = 0;
      if (role === 'p1') {
        if (Input.isDown('KeyA')) x -= 1;
        if (Input.isDown('KeyD')) x += 1;
        if (Input.isDown('KeyW')) y -= 1;
        if (Input.isDown('KeyS')) y += 1;
      } else {
        if (Input.isDown('ArrowLeft')) x -= 1;
        if (Input.isDown('ArrowRight')) x += 1;
        if (Input.isDown('ArrowUp')) y -= 1;
        if (Input.isDown('ArrowDown')) y += 1;
      }
      var len = Math.sqrt(x * x + y * y);
      if (len > 0) { x /= len; y /= len; }
      return { x: x, y: y, len: len };
    }
  };
})();
