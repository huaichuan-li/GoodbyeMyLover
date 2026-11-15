/* 末日医院垂直切片：A 病房区 → B 镜面走廊 → C 发射通道（同一张连通网格） */
(function () {
  var G = window.G = window.G || {};
  var C = G.DATA.config;

  var Level = G.Level = {
    build: function (w) {
      w.zones = [
        { x: 430, y: 110, name: 'A · 病房区' },
        { x: 1420, y: 110, name: 'B · 镜面走廊' },
        { x: 2130, y: 110, name: 'C · 发射通道' }
      ];
      w.walls = [
        { x: 0, y: 0, w: 2400, h: 36 }, { x: 0, y: 944, w: 2400, h: 36 },
        { x: 0, y: 0, w: 36, h: 980 }, { x: 2364, y: 0, w: 36, h: 980 },
        { x: 300, y: 150, w: 150, h: 62, kind: 'bed' },
        { x: 300, y: 740, w: 150, h: 62, kind: 'bed' },
        { x: 560, y: 150, w: 150, h: 62, kind: 'bed' },
        { x: 560, y: 740, w: 150, h: 62, kind: 'bed' },
        { x: 980, y: 120, w: 26, h: 250, kind: 'curtain' },
        { x: 980, y: 640, w: 26, h: 250, kind: 'curtain' },
        { x: 1260, y: 120, w: 26, h: 230, kind: 'curtain' },
        { x: 1260, y: 660, w: 26, h: 230, kind: 'curtain' },
        { x: 1600, y: 150, w: 160, h: 62, kind: 'bed' },
        { x: 1600, y: 760, w: 160, h: 62, kind: 'bed' },
        { x: 1880, y: 250, w: 40, h: 130 },
        { x: 1880, y: 620, w: 40, h: 130 },
        { x: 1700, y: 200, w: 140, h: 34, kind: 'bed' }   // 地图自我改写时移动这一堵
      ];
      w.puddles = [
        { x: 830, y: 520, r: 112 },
        { x: 1380, y: 480, r: 96 },
        { x: 2030, y: 500, r: 82 }
      ];

      // 5 个候选：两侧「在动」的集合不同、排序相反 → 必须交换信息才能锁定
      var spots = [
        { x: 760, y: 360, g1: true, g2: true, lover: true },  // 真爱人：P1 侧第 2 / P2 侧第 3
        { x: 650, y: 610, g1: true, g2: false },
        { x: 805, y: 300, g1: false, g2: true },
        { x: 890, y: 640, g1: true, g2: true },
        { x: 950, y: 430, g1: false, g2: false }
      ];
      for (var i = 0; i < spots.length; i++) {
        var s = spots[i];
        var e = G.Entities.make({
          id: 'c' + i, kind: 'candidate', x: s.x, y: s.y, r: 21,
          trueForm: s.lover ? 'mummy' : 'fake',
          isLover: !!s.lover, isFake: !s.lover,
          ghostP1: s.g1, ghostP2: s.g2
        });
        G.World.add(w, e);
        w.candidates.push(e.id);
        if (s.lover) w.suspectId = e.id;
      }

      var zs = [
        { x: 1150, y: 300 }, { x: 1230, y: 700 }, { x: 1520, y: 380 },
        { x: 1700, y: 620 }, { x: 1920, y: 440 }, { x: 2100, y: 700 }
      ];
      for (var z = 0; z < zs.length; z++) {
        G.World.add(w, G.Entities.make({
          id: 'z' + z, kind: 'zombie', x: zs[z].x, y: zs[z].y,
          r: 19, trueForm: 'zombie', speed: 46
        }));
      }
      G.World.add(w, G.Entities.make({ id: 's1', kind: 'pickup', x: 520, y: 300, r: 12, trueForm: 'serum' }));
      G.World.add(w, G.Entities.make({ id: 's2', kind: 'pickup', x: 1500, y: 700, r: 12, trueForm: 'serum' }));

      w.rocket = { x: 2230, y: 490, w: 120, h: 210 };
    }
  };

  /* 时间轴：阶段推进的保底（玩家操作优先，避免展示时卡住） */
  G.Timeline = {
    seen: {},
    update: function (w, dt) {
      var T = C.timeline, st = w.recog.stage;
      if ((w.time >= T.candidates || w.p1.x > 560) && st === 'IDLE') G.Recognition.begin(w);
      if (w.time >= T.qte && st === 'LOCK') {
        w.recog.reported.p1 = true; w.recog.reported.p2 = true;
        G.Recognition.exchangeLock(w);
      }
      if (w.time >= T.verify && w.qte.active) G.Recognition.qteResolve(w, 'FAIL');
      if (w.time >= T.mapShift && !w.flags.verifyDone) G.Recognition.forceVerify(w);
      if (w.time >= T.choice) G.Timeline.toChoice(w);
    },
    toChoice: function (w) {
      if (G.State.current === 'CHOICE' || G.State.current === 'RESULT') return;
      G.Recognition.forceVerify(w);
      G.State.set('CHOICE');
      G.UI.overlay('choice');
      G.Synth.bandage();
    }
  };
})();
