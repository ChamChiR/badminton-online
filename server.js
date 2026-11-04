const http=require('http'),fs=require('fs'),path=require('path');
const {Server}=require('socket.io');
const server=http.createServer((req,res)=>{if(req.url==='/'||req.url==='/index.html'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(fs.readFileSync(path.join(__dirname,'index.html')));}else if(/^\/hit_(smash|drive|clear|soft)_5sec_v7\.wav$/.test(req.url.split('?')[0])){const name=req.url.split('?')[0].slice(1);const f=path.join(__dirname,name);if(!fs.existsSync(f)){res.writeHead(404);res.end('Missing audio');return;}res.writeHead(200,{'Content-Type':'audio/wav','Cache-Control':'no-cache, must-revalidate'});fs.createReadStream(f).pipe(res);}else{res.writeHead(404);res.end('Not found');}});
const io=new Server(server,{maxHttpBufferSize:20000});
const SWING_COOLDOWN_MS=650, STAMINA_DISTANCE_COST=2.8;
const speedFactor=p=>.55+.45*(p.stamina/100);
const powerFactor=p=>.60+.40*(p.stamina/100);
function resetEnergy(r){for(const p of r.p){p.stamina=100;p.lastSwingAt=0;p.lastMove=0;}}
const team=seat=>seat%2;const opponent=seat=>team(seat)===0?1:0;
const rooms=new Map();const DEFAULT_TUNING={drag:0.048,basePower:0.30,maxPower:0.50,chargeMs:550};const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function fresh(){return {mode:'singles',players:[null,null],p:[{x:0,z:4.70,yaw:0,pitch:0,swing:0,jumpY:0,jumpV:0,stamina:100,lastSwingAt:0,lastMove:0},{x:0,z:-4.70,yaw:Math.PI,pitch:0,swing:0,jumpY:0,jumpV:0,stamina:100,lastSwingAt:0,lastMove:0}],ball:{x:0,y:1.15,z:4.70,vx:0,vy:0,vz:0},score:[0,0],server:0,phase:'waiting',last:-1,tick:0,message:'상대방을 기다리는 중',next:0,ai:false,aiMode:"normal",aiNext:0,lastShot:null,smashFx:null,smashFxSeq:0,tuning:{...DEFAULT_TUNING}};}
function enableDoubles(r,ai=false){
 r.mode='doubles';r.players=ai?[null,'AI','AI','AI']:[null,null,null,null];
 r.p=[0,1,2,3].map(i=>({x:i<2?0:(i===2?-1.5:1.5),z:i%2===0?4:-4,yaw:i%2===0?0:Math.PI,pitch:0,swing:0,jumpY:0,jumpV:0,stamina:100,lastSwingAt:0,lastMove:0}));
 r.ai=ai;r.server=0;r.receiver=1;r.serviceRotation=[0,1,2,3];
}
function doubles(r){return r.mode==='doubles';}
function teamReady(r){return r.players.every(Boolean);}
function serviceReceiver(r){return doubles(r)?r.receiver:1-r.server;}
// Singles service courts: even score -> server's right court; odd -> left.
// Global x: blue faces -Z (right is +X), orange faces +Z (right is -X).
const SERVICE_LINE=1.98, SINGLES_HALF=2.59, BASELINE=6.70;
function serveSign(r){return (r.score[team(r.server)]%2===0?1:-1)*(team(r.server)===0?1:-1);}
function servicePositionValid(r,seat){
 const p=r.p[seat],sign=serveSign(r)*(seat===r.server?1:-1);
 return p.x*sign>.12 && Math.abs(p.x)<(doubles(r)?3.05:2.59)-.08 && Math.abs(p.z)>SERVICE_LINE+.12 && Math.abs(p.z)<BASELINE-.12 && p.jumpY<.001;
}
function serviceReady(r){return servicePositionValid(r,r.server)&&servicePositionValid(r,serviceReceiver(r));}
function serveStartingPositions(r){
 const sign=serveSign(r),a=r.server,receiver=serviceReceiver(r);
 for(let i=0;i<r.p.length;i++){
  const p=r.p[i];p.z=team(i)===0?3.9:-3.9;
  p.x=i===a?sign*1.2:i===receiver?-sign*1.2:(team(i)===team(a)?-sign*1.8:sign*1.8);
 }
}

