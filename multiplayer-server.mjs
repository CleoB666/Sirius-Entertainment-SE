/** The Tiny Heist Crew — dedicated, server-authoritative online matches.
 * Run with node multiplayer-server.mjs. A client may own the lobby, NEVER the simulation.
 * WebSocket protocol: browser sends input; server validates/ticks/renders authoritative state.
 */
import { createServer } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { createMatch } from './online-engine/match.mjs';
const PORT=Number(process.env.PORT||process.env.TTHC_ONLINE_PORT||4174), HOST=process.env.HOST||'0.0.0.0';
const MAX_ROOMS=80, MAX_FRAME=32_768, MAX_CLIENTS=400;
const rooms=new Map(), peers=new Set();
const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const nameOf=(v,fallback='PLAYER')=>String(v||fallback).replace(/[^a-zA-Z0-9 _-]/g,'').slice(0,18)||fallback;
const validChars=new Set(['clawster','lairy','gramp','strappy','trasselsudd']);
const charOf=v=>validChars.has(v)?v:'clawster';
const roomCode=()=>Array.from(randomBytes(7),b=>alphabet[b%alphabet.length]).join('');
const neutral={left:false,right:false,up:false,down:false,jumpHeld:false};
const allowOrigins=(process.env.TTHC_ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean);
const secureToken=()=>randomBytes(24).toString('hex');
function validToken(received,stored){if(typeof received!=='string'||!stored||received.length!==stored.length)return false;return timingSafeEqual(Buffer.from(received),Buffer.from(stored));}
function send(peer,payload){
  if(!peer||peer.closed||peer.socket.destroyed)return false;
  const bytes=Buffer.from(JSON.stringify(payload));
  if(bytes.length>256_000||peer.socket.writableLength>500_000)return false;
  const h=bytes.length<126?Buffer.from([0x81,bytes.length]):bytes.length<65536?Buffer.from([0x81,126,bytes.length>>8,bytes.length&255]):(()=>{const x=Buffer.alloc(10);x[0]=0x81;x[1]=127;x.writeBigUInt64BE(BigInt(bytes.length),2);return x;})();
  peer.socket.write(Buffer.concat([h,bytes]));return true;
}
function frame(peer,op,payload=Buffer.alloc(0)){if(peer.socket.destroyed)return;peer.socket.write(Buffer.concat([Buffer.from([0x80|op,payload.length]),payload]));}
function emit(room,packet){for(const seat of room.seats.values())if(seat.peer)send(seat.peer,packet);}
function roster(room){return [...room.seats.values()].sort((a,b)=>a.slot-b.slot).map(s=>({slot:s.slot,name:s.name,character:s.character,connected:!!s.peer&&!s.peer.closed,leader:s.slot===room.ownerSlot}));}
function status(room){emit(room,{type:'roster',room:room.code,phase:room.phase,players:roster(room),leaderSlot:room.ownerSlot});}
function welcome(room,seat){send(seat.peer,{type:'welcome',role:room.ownerSlot===seat.slot?'host':'guest',room:room.code,slot:seat.slot,token:seat.token,phase:room.phase});status(room);
  if(room.match){send(seat.peer,{type:'start',levelIndex:room.match.state.levelIndex});send(seat.peer,{type:'snapshot',state:room.match.snapshot()});
    if(room.phase==='finished')send(seat.peer,{type:'finish',result:{reason:room.match.state.reason,final:room.match.snapshot()}});
  }
}
function error(peer,message){send(peer,{type:'error',message});}
function clearSeat(seat){if(!seat)return;seat.peer=null;seat.disconnectedAt=Date.now();seat.input={...neutral};if(seat.room?.match)seat.room.match.setDisconnected(seat.slot,true);}
function removePeer(peer,voluntary=false){
  if(peer.closed)return;peer.closed=true;peers.delete(peer);
  const room=peer.room, seat=peer.seat;
  if(!room||!seat||seat.peer!==peer)return;
  clearSeat(seat);peer.room=null;peer.seat=null;
  if(voluntary && room.phase!=='playing')room.seats.delete(seat.slot);
  if(room.ownerSlot===seat.slot){
    const successor=[...room.seats.values()].filter(s=>s.peer&&!s.peer.closed).sort((a,b)=>a.slot-b.slot)[0];
    if(successor){room.ownerSlot=successor.slot;send(successor.peer,{type:'role',role:'host',slot:successor.slot});}
  }
  status(room);
}
function connectSeat(peer,room,seat){seat.peer=peer;seat.disconnectedAt=0;peer.room=room;peer.seat=seat;room.emptyAt=0;room.match?.setDisconnected(seat.slot,false);welcome(room,seat);}
function handle(peer,p){
  if(!p || typeof p!=='object'||Array.isArray(p)||typeof p.type!=='string')return;
  if(!peer.room){
    if(p.type==='host'){
      if(rooms.size>=MAX_ROOMS)return error(peer,'Server busy. Please try again.');
      let code=roomCode();while(rooms.has(code))code=roomCode();
      const room={code,phase:'waiting',created:Date.now(),seats:new Map(),ownerSlot:0,match:null,bots:0,difficulty:'normal',levelIndex:0};
      const seat={room,slot:0,name:nameOf(p.name,'HOST'),character:charOf(p.character),token:secureToken(),peer:null};
      room.seats.set(0,seat);rooms.set(code,room);connectSeat(peer,room,seat);return;
    }
    if(p.type==='join'){
      const code=String(p.room||'').toUpperCase().replace(/[^A-Z2-9]/g,'').slice(0,8);
      const room=rooms.get(code);if(!room)return error(peer,'Room not found. Check the code.');
      let seat=typeof p.token==='string'?[...room.seats.values()].find(s=>validToken(p.token,s.token)):undefined;
      if(seat){if(seat.peer && seat.peer!==peer){const old=seat.peer;old.room=null;old.seat=null;old.socket.destroy();old.closed=true;peers.delete(old);}}
      else{
        if(room.phase!=='waiting')return error(peer,'Match in progress. Only returning players can rejoin.');
        const slot=[0,1,2,3].find(i=>!room.seats.has(i));if(slot===undefined)return error(peer,'This room has four players already.');
        seat={room,slot,name:nameOf(p.name,`PLAYER ${slot+1}`),character:charOf(p.character),token:secureToken(),peer:null};room.seats.set(slot,seat);
      }
      connectSeat(peer,room,seat);return;
    }
    return error(peer,'Create or join a room first.');
  }
  const room=peer.room,seat=peer.seat;
  if(p.type==='leave'){removePeer(peer,true);peer.socket.end();return;}
  if(p.type==='character' && room.phase==='waiting'){seat.character=charOf(p.character);status(room);return;}
  if(p.type==='name' && room.phase==='waiting'){seat.name=nameOf(p.name,seat.name);status(room);return;}
  if(p.type==='input' && room.phase==='playing' && room.match){
    const now=Date.now();if(now-(peer.lastInputAt||0)<22)return;peer.lastInputAt=now;
    const c=p.controls&&typeof p.controls==='object'?p.controls:{};
    const controls=Object.fromEntries(Object.keys(neutral).map(k=>[k,c[k]===true]));
    const actions=Array.isArray(p.actions)?p.actions.filter(a=>['hide','ability','use','stash'].includes(a)).slice(0,4):[];
    room.match.input(seat.slot,controls,actions);return;
  }
  if(seat.slot!==room.ownerSlot)return;
  if(p.type==='start' && (room.phase==='waiting'||room.phase==='finished')){
    const levelIndex=Number(p.levelIndex),bots=Number(p.bots),difficulty=p.difficulty;
    if(!Number.isInteger(levelIndex)||levelIndex<0||levelIndex>3)return error(peer,'Invalid room selection.');
    if(!Number.isInteger(bots)||bots<0||bots>3)return error(peer,'Choose 0–3 bots.');
    if(!['easy','normal','hard'].includes(difficulty))return error(peer,'Choose bot difficulty.');
    const connected=[...room.seats.values()].filter(s=>s.peer&&!s.peer.closed).sort((a,b)=>a.slot-b.slot);
    if(connected.length+bots<2 || connected.length+bots>4)return error(peer,'A match needs 2–4 total players.');
    const participants=connected.map(s=>({slot:s.slot,character:s.character,name:s.name,bot:false}));
    const used=new Set(participants.map(s=>s.character));
    for(let i=0;i<bots;i++){
      const next=[...validChars].find(id=>!used.has(id))||[...validChars][i%5];used.add(next);
      participants.push({slot:-1,character:next,name:`BOT ${i+1}`,bot:true});
    }
    room.match=createMatch({levelIndex,participants,difficulty});room.phase='playing';room.bots=bots;
    emit(room,{type:'start',levelIndex});status(room);emit(room,{type:'snapshot',state:room.match.snapshot()});return;
  }
  if(p.type==='pause' && room.phase==='playing'){room.match.state.paused=true;emit(room,{type:'pause'});return;}
  if(p.type==='resume' && room.phase==='playing'){room.match.state.paused=false;emit(room,{type:'resume'});return;}
  if(p.type==='abort' && room.phase==='playing'){room.match=null;room.phase='waiting';emit(room,{type:'abort'});status(room);return;}
  if(p.type==='reset' && room.phase==='finished'){room.phase='waiting';room.match=null;status(room);return;}
}
const server=createServer((req,res)=>{
  if(req.url?.split('?')[0]!=='/'){res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found');return;}
  res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
  res.end(JSON.stringify({service:'TTHC Dedicated Heist Server',protocol:2,status:'ok',activeRooms:rooms.size}));
});
server.on('upgrade',(req,socket,head)=>{
  if(peers.size>=MAX_CLIENTS || req.url?.split('?')[0]!=='/ws' || req.headers.upgrade?.toLowerCase()!=='websocket' || req.headers['sec-websocket-version']!=='13' ||
      (allowOrigins.length && !allowOrigins.includes(req.headers.origin))){socket.destroy();return;}
  const key=req.headers['sec-websocket-key'];
  if(typeof key!=='string'||Buffer.from(key,'base64').length!==16){socket.destroy();return;}
  const accept=createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
  socket.setNoDelay(true);
  const peer={socket,room:null,seat:null,closed:false,buffer:Buffer.alloc(0),started:Date.now(),lastAlive:Date.now(),lastInputAt:0};peers.add(peer);
  function receive(chunk){
    peer.buffer=Buffer.concat([peer.buffer,chunk]);
    if(peer.buffer.length>MAX_FRAME+1024){socket.destroy();return;}
    while(peer.buffer.length>=2){
      const b0=peer.buffer[0],b1=peer.buffer[1],op=b0&15;
      if((b0&0x70)||!(b0&128)||!(b1&128)||![1,8,9,10].includes(op)){socket.destroy();return;}
      let n=b1&127,off=2;
      if(n===126){if(peer.buffer.length<4)return;n=peer.buffer.readUInt16BE(2);off=4;}
      if(n===127){if(peer.buffer.length<10)return;const large=peer.buffer.readBigUInt64BE(2);if(large>BigInt(MAX_FRAME)){socket.destroy();return;}n=Number(large);off=10;}
      if(n>MAX_FRAME){socket.destroy();return;}
      if(peer.buffer.length<off+4+n)return;
      const mask=peer.buffer.subarray(off,off+4),data=Buffer.from(peer.buffer.subarray(off+4,off+4+n));
      peer.buffer=peer.buffer.subarray(off+4+n);for(let i=0;i<data.length;i++)data[i]^=mask[i%4];peer.lastAlive=Date.now();
      if(op===8){removePeer(peer,true);socket.end();return;}
      if(op===9){frame(peer,10,data.subarray(0,125));continue;}
      if(op===10)continue;
      try{handle(peer,JSON.parse(data.toString('utf8')));}catch(e){error(peer,'Invalid request.');}
    }
  }
  socket.on('data',receive);socket.on('error',()=>{});socket.on('close',()=>removePeer(peer));
  if(head?.length)receive(head);
});
// Tick matches in the SERVER, independent of browser visibility, framerate and host connection.
let last=performance.now(),snapshotAt=0;
setInterval(()=>{
  const now=performance.now();const dt=Math.min(.08,Math.max(0,(now-last)/1000));last=now;
  for(const room of rooms.values()){
    if(room.phase!=='playing'||!room.match)continue;
    try{room.match.update(dt);}catch(e){console.error('[TTHC] Dedicated simulation error',room.code,e);room.match.state.running=false;room.match.state.reason='Server simulation error';}
    if(!room.match.state.running){room.phase='finished';emit(room,{type:'snapshot',state:room.match.snapshot()});emit(room,{type:'finish',result:{reason:room.match.state.reason,final:room.match.snapshot()}});status(room);}
  }
},1000/30).unref();
setInterval(()=>{
  for(const room of rooms.values())if(room.phase==='playing'&&room.match)emit(room,{type:'snapshot',state:room.match.snapshot()});
},70).unref();
setInterval(()=>{
  const now=Date.now();
  for(const room of rooms.values()){
    const connected=[...room.seats.values()].filter(s=>s.peer&&!s.peer.closed);
    if(connected.length===0){room.emptyAt ||=now;if(now-room.emptyAt>120_000){rooms.delete(room.code);continue;}}else room.emptyAt=0;
    if(now-room.created>4*60*60*1000){emit(room,{type:'closed',message:'Room expired. Create another room.'});rooms.delete(room.code);continue;}
    for(const seat of room.seats.values())if(!seat.peer && now-seat.disconnectedAt>60_000 && room.phase!=='playing')room.seats.delete(seat.slot);
  }
  for(const peer of peers){if((!peer.room&&now-peer.started>20_000)||now-peer.lastAlive>90_000)peer.socket.destroy();else if(now-peer.lastAlive>22_000)frame(peer,9);}
},10000).unref();
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{for(const room of rooms.values())emit(room,{type:'closed',message:'Game server is restarting. Matches cannot continue during maintenance.'});server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),3000).unref();});
server.listen(PORT,HOST,()=>console.log(`TTHC dedicated online running on http://${HOST}:${PORT} /ws`));
