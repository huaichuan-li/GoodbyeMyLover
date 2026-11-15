/* 程序化剪影 / 雾与光照 / 单 canvas 双 viewport / 水坑 truth 倒影 */
(function () {
  var G = window.G = window.G || {};
  var C = G.DATA.config, U = G.utils, COL = C.colors;
  var canvas, ctx, W = 0, H = 0, dpr = 1, tile = null;

  function makeTile() {
    var c = document.createElement('canvas'); c.width = c.height = 256;
    var g = c.getContext('2d');
    g.fillStyle = COL.floor; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(140,170,185,.10)'; g.lineWidth = 1;
    for (var i = 0; i <= 256; i += 32) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke();
      g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke();
    }
    var rnd = U.rnd(9721);
    for (var n = 0; n < 460; n++) {
      g.fillStyle = 'rgba(170,190,200,' + (rnd() * .055).toFixed(3) + ')';
      g.fillRect(rnd() * 256, rnd() * 256, 1.5, 1.5);
    }
    return c;
  }

  /* ---------- 剪影 ---------- */
  function face(g, x, y, r) {
    // 「同脸」：所有活物共用一张脸，只有体态暴露真相
    g.fillStyle = '#010305';
    g.beginPath(); g.ellipse(x, y, r, r * 1.15, 0, 0, 6.2832); g.fill();
    g.strokeStyle = 'rgba(190,205,215,.3)'; g.lineWidth = .8; g.stroke();
    g.fillStyle = 'rgba(210,220,225,.45)';
    g.fillRect(x - r * .45, y - r * .1, 1.5, 1.5);
    g.fillRect(x + r * .28, y - r * .1, 1.5, 1.5);
  }
  function bodyCentaur(g) {
    g.beginPath(); g.ellipse(-2, 4, 20, 10, 0, 0, 6.2832); g.fill();           // 马身
    g.fillRect(-16, 10, 4.5, 16); g.fillRect(-6, 11, 4.5, 15);
    g.fillRect(7, 11, 4.5, 15); g.fillRect(14, 10, 4.5, 16);                  // 四蹄
    g.beginPath(); g.moveTo(15, 0); g.lineTo(25, 12); g.lineTo(21, 14); g.lineTo(12, 4); g.fill();
    g.beginPath(); g.moveTo(-10, 2); g.lineTo(-4, -20); g.lineTo(6, -20); g.lineTo(10, 2); g.fill();
    g.fillRect(-9, -19, 3.5, 12); g.fillRect(5, -19, 3.5, 12);
    face(g, 1, -27, 6.5);
  }
  function bodyMummy(g) {
    g.beginPath(); g.moveTo(-9, -18); g.lineTo(9, -18); g.lineTo(11, 20); g.lineTo(-11, 20); g.closePath(); g.fill();
    g.fillRect(-13, -16, 3.5, 22); g.fillRect(9, -16, 3.5, 22);
    g.fillRect(-7, 19, 5, 9); g.fillRect(2, 19, 5, 9);
    face(g, 0, -25, 7.5);
    g.strokeStyle = 'rgba(205,212,205,.42)'; g.lineWidth = 1.1;
    for (var i = 0; i < 8; i++) {
      var y = -16 + i * 5;
      g.beginPath(); g.moveTo(-11, y); g.lineTo(11, y + 2.6); g.stroke();
    }
    g.beginPath(); g.moveTo(11, 2); g.quadraticCurveTo(22, 8, 18, 19); g.stroke();
  }
  function bodyHuman(g) {
    g.beginPath(); g.moveTo(-8, -16); g.lineTo(8, -16); g.lineTo(9, 20); g.lineTo(-9, 20); g.closePath(); g.fill();
    g.fillRect(-12, -15, 3.5, 20); g.fillRect(8, -15, 3.5, 20);
    g.fillRect(-7, 19, 5, 10); g.fillRect(2, 19, 5, 10);
    face(g, 0, -23, 7);
  }
  function bodyZombie(g) {
    g.save(); g.rotate(.16);
    g.beginPath(); g.moveTo(-9, -14); g.lineTo(8, -18); g.lineTo(10, 20); g.lineTo(-10, 18); g.closePath(); g.fill();
    g.fillRect(-16, -12, 14, 3.5); g.fillRect(6, -16, 14, 3.5);
    face(g, -1, -22, 7);
    g.restore();
  }
  function bodyFake(g) {
    g.save(); g.rotate(-.1);
    g.beginPath(); g.moveTo(-11, -18); g.lineTo(8, -15); g.lineTo(13, 21); g.lineTo(-8, 22); g.closePath(); g.fill();
    g.fillRect(-15, -14, 4, 26); g.fillRect(9, -13, 4, 22);
    face(g, -1, -25, 7.5);
    g.strokeStyle = 'rgba(190,105,95,.5)'; g.lineWidth = 1.4;
    for (var i = 0; i < 5; i++) { g.beginPath(); g.moveTo(-10, -10 + i * 7); g.lineTo(11, -4 + i * 7); g.stroke(); }
    g.restore();
  }

  function drawActor(g, a, px, py, s, opts) {
    var bob = a.apparentMoving ? Math.sin(a.phase + performance.now() / 340) * 2.2 : 0;
    py += bob;
    g.save();
    g.translate(px, py);
    g.globalAlpha = a.alpha;
    g.fillStyle = 'rgba(0,0,0,.55)';
    g.beginPath(); g.ellipse(0, 27 * s, 22 * s, 6 * s, 0, 0, 6.2832); g.fill();
    g.scale(s, s);

    // 选中 / 自己：只画环，不画实心球
    if (opts.selected || a.locked || opts.self) {
      g.strokeStyle = a.self ? 'rgba(200,161,90,.55)' : (a.locked ? 'rgba(111,138,145,.9)' : 'rgba(200,161,90,.9)');
      g.lineWidth = 1.5;
      g.beginPath(); g.ellipse(0, 4, 29, 34, 0, 0, 6.2832); g.stroke();
    }
    g.fillStyle = a.self ? 'rgba(200,161,90,.045)' : 'rgba(150,180,195,.055)';
    g.beginPath(); g.ellipse(0, 4, 29, 34, 0, 0, 6.2832); g.fill();

    // 边缘光：让纯黑剪影从暗背景里浮出来
    g.shadowColor = a.self ? 'rgba(200,161,90,.85)' : (a.apparentMoving ? 'rgba(168,196,208,.8)' : 'rgba(140,168,180,.55)');
    g.shadowBlur = a.self ? 14 : 9;
    g.fillStyle = a.self ? '#0b1118' : COL.silhouette;
    var sh = a.shape;
    if (sh === 'centaur') bodyCentaur(g);
    else if (sh === 'mummy') bodyMummy(g);
    else if (sh === 'zombie' || sh === 'infected') bodyZombie(g);
    else if (sh === 'fake') bodyFake(g);
    else bodyHuman(g);
    g.shadowBlur = 0;
    g.restore();

    g.save();
    g.textAlign = 'center'; g.font = (11 * Math.max(s, .8)).toFixed(1) + 'px "PingFang SC",sans-serif';
    if (a.self) {
      g.fillStyle = COL.amber;
      g.fillText(opts.tag, px, py - 46 * s);
    } else if (opts.index > 0) {
      g.fillStyle = opts.selected ? COL.amber : 'rgba(205,215,220,.85)';
      g.fillText(String(opts.index), px, py - 44 * s);
      if (a.apparentMoving) {
        g.fillStyle = 'rgba(200,161,90,.8)';
        g.beginPath(); g.arc(px, py - 34 * s, 2, 0, 6.2832); g.fill();
      }
    }
    g.restore();
  }

  /* ---------- 静态场景 ---------- */
  function drawWalls(g, w, cam, viewW, viewH, scale, vp) {
    var left = cam.x - viewW / 2, top = cam.y - viewH / 2;
    for (var i = 0; i < w.walls.length; i++) {
      var r = w.walls[i];
      if (r.x + r.w < left - 40 || r.x > left + viewW + 40) continue;
      var x = vp.x + vp.w / 2 + (r.x - cam.x) * scale;
      var y = vp.y + vp.h / 2 + (r.y - cam.y) * scale;
      var ww = r.w * scale, hh = r.h * scale;
      g.fillStyle = COL.wall; g.fillRect(x, y, ww, hh);
      g.strokeStyle = 'rgba(150,180,195,.18)'; g.lineWidth = 1; g.strokeRect(x + .5, y + .5, ww - 1, hh - 1);
      if (r.kind === 'bed') {
        g.fillStyle = 'rgba(160,180,190,.09)';
        g.fillRect(x + 5, y + 5, ww - 10, hh - 10);
        g.strokeStyle = 'rgba(165,185,195,.16)';
        g.beginPath(); g.moveTo(x + ww * .3, y); g.lineTo(x + ww * .3, y + hh); g.stroke();
      }
      if (r.kind === 'curtain') {
        g.strokeStyle = 'rgba(160,180,190,.15)';
        for (var k = 6; k < ww; k += 9) { g.beginPath(); g.moveTo(x + k, y); g.lineTo(x + k, y + hh); g.stroke(); }
      }
    }
  }

  function drawZones(g, w, cam, scale, vp) {
    g.save(); g.textAlign = 'center';
    g.font = '13px "PingFang SC",sans-serif';
    for (var i = 0; i < w.zones.length; i++) {
      var z = w.zones[i];
      var x = vp.x + vp.w / 2 + (z.x - cam.x) * scale;
      var y = vp.y + vp.h / 2 + (z.y - cam.y) * scale;
      if (x < vp.x - 100 || x > vp.x + vp.w + 100) continue;
      g.fillStyle = 'rgba(165,185,195,.32)';
      g.fillText(z.name, x, y);
    }
    g.restore();
  }

  function drawPuddle(g, w, a, cam, scale, vp, mode, viewerId) {
    var px = vp.x + vp.w / 2 + (a.x - cam.x) * scale;
    var py = vp.y + vp.h / 2 + (a.y - cam.y) * scale;
    var rx = a.r * scale, ry = a.r * .42 * scale;
    if (px < vp.x - rx * 2 || px > vp.x + vp.w + rx * 2) return;
    g.save();
    g.beginPath(); g.ellipse(px, py, rx, ry, 0, 0, 6.2832); g.clip();
    g.fillStyle = 'rgba(88,122,136,.28)'; g.fillRect(px - rx, py - ry, rx * 2, ry * 2);
    var reveal = w.flags.mirrorReveal;
    var actors = G.Perception.project(w, 'truth', viewerId);
    for (var i = 0; i < actors.length; i++) {
      var e = actors[i];
      if (e.ref.kind !== 'candidate' && e.ref.kind !== 'player') continue;
      var isLocked = !!w.lockedId && e.id === w.lockedId;
      var ex;
      if (reveal && isLocked) {
        ex = px;                                  // 验证时把锁定目标固定映在坑中央
      } else {
        var lim = reveal ? 3 : 1.6;
        if (Math.abs(e.x - a.x) > a.r * lim || Math.abs(e.y - a.y) > a.r * (lim * .8)) continue;
        ex = vp.x + vp.w / 2 + (e.x - cam.x) * scale;
      }
      g.save();
      g.globalAlpha = (reveal && isLocked) ? .95 : (reveal ? .55 : .32);
      g.translate(ex, py + ry * .2); g.scale(scale * .7, -scale * .5);
      g.fillStyle = e.id === w.suspectId ? 'rgba(205,220,225,.95)' : 'rgba(150,170,180,.7)';
      if (e.trueForm === 'centaur') bodyCentaur(g);
      else if (e.trueForm === 'mummy') bodyMummy(g);
      else if (e.trueForm === 'fake') bodyFake(g);
      else bodyHuman(g);
      g.restore();
    }
    g.restore();
    if (reveal && w.lockedId) {
      g.save();
      g.font = '10px "PingFang SC",sans-serif'; g.textAlign = 'center';
      g.fillStyle = 'rgba(140,180,195,.9)';
      g.fillText('倒 影 · 真 形', px, py - ry - 10);
      g.restore();
    }
    g.save();
    g.strokeStyle = reveal ? 'rgba(120,170,190,.8)' : 'rgba(110,150,170,.4)';
    g.lineWidth = 1.2; g.beginPath(); g.ellipse(px, py, rx, ry, 0, 0, 6.2832); g.stroke();
    g.restore();
  }

  function drawRocket(g, w, cam, scale, vp) {
    var r = w.rocket;
    var x = vp.x + vp.w / 2 + (r.x - cam.x) * scale;
    var y = vp.y + vp.h / 2 + (r.y - cam.y) * scale;
    if (x < vp.x - 200 || x > vp.x + vp.w + 200) return;
    var rw = r.w * scale, rh = r.h * scale;
    g.save();
    var glow = g.createRadialGradient(x, y, 4, x, y, rh * .9);
    glow.addColorStop(0, 'rgba(200,161,90,.24)'); glow.addColorStop(1, 'rgba(200,161,90,0)');
    g.fillStyle = glow; g.fillRect(x - rh, y - rh, rh * 2, rh * 2);
    g.fillStyle = '#101a22'; g.strokeStyle = 'rgba(200,161,90,.65)'; g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(x, y - rh / 2); g.lineTo(x + rw / 2, y + rh * .18); g.lineTo(x + rw / 2, y + rh / 2);
    g.lineTo(x - rw / 2, y + rh / 2); g.lineTo(x - rw / 2, y + rh * .18); g.closePath();
    g.fill(); g.stroke();
    g.fillStyle = 'rgba(200,161,90,.7)';
    g.beginPath(); g.arc(x, y - rh * .12, 5 * scale + 2, 0, 6.2832); g.fill();
    g.fillStyle = 'rgba(150,175,185,.2)'; g.fillRect(x - rw * .8, y + rh / 2, rw * 1.6, 6);
    g.restore();
  }

  function drawLighting(g, vp, px, py, muted) {
    var rad = Math.max(vp.w, vp.h) * .92;
    var grd = g.createRadialGradient(px, py, rad * .18, px, py, rad);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(.45, 'rgba(0,0,0,.08)');
    grd.addColorStop(1, muted ? 'rgba(0,0,0,.80)' : 'rgba(0,0,0,.56)');
    g.fillStyle = grd; g.fillRect(vp.x, vp.y, vp.w, vp.h);
    var t = performance.now() / 1000;
    g.save(); g.globalAlpha = .055;
    for (var i = 0; i < 3; i++) {
      var yy = vp.y + vp.h * (.25 + i * .26) + Math.sin(t * .25 + i) * 18;
      var fg = g.createLinearGradient(vp.x, yy - 40, vp.x, yy + 40);
      fg.addColorStop(0, 'rgba(130,160,175,0)');
      fg.addColorStop(.5, 'rgba(150,180,195,.9)');
      fg.addColorStop(1, 'rgba(130,160,175,0)');
      g.fillStyle = fg; g.fillRect(vp.x, yy - 40, vp.w, 80);
    }
    g.restore();
  }

  /* ---------- 单个 viewport ---------- */
  function renderView(w, vp, mode, viewerId, tag) {
    var duo = (G.Game.mode === 'duo' || G.Game.dualView);
    var viewW = duo ? C.view.duoWidth : C.view.soloWidth;
    var scale = vp.w / viewW;
    var viewH = vp.h / scale;
    var focus = G.World.playerOf(w, viewerId);
    var cam = duo
      ? { x: (w.p1.x + w.p2.x) / 2, y: (w.p1.y + w.p2.y) / 2 }
      : { x: G.World.controlled(w).x, y: G.World.controlled(w).y };
    cam.x = U.clamp(cam.x, viewW / 2, C.world.w - viewW / 2);
    cam.y = U.clamp(cam.y, viewH / 2, Math.max(viewH / 2, C.world.h - viewH / 2));

    ctx.save();
    ctx.beginPath(); ctx.rect(vp.x, vp.y, vp.w, vp.h); ctx.clip();
    ctx.fillStyle = COL.bg; ctx.fillRect(vp.x, vp.y, vp.w, vp.h);

    if (tile) {
      var pat = ctx.createPattern(tile, 'repeat');
      ctx.save();
      ctx.translate(vp.x + vp.w / 2 - cam.x * scale, vp.y + vp.h / 2 - cam.y * scale);
      ctx.scale(scale, scale);
      ctx.fillStyle = pat;
      ctx.fillRect(cam.x - viewW / 2 - 300, cam.y - viewH / 2 - 300, viewW + 600, viewH + 600);
      ctx.restore();
    }

    drawZones(ctx, w, cam, scale, vp);
    drawWalls(ctx, w, cam, viewW, viewH, scale, vp);
    drawRocket(ctx, w, cam, scale, vp);
    for (var p = 0; p < w.puddles.length; p++) drawPuddle(ctx, w, w.puddles[p], cam, scale, vp, mode, viewerId);

    var actors = G.Perception.project(w, mode, viewerId);
    actors.sort(function (a, b) { return a.y - b.y; });
    for (var i = 0; i < actors.length; i++) {
      var a = actors[i];
      var px = vp.x + vp.w / 2 + (a.x - cam.x) * scale;
      var py = vp.y + vp.h / 2 + (a.y - cam.y) * scale;
      if (px < vp.x - 80 || px > vp.x + vp.w + 80 || py < vp.y - 100 || py > vp.y + vp.h + 100) continue;
      var idx = 0, selected = false;
      if (G.Recognition && G.Recognition.indexFor) idx = G.Recognition.indexFor(w, mode, a.id);
      if (G.Recognition && G.Recognition.isPicked) selected = G.Recognition.isPicked(w, mode, a.id);
      drawActor(ctx, a, px, py, scale * 1.65 * (a.r / 20), { self: a.self, tag: tag, index: idx, selected: selected });
    }

    var fpx = vp.x + vp.w / 2 + (focus.x - cam.x) * scale;
    var fpy = vp.y + vp.h / 2 + (focus.y - cam.y) * scale;
    drawLighting(ctx, vp, fpx, fpy, G.Audio.isMuted());

    ctx.save();
    ctx.font = '11px "PingFang SC",sans-serif'; ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(200,161,90,.6)';
    ctx.fillText(tag + ' · ' + (mode === 'truth' ? '真形' : (mode === 'centaur' ? '你看见的：都是她' : '你看见的：都是他')), vp.x + 16, vp.y + vp.h - 18);
    ctx.restore();
    ctx.restore();
  }

  function idle() {
    ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, W, H);
    var t = performance.now() / 1000;
    for (var i = 0; i < 7; i++) {
      var x = W * (.12 + i * .13), y = H * .62 + Math.sin(t * .4 + i) * 12;
      ctx.save(); ctx.globalAlpha = .3; ctx.translate(x, y); ctx.scale(2.4, 2.4);
      ctx.shadowColor = 'rgba(140,170,185,.6)'; ctx.shadowBlur = 8;
      ctx.fillStyle = COL.silhouette;
      if (i % 2) bodyMummy(ctx); else bodyCentaur(ctx);
      ctx.restore();
    }
    var grd = ctx.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, W * .7);
    grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(0,0,0,.88)');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, W, H);
  }

  G.Renderer = {
    resize: function () {
      canvas = U.el('game'); ctx = canvas.getContext('2d');
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth; H = window.innerHeight;
      canvas.width = Math.floor(W * dpr); canvas.height = Math.floor(H * dpr);
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!tile) tile = makeTile();
    },
    renderAll: function () {
      if (!ctx) return;
      var w = G.Game.world;
      if (!w || G.State.current === 'TITLE' || G.State.current === 'BRIEF') { idle(); return; }
      var duo = (G.Game.mode === 'duo' || G.Game.dualView);
      if (duo) {
        renderView(w, { x: 0, y: 0, w: W / 2, h: H }, 'centaur', 'p1', 'A');
        renderView(w, { x: W / 2, y: 0, w: W / 2, h: H }, 'mummy', 'p2', 'B');
      } else {
        renderView(w, { x: 0, y: 0, w: W, h: H }, 'centaur', 'p1', 'A');
      }
    }
  };
})();
