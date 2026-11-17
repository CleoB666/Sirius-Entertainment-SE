/** Sirius Entertainment — Heist Circuit authoritative online match.
 * No DOM, no browser-host simulation; this process owns every action, pickup and point.
 * Shares exact level geometry, character statistics, and Eurogame rules with the web game.
 */
import { GAME, CHARACTERS, THIEF_IDS } from './config.mjs';
import { LEVELS } from './levels.mjs';
import { createNavigator } from './navigation.mjs';
import { createHeistMode, tickHeist, recordHeistPickup, recordHeistRelay,
  recordHeistVault, recordHeistCombo, recordHeistAbility, tryStash } from './heist.mjs';

const clamp = (x,a,b) => Math.max(a, Math.min(b,x));
const advance = (x, target, step) => x < target ? Math.min(x+step,target) : Math.max(x-step,target);
const centerX = p => p.x + (p.w||0)/2;
const centerY = p => p.y + (p.h||0)/2;
const dist = (a,b) => Math.hypot(centerX(a)-centerX(b),centerY(a)-centerY(b));
const hit = (a,b,pad=0) => a.x+pad < b.x+b.w && a.x+a.w-pad > b.x && a.y+pad < b.y+b.h && a.y+a.h-pad > b.y;
const NO_INPUT = Object.freeze({left:false,right:false,up:false,down:false,jumpHeld:false});
const MAX_ITEMS = 55;

function playerFor(spec,i,level) {
  const id = THIEF_IDS.includes(spec.character) ? spec.character : THIEF_IDS[i%THIEF_IDS.length];
  const c=CHARACTERS[id];
  const x=clamp(level.playerSpawn.thief[0]+52*i,1,GAME.width-c.width-1);
  const y=Math.min(level.playerSpawn.thief[1],level.floorY-c.height-6);
  return {id,x,y,prevX:x,prevY:y,w:c.width,h:c.height,vx:0,vy:0,face:1,onGround:false,climbing:false,
    active:true,enemy:false,stunned:0,landSquash:0,coyote:0,jumpBuffer:0,ledgePull:0,mode:'patrol',suspicion:0,pulse:0,
    animDistance:0,idlePhase:i*.85,mpIndex:i,remoteSlot:spec.slot??-1,mpType:spec.bot?'bot':'remote',
    displayName:spec.bot?`BOT ${i+1}`:String(spec.name||`PLAYER ${i+1}`).slice(0,18),
    points:0,lives:3,energy:3,tools:0,loot:0,cargo:0,relayDeliveries:0,protectedPoints:0,
    stashes:0,contractWins:0,contractCounters:{socks:0,tools:0,gold:0},hidden:false,hideTimer:0,hideNoise:false,
    hideSpot:null,invisible:0,boostTimer:0,damageCooldown:0,abilityCooldown:0,mpUpHeldV4:false,
    mpComboCountV4:0,lastInputAt:0, input: {...NO_INPUT}, pending:[],_navTransit:null,navSurface:undefined,
    aiTarget:-1,aiDecision:0,aiGoal:null,aiWatch:0,aiWatchX:x,aiWatchY:y,aiFrozen:0,aiRecover:0};
}

function guardFor(level) {
  const c=CHARACTERS.draco, [x,y]=level.playerSpawn.guard;
  return {id:'draco',x,y,prevX:x,prevY:y,w:c.width,h:c.height,vx:0,vy:0,face:-1,
    active:true,enemy:true,onGround:false,climbing:false,coyote:0,jumpBuffer:0,ledgePull:0,
    animDistance:0,idlePhase:0,mode:'patrol',suspicion:0,pulse:0,stunned:0,landSquash:0,
    mpMemory:0,mpPatrolX:120,mpPatrolTimer:0,lastSeenX:550,lastSeenY:550,damageCooldown:0,
    hidden:false,invisible:0};
}
const itemAt=(x,y,kind='sock',extra={})=>({x,y,kind,index:0,w:26,h:26,collected:false,magnet:false,phase:0,...extra});
const short = (n) => Math.round(n*100)/100;

