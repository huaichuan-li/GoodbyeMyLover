/* 三层简化医院：大厅/药房 + 两层各五间科室；角色、交互点均使用 x/y/floor 逻辑坐标。 */
(function(){
  var G=window.G=window.G||{};
  var departments={1:['挂号大厅','药房'],2:['内科','外科','儿科','眼科','口腔科'],3:['急诊科','影像科','检验科','康复科','妇产科']};
  function add(w,o){G.World.add(w,G.Entities.make(o));}
  G.Level={departments:departments,build:function(w){
    w.walls=[];w.puddles=[];w.zones=[];w.candidates=[];w.followers=[];w.entities=[w.p1,w.p2];w.byId={p1:w.p1,p2:w.p2};
    for(var f=1;f<=3;f++){
      w.zones.push({floor:f,x:1200,y:490,name:departments[f].join(' · ')});
      // 隔间墙留下中部走廊通路；五间科室沿南北两翼分布。
      w.walls.push({x:0,y:0,w:2400,h:36,floor:f},{x:0,y:944,w:2400,h:36,floor:f},{x:0,y:0,w:36,h:980,floor:f},{x:2364,y:0,w:36,h:980,floor:f});
      for(var i=0;i<5;i++){
        var x=310+i*350;
        w.walls.push({x:x,y:125,w:18,h:245,floor:f,kind:'partition'},{x:x,y:610,w:18,h:245,floor:f,kind:'partition'});
      }
      // stairs / landings sit at the center; walking onto the landing changes floor.
      add(w,{id:'stairs'+f,kind:'stairs',floor:f,x:1190,y:490,r:62,label:'楼梯'});
    }
    // Reception and pharmacy on floor one; five departments each on floors two and three.
    departments[1].forEach(function(name,i){add(w,{id:'sign-1-'+i,kind:'room',floor:1,x:420+i*1550,y:115,r:18,label:name});});
    [2,3].forEach(function(f){departments[f].forEach(function(name,i){var x=420+i*350,y=i%2?760:220;add(w,{id:'sign-'+f+'-'+i,kind:'room',floor:f,x:x,y:y,r:18,label:name});});});
    // Tabletop objects yield appearance clues. Each clue is private to one player and describes the other.
    add(w,{id:'clueA',kind:'clue',floor:2,x:420,y:220,r:24,role:'p1',label:'桌上的证件照'});
    add(w,{id:'clueB',kind:'clue',floor:3,x:1770,y:760,r:24,role:'p2',label:'桌上的围巾'});
    add(w,{id:'phoneA',kind:'phone',floor:1,x:520,y:760,r:22,role:'p1',label:'手机'});
    add(w,{id:'phoneB',kind:'phone',floor:1,x:1880,y:220,r:22,role:'p2',label:'手机'});
    [[2,760,220],[2,1500,760],[3,800,500],[3,2050,490]].forEach(function(q,i){add(w,{id:'food'+i,kind:'food',floor:q[0],x:q[1],y:q[2],r:18,label:'能量棒'});});
    var states=['still','walk','slowRun','lie','wander'];
    // Every round reshuffles civilian behaviour independently from their positions.
    for(var n=0;n<C.npc.count;n++){
      var f=1+Math.floor(Math.random()*3),x=180+Math.random()*2040,y=100+Math.random()*780;
      if(Math.abs(x-1190)<150&&Math.abs(y-490)<140)x+=230;
      var state=states[Math.floor(Math.random()*states.length)];
      add(w,{id:'npc'+n,kind:'npc',floor:f,x:x,y:y,r:22,state:state,speed:state==='slowRun'?82:(state==='walk'||state==='wander'?42:0),targetX:x,targetY:y,phase:Math.random()*10,trueForm:'human'});
    }
    w.recog={stage:'EXPLORE',clueA:false,clueB:false,recognized:false,wrong:false,attempts:0};
    w.goal='找到桌面物品获取对方外貌线索，再在医院中认出对方。';
  }};
  G.Timeline={update:function(){},toChoice:function(){}};
})();
