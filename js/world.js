/* 唯一世界状态 + 实体工厂 + 感知投影层 */
(function () {
  var G = window.G = window.G || {};
  var C = G.DATA.config;

  /* ---------- entity factory ---------- */
  var uid = 0;
  var Entities = G.Entities = {
    make: function (o) {
      var e = {
        id: o.id || ('e' + (++uid)), kind: o.kind || 'prop',
        x: o.x || 0, y: o.y || 0, vx: 0, vy: 0,
        r: o.r || 20, speed: o.speed || 0,
        facing: { x: 1, y: 0 }, moving: false, alive: true,
        trueForm: o.trueForm || 'human',
        isLover: !!o.isLover, isFake: !!o.isFake,
        ghostP1: !!o.ghostP1, ghostP2: !!o.ghostP2,
        blink: o.blink || 0, phase: Math.random() * 6.28,
        label: o.label || '', locked: false, follower: !!o.follower,
        dashT: 0, dashCd: 0, hitCd: 0
      };
      return e;
    },
    player: function (id, x, y, form, speed) {
      var e = Entities.make({ id: id, kind: 'player', x: x, y: y, trueForm: form, r: 22, speed: speed });
      e.role = id;
      return e;
    }
  };

  /* ---------- world ---------- */
  G.World = {
    create: function () {
      var p1 = Entities.player('p1', 170, 500, 'centaur', C.speed.p1);
      var p2 = Entities.player('p2', 250, 560, 'mummy', C.speed.p2);
      return {
        time: 0, infection: 0, humanity: C.humanity.start, serum: C.serum.count,
        entities: [p1, p2], byId: { p1: p1, p2: p2 },
        p1: p1, p2: p2, controlled: 'p1',
        walls: [], puddles: [], props: [], zones: [],
        rocket: { x: 2230, y: 490, w: 120, h: 210 },
        candidates: [], suspectId: null, lockedId: null, followers: [],
        flags: {
          recognized: false, wrongPerson: false, truth: false,
          mapShifted: false, boarded: false, mirrorReveal: false,
          silenceFlash: false, escape: false
        },
        recog: { stage: 'IDLE', p1Pick: 0, p2Pick: 0, aiK: 0, attempts: 0, mistakes: 0, verifyDone: false },
        qte: { active: false, idx: 0, t0: 0, echoFollow: 0, echoAt: [], targetIsFake: false, result: null },
        horror: { done: {}, hoofT: 0, flicker: 0 },
        subs: [], prompt: '', aiReport: null, silencedUntil: 0,
        stat: { dashes: 0, hits: 0, mistakes: 0 }
      };
    },
    add: function (w, e) { w.entities.push(e); w.byId[e.id] = e; return e; },
    playerOf: function (w, role) { return role === 'p1' ? w.p1 : w.p2; },
    controlled: function (w) { return w.controlled === 'p1' ? w.p1 : w.p2; },
    living: function (w, kind) {
      return w.entities.filter(function (e) { return e.alive && (!kind || e.kind === kind); });
    }
  };

  /* ---------- perception: 同一 world，两套视觉 ---------- */
  /* 铁律：只改「画成什么」，绝不改坐标 / id / 碰撞 / 感染 */
  G.Perception = {
    ACTOR_KINDS: { player: 1, candidate: 1, zombie: 1, follower: 1 },
    project: function (w, mode, viewerId) {
      var truth = (mode === 'truth') || G.Game.debugTruth || w.flags.truth;
      var out = [];
      for (var i = 0; i < w.entities.length; i++) {
        var e = w.entities[i];
        if (!e.alive || !G.Perception.ACTOR_KINDS[e.kind]) continue;
        var self = (e.id === viewerId);
        var shape;
        if (truth) shape = e.trueForm;
        else if (self) shape = (viewerId === 'p1' ? 'centaur' : 'mummy');
        else shape = (mode === 'mummy' ? 'centaur' : 'mummy');
        var ghost = 0;
        if (mode === 'centaur' && e.ghostP1) ghost = 1;
        if (mode === 'mummy' && e.ghostP2) ghost = 1;
        var apparent = !!e.moving || !!ghost;
        out.push({
          id: e.id, ref: e, x: e.x, y: e.y, r: e.r, shape: shape,
          self: self, moving: !!e.moving, ghost: ghost, apparentMoving: apparent,
          isLover: e.isLover, isFake: e.isFake, locked: e.locked,
          follower: e.follower, trueForm: e.trueForm, phase: e.phase,
          alpha: e.hitCd > 0 ? .55 : 1,
          facing: e.facing
        });
      }
      return out;
    },
    /* 视角相关的「在动」序列：P2 侧顺序反过来 —— 相认技巧②的信息差来源 */
    movers: function (w, mode) {
      var list = G.Perception.project(w, mode, mode === 'mummy' ? 'p2' : 'p1')
        .filter(function (a) { return a.ref.kind === 'candidate' && a.apparentMoving; });
      list.sort(function (a, b) {
        var ka = a.x + a.y * .0001, kb = b.x + b.y * .0001;
        return mode === 'mummy' ? kb - ka : ka - kb;
      });
      return list;
    }
  };
})();