function resetServe(r){r.smashFx=null;resetEnergy(r);r.phase='serve';r.last=-1;r.lastShot=null;serveStartingPositions(r);for(const player of r.p){player.jumpY=0;player.jumpV=0;}const p=r.p[r.server];r.ball={x:p.x,y:1.25,z:p.z,vx:0,vy:0,vz:0};r.message=(team(r.server)===0?'파랑':'주황')+' 서브 대기 · 양쪽 대각선 서비스 칸에 서세요';}

function point(r,w,why){resetEnergy(r);const winningTeam=team(w);r.score[winningTeam]++;
 if(doubles(r)){
  if(team(r.server)!==winningTeam){r.server=winningTeam===0?(r.server===1?2:0):(r.server===0?3:1);}
  r.receiver=team(r.server)===0?(r.server===0?1:3):(r.server===1?0:2);
 }else r.server=w;r.phase='point';r.next=Date.now()+1700;r.message=why+' · '+(team(w)===0?'파랑':'주황')+' 득점';if((Math.max(...r.score)>=21&&Math.abs(r.score[0]-r.score[1])>=2)||Math.max(...r.score)===30){r.phase='ended';r.message=(team(w)===0?'파랑':'주황')+' 승리! (새 경기: R)';}}
function snapshot(r){return {p:r.p,ball:r.ball,score:r.score,server:r.server,phase:r.phase,last:r.last,mode:r.mode,receiver:r.receiver,lastShot:r.lastShot,smashFx:r.smashFx,message:r.message,aiMode:r.aiMode,tuning:r.tuning,serviceReady:r.phase==='serve'?serviceReady(r):true,serviceSign:r.phase==='serve'?serveSign(r):0};}
function leave(socket){const code=socket.data.room;if(!code)return;const r=rooms.get(code);socket.data.room=null;if(!r)return;const n=socket.data.seat;if(r.players[n]===socket.id)r.players[n]=null;io.to(code).emit('notice','상대가 퇴장했습니다. 방을 다시 만드세요.');io.to(code).emit('closed');rooms.delete(code);}
// New unified shot engine: exactly the same 60 Hz drag/gravity/landing model as live play.
function simulateShot(y0,angle,speed,distance,drag){
 let x=0,y=y0,vx=speed*Math.cos(angle),vy=speed*Math.sin(angle),apex=y0,netY=null;
 for(let i=0;i<3600;i++){
  const dt=1/60,decay=Math.exp(-drag*Math.hypot(vx,vy)*dt);
  vx*=decay;vy=vy*decay-9.81*dt;
  const ox=x,oy=y;x+=vx*dt;y+=vy*dt;apex=Math.max(apex,y);
  if(netY===null&&ox<=distance&&x>=distance){const f=(distance-ox)/(x-ox);netY=oy+(y-oy)*f;}
  if(y<=.08){const f=(oy-.08)/(oy-y);return {land:ox+(x-ox)*Math.max(0,Math.min(1,f)),apex,netY};}
 }
 return {land:x,apex,netY};
}
function solveShot(startY,netDistance,totalDistance,drag,style){
 const cfg={
  '하이클리어':{min:.68,max:1.30,net:2.6,apex:4.1,ideal:1.03},
  '언더':{min:.65,max:1.34,net:2.0,apex:3.1,ideal:1.06},
  '드라이브':{min:-.10,max:1.18,net:1.59,apex:0,ideal:.12},
  '헤어핀':{min:.45,max:1.32,net:1.59,apex:0,ideal:.98},
  '숏서브':{min:.28,max:1.28,net:1.59,apex:0,ideal:.72},
  '롱서브':{min:.45,max:1.34,net:1.7,apex:2.5,ideal:.95},
  '스매시':{min:-.72,max:.60,net:1.58,apex:0,ideal:-.24}
 }[style];
 if(!cfg)return null;
 let best=null;
 // Each angle has a calibrated velocity. Discard anything that hits the net.
 for(let i=0;i<=64;i++){
  const angle=cfg.min+(cfg.max-cfg.min)*i/64;
  let lo=.1,hi=240;
  for(let k=0;k<29;k++){
   const mid=(lo+hi)/2;
   if(simulateShot(startY,angle,mid,netDistance,drag).land<totalDistance)lo=mid;else hi=mid;
  }
  const speed=(lo+hi)/2;
  if(speed>239.9)continue;
  const r=simulateShot(startY,angle,speed,netDistance,drag);
  if(r.netY===null||r.netY<cfg.net||r.apex<cfg.apex)continue;
  // Drive: select the flattest viable trajectory; clear the net by a small margin.
  // Its flight is fast and low, but never sacrifices the in-court landing point.
  const cost=style==='드라이브'
   ? Math.abs(r.netY-1.68)*1.5 + Math.max(0,r.apex-2.6)*.8 + Math.abs(angle-.10)*.20
   : Math.abs(angle-cfg.ideal);
  if(!best||cost<best.cost)best={angle,speed,cost,land:r.land,netY:r.netY,apex:r.apex};
 }
 return best;
}
function launchShot(r,seat,style,targetX,targetZ,startY){
 const b=r.ball,dx=targetX-b.x,dz=targetZ-b.z,dist=Math.hypot(dx,dz);
 if(dist<.01)return false;
 const netDist=Math.abs(b.z)*dist/Math.abs(dz);
 let result=solveShot(startY,netDist,dist,r.tuning.drag,style);
 // Never substitute an underhand lift for a drive: that made both
 // smash-defense buttons produce nearly identical trajectories.
 if(!result)return false;
 const hs=result.speed*Math.cos(result.angle);
 b.y=startY;b.vx=dx/dist*hs;b.vz=dz/dist*hs;b.vy=result.speed*Math.sin(result.angle);
 r.last=seat;r.lastShot=style;r.p[seat].swing=Date.now();r.phase='flight';
 r.message=(r.players[seat]==='AI'?'AI':team(seat)===0?'파랑':'주황')+' · '+style+'!';
 return true;
}
function applyAIShot(r,shot,targetX,targetZ,angle){
 const b=r.ball;
 if(shot!=='스매시'&&shot!=='숏서브'&&shot!=='헤어핀')targetZ=6.68;
 targetZ=Math.min(6.68,Math.max(.18,targetZ));
  targetZ=Math.max(.18,targetZ*powerFactor(r.p[1]));
 if(!launchShot(r,1,shot,targetX,targetZ,b.y))return false;r.smashFx=null;
  r.p[1].lastSwingAt=Date.now();
 r.aiNext=Date.now()+240;
 return true;
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
 socket.on('createDoubles',()=>{leave(socket);let code;do{code=Math.random().toString(36).slice(2,7).toUpperCase()}while(rooms.has(code));const r=fresh();enableDoubles(r);r.players[0]=socket.id;rooms.set(code,r);socket.join(code);socket.data.room=code;socket.data.seat=0;socket.emit('joined',{code,seat:0,mode:'doubles'});});
 socket.on('soloDoubles',()=>{leave(socket);let code;do{code='D'+Math.random().toString(36).slice(2,6).toUpperCase()}while(rooms.has(code));const r=fresh();enableDoubles(r,true);r.players[0]=socket.id;rooms.set(code,r);socket.join(code);socket.data.room=code;socket.data.seat=0;resetServe(r);socket.emit('joined',{code,seat:0,mode:'doubles',ai:true});socket.emit('ready');});
 socket.on('solo',mode=>{leave(socket);let code;do{code='AI'+Math.random().toString(36).slice(2,5).toUpperCase()}while(rooms.has(code));const r=fresh();r.ai=true;r.aiMode=['smash','drive'].includes(mode)?mode:'normal';r.players=[socket.id,'AI'];rooms.set(code,r);socket.join(code);socket.data.room=code;socket.data.seat=0;resetServe(r);socket.emit('joined',{code,seat:0,ai:true,aiMode:r.aiMode});socket.emit('ready');});
 socket.on('join',raw=>{leave(socket);const code=String(raw||'').trim().toUpperCase().slice(0,5),r=rooms.get(code);if(!r||r.ai)return socket.emit('notice','방이 없거나 AI 경기입니다.');
 const seat=r.players.findIndex(x=>!x);if(seat<0)return socket.emit('notice','방이 가득 찼습니다.');
 r.players[seat]=socket.id;socket.join(code);socket.data.room=code;socket.data.seat=seat;
 socket.emit('joined',{code,seat,mode:r.mode});
 io.to(code).emit('notice',`접속 ${r.players.filter(Boolean).length}/${r.players.length}명`);
 if(teamReady(r)){resetServe(r);io.to(code).emit('ready');}});
 socket.on('tuning',d=>{const r=rooms.get(socket.data.room);if(!r||socket.data.seat!==0||!d)return;const drag=Number(d.drag),basePower=Number(d.basePower),chargeMs=Number(d.chargeMs);if(![drag,basePower,chargeMs].every(Number.isFinite))return;r.tuning={drag:clamp(drag,0.005,0.12),basePower:clamp(basePower,0.30,0.30),maxPower:0.50,chargeMs:Math.round(clamp(chargeMs,200,1500))};io.to(socket.data.room).emit('tuning',r.tuning);});
 socket.on('move',d=>{const r=rooms.get(socket.data.room),seat=socket.data.seat;if(!r||r.phase==='waiting'||!d||!Number.isFinite(d.x)||!Number.isFinite(d.z))return;const p=r.p[seat];const x=clamp(d.x,doubles(r)?-3.05:-2.69,doubles(r)?3.05:2.69),z=team(seat)===0?clamp(d.z,.7,6.35):clamp(d.z,-6.35,-.7);const now=Date.now(),dt=clamp((now-(p.lastMove||now))/1000,.001,.12);p.lastMove=now;const oldX=p.x,oldZ=p.z,dist=Math.hypot(x-p.x,z-p.z),max=5.2*dt+.2;if(dist>max){const f=max/dist;p.x+=(x-p.x)*f;p.z+=(z-p.z)*f;}else{p.x=x;p.z=z;}p.stamina=Math.max(0,p.stamina-Math.hypot(p.x-oldX,p.z-oldZ)*STAMINA_DISTANCE_COST);p.yaw=Number.isFinite(d.yaw)?d.yaw:0;p.pitch=Number.isFinite(d.pitch)?clamp(d.pitch,-1.3,1.3):0;});
 socket.on('jump',()=>{const r=rooms.get(socket.data.room),seat=socket.data.seat;if(!r||!teamReady(r)||!['serve','flight'].includes(r.phase))return;const p=r.p[seat];if(r.phase==='serve'&&r.server===seat)return;if(p.jumpY<=.001&&p.jumpV===0){p.jumpV=5.4;}});
 socket.on('hit',d=>{
  const r=rooms.get(socket.data.room),seat=socket.data.seat;
  if(!r||!d||!['serve','flight'].includes(r.phase))return;
  if(r.phase==='serve'&&r.server!==seat)return;
  if(r.phase==='serve'&&!serviceReady(r)){socket.emit('notice','서브 불가: 양쪽 모두 올바른 서비스 칸에 서야 합니다.');return;}
  if(r.phase==='flight'&&r.last>=0&&team(r.last)===team(seat))return;
  const p=r.p[seat],b=r.ball,serving=r.phase==='serve',now=Date.now();
   if(now-p.lastSwingAt<SWING_COOLDOWN_MS)return;
  if(!serving&&Math.hypot(b.x-p.x,b.z-p.z,b.y-(1.35+p.jumpY))>2.35)return;
  const button=d.button==='right'?'right':'left';
  const rawPower=Number(d.power);
   const power=clamp(Number.isFinite(rawPower)?rawPower:r.tuning.basePower,r.tuning.basePower,r.tuning.maxPower);
  const charge=clamp((power-r.tuning.basePower)/(r.tuning.maxPower-r.tuning.basePower),0,1);
   const effectiveCharge=charge*powerFactor(p);
  const dir=d.dir||{},dx=Number(dir.x),dz=Number(dir.z);
  if(!Number.isFinite(dx)||!Number.isFinite(dz))return;
  const hz=dz/Math.max(.001,Math.hypot(dx,dz));
  if((team(seat)===0&&hz>-.12)||(team(seat)===1&&hz<.12))return;
  const contactY=serving?1.25:b.y;
  const headY=1.68+p.jumpY;
  const nearNet=Math.abs(b.z)<=2.35;
  let shot,targetX,targetZ;
  const far=(team(seat)===0?-1:1),rear=far*6.68;
  if(serving){
   shot=effectiveCharge<.5?'숏서브':'롱서브';
   targetX=-serveSign(r)*1.45;
   targetZ=far*(shot==='숏서브'?2.45:3.1+3.58*effectiveCharge);
   b.x=p.x;b.z=p.z;b.y=1.25;
  }else{
   // Aim may choose the lane, but calibrated landing never goes beyond the baseline.
   // Horizontal aiming follows the player's camera direction only.
   // Shot depth and vertical trajectory remain controlled by shot type/charge.
   // Project the camera's horizontal direction toward the opposite baseline;
   // clamp to the singles court so aiming cannot send shots out sideways.
   const farBaselineZ=far*6.68;
   const forwardDistance=Math.abs(farBaselineZ-b.z);
   const lateralSlope=clamp(dx/Math.max(.25,Math.abs(dz)),-1.2,1.2);
   targetX=clamp(b.x+lateralSlope*forwardDistance,doubles(r)?-2.95:-2.48,doubles(r)?2.95:2.48);
   // Incoming smash has priority over the usual height/near-net shot selector.
   // Left mouse: lift (under); right mouse: defensive drive.
   if(r.lastShot==='스매시'){
    shot=button==='right'?'드라이브':'언더';
   }else if(contactY-headY>=.24){
    shot=button==='right'?'스매시':'하이클리어';
   }else if(nearNet&&button==='left'){
    shot=charge<.36?'헤어핀':'언더';
   }else if(contactY<headY-.38){
    shot='언더';
   }else{
    // Mid-height shuttle: flat drive. Right-click also selects drive here.
    shot='드라이브';
   }
   if(shot==='스매시'){
    targetZ=far*clamp(1.6+effectiveCharge*3.2,1.6,5.2);
   }else if(r.lastShot==='스매시'&&shot==='드라이브'){
    // Smash block/drive: fast flat counter to mid/deep court, not a high lift.
    // Avoid aiming for the extreme back line at low contact heights.
    targetZ=far*(3.0+effectiveCharge*2.7);
   }else if(shot==='헤어핀'){
    targetZ=far*(.52+effectiveCharge*1.4);
   }else{
    // All non-smash shots reach the rear line at full charge; never go long.
    const nearDepth=shot==='드라이브'?3.2:shot==='하이클리어'?4.4:2.3;
    targetZ=far*(nearDepth+(6.68-nearDepth)*effectiveCharge);
   }
   // Full charge: no undershooting, including from the player's own baseline.
   if(effectiveCharge>=.98&&shot!=='스매시'&&shot!=='헤어핀'&&!(r.lastShot==='스매시'&&shot==='드라이브'))targetZ=rear;
   b.x=p.x*.25+b.x*.75;b.z=p.z*.18+b.z*.82;
  }
  if(launchShot(r,seat,shot,targetX,targetZ,contactY)){
    p.lastSwingAt=now;
    r.smashFx=(shot==='스매시'&&charge>=.98)?{id:++r.smashFxSeq,x:r.ball.x,y:r.ball.y,z:r.ball.z,seat}:null;
   }else{
   socket.emit('notice','이 위치에서 안전한 타구 궤적을 만들 수 없습니다. 공기저항을 조절해 주세요.');
  }
 });
 socket.on('restart',()=>{const r=rooms.get(socket.data.room);if(r&&teamReady(r)){r.score=[0,0];r.server=0;resetServe(r);}});
 socket.on('disconnect',()=>leave(socket));
});
function updateAI(r){
 if(!r.ai||!['serve','flight'].includes(r.phase))return;
 const p=r.p[1],b=r.ball,now=Date.now();
 let tx=r.phase==='serve'?r.p[1].x:0,tz=r.phase==='serve'?r.p[1].z:-3.65;
 const incoming=r.phase==='flight'&&r.last===0;
 const predicted=incoming?predictShuttle(b,r.tuning.drag):null;
 if(predicted){
  tx=clamp(predicted.x,-2.6,2.6);
  tz=clamp(predicted.z,-6.35,-.9);
 }
 const step=5.15*speedFactor(p)/60,dx=tx-p.x,dz=tz-p.z,dist=Math.hypot(dx,dz),oldX=p.x,oldZ=p.z;
 if(dist>step){p.x+=dx/dist*step;p.z+=dz/dist*step;}else{p.x=tx;p.z=tz;}
 p.yaw=Math.PI;
 if(now<r.aiNext)return;
 if(r.phase==='serve'&&r.server===1){
  if(!serviceReady(r))return;
  const short=Math.random()<.45;
  b.x=p.x;b.y=1.25;b.z=p.z;
  const targetX=-serveSign(r)*1.45,targetZ=short?2.45:6.25;
  const dist=Math.hypot(targetX-b.x,targetZ-b.z);
  const netDist=Math.abs(b.z)*dist/Math.abs(targetZ-b.z);
  if(!applyAIShot(r,short?'숏서브':'롱서브',targetX,targetZ,0))return;
  r.aiNext=now+650;return;
 }
 if(!incoming)return;
 const reach=Math.hypot(b.x-p.x,b.z-p.z,b.y-(1.35+p.jumpY));
 if(reach>2.15||b.z>-.35||b.y<.38||b.y>3.8)return;
 // Dedicated training AIs: fixed return type (service remains a legal service).
 if(r.aiMode==='smash'||r.aiMode==='drive'){
  const shot=r.aiMode==='smash'?'스매시':'드라이브';
  const targetX=clamp(r.p[0].x>0?-1.35:1.35,-2.35,2.35);
  // Smash requires an overhead contact. Do not relabel a clear as a smash.
  if(shot==='스매시'&&b.y<2.15)return;
  const targetZ=shot==='스매시'?clamp(r.p[0].z,2.3,4.8):6.68;
  if(applyAIShot(r,shot,targetX,targetZ,0))r.aiNext=now+450;
  return;
 }
 // Choose based on contact height, previous shot and court situation.
 const relative=b.y-(1.68+p.jumpY),roll=Math.random();
 let shot,angle,targetZ,targetX;
 const player=r.p[0];
 const leftOpen=player.x>0;
 targetX=clamp((leftOpen?-1:1)*(1.6+Math.random()*1.05),-2.45,2.45);
 if(relative>.22){
  if(roll<.34){shot='스매시';angle=-.18;targetZ=clamp(player.z-.75,1.3,5.6);}
  else if(roll<.62){shot='하이클리어';angle=.85;targetZ=6.68;}
  else{shot='하이클리어';angle=.78;targetZ=5.4+Math.random()*1.0;}
 }else if(relative<-.38||r.lastShot==='스매시'){
  shot='언더';angle=.90;targetZ=3.0+Math.random()*3.1;
 }else if(roll<.55){
  shot='드라이브';angle=.10;targetZ=3.4+Math.random()*2.1;
 }else if(roll<.8){
  shot='언더';angle=.95;targetZ=6.68;
 }else{
  shot='하이클리어';angle=.73;targetZ=5.4+Math.random()*1.0;
 }
 // A steep smash must still clear the net. Lower the angle only when high enough.
 if(shot==='스매시'&&b.y<2.35){shot='드라이브';angle=.09;targetZ=6.68;}
 const safeAngle=shot==='스매시'?angle:angle;
 applyAIShot(r,shot,targetX,targetZ,safeAngle);
}
function updateDoublesAI(r){
 if(!doubles(r)||!r.ai||!['serve','flight'].includes(r.phase))return;
 const b=r.ball,now=Date.now();
 const predicted=r.phase==='flight'?predictShuttle(b,r.tuning.drag):null;
 const targetSide=r.phase==='flight'&&r.last>=0?1-team(r.last):-1;
 // AI teammates use separate lanes and actively reposition, rather than all
 // chasing the same shuttle. The closest AI on the receiving team takes it.
 let hitter=-1,best=Infinity;
 if(predicted&&targetSide>=0){
  for(const i of [1,2,3]){
   if(team(i)!==targetSide)continue;
   const d=Math.hypot(predicted.x-r.p[i].x,predicted.z-r.p[i].z);
   if(d<best){best=d;hitter=i;}
  }
 }
 for(const i of [1,2,3]){
  const p=r.p[i],side=team(i),homeZ=side===0?3.65:-3.65;
  let tx,tz;
  if(r.phase==='serve'){
   // Keep serving and receiving AI inside their correct service boxes.
   // Non-participating teammates shuffle into a defensive formation.
   if(i===r.server||i===r.receiver){tx=p.x;tz=p.z;}
   else {tx=i===2?-1.65:1.65;tz=homeZ+(side===0?.12:-.12)*Math.sin(now/650);}
  }else if(i===hitter&&predicted){
   tx=clamp(predicted.x,-2.94,2.94);
   tz=side===0?clamp(predicted.z,.72,6.30):clamp(predicted.z,-6.30,-.72);
  }else{
   // Cover open space as a team: split the court horizontally and
   // advance or retreat with the shuttle.
   const partner=i===2?0:i===1?3:1;
   const partnerX=r.p[partner].x;
   tx=i===2?clamp(-partnerX*.45-1.05,-2.6,2.6):i===3?clamp(-partnerX*.4+1.05,-2.6,2.6):clamp(-r.p[3].x*.5-1.05,-2.6,2.6);
   tz=homeZ+(r.phase==='flight'?clamp((Math.abs(b.z)-3)*.28,-.7,.7)*(side===0?1:-1):0);
  }
  const dx=tx-p.x,dz=tz-p.z,dist=Math.hypot(dx,dz),step=4.6/60*speedFactor(p);
  const move=Math.min(step,dist);
  if(dist>.001){p.x+=dx/dist*move;p.z+=dz/dist*move;p.stamina=Math.max(0,p.stamina-move*STAMINA_DISTANCE_COST);}
  p.yaw=side===0?0:Math.PI;
 }
 if(now<r.aiNext)return;
 if(r.phase==='serve'){
  if(r.players[r.server]!=='AI'||!serviceReady(r))return;
  const i=r.server,p=r.p[i],far=team(i)===0?-1:1;
  b.x=p.x;b.z=p.z;b.y=1.25;
  if(launchShot(r,i,'숏서브',-serveSign(r)*1.4,far*2.5,1.25)){r.aiNext=now+650;r.smashFx=null;}
  return;
 }
 if(hitter<0||r.last<0)return;
 const i=hitter,p=r.p[i],side=team(i);
 const reach=Math.hypot(b.x-p.x,b.z-p.z,b.y-(1.35+p.jumpY));
 if(reach>2.15||b.y<.38||b.y>3.8||((b.z<0)!==(side===1)))return;
 const shot=b.y>2.2?'하이클리어':b.y<1.2?'언더':'드라이브';
 const far=side===0?-1:1;
 if(launchShot(r,i,shot,clamp(r.p[r.last].x>0?-1.5:1.5,-2.9,2.9),far*5.8,b.y)){
  r.aiNext=now+370;r.smashFx=null;
 }
}

