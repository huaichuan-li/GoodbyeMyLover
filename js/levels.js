/* Three-level hospital greybox: doors/corridors and stairs share the same logical collision layout. */
(function(){
  var G=window.G=window.G||{},C=G.DATA.config;
  var departments={1:['挂号大厅','药房','急诊分诊','一楼候诊'],2:['内科','外科','儿科','眼科'],3:['急诊科','影像科','检验科','康复科'],4:['隔离病房','重症监护','旧手术室','屋顶候诊']};
  function add(w,o){G.World.add(w,G.Entities.make(o));}
  function wall(w,f,x,y,width,height,kind){w.walls.push({x:x,y:y,w:width,h:height,floor:f,kind:kind||'partition'});}
  function addDoorFrames(w,f){
    // Two banks of rooms open directly into a 2.4m central corridor. Door clear width is 1.2m.
    var cells=[310,660,1010,1360,1710];
    cells.forEach(function(x,i){
      var center=x+175;
      // Partition between neighboring rooms, with a 1.1m side-to-side doorway.
      [125,610].forEach(function(y){wall(w,f,x,y,18,185,'partition');wall(w,f,x,y+285,18,245,'partition');});
      // Room fronts: door openings are centered in each bay.
      [370,610].forEach(function(y){
        var left=Math.max(x,36),right=Math.min(x+350,2364),gap=120;
        wall(w,f,left,y,center-gap/2-left,18,'partition');
        wall(w,f,center+gap/2,y,right-(center+gap/2),18,'partition');
      });
      // Expose doorway coordinates to renderer and minimap without revealing unexplored rooms.
      w.doors.push({floor:f,x:center,y:370},{floor:f,x:center,y:610});
    });
  }
  G.Level={departments:departments,build:function(w){
    w.walls=[];w.doors=[];w.puddles=[];w.zones=[];w.hazardZones=[];w.candidates=[];w.followers=[];w.entities=[w.p1,w.p2];w.byId={p1:w.p1,p2:w.p2};
    for(var f=1;f<=4;f++){
      w.zones.push({floor:f,x:1200,y:490,name:f+'楼中央走廊'});
      // 每层固定三个危险区，分布在两侧病房与中央动线上；坐标同时用于小地图标红。
      [{x:690,y:490,w:180,h:180,name:'污染候诊区'},{x:1200,y:490,w:220,h:170,name:'感染走廊'},{x:1770,y:490,w:190,h:190,name:'封锁病房'}].forEach(function(z,i){
        w.hazardZones.push({id:'hazard-'+f+'-'+i,floor:f,x:z.x,y:z.y,w:z.w,h:z.h,name:z.name});
      });
      wall(w,f,0,0,2400,36,'boundary');wall(w,f,0,944,2400,36,'boundary');wall(w,f,0,0,36,980,'boundary');wall(w,f,2364,0,36,980,'boundary');
      addDoorFrames(w,f);
      if(f===1){
        add(w,{id:'stairs-up-1',kind:'stairs',floor:1,x:1190,y:490,r:74,label:'上楼至二楼',targetFloor:2,direction:'UP'});
      }else if(f===2){
        add(w,{id:'stairs-down-2',kind:'stairs',floor:2,x:1110,y:490,r:58,label:'下楼至一楼',targetFloor:1,direction:'DOWN'});
        add(w,{id:'stairs-up-2',kind:'stairs',floor:2,x:1270,y:490,r:58,label:'上楼至三楼',targetFloor:3,direction:'UP'});
      }else if(f===3){
        add(w,{id:'stairs-down-3',kind:'stairs',floor:3,x:1110,y:490,r:58,label:'下楼至二楼',targetFloor:2,direction:'DOWN'});
        add(w,{id:'stairs-up-3',kind:'stairs',floor:3,x:1270,y:490,r:58,label:'上楼至四楼',targetFloor:4,direction:'UP'});
      }else{
        add(w,{id:'stairs-down-4',kind:'stairs',floor:4,x:1190,y:490,r:74,label:'下楼至三楼',targetFloor:3,direction:'DOWN'});
      }
    }
    // Department labels positioned in each floor layout
    departments[1].forEach(function(name,i){add(w,{id:'sign-1-'+i,kind:'room',floor:1,x:300+i*600,y:115,r:18,label:name});});
    [2,3,4].forEach(function(f){departments[f].forEach(function(name,i){var x=420+i*450,y=i%2?760:220;add(w,{id:'sign-'+f+'-'+i,kind:'room',floor:f,x:x,y:y,r:18,label:name});});});

    // === 线索布置：每层都有线索卡，分布在不同科室 ===
    // 线索带有特征标签，p1 和 p2 各拿到对方的线索
    add(w,{id:'clueA',kind:'clue',floor:1,x:450,y:220,r:24,role:'p1',label:'挂号台的证件照片',trait:'blueWristband',clueText:'你要找的人戴着蓝色腕带。'});
    add(w,{id:'clueB',kind:'clue',floor:3,x:1800,y:760,r:24,role:'p2',label:'护士站的访客登记',trait:'darkCoat',clueText:'你要找的人裹着深色外层绷带。'});
    add(w,{id:'clueA2',kind:'clue',floor:2,x:420,y:220,r:24,role:'p1',label:'值班交接单',trait:'limpGait',clueText:'第二条特征：走路时右脚微微拖着。'});
    add(w,{id:'clueB2',kind:'clue',floor:2,x:1530,y:760,r:24,role:'p2',label:'遗落的围巾',trait:'badgeAccessory',clueText:'第二条特征：胸前别着一枚旧式银色徽章。'});
    // 会合线索（找到对方手机后获得）
    add(w,{id:'meetClueA',kind:'clue',floor:1,x:1880,y:760,r:24,role:'p1',label:'墙上的楼层疏散图',trait:'meetHint',clueText:'会合提示：对方最近在【'+departments[2][0]+'】附近出现。'});
    add(w,{id:'meetClueB',kind:'clue',floor:1,x:520,y:220,r:24,role:'p2',label:'墙上的楼层疏散图',trait:'meetHint',clueText:'会合提示：对方最近在【'+departments[1][0]+'】附近出现。'});

    // === 手机（每层分散布置） ===
    add(w,{id:'phoneA',kind:'phone',floor:1,x:520,y:760,r:22,role:'p1',label:'旧手机'});
    add(w,{id:'phoneB',kind:'phone',floor:3,x:1880,y:220,r:22,role:'p2',label:'旧手机'});

    // === 能量棒（恢复体力） ===
    [[1,760,220],[2,1500,760],[3,800,220],[3,2050,760],[2,500,760],[4,1500,220]].forEach(function(q,i){add(w,{id:'food'+i,kind:'food',floor:q[0],x:q[1],y:q[2],r:18,label:'能量棒'});});
    // 固定药物点：靠近后自动拾取，恢复共享血量。
    [[1,520,760],[2,1030,220],[3,1850,760],[4,520,220]].forEach(function(q,i){add(w,{id:'medicine'+i,kind:'medicine',floor:q[0],x:q[1],y:q[2],r:24,label:'急救药物',heal:28});});
    // 同层测试出口；相认后两人都进入出口才算胜利。
    add(w,{id:'exit-'+w.p1.floor,kind:'exit',floor:w.p1.floor,x:2320,y:490,r:52,label:'医院出口'});

    // === 目标人物（真爱）设定 ===
    // 全员木乃伊：P1、P2 与所有 NPC 同一基础体型，差异只来自绷带/饰品等 trait。
    // 真爱 p2 要找的人 = p1 玩家；真爱 p1 要找的人 = p2 玩家。
    // NPC 是干扰项，随机挂 1–2 个 trait（可能与玩家重复，制造混淆）。
    var states=['still','walk','slowRun','lie','wander'];
    var traitPool=['blueWristband','darkCoat','limpGait','badgeAccessory','silverRing','scarLeftCheek','glassesRound','caneDark'];
    // 玩家的外貌 trait 与线索文案一致（见 clueA/clueB 等），美术文档 §5 对应。
    if(w.p2)w.p2.traits=['blueWristband','limpGait'];
    if(w.p1)w.p1.traits=['darkCoat','badgeAccessory'];

    var npcCount=C.npc.count;
    for(var n=0;n<npcCount;n++){
      var f=1+Math.floor(Math.random()*3),x=180+Math.random()*2040,y=100+Math.random()*780;
      if(Math.abs(x-1190)<260&&Math.abs(y-490)<180)x+=260; // 避开楼梯
      var state=states[Math.floor(Math.random()*states.length)];
      // 每个 NPC 有 1-2 个特征
      var npcTraits=[];
      var traitCount=1+Math.floor(Math.random()*2);
      for(var t=0;t<traitCount;t++){
        var tr=traitPool[Math.floor(Math.random()*traitPool.length)];
        if(npcTraits.indexOf(tr)<0)npcTraits.push(tr);
      }
      add(w,{
        id:'npc'+n,kind:'npc',floor:f,x:x,y:y,r:22,
        state:state,speed:state==='slowRun'?82:(state==='walk'||state==='wander'?42:0),
        targetX:x,targetY:y,phase:Math.random()*10,
        trueForm:'mummy',appearanceId:'npc_'+(n+1<10?'0':'')+(n+1),traits:npcTraits,
        // 被接近时的行为反应
        reaction: Math.random()<0.4?'flee':(Math.random()<0.6?'freeze':'approach')
      });
    }

    w.recog={stage:'EXPLORE',clueA:false,clueB:false,recognized:false,wrong:false,attempts:0};
    w.goal='寻找对方外貌线索，继续调查互相指向的线索，并在合适的时机完成相认。';
  }};
  G.Timeline={update:function(){},toChoice:function(){}};
})();
