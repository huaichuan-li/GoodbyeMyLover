/* 键位表 + 输入缓冲环（按键带时间戳，QTE 判定与帧率解耦） */
(function () {
  var G = window.G = window.G || {};
  var C = G.DATA.config;

  var MAP = {
    KeyW: 'p1', KeyA: 'p1', KeyS: 'p1', KeyD: 'p1',
    KeyQ: 'p1', KeyF: 'p1', KeyX: 'p1', Space: 'p1', ShiftLeft: 'p1', KeyR: 'p1', KeyE: 'p1', KeyC: 'p1', KeyV: 'p1',
    ArrowUp: 'p2', ArrowDown: 'p2', ArrowLeft: 'p2', ArrowRight: 'p2',
    Semicolon: 'p2', Quote: 'p2', Comma: 'p2', Period: 'p2', Slash: 'p2',
    BracketLeft: 'p2', BracketRight: 'p2', Backslash: 'p2', Minus: 'p2', Equal: 'p2', ShiftRight: 'p2',
    Tab: 'sys', KeyM: 'sys', KeyH: 'sys', KeyP: 'sys',
    Escape: 'sys', Digit1: 'sys', Digit2: 'sys', Digit3: 'sys',
    Numpad1: 'sys', Numpad2: 'sys', Numpad3: 'sys'
  };
  var BLOCK = { Space: 1, Tab: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, Enter: 1, Semicolon: 1, Quote: 1, Comma: 1, Period: 1, Slash: 1, BracketLeft: 1, BracketRight: 1, Backslash: 1, Minus: 1, Equal: 1 };

  var GAMEPAD_CODES = ['GamepadA', 'GamepadB', 'GamepadX', 'GamepadY', 'GamepadLB', 'GamepadRB', 'GamepadBack', 'GamepadStart'];
  var GAMEPAD_INDICES = [0, 1, 2, 3, 4, 5, 8, 9];
  var GAMEPAD_LABELS = {
    GamepadA: 'A', GamepadB: 'B', GamepadX: 'X', GamepadY: 'Y',
    GamepadLB: 'LB', GamepadRB: 'RB', GamepadBack: 'View', GamepadStart: 'Menu'
  };
  var Input = G.Input = {
    down: {}, presses: [], buffer: [], gamepad: null, gamepadButtons: [], gamepadName: '', attached: false,
    attach: function () {
      if (Input.attached) return;
      Input.attached = true;
      // 捕获阶段监听，避免画布、半屏 HUD 或浏览器焦点把 A 玩家键盘吞掉。
      var onKeyDown = function (e) {
        if (BLOCK[e.code]) e.preventDefault();
        Input.down[e.code] = true;
        if (e.repeat) return;
        var ev = { code: e.code, key: e.key, owner: MAP[e.code] || 'sys', t: performance.now() / 1000 };
        Input.presses.push(ev);
        Input.buffer.push(ev);
        if (Input.buffer.length > 64) Input.buffer.shift();
      };
      var onKeyUp = function (e) { Input.down[e.code] = false; };
      document.addEventListener('keydown', onKeyDown, true);
      document.addEventListener('keyup', onKeyUp, true);
      window.addEventListener('blur', function () { Input.down = {}; Input.gamepadButtons = []; });
      window.addEventListener('pointerdown', function () {
        G.Audio.unlock();
        // 让点击左半屏后继续按住 WASD 时，键盘事件稳定留在游戏页面。
        if (document.body && document.body.focus) document.body.focus({ preventScroll: true });
      });
      window.addEventListener('gamepadconnected', function (e) {
        if (!Input.gamepad) Input.gamepad = e.gamepad;
        Input.gamepadName = (e.gamepad && e.gamepad.id) || '手柄';
      });
      window.addEventListener('gamepaddisconnected', function (e) {
        if (Input.gamepad && e.gamepad && Input.gamepad.index === e.gamepad.index) {
          Input.gamepad = null; Input.gamepadButtons = []; Input.gamepadName = '';
        }
      });
    },
    pollGamepad: function (dt) {
      if (!navigator.getGamepads) return;
      var pads = navigator.getGamepads();
      var pad = Input.gamepad && pads[Input.gamepad.index];
      if (!pad) {
        pad = null;
        for (var i = 0; i < pads.length; i++) if (pads[i]) { pad = pads[i]; break; }
      }
      if (!pad) { Input.gamepad = null; Input.gamepadName = ''; Input.gamepadButtons = []; return; }
      Input.gamepad = pad;
      Input.gamepadName = pad.id || '手柄';
      for (var b = 0; b < GAMEPAD_CODES.length; b++) {
        var button = pad.buttons[GAMEPAD_INDICES[b]];
        var pressed = !!(button && button.pressed);
        if (pressed && !Input.gamepadButtons[b] && document.hasFocus()) {
          var code = GAMEPAD_CODES[b];
          var ev = { code: code, key: GAMEPAD_LABELS[code], owner: 'p2', source: 'gamepad', t: performance.now() / 1000 };
          Input.presses.push(ev); Input.buffer.push(ev);
          if (Input.buffer.length > 64) Input.buffer.shift();
        }
        Input.gamepadButtons[b] = pressed;
      }
      // B 的右摇杆只影响右屏相机；A 的鼠标状态完全隔离。
      if (G.State.current === 'PLAY' && document.hasFocus() && G.Renderer && G.Renderer.updateGamepadCamera) {
        var look = Input.gamepadStick(2);
        G.Renderer.updateGamepadCamera('p2', look.x, look.y, dt);
      }
    },
    isDown: function (code) { return !!Input.down[code]; },
    ownerOf: function (code) { return MAP[code] || 'sys'; },
    drain: function () { var p = Input.presses; Input.presses = []; return p; },
    takeBufferSince: function (t) {
      return Input.buffer.filter(function (e) { return e.t >= t; });
    },
    gamepadAxis: function (index) {
      var pad = Input.gamepad, v = pad && pad.axes && Number(pad.axes[index]);
      if (!isFinite(v) || Math.abs(v) < 0.16) return 0;
      return Math.max(-1, Math.min(1, v));
    },
    gamepadStick: function (index) {
      var axes = Input.gamepad && Input.gamepad.axes || [];
      var x = Number(axes[index]) || 0, y = Number(axes[index + 1]) || 0;
      var length = Math.hypot(x, y), deadzone = 0.16;
      if (length <= deadzone) return { x: 0, y: 0 };
      var strength = Math.min(1, (length - deadzone) / (1 - deadzone));
      return { x: x / length * strength, y: y / length * strength };
    },
    controlHints: function (role) {
      if (role === 'p1') return '键盘 WASD 移动 · 拖动鼠标视角 · V 切换视角 · E 观察 · F 辨认 · Shift 冲刺';
      var status = Input.gamepad ? '手柄已连接' : '等待手柄';
      return status + ' · 左摇杆移动 · 右摇杆视角 · Y 切换视角 · A 观察 · X 辨认 · B 冲刺';
    },
    gamepadButtonLabel: function (code) { return GAMEPAD_LABELS[code] || code; },
    /* 移动向量：返回归一化前的原始方向 */
    axis: function (role) {
      var x = 0, y = 0;
      if (role === 'p1') {
        if (Input.isDown('KeyA')) x -= 1;
        if (Input.isDown('KeyD')) x += 1;
        if (Input.isDown('KeyW')) y -= 1;
        if (Input.isDown('KeyS')) y += 1;
      } else {
        var stick = document.hasFocus() ? Input.gamepadStick(0) : { x: 0, y: 0 };
        x = stick.x; y = stick.y;
      }
      var len = Math.sqrt(x * x + y * y);
      if (len > 1) { x /= len; y /= len; len = 1; }
      // WASD/左摇杆以相机朝向为前进方向，让控制手感接近 FPS。
      var renderer = G.Renderer;
      var yaw = renderer && renderer.getCameraYaw ? renderer.getCameraYaw(role) : 0;
      var forward = -y, right = x;
      // 渲染坐标的 z 轴由实体 y 轴映射而来；相机前方在 yaw=0 时是 -z，
      // 因此前进需要减少实体 y。右方向随 yaw 顺时针转动。
      var worldX = right * Math.cos(yaw) + forward * Math.sin(yaw);
      var worldY = right * Math.sin(yaw) - forward * Math.cos(yaw);
      return { x: worldX, y: worldY, len: len };
    }
  };
})();
