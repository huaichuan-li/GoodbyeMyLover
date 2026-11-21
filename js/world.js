/* 唯一世界状态 + 实体工厂 + 感知投影层 */
(function () {
  var G = window.G = window.G || {};
  var C = G.DATA.config;

  /* ---------- entity factory ---------- */
  var uid = 0;
  var Entities = G.Entities = {
    make: function (o) {
      var e = {
        id: o.id || ('e' + (++uid)), kind: o.kind || 'prop', floor: o.floor || 1,
        x: o.x || 0, y: o.y || 0, vx: 0, vy: 0,
        r: o.r || 20, speed: o.speed || 0,
        facing: { x: 1, y: 0 }, moving: false, alive: true,
        trueForm: o.trueForm || 'human',
        isLover: !!o.isLover, isFake: !!o.isFake,
        ghostP1: !!o.ghostP1, ghostP2: !!o.ghostP2,
        blink: o.blink || 0, phase: Math.random() * 6.28,
        label: o.label || '', locked: false, follower: !!o.follower,
        dashT: 0, dashCd: 0, hitCd: 0, hp:100, stamina:100, phone:false, clues:[], explored:{1:{}}, inbox:[],
        heartRate:60, heartLevel:0, visionBlur:0, dangerT:0, downed:false, reviveProgress:0,
        traits:[], notice:'', noticeUntil:0
      };
      // 保留关卡提供的线索、NPC 行为等扩展字段。
      return Object.assign(e, o);
    },
    player: function (id, x, y, form, speed) {
      var e = Entities.make({ id: id, kind: 'player', x: x, y: y, trueForm: form, r: 22, speed: speed });
      e.role = id;
      return e;
    }
  };

  /* ---------- world ---------- */
  G.World = {
    create: function (opts) {
      // 每局从分散的成对出生区抽签，维持至少约 9 米距离，开场不能直接互相确认。
      // Place both players in the clear center of a doorway. Earlier starts
      // could land 5 px outside an opening; the player's 22 px collision radius
      // then sealed both forward and backward movement against the wall.
      // 同层首版：A/B 从同一层两端出发，路线中间必须穿过危险区。
      // 保留六组不同楼层/端点组合，方便回归测试和调试模式复现。
      // 单层化：所有出生点固定在 1F，保留六组不同端点组合供测试/调试复现。
      var starts = [[{x:485,y:490,floor:1},{x:1885,y:490,floor:1}],[{x:835,y:490,floor:1},{x:1535,y:490,floor:1}],[{x:1885,y:490,floor:1},{x:485,y:490,floor:1}],[{x:1535,y:490,floor:1},{x:835,y:490,floor:1}],[{x:1885,y:490,floor:1},{x:835,y:490,floor:1}],[{x:485,y:490,floor:1},{x:1535,y:490,floor:1}]];
      var debug = !!(opts && opts.debug);
      var spawn;
      if (opts && opts.sameFloor) {
        var sf = 1;
        var left = opts.left || 485, right = opts.right || 1885;
        spawn = [{x:left,y:490,floor:sf},{x:right,y:490,floor:sf}];
      } else if (debug) {
        // 调试模式：两人同楼层、同一门洞附近，左右各偏移 40 逻辑单位（共 80 ≈ 0.8m），
        // 够两人碰撞半径（各 22）不重叠卡死，又几乎贴在一起，一睁眼就能看到对方。
        var base = starts[0][0];
        spawn = [
          { x: base.x - 40, y: base.y, floor: base.floor },
          { x: base.x + 40, y: base.y, floor: base.floor }
        ];
      } else {
        spawn = starts[Math.floor(Math.random()*starts.length)];
      }
      // 全员木乃伊：两名玩家同一基础体型（旧的人马形态已撤销，见《人物设定与美术交付说明》）。
      var p1=Entities.player('p1',spawn[0].x,spawn[0].y,'mummy',C.speed.p1),p2=Entities.player('p2',spawn[1].x,spawn[1].y,'mummy',C.speed.p2);
      p1.floor=spawn[0].floor;p2.floor=spawn[1].floor;
      return {
        time: 0, infection: 0, humanity: C.humanity.start, serum: 0, phoneMessages:[], floorCount:1, floorNames:{1:'一楼'}, ended:false,
        sharedHp: 100, sharedHpMax: 100, downedRole: null, downedAt: 0,
        recognition: { state:'idle', startedAt:0, expiresAt:0, initiator:null, participants:{} },
        escape: { active:false, enemiesSpawned:false, enemyCount:6, exitReady:false },
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
        recog: { stage: 'IDLE', p1Pick: 0, p2Pick: 0, aiK: 0, attempts: 0, mistakes: 0, verifyDone: false, clueA: false, clueB: false, relay: false, together: false },
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
