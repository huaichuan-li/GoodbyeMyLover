/* HUD（会撒谎）/ 拟声字幕 / QTE 节奏条 / 标题·剧情·抉择·结局卡 */
(function () {
  var G = window.G = window.G || {};
  var C = G.DATA.config, S = G.DATA.script, U = G.utils;
  var D = {};

  function html(s) { return String(s).replace(/\n/g, '<br>'); }

  var UI = G.UI = {
    init: function () {
      ['hud-left', 'hud-right', 'split-line', 'prompt', 'subtitles', 'overlay', 'card',
        'qte', 'qte-cursor', 'qte-beats', 'qte-hint', 'flash',
        'bar-inf-a', 'bar-inf-b', 'bar-hum-a', 'bar-hum-b',
        'num-inf-a', 'num-inf-b', 'num-hum-a', 'num-hum-b', 'hud-foot-a', 'hud-foot-b']
        .forEach(function (id) { D[id] = U.el(id); });
      G.Events.on('silence', function (on) {
        D.flash.classList.toggle('on', !!on);
        if (on) setTimeout(function () { D.flash.classList.remove('on'); }, 240);
      });
      G.Events.on('truth', function () {
        D.flash.classList.add('on');
        setTimeout(function () { D.flash.classList.remove('on'); }, 700);
      });
    },
    overlay: function (kind, key) {
      var c = D.card;
      if (!kind) { D.overlay.classList.remove('show'); return; }
      var out = '';
      if (kind === 'title') {
        out = '<h1>' + S.title + '</h1><div class="sub">' + S.subtitle + ' · ' + S.theme + '</div>'
          + S.premise.map(function (p) { return '<p>' + p + '</p>'; }).join('')
          + '<div class="go">按 任 意 键 继 续</div>';
      } else if (kind === 'brief') {
        var keys = S.keys.map(function (k) { return '<div><b>' + k[0] + '</b><br>' + k[1] + '</div>'; }).join('');
        out = '<h2>末 日 第 四 十 一 天</h2>'
          + S.brief.map(function (p) { return '<p>' + p + '</p>'; }).join('')
          + '<div class="keys">' + keys + '</div>'
          + '<div class="go">按 1 单 机（AI 同伴）　/　按 2 双 人 同 屏</div>';
      } else if (kind === 'choice') {
        out = '<h2>' + S.lines.choiceTitle + '</h2><p>' + S.lines.choiceSub + '</p>'
          + S.lines.choiceOpts.map(function (o) { return '<div class="opt">' + html(o) + '</div>'; }).join('')
          + '<div class="go">按 1 / 2 / 3 选 择</div>';
      } else if (kind === 'ending') {
        var e = S.endings[key] || S.endings.timeout;
        var w = G.Game.world;
        out = '<h2>' + e.name + '</h2><div class="ending">' + html(e.text) + '</div>'
          + '<div class="stat">用时 ' + U.fmt(w ? w.time : 0)
          + ' · 感染 ' + Math.round(w ? w.infection : 0)
          + ' · 人性 ' + Math.round(w ? w.humanity : 0)
          + ' · 认错 ' + (w ? w.stat.mistakes : 0) + ' 次</div>'
          + '<div class="go">按 R 回 到 标 题</div>';
      }
      c.innerHTML = out;
      D.overlay.classList.add('show');
    },
    showQTE: function (w) { D.qte.classList.remove('hidden'); UI.qteBeats(w); },
    hideQTE: function () { D.qte.classList.add('hidden'); },
    qteBeats: function (w) {
      var q = w.qte, span = C.qte.lead + C.qte.pattern[3] + .4;
      var s = '';
      for (var i = 0; i < C.qte.pattern.length; i++) {
        var pct = (C.qte.lead + C.qte.pattern[i]) / span * 100;
        var cls = q.hits.indexOf(i) >= 0 ? ' hit' : (q.result && q.result !== 'SUCCESS' ? ' miss' : '');
        s += '<div class="qte-beat' + cls + '" style="left:' + pct.toFixed(2) + '%"></div>';
      }
      for (var j = 0; j < q.echoAt.length; j++) {
        var ep = (C.qte.lead + (q.echoAt[j] - q.t0)) / span * 100;
        if (ep > 0 && ep < 100) s += '<div class="qte-beat echo" style="left:' + ep.toFixed(2) + '%"></div>';
      }
      D['qte-beats'].innerHTML = s;
    },
    update: function (w) {
      var duo = (G.Game.mode === 'duo' || G.Game.dualView);
      D['split-line'].classList.toggle('off', !duo);
      D['hud-right'].classList.toggle('off', !duo);
      D['hud-left'].classList.toggle('off', G.State.current === 'TITLE' || G.State.current === 'BRIEF');

      // HUD 偶尔撒谎：感染越深越不可信
      var lie = w.infection > 38 && (Math.floor(w.time * 1.3) % 11 === 0);
      var inf = Math.round(w.infection), hum = Math.round(w.humanity);
      D['bar-inf-a'].style.width = inf + '%'; D['bar-inf-b'].style.width = inf + '%';
      D['bar-hum-a'].style.width = hum + '%'; D['bar-hum-b'].style.width = hum + '%';
      D['num-inf-a'].textContent = lie ? '??' : inf;
      D['num-inf-b'].textContent = lie ? '1??' : inf;
      D['num-hum-a'].textContent = lie ? '??' : hum;
      D['num-hum-b'].textContent = lie ? '??' : hum;
      D['hud-foot-a'].textContent = '血清 ×' + w.serum + ' · ' + U.fmt(w.time);
      D['hud-foot-b'].textContent = lie ? S.lines.hudLies[3] : '共用一条命';

      // 字幕
      D.subtitles.innerHTML = w.subs.map(function (s) {
        var cls = s.kind === 'onomat' ? 'onomat' : (s.kind === 'who' ? 'who' : '');
        return '<div class="line ' + cls + '">' + html(s.text) + '</div>';
      }).join('');

      // 阶段提示
      var pr = '', st = w.recog.stage, ph = G.State.current;
      if (ph === 'PLAY') pr = '找血清 · 注意身后的蹄声';
      else if (st === 'LOCK') {
        pr = G.Game.mode === 'duo'
          ? 'A：Q 选 / F 报数　　B：E 选 / Enter 报数'
          : '按 Q 选「第几个在动」，按 F 报数　·　同伴报的是第 ' + (w.recog.aiK || '?') + ' 个';
      } else if (st === 'QTE') pr = '跟着亮点敲：三短一长　·　别跟慢半拍的回声';
      else if (st === 'VERIFY') pr = '走到水洼边，按 R 看倒影';
      else if (st === 'DONE' || ph === 'ESCAPE') pr = '往右冲 · 去发射通道 · 不能后退';
      D.prompt.textContent = pr;

      // QTE 节奏条
      if (w.qte.active) {
        var q = w.qte, span = C.qte.lead + C.qte.pattern[3] + .4;
        var p = U.clamp((U.now() - (q.t0 - C.qte.lead)) / span, 0, 1);
        D['qte-cursor'].style.left = (p * 100).toFixed(2) + '%';
        UI.qteBeats(w);
        D['qte-hint'].textContent = (q.targetIsFake ? '有东西在学你 · ' : '') +
          '已敲 ' + q.idx + '/4 · 跟回声 ' + q.echoFollow + '/' + C.qte.echoMax +
          ' · 按 空格 / Enter';
      }
    }
  };
})();
