/* 手电筒照射冻结：纯逻辑（不依赖 three.js），便于单测。
 * 规则：
 *  - 照到对方 → 对方冻结（不能移动、不能冲刺、不能辨认）。
 *  - 照方在冻结期间按确认键：Y（P1）或 '（P2）→ 是/否判定；判定后立即解除冻结。
 *  - 双向照射：两人各自独立结算，互不影响。
 *  - 冻结对象只能是 p1/p2，NPC 不参与。
 */
(function () {
  var G = window.G = window.G || {};
  var C = G.DATA.config;

  // 光束参数（与 render-three.js 的 SpotLight 保持一致，改动时两边一起改）
  var BEAM = { range: 12, halfAngle: Math.PI / 7 };

  function angleBetween(a, b) {
    var d = Math.max(-1, Math.min(1, a.x * b.x + a.z * b.z));
    return Math.acos(d);
  }

  // 判断 shooter 的光束是否命中 target（二维平面投影，单位：逻辑坐标，100 = 1m）
  // shooterDir: 归一化的水平朝向 {x, z}，与 forwardFor 的定义一致
  function beamHits(shooter, shooterDir, target, opts) {
    var range = (opts && opts.range) || BEAM.range * 100;
    var halfAngle = (opts && opts.halfAngle) || BEAM.halfAngle;
    if (!shooter || !target || shooter.floor !== target.floor) return false;
    // 游戏内坐标 x/y 对应渲染 X/Z（Z = y/100 - 4.9）；y 方向在 3D 里取负
    var dx = target.x - shooter.x, dy = target.y - shooter.y;
    var dist = Math.hypot(dx, dy);
    if (dist === 0 || dist > range) return false;
    // 把 (dx, dy) 转成和 forwardFor 同一坐标系下的方向：x->x，y->z
    var vertical = shooterDir.y || 0;
    var height = shooterDir.y === undefined ? 0 : -58;
    var length = Math.hypot(dx, dy, height);
    var dot = (shooterDir.x * dx + shooterDir.z * dy + vertical * height) / length;
    return Math.acos(Math.max(-1, Math.min(1, dot))) <= halfAngle;
  }

  // 冻结状态：w.beam = { lock: { [victimRole]: { by: shooterRole, since } }, pending: { [shooterRole]: victimRole } }
  function ensure(w) {
    if (!w.beam) w.beam = { lock: {}, pending: {}, suppressed: {} };
    return w.beam;
  }

  function isFrozen(w, role) {
    var b = w.beam;
    return !!(b && b.lock[role]);
  }

  // 松开光束后的自动解除时长（秒）。照方松开光束超过此时间，冻结自动解除。
  var RELEASE_AFTER = 1.5;

  // 每帧更新：
  //  - 照到对方 → 对方冻结（一次性加锁，记录照方）
  //  - 照方持续照着 → 记录 holding 时间为 0
  //  - 照方松开光束 → 累计松开时长，超过 RELEASE_AFTER 自动解除
  // dirs: { p1: {x,z}, p2: {x,z} } 当前朝向；dt：秒
  // 返回事件数组：{type:'freeze'|'autoRelease', role, by}
  function lightOn(p, time) {
    var e = p.beam || {};
    if (e.strobe) return (p.flashUntil || 0) > time;
    return !(e.blackoutEvery && time % e.blackoutEvery >= e.blackoutEvery - e.blackoutFor);
  }
  function flash(w, role) {
    var p = w[role];
    if (!p || !p.beam || !p.beam.strobe || (p.flashUntil || 0) > w.time) return false;
    p.flashUntil = w.time + 0.3;
    p.flashSerial = (p.flashSerial || 0) + 1;
    return true;
  }
  function hits(w, shooter, dir, target) {
    return lightOn(shooter, w.time) && beamHits(shooter, dir, target, shooter.beam) &&
      (!G.Renderer || !G.Renderer.canSee || G.Renderer.canSee(w, shooter, target));
  }
  function update(w, dirs, dt) {
    var b = ensure(w), events = [];
    dt = dt || 0;
    ['p1', 'p2'].forEach(function (shooter) {
      var victim = shooter === 'p1' ? 'p2' : 'p1';
      var p = w[shooter], hit = hits(w, p, dirs[shooter], w[victim]);
      var lock = b.lock[victim], strobe = p.beam && p.beam.strobe;
      if (lock && lock.flash) {
        lock.remaining -= dt;
        if (lock.remaining <= 0) { delete b.lock[victim]; events.push({type:'autoRelease', role:victim, by:shooter}); }
        return;
      }
      if (hit) {
        if (!lock && !b.suppressed[victim]) {
          if (strobe && p._hitFlashSerial === p.flashSerial) return;
          if (strobe) p._hitFlashSerial = p.flashSerial;
          b.lock[victim] = { by: shooter, since: w.time, releaseT: 0, flash: !!strobe, remaining: strobe ? 0.5 : 0 };
          events.push({ type: strobe ? 'flashFreeze' : 'freeze', role: victim, by: shooter });
        } else if (lock && lock.by === shooter) lock.releaseT = 0;
      } else {
        delete b.suppressed[victim];
        if (lock && lock.by === shooter) {
          lock.releaseT = (lock.releaseT || 0) + dt;
          if (lock.releaseT >= RELEASE_AFTER) { delete b.lock[victim]; events.push({type:'autoRelease',role:victim,by:shooter}); }
        }
      }
    });
    return events;
  }

  // 照方判定：answer = true(是) | false(否)。判定后立即解除冻结。
  // 键位由 hospital-demo.js 决定：P1 KeyY=是 / KeyN=否；P2 Quote=是 / Slash=否。
  // 返回 { ok, victim, shooter, answer }
  function confirm(w, shooter, answer) {
    var b = ensure(w);
    var victim = shooter === 'p1' ? 'p2' : 'p1';
    var lock = b.lock[victim];
    if (!lock || lock.by !== shooter || lock.flash) return { ok: false };
    delete b.lock[victim];
    b.suppressed[victim] = true;
    var record = { victim: victim, shooter: shooter, answer: !!answer, t: w.time };
    w.recognitionLog = (w.recognitionLog || []).concat([record]);
    return { ok: true, victim: victim, shooter: shooter, answer: !!answer };
  }

  // 冻结中的玩家不能移动、冲刺、辨认。持有"无所畏惧"卡的玩家忽略冻结。
  function canAct(w, role) {
    var p = w[role];
    if (p && p.beam && p.beam.ignoreFreeze) return true;
    return !isFrozen(w, role);
  }

  // ========== 开局抽卡 ==========
  // 每张卡的 effects 字段都是数值覆盖，render 与逻辑读取同一份配置
  var CARDS = [
    {
      id: 'brokenLens', name: '天崩开局',
      flavor: '电筒的玻璃裂了。你只能看见脚前一小片。',
      effects: { range: 5 * 100, halfAngle: Math.PI / 9 }
    },
    {
      id: 'strobe', name: '闪光灯',
      flavor: '电池接错了正负极。它只会亮一下，然后陷入黑暗。',
      effects: { strobe: true, flashFreeze: 0.5 }
    },
    {
      id: 'longRange', name: '千里眼',
      flavor: '你拿错了医生的手电。它照得很远，远到让人不安。',
      effects: { range: 18 * 100, halfAngle: Math.PI / 6 }
    },
    {
      id: 'flicker', name: '盲区',
      flavor: '灯泡在忽明忽暗地呼吸。',
      effects: { blackoutEvery: 40, blackoutFor: 5 }
    },
    {
      id: 'deafEar', name: '感官过载',
      flavor: '眼前的细节变得模糊，你认不出任何一张脸。',
      effects: { hideTraits: true }
    },
    {
      id: 'nerveless', name: '无所畏惧',
      flavor: '你没有听见那束光落在身上。',
      effects: { ignoreFreeze: true }
    }
  ];

  function drawCard(rng) {
    var r = typeof rng === 'function' ? rng() : Math.random();
    return CARDS[Math.floor(r * CARDS.length) % CARDS.length];
  }

  function effectiveBeam(card) {
    var base = { range: BEAM.range * 100, halfAngle: BEAM.halfAngle };
    if (!card) return base;
    var e = card.effects || {};
    return {
      range: e.range || base.range,
      halfAngle: e.halfAngle || base.halfAngle,
      strobe: !!e.strobe,
      flashFreeze: e.flashFreeze || 0,
      blackoutEvery: e.blackoutEvery || 0,
      blackoutFor: e.blackoutFor || 0,
      hideTraits: !!e.hideTraits,
      ignoreFreeze: !!e.ignoreFreeze
    };
  }

  G.Beam = {
    BEAM: BEAM,
    CARDS: CARDS,
    beamHits: beamHits,
    update: update,
    hits: hits,
    lightOn: lightOn,
    flash: flash,
    confirm: confirm,
    isFrozen: isFrozen,
    canAct: canAct,
    drawCard: drawCard,
    effectiveBeam: effectiveBeam,
    _ensure: ensure
  };
})();