setInterval(()=>{for(const [code,r] of rooms){if(doubles(r))updateDoublesAI(r);else updateAI(r);for(const p of r.p){if(p.jumpV!==0||p.jumpY>0){p.jumpY+=p.jumpV/60;p.jumpV-=13.5/60;if(p.jumpY<=0){p.jumpY=0;p.jumpV=0;}}}if(r.phase==='point'&&Date.now()>=r.next)resetServe(r);if(r.phase==='flight'){const b=r.ball,dt=1/60;const drag=Math.exp(-r.tuning.drag*Math.hypot(b.vx,b.vy,b.vz)*dt);b.vx*=drag;b.vy*=drag;b.vz*=drag;b.vy-=9.81*dt;const oldx=b.x,oldy=b.y,oldz=b.z;b.x+=b.vx*dt;b.y+=b.vy*dt;b.z+=b.vz*dt;if(oldz*b.z<=0&&b.y<1.524){point(r,opponent(r.last),'네트');}else if(b.y<=.08){const groundT=oldy>.08?clamp((oldy-.08)/(oldy-b.y),0,1):1;b.x=oldx+(b.x-oldx)*groundT;b.z=oldz+(b.z-oldz)*groundT;b.y=.08;const side=b.z>0?0:1;const inside=Math.abs(b.x)<=(doubles(r)?3.05:2.59)&&Math.abs(b.z)<=6.70&&Math.abs(b.z)>.08;const isService=r.lastShot==='숏서브'||r.lastShot==='롱서브';
   const targetSign=-serveSign(r);
   const serviceIn=b.x*targetSign>0 && Math.abs(b.x)<=(doubles(r)?3.05:SINGLES_HALF) && Math.abs(b.z)>=SERVICE_LINE && Math.abs(b.z)<=(doubles(r)?5.94:BASELINE);
   if(isService&&!serviceIn)point(r,opponent(r.last),'서브 폴트');
   else point(r,inside?r.last:opponent(r.last),inside?'인':'아웃');}else if(Math.abs(b.x)>4.54||Math.abs(b.z)>8.64){point(r,opponent(r.last),'아웃');}}if(++r.tick%2===0)io.to(code).emit('state',snapshot(r));}},1000/60);
const port=Number(process.env.PORT)||3000;server.listen(port,'0.0.0.0',()=>console.log('Badminton online: http://localhost:'+port));
