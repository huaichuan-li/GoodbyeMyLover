/* 命名空间 / 工具 / 事件总线 / 状态机 / 固定步长循环 / 游戏总控 */
(function () {
  var G = window.G = window.G || {};
  var C = G.DATA.config, S = G.DATA.script;

  /* ---------- utils ---------- */
  var U = G.utils = {
    clamp: function (v, a, b) { return v < a ? a : (v > b ? b : v); },
    lerp: function (a, b, t) { return a + (b - a) * t; },
    dist: function (a, b) { var dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); },
    now: function () { return performance.now() / 1000; },
    fmt: function (t) {
      var m = Math.floor(t / 60), s = Math.floor(t % 60);
      return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    },
    rnd: function (seed) {
      var x = seed || 1;
      return function () { x = (x * 1664525 + 1013904223) % 4294967296; return x / 4294967296; };
    },
    el: function (id) { return document.getElementById(id); }
  };

  /* ---------- events ---------- */
  var listeners = {};
  G.Events = {
    on: function (name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
    emit: function (name, payload) {
      (listeners[name] || []).forEach(function (fn) { try { fn(payload); } catch (e) { console.warn('[event]', name, e); } });
    }
  };

  /* ---------- state machine ---------- */
  var State = G.State = {
    current: 'BOOT',
    set: function (name) {
      if (State.current === name) return;
      var prev = State.current;
      State.current = name;
      G.Events.emit('phase', { from: prev, to: name });
    }
  };

  /* ---------- loop ---------- */
  var Loop = G.Loop = {
    acc: 0, last: 0, running: false, fps: 60, frames: 0, fpsT: 0,
    start: function () {
      if (Loop.running) return;
      Loop.running = true;
      Loop.last = performance.now();
      requestAnimationFrame(Loop.frame);
    },
    frame: function (t) {
      var dt = Math.min((t - Loop.last) / 1000, .25);
      Loop.last = t;
      Loop.acc += dt;
      // 浏览器手柄没有可靠的按键事件，逐帧采样并把按钮边沿转成统一输入事件。
      if (G.Input.pollGamepad) G.Input.pollGamepad(dt);
      var presses = G.Input.drain();
      for (var i = 0; i < presses.length; i++) G.Game.onPress(presses[i]);
      while (Loop.acc >= C.step) {
        G.Game.update(C.step);
        Loop.acc -= C.step;
      }
      G.Renderer.renderAll(Loop.acc / C.step);
      Loop.frames++;
      if (t - Loop.fpsT > 1000) { Loop.fps = Loop.frames; Loop.frames = 0; Loop.fpsT = t; }
      requestAnimationFrame(Loop.frame);
    }
  };

  /* ---------- game controller ---------- */
  var Game = G.Game = {
    world: null,
    mode: 'solo',              // solo | duo
    dualView: false,           // 单机下 V 键开启双屏观察
    debugTruth: false,
    present: false,
    init: function () {
      G.Input.attach();
      G.Renderer.resize();
      G.UI.init();
      window.addEventListener('resize', function () { G.Renderer.resize(); });
      document.addEventListener('visibilitychange', function () { G.Audio.visibility(document.hidden); });
      State.set('TITLE');
      G.UI.overlay('title');
      Loop.start();
    },
    reset: function (mode) {
      Game.mode = mode || 'solo';
      Game.dualView = false;
      Game.debugTruth = false;
      Game.world = G.World.create();
      G.Level.build(Game.world);
      G.Recognition.reset(Game.world);
      G.Infection.reset(Game.world);
      G.Subtitles.clear();
      G.UI.overlay(null);
      G.Audio.unlock();
      G.Audio.startAmbient();
      State.set('PLAY');
      G.Subtitles.push(S.lines.wake, 'narration', 4);
      G.Events.emit('reset', Game.world);
    },
    onPress: function (ev) {
      var w = Game.world, ph = State.current;
      if (ph === 'TITLE') { G.Audio.unlock(); State.set('BRIEF'); G.UI.overlay('brief'); return; }
      if (ph === 'BRIEF') {
        if (ev.code === 'Digit1' || ev.code === 'Numpad1') Game.reset('solo');
        else if (ev.code === 'Digit2' || ev.code === 'Numpad2') Game.reset('duo');
        return;
      }
      if (ph === 'RESULT') {
        if (ev.code === 'Space' || ev.code === 'Enter' || ev.code === 'Escape') {
          State.set('TITLE'); G.UI.overlay('title');
        }
        return;
      }
      if (ph === 'CHOICE') {
        if (/^(Digit|Numpad)[123]$/.test(ev.code)) Game.choose(parseInt(ev.code.slice(-1), 10));
        return;
      }
      if (Game.systemKey(ev)) return;
      G.Movement.onPress(w, ev);
      G.Recognition.onPress(w, ev);
    },
    systemKey: function (ev) {
      var w = Game.world;
      switch (ev.code) {
        case 'Escape': State.set('TITLE'); G.UI.overlay('title'); return true;
        case 'Tab':
          if (Game.mode === 'solo') {
            w.controlled = w.controlled === 'p1' ? 'p2' : 'p1';
            G.Subtitles.push('[接管] ' + (w.controlled === 'p1' ? 'A · 人马' : 'B · 木乃伊'), 'system', 1.6);
          }
          return true;
        case 'KeyV': return true;
        case 'KeyM': G.Audio.muteAll(C.silence.long); return true;
        case 'KeyP':
          Game.present = !Game.present;
          document.body.classList.toggle('present', Game.present);
          return true;
      }
      return false;
    },
    update: function (dt) {
      var w = Game.world, ph = State.current;
      var live = (ph === 'PLAY' || ph === 'RECOGNIZE' || ph === 'QTE' || ph === 'VERIFY' || ph === 'ESCAPE');
      if (w && live) {
        w.time += dt;
        G.Movement.update(w, dt);
        G.AI.update(w, dt);
        G.Infection.update(w, dt);
        G.Horror.update(w, dt);
        G.Timeline.update(w, dt);
        G.Recognition.update(w, dt);
        G.Audio.update(w, dt);
        Game.checkEnd(w);
      }
      G.Subtitles.update(dt);
      if (w) G.UI.update(w);
    },
    checkEnd: function (w) {
      if (State.current === 'RESULT' || w.flags.ending) return;
      if (w.infection >= C.infection.max) return Game.end('horse');
      if (w.time >= C.timeline.hardEnd && !w.flags.boarded) return Game.end('timeout');
    },
    choose: function (n) {
      var w = Game.world;
      w.flags.boarded = true; w.flags.ending = true;
      G.Audio.muteAll(C.silence.short);
      var ok = w.flags.recognized && !w.flags.wrongPerson;
      if (n === 2) { w.humanity += C.humanity.abandon; G.Infection.applyMistake(w, true); return Game.end('alone'); }
      if (n === 3) { w.humanity += C.humanity.give; return Game.end(ok ? 'stay' : 'wrong'); }
      if (w.serum < 1) return Game.end('horse');       // 没找到血清 → 恢复不了人形
      if (!ok) return Game.end('wrong');
      w.flags.truth = true;                    // 恢复人形：两屏剪影短暂重合
      G.Events.emit('truth', w);
      setTimeout(function () { Game.end('true'); }, 950);
    },
    end: function (key) {
      if (State.current === 'RESULT') return;
      State.set('RESULT');
      G.Audio.stopAmbient();
      G.UI.overlay('ending', key);
    }
  };
})();
