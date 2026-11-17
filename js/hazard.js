/* 危险区、共享血条、心率与倒地救援。逻辑坐标 100 单位约等于 1 米。 */
(function(){
  var G=window.G=window.G||{};
  var H={
    reset:function(w){
      w.sharedHp=100;w.sharedHpMax=100;w.downedRole=null;w.downedAt=0;
      w.hazardZones=w.hazardZones||[];
      ['p1','p2'].forEach(function(id){var p=w[id];p.heartRate=60;p.heartLevel=0;p.visionBlur=0;p.dangerT=0;p.downed=false;p.reviveProgress=0;});
    },
    getZone:function(w,p){
      var found=null;(w.hazardZones||[]).some(function(z){if(z.floor!==p.floor)return false;if(p.x>=z.x-z.w/2&&p.x<=z.x+z.w/2&&p.y>=z.y-z.h/2&&p.y<=z.y+z.h/2){found=z;return true;}return false;});return found;
    },
    isInDanger:function(w,p){return !!H.getZone(w,p);},
    damage:function(w,amount,source){
      if(w.ended||w.escape&&w.escape.active)return;
      w.sharedHp=Math.max(0,w.sharedHp-amount);
      ['p1','p2'].forEach(function(id){w[id].hp=w.sharedHp;});
      if(w.sharedHp<=0&&!w.downedRole){
        var victim=source&&source.downedRole?source.downedRole:(H.isInDanger(w,w.p1)?'p1':(H.isInDanger(w,w.p2)?'p2':'p1'));
        w.downedRole=victim;w.downedAt=w.time;w[victim].downed=true;w[victim].reviveProgress=0;
        w[victim].notice='你倒地了，等待同伴靠近救援。';w[victim].noticeUntil=w.time+4;
        var other=victim==='p1'?'p2':'p1';w[other].notice='同伴倒地！靠近并长按确认键救援。';w[other].noticeUntil=w.time+4;
      }
    },
    heal:function(w,amount,source){
      if(w.downedRole)return false;
      w.sharedHp=Math.min(w.sharedHpMax,w.sharedHp+amount);w.p1.hp=w.p2.hp=w.sharedHp;return true;
    },
    updateHeartRate:function(w,dt){
      ['p1','p2'].forEach(function(id){
        var p=w[id],o=id==='p1'?w.p2:w.p1,d=Math.hypot(p.x-o.x,p.y-o.y),near=p.floor===o.floor&&d<=1000;
        var target=near?125:60;
        if(H.isInDanger(w,p))target=Math.max(target,145);
        p.heartRate+=(target-p.heartRate)*Math.min(1,dt*4);
        p.heartLevel=p.heartRate>=135?3:(p.heartRate>=105?2:(p.heartRate>=80?1:0));
      });
    },
    update:function(w,dt){
      if(!w||!w.hazardZones)return;
      var damage=0;
      ['p1','p2'].forEach(function(id){
        var p=w[id],zone=H.getZone(w,p);
        if(zone&&!p.downed){
          p.dangerT+=dt;
          p.visionBlur=Math.min(.8,p.visionBlur+dt*.18);
          if(p.dangerT>2)damage+=5*dt;
          p.notice=(p.noticeUntil<=w.time?'危险区：视野正在变模糊。':p.notice);
        }else{
          p.dangerT=Math.max(0,p.dangerT-dt*.6);p.visionBlur=Math.max(0,p.visionBlur-dt*.2);
        }
      });
      if(damage>0)H.damage(w,damage,{downedRole:null});
      H.updateHeartRate(w,dt);
    },
    revive:function(w,role,dt){
      if(!w.downedRole)return false;
      var down=w[w.downedRole],rescuer=w[role];
      if(role===w.downedRole||rescuer.floor!==down.floor||Math.hypot(rescuer.x-down.x,rescuer.y-down.y)>70){rescuer.reviveProgress=0;return false;}
      rescuer.reviveProgress=Math.min(2,rescuer.reviveProgress+dt);
      if(rescuer.reviveProgress>=2){
        w.sharedHp=35;w.p1.hp=w.p2.hp=35;down.downed=false;down.reviveProgress=0;rescuer.reviveProgress=0;w.downedRole=null;
        down.notice='救援成功，共享血量恢复至 35。';down.noticeUntil=w.time+3;rescuer.notice='你救起了同伴。';rescuer.noticeUntil=w.time+3;return true;
      }
      return true;
    }
  };
  G.Hazard=H;
})();
