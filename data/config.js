/* 全部数值集中在此；file:// 下不依赖 fetch，直接挂到 G.DATA */
(function () {
  var G = window.G = window.G || {};
  G.DATA = G.DATA || {};
  G.DATA.config = {
    step: 1 / 60,
    world: { w: 2400, h: 980, pad: 60 },
    view: { duoWidth: 1020, soloWidth: 1420, aspectKeep: true },
    speed: { p1: 205, p2: 178, dash: 540, dashTime: .28, dashCd: 1.1 },
    stamina: { max: 100, moveCost: .8, dashCost: 12, recover: 5, lowThreshold: 25, lowSpeedMul: .7 },
    npc: { count: 7, pickupRadius: 90 },
    phone: { max: 100, idleDrain: 0, smsCost: 0 },
    infection: {
      base: 1.15, dash: 3, touch: 8, mistake: 12, serum: -35,
      accelerateAt: 240, accelerateMul: 1.8, max: 100
    },
    humanity: { start: 100, mistake: -15, abandon: -25, correct: 10, give: 20, block: 8 },
    noBack: { free: 30, sideOnly: 60 },
    qte: {
      window: .18,
      pattern: [0, .26, .52, 1.02],       // 三短一长
      echoDelay: .55,                     // 半拍 + 0.30s
      echoTolerance: .11,
      echoMax: 2,
      lead: 1.1                           // 起拍前的准备时间
    },
    silence: { short: 1.5, long: 2.0 },
    timeline: {
      silence1: 50, candidates: 70, lock: 80, silence2: 170,
      qte: 140, verify: 200, mapShift: 220, escape: 240, choice: 280, hardEnd: 300
    },
    serum: { count: 2 },
    recognition: { candidateCount: 5 },
    colors: {
      bg: '#0a0f14', wall: '#1c262f', floor: '#16202a', ink: '#d8d2c4',
      amber: '#c8a15a', red: '#b4453c', cold: '#6f8a91', silhouette: '#04080c',
      rim: 'rgba(158,186,198,.62)'
    }
  };
})();