export function createMatch({levelIndex=0,participants=[],difficulty='normal'}={}) {
  if(!Number.isInteger(levelIndex)||levelIndex<0||levelIndex>=LEVELS.length)throw Error('Invalid level');
  if(participants.length<2||participants.length>4)throw Error('Match requires 2-4 participants');
  const level=LEVELS[levelIndex];
  const nav=createNavigator(level,GAME.width);
  const players=participants.map((sp,i)=>playerFor(sp,i,level));
  const guard=guardFor(level);
  const items=level.items.map((obj,i)=>({...itemAt(obj.x,obj.y,obj.kind),index:i,phase:i*1.7}));
  const nonfloor=level.surfaces.filter(s=>s.type!=='floor'&&s.w>=85);
  const vaultCandidates=nonfloor.filter(s=>s.w>=100&&s.x>90&&s.x<1170);
  const vs=[vaultCandidates[Math.floor(vaultCandidates.length*.28)],vaultCandidates[Math.floor(vaultCandidates.length*.76)]].filter(Boolean);
  const vaults=[...new Set(vs)].map((s,i)=>({id:i+1,x:s.x+s.w/2,y:s.y-27,owner:null,requiredTools:2,reward:3}));
  const surfaces=level.surfaces;
  const relayIds=[Math.floor(surfaces.length*.16),Math.floor(surfaces.length*.54),Math.floor(surfaces.length*.87)];
  const relay={stations:[...new Set(relayIds)].map((id,i)=>({x:surfaces[id].x+surfaces[id].w/2,y:surfaces[id].y-25,kind:'relay',index:'relay-'+i})),index:0,timer:23,cooldown:0,deliveries:0};
  const state={levelIndex,elapsed:0,remaining:Math.max(150,level.time),players,enemies:[guard],items,vaults,relay,
    heist:createHeistMode(),nextSupplyDrop:34,nextSockWave:24,vaultLockdown:0,finalRush:false,
    collected:0,noise:null,decoy:null,hidden:false,hiddenSpot:null,particles:[],running:true,
    dropSerial:0,sockSerial:0,paused:false,lastThiefWarned:false,reason:'',winner:null};
  for(let i=0;i<Math.min(4,players.length+1);i++) {const s=nonfloor[(i*3+2)%nonfloor.length]; if(s) items.push(itemAt(s.x+s.w*(.35+(i%2)*.3),s.y-25,i%3===0?'button':'sock',{index:items.length}));}
  const speedFactor={easy:.78,normal:.9,hard:1}[difficulty]??.9;
  const events=[];
  function notice(message){events.push(String(message).slice(0,180));if(events.length>8)events.shift();}
  function input(slot,controls={},actions=[]) {
    if(!state.running||state.paused)return;
    const p=players.find(p=>p.remoteSlot===slot && p.mpType!=='bot');
    if(!p||!p.active)return;
    p.input=Object.fromEntries(['left','right','up','down','jumpHeld'].map(k=>[k,controls[k]===true]));
    if(Array.isArray(actions))for(const a of actions.slice(0,4))if(['hide','ability','use','stash'].includes(a)&&p.pending.length<8)p.pending.push(a);
    p.lastInputAt=state.elapsed;
  }
  function findClimb(p) {
    const sensor={x:p.x+p.w*.32,y:p.y+4,w:p.w*.36,h:Math.max(8,p.h-8)};
    return level.climbs.find(c=>hit(sensor,c));
  }
  function walkableBounds(surface){
    const clearance=surface.type==='floor'?0:Math.min(24,Math.max(14,surface.w*.19));
    return {left:surface.x+clearance,right:surface.x+surface.w-clearance};
  }
  function grabLedge(p,dir,wasGrounded){
    if(!dir||p.climbing||wasGrounded||p.ledgePull>0||p.vy< -230)return false;
    const handY=p.y+p.h*.2,feetY=p.y+p.h;
    const edge=level.surfaces.find(s=>{
      if(s.type==='floor'||s.y<handY-20||s.y>feetY+14)return false;
      const bounds=walkableBounds(s);
      return dir>0?Math.abs(p.x+p.w-bounds.left)<21:Math.abs(p.x-bounds.right)<21;
    });
    if(!edge)return false;
    const bounds=walkableBounds(edge);
    p.x=dir>0?bounds.left+6:bounds.right-p.w-6;
    p.y=edge.y-p.h;p.vx*=.35;p.vy=0;p.onGround=true;p.ledgePull=.42;p.landSquash=.18;
    return true;
  }
  function physics(p, controls, dt, factor=1){
    if(!p.active)return;
    p.prevX=p.x;p.prevY=p.y;
    const c=CHARACTERS[p.id];
    p.coyote=p.onGround?.11:Math.max(0,p.coyote-dt);
    p.landSquash=Math.max(0,(p.landSquash||0)-dt*4.8);
    p.ledgePull=Math.max(0,(p.ledgePull||0)-dt);
    const dir=Number(!!controls.right)-Number(!!controls.left);
    const cl=findClimb(p), up=Number(!!controls.up),down=Number(!!controls.down);
    if(controls.up && !p._lastUp && !cl && !p.climbing) p.jumpBuffer=.18;
    p._lastUp=!!controls.up;
    if(cl && (up||down) && p.ledgePull<=0) p.climbing=true;
    if(p.climbing&&!cl)p.climbing=false;
    const tSpeed=c.speed*factor*(p.boostTimer>0?1.28:1);
    p.vx=advance(p.vx,dir*tSpeed,c.acceleration*(p.onGround?1:.6)*factor*dt);
    if(!dir)p.vx=advance(p.vx,0,c.acceleration*(p.onGround?1.3:.22)*dt);
    if(dir)p.face=dir;
    if(p.climbing&&cl){
      p.vy=(down-up)*c.speed*.68*factor;
      p.x=clamp(p.x+(cl.x+cl.w/2-p.w/2-p.x)*.11,0,GAME.width-p.w);
      p.onGround=false;
      const mount=level.surfaces.filter(s=>s.type!=='floor' && Math.abs(s.y-cl.y)<70 && s.x<cl.x+cl.w+18 && s.x+s.w>cl.x-18).sort((a,b)=>Math.abs(a.y-cl.y)-Math.abs(b.y-cl.y))[0];
      if(mount && up && p.y+p.h*.45<=mount.y+22){
        p.climbing=false;p.onGround=true;p.vy=0;p.ledgePull=.42;
        p.x=clamp(cl.x+cl.w+8,mount.x+5,mount.x+mount.w-p.w-5);
        p.y=mount.y-p.h;
      }
    }else{
      if(p.jumpBuffer>0 && p.coyote>0){p.vy=-c.jump;p.onGround=false;p.coyote=0;p.jumpBuffer=0;}
      p.vy=Math.min(GAME.maxFall,p.vy+GAME.gravity*(p.vy<0 && !controls.jumpHeld?1.95:1)*dt);
    }
    p.jumpBuffer=Math.max(0,p.jumpBuffer-dt);
    const priorBottom=p.y+p.h,wasGrounded=p.onGround;
    p.x=clamp(p.x+p.vx*dt,0,GAME.width-p.w);
    p.y+=p.vy*dt;
    p.onGround=false;
    const grabbed=grabLedge(p,dir,wasGrounded);
    if(!grabbed && !p.climbing && p.vy>=0){
      let landing=null;
      for(const s of level.surfaces){
        const bounds=walkableBounds(s);
        const horizontal=p.x+p.w-7>bounds.left&&p.x+7<bounds.right;
        if(horizontal && priorBottom<=s.y+5 && p.y+p.h>=s.y && (!landing||s.y<landing.y))landing=s;
      }
      if(landing){p.y=landing.y-p.h;p.vy=0;p.onGround=true;}
    }
    floorSafety(p);
    p.animDistance+=Math.abs(p.x-p.prevX)+Math.abs(p.y-p.prevY)*.28;
    if(!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.y>GAME.height+80||Math.abs(p.x)>GAME.width*2){
      const [x,y]=p.id==='draco'?level.playerSpawn.guard:level.playerSpawn.thief;
      p.x=clamp(x+Math.max(0,p.mpIndex||0)*52,0,GAME.width-p.w);p.y=y;p.prevX=p.x;p.prevY=p.y;
      p.vx=0;p.vy=0;p.onGround=false;p.climbing=false;p._navTransit=null;p.navSurface=undefined;
    }
  }
  function floorSafety(p){
    if(!p || !p.active || p.hidden || p.climbing)return;
    const floor=level.surfaces.find(s=>s.type==='floor');
    if(!floor || !Number.isFinite(p.x) || !Number.isFinite(p.y))return;
    if(p.y+p.h>floor.y && p.vy>=0 && p.x+p.w>floor.x && p.x<floor.x+floor.w){
      p.y=floor.y-p.h;p.vy=0;p.onGround=true;p.coyote=.11;p.ledgePull=0;
      if(!Number.isFinite(p.prevY)||p.prevY>p.y+28)p.prevY=p.y;
    }
  }
  function nearHide(p) {return level.hideSpots.find(s=>Math.abs(centerX(p)-(s.x+s.w/2))<s.w/2+42 && Math.abs(centerY(p)-(s.y+s.h/2))<s.h/2+42);}
  function toggleHide(p){
    if(p.hidden){
      p.hidden=false;p.hideSpot=null;p.hideTimer=0;p.hideNoise=false;
      const home=p.hideReturn;
      p.hideReturn=null;
      if(home && Number.isFinite(home.x) && Number.isFinite(home.y)){
        p.x=clamp(home.x,0,GAME.width-p.w);
        p.y=Math.min(home.y,level.floorY-p.h);
      } else p.y=level.floorY-p.h;
      p.prevX=p.x;p.prevY=p.y;p.vx=0;p.vy=0;
      p.onGround=false;p.climbing=false;p.jumpBuffer=0;p._lastUp=false;
      p.damageCooldown=Math.max(p.damageCooldown||0,.3);
      floorSafety(p);
      return;
    }
    const s=nearHide(p);if(!s)return;
    p.hideReturn={x:p.x,y:p.y};
    p.hidden=true;p.hideSpot=s;p.hideTimer=0;p.hideNoise=false;p.vx=p.vy=0;
    p.x=clamp(s.x+s.w/2-p.w/2,0,GAME.width-p.w);p.y=s.y+s.h-p.h-5;
  }
  function stash(p){if(nearHide(p)&&tryStash(p))notice(`${p.displayName} banked points safely!`);}
  function releaseGold(machine){
    let count=0;
    const ordered=[...nonfloor].sort((a,b)=>Math.abs((b.x+b.w/2)-machine.x)-Math.abs((a.x+a.w/2)-machine.x));
    for(const s of ordered){
      if(count>=3||items.length>MAX_ITEMS)break;
      const x=clamp(s.x+s.w*(count%2?.68:.34),s.x+24,s.x+s.w-24),y=s.y-24;
      if(items.some(k=>!k.collected&&Math.hypot(k.x-x,k.y-y)<42))continue;
      items.push(itemAt(x,y,'sock',{index:items.length,premium:true,sockWave:true,jackpotGold:true,spawnedAt:state.elapsed}));count++;
    }
    return count;
  }
  function dropSupply(){
    const list=nonfloor.filter(s=>s.w>=85);
    if(!list.length||items.filter(i=>!i.collected && i.kind!=='sock').length>=5)return;
    const s=list[Math.abs(state.dropSerial++)%list.length];
    const x=clamp(s.x+s.w*.5,s.x+22,s.x+s.w-22),y=s.y-24;
    items.push(itemAt(x,y,'button',{index:items.length,supplyDrop:true,spawnedAt:state.elapsed}));
  }
  function dropSocks(){
    const outstanding=items.filter(i=>!i.collected && i.kind==='sock').length;
    const count=Math.max(0,Math.min(4,10-outstanding,MAX_ITEMS-items.length));
    for(let i=0;i<count;i++){
      const s=nonfloor[Math.abs(state.sockSerial++)%nonfloor.length];if(!s)break;
      const x=clamp(s.x+s.w*(.32+(i%2)*.32),s.x+22,s.x+s.w-22),y=s.y-24;
      if(items.some(k=>!k.collected&&Math.hypot(k.x-x,k.y-y)<40))continue;
      items.push(itemAt(x,y,'sock',{index:items.length,premium:state.sockSerial%12===0,sockWave:true,spawnedAt:state.elapsed}));
    }
  }
  function use(p){
    const station=state.relay.stations[state.relay.index];
    if(station && Math.abs(centerX(p)-station.x)<68 && Math.abs(centerY(p)-station.y)<77){
      if(p.cargo<2 || state.relay.cooldown>0)return;
      const cargo=p.cargo,payout=cargo*4+(cargo>=4?4:0);
      p.cargo=0;p.points+=state.remaining<=30?payout*2:payout;p.energy=Math.min(5,p.energy+1);
      p.relayDeliveries++;state.relay.deliveries++;state.relay.cooldown=2;state.relay.timer=23;
      state.relay.index=(state.relay.index+1)%state.relay.stations.length;
      recordHeistRelay(state.heist,p);notice(`${p.displayName} delivered ${cargo} socks!`);return;
    }
    if(state.vaultLockdown>0 || p.tools<2)return;
    const vault=vaults.find(v=>v.owner===null && Math.abs(centerX(p)-v.x)<65 && Math.abs(centerY(p)-v.y)<63);
    if(!vault)return;
    p.tools-=2;p.points+=vault.reward;p.energy=Math.min(5,p.energy+1);vault.owner=p.mpIndex;
    p.vaultWins=(p.vaultWins||0)+1;
    if(vaults.some(v=>v.owner===null))state.vaultLockdown=8;
    recordHeistVault(state.heist,p);
    releaseGold(vault);dropSupply();notice(`${p.displayName} started a GOLD JACKPOT!`);
  }
  function ability(p){
    if(p.abilityCooldown>0||p.energy<1)return;
    const c=CHARACTERS[p.id];p.abilityCooldown=c.cooldown||10;p.energy--;
    if(p.id==='clawster'){
      const target=items.filter(i=>!i.collected && Math.hypot(i.x-centerX(p),i.y-centerY(p))<160)
        .sort((a,b)=>Math.hypot(a.x-centerX(p),a.y-centerY(p))-Math.hypot(b.x-centerX(p),b.y-centerY(p)))[0];
      if(target){target.x=centerX(p);target.y=centerY(p);}
    }else if(p.id==='lairy')p.boostTimer=2.5;
    else if(p.id==='gramp')guard.stunned=2.2;
    else if(p.id==='strappy')state.decoy={x:p.x+p.face*145,y:p.y,face:p.face,time:3.2};
    else if(p.id==='trasselsudd')p.invisible=2.5;
    recordHeistAbility(state.heist);
  }
  function pickup(p,item){
    if(item.collected||!p.active)return;
    item.collected=true;state.collected++;p.loot++;
    const kind=item.premium?'gold':item.kind==='sock'?'sock':'supply';
    if(Number.isFinite(p.mpLastPickupTimeV4) && state.elapsed-p.mpLastPickupTimeV4<=10 && p.mpLastPickupFamilyV4!==kind){
      p.points+=3;p.mpComboCountV4++;recordHeistCombo(state.heist,p);p.mpLastPickupTimeV4=-100;
    }else {p.mpLastPickupTimeV4=state.elapsed;p.mpLastPickupFamilyV4=kind;}
    if(item.premium){p.points+=6;p.energy=Math.min(5,p.energy+1);}
    else if(item.kind==='sock'){p.points++;p.cargo=Math.min(4,p.cargo+1);p.energy=Math.min(5,p.energy+1);}
    else{p.points++;p.tools=Math.min(3,p.tools+1);p.energy=Math.min(5,p.energy+1);}
    recordHeistPickup(state.heist,p,item);
  }
  function spillCargo(p,count){
    if(!count)return;
    const available=Math.min(2,count);
    const ranked=[...level.surfaces].sort((a,b)=>Math.abs(a.y-(p.y+p.h))+Math.abs((a.x+a.w/2)-centerX(p))*.15 - (a.type==='floor'?15:0));
    const nearest=ranked[0];if(!nearest)return;
    for(let i=0;i<available&&items.length<MAX_ITEMS;i++){
      const x=clamp(centerX(p)+(i===0?-34:34),nearest.x+24,nearest.x+nearest.w-24),y=nearest.y-24;
      items.push(itemAt(x,y,'sock',{index:items.length,sockWave:true,spawnedAt:state.elapsed}));
    }
  }
  function damage(p){
    if(!p.active || p.damageCooldown>0)return;
    p.lives=Math.max(0,p.lives-1);
    if(p.tools>0)p.tools--;else p.points=Math.max(p.protectedPoints,p.points-3);
    p.hidden=false;p.hideSpot=null;p.hideReturn=null;p.hideNoise=false;p.invisible=0;p.boostTimer=0;
    const dropped=p.cargo;p.cargo=0;spillCargo(p,dropped);p._navTransit=null;p.navSurface=undefined;p.aiGoal=null;p.aiFrozen=0;
    p.climbing=false;p.onGround=false;p.vx=p.vy=0;p.jumpBuffer=0;p._lastUp=false;
    if(!p.lives){p.active=false;notice(`${p.displayName} is OUT!`);return;}
    p.damageCooldown=5.0;
    const [x,y]=level.playerSpawn.thief;p.x=clamp(x+p.mpIndex*52,0,GAME.width-p.w);p.y=y;
    p.prevX=p.x;p.prevY=p.y;notice(`${p.displayName} caught by Draco — ${p.lives} lives left!`);
  }
  function botInput(p,dt){
    if(!p.active)return NO_INPUT;
    if(p.hidden){if(p.hideTimer>1.8)toggleHide(p);return NO_INPUT;}
    p.aiDecision-=dt;
    if(p.aiDecision<=0 || !p.aiGoal){
      p.aiDecision=.35+Math.random()*.35;
      let candidates=items.filter(it=>!it.collected).map(it=>({target:it,weight:nav.estimate(p,it) -(it.premium?250:0)-(it.kind==='sock' && p.cargo<4?120:0)}));
      if(p.cargo>=2){const st=relay.stations[relay.index];candidates.push({target:st,weight:nav.estimate(p,st)-300-p.cargo*180});}
      if(p.tools>=2 && state.vaultLockdown<=0)for(const v of vaults.filter(v=>v.owner===null))candidates.push({target:v,weight:nav.estimate(p,v)-170});
      if(candidates.length){candidates.sort((a,b)=>a.weight-b.weight);p.aiGoal=candidates[0].target;}
      else {const s=nonfloor[(Math.floor(state.elapsed/3)+p.mpIndex*3)%nonfloor.length];p.aiGoal=s?{x:s.x+s.w/2,y:s.y-25}:relay.stations[relay.index];}
    }
    if(p.cargo>=2 && Math.abs(centerX(p)-relay.stations[relay.index].x)<65 && Math.abs(centerY(p)-relay.stations[relay.index].y)<77)use(p);
    if(p.tools>=2)for(const v of vaults)if(v.owner===null && Math.abs(centerX(p)-v.x)<62 && Math.abs(centerY(p)-v.y)<60)use(p);
    if(p.points-p.protectedPoints>=3 && p.tools && nearHide(p) && p.stashes<2 && Math.random()<dt*.4)stash(p);
    if(guard.mode==='chase'&&dist(guard,p)<105 && nearHide(p) && Math.random()<dt*1.5)toggleHide(p);
    const steer=nav.steer(p,p.aiGoal,dt);
    p.aiWatch+=dt;
    if(p.aiWatch>1.2){
      const moved=Math.hypot(p.x-p.aiWatchX,p.y-p.aiWatchY);
      p.aiWatch=0;p.aiWatchX=p.x;p.aiWatchY=p.y;
      if(moved<9 && !p.hidden){p.aiFrozen++;p.aiGoal=null;p.aiDecision=0;p._navTransit=null;p.navSurface=undefined;p._navFallback=null;
        if(p.aiFrozen>=2){
          p.aiRecover=(p.aiRecover||0)+1;
          if(!nav.recover(p,p.aiRecover+p.mpIndex)){
            p.face=p.aiRecover%2===0?-1:1;p.vx=p.face*140;
            if(p.onGround)p.jumpBuffer=.17;
          }
          p.aiFrozen=0;
        }}
      else p.aiFrozen=0;
    }
    return steer;
  }
  function update(dt){
    if(!state.running||state.paused)return;
    state.elapsed+=dt;state.remaining=Math.max(0,state.remaining-dt);
    tickHeist(state.heist,dt);
    state.vaultLockdown=Math.max(0,state.vaultLockdown-dt);
    state.relay.cooldown=Math.max(0,state.relay.cooldown-dt);
    state.relay.timer-=dt;
    if(state.relay.timer<=0){state.relay.index=(state.relay.index+1)%relay.stations.length;state.relay.timer=23;for(const p of players.filter(p=>p.mpType==='bot'))p.aiDecision=0;}
    state.nextSupplyDrop-=dt;if(state.nextSupplyDrop<=0 && state.remaining>15){dropSupply();state.nextSupplyDrop=34;}
    state.nextSockWave-=dt;if(state.nextSockWave<=0 && state.remaining>14){dropSocks();state.nextSockWave=24;}
    if(!state.finalRush && state.remaining<=20){state.finalRush=true;state.heist.frenzy=Math.max(14,state.heist.frenzy);}
    if(state.decoy){state.decoy.time-=dt;if(state.decoy.time<=0)state.decoy=null;}
    for(const p of players){
      if(!p.active)continue;
      p.damageCooldown=Math.max(0,p.damageCooldown-dt);
      p.abilityCooldown=Math.max(0,p.abilityCooldown-dt);
      p.invisible=Math.max(0,p.invisible-dt);
      p.boostTimer=Math.max(0,p.boostTimer-dt);
      const isBot=p.mpType==='bot';
      // Hiding must never swallow the player's next HIDE action.
      // Process real player commands BEFORE the hidden-state early return.
      if(!isBot){
        const actions=p.pending.splice(0,4);
        for(const action of actions){if(action==='hide')toggleHide(p);else if(action==='ability'&&!p.hidden)ability(p);else if(action==='use'&&!p.hidden)use(p);else if(action==='stash'&&!p.hidden)stash(p);}
      }
      if(p.hidden){p.prevX=p.x;p.prevY=p.y;p.hideTimer+=dt;
        if(p.hideTimer>4.5)p.hideNoise=true;
        if(isBot && p.hideTimer>2.2)toggleHide(p);
        continue;}
      const controls=isBot?botInput(p,dt):state.elapsed-p.lastInputAt>1 ? NO_INPUT:p.input;
      if(!(isBot && nav.advance(p,dt)))physics(p,controls,dt,isBot?speedFactor:1);
      floorSafety(p);
      if(isBot && p._navTransit && !Number.isFinite(p.x)){p._navTransit=null;}
      for(const hazard of level.hazards||[])if(hit(p,{x:hazard.x,y:hazard.y-4,w:hazard.w,h:hazard.h+8},5))damage(p);
      if(!p.active)continue;
      const actor={x:p.x-10,y:p.y-10,w:p.w+20,h:p.h+20};
      for(const it of items){if(it.collected)continue;if(hit(actor,{x:it.x-20,y:it.y-20,w:40,h:40}))pickup(p,it);}
      if(p.cargo>=2 && p.mpType==='bot' && Math.abs(centerX(p)-relay.stations[relay.index].x)<68 && Math.abs(centerY(p)-relay.stations[relay.index].y)<77)use(p);
    }
    guard.mpDisengageV12=Math.max(0,(guard.mpDisengageV12||0)-dt);
    if(guard.stunned>0){guard.stunned=Math.max(0,guard.stunned-dt);}else{
      let target=state.decoy?{x:state.decoy.x,y:state.decoy.y,w:0,h:0}:players.filter(p=>p.active&&!p.hidden&&p.invisible<=0)
        .sort((a,b)=>dist(a,guard)-dist(b,guard))[0];
      if(guard.mpDisengageV12<=0 && target && dist(target,guard)<310 && Math.abs(centerY(target)-centerY(guard))<175){guard.mode='chase';guard.lastSeenX=centerX(target);guard.lastSeenY=centerY(target);guard.mpMemory=3.4;}
      else {guard.mpMemory-=dt;if(guard.mpMemory<=0)guard.mode='patrol';}
      guard.mpPatrolTimer-=dt;
      if(guard.mpPatrolTimer<=0){guard.mpPatrolX=guard.x<GAME.width/2?GAME.width-110:110;guard.mpPatrolTimer=5;}
      const goal=guard.mode==='chase'?{x:guard.lastSeenX,y:guard.lastSeenY}:{x:guard.mpPatrolX,y:level.floorY-25};
      const steer=nav.steer(guard,goal,dt);
      if(!nav.advance(guard,dt))physics(guard,steer,dt,(guard.mode==='chase'?.85:.55)*(state.heist.frenzy>0?1.2:1));
      // Draco uses the same progress watchdog as the thieves, so a stale
      // unreachable target cannot leave the entire chase motionless.
      guard.aiWatch=(guard.aiWatch||0)+dt;
      if(guard.aiWatch>=1.05){
        const priorX=Number.isFinite(guard.aiWatchX)?guard.aiWatchX:guard.x;
        const priorY=Number.isFinite(guard.aiWatchY)?guard.aiWatchY:guard.y;
        const moved=Math.hypot(guard.x-priorX,guard.y-priorY);
        const far=Math.hypot(centerX(guard)-goal.x,centerY(guard)-goal.y)>35 || guard.mode==='chase';
        guard.aiWatchX=guard.x;guard.aiWatchY=guard.y;guard.aiWatch=0;
        guard.aiStall=far && moved<8 ? (guard.aiStall||0)+1 : 0;
        if(guard.aiStall>=2){
          guard.aiStall=0;guard.aiRecover=(guard.aiRecover||0)+1;
          guard._navTransit=null;guard.navSurface=undefined;guard._navFallback=null;
          guard.climbing=false;guard.mode='patrol';guard.mpMemory=0;
          guard.mpDisengageV12=3.4;
          const dir=guard.x<GAME.width/2 ? 1 : -1;
          guard.mpPatrolX=clamp(guard.x+dir*400,80,GAME.width-80);
          guard.mpPatrolTimer=4;
          if(!nav.recover(guard,guard.aiRecover)){
            guard.face=dir;guard.vx=dir*120;
            if(guard.onGround)guard.jumpBuffer=.17;
          }
        }
      }
    }
    for(const p of players){if(!p.active||p.damageCooldown>0||p.invisible>0)continue;
      if(p.hidden){if(p.hideNoise&&dist(p,guard)<75)damage(p);}
      else if(dist(p,guard)<55 && hit(p,guard,3)){damage(p);guard.mode='search';guard.mpMemory=0;guard.mpPatrolTimer=0;}
    }
    if(players.every(p=>!p.active))finish('Draco caught everybody.');
    else if(players.filter(p=>p.active).length===1 && !state.lastThiefWarned && state.elapsed>=25){
      state.lastThiefWarned=true;state.remaining=Math.min(state.remaining,16);notice('LAST THIEF STANDING!');
    }
    if(state.remaining<=0)finish('Time is up.');
    for(const p of [...players,guard]){
      if(!Number.isFinite(p.x)||!Number.isFinite(p.y)||!Number.isFinite(p.vx)||!Number.isFinite(p.vy)){
        const [x,y]=p.id==='draco'?level.playerSpawn.guard:level.playerSpawn.thief;
        p.x=x;p.y=y;p.vx=0;p.vy=0;p._navTransit=null;p.navSurface=undefined;
      }
    }
    // Compact expired items to prevent unbounded snapshot and bot-search growth.
    if(items.length>MAX_ITEMS){const kept=items.filter(i=>!i.collected);items.splice(0,items.length,...kept.slice(-MAX_ITEMS));}
  }
  function finish(reason){
    if(!state.running)return;
    state.running=false;state.reason=reason;
    const eligible=players.some(p=>p.active)?players.filter(p=>p.active):players;
    const ranked=[...eligible].sort((a,b)=>b.points-a.points||b.tools-a.tools);
    state.winner=ranked[0]?.mpIndex??null;
    notice(`Heist over: ${reason}`);
  }
  function snapshot(){
    const entity=(p)=>{
      const out={};
      for(const key of ['id','x','y','prevX','prevY','w','h','vx','vy','face','onGround','climbing','active','stunned',
        'landSquash','coyote','jumpBuffer','mode','suspicion','pulse','animDistance','idlePhase','ledgePull','hidden','hideTimer',
        'hideNoise','hideSpot','invisible','boostTimer','damageCooldown','mpIndex','mpType','displayName','points','lives','energy','tools',
        'loot','cargo','relayDeliveries','protectedPoints','stashes','contractWins','contractCounters','abilityCooldown','mpComboCountV4','remoteSlot'])
        if(p[key]!==undefined)out[key]=p[key];
      return out;
    };
    return {levelIndex,elapsed:short(state.elapsed),remaining:short(state.remaining),players:players.map(entity),
      enemies:[entity(guard)],items:items.filter(i=>!i.collected).map(i=>({...i})),vaults,relay,heist:state.heist,
      nextSupplyDrop:short(state.nextSupplyDrop),nextSockWave:short(state.nextSockWave),vaultLockdown:short(state.vaultLockdown),
      finalRush:state.finalRush,collected:state.collected,noise:state.noise,decoy:state.decoy,
      hidden:false,hiddenSpot:null,particles:[],running:state.running,reason:state.reason,winner:state.winner,
      events:[...events]};
  }
  function setDisconnected(slot,offline){const p=players.find(p=>p.remoteSlot===slot);if(!p)return; p.mpType=offline?'bot':'remote';
    p.input={...NO_INPUT};p.pending=[];p.aiDecision=0;p.aiGoal=null;p._navTransit=null;p.navSurface=undefined;}
  return {state,input,update,snapshot,setDisconnected,notice};
}
