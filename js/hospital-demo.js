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
  function floorValid(f){return f>=1&&f<=3;}
  function nearest(w,p,role,submit){
    var best=null,bd=C.npc.pickupRadius;
    var allowed=submit?{npc:1,player:1}:{stairs:1,clue:1,phone:1,food:1,npc:1,player:1};
    w.entities.forEach(function(e){
      if(!e.alive||e.floor!==p.floor||e.id===p.id||!allowed[e.kind])return;
      if(submit&&e.kind!=='npc'&&e.kind!=='player')return;
      if(e.role&&e.role!==role&&e.kind!=='player')return;
      var d=dist(e,p),priority=e.kind==='stairs'?0.72:(e.kind==='npc'?0.82:1);
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
        p.hp=Math.max(0,p.hp-10);w.recog.attempts++;
        p.notice='你还没有足够线索来判断。或者这个人特征和你知道的完全不同。';
        p.noticeUntil=w.time+2.5;
        // 认错代价：生成一个"镜像怪"
        spawnMirrorClone(w,role,e);
      }else if(matchCount===totalKnown){
        // 完全匹配 = 认错了（因为 NPC 不会有你所有的线索特征）
        p.hp=Math.max(0,p.hp-25);w.recog.attempts++;w.recog.wrong=true;
        p.notice='你认错了！这个人的特征完全符合……但反应不对。生命 -25';
        p.noticeUntil=w.time+3;
        spawnMirrorClone(w,role,e);
      }else{
        // 部分匹配：不惩罚，提示需要更多线索
        p.notice='部分特征匹配，但还不能确认。继续寻找线索。';
        p.noticeUntil=w.time+2.5;
      }
      if(p.hp<=0)end(w,'wrong');
      return;
    }

    // === 玩家（真爱）===
    if(e.kind==='player'){
      var otherRole=role==='p1'?'p2':'p1';
      if(!p.clues.length){p.notice='先找到线索，再辨认眼前的人。';p.noticeUntil=w.time+2.2;return;}
      var myKnown=knownTraitsOf(p);
      // 检查是否"认出"——如果双方都在附近并且都提交辨认
      p.recognizedTarget=true;
      p.notice='你根据线索认出了对方！等待对方回应……';
      p.noticeUntil=w.time+3;
      // 同步给对方
      if(!G.Game.world[otherRole].notices)G.Game.world[otherRole].notices=[];
      if(G.Game.world[otherRole].recognizedTarget)return end(w,'recognized');
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

  // ========== 主 tick ==========
  function tick(w,dt){
    if(!w||w.ended)return;
    w.time+=dt;
    ['p1','p2'].forEach(function(id){var p=actor(w,id);move(w,p,id,dt);markExplore(p);});
    npcUpdate(w,dt);
  }

  // ========== 游戏入口 ==========
  G.Hospital={roomAt:roomAt,interact:interact,end:end,tick:tick};
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
      this.mode=mode||'duo';
      this.dualView=false;
      if(G.Renderer&&G.Renderer.resetViews)G.Renderer.resetViews();
      this.world=G.World.create();
      G.Level.build(this.world);
      // 初始化 explored 标记
      ['p1','p2'].forEach(function(id){
        var p=actor(this.world,id);
        p.explored={1:{},2:{},3:{}};
        p.inbox=[];
        p.clues=[];
        p.notice='你们在医院不同楼层醒来。寻找桌面线索，认出对方。';
        p.noticeUntil=this.world.time+4;
        p.currentRoom=roomAt(p);
      }.bind(this));
      G.UI.overlay(null);
      if(G.Audio){G.Audio.unlock();if(G.Audio.startAmbient)G.Audio.startAmbient();}
      G.State.set('PLAY');
      if(G.Subtitles){G.Subtitles.clear();}
      ['p1','p2'].forEach(function(id){
        var p=actor(this.world,id);
        var fromRole=id==='p1'?'p2':'p1';
        publish(this.world,id,'对方在'+actor(this.world,fromRole).floor+'楼醒来。你们需要找到线索互相辨认。');
      }.bind(this));
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
        if(ev.code==='Digit2'||ev.code==='Numpad2'||ev.key==='2'||ev.code==='Space')this.reset('duo');
        return;
      }
      if(ph==='RESULT'){
        if(ev.code==='Space'||ev.code==='Enter'||ev.code==='Escape'){G.State.set('TITLE');G.UI.overlay('title');}
        return;
      }
      if(!w)return;
      if(ev.code==='Escape'){G.State.set('TITLE');G.UI.overlay('title');return;}
      if(ev.code==='KeyM'&&G.Audio){G.Audio.muteAll(1);return;}
      var role=ev.owner;
      if(role==='p2'&&ev.source!=='gamepad')return;
      if(role!=='p1'&&role!=='p2')return;
      var code=ev.code;
      // A 用键盘 V，B 用手柄 Y，各自只切自己的相机。
      if((role==='p1'&&code==='KeyV')||(role==='p2'&&code==='GamepadY')){
        if(G.Renderer&&G.Renderer.toggleView){
          var mode=G.Renderer.toggleView(role);
          var pView=actor(w,role);
          pView.notice=(mode==='first'?'第一人称视角已启用。':'第三人称视角已启用。')+(role==='p2'?' 右摇杆控制视角。':' 拖动鼠标控制视角。');
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
        if(p.stamina>=C.stamina.dashCost){p.stamina-=C.stamina.dashCost;p.dashT=.3;}
      }
      // ========== P1-2: 紧急同步（双方同时按则共享最有价值信息） ==========
      // A：R 键；B：手柄 LB（保留小键盘 . 作为兼容入口）
      if((role==='p1'&&code==='KeyR')||(role==='p2'&&(code==='NumpadDecimal'||code==='GamepadLB'))){
        emergencySync(w,role);
      }
    },
    update:function(dt){
      var w=this.world;
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
        +'<p>末日来了。医院的感染把你变成了人马，把你的爱人变成了木乃伊。</p>'
        +'<p>停电后的医院漆黑一片，你们在混乱中失散。只有手电筒照到的地方能看清；楼梯、病房和走廊深处，都可能藏着什么。</p>'
        +'<p class="warn">感染扭曲了你们的视线：木乃伊眼里全是人马，人马眼里全是木乃伊。找到彼此，也要认出彼此。</p>'
        +'<div class="go">按任意键查看操作说明</div>';
    }
    else if(kind==='brief'){
      out='<h2>末 日 医 院 · 第 四 十 一 天</h2>'
        +'<p>最后一次停电发生在感染爆发之后。你醒来时已经变成人马，爱人变成了木乃伊；医院里全是相似的身影，你们在黑暗中走散。</p>'
        +'<p>两支手电筒是黑暗里仅有的视野。沿着三层医院寻找线索、听脚步、观察身影，再设法找到对方。感染会让你们把爱人看成怪物，也把陌生人看成爱人。</p>'
        +'<h3>当前版本操作</h3>'
        +'<p>你们在医院不同楼层醒来，外貌变得陌生。<br>'
        +'探索科室找线索 → 观察 NPC 的特征和行为 → 确认对方是谁。</p>'
        +'<div class="keys">'
        +'<div><b>A 玩家（键盘+鼠标）</b>：WASD 移动　·　拖动鼠标转视角　·　V 第一/第三人称　·　E 观察　·　F 辨认　·　Shift 冲刺　·　R 同步</div>'
        +'<div><b>B 玩家（外置手柄）</b>：左摇杆移动　·　右摇杆转视角　·　Y 第一/第三人称　·　A 观察　·　X 辨认　·　B 冲刺　·　LB 同步　·　RB 放弃</div>'
        +'</div>'
        +'<div class="tips">'
        +'<h3>核心玩法</h3>'
        +'<ul>'
        +'<li><b>线索</b>：每个科室抽屉里都有线索，捡到后 HUD 会帮你筛选 NPC</li>'
        +'<li><b>观察</b>：靠近 NPC 按 E——先<em>站着不动 2 秒</em>让自己"隐身"，再观察成功率 100%；直接冲上去观察，成功率 40% 还会被发现</li>'
        +'<li><b>辨认</b>：按 F 提交——完全匹配反而是错的（NPC 不会有你所有线索），认错扣血+生成镜像怪</li>'
        +'<li><b>NPC 会反应</b>：被你看太多次的 NPC 会跑；你们俩人凑到一起，整层 NPC 都不动</li>'
        +'<li><b>视角</b>：A 拖动左屏鼠标，B 使用手柄右摇杆；V / Y 切换第一人称和第三人称，第三人称可环绕观察</li>'
        +'<li><b>紧急同步</b>：A 按 R，B 按手柄 LB，3 秒内响应即可自动联动通知会合</li>'
        +'<li><b>楼梯</b>：靠近楼梯按 E 切换楼层</li>'
        +'</ul>'
        +'</div>'
        +'<button type="button" id="start-duo" class="start-button">开始游戏（按 2）</button>';
    }
    else if(kind==='ending'){
      var titles={recognized:'相认成功',wrong:'辨认失败',abandon:'选择放手'};
      var texts={
        recognized:'你终于认出了对方。医院的喧嚣仍在继续，但这次你确定没有认错人。你们一起走出了那栋楼。',
        wrong:'生命耗尽。那些和你长得像的人仍在走廊里游荡，脚步声忽远忽近。',
        abandon:'你选择停止寻找。医院三楼的灯在楼梯井里闪烁着，像是在等一个不会再上来的人。'
      };
      out='<h2>'+titles[key]+'</h2>'
        +'<div class="ending">'+texts[key]+'</div>'
        +'<div class="go">按空格返回标题</div>';
    }
    c.innerHTML=out;
    U.el('overlay').classList.add('show');
    if(kind==='brief'){
      var start=U.el('start-duo');
      if(start)start.addEventListener('click',function(){G.Game.reset('duo');});
    }
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
      U.el('bar-inf-'+s).style.width=p.hp+'%';
      U.el('num-inf-'+s).textContent=p.hp;
      U.el('bar-hum-'+s).style.width=p.stamina+'%';
      U.el('num-hum-'+s).textContent=Math.round(p.stamina);
      U.el('hud-foot-'+s).textContent=p.floor+'楼 · '+(p.phone?'手机已取得':'未取得手机')+(p.clues.length?' · '+p.clues.length+' 条线索':'');
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
    U.el('prompt').textContent='A：拖动鼠标转视角 · V 切换视角　　B：右摇杆转视角 · Y 切换视角';
    if(G.Subtitles&&G.Subtitles.push){
      var subsEl=U.el('subtitles');
      if(subsEl)subsEl.innerHTML='';
    }
  };
})();
