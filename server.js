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
    angle=shot==='숏서브'?.20:.70;
    speed=shot==='숏서브'?12:20;
  }else if(r.lastShot==='스매시' && b.y<=headY+.65){
    // Defending a smash: always lift, even with zero charge.
    shot='언더';angle=.91;speed=17.5;
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
    shot='언더';angle=.92;speed=13+charge*6;
  }else{
    shot='드라이브';angle=.035;speed=14+charge*13;
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
 // Return to the center after a shot; track an incoming shuttle while it is flying.
 let tx=0,tz=-4.2;
 if(r.phase==='flight'&&r.last===0&&b.vz<-.15){
   const t=clamp((-4.1-b.z)/b.vz,.05,1.25);
   tx=clamp(b.x+b.vx*t,-2.65,2.65);tz=clamp(b.z+b.vz*Math.min(t,.8),-6.5,-1.1);
 }
 const step=4.0/60,dx=tx-p.x,dz=tz-p.z,dist=Math.hypot(dx,dz);
 if(dist>step){p.x+=dx/dist*step;p.z+=dz/dist*step;}else{p.x=tx;p.z=tz;}
 if(now<r.aiNext)return;
 if(r.phase==='serve'&&r.server===1){
   r.aiNext=now+950;
   b.x=p.x;b.y=1.25;b.z=p.z;b.vx=(Math.random()-.5)*2.2;b.vy=6.9;b.vz=10.9;
   r.phase='flight';r.last=1;r.lastShot='롱서브';p.swing=now;r.message='AI 서브!';return;
 }
 if(r.phase==='flight'&&r.last===0){
   const d=Math.hypot(b.x-p.x,b.z-p.z,b.y-(1.35+p.jumpY));
   if(d<2.05&&b.z<-.35&&b.y>.35&&b.y<3.7){
     const targetX=clamp((Math.random()-.5)*4.9,-2.5,2.5),targetZ=3.2+Math.random()*3.3;
     const flightTime=.89+Math.random()*.31;
     b.vx=(targetX-b.x)/flightTime;b.vz=(targetZ-b.z)/flightTime;
     b.vy=(.18-b.y+.5*9.81*flightTime*flightTime)/flightTime;
     b.vy=clamp(b.vy,2.6,10.8);r.last=1;r.lastShot='드라이브';p.swing=now;r.aiNext=now+800;
     r.message='AI 리턴!';
   }
 }
}
setInterval(()=>{for(const [code,r] of rooms){updateAI(r);for(const p of r.p){if(p.jumpV!==0||p.jumpY>0){p.jumpY+=p.jumpV/60;p.jumpV-=13.5/60;if(p.jumpY<=0){p.jumpY=0;p.jumpV=0;}}}if(r.phase==='point'&&Date.now()>=r.next)resetServe(r);if(r.phase==='flight'){const b=r.ball,dt=1/60;const drag=Math.exp(-r.tuning.drag*Math.hypot(b.vx,b.vy,b.vz)*dt);b.vx*=drag;b.vy*=drag;b.vz*=drag;b.vy-=9.81*dt;const oldz=b.z;b.x+=b.vx*dt;b.y+=b.vy*dt;b.z+=b.vz*dt;if(oldz*b.z<=0&&b.y<1.55){point(r,1-r.last,'네트');}else if(b.y<=.08){const side=b.z>0?0:1;const inside=Math.abs(b.x)<=2.797&&Math.abs(b.z)<=7.236&&Math.abs(b.z)>.08;point(r,inside?r.last:1-r.last,inside?'인':'아웃');}else if(Math.abs(b.x)>4.54||Math.abs(b.z)>8.64){point(r,1-r.last,'아웃');}}if(++r.tick%2===0)io.to(code).emit('state',snapshot(r));}},1000/60);
const port=Number(process.env.PORT)||3000;server.listen(port,'0.0.0.0',()=>console.log('Badminton online: http://localhost:'+port));
