/* Web Audio 全实时合成：零音频素材；「突然静音」是主要惊吓手段 */
(function () {
  var G = window.G = window.G || {};
  var C = G.DATA.config;

  var Synth = G.Synth = {
    ctx: null, master: null, noise: null,
    init: function (ctx, master) {
      Synth.ctx = ctx; Synth.master = master;
      var len = Math.floor(ctx.sampleRate * 1);
      var buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      Synth.noise = buf;
    },
    env: function (node, t, a, d, peak) {
      node.gain.setValueAtTime(.0001, t);
      node.gain.exponentialRampToValueAtTime(peak, t + a);
      node.gain.exponentialRampToValueAtTime(.0001, t + a + d);
    },
    tone: function (freq, dur, type, vol, dest) {
      var ctx = Synth.ctx; if (!ctx) return;
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type || 'sine'; o.frequency.setValueAtTime(freq, ctx.currentTime);
      o.connect(g); g.connect(dest || Synth.master);
      Synth.env(g, ctx.currentTime, .008, dur, vol || .1);
      o.start(); o.stop(ctx.currentTime + dur + .06);
    },
    burst: function (dur, freq, q, vol, type) {
      var ctx = Synth.ctx; if (!ctx || !Synth.noise) return;
      var src = ctx.createBufferSource(); src.buffer = Synth.noise;
      var f = ctx.createBiquadFilter(); f.type = type || 'lowpass';
      f.frequency.setValueAtTime(freq, ctx.currentTime); f.Q.value = q || 1;
      var g = ctx.createGain();
      src.connect(f); f.connect(g); g.connect(Synth.master);
      Synth.env(g, ctx.currentTime, .005, dur, vol || .1);
      src.start(); src.stop(ctx.currentTime + dur + .08);
    },
    heartbeat: function () {
      Synth.tone(58, .13, 'sine', .22);
      setTimeout(function () { Synth.tone(52, .16, 'sine', .16); }, 175);
    },
    hoof: function (near) {
      Synth.burst(.075, 320, .8, near ? .17 : .075);
      Synth.tone(64, .11, 'sine', near ? .16 : .07);
      setTimeout(function () { Synth.burst(.05, 260, .8, near ? .09 : .04); }, 135);
    },
    bandage: function () { Synth.burst(.34, 1500, 2.2, .035, 'bandpass'); },
    secret: function (clean) {
      Synth.tone(clean ? 494 : 466, .09, 'square', clean ? .11 : .085);
      if (!clean) setTimeout(function () { Synth.tone(455, .1, 'square', .05); }, 90);
    },
    glitch: function () { Synth.burst(.06, 2600, 1.4, .05, 'highpass'); },
    drone: function (start) {
      var ctx = Synth.ctx; if (!ctx) return;
      if (start) {
        if (Synth._drone) return;
        var g = ctx.createGain(); g.gain.value = .014; g.connect(Synth.master);
        var a = ctx.createOscillator(), b = ctx.createOscillator();
        a.frequency.value = 55; b.frequency.value = 55.4;
        a.connect(g); b.connect(g); a.start(); b.start();
        Synth._drone = { g: g, a: a, b: b };
      } else if (Synth._drone) {
        try { Synth._drone.a.stop(); Synth._drone.b.stop(); } catch (e) { }
        Synth._drone = null;
      }
    }
  };

  G.Audio = {
    ctx: null, master: null, unlocked: false, muted: false,
    ambientOn: false, silenceUntil: 0, nextBeat: 0, nextHoof: 0,
    unlock: function () {
      if (G.Audio.unlocked) {
        if (G.Audio.ctx && G.Audio.ctx.state === 'suspended') G.Audio.ctx.resume();
        return;
      }
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      var ctx = new AC();
      var master = ctx.createGain(); master.gain.value = .85; master.connect(ctx.destination);
      G.Audio.ctx = ctx; G.Audio.master = master; G.Audio.unlocked = true;
      Synth.init(ctx, master);
      if (ctx.state === 'suspended') ctx.resume();
      G.Audio.nextBeat = ctx.currentTime + .1;
      G.Audio.nextHoof = ctx.currentTime + 1.2;
    },
    startAmbient: function () { G.Audio.ambientOn = true; Synth.drone(true); },
    stopAmbient: function () { G.Audio.ambientOn = false; Synth.drone(false); },
    visibility: function (hidden) {
      if (!G.Audio.ctx) return;
      try { hidden ? G.Audio.ctx.suspend() : G.Audio.ctx.resume(); } catch (e) { }
    },
    isMuted: function () { return G.Audio.muted; },
    muteAll: function (dur) {
      if (!G.Audio.unlocked) return;
      var A = G.Audio, ctx = A.ctx, t = ctx.currentTime;
      A.muted = true;
      A.master.gain.cancelScheduledValues(t);
      A.master.gain.setValueAtTime(.0001, t);     // 瞬时归零，不做渐变
      A.silenceUntil = t + (dur || C.silence.long);
      G.Subtitles.push(G.DATA.script.lines.firstSilence, 'onomat', (dur || C.silence.long) + .2);
      G.Events.emit('silence', true);
    },
    unmute: function () {
      var A = G.Audio, ctx = A.ctx;
      A.muted = false;
      A.master.gain.cancelScheduledValues(ctx.currentTime);
      A.master.gain.setValueAtTime(.85, ctx.currentTime);
      Synth.hoof(true);
      G.Events.emit('silence', false);
    },
    update: function (w, dt) {
      var A = G.Audio;
      if (!A.unlocked || !A.ctx) return;
      var t = A.ctx.currentTime;
      if (A.muted) { if (t >= A.silenceUntil) A.unmute(); return; }
      if (!A.ambientOn) return;
      var bpm = 60 + (w.infection / C.infection.max) * 62;
      if (t >= A.nextBeat) { Synth.heartbeat(); A.nextBeat = t + 60 / bpm; }
      if (w.time > 12 && t >= A.nextHoof) {
        Synth.hoof(w.infection > 55);
        A.nextHoof = t + Math.max(.85, 2.8 - w.infection / 55);
      }
    }
  };
})();
