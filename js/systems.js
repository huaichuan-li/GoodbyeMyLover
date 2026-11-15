/* 移动 / 感染数值 / 拟声字幕 / 恐怖调度 / 单机 AI 同伴 */
(function () {
  var G = window.G = window.G || {};
  var C = G.DATA.config, S = G.DATA.script, U = G.utils;

  function hitWall(w, x, y, r) {
    for (var i = 0; i < w.walls.length; i++) {
      var b = w.walls[i];
      if (x > b.x - r && x < b.x + b.w + r && y > b.y - r && y < b.y + b.h + r) return true;
    }
    return false;
  }
  function moveWithCollision(w, e, dx, dy) {
    var nx = e.x + dx, ny = e.y + dy;
    if (!hitWall(w, nx, e.y, e.r)) e.x = nx;
    if (!hitWall(w, e.x, ny, e.r)) e.y = ny;
    e.x = U.clamp(e.x, C.world.pad, C.world.w - C.world.pad);
    e.y = U.clamp(e.y, C.world.pad, C.world.h - C.world.pad);
  }
  function keyboardRole(w, role) {
    return G.Game.mode === 'duo' || w.controlled === role;
  }

  /* ---------- movement ---------- */
  var Movement = G.Movement = {
    onPress: function (w, ev) {
      if (ev.code === 'ShiftLeft' && keyboardRole(w, 'p1')) Movement.dash(w, w.p1);
      if (ev.code === 'ShiftRight' && keyboardRole(w, 'p2')) Movement.dash(w, w.p2);
    },
    dash: function (w, e) {
      if (e.dashCd > 0 || w.time < 1) return;
      e.dashT = C.speed.dashTime; e.dashCd = C.speed.dashCd;
      w.infection = U.clamp(w.infection + C.infection.dash, 0, C.infection.max);
      w.stat.dashes++;
      G.Synth.hoof(true);
      G.Subtitles.push('咚——', 'onomat', .8);
    },
    update: function (w, dt) {
      var roles = ['p1', 'p2'];
      for (var i = 0; i < roles.length; i++) {
        var role = roles[i], e = G.World.playerOf(w, role);
        e.dashT = Math.max(0, e.dashT - dt);
        e.dashCd = Math.max(0, e.dashCd - dt);
        e.hitCd = Math.max(0, e.hitCd - dt);
        if (!keyboardRole(w, role)) continue;                  // 另一个交给 AI
        var a = G.Input.axis(role);
        if (a.len === 0) { e.moving = false; e.vx = e.vy = 0; continue; }

        // 「不能后退」：感染越深，反向分量被吞得越彻底
        var along = a.x * e.facing.x + a.y * e.facing.y;
        if (along < 0) {
          if (w.infection > C.noBack.sideOnly) { a.x = 0; a.y = 0; }
          else if (w.infection > C.noBack.free) {
            a.x -= along * e.facing.x; a.y -= along * e.facing.y;
            var l2 = Math.sqrt(a.x * a.x + a.y * a.y);
            if (l2 > 0) { a.x /= l2; a.y /= l2; }
          }
        }
        if (a.x !== 0 || a.y !== 0) {
          e.facing.x = a.x; e.facing.y = a.y;
          var mul = e.dashT > 0 ? C.speed.dash / e.speed : 1;
          var dx = a.x * e.speed * mul * dt, dy = a.y * e.speed * mul * dt;
          moveWithCollision(w, e, dx, dy);
          e.vx = a.x; e.vy = a.y; e.moving = true;
        } else e.moving = false;
      }

      // 丧尸缓慢逼近
      var zs = G.World.living(w, 'zombie');
      for (var z = 0; z < zs.length; z++) {
        var zo = zs[z];
        var target = U.dist(zo, w.p1) < U.dist(zo, w.p2) ? w.p1 : w.p2;
        var d = U.dist(zo, target);
        if (d > 620 || d < 1) { zo.moving = false; continue; }
        var vx = (target.x - zo.x) / d, vy = (target.y - zo.y) / d;
        moveWithCollision(w, zo, vx * 46 * dt, vy * 46 * dt);
        zo.facing.x = vx; zo.facing.y = vy; zo.moving = true;
        if (d < zo.r + 26) {
          if (target.hitCd <= 0) {
            target.hitCd = 1.2;
            w.infection = U.clamp(w.infection + C.infection.touch, 0, C.infection.max);
            w.stat.hits++;
            G.Synth.glitch();
          }
          moveWithCollision(w, zo, -vx * 40 * dt, -vy * 40 * dt);
        }
      }

      // 假爱人 / 蹄声剪影跟随
      for (var f = 0; f < w.followers.length; f++) {
        var fo = w.followers[f];
        var ddx = w.p1.x - 96 - f * 46 - fo.x, ddy = w.p1.y + 20 - fo.y;
        var dd = Math.sqrt(ddx * ddx + ddy * ddy);
        if (dd > 8) {
          moveWithCollision(w, fo, ddx / dd * 62 * dt, ddy / dd * 62 * dt);
          fo.moving = true;
        } else fo.moving = false;
      }

      // 血清拾取
      for (var k = 0; k < w.entities.length; k++) {
        var pk = w.entities[k];
        if (pk.kind !== 'pickup' || !pk.alive) continue;
        if (U.dist(pk, w.p1) < 46 || U.dist(pk, w.p2) < 46) {
          pk.alive = false; w.serum++;
          G.Synth.secret(true);
          G.Subtitles.push('拾到一支血清。标签上写着：只认人形。', 'system', 2.6);
        }
      }

      // 提前登船：完成验证 + 抵达火箭
      if (w.flags.verifyDone && w.p1.x > w.rocket.x - 150 && G.State.current !== 'CHOICE' && G.State.current !== 'RESULT') {
        G.Timeline.toChoice(w);
      }
    }
  };

  /* ---------- infection / humanity ---------- */
  G.Infection = {
    reset: function (w) { w.infection = 0; w.humanity = C.humanity.start; w.serum = 0; },
    update: function (w, dt) {
      var mul = w.time >= C.timeline.accelerateAt ? C.infection.accelerateMul : 1;
      w.infection = U.clamp(w.infection + C.infection.base * mul * dt, 0, C.infection.max);
      w.humanity = U.clamp(w.humanity, 0, 100);
    },
    applyMistake: function (w, silent) {
      w.infection = U.clamp(w.infection + C.infection.mistake, 0, C.infection.max);
      w.humanity = U.clamp(w.humanity + C.humanity.mistake, 0, 100);
      w.stat.mistakes++; w.recog.mistakes++;
      G.Synth.glitch();
      if (!silent) {
        G.Subtitles.push(S.lines.lockWrong, 'narration', 2.6);
        var fo = G.Entities.make({ kind: 'follower', x: w.p1.x - 110, y: w.p1.y + 20, trueForm: 'fake', r: 20, follower: true });
        G.World.add(w, fo); w.followers.push(fo);
      }
    }
  };

  /* ---------- subtitles ---------- */
  G.Subtitles = {
    clear: function () { var w = G.Game.world; if (w) w.subs = []; },
    push: function (text, kind, dur) {
      var w = G.Game.world; if (!w) return;
      w.subs.push({ text: text, kind: kind || 'narration', until: w.time + (dur || 2.6) });
      if (w.subs.length > 3) w.subs.shift();
    },
    update: function (dt) {
      var w = G.Game.world; if (!w) return;
      w.subs = w.subs.filter(function (s) { return s.until > w.time; });
    }
  };

  /* ---------- horror ---------- */
  var EVENTS = [
    { t: 18, id: 'hoof', fn: function (w) { G.Subtitles.push(S.lines.hoofBehind, 'onomat', 2.4); G.Subtitles.push(S.lines.hoofHint, 'narration', 3.2); } },
    { t: 50, id: 'silence1', fn: function (w) { G.Audio.muteAll(C.silence.long); G.Subtitles.push(S.lines.sameFace, 'narration', 3); } },
    { t: 118, id: 'echo', fn: function (w) { G.Subtitles.push(S.lines.echoes[0], 'onomat', 2.4); G.Synth.secret(false); } },
    { t: 170, id: 'silence2', fn: function (w) {
        G.Audio.muteAll(C.silence.short);
        G.Subtitles.push(S.lines.qteEcho, 'narration', 3);
        w.candidates.forEach(function (id) {
          var e = w.byId[id];
          if (e && e.alive) { e.x += (w.p1.x - e.x) * .12; }
        });
      } },
    { t: 205, id: 'shadow', fn: function (w) {
        var sh = G.Entities.make({ kind: 'follower', x: w.p1.x - 130, y: w.p1.y + 10, trueForm: 'centaur', r: 21, follower: true });
        G.World.add(w, sh); w.followers.push(sh);
        G.Subtitles.push('身后多了一个不动的影子。', 'narration', 3);
      } },
    { t: 220, id: 'mapShift', fn: function (w) {
        w.flags.mapShifted = true;
        if (w.walls.length) { var b = w.walls[w.walls.length - 1]; b.x -= 150; b.y += 90; }
        G.Subtitles.push(S.lines.mapShift, 'narration', 3.4);
        G.Synth.glitch();
      } },
    { t: 240, id: 'escape', fn: function (w) {
        w.flags.escape = true;
        if (G.State.current !== 'RESULT' && G.State.current !== 'CHOICE') G.State.set('ESCAPE');
        G.Subtitles.push(S.lines.escape, 'narration', 3);
      } }
  ];
  G.Horror = {
    update: function (w, dt) {
      var D = w.horror.done;
      for (var i = 0; i < EVENTS.length; i++) {
        var ev = EVENTS[i];
        if (w.time >= ev.t && !D[ev.id]) { D[ev.id] = true; ev.fn(w); }
      }
      w.horror.flicker = Math.sin(w.time * 9) * .5 + .5;
    }
  };

  /* ---------- AI companion（单机） ---------- */
  G.AI = {
    update: function (w, dt) {
      if (G.Game.mode === 'duo') return;
      var ai = w.controlled === 'p1' ? w.p2 : w.p1;
      var human = w.controlled === 'p1' ? w.p1 : w.p2;
      var d = U.dist(ai, human);
      if (d > 96) {
        var vx = (human.x - ai.x) / d, vy = (human.y - ai.y) / d;
        moveWithCollision(w, ai, vx * 152 * dt, vy * 152 * dt);
        ai.facing.x = vx; ai.facing.y = vy; ai.moving = true;
      } else ai.moving = false;

      // 相认阶段的「报数」已在 Recognition.begin 里同步完成；
      // AI 只负责跟随、避障与行为测试，不替玩家下认错结论。

      // 行为测试：只有真爱人会挡在丧尸前面
      if (w.recog.stage === 'VERIFY' && !w.flags.blocked && w.suspectId) {
        var lover = w.byId[w.suspectId];
        if (lover && lover.alive && U.dist(lover, human) < 260) {
          var x = (human.x + lover.x) / 2 - 30, y = (human.y + lover.y) / 2;
          moveWithCollision(w, lover, (x - lover.x) * .9 * dt, (y - lover.y) * .9 * dt);
          if (U.dist(lover, human) < 86) {
            w.flags.blocked = true;
            w.humanity = U.clamp(w.humanity + C.humanity.block, 0, 100);
            G.Subtitles.push(S.lines.block, 'narration', 3.6);
          }
        }
      }
    }
  };
})();
