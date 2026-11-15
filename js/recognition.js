/* 相认三技巧：分屏坐标锁定 / 节奏暗号 QTE（回声模仿） / 倒影 + 行为测试 */
(function () {
  var G = window.G = window.G || {};
  var C = G.DATA.config, S = G.DATA.script, U = G.utils;

  function sideMode(mode) { return mode === 'mummy' ? 'mummy' : 'centaur'; }
  function listFor(w, mode) { return G.Perception.movers(w, sideMode(mode)); }

  var R = G.Recognition = {
    reset: function (w) {
      w.recog = { stage: 'IDLE', p1Pick: 1, p2Pick: 1, aiK: 0, attempts: 0, mistakes: 0, verifyDone: false, reported: { p1: false, p2: false } };
      w.qte = { active: false, idx: 0, t0: 0, echoFollow: 0, echoAt: [], hits: [], targetIsFake: false, result: null };
      w.aiReport = null; w.lockedId = null;
    },
    indexFor: function (w, mode, id) {
      if (!w || w.recog.stage !== 'LOCK') return 0;
      var ms = listFor(w, mode);
      for (var i = 0; i < ms.length; i++) if (ms[i].id === id) return i + 1;
      return 0;
    },
    isPicked: function (w, mode, id) {
      if (!w || w.recog.stage !== 'LOCK') return false;
      var ms = listFor(w, mode);
      var k = (mode === 'mummy')
        ? (G.Game.mode === 'duo' ? w.recog.p2Pick : w.recog.aiK)
        : w.recog.p1Pick;
      return !!ms[k - 1] && ms[k - 1].id === id;
    },
    begin: function (w) {
      if (w.recog.stage !== 'IDLE') return;
      w.recog.stage = 'LOCK';
      w.recog.reported = { p1: false, p2: G.Game.mode === 'duo' ? false : true };
      G.State.set('RECOGNIZE');
      G.Subtitles.push(S.lines.candidates, 'narration', 4);
      G.Subtitles.push(S.lines.reportTip, 'narration', 4.6);
      // AI 报数在 begin 时同步算好，不依赖下一帧，避免快速操作吞输入
      if (G.Game.mode === 'solo') {
        var ms = G.Perception.movers(w, 'mummy'), k = 0;
        for (var i = 0; i < ms.length; i++) if (ms[i].id === w.suspectId) k = i + 1;
        k = k || 1;
        w.aiReport = k; w.recog.aiK = k;
        G.Subtitles.push(S.lines.aiReport.replace('{k}', k), 'who', 6);
        G.Subtitles.push('她看到的顺序，和你相反。', 'narration', 4);
      }
      G.Synth.bandage();
    },
    onPress: function (w, ev) {
      if (!w) return;
      var st = w.recog.stage;
      if (st === 'LOCK') {
        var n = listFor(w, 'centaur').length || 1;
        if (ev.code === 'KeyQ') { w.recog.p1Pick = w.recog.p1Pick % n + 1; G.Synth.secret(true); }
        else if (ev.code === 'KeyE' && G.Game.mode === 'duo') {
          var n2 = listFor(w, 'mummy').length || 1;
          w.recog.p2Pick = w.recog.p2Pick % n2 + 1; G.Synth.secret(true);
        }
        else if (ev.code === 'KeyF') { w.recog.reported.p1 = true; G.Synth.secret(true); }
        else if (ev.code === 'Enter' && G.Game.mode === 'duo') { w.recog.reported.p2 = true; G.Synth.secret(true); }
        if (w.recog.reported.p1 && w.recog.reported.p2) R.exchangeLock(w);
        return;
      }
      if (st === 'QTE' && w.qte.active) {
        if (ev.code === 'Space' || ev.code === 'Enter') R.qteHit(w, ev.t);
        return;
      }
      if (st === 'VERIFY' && ev.code === 'KeyR') R.mirror(w);
    },
    update: function (w, dt) {
      if (!w) return;
      if (w.qte.active) {
        var q = w.qte;
        var deadline = q.t0 + C.qte.pattern[C.qte.pattern.length - 1] + C.qte.window + .45;
        if (U.now() > deadline && !q.result) R.qteResolve(w, 'FAIL');
      }
    },

    /* 技巧②：两侧各报「第几个在动」，只有指向同一实体才算数 */
    exchangeLock: function (w) {
      var m1 = listFor(w, 'centaur'), m2 = listFor(w, 'mummy');
      var k2 = G.Game.mode === 'duo' ? w.recog.p2Pick : w.recog.aiK;
      var a = m1[w.recog.p1Pick - 1], b = m2[k2 - 1];
      w.recog.reported = { p1: false, p2: G.Game.mode === 'duo' ? false : true };
      w.recog.attempts++;
      if (!a || !b || a.id !== b.id) {
        G.Subtitles.push(S.lines.lockFail, 'narration', 2.4);
        G.Synth.glitch();
        if (w.recog.attempts >= 3) G.Infection.applyMistake(w, true);
        return;
      }
      w.lockedId = a.id;
      if (w.byId[a.id]) w.byId[a.id].locked = true;
      G.Subtitles.push(S.lines.lockOk, 'narration', 2.4);
      G.Synth.secret(true);
      R.startQTE(w, !a.isLover);
    },

    /* 技巧①：三短一长；假象慢半拍回声模仿，跟错就被带偏 */
    startQTE: function (w, targetIsFake) {
      w.recog.stage = 'QTE';
      G.State.set('QTE');
      w.qte = {
        active: true, idx: 0, t0: U.now() + C.qte.lead,
        echoFollow: 0, echoAt: [], hits: [], targetIsFake: targetIsFake, result: null
      };
      G.Subtitles.push(S.lines.qteTip, 'narration', 4.2);
      G.Synth.secret(true);
      G.UI.showQTE(w);
    },
    qteHit: function (w, t) {
      var q = w.qte;
      if (!q.active || q.result) return;
      // 先判「是不是跟着回声按的」
      for (var i = 0; i < q.echoAt.length; i++) {
        if (Math.abs(t - q.echoAt[i]) <= C.qte.echoTolerance + C.qte.window * .5) {
          q.echoFollow++;
          G.Synth.glitch();
          G.Subtitles.push(S.lines.qteEcho, 'onomat', 1.6);
          if (q.echoFollow >= C.qte.echoMax) return R.qteResolve(w, 'MISLED');
          return;
        }
      }
      var exp = q.t0 + C.qte.pattern[q.idx];
      if (Math.abs(t - exp) <= C.qte.window) {
        q.hits.push(q.idx); q.idx++;
        G.Synth.secret(!q.targetIsFake);
        if (q.targetIsFake) {
          var at = t + C.qte.echoDelay;
          q.echoAt.push(at);
          setTimeout(function () { if (!q.result) G.Synth.secret(false); }, C.qte.echoDelay * 1000);
        }
        if (q.idx >= C.qte.pattern.length) return R.qteResolve(w, 'SUCCESS');
      } else {
        G.Synth.glitch();
        return R.qteResolve(w, 'FAIL');
      }
    },
    qteResolve: function (w, result) {
      var q = w.qte;
      if (q.result) return;
      q.result = result; q.active = false;
      G.UI.hideQTE();
      if (result === 'SUCCESS' && q.targetIsFake) {
        // 没被回声带偏 = 识破假象，回去重选
        G.Subtitles.push('它慢了半拍。不是她。', 'narration', 2.8);
        if (w.byId[w.lockedId]) w.byId[w.lockedId].locked = false;
        w.lockedId = null;
        w.recog.stage = 'LOCK'; G.State.set('RECOGNIZE');
        w.recog.reported = { p1: false, p2: G.Game.mode === 'duo' ? false : true };
        return;
      }
      if (result === 'SUCCESS') {
        w.flags.recognized = true;
        w.humanity = U.clamp(w.humanity + C.humanity.correct, 0, 100);
        G.Subtitles.push(S.lines.qteClean, 'narration', 2.6);
      } else {
        G.Infection.applyMistake(w);
        w.flags.wrongPerson = true;
        G.Subtitles.push(result === 'MISLED' ? S.lines.misled : '暗号没对上。它记住了你的样子。', 'narration', 3);
      }
      R.toVerify(w);
    },
    toVerify: function (w) {
      w.recog.stage = 'VERIFY';
      G.State.set('VERIFY');
      G.Subtitles.push(S.lines.verifyTip, 'narration', 4.5);
    },

    /* 技巧③：水坑倒影不撒谎（行为测试由 AI 同伴在 systems.js 里触发） */
    mirror: function (w) {
      var near = w.puddles.some(function (p) { return U.dist(p, w.p1) < 240 || U.dist(p, w.p2) < 240; });
      if (!near) { G.Subtitles.push('要站在水洼边，才看得见倒影。', 'system', 2); return; }
      w.flags.mirrorReveal = true;
      var trueOne = w.lockedId && w.lockedId === w.suspectId && !w.flags.wrongPerson;
      if (trueOne) {
        G.Subtitles.push(S.lines.mirrorTrue, 'narration', 3.2);
        G.Synth.secret(true);
      } else {
        w.flags.wrongPerson = true;
        G.Infection.applyMistake(w, true);
        G.Subtitles.push(S.lines.mirrorFake, 'narration', 3.2);
        G.Synth.glitch();
      }
      w.flags.verifyDone = true;
      w.recog.stage = 'DONE';
      G.State.set('ESCAPE');
      G.Subtitles.push(S.lines.serum + ' 往右，去发射通道。', 'narration', 4);
    },
    forceVerify: function (w) {
      if (w.flags.verifyDone) return;
      w.qte.active = false; G.UI.hideQTE();
      w.flags.verifyDone = true;
      w.recog.stage = 'DONE';
      G.State.set('ESCAPE');
      G.Subtitles.push('没时间验证了。往右冲。', 'narration', 2.6);
    }
  };
})();
