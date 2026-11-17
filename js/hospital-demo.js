/* Hospital demo rules: local split-screen prototype, designed around role-local state. */
(function(){
  var G=window.G=window.G||{},U=G.utils,C=G.DATA.config,S=G.DATA.script;
  var rooms=G.Level.departments;
  function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}
  function roomAt(p){
    if(p.floor===1){
      var x=p.x;
      if(x<600)return rooms[1][0];
      if(x<1200)return rooms[1][1];
      if(x<1800)return rooms[1][2];
      return rooms[1][3];
    }
    var list=rooms[p.floor];
    var idx=Math.max(0,Math.min(list.length-1,Math.floor((p.x-250)/450)));
    return list[idx];
  }
  function actor(w,id){return id==='p1'?w.p1:w.p2;}
  function publish(w,to,text){var target=actor(w,to);target.inbox.unshift({text:text,at:w.time});target.inbox=target.inbox.slice(0,5);}
  function floorValid(f){return f>=1&&f<=4;}
  function nearest(w,p,role,submit){
    var best=null,bd=C.npc.pickupRadius;
    var allowed=submit?{npc:1,player:1}:{stairs:1,clue:1,phone:1,food:1,medicine:1,exit:1,npc:1,player:1};
    w.entities.forEach(function(e){
      if(!e.alive||e.floor!==p.floor||e.id===p.id||!allowed[e.kind])return;
      if(submit&&e.kind!=='npc'&&e.kind!=='player')return;
      if(e.role&&e.role!==role&&e.kind!=='player')return;
      var d=dist(e,p),priority=e.kind==='stairs'?0.72:(e.kind==='player'?0.55:(e.kind==='npc'?0.82:1));
      if(G.Renderer.canSee && !G.Renderer.canSee(w,p,e))return;
      if(d*priority<bd){best=e;bd=d*priority;}
    });
    return best;
  }

  // ========== 多特征匹配辨认系统 ==========
  var TRAIT_INFO={
    blueWristband:{label:'蓝色腕带',desc:'左腕戴着浅蓝色的医院腕带'},
    darkCoat:{label:'深色外套',desc:'上身穿着深灰/深蓝的旧式外套'},
    limpGait:{label:'微跛步态',desc:'走路时右脚轻微拖地，步伐不对称'},
    badgeAccessory:{label:'银色徽章',desc:'胸前别着一枚旧式银色徽章'},
    silverRing:{label:'银戒指',desc:'左手无名指上有磨损的银色戒指'},
    scarLeftCheek:{label:'左颊疤痕',desc:'左脸颊有一道浅色的旧疤痕'},
    glassesRound:{label:'圆框眼镜',desc:'戴着细金属边的圆框眼镜'},
    caneDark:{label:'深色拐杖',desc:'右手拄着一根深色木质拐杖'}
  };

  // 玩家已经从线索里知道的特征（对方的）
  function knownTraitsOf(p, targetRole){
    // p1 拿到的是"p2 要找的人"的特征（即 p1 自己的特征）
    // p2 拿到的是"p1 要找的人"的特征（即 p2 自己的特征）
    var known=[];
    (p.clues||[]).forEach(function(cid){
      var clue=G.Game.world.byId[cid];
      if(clue&&clue.trait&&clue.trait!=='meetHint'){
        known.push(clue.trait);
      }
    });
    return known;
  }

  function matchTraits(candidate, known){
    if(!known||known.length===0)return 0;
    var traits=candidate.traits||[];
    var matched=known.filter(function(t){return traits.indexOf(t)>=0;});
    return matched.length;
  }

  // ========== P0-1: HUD 筛选辅助 ==========
  // 根据线索数返回 HUD 等级 0-4，决定 HUD 帮玩家做多少筛选
  // 0 条线索 → 只显示"尚未收集"
  // 1 条线索 → 高亮匹配/不匹配的 NPC
  // 2-3 条线索 → 计算嫌疑等级
  // 4+ 条线索 → 自动排除不匹配者，显示"最可能"
  function computeHUDLevel(p){
    var known=knownTraitsOf(p);
    var n=known.length;
    if(n===0)return {level:0,known:[]};
    if(n===1)return {level:1,known:known};
    if(n<=3)return {level:2,known:known};
    return {level:3,known:known};
  }
  // 计算嫌疑等级文字（基于匹配率）
  function suspicionText(matchCount,total){
    if(total===0)return '';
    var rate=matchCount/total;
    if(rate>=0.76)return '嫌疑高';
    if(rate>=0.46)return '嫌疑中';
    return '嫌疑低';
  }

  // ========== P1-1: 涌现式 NPC 反应系统（3 条规则） ==========
  // 规则 1（看穿效应）：NPC 被揭示了 2+ 个特征 → 它 flee（因为被你看太透了）
  // 规则 2（双人汇聚效应）：双方玩家在同一层且距离 < 600 → 该层所有 NPC freeze
  // 规则 3（猎人效应）：玩家线索 > 3 条 → NPC approach 概率 +50%（它也感觉到你在变准）
  function updateNPCReactions(w, dt){
    // 先算规则 2：双方是否在同一层且距离近
    var p1=actor(w,'p1'), p2=actor(w,'p2');
    var bothHere=(p1.floor===p2.floor) && dist(p1,p2)<600;
    // 双方各自的线索数（规则 3）
    var cluesP1=(p1.clues||[]).length, cluesP2=(p2.clues||[]).length;

    w.entities.forEach(function(n){
      if(n.kind!=='npc'||!n.alive)return;
      // 镜像怪不参与涌现
      if(n.mirrorTarget)return;
      // 规则 2：双人汇聚 → 整层 freeze 0.8 秒
      if(bothHere && n.floor===p1.floor){
        if(!n._groupFreeze){
          n._groupFreeze=true;
          n._groupFreezeT=0.8;
          n.state='still';n.speed=0;
        }
      }else{
        n._groupFreeze=false;
      }
      if(n._groupFreeze){n._groupFreezeT-=dt;if(n._groupFreezeT<=0){n._groupFreeze=false;}}

      ['p1','p2'].forEach(function(rid){
        var p=actor(w,rid);
        if(p.floor!==n.floor)return;
        var d=dist(p,n);
        if(d<320){
          if(!n._reacted){
            n._reacted=true;
            n._reactedFor=rid;
            // 规则 1：看穿效应
            var revealed=n.revealedTraits?n.revealedTraits.length:0;
            if(revealed>=2){
              // flee
              n.targetX=n.x+350*Math.sign(Math.random()-0.5);
              n.targetY=n.y+250*Math.sign(Math.random()-0.5);
              n.state='slowRun';n.speed=95;
              p.notice=p.notice||'这个 NPC 好像被你看出来了什么，转身就走。';
              p.noticeUntil=w.time+2;
              return;
            }
            // 规则 3：猎人效应 + 原始 reaction
            var hunterEffect=(rid==='p1'?cluesP1:cluesP2)>3;
            var approachBias=hunterEffect?0.5:0;
            var r=Math.random();
            if(r<0.4+approachBias){
              // approach：朝玩家靠近
              n.targetX=p.x+(Math.random()-0.5)*80;
              n.targetY=p.y+(Math.random()-0.5)*80;
              n.state='wander';n.speed=hunterEffect?65:50;
              p.notice=p.notice||(hunterEffect?'这个 NPC 朝你走来——它好像也在辨认谁是你。':'有人朝你这边走过来了。');
              p.noticeUntil=w.time+2;
            }else{
              // 原始 flee 或 freeze
              if(n.reaction==='flee'){
                n.targetX=n.x+300*Math.sign(Math.random()-0.5);
                n.targetY=n.y+200*Math.sign(Math.random()-0.5);
                n.state='slowRun';n.speed=85;
              }else{
                n.state='still';n.speed=0;
              }
            }
          }
        }else{
          if(n._reactedFor===rid && d>500){n._reacted=false;}
        }
      });
    });
  }

  // ========== P0-2: 观察约束系统（次数限制 + 隐身条件 + 楼层差异） ==========
  // 核心设计：
  //   1) 每个 NPC 有观察次数上限（三楼=1次，一二楼=2次），超过后 NPC 警觉走开
  //   2) 玩家连续站立不动 2 秒以上进入"隐身"状态：观察成功率 100%
  //      非隐身状态下成功率 40%，容易被 NPC 发现（NPC 会 flee）
  //   3) 成功观察 → 揭示一个特征，同时告诉对方"我发现了关于 NPC 的事"
  function isStealthed(p){ return (p.standStillT||0)>=2.0; }
  function observeNPC(w, role, npc){
    var p=actor(w,role);
    if(!npc||npc.kind!=='npc')return;
    if(dist(p,npc)>C.npc.pickupRadius*1.2){
      p.notice='距离太远，走近一些才能看清特征。';
      p.noticeUntil=w.time+1.5;
      return;
    }
    // 隐身检查
    var stealthed=isStealthed(p);
    // 该 NPC 已经被这个玩家观察过几次
    var key='obs_'+role;
    npc[key]=(npc[key]||0);
    var maxObs=npc.floor===3?1:2; // 三楼 NPC 更敏感
    if(npc[key]>=maxObs){
      // 超过上限 → NPC 警觉走开
      p.notice='这个人注意到你在盯着他，转身离开了。';
      p.noticeUntil=w.time+2;
      npc.targetX=npc.x+400*Math.sign(Math.random()-0.5);
      npc.targetY=npc.y+300*Math.sign(Math.random()-0.5);
      npc.state='slowRun';npc.speed=95;
      npc.alertedAt=w.time;
      return;
    }
    // 成功率：隐身 100%，非隐身 40%
    if(!stealthed && Math.random()>0.4){
      p.notice='你被发现了！这个人警觉地看着你。';
      p.noticeUntil=w.time+2;
      npc.targetX=npc.x+300*Math.sign(Math.random()-0.5);
      npc.targetY=npc.y+200*Math.sign(Math.random()-0.5);
      npc.state='slowRun';npc.speed=85;
      return;
    }
    // 成功揭示特征
    if(!npc.revealedTraits)npc.revealedTraits=[];
    var unrevealed=(npc.traits||[]).filter(function(t){return npc.revealedTraits.indexOf(t)<0;});
    npc[key]++;
    if(unrevealed.length>0){
      var t=unrevealed[Math.floor(Math.random()*unrevealed.length)];
      npc.revealedTraits.push(t);
      p.notice=(stealthed?'【隐身成功】':'')+'仔细观察：这个人可能有 '+TRAIT_INFO[t].label+'。';
      p.noticeUntil=w.time+2.5;
      // P1-2: 自动通知对方你发现了什么
      var other=role==='p1'?'p2':'p1';
      publish(w,other,'我在'+roomAt(p)+'看到一个 NPC 可能有 '+TRAIT_INFO[t].label+'，位置约 (楼层'+p.floor+')');
    }else{
      p.notice='这个人没什么更多特征可以看了。';
      p.noticeUntil=w.time+1.5;
    }
  }

  // ========== 互动系统 ==========
  function end(w,key){if(w.ended)return;w.ended=true;w.ending=key;G.State.set('RESULT');if(G.Audio&&G.Audio.stopAmbient)G.Audio.stopAmbient();G.UI.overlay('ending',key);}

  function interact(w,role,submit){
    // 被对方手电筒照住时不能发起任何互动（观察/辨认都不行），只能等判定或自动解除。
    if(G.Beam&&!G.Beam.canAct(w,role)){
      var frozenP=actor(w,role);
      frozenP.notice='你被照住了，动不了，也操作不了。';
      frozenP.noticeUntil=w.time+1.5;
      return;
    }
    var p=actor(w,role),e=nearest(w,p,role,submit);
    if(!e){p.notice=submit?'附近没有可辨认的人。':'附近没有可调查的物品或人。';p.noticeUntil=w.time+1.5;return;}

    // === 楼梯：楼层切换 + 过渡动画 ===
    if(e.kind==='stairs'){
      var nf=e.targetFloor;
      if(!floorValid(nf)){p.notice='楼梯暂时无法通行。';p.noticeUntil=w.time+1.5;return;}
      // 触发过渡动画
      if(G.Renderer.triggerFloorTransition)G.Renderer.triggerFloorTransition(role,p.floor,nf);
      var oldFloor=p.floor;
      p.floor=nf;
      // 根据方向设置落点
      if(nf===1)p.x=1190,p.y=490;
      else if(nf===2){
        if(e.direction==='UP'){p.x=1270,p.y=490;}
        else{p.x=1110,p.y=490;}
      }else if(nf===3)p.x=1190,p.y=490;
      p.currentRoom=roomAt(p);
      p.notice='楼梯通往'+nf+'楼。你听到脚步声回荡在空旷的楼梯井里。';
      p.noticeUntil=w.time+2.5;
      publish(w,role==='p1'?'p2':'p1','我从'+oldFloor+'楼爬到'+nf+'楼了，小心楼梯很暗。');
      return;
    }

    // === 线索 ===
    if(e.kind==='clue'){
      if(e.clueIndex!==undefined&&e.clueIndex===2){
        p.hasMeetClue=true;
        if(p.clues.indexOf(e.id)<0)p.clues.push(e.id);
        e.alive=false;
        p.notice=e.clueText+'（会合提示）';
        p.noticeUntil=w.time+6;
      }else{
        if(p.clues.indexOf(e.id)<0)p.clues.push(e.id);
        e.alive=false;
        p.notice=e.clueText;
        p.noticeUntil=w.time+5;
      }
      return;
    }

    // === 手机 ===
    if(e.kind==='phone'){
      if(!p.phone){p.phone=true;e.alive=false;p.notice='旧手机开机了。走到新科室会自动发送房间名。';p.noticeUntil=w.time+3;}
      return;
    }

    // === 能量棒 ===
    if(e.kind==='food'){
      p.stamina=Math.min(C.stamina.max,p.stamina+35);e.alive=false;
      p.notice='吃下能量棒，体力恢复。';
      p.noticeUntil=w.time+2;
      return;
    }

    if(e.kind==='medicine'){
      if(G.Hazard&&G.Hazard.heal(w,e.heal||28,e)){
        e.alive=false;p.notice='拾取急救药物，共享血量恢复。';p.noticeUntil=w.time+2.5;
      }else{p.notice='当前无法使用药物。';p.noticeUntil=w.time+1.5;}
      return;
    }
    if(e.kind==='exit'){
      p.notice='出口已标记。相认后两人同时进入这里才能逃生。';p.noticeUntil=w.time+2.5;return;
    }

    // === NPC（观察 / 辨认）===
    if(e.kind==='npc'){
      if(!submit){
        // 观察模式
        observeNPC(w,role,e);
        return;
      }
      // === 辨认模式 ===
      var known=knownTraitsOf(p);
      var matchCount=matchTraits(e,known);
      var totalKnown=known.length;

      // 匹配度逻辑
      if(matchCount===0||totalKnown===0){
        // 没线索或完全不匹配
        if(G.Hazard)G.Hazard.damage(w,10,{downedRole:role}); else p.hp=Math.max(0,p.hp-10);w.recog.attempts++;
        p.notice='你还没有足够线索来判断。或者这个人特征和你知道的完全不同。';
        p.noticeUntil=w.time+2.5;
        // 认错代价：生成一个"镜像怪"
        spawnMirrorClone(w,role,e);
      }else if(matchCount===totalKnown){
        // 完全匹配 = 认错了（因为 NPC 不会有你所有的线索特征）
        if(G.Hazard)G.Hazard.damage(w,25,{downedRole:role}); else p.hp=Math.max(0,p.hp-25);w.recog.attempts++;w.recog.wrong=true;
        p.notice='你认错了！这个人的特征完全符合……但反应不对。生命 -25';
        p.noticeUntil=w.time+3;
        spawnMirrorClone(w,role,e);
      }else{
        // 部分匹配：不惩罚，提示需要更多线索
        p.notice='部分特征匹配，但还不能确认。继续寻找线索。';
        p.noticeUntil=w.time+2.5;
      }
      if(p.hp<=0&&!w.downedRole)end(w,'wrong');
      return;
    }

    // === 玩家（真爱）===
    if(e.kind==='player'){
      var otherRole=role==='p1'?'p2':'p1';
      var other=actor(w,otherRole);
      if(p.floor!==other.floor||dist(p,other)>300){p.notice='相认需要和对方在同一层、三米以内。';p.noticeUntil=w.time+2.2;return;}
      var rec=w.recognition||{state:'idle',participants:{}};
      if(rec.state==='active'&&rec.expiresAt<w.time){rec.state='idle';rec.participants={};}
      if(rec.state!=='active'){rec.state='active';rec.startedAt=w.time;rec.expiresAt=w.time+3;rec.initiator=role;rec.participants={};}
      rec.participants[role]=true;p.recognizedTarget=true;
      p.notice='你发起了相认，等待对方在 3 秒内回应。';p.noticeUntil=rec.expiresAt;
      if(rec.participants[otherRole])return beginEscape(w);
      return;
    }

    p.notice='附近没有可互动的东西。';
    p.noticeUntil=w.time+1.2;
  }

  // ========== 镜像怪生成（认错代价链）==========
  function spawnMirrorClone(w,role,sourceNpc){
    // 把认错的 NPC 变成"镜像怪"，会模仿玩家的步态
    w.recog.wrongCount=(w.recog.wrongCount||0)+1;
    if(w.recog.wrongCount<=2){
      // 前两次：NPC 开始跟在玩家身后
      sourceNpc.reaction='mirror';
      var p=actor(w,role);
      // 新的镜像 NPC
      var clone=G.World.add(w,G.Entities.make({
        id:'mirror-'+w.recog.wrongCount+'-'+Date.now(),
        kind:'npc',
        floor:p.floor,
        x:p.x+100,y:p.y+100,
        r:22,phase:Math.random()*10,
        state:'follow',speed:Math.max(40,p.speed*0.8),
        mirrorTarget:role, // 模仿哪个玩家
        traits:sourceNpc.traits,
        reaction:'follow'
      }));
      p.notice=p.notice+' 那个人的步态，突然和你很像……';
      p.noticeUntil=w.time+3.5;
    }else{
      // 第三次认错：NPC 集体朝玩家移动
      var p=actor(w,role);
      p.notice='你已经认错太多次了。他们都看向你这边。';
      p.noticeUntil=w.time+4;
      w.entities.forEach(function(n){
        if(n.kind==='npc'&&n.alive&&n.floor===actor(w,role).floor){
          n.reaction='approach';
        }
      });
    }
  }

  // ========== P1-2: 紧急同步 ==========
  // 双方在 3 秒内都按了同步键 → 交换楼层 + 最可疑 NPC 信息
  // 单方按 → 只发自己的信息，对方可以看到"对方想同步，也按一下"
  function emergencySync(w,role){
    var p=actor(w,role);
    var otherRole=role==='p1'?'p2':'p1';
    var other=actor(w,otherRole);
    var known=knownTraitsOf(p);
    // 找到自己最可疑的 NPC
    var best=null,bestScore=-1;
    w.entities.forEach(function(e){
      if(e.kind==='npc'&&e.alive){
        var score=matchTraits(e,known);
        if(score>bestScore){bestScore=score;best=e;}
      }
    });
    var bestInfo=best?(TRAIT_INFO[best.traits[0]]?TRAIT_INFO[best.traits[0]].label+'...':'未知NPC'):'没看到可疑 NPC';
    var mine='【紧急同步】我在 '+p.floor+'楼，房间 '+(p.currentRoom||'?')+'，已有 '+known.length+' 条线索。最可疑：'+bestInfo;
    publish(w,otherRole,mine);
    p.notice='已发送紧急同步请求（楼层'+p.floor+'，'+known.length+'条线索）';
    p.noticeUntil=w.time+2;
    // 如果对方也在 3 秒内按了 → 触发联动通知
    if(other._syncPushedAt!==undefined && other._syncPushedAt>w.time-3){
      // 双方都按了
      var bothMsg='✓ 紧急同步完成！双方在 '+p.floor+'楼 · '+p.currentRoom+' 附近，请会合辨认。';
      publish(w,'p1',bothMsg);publish(w,'p2',bothMsg);
    }else{
      p._syncPushedAt=w.time;
      // 提示对方
      publish(w,otherRole,'对方想紧急同步，A 按 R，B 按手柄 LB，3 秒内响应');
    }
  }

  // ========== 碰撞检测 ==========
  function blocked(w,p,x,y){
    for(var i=0;i<w.walls.length;i++){
      var b=w.walls[i];
      if(b.floor===p.floor&&x>b.x-26&&x<b.x+b.w+26&&y>b.y-26&&y<b.y+b.h+26)return true;
    }
    return false;
  }

  // ========== 移动 ==========
  function move(w,p,role,dt){
    if(p.downed){p.moving=false;p.dashT=0;return;}
    // 被对方手电筒照住时不能移动/冲刺，只能等照方按 是/否 判定，或照方松开光束超过 1.5 秒自动解除。
    if(G.Beam&&!G.Beam.canAct(w,role)){
      p.moving=false;
      p.dashT=Math.max(0,p.dashT-dt);
      return;
    }
    var a=G.Input.axis(role);
    if(a.len){
      var speed=p.stamina<C.stamina.lowThreshold?145*C.stamina.lowSpeedMul:145;
      if(p.dashT>0)speed=300;
      var nx=U.clamp(p.x+a.x*speed*dt,60,2340),ny=U.clamp(p.y+a.y*speed*dt,60,920);
      var oldX=p.x,oldY=p.y;
      if(!blocked(w,p,nx,p.y))p.x=nx;
      if(!blocked(w,p,p.x,ny))p.y=ny;
      p.moving=Math.hypot(p.x-oldX,p.y-oldY)>0.001;
      if(p.moving)p.facing={x:a.x,y:a.y};
      p.stamina=Math.max(0,p.stamina-C.stamina.moveCost*dt);
      p.standStillT=0; // 移动中重置站立计时
    }else{
      p.moving=false;
      p.stamina=Math.min(C.stamina.max,p.stamina+C.stamina.recover*dt);
      p.standStillT=(p.standStillT||0)+dt; // 站立不动累加计时
    }
    p.dashT=Math.max(0,p.dashT-dt);
  }

  // ========== 探索标记 ==========
  function markExplore(p){
    var gx=Math.floor(p.x/300),gy=Math.floor(p.y/220);
    for(var dx=-1;dx<=1;dx++)for(var dy=-1;dy<=1;dy++){
      var xx=gx+dx,yy=gy+dy;
      if(xx>=0&&xx<8&&yy>=0&&yy<5)p.explored[p.floor][xx+':'+yy]=true;
    }
    var room=roomAt(p);
    if(room!==p.currentRoom){
      p.currentRoom=room;
      if(p.phone){
        // P1-2: 短信升级为"共享发现"——带上玩家当前线索数和楼层
        var known=knownTraitsOf(p);
        var msg='【位置】我在'+p.floor+'楼 '+room+'，已有 '+known.length+' 条外貌线索。如果对方在这附近，请按下紧急同步。';
        publish(G.Game.world,p.id==='p1'?'p2':'p1',msg);
        p.lastRoomMessage=msg;
        p.notice='已发送：'+msg;
        p.noticeUntil=G.Game.world.time+2.5;
      }
    }
  }

  // ========== NPC AI ==========
  function npcUpdate(w,dt){
    w.entities.forEach(function(n){
      if(n.kind!=='npc'||!n.alive)return;
      // 镜像怪行为
      if(n.mirrorTarget){
        var mt=actor(w,n.mirrorTarget);
        // 模仿玩家的方向和速度，但保持一点距离
        var followDist=220;
        var fx=mt.x-n.x,fy=mt.y-n.y,fd=Math.hypot(fx,fy);
        if(fd>followDist){
          n.x+=fx/fd*n.speed*dt;
          n.y+=fy/fd*n.speed*dt;
        }
        n.targetX=n.x,n.targetY=n.y;
        return;
      }
      if(n.state==='lie'||n.state==='still')return;
      if(!n.targetT||n.targetT<=0){
        n.targetX=U.clamp(n.x+(Math.random()-.5)*420,80,2320);
        n.targetY=U.clamp(n.y+(Math.random()-.5)*300,80,900);
        n.targetT=1.5+Math.random()*4;
      }
      n.targetT-=dt;
      var dx=n.targetX-n.x,dy=n.targetY-n.y,d=Math.hypot(dx,dy);
      if(d>6){var s=n.speed*(n.state==='slowRun'?.55:1);n.x+=dx/d*s*dt;n.y+=dy/d*s*dt;}
    });
    updateNPCReactions(w,dt);
  }

  function autoPickups(w){
    ['p1','p2'].forEach(function(id){var p=actor(w,id);if(p.downed)return;(w.entities||[]).forEach(function(e){if(!e.alive||e.floor!==p.floor||e.kind!=='medicine')return;if(dist(p,e)<=70&&G.Hazard&&G.Hazard.heal(w,e.heal||28,e)){e.alive=false;p.notice='拾到急救药物，共享血量恢复。';p.noticeUntil=w.time+2.5;}});});
  }

  function beginEscape(w){
    if(w.escape&&w.escape.active)return;
    w.escape=w.escape||{};w.escape.active=true;w.escape.enemiesSpawned=true;w.flags.escape=true;G.State.set('ESCAPE');
    var f=w.p1.floor;
    for(var i=0;i<6;i++)G.World.add(w,G.Entities.make({id:'infected-'+i,kind:'zombie',floor:f,x:260+i*350,y:i%2?260:720,r:24,speed:72,hp:3,hitCd:0,phase:i}));
    w.p1.notice='相认成功！医院公敌已出现，和同伴一起到出口。';w.p2.notice=w.p1.notice;w.p1.noticeUntil=w.p2.noticeUntil=w.time+5;
  }

  function updateEscape(w,dt){
    if(!w.escape||!w.escape.active)return;
    w.entities.forEach(function(n){if(n.kind!=='zombie'||!n.alive)return;var target=dist(n,w.p1)<dist(n,w.p2)?w.p1:w.p2;if(n.floor!==target.floor)return;var dx=target.x-n.x,dy=target.y-n.y,d=Math.hypot(dx,dy)||1;n.x+=dx/d*n.speed*dt;n.y+=dy/d*n.speed*dt;if(d<65&&n.hitCd<=0){n.hitCd=1.1;if(G.Hazard)G.Hazard.damage(w,8,{downedRole:target.id});}});
    w.entities.forEach(function(n){if(n.hitCd>0)n.hitCd=Math.max(0,n.hitCd-dt);});
    var ex=w.entities.find(function(e){return e.kind==='exit'&&e.floor===w.p1.floor;});
    if(ex&&w.p1.floor===w.p2.floor&&dist(w.p1,ex)<90&&dist(w.p2,ex)<90){w.escape.exitReady=true;end(w,'escaped');}
  }

  // ========== 主 tick ==========
  function playerDir(role){
    // 与 render-three.js 的 forwardFor 保持同一坐标系：x->x，y(逻辑)->z(渲染)。
    var yaw=(G.Renderer&&G.Renderer.getCameraYaw)?G.Renderer.getCameraYaw(role):0;
    var pitch=(G.Renderer&&G.Renderer.getCameraPitch)?G.Renderer.getCameraPitch(role):0;
    return {x:Math.sin(yaw)*Math.cos(pitch),y:-Math.sin(pitch),z:-Math.cos(yaw)*Math.cos(pitch)};
  }
  function tick(w,dt){
    if(!w||w.ended)return;
    w.time+=dt;
    if(G.Beam){
      var events=G.Beam.update(w,{p1:playerDir('p1'),p2:playerDir('p2')},dt);
      events.forEach(function(ev){
        var victim=actor(w,ev.role),shooterP=actor(w,ev.by);
        if(ev.type==='flashFreeze'){
          victim.notice='闪光使你短暂僵住。'; victim.noticeUntil=w.time+0.5;
        }else if(ev.type==='freeze'){
          victim.notice='你被手电筒照住了，动不了。等'+(ev.by==='p1'?'A':'B')+'确认。';
          victim.noticeUntil=w.time+3;
          shooterP.notice='你照住了对方——'+(ev.by==='p1'?'按 Y 确认是 / N 否':"方向键上 是 / 下 否");
          shooterP.noticeUntil=w.time+3;
        }else if(ev.type==='autoRelease'){
          victim.notice='光束移开了，你能动了。';
          victim.noticeUntil=w.time+1.5;
        }
      });
    }
    ['p1','p2'].forEach(function(id){var p=actor(w,id);move(w,p,id,dt);markExplore(p);});
    if(G.Hazard)G.Hazard.update(w,dt);
    autoPickups(w);
    if(G.Hazard&&w.downedRole){var rescuer=w.downedRole==='p1'?'p2':'p1';G.Hazard.revive(w,rescuer,dt);}
    if(w.recognition&&w.recognition.state==='active'&&w.recognition.expiresAt<w.time){w.recognition.state='idle';w.recognition.participants={};w.p1.recognizedTarget=w.p2.recognizedTarget=false;}
    npcUpdate(w,dt);
    updateEscape(w,dt);
  }

  // ========== 照射判定键位 ==========
  // P1: KeyY=是 / KeyN=否；P2: Quote=是 / Slash=否。
  function isBeamKey(code){return code==='KeyY'||code==='KeyN'||code==='Quote'||code==='Slash'||code==='GamepadUp'||code==='GamepadDown';}
  function beamShooterOf(code){
    if(code==='KeyY'||code==='KeyN')return 'p1';
    if(code==='Quote'||code==='Slash'||code==='GamepadUp'||code==='GamepadDown')return 'p2';
    return null;
  }
  function beamAnswer(code){return code==='KeyY'||code==='Quote'||code==='GamepadUp';}

  // ========== 游戏入口 ==========
  G.Hospital={roomAt:roomAt,interact:interact,end:end,tick:tick,beginEscape:beginEscape};
  G.Game=Object.assign(G.Game,{
    init:function(){
      G.Input.attach();
      G.Renderer.resize();
      G.UI.init();
      window.addEventListener('resize',function(){G.Renderer.resize();});
      StateTitle();
      G.UI.overlay('title');
      G.Loop.start();
    },
    reset:function(mode){
      // 调试模式仍按双人同屏跑（渲染/HUD 全部复用 duo 分支），只有出生点不同，
      // 所以对外 this.mode 继续写 'duo'，debugSpawn 单独标记出生点规则。
      var debug=(mode==='debug');
      this.mode='duo';
      this.debugSpawn=debug;
      this.debugMode=debug;
      this.dualView=false;
      if(G.Renderer&&G.Renderer.resetViews)G.Renderer.resetViews();
      this.world=G.World.create({debug:debug,sameFloor:true});
      this.world.debugMode=debug;
      this.world.brightMode=false;
      G.Level.build(this.world);
      if(G.Hazard)G.Hazard.reset(this.world);
      // 初始化 explored 标记
      ['p1','p2'].forEach(function(id){
        var p=actor(this.world,id);
        p.explored={1:{},2:{},3:{},4:{}};
        p.inbox=[];
        p.clues=[];
        p.notice='你们在同一层医院的两端醒来。穿过危险区，寻找线索并认出对方。';
        p.noticeUntil=this.world.time+4;
        p.currentRoom=roomAt(p);
      }.bind(this));
      // 双方主动转动转盘，动画结束后才发放卡牌与能力。
      ['p1','p2'].forEach(function(id){
        var p=actor(this.world,id);
        p.beamCard=null;
        p.beam=G.Beam.effectiveBeam(null);
        p.cardReady=false;
        p.debugIndex=0;
        p.roulette={phase:debug?'debugIdle':'idle',elapsed:0,duration:4.6,rotation:0,index:0};
      }.bind(this));
      G.UI.overlay(null);
      if(G.Audio){G.Audio.unlock();if(G.Audio.startAmbient)G.Audio.startAmbient();}
      if(G.Subtitles){G.Subtitles.clear();}
      // 先进入抽卡页，两人都确认后才正式开始（PLAY）。
      G.State.set('DRAW');
      G.UI.overlay('draw');
    },
    turnWheel:function(role){
      if(G.State.current!=='DRAW'||!this.world)return;
      var p=actor(this.world,role),r=p.roulette;
      if(this.debugMode){
        if(r.phase==='debugIdle'){
          // 手柄 A / A 玩家确认键第一次按下时锁定当前高亮卡牌，第二次才提交。
          this.selectDebugCard(role,p.debugIndex||0);
          return;
        }
        if(r.phase==='debugSelected'){
          r.phase='ready';p.cardReady=true;
          if(this.world.p1.cardReady&&this.world.p2.cardReady){this.startPlay();return;}
        }
        G.UI.updateWheels(this.world);
        return;
      }
      if(r.phase==='idle'){
        r.card=G.Beam.drawCard();
        r.index=G.Beam.CARDS.indexOf(r.card);
        // 指针固定在正上方；每个扇区的中点恰好停在指针下。
        r.target=360*6+(360-(r.index+0.5)*360/G.Beam.CARDS.length);
        r.phase='spinning';
        if(G.Synth)G.Synth.tone(180,.12,'sine',.08);
      }else if(r.phase==='revealed'){
        r.phase='ready';p.cardReady=true;
        if(this.world.p1.cardReady&&this.world.p2.cardReady){this.startPlay();return;}
      }
      G.UI.updateWheels(this.world);
    },
    skipWheel:function(role){
      if(this.debugMode||G.State.current!=='DRAW'||!this.world)return false;
      var p=actor(this.world,role),r=p.roulette;
      if(r.phase!=='idle'&&r.phase!=='spinning')return false;
      r.card=G.Beam.drawCard();
      r.index=G.Beam.CARDS.indexOf(r.card);
      r.target=360*6+(360-(r.index+0.5)*360/G.Beam.CARDS.length);
      r.rotation=r.target;
      r.elapsed=r.duration;
      r.phase='revealed';
      p.beamCard=r.card;
      p.beam=G.Beam.effectiveBeam(r.card);
      G.UI.updateWheels(this.world);
      return true;
    },
    selectDebugCard:function(role,index){
      if(!this.debugMode||G.State.current!=='DRAW'||!this.world)return false;
      var cards=G.Beam.CARDS||[];
      index=Math.max(0,Math.min(cards.length-1,Number(index)||0));
      var p=actor(this.world,role),r=p.roulette,card=cards[index];
      if(!card||r.phase==='ready')return false;
      p.debugIndex=index;
      r.index=index;
      r.card=card;
      r.phase='debugSelected';
      p.beamCard=card;
      p.beam=G.Beam.effectiveBeam(card);
      p.cardReady=false;
      G.UI.updateWheels(this.world);
      return true;
    },
    cycleDebugCard:function(role,delta){
      if(!this.debugMode||G.State.current!=='DRAW'||!this.world)return false;
      var p=actor(this.world,role),r=p.roulette;
      if(r.phase==='ready')return false;
      var n=(G.Beam.CARDS||[]).length||1;
      var next=((p.debugIndex||0)+(delta||1))%n;
      if(next<0)next+=n;
      p.debugIndex=next;
      G.UI.updateWheels(this.world);
      return true;
    },
    toggleBrightMode:function(){
      if(!this.debugMode||!this.world)return false;
      this.world.brightMode=!this.world.brightMode;
      G.UI.updateWheels(this.world);
      return this.world.brightMode;
    },
    updateWheels:function(dt){
      var w=this.world;
      ['p1','p2'].forEach(function(id){
        var p=actor(w,id),r=p.roulette;
        if(r.phase!=='spinning')return;
        r.elapsed=Math.min(r.duration,r.elapsed+dt);
        var t=r.elapsed/r.duration;
        r.rotation=r.target*(1-Math.pow(1-t,4));
        var sector=Math.floor(r.rotation/(360/G.Beam.CARDS.length));
        if(sector!==r.lastSector){r.lastSector=sector;if(G.Synth)G.Synth.tone(450,.025,'triangle',.025);}
        if(t>=1){
          r.phase='revealed';p.beamCard=r.card;p.beam=G.Beam.effectiveBeam(r.card);
          if(G.Synth){G.Synth.tone(392,.16,'sine',.08);G.Synth.tone(587,.22,'sine',.05);}
        }
      });
      G.UI.updateWheels(w);
    },
    // 抽卡页两人都确认后才进入 PLAY，并发出醒来字幕与短信
    startPlay:function(){
      var w=this.world;
      if(!w)return;
      G.State.set('PLAY');
      // 抽卡确认完成后必须关闭遮罩，否则画面仍停留在“等待同伴”的抽卡页，
      // 看起来像另一名玩家无法确认。
      G.UI.overlay(null);
      if(G.Subtitles)G.Subtitles.clear();
      ['p1','p2'].forEach(function(id){
        var fromRole=id==='p1'?'p2':'p1';
        publish(w,id,'对方在'+actor(w,fromRole).floor+'楼醒来。你们需要找到线索互相辨认。');
      });
    },
    onPress:function(ev){
      var ph=G.State.current,w=this.world;
      if(ph==='TITLE'){
        if(ev.code==='Digit2'||ev.code==='Numpad2'||ev.key==='2'){this.reset('duo');return;}
        if(G.Audio)G.Audio.unlock();
        G.State.set('BRIEF');
        G.UI.overlay('brief');
        return;
      }
      if(ph==='BRIEF'){
        if(ev.code==='Digit2'||ev.code==='Numpad2'||ev.key==='2'||ev.code==='Space'||ev.code==='GamepadA'||ev.code==='GamepadStart')this.reset('duo');
        else if(ev.code==='Digit3'||ev.code==='Numpad3'||ev.key==='3')this.reset('debug');
        return;
      }
      if(ph==='DRAW'){
        var w0=this.world;
        if(!w0)return;
        if(this.debugMode){
          // 调试模式：A 可用数字键 1-6 或抽卡页按钮选牌，Enter/Y 确认；
          // B 只响应手柄十字键循环选牌，A 确认，鼠标不会操作 B。
          var p1Index=-1;
          if(/^Digit[1-6]$/.test(ev.code))p1Index=Number(ev.code.slice(-1))-1;
          else if(/^Numpad[1-6]$/.test(ev.code))p1Index=Number(ev.code.slice(-1))-1;
          if(p1Index>=0){this.selectDebugCard('p1',p1Index);return;}
          if(ev.code==='KeyL'&&ev.owner!=='p2'){this.toggleBrightMode();return;}
          if(ev.owner==='p2'&&ev.source==='gamepad'&&ev.code==='GamepadUp'){this.cycleDebugCard('p2',1);return;}
          if(ev.owner==='p2'&&ev.source==='gamepad'&&ev.code==='GamepadDown'){this.cycleDebugCard('p2',-1);return;}
          if(ev.code==='KeyY'||ev.code==='Enter'){
            if(ev.owner==='p2'&&ev.source==='gamepad')this.turnWheel('p2');
            else this.turnWheel('p1');
            return;
          }
          if(ev.owner==='p2'&&ev.source==='gamepad'&&ev.code==='GamepadA'){this.turnWheel('p2');return;}
          return;
        }
        var drawRole=(ev.code==='KeyY'||ev.code==='Enter')?'p1':
          (ev.code==='Quote'||(ev.owner==='p2'&&ev.source==='gamepad'&&ev.code==='GamepadA'))?'p2':null;
        if(ev.code==='KeyK'&&ev.owner!=='p2'){this.skipWheel('p1');return;}
        if(ev.owner==='p2'&&ev.source==='gamepad'&&ev.code==='GamepadX'){this.skipWheel('p2');return;}
        if(drawRole)this.turnWheel(drawRole);
        return;
      }
      if(ph==='RESULT'){
        if(ev.code==='Space'||ev.code==='Enter'||ev.code==='Escape'||ev.code==='GamepadA'||ev.code==='GamepadStart'){G.State.set('TITLE');G.UI.overlay('title');}
        return;
      }
      if(!w)return;
      if(ev.code==='Escape'){
        // 第一人称锁定鼠标时，Esc 由浏览器释放指针锁；不把同一次按键解释为返回标题。
        if(G.Renderer&&G.Renderer.isMouseLocked&&G.Renderer.isMouseLocked())return;
        G.State.set('TITLE');G.UI.overlay('title');return;
      }
      if(ev.code==='KeyM'&&G.Audio){G.Audio.muteAll(1);return;}
      var role=ev.owner;
      var beamKey=isBeamKey(ev.code);
      if(role==='p2'&&ev.source!=='gamepad'&&!beamKey)return;
      if(role!=='p1'&&role!=='p2')return;
      var code=ev.code;
      // 照射判定：照方的 是/否 键。P1: KeyY 是 / KeyN 否；P2: Quote 是 / Slash 否。
      // 两人各自独立确认"对方是不是我要找的人"；只有双方都确认"是"才相认成功。
      if(G.Beam&&beamKey){
        var shooter=beamShooterOf(code);
        var answer=beamAnswer(code);
        if(shooter){
          var res=G.Beam.confirm(w,shooter,answer);
          if(res.ok){
            var victimP=actor(w,res.victim),shooterP=actor(w,res.shooter);
            shooterP.confirmedYes=(shooterP.confirmedYes||{});
            shooterP.confirmedYes[res.victim]=answer;
            shooterP.notice=answer?'你确认了：是对方要找的人。':'你确认了：不是要找的人。';
            shooterP.noticeUntil=w.time+3;
            victimP.notice=answer?'对方确认了你的身份。你可以继续行动。':'对方判定你不是要找的人。你可以继续行动。';
            victimP.noticeUntil=w.time+3;
            publish(w,res.victim,answer?'对方确认：你是要找的人。':'对方判定：你不是要找的人。');
            // 双向确认：A 确认 B 是，且 B 也确认 A 是 → 相认成功
            var aYes=w.p1.confirmedYes&&w.p1.confirmedYes.p2;
            var bYes=w.p2.confirmedYes&&w.p2.confirmedYes.p1;
            if(aYes&&bYes)return end(w,'recognized');
          }
        }
        return;
      }
      if ((role==='p1'&&code==='KeyQ')||(role==='p2'&&code==='GamepadLT')) { G.Beam.flash(w,role); return; }
      // A 用键盘 V，B 用手柄 Y，各自只切自己的相机。
      if((role==='p1'&&code==='KeyV')||(role==='p2'&&code==='GamepadY')){
        if(G.Renderer&&G.Renderer.toggleView){
          var mode=G.Renderer.toggleView(role);
          var pView=actor(w,role);
          pView.notice=(mode==='first'?'第一人称视角已启用。':'第三人称视角已启用。')+(role==='p2'?' 右摇杆控制视角。':(mode==='first'?' 点击左屏捕获鼠标，移动鼠标转向；Esc 释放。':' 拖动鼠标环视。'));
          pView.noticeUntil=w.time+2.2;
        }
        return;
      }
      // 放弃
      if((role==='p1'&&code==='KeyX')||(role==='p2'&&(code==='BracketRight'||code==='GamepadRB')))return G.Hospital.end(w,'abandon');
      // 调查（长按 E 是观察 NPC）
      if((role==='p1'&&code==='KeyE')||(role==='p2'&&(code==='Semicolon'||code==='GamepadA'))){
        G.Hospital.interact(w,role,false);return;
      }
      // 辨认（提交确认）
      if((role==='p1'&&code==='KeyF')||(role==='p2'&&(code==='Comma'||code==='GamepadX'))){
        G.Hospital.interact(w,role,true);return;
      }
      // 冲刺
      if((role==='p1'&&code==='ShiftLeft')||(role==='p2'&&(code==='ShiftRight'||code==='GamepadB'))){
        var p=actor(w,role);
        if(G.Beam.canAct(w,role)&&p.stamina>=C.stamina.dashCost){p.stamina-=C.stamina.dashCost;p.dashT=.3;}
      }
      // ========== P1-2: 紧急同步（双方同时按则共享最有价值信息） ==========
      // A：R 键；B：手柄 LB（保留小键盘 . 作为兼容入口）
      if((role==='p1'&&code==='KeyR')||(role==='p2'&&(code==='NumpadDecimal'||code==='GamepadLB'))){
        emergencySync(w,role);
      }
    },
    update:function(dt){
      var w=this.world;
      if(w&&G.State.current==='DRAW')this.updateWheels(dt);
      if(w&&!w.ended&&['PLAY','RECOGNIZE','ESCAPE'].indexOf(G.State.current)>=0)G.Hospital.tick(w,dt);
      if(w)G.UI.update(w);
      if(G.Subtitles)G.Subtitles.update(dt);
    },
    choose:function(n){
      if(n===1)G.Hospital.end(this.world,'recognized');
      else if(n===2)G.Hospital.end(this.world,'wrong');
      else G.Hospital.end(this.world,'abandon');
    },
    systemKey:function(){return false;},
    checkEnd:function(){},
    end:function(key){G.Hospital.end(this.world,key);}
  });

  // ========== UI ==========
  function StateTitle(){G.State.set('TITLE');}
  G.UI.overlay=function(kind,key){
    var c=U.el('card'),out='';
    if(!kind){U.el('overlay').classList.remove('show');return;}
    if(kind==='title'){
      out='<h1>再 见？爱 人！</h1>'
        +'<div class="sub">末日医院 · 黑暗中的双人寻人故事</div>'
        +'<p>末日来了。医院的感染把每个人都变成了裹满绷带的躯体——你，你的爱人，还有走廊深处的所有陌生人。</p>'
        +'<p>停电后的医院漆黑一片，你们在混乱中失散。只有手电筒照到的地方能看清；楼梯、病房和走廊深处，都可能藏着什么。</p>'
        +'<p class="warn">感染抹掉了每个人的脸：绷带、步态、身上的旧物才是唯一能分辨彼此的东西。</p>'
        +'<div class="go">按任意键查看操作说明</div>';
    }
    else if(kind==='brief'){
      out='<h2>末 日 医 院 · 第 四 十 一 天</h2>'
        +'<p>最后一次停电发生在感染爆发之后。你和爱人、还有医院里所有人，都变成了同一种裹满绷带的躯体；你们在黑暗中走散，连彼此的脸都认不出了。</p>'
        +'<p>两支手电筒是黑暗里仅有的视野。沿着四层医院寻找线索、穿过危险区，再设法找到对方。满城都是同一张脸，只有身上的旧物不会说谎。</p>'
        +'<h3>当前版本操作</h3>'
        +'<p>你们在同一层医院的两端醒来，外貌变得陌生。<br>'
        +'穿过小地图标红的危险区 → 观察心率和共享血条 → 在三米内同时相认 → 一起逃到出口。</p>'
        +'<div class="keys">'
        +'<div><b>A 玩家（键盘+鼠标）</b>：WASD 移动　·　第一人称点击左屏捕获鼠标后直接移动转视角（Esc 释放）　·　第三人称拖动鼠标环视　·　V 切换视角　·　E 观察　·　F 辨认　·　Shift 冲刺　·　R 同步　·　Y 是 / N 否（照到对方时）　·　Q 闪光（闪光灯卡）</div>'
        +'<div><b>B 玩家（外置手柄）</b>：左摇杆移动　·　右摇杆转视角　·　Y 第一/第三人称　·　A 观察　·　X 辨认　·　B 冲刺　·　LB 同步　·　RB 放弃　·　方向键上 是 / 下 否　·　LT 闪光（闪光灯卡）</div>'
        +'</div>'
        +'<div class="tips">'
        +'<h3>核心玩法</h3>'
        +'<ul>'
        +'<li><b>线索</b>：每个科室抽屉里都有线索，捡到后 HUD 会帮你筛选 NPC</li>'
        +'<li><b>观察</b>：靠近 NPC 按 E / 手柄 A——先<em>站着不动 2 秒</em>让自己"隐身"，再观察成功率 100%；直接冲上去观察，成功率 40% 还会被发现</li>'
        +'<li><b>辨认</b>：按 F / 手柄 X 提交——完全匹配反而是错的（NPC 不会有你所有线索），认错扣血+生成镜像怪</li>'
        +'<li><b>NPC 会反应</b>：被你看太多次的 NPC 会跑；你们俩人凑到一起，整层 NPC 都不动</li>'
        +'<li><b>手电照人</b>：手电筒照住对方时，对方不能动、不能操作；照方按 是/否 判定对方身份，判定后立即解除；照方松开光束超过 1.5 秒也会自动解除</li>'
        +'<li><b>视角</b>：A 第一人称点击左屏后直接移动鼠标转视角，第三人称拖动鼠标环绕；B 使用手柄右摇杆；V / Y 切换视角</li>'
        +'<li><b>危险区</b>：每层有三个固定污染区，停留超过两秒会持续扣共享血量，视野逐渐模糊；离开后会慢慢恢复。小地图红色区域就是危险区。</li>'
        +'<li><b>心率与救援</b>：同层十米内心率会加快，只显示等级和声音；共享血量归零后对应玩家倒地，另一名玩家靠近长按 F / 手柄 X 两秒即可救援。</li>'
        +'<li><b>相认与逃生</b>：两人距离三米内，A 按 F、B 按手柄 X，在三秒窗口内同时发起相认；成功后感染者出现，两人一起到出口胜利。</li>'
        +'<li><b>紧急同步</b>：A 按 R，B 按手柄 LB，3 秒内响应即可自动联动通知会合</li>'
        +'<li><b>楼梯</b>：靠近楼梯按 E / 手柄 A 切换楼层</li>'
        +'</ul>'
        +'</div>'
        +'<button type="button" id="start-duo" class="start-button">开始游戏（按 2 / 手柄 A）</button>'
        +'<button type="button" id="start-debug" class="start-button" style="margin-top:8px;opacity:.8;">调试模式：双人同一出生点（按 3）</button>';
    }
    else if(kind==='draw'){
      if(G.Game.debugMode){
        function debugPanel(role,label,device){
          var cards=G.Beam.CARDS.map(function(card,i){
            return '<button type="button" class="debug-card-choice" data-debug-role="'+role+'" data-debug-index="'+i+'"'+(role==='p2'?' tabindex="-1"':'')+'><b>'+(i+1)+'</b><span>'+card.name+'</span><small>'+card.flavor+'</small></button>';
          }).join('');
          return '<section class="debug-card-panel '+role+'"><div class="wheel-player">'+label+' <small>'+device+'</small></div>'
            +'<div class="debug-card-grid">'+cards+'</div>'
            +'<div class="debug-card-result" id="debug-result-'+role+'"></div>'
            +'<button type="button" class="wheel-action debug-confirm" id="debug-confirm-'+role+'"'+(role==='p2'?' tabindex="-1"':'')+'></button></section>';
        }
        out='<div class="roulette-intro"><div class="tag">调 试 模 式</div><h2>自由选择六种手电筒功能</h2><p>可直接指定卡牌，便于测试玩法；普通模式仍使用随机大转盘。</p></div>'
          +'<div class="debug-toolbar"><button type="button" id="debug-bright-toggle" class="start-button"></button><span>A：数字键 1-6 / 点击卡牌，L 切换明亮模式　·　B：手柄十字键选择，A 确认</span></div>'
          +'<div class="wheel-split debug-split">'+debugPanel('p1','A 玩家','键盘 · 鼠标')+debugPanel('p2','B 玩家','Xbox 手柄 · 鼠标可选')+'</div>'
          +'<p class="wheel-footer">调试模式不改变碰撞、墙体遮挡或手电照人规则；明亮模式只移除环境黑暗。</p>';
      }else{
      function wheel(role,label,device){
        var labels=G.Beam.CARDS.map(function(card,i){
          var angle=(i+0.5)*360/G.Beam.CARDS.length;
          return '<span class="wheel-label" style="transform:rotate('+angle+'deg) translateY(calc(var(--wheel-size) * -.35)) rotate(90deg)">'+card.name+'</span>';
        }).join('');
        return '<section class="wheel-panel"><div class="wheel-player">'+label+' <small>'+device+'</small></div>'
          +'<div class="wheel-stage"><div class="wheel-pointer"></div><div class="fortune-wheel" id="wheel-'+role+'">'+labels+'</div><div class="wheel-hub">命运</div></div>'
          +'<div class="wheel-result" id="wheel-result-'+role+'" aria-live="polite"></div>'
          +'<button type="button" class="wheel-action" id="wheel-action-'+role+'"'+(role==='p2'?' tabindex="-1"':'')+'></button>'
          +'<button type="button" class="wheel-skip" id="wheel-skip-'+role+'"'+(role==='p2'?' tabindex="-1"':'')+'>跳过转盘，直接随机</button></section>';
      }
      out='<div class="roulette-intro"><div class="tag">命 运 的 恶 作 剧</div><h2>黑暗里，你会带走什么？</h2><p>各自转动转盘，让命运决定今晚的手电筒。</p></div>'
        +'<div class="wheel-split">'+wheel('p1','A 玩家','键盘 · 鼠标')+wheel('p2','B 玩家','Xbox 手柄 · 鼠标备用')+'</div>'
        +'<p class="wheel-footer">每种结果机会相同 · 每人仅转一次 · 双方确认后进入医院</p>';
      }
    }
    else if(kind==='ending'){
      var titles={recognized:'相认成功',escaped:'逃出医院',wrong:'辨认失败',abandon:'选择放手'};
      var texts={
        recognized:'你们在黑暗中认出了彼此。感染者已经醒来，出口就在前方。',
        escaped:'你们守住了彼此的手电光，一起穿过感染者和出口，终于逃离医院。',
        wrong:'生命耗尽。那些和你长得像的人仍在走廊里游荡，脚步声忽远忽近。',
        abandon:'你选择停止寻找。医院三楼的灯在楼梯井里闪烁着，像是在等一个不会再上来的人。'
      };
      out='<h2>'+titles[key]+'</h2>'
        +'<div class="ending">'+texts[key]+'</div>'
        +'<div class="go">按空格返回标题</div>';
    }
    c.classList.toggle('roulette-card',kind==='draw');
    c.innerHTML=out;
    U.el('overlay').classList.add('show');
    if(kind==='draw'){
      if(G.Game.debugMode){
        // 调试页两侧卡牌都允许鼠标点击；B 仍可用手柄十字键和 A。
        Array.prototype.forEach.call(document.querySelectorAll('.debug-card-choice'),function(btn){
          btn.addEventListener('click',function(){G.Game.selectDebugCard(btn.getAttribute('data-debug-role'),Number(btn.getAttribute('data-debug-index')));});
        });
        ['p1','p2'].forEach(function(role){
          var confirm=U.el('debug-confirm-'+role);
          if(confirm)confirm.addEventListener('click',function(){G.Game.turnWheel(role);});
        });
        var bright=U.el('debug-bright-toggle');
        if(bright)bright.addEventListener('click',function(){G.Game.toggleBrightMode();});
      }else{
        U.el('wheel-action-p1').addEventListener('click',function(){G.Game.turnWheel('p1');});
        // B 的转盘默认由手柄 A 启动，但鼠标点击也可作为备用输入。
        U.el('wheel-action-p2').addEventListener('click',function(){G.Game.turnWheel('p2');});
        U.el('wheel-skip-p1').addEventListener('click',function(){G.Game.skipWheel('p1');});
        U.el('wheel-skip-p2').addEventListener('click',function(){G.Game.skipWheel('p2');});
      }
      // B 的转盘由手柄控制，避免鼠标干扰另一名玩家。
      G.UI.updateWheels(G.Game.world);
    }
    if(kind==='brief'){
      var start=U.el('start-duo');
      if(start)start.addEventListener('click',function(){G.Game.reset('duo');});
      var startDebug=U.el('start-debug');
      if(startDebug)startDebug.addEventListener('click',function(){G.Game.reset('debug');});
    }
  };

  G.UI.updateWheels=function(w){
    if(G.Game.debugMode){
      var bright=U.el('debug-bright-toggle');
      if(bright)bright.textContent=w.brightMode?'明亮模式：已开启（点击关闭）':'明亮模式：已关闭（点击去除黑暗）';
      ['p1','p2'].forEach(function(id){
        var p=actor(w,id),r=p.roulette;
        Array.prototype.forEach.call(document.querySelectorAll('.debug-card-choice[data-debug-role="'+id+'"]'),function(btn){
          var idx=Number(btn.getAttribute('data-debug-index'));
          btn.classList.toggle('selected',idx===p.debugIndex&&r.phase!=='ready');
          btn.classList.toggle('locked',r.phase==='ready');
        });
        var result=U.el('debug-result-'+id),confirm=U.el('debug-confirm-'+id);
        if(!result||!confirm)return;
        if(r.phase==='debugSelected'){
          result.innerHTML='<h3>'+p.beamCard.name+'</h3><p>'+p.beamCard.flavor+'</p>';
          confirm.textContent=id==='p1'?'确认选择　Enter / Y':'确认选择　手柄 A';
          confirm.disabled=false;
        }else if(r.phase==='ready'){
          result.innerHTML='<h3>卡牌已收好</h3><p>等待对方完成选择并确认。</p>';
          confirm.textContent='已确认 · 等待同伴';
          confirm.disabled=true;
        }else{
          result.innerHTML='<h3>请选择一张卡牌</h3><p>'+ (id==='p1'?'点击卡牌或按数字 1-6。':'用手柄十字键选择，再按 A。')+'</p>';
          confirm.textContent='先选择卡牌';
          confirm.disabled=true;
        }
      });
      return;
    }
    ['p1','p2'].forEach(function(id){
      var p=actor(w,id),r=p.roulette,button=U.el('wheel-action-'+id),result=U.el('wheel-result-'+id),skip=U.el('wheel-skip-'+id);
      U.el('wheel-'+id).style.transform='rotate('+r.rotation+'deg)';
      var key=id==='p1'?'Enter / Y':'手柄 A';
      var text=r.phase==='idle'?'转动转盘':r.phase==='spinning'?'命运转动中…':r.phase==='revealed'?'收下这份命运':'已确认 · 等待同伴';
      button.textContent=text+(r.phase==='idle'||r.phase==='revealed'?'　'+key:'');
      button.disabled=r.phase==='spinning'||r.phase==='ready';
      if(skip){skip.disabled=r.phase==='revealed'||r.phase==='ready';skip.textContent=r.phase==='revealed'||r.phase==='ready'?'已完成随机':'跳过转盘，直接随机';}
      if(result.dataset && result.dataset.phase===r.phase)return;
      if(result.dataset)result.dataset.phase=r.phase;
      result.innerHTML=r.phase==='revealed'?'<h3>'+p.beamCard.name+'</h3><p>'+p.beamCard.flavor+'</p>':
        r.phase==='ready'?'<h3>卡牌已收好</h3><p>等待对方完成转盘并确认。</p>':
        r.phase==='spinning'?'<h3>光束会落在哪里？</h3><p>转盘正在减速，请稍候。</p>':'<h3>六种命运，一束光</h3><p>按下按键，转动你自己的转盘。</p>';
    });
  };

  function drawMap(role){
    var p=actor(G.Game.world,role),cv=U.el(role==='p1'?'map-a':'map-b'),ctx=cv.getContext('2d'),w=G.Game.world;
    if(!ctx||!w)return;
    ctx.clearRect(0,0,cv.width,cv.height);
    ctx.fillStyle='rgba(4,8,12,.88)';
    ctx.fillRect(0,0,cv.width,cv.height);
    // 网格线
    ctx.strokeStyle='rgba(165,180,188,.14)';
    for(var x=0;x<=8;x++){
      ctx.beginPath();ctx.moveTo(x*27.5,0);ctx.lineTo(x*27.5,110);ctx.stroke();
    }
    for(var y=0;y<=4;y++){
      ctx.beginPath();ctx.moveTo(0,y*27.5);ctx.lineTo(220,y*27.5);ctx.stroke();
    }
    // 已探索区域
    var seen=p.explored[p.floor]||{};
    Object.keys(seen).forEach(function(k){
      var a=k.split(':'),gx=+a[0],gy=+a[1];
      ctx.fillStyle='rgba(115,150,157,.38)';
      ctx.fillRect(gx*27.5,gy*27.5,27,27);
    });
    (w.hazardZones||[]).forEach(function(z){if(z.floor!==p.floor)return;var zx=(z.x-z.w/2)/2400*220,zy=(z.y-z.h/2)/980*110,zw=z.w/2400*220,zh=z.h/980*110;ctx.fillStyle='rgba(180,69,60,.25)';ctx.fillRect(zx,zy,zw,zh);ctx.strokeStyle='rgba(220,91,76,.85)';ctx.strokeRect(zx,zy,zw,zh);});
    // 当前位置
    ctx.fillStyle='#d8b56c';
    ctx.beginPath();ctx.arc(p.x/2400*220,p.y/980*110,4,0,Math.PI*2);ctx.fill();
    // 楼梯标记
    w.entities.forEach(function(e){
      if(e.kind==='stairs'&&e.floor===p.floor){
        ctx.fillStyle='#4ab1c8';
        ctx.fillRect(e.x/2400*220-4,e.y/980*110-4,8,8);
      }
    });
    ctx.fillStyle='#a9b2b5';
    ctx.font='9px sans-serif';
    ctx.fillText(p.floor+'F · 已探索区域',5,10);
    // 楼层切换提示
    var other=actor(w,role==='p1'?'p2':'p1');
    if(other.floor!==p.floor){
      ctx.fillStyle='#b4453c';
      ctx.font='8px sans-serif';
      ctx.fillText('同伴在 '+other.floor+'F',cv.width-60,10);
    }
  }

  G.UI.update=function(w){
    if(!w)return;
    var ids=['p1','p2'];
    ids.forEach(function(id){
      var p=actor(w,id),s=id==='p1'?'a':'b';
      U.el('bar-inf-'+s).style.width=(w.sharedHp||p.hp)+'%';
      U.el('num-inf-'+s).textContent=Math.ceil(w.sharedHp||p.hp);
      U.el('bar-hum-'+s).style.width=p.stamina+'%';
      U.el('num-hum-'+s).textContent=Math.round(p.stamina);
      U.el('hud-foot-'+s).textContent=p.floor+'楼 · '+(p.phone?'手机已取得':'未取得手机')+(p.clues.length?' · '+p.clues.length+' 条线索':'');
      var heartLabel=p.heartLevel>=3?'危险':(p.heartLevel===2?'急促':(p.heartLevel===1?'偏快':'平稳'));
      var heartEl=U.el('heart-'+s);if(heartEl)heartEl.textContent='心率 '+Math.round(p.heartRate)+' · '+heartLabel+(p.downed?' · 倒地':'');
      var haze=U.el('vision-haze-'+s);if(haze){haze.style.opacity=String(Math.min(.82,p.visionBlur));haze.style.backdropFilter='blur('+(p.visionBlur*7).toFixed(1)+'px)';haze.style.webkitBackdropFilter='blur('+(p.visionBlur*7).toFixed(1)+'px)';}
      var viewLabel=G.Renderer&&G.Renderer.getViewLabel?G.Renderer.getViewLabel(id):'第三人称';
      var controlEl=U.el('controls-'+s);
      if(controlEl)controlEl.textContent=(G.Input&&G.Input.controlHints?G.Input.controlHints(id):'')+' · 当前：'+viewLabel;

      // P0-1: HUD 筛选能力自动升级
      var hud=computeHUDLevel(p);
      var clueText;
      if(hud.level===0){
        clueText='外貌线索：尚未收集 · 先去科室找物品线索';
      }else{
        var knownLabels=hud.known.map(function(t){return TRAIT_INFO[t]?TRAIT_INFO[t].label:t;});
        // 实时计算当前楼层 NPC 的嫌疑等级
        var susList=[];
        w.entities.forEach(function(e){
          if(e.kind==='npc'&&e.alive&&e.floor===p.floor){
            var mc=matchTraits(e,hud.known);
            var sus=suspicionText(mc,hud.known.length);
            if(hud.level>=2 && sus!=='')susList.push(e.id+':'+sus);
          }
        });
        clueText='外貌线索('+hud.known.length+'条)：'+knownLabels.join(' · ');
        if(hud.level===1){
          clueText+=' · 【HUD Lv1】靠近 NPC 观察；小地图上匹配线索的 NPC 会发光';
        }else if(hud.level===2){
          clueText+=' · 【HUD Lv2】本层 NPC 嫌疑：'+(susList.length?susList.join(' / '):'观察太少，没数据');
        }else{
          // Lv3：自动排除 + 最可能
          clueText+=' · 【HUD Lv3】线索充足！排除不匹配者，优先辨认嫌疑"高"的 NPC';
        }
      }
      if(p.hasMeetClue)clueText+=' · 会合提示已发现';
      U.el('clue-'+s).textContent=clueText;

      // 光束照到的人物直接展示全部外貌，且遵守遮挡和卡牌效果。
      var dir=playerDir(id), visiblePerson=null;
      w.entities.forEach(function(e){
        if(!e.alive || e.id===id || (e.kind!=='player'&&e.kind!=='npc'))return;
        if(G.Beam.hits(w,p,dir,e) && (!visiblePerson || dist(p,e)<dist(p,visiblePerson)))visiblePerson=e;
      });
      var target=actor(w,id==='p1'?'p2':'p1'), lock=w.beam&&w.beam.lock[target.id];
      if(visiblePerson && !(p.beam&&p.beam.hideTraits)) clueText+=' · 照见：'+(visiblePerson.traits||[]).map(function(t){return TRAIT_INFO[t]?TRAIT_INFO[t].label:t;}).join('、');
      if(lock && lock.by===id && !lock.flash) clueText+=' · '+(id==='p1'?'Y 是 / N 否':'方向键上 是 / 下 否');
      if(!G.Beam.canAct(w,id)) clueText+=' · 被照住，等待对方确认';
      if(p.downed)clueText+=' · 倒地：等待同伴长按 '+(id==='p1'?'F':'手柄 X')+' 救援';
      if(w.recognition&&w.recognition.state==='active')clueText+=' · 相认窗口 '+Math.max(0,w.recognition.expiresAt-w.time).toFixed(1)+' 秒';
      if(w.escape&&w.escape.active&&!w.ended)clueText+=' · 医院公敌：两人一起前往出口';
      U.el('clue-'+s).textContent=clueText;

      // 手机消息
      var inbox=p.inbox.length?p.inbox[0].text:'等待短信';
      U.el('phone-'+s).textContent=p.phone?'手机 · '+inbox:'手机未取得';

      // HUD Lv2+：在 feed 里额外给一个"最可能目标"提示
      if(hud.level>=2 && (p.noticeUntil<=w.time||!p.notice)){
        var best=null,bestScore=-1;
        w.entities.forEach(function(e){
          if(e.kind==='npc'&&e.alive&&e.floor===p.floor){
            var score=matchTraits(e,hud.known);
            if(score>bestScore){bestScore=score;best=e;}
          }
        });
        if(best && bestScore>0){
          U.el('feed-'+s).textContent='【HUD建议】附近最可疑的 NPC 约在 ('+Math.round(best.x)+','+Math.round(best.y)+')，匹配度 '+bestScore+'/'+hud.known.length;
        }
      }else{
        U.el('feed-'+s).textContent=(p.noticeUntil>w.time&&p.notice)?p.notice:'';
      }

      drawMap(id);
    });
    var duo=G.Game.mode==='duo';
    U.el('hud-right').classList.toggle('off',!duo);
    U.el('split-line').classList.toggle('off',!duo);
    U.el('hud-left').classList.toggle('off',G.State.current==='TITLE'||G.State.current==='BRIEF');
    // ========== A/B 各自的主线+支线任务 ==========
    // 主线：找到对方并辨认成功（双方汇合时）
    // 支线：收集线索、拿到手机、观察足够多 NPC 特征
    function buildTaskHTML(role){
      var p=actor(w,role);
      var otherFloor=actor(w,role==='p1'?'p2':'p1').floor;
      var clueCount=(p.clues||[]).length;
      var mainHTML='<div class="m">● 主线：在 '+otherFloor+' 楼附近找到对方，提交辨认</div>';
      var subHTML='<div class="s">□ 支线</div>';
      var tasks=[
        {done:p.phone,label:'拾取手机（自动短信定位）'},
        {done:clueCount>=2,label:'收集 2 条外貌线索（当前 '+clueCount+'/2）'},
        {done:clueCount>=4,label:'收集 4 条外貌线索（当前 '+clueCount+'/4）'},
        {done:p.hasMeetClue,label:'发现会合提示'},
        {done:p.recognizedTarget,label:'观察足够多 NPC 特征并确认对方'}
      ];
      tasks.forEach(function(t){
        var mark=t.done?'✓':'□';
        subHTML+='<div class="sub">'+mark+' '+t.label+'</div>';
      });
      return mainHTML+subHTML;
    }
    U.el('task-a').innerHTML=buildTaskHTML('p1');
    U.el('task-b').innerHTML=buildTaskHTML('p2');
    var promptA = G.Input&&G.Input.controlHints ? G.Input.controlHints('p1') : '键盘 WASD 移动 · 鼠标转视角';
    var promptB = G.Input&&G.Input.controlHints ? G.Input.controlHints('p2') : '手柄右摇杆转视角';
    U.el('prompt').textContent='A：'+promptA+'　　B：'+promptB;
    if(G.Subtitles&&G.Subtitles.push){
      var subsEl=U.el('subtitles');
      if(subsEl)subsEl.innerHTML='';
    }
  };
})();
