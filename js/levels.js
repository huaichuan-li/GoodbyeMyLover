/* Single-floor hospital greybox: doors/corridors share the same logical collision layout.
   楼层已简化为单层（1F）；w.walls 仍是碰撞/遮挡/手电的唯一真源。 */
(function(){
  var G=window.G=window.G||{},C=G.DATA.config;
  var departments={1:['挂号大厅','药房','急诊分诊','一楼候诊']};
  function add(w,o){G.World.add(w,G.Entities.make(o));}
  function wall(w,f,x,y,width,height,kind){w.walls.push({x:x,y:y,w:width,h:height,floor:f,kind:kind||'partition'});}
  function addDoorFrames(w,f){
    var cells=[310,660,1010,1360,1710];
    cells.forEach(function(x,i){
      var center=x+175;
      [125,610].forEach(function(y){wall(w,f,x,y,18,185,'partition');wall(w,f,x,y+285,18,245,'partition');});
      [370,610].forEach(function(y){
        var left=Math.max(x,36),right=Math.min(x+350,2364),gap=120;
        wall(w,f,left,y,center-gap/2-left,18,'partition');
        wall(w,f,center+gap/2,y,right-(center+gap/2),18,'partition');
      });
      w.doors.push({floor:f,x:center,y:370},{floor:f,x:center,y:610});
    });
  }
  G.Level={departments:departments,build:function(w){
    w.walls=[];w.doors=[];w.puddles=[];w.zones=[];w.hazardZones=[];w.candidates=[];w.followers=[];w.entities=[w.p1,w.p2];w.byId={p1:w.p1,p2:w.p2};
    var f=1;
    w.zones.push({floor:f,x:1200,y:490,name:'一楼中央走廊'});
    [{x:690,y:490,w:180,h:180,name:'污染候诊区'},{x:1200,y:490,w:220,h:170,name:'感染走廊'},{x:1770,y:490,w:190,h:190,name:'封锁病房'}].forEach(function(z,i){
      w.hazardZones.push({id:'hazard-'+f+'-'+i,floor:f,x:z.x,y:z.y,w:z.w,h:z.h,name:z.name});
    });
    wall(w,f,0,0,2400,36,'boundary');wall(w,f,0,944,2400,36,'boundary');wall(w,f,0,0,36,980,'boundary');wall(w,f,2364,0,36,980,'boundary');
    addDoorFrames(w,f);
    // 科室牌（单层 4 个科室）
    departments[1].forEach(function(name,i){add(w,{id:'sign-1-'+i,kind:'room',floor:1,x:300+i*600,y:115,r:18,label:name});});

    // === 线索布置：全部 4 条外貌线索迁到 1F 不同科室 ===
    add(w,{id:'clueA',kind:'clue',floor:1,x:450,y:220,r:24,role:'p1',label:'挂号台的证件照片',trait:'blueWristband',clueText:'你要找的人戴着蓝色腕带。'});
    add(w,{id:'clueB',kind:'clue',floor:1,x:1800,y:760,r:24,role:'p2',label:'护士站的访客登记',trait:'darkCoat',clueText:'你要找的人裹着深色外层绷带。'});
    add(w,{id:'clueA2',kind:'clue',floor:1,x:420,y:760,r:24,role:'p1',label:'值班交接单',trait:'limpGait',clueText:'第二条特征：走路时右脚微微拖着。'});
    add(w,{id:'clueB2',kind:'clue',floor:1,x:1530,y:220,r:24,role:'p2',label:'遗落的围巾',trait:'badgeAccessory',clueText:'第二条特征：胸前别着一枚旧式银色徽章。'});
    // 会合线索（找到对方手机后获得）—— 单层无楼层，改成走廊方位
    add(w,{id:'meetClueA',kind:'clue',floor:1,x:1880,y:760,r:24,role:'p1',label:'墙上的疏散图',trait:'meetHint',clueText:'会合提示：对方最近在【'+departments[1][1]+'】附近出现。'});
    add(w,{id:'meetClueB',kind:'clue',floor:1,x:520,y:220,r:24,role:'p2',label:'墙上的疏散图',trait:'meetHint',clueText:'会合提示：对方最近在【'+departments[1][0]+'】附近出现。'});

    // === 手机（1F 两端）===
    add(w,{id:'phoneA',kind:'phone',floor:1,x:520,y:760,r:22,role:'p1',label:'旧手机'});
    add(w,{id:'phoneB',kind:'phone',floor:1,x:1880,y:220,r:22,role:'p2',label:'旧手机'});

    // === 能量棒（分散在 1F 各处，避开危险区与出生点）===
    [[760,220],[1500,760],[800,760],[2050,220],[500,760],[1900,490]].forEach(function(q,i){add(w,{id:'food'+i,kind:'food',floor:1,x:q[0],y:q[1],r:18,label:'能量棒'});});
    [[520,760],[1030,220],[1850,760],[520,220]].forEach(function(q,i){add(w,{id:'medicine'+i,kind:'medicine',floor:1,x:q[0],y:q[1],r:24,label:'急救药物',heal:28});});
    // 相认后出口（单层）
    add(w,{id:'exit-1',kind:'exit',floor:1,x:2320,y:490,r:52,label:'医院出口'});

    // === 目标人物（真爱）设定：全员木乃伊 ===
    var states=['still','walk','slowRun','lie','wander'];
    var traitPool=['blueWristband','darkCoat','limpGait','badgeAccessory','silverRing','scarLeftCheek','glassesRound','caneDark'];
    if(w.p2)w.p2.traits=['blueWristband','limpGait'];
    if(w.p1)w.p1.traits=['darkCoat','badgeAccessory'];

    var npcCount=C.npc.count;
    for(var n=0;n<npcCount;n++){
      var x=180+Math.random()*2040,y=100+Math.random()*780;
      var state=states[Math.floor(Math.random()*states.length)];
      var npcTraits=[];
      var traitCount=1+Math.floor(Math.random()*2);
      for(var t=0;t<traitCount;t++){
        var tr=traitPool[Math.floor(Math.random()*traitPool.length)];
        if(npcTraits.indexOf(tr)<0)npcTraits.push(tr);
      }
      add(w,{
        id:'npc'+n,kind:'npc',floor:1,x:x,y:y,r:22,
        state:state,speed:state==='slowRun'?82:(state==='walk'||state==='wander'?42:0),
        targetX:x,targetY:y,phase:Math.random()*10,
        trueForm:'mummy',appearanceId:'npc_'+(n+1<10?'0':'')+(n+1),traits:npcTraits,
        reaction: Math.random()<0.4?'flee':(Math.random()<0.6?'freeze':'approach')
      });
    }

    w.recog={stage:'EXPLORE',clueA:false,clueB:false,recognized:false,wrong:false,attempts:0};
    w.goal='寻找对方外貌线索，继续调查互相指向的线索，并在合适的时机完成相认。';
  }};
  G.Timeline={update:function(){},toChoice:function(){}};
})();
