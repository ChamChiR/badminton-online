const http=require('http'),fs=require('fs'),path=require('path');
const {Server}=require('socket.io');
const server=http.createServer((req,res)=>{if(req.url==='/'||req.url==='/index.html'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(fs.readFileSync(path.join(__dirname,'index.html')));}else{res.writeHead(404);res.end('Not found');}});
const io=new Server(server,{maxHttpBufferSize:20000});
const rooms=new Map();const DEFAULT_TUNING={drag:0.048,basePower:0.30,maxPower:0.50,chargeMs:550};const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function fresh(){return {players:[null,null],p:[{x:0,z:5.076,yaw:0,pitch:0,swing:0,jumpY:0,jumpV:0},{x:0,z:-5.076,yaw:Math.PI,pitch:0,swing:0,jumpY:0,jumpV:0}],ball:{x:0,y:1.15,z:5.076,vx:0,vy:0,vz:0},score:[0,0],server:0,phase:'waiting',last:-1,tick:0,message:'상대방을 기다리는 중',next:0,ai:false,aiNext:0,lastShot:null,tuning:{...DEFAULT_TUNING}};}
function resetServe(r){r.phase='serve';r.last=-1;r.lastShot=null;r.p[0].x=0;r.p[0].z=5.076;r.p[1].x=0;r.p[1].z=-5.076;for(const player of r.p){player.jumpY=0;player.jumpV=0;}const p=r.p[r.server];r.ball={x:p.x,y:1.25,z:p.z,vx:0,vy:0,vz:0};r.message=(r.server===0?'파랑':'주황')+' 플레이어 서브 대기';}
function point(r,w,why){r.score[w]++;r.server=w;r.phase='point';r.next=Date.now()+1700;r.message=why+' · '+(w===0?'파랑':'주황')+' 득점';if((Math.max(...r.score)>=21&&Math.abs(r.score[0]-r.score[1])>=2)||Math.max(...r.score)===30){r.phase='ended';r.message=(w===0?'파랑':'주황')+' 승리! (새 경기: R)';}}
function snapshot(r){return {p:r.p,ball:r.ball,score:r.score,server:r.server,phase:r.phase,last:r.last,message:r.message,tuning:r.tuning};}
function leave(socket){const code=socket.data.room;if(!code)return;const r=rooms.get(code);socket.data.room=null;if(!r)return;const n=socket.data.seat;if(r.players[n]===socket.id)r.players[n]=null;io.to(code).emit('notice','상대가 퇴장했습니다. 방을 다시 만드세요.');io.to(code).emit('closed');rooms.delete(code);}
// Integrate the same air drag and gravity as the live game to calibrate shots.
function trajectory(startY, angle, speed, dragCoef){
 let z=0,y=startY,vz=speed*Math.cos(angle),vy=speed*Math.sin(angle),netY=null;
 for(let i=0;i<1500;i++){
  const dt=1/120,drag=Math.exp(-dragCoef*Math.hypot(vz,vy)*dt);
  vz*=drag;vy=vy*drag-9.81*dt;
  const oldZ=z,oldY=y;z+=vz*dt;y+=vy*dt;
  if(netY===null&&oldZ<=0&&z>=0)netY=oldY;
  if(y<=.08)return z;
 }
 return z;
}
function calibratedSpeed(startY,angle,distance,dragCoef){
 let lo=1,hi=90;
 for(let i=0;i<27;i++){
  const mid=(lo+hi)/2;
  if(trajectory(startY,angle,mid,dragCoef)<distance)lo=mid;else hi=mid;
 }
 return (lo+hi)/2;
}
function applyAIShot(r,shot,targetX,targetZ,angle){
 const b=r.ball,p=r.p[1];
 const dx=targetX-b.x,dz=targetZ-b.z,dist=Math.hypot(dx,dz);
 const speed=calibratedSpeed(b.y,angle,dist,r.tuning.drag);
 const hs=speed*Math.cos(angle);
 b.vx=dx/dist*hs;b.vz=dz/dist*hs;b.vy=speed*Math.sin(angle);
 r.last=1;r.lastShot=shot;p.swing=Date.now();r.aiNext=Date.now()+240;
 r.message='AI · '+shot+'!';r.phase='flight';
}
function predictShuttle(b,drag){
 let x=b.x,y=b.y,z=b.z,vx=b.vx,vy=b.vy,vz=b.vz;
 let best=null;
 for(let i=0;i<125;i++){
  const dt=1/60,decay=Math.exp(-drag*Math.hypot(vx,vy,vz)*dt);
  vx*=decay;vy=vy*decay-9.81*dt;x+=vx*dt;y+=vy*dt;z+=vz*dt;
  if(z<-.4&&z>-6.8&&y>.4&&y<3.5){
   const desirability=Math.abs(z+3.5)*.10+Math.abs(y-1.7)*.15+i*.002;
   if(!best||desirability<best.cost)best={x,z,y,t:(i+1)*dt,cost:desirability};
  }
  if(y<=.08)break;
 }
 return best;
}
io.on('connection',socket=>{
 socket.on('create',()=>{leave(socket);let code;do{code=Math.random().toString(36).slice(2,7).toUpperCase()}while(rooms.has(code));const r=fresh();r.players[0]=socket.id;rooms.set(code,r);socket.join(code);socket.data.room=code;socket.data.seat=0;socket.emit('joined',{code,seat:0});});
 socket.on('solo',()=>{leave(socket);let code;do{code='AI'+Math.random().toString(36).slice(2,5).toUpperCase()}while(rooms.has(code));const r=fresh();r.ai=true;r.players=[socket.id,'AI'];rooms.set(code,r);socket.join(code);socket.data.room=code;socket.data.seat=0;resetServe(r);socket.emit('joined',{code,seat:0,ai:true});socket.emit('ready');});
 socket.on('join',raw=>{leave(socket);const code=String(raw||'').trim().toUpperCase().slice(0,5),r=rooms.get(code);if(!r||r.players[1]||r.ai)return socket.emit('notice','방이 없거나 이미 2명이 접속했습니다.');r.players[1]=socket.id;socket.join(code);socket.data.room=code;socket.data.seat=1;resetServe(r);io.to(code).emit('ready');socket.emit('joined',{code,seat:1});});
 socket.on('tuning',d=>{const r=rooms.get(socket.data.room);if(!r||socket.data.seat!==0||!d)return;const drag=Number(d.drag),basePower=Number(d.basePower),chargeMs=Number(d.chargeMs);if(![drag,basePower,chargeMs].every(Number.isFinite))return;r.tuning={drag:clamp(drag,0.005,0.12),basePower:clamp(basePower,0.30,0.30),maxPower:0.50,chargeMs:Math.round(clamp(chargeMs,200,1500))};io.to(socket.data.room).emit('tuning',r.tuning);});
 socket.on('move',d=>{const r=rooms.get(socket.data.room),seat=socket.data.seat;if(!r||r.phase==='waiting'||!d||!Number.isFinite(d.x)||!Number.isFinite(d.z))return;const p=r.p[seat];const x=clamp(d.x,-2.895,2.895),z=seat===0?clamp(d.z,.7,6.858):clamp(d.z,-6.858,-.7);const now=Date.now(),dt=clamp((now-(p.lastMove||now))/1000,.001,.12);p.lastMove=now;const dist=Math.hypot(x-p.x,z-p.z),max=5.2*dt+.2;if(dist>max){const f=max/dist;p.x+=(x-p.x)*f;p.z+=(z-p.z)*f;}else{p.x=x;p.z=z;}p.yaw=Number.isFinite(d.yaw)?d.yaw:0;p.pitch=Number.isFinite(d.pitch)?clamp(d.pitch,-1.3,1.3):0;});
 socket.on('jump',()=>{const r=rooms.get(socket.data.room),seat=socket.data.seat;if(!r||!r.players.every(Boolean)||!['serve','flight'].includes(r.phase))return;const p=r.p[seat];if(p.jumpY<=.001&&p.jumpV===0){p.jumpV=5.4;}});
 socket.on('hit',d=>{
  const r=rooms.get(socket.data.room),seat=socket.data.seat;
  if(!r||!d||!['serve','flight'].includes(r.phase))return;
  if(r.phase==='serve'&&r.server!==seat)return;
  if(r.phase==='flight'&&r.last===seat)return;
  const p=r.p[seat],b=r.ball;
  const reach=Math.hypot(b.x-p.x,b.z-p.z,b.y-(1.35+p.jumpY));
  if(r.phase==='flight'&&reach>2.35)return;
  const power=clamp(Number(d.power)||r.tuning.basePower,r.tuning.basePower,r.tuning.maxPower),dir=d.dir||{};
  const button=d.button==='right'?'right':'left';
  const dx=Number(dir.x),dy=Number(dir.y),dz=Number(dir.z);
  if(![dx,dy,dz].every(Number.isFinite))return;
  const horizontal=Math.hypot(dx,dz);if(horizontal<.2)return;
  const hx=dx/horizontal,hz=dz/horizontal;
  if((seat===0&&hz>-.12)||(seat===1&&hz<.12))return;
  const aim=Math.atan2(dy,horizontal);
  // Charge is normalized to the 30%-50% configured power range.
  const charge=clamp((power-r.tuning.basePower)/Math.max(.001,r.tuning.maxPower-r.tuning.basePower),0,1);
  const contactY=r.phase==='serve'?1.25:b.y;
  const headY=1.68+p.jumpY;
  const relativeHeight=contactY-headY;
  let shot,angle,speed;
  const isServe=r.phase==='serve';
  if(isServe){
    shot=charge<=.5?'숏서브':'롱서브';
    angle=shot==='숏서브'?.43:.70;
    speed=shot==='숏서브'?12:20;
  }else if(r.lastShot==='스매시' && b.y<=headY+.65){
    // Defending a smash: always lift, even with zero charge.
    shot='언더';angle=.91;speed=12+charge*8;
  }else if(relativeHeight>=.24){
    // Overhead: right-click smash; left-click drop/clear by charge.
    if(button==='right'){
      shot='스매시';angle=-.26;speed=28+charge*9;
    }else if(charge<=.5){
      shot='드롭';angle=.20;speed=9+charge*3;
    }else{
      shot='하이클리어';angle=.75;speed=22;
    }
  }else if(relativeHeight<-.38){
    shot='언더';angle=.92;speed=12+charge*9;
  }else{
    shot='드라이브';angle=.035;speed=14+charge*13;
  }
  // Mouse buttons control the actual outgoing launch angle for rally shots.
  // Left click lofts the shuttle; right click drives it down (when contact is high).
  if(!isServe){
    if(button==='left'){
      angle=shot==='언더'?.92:shot==='드라이브'?.24:shot==='드롭'?.34:.75;
    }else if(shot!=='언더'){
      angle=shot==='스매시'?-.35:shot==='드라이브'?-.10:-.16;
    }
  }
  // A short serve must rise above the net before descending near the service line.
  // Solve against the net crossing height as well as the landing point.
  if(shot==='숏서브'){
    angle=.53;
  }
  // Numerical distance calibration with the same drag/gravity as the game.
  // Aim at a safe landing point rather than allowing clears or serves to go long.
  if(['하이클리어','숏서브','롱서브'].includes(shot)){
    const targetZ=(seat===0?-1:1)*(shot==='숏서브'?2.15:shot==='롱서브'?6.0:5.8);
    const distance=Math.max(.5,Math.abs(targetZ-b.z));
    const simulate=(v)=>{
      let z=0,y=contactY,vz=v*Math.cos(angle),vy=v*Math.sin(angle);
      const dt=1/120;
      for(let i=0;i<1200;i++){
        const drag=Math.exp(-r.tuning.drag*Math.hypot(vz,vy)*dt);
        vz*=drag;vy=vy*drag-9.81*dt;z+=vz*dt;y+=vy*dt;
        if(y<=.08&&i>1)return z;
      }
      return z;
    };
    let lo=2,hi=65;
    for(let i=0;i<28;i++){const mid=(lo+hi)/2;if(simulate(mid)<distance)lo=mid;else hi=mid;}
    speed=(lo+hi)/2;
    if(shot==='숏서브'){
      // At very high drag the landing solver may choose a low net crossing.
      // Steepen the short serve slightly; preserve the calibrated speed.
      angle=.53;
    }
  }
  // Under: charging changes depth, but even a full-power lift at the net
  // is aimed safely inside the far baseline. Calibrate using current drag.
  if(shot==='언더'){
    const netDistance=Math.abs(b.z);
    const safeDepth=clamp(2.65+charge*3.75,2.65,6.4);
    const targetDistance=netDistance+safeDepth;
    const calibrated=calibratedSpeed(contactY,angle,targetDistance,r.tuning.drag);
    speed=calibrated;
  }
  const hs=speed*Math.cos(angle);
  b.vx=hx*hs;b.vz=hz*hs;b.vy=speed*Math.sin(angle);
  b.x=p.x*.25+b.x*.75;b.z=p.z*.18+b.z*.82;
  if(isServe){
    b.x=p.x;b.z=p.z;b.y=1.25;
    b.vx=0; b.vz=(seat===0?-1:1)*Math.abs(b.vz);
  }
  r.phase='flight';r.last=seat;r.lastShot=shot;p.swing=Date.now();
  r.message=(seat===0?'파랑':'주황')+' · '+shot+'!';
 });
 socket.on('restart',()=>{const r=rooms.get(socket.data.room);if(r&&r.players.every(Boolean)){r.score=[0,0];r.server=0;resetServe(r);}});
 socket.on('disconnect',()=>leave(socket));
});
function updateAI(r){
 if(!r.ai||!['serve','flight'].includes(r.phase))return;
 const p=r.p[1],b=r.ball,now=Date.now();
 let tx=0,tz=-3.65;
 const incoming=r.phase==='flight'&&r.last===0;
 const predicted=incoming?predictShuttle(b,r.tuning.drag):null;
 if(predicted){
  tx=clamp(predicted.x,-2.6,2.6);
  tz=clamp(predicted.z,-6.35,-.9);
 }
 const step=5.15/60,dx=tx-p.x,dz=tz-p.z,dist=Math.hypot(dx,dz);
 if(dist>step){p.x+=dx/dist*step;p.z+=dz/dist*step;}else{p.x=tx;p.z=tz;}
 p.yaw=Math.PI;
 if(now<r.aiNext)return;
 if(r.phase==='serve'&&r.server===1){
  const short=Math.random()<.45;
  b.x=p.x;b.y=1.25;b.z=p.z;
  applyAIShot(r,short?'숏서브':'롱서브',(Math.random()-.5)*2.4,short?2.35:5.9,short?.53:.70);
  r.aiNext=now+650;return;
 }
 if(!incoming)return;
 const reach=Math.hypot(b.x-p.x,b.z-p.z,b.y-(1.35+p.jumpY));
 if(reach>2.15||b.z>-.35||b.y<.38||b.y>3.8)return;
 // Choose based on contact height, previous shot and court situation.
 const relative=b.y-(1.68+p.jumpY),roll=Math.random();
 let shot,angle,targetZ,targetX;
 const player=r.p[0];
 const leftOpen=player.x>0;
 targetX=clamp((leftOpen?-1:1)*(1.6+Math.random()*1.05),-2.65,2.65);
 if(relative>.22){
  if(roll<.34){shot='스매시';angle=-.18;targetZ=clamp(player.z-.75,1.3,5.6);}
  else if(roll<.62){shot='드롭';angle=.16;targetZ=1.45+Math.random()*.65;}
  else{shot='하이클리어';angle=.78;targetZ=5.4+Math.random()*1.0;}
 }else if(relative<-.38||r.lastShot==='스매시'){
  shot='언더';angle=.90;targetZ=3.0+Math.random()*3.1;
 }else if(roll<.55){
  shot='드라이브';angle=.10;targetZ=3.4+Math.random()*2.1;
 }else if(roll<.8){
  shot='드롭';angle=.28;targetZ=1.5+Math.random()*.7;
 }else{
  shot='하이클리어';angle=.73;targetZ=5.4+Math.random()*1.0;
 }
 // A steep smash must still clear the net. Lower the angle only when high enough.
 if(shot==='스매시'&&b.y<2.35){shot='드라이브';angle=.09;targetZ=3.7;}
 const safeAngle=shot==='스매시'?angle:angle;
 applyAIShot(r,shot,targetX,targetZ,safeAngle);
}
setInterval(()=>{for(const [code,r] of rooms){updateAI(r);for(const p of r.p){if(p.jumpV!==0||p.jumpY>0){p.jumpY+=p.jumpV/60;p.jumpV-=13.5/60;if(p.jumpY<=0){p.jumpY=0;p.jumpV=0;}}}if(r.phase==='point'&&Date.now()>=r.next)resetServe(r);if(r.phase==='flight'){const b=r.ball,dt=1/60;const drag=Math.exp(-r.tuning.drag*Math.hypot(b.vx,b.vy,b.vz)*dt);b.vx*=drag;b.vy*=drag;b.vz*=drag;b.vy-=9.81*dt;const oldz=b.z;b.x+=b.vx*dt;b.y+=b.vy*dt;b.z+=b.vz*dt;if(oldz*b.z<=0&&b.y<1.55){point(r,1-r.last,'네트');}else if(b.y<=.08){const side=b.z>0?0:1;const inside=Math.abs(b.x)<=2.797&&Math.abs(b.z)<=7.236&&Math.abs(b.z)>.08;point(r,inside?r.last:1-r.last,inside?'인':'아웃');}else if(Math.abs(b.x)>4.54||Math.abs(b.z)>8.64){point(r,1-r.last,'아웃');}}if(++r.tick%2===0)io.to(code).emit('state',snapshot(r));}},1000/60);
const port=Number(process.env.PORT)||3000;server.listen(port,'0.0.0.0',()=>console.log('Badminton online: http://localhost:'+port));
