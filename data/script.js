/* 剧情、拟声字幕、HUD 撒谎文案、结局文案 */
(function () {
  var G = window.G = window.G || {};
  G.DATA = G.DATA || {};
  G.DATA.script = {
    title: '末 日 爱 人',
    subtitle: 'LAST LOVER ON EARTH',
    theme: '恐怖 / 即时动作 / 马',
    files: {
      centaur: 'assets/optimized/01_centaur_trueform.jpg',
      mummy: 'assets/optimized/02_mummy_beloved.jpg',
      faces: 'assets/optimized/03_same_face_candidates.jpg',
      fake: 'assets/optimized/04_false_beloved.jpg',
      puddle: 'assets/optimized/05_puddle_reflection_truth.jpg',
      split: 'assets/optimized/06_split_perception.jpg'
    },
    art: {
      titleBg: 'split', title: 'centaur', brief: 'mummy', still: 'puddle',
      end_true: 'mummy', end_wrong: 'fake', end_horse: 'centaur',
      end_alone: 'split', end_stay: 'puddle', end_timeout: 'faces'
    },
    premise: [
      '感染改写的是眼睛，不是世界。',
      '人马眼中，活物都裹着绷带；木乃伊眼中，活物都长着蹄影。',
      '外貌会撒谎。末日里满城都是爱人，你们却认不出彼此。'
    ],
    brief: [
      '末日第 41 天。你们在废弃医院走散，感染让彼此的外形变得不可信。',
      '值班录音与病历残页分别留在不同区域；两份证据必须由两人亲自找到。',
      '修复急救中继台，在隔离闸门两侧共同确认，然后带上血清赶往发射场。'
    ],
    keys: [
      ['A · 人马', 'W A S D 移动 / 左 Shift 冲刺 / E 调查与修复 / F 闸门确认'],
      ['B · 木乃伊', '方向键移动 / 右 Shift 冲刺 / K 调查与修复 / J 闸门确认'],
      ['单机', 'Tab 接管切换 / 1 2 3 抉择'],
      ['调试 / 展演', 'M 静音 / H 显真形 / T 快进到相认 / Y 快进到抉择 / P 展演亮度 / Esc 标题']
    ],
    lines: {
      boot: '你眼中，一切活物都是……',
      wake: '第四十一天。你们在医院走散了。',
      sameFace: '每一张脸都一样。别靠长相找人。',
      firstSilence: '[ …… ]',
      hoofBehind: '嗒……嗒……',
      hoofHint: '身后一直有蹄声。别回头——你也回不了头。',
      candidates: '有人动了一下。左右两屏看到的，不是同一批。',
      reportTip: '各自报出「我这边第几个在动」，只有指向同一个人才算数。',
      aiReport: '[同伴] 我这边第 {k} 个……在动。',
      lockOk: '坐标重合。是同一个「人」。',
      lockFail: '不是同一个。她还在里面。',
      lockWrong: '你指向了别的东西。它记住了你的样子。',
      qteTip: '敲出三短一长。假的会慢半拍跟着你敲。',
      qteClean: '干净的四下。没有回声。',
      qteEcho: '……慢了半拍。是谁在学你？',
      misled: '你跟着回声走了。',
      verifyTip: '把她引到水坑边，按 R 看倒影。倒影不撒谎。',
      mirrorTrue: '倒影里，是绷带。是她。',
      mirrorFake: '倒影里没有绷带。那东西笑了。',
      block: '它扑过来时，只有她挡在了你前面。',
      mapShift: '回来的时候，门不在原来的地方了。',
      serum: '只剩两支血清。火箭只认人形。',
      escape: '往右冲。不能后退。',
      choiceTitle: '最 后 一 班 船',
      choiceSub: '舱门只开一次。你把手里的血清给谁？',
      choiceOpts: [
        '1 · 一人一支，一起走',
        '2 · 两支都留给自己',
        '3 · 都给她，你留下'
      ],
      hudLies: ['感染 1??', '人性 ??', '血清 ×0', '距离发射 00:0?', 'A · 木乃伊'],
      echoes: ['……三短一长……', '……你刚才敲的……', '……我在这里……']
    },
    endings: {
      true: {
        name: '爱 人 终 于 是 你',
        text: '血清起效的那一刻，满城的木乃伊褪回人形。\n两侧画面短暂重合——这次你认得出来，只有一个人。\n火箭点火，地球在身后缩成一枚灰点。\n后来我们管那一幕叫「眼中终于是你」。'
      },
      wrong: {
        name: '跟 着 你 的 不 是 她',
        text: '舱门合上，它慢慢转过头。绷带下面什么都没有。\n你带走的，是自己认错的那一次。'
      },
      horse: {
        name: '你 成 了 他 们 中 的 一 个',
        text: '最后一点人形从指尖退走。你低下头，看见的是马蹄。\n走廊里又多了一个「爱人」，在等一个永远不会来的人。'
      },
      alone: {
        name: '一 个 人 上 船',
        text: '你恢复了人形，顺利登船。舱内只有你的呼吸。\n人性值归零的时候，火箭并没有变轻。'
      },
      stay: {
        name: '目 送',
        text: '两支都给了她。舱门认得出人形，认不出一匹马。\n你站在发射场外，听见火箭升空，也听见身后的蹄声停了。'
      },
      timeout: {
        name: '发 射 窗 口 关 闭',
        text: '倒计时归零。你们还在走廊里，满眼都是彼此的样子。'
      }
    }
  };
})();
