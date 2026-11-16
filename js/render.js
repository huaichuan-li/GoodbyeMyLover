/* 纯原生 WebGL 3D 场景：透视相机、深度缓冲、程序化几何与双人独立感知 */
(function () {
  var G = window.G = window.G || {}, C = G.DATA.config, U = G.utils;
  var canvas, gl, W = 0, H = 0, program, buffer, loc = {}, dpr = 1;
  var views={p1:{mode:'third',yaw:0,pitch:.24,distance:5.2,dragging:false,lastX:0,lastY:0},p2:{mode:'third',yaw:0,pitch:.24,distance:5.2}};
  var mat = new Float32Array(16), view = new Float32Array(16), proj = new Float32Array(16), vp = new Float32Array(16);
  function shader(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
  function init() {
    canvas = U.el('game'); gl = canvas.getContext('webgl', { antialias: true, alpha: false });
    if (!gl) { document.body.classList.add('no-webgl'); return; }
    var vs = shader(gl.VERTEX_SHADER, 'attribute vec3 p; attribute vec3 n; uniform mat4 mvp; uniform mat4 model; varying vec3 N; varying vec3 P; void main(){ vec4 w=model*vec4(p,1.0); P=w.xyz; N=mat3(model)*n; gl_Position=mvp*vec4(p,1.0); }');
    var fs = shader(gl.FRAGMENT_SHADER, 'precision mediump float; uniform vec3 color; uniform float alpha; uniform vec3 eye; varying vec3 N; varying vec3 P; void main(){ vec3 l=normalize(vec3(-.35,.82,.44)); float d=max(dot(normalize(N),l),0.0); float fog=smoothstep(12.0,42.0,distance(P,eye)); vec3 c=color*(.32+.68*d); c=mix(c,vec3(.025,.035,.048),fog*.82); gl_FragColor=vec4(c,alpha); }');
    program=gl.createProgram(); gl.attachShader(program,vs); gl.attachShader(program,fs); gl.linkProgram(program); gl.useProgram(program);
    loc={p:gl.getAttribLocation(program,'p'),n:gl.getAttribLocation(program,'n'),mvp:gl.getUniformLocation(program,'mvp'),model:gl.getUniformLocation(program,'model'),color:gl.getUniformLocation(program,'color'),alpha:gl.getUniformLocation(program,'alpha'),eye:gl.getUniformLocation(program,'eye')};
    buffer=gl.createBuffer(); gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.clearColor(.018,.026,.036,1);
    installCameraInput();
  }
  function perspective(out,fovy,aspect,near,far){var f=1/Math.tan(fovy/2),nf=1/(near-far);out.fill(0);out[0]=f/aspect;out[5]=f;out[10]=(far+near)*nf;out[11]=-1;out[14]=2*far*near*nf;}
  function look(out,eye,center){var z=norm([eye[0]-center[0],eye[1]-center[1],eye[2]-center[2]]),x=norm(cross([0,1,0],z)),y=cross(z,x);out.set([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,eye),-dot(y,eye),-dot(z,eye),1]);}
  function mul(o,a,b){for(var c=0;c<4;c++)for(var r=0;r<4;r++)o[c*4+r]=a[r]*b[c*4]+a[4+r]*b[c*4+1]+a[8+r]*b[c*4+2]+a[12+r]*b[c*4+3];}
  function norm(a){var d=Math.hypot(a[0],a[1],a[2])||1;return[a[0]/d,a[1]/d,a[2]/d];} function cross(a,b){return[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];} function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
  function firstWallHit(w,floor,start,end,pad){
    if(!w.walls)return 1;var dx=end[0]-start[0],dy=end[1]-start[1],dz=end[2]-start[2],o=[start[0],start[1],start[2]],d=[dx,dy,dz],near=1;
    w.walls.forEach(function(b){if(b.floor!==floor)return;var p=pad||0,min=[b.x/100-p,(floor-1)*4.2,b.y/100-4.9-p],max=[(b.x+b.w)/100+p,(floor-1)*4.2+3.5,(b.y+b.h)/100-4.9+p],en=0,le=1,inside=true;
      for(var i=0;i<3;i++){if(o[i]<min[i]||o[i]>max[i])inside=false;if(Math.abs(d[i])<1e-7){if(o[i]<min[i]||o[i]>max[i]){le=-1;break;}}else{var a=(min[i]-o[i])/d[i],c=(max[i]-o[i])/d[i];if(a>c){var t=a;a=c;c=t;}en=Math.max(en,a);le=Math.min(le,c);if(en>le){le=-1;break;}}}
      var hit=inside?0:en;if(le>=0&&hit>=0&&hit<near&&hit<=1)near=hit;
    });return near;
  }
  function cameraBeforeWall(w,floor,pivot,desired){var dx=desired[0]-pivot[0],dy=desired[1]-pivot[1],dz=desired[2]-pivot[2],len=Math.hypot(dx,dy,dz);if(!len)return desired;var hit=firstWallHit(w,floor,pivot,desired,.08);if(hit<1){var t=Math.max(.015,hit-.12/len);return[pivot[0]+dx*t,pivot[1]+dy*t,pivot[2]+dz*t];}return desired;}
  function identity(){return new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);}
  function transform(pos,scale){var m=identity();m[0]=scale[0];m[5]=scale[1];m[10]=scale[2];m[12]=pos[0];m[13]=pos[1];m[14]=pos[2];return m;}
  function mesh(type){var v=[], n=[];function tri(a,b,c,nn){v.push(a[0],a[1],a[2],b[0],b[1],b[2],c[0],c[1],c[2]);for(var i=0;i<3;i++)n.push(nn[0],nn[1],nn[2]);}
    if(type==='box'){var faces=[[[0,0,1],[[-.5,-.5,.5],[.5,-.5,.5],[.5,.5,.5],[-.5,.5,.5]]],[[0,0,-1],[[.5,-.5,-.5],[-.5,-.5,-.5],[-.5,.5,-.5],[.5,.5,-.5]]],[[1,0,0],[[.5,-.5,.5],[.5,-.5,-.5],[.5,.5,-.5],[.5,.5,.5]]],[[-1,0,0],[[-.5,-.5,-.5],[-.5,-.5,.5],[-.5,.5,.5],[-.5,.5,-.5]]],[[0,1,0],[[-.5,.5,.5],[.5,.5,.5],[.5,.5,-.5],[-.5,.5,-.5]]],[[0,-1,0],[[-.5,-.5,-.5],[.5,-.5,-.5],[.5,-.5,.5],[-.5,-.5,.5]]]];faces.forEach(function(f){var a=f[1];tri(a[0],a[1],a[2],f[0]);tri(a[0],a[2],a[3],f[0]);});}
    else {var seg=14, rings=8;for(var y=0;y<rings;y++){var a0=Math.PI*y/rings,a1=Math.PI*(y+1)/rings;for(var x=0;x<seg;x++){var b0=2*Math.PI*x/seg,b1=2*Math.PI*(x+1)/seg;function q(a,b){return[Math.sin(a)*Math.cos(b)*.5,Math.cos(a)*.5,Math.sin(a)*Math.sin(b)*.5];}var p0=q(a0,b0),p1=q(a1,b0),p2=q(a1,b1),p3=q(a0,b1);tri(p0,p1,p2,norm(p0));tri(p0,p2,p3,norm(p0));}}}
    return {v:new Float32Array(v),n:new Float32Array(n)};
  }
  var meshes={box:mesh('box'),sphere:mesh('sphere')};
  function draw(type,pos,scale,color,eye,alpha){var m=meshes[type],model=transform(pos,scale),mvp=new Float32Array(16);mul(mvp,vp,model);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,m.v,gl.STREAM_DRAW);gl.enableVertexAttribArray(loc.p);gl.vertexAttribPointer(loc.p,3,gl.FLOAT,false,0,0);var nb=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,nb);gl.bufferData(gl.ARRAY_BUFFER,m.n,gl.STREAM_DRAW);gl.enableVertexAttribArray(loc.n);gl.vertexAttribPointer(loc.n,3,gl.FLOAT,false,0,0);gl.uniformMatrix4fv(loc.mvp,false,mvp);gl.uniformMatrix4fv(loc.model,false,model);gl.uniform3fv(loc.color,color);gl.uniform1f(loc.alpha,alpha||1);gl.uniform3fv(loc.eye,eye);gl.drawArrays(gl.TRIANGLES,0,m.v.length/3);gl.deleteBuffer(nb);}
  function color(hex){return hex.map(function(x){return x/255;});}
  function room(w,eye,f,role,first){var dark=color([39,50,60]),floor=color([32,43,52]),trim=color([74,85,91]),base=(f-1)*4.2;
    draw('box',[12,base-.22,0],[26,.4,11],floor,eye);draw('box',[12,base+2.5,-5.45],[26,5,.3],dark,eye);draw('box',[12,base+2.5,5.45],[26,5,.3],dark,eye);draw('box',[-1,base+2.5,0],[.3,5,11],dark,eye);draw('box',[25,base+2.5,0],[.3,5,11],dark,eye);
    for(var i=0;i<12;i++){var x=1+i*2.05;draw('box',[x,base+4.8,0],[.08,.08,10.5],trim,eye,.35);}
    w.walls.forEach(function(b){if(b.floor!==f)return;draw('box',[(b.x+b.w/2)/100,base+1.75,(b.y+b.h/2)/100-4.9],[b.w/100,3.5,b.h/100],b.kind==='bed'?color([62,72,78]):trim,eye);});
    // departmental room markers; visible doors remain open for free exploration
    G.Level.departments[f].forEach(function(name,i){var x=f===1?(i?18.8:4.2):4.2+i*3.5;draw('box',[x,base+3.8,-4.9],[2.25,.48,.08],color([88,103,104]),eye);});
    w.entities.forEach(function(e){if(!e.alive||e.floor!==f||(first&&e.id===role))return;var x=e.x/100,z=e.y/100-4.9,c;
      if(e.kind==='player'){c=color(e.id==='p1'?[38,47,52]:[53,115,138]);draw('box',[x,base+.7,z],[.62,1.25,.58],c,eye);draw('box',[x,base+1.55,z],[.52,.52,.52],color([174,160,139]),eye);if(e.id==='p1')draw('box',[x+.28,base+1.0,z],[.11,.1,.61],color([202,198,176]),eye);else{draw('box',[x-.34,base+.72,z],[.14,.32,.3],color([74,176,204]),eye);draw('box',[x+.1,base+1.12,z+.3],[.12,.12,.08],color([211,192,139]),eye);}draw('box',[x+.36,base+1.62,z],[.12,.36,.12],color([226,163,74]),eye);return;}
      if(e.kind==='npc'){var palette=[[124,128,132],[112,135,139],[139,127,119],[105,119,132],[145,139,122]];c=color(palette[Math.floor((e.phase||0)*7)%palette.length]);var lying=e.state==='lie',wide=lying?.9:.48,height=lying?.24:(.92+((e.phase||0)%1)*.4);draw('box',[x,base+(lying?.18:height*.55),z],[wide,height,.48],c,eye);draw('box',[x,base+(lying?.32:height+.28),z],[.4,.4,.4],color([167,158,145]),eye);if((e.phase||0)>.6)draw('box',[x+.24,base+(lying?.24:height*.5),z],[.11,.26,.3],color([184,156,103]),eye);return;}
      if(e.kind==='clue'||e.kind==='phone'||e.kind==='stairs'||e.kind==='food'){c=e.kind==='clue'?color([198,162,88]):(e.kind==='phone'?color([90,179,187]):(e.kind==='food'?color([153,185,115]):color([137,145,151])));draw('box',[x,base+.27,z],[e.kind==='stairs'?1.4:.5,.45,e.kind==='stairs'?1.4:.5],c,eye);}
    });
  }
  function renderView(w,x,width,role,mode){var player=role==='p1'?w.p1:w.p2,base=(player.floor-1)*4.2,v=views[role],fx=Math.sin(v.yaw),fz=-Math.cos(v.yaw),px=player.x/100,pz=player.y/100-4.9,lookAt=[px,base+1.2,pz],eye;
    if(v.mode==='first'){eye=[px,base+1.58,pz];lookAt=[px+fx*6*Math.cos(v.pitch),base+1.58+Math.sin(v.pitch)*6,pz+fz*6*Math.cos(v.pitch)];}
    else {var h=Math.cos(v.pitch)*v.distance;var desired=[px-fx*h,base+1.58+Math.sin(v.pitch)*v.distance,pz-fz*h];eye=cameraBeforeWall(w,player.floor,[px,base+1.2,pz],desired);}
    look(view,eye,lookAt);perspective(proj,Math.PI/3,width/H,.1,70);mul(vp,proj,view);gl.viewport(x*dpr,0,width*dpr,H*dpr);gl.uniform3fv(loc.eye,eye);room(w,eye,player.floor,role,v.mode==='first');
    // 每方只收到自己找到的资料；左右下角用屏幕空间绘制，不污染世界身份信息
    gl.disable(gl.DEPTH_TEST); gl.enable(gl.DEPTH_TEST);
  }
  function installCameraInput(){if(!canvas||canvas.__cameraInput)return;canvas.__cameraInput=true;canvas.style.touchAction='none';canvas.addEventListener('pointerdown',function(e){var duo=G.Game&&(G.Game.mode==='duo'||G.Game.dualView);if(duo&&e.clientX>=innerWidth/2)return;if(e.button!==0)return;views.p1.dragging=true;views.p1.lastX=e.clientX;views.p1.lastY=e.clientY;});canvas.addEventListener('pointermove',function(e){var v=views.p1;if(!v.dragging)return;v.yaw-=(e.clientX-v.lastX)*.006;v.pitch=Math.max(-.72,Math.min(.78,v.pitch-(e.clientY-v.lastY)*.004));v.lastX=e.clientX;v.lastY=e.clientY;});['pointerup','pointercancel'].forEach(function(n){canvas.addEventListener(n,function(){views.p1.dragging=false;});});}
  function toggleView(role){views[role].mode=views[role].mode==='first'?'third':'first';return views[role].mode;}
  function resetViews(){views.p1.mode=views.p2.mode='third';views.p1.yaw=views.p2.yaw=0;views.p1.pitch=views.p2.pitch=.24;views.p1.distance=views.p2.distance=5.2;}
  G.Renderer={resize:function(){if(!gl)init();if(gl)resize();},renderAll:function(){if(!gl)return;var w=G.Game.world;gl.useProgram(program);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);if(!w){gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(.018,.026,.036,1);return;}var duo=G.Game.mode==='duo'||G.Game.dualView;if(duo){renderView(w,0,W/2,'p1','centaur');renderView(w,W/2,W/2,'p2','mummy');}else renderView(w,0,W,'p1','centaur');},toggleView:toggleView,resetViews:resetViews,getCameraYaw:function(role){return views[role].yaw;},getViewLabel:function(role){return views[role].mode==='first'?'第一人称':'第三人称';},updateGamepadCamera:function(role,dx,dy){views[role].yaw-=dx*.035;views[role].pitch=Math.max(-.72,Math.min(.78,views[role].pitch-dy*.025));}};
})();
