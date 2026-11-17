// The Sock Heist — geometry-aware navigation for platform-game bots.
// Uses the same floors, furniture and climbable objects as human players.
// No permanent flight and no automatic repeated jumping.
const limit = (v, a, b) => Math.max(a, Math.min(b, v));
const midpoint = (s) => s.x + s.w / 2;

export function createNavigator(level, width = 1280) {
  const surfaces = level.surfaces;
  const graph = surfaces.map(() => []);

  function add(a, b, type, xA, xB, cost) {
    if (a === b) return;
    graph[a].push({ from: a, to: b, type, xA, xB, cost });
  }
  function range(s, actorWidth = 38) {
    const pad = s.type === 'floor' ? 10 : Math.min(23, Math.max(10, s.w * .14));
    return [s.x + pad, Math.max(s.x + pad, s.x + s.w - actorWidth - pad)];
  }
  function anchor(s, cx, aw = 38) {
    const [a, b] = range(s, aw);
    return limit(cx - aw / 2, a, b);
  }
  // A climb is a real ladder/fabric/handle and joins only platforms
  // whose walkable faces overlap the climb's physical vertical span.
  for (const ladder of level.climbs) {
    const near = surfaces.map((s, i) => ({ s, i }))
      .filter(({ s }) => s.y >= ladder.y - 38 && s.y <= ladder.y + ladder.h + 25 &&
        s.x < ladder.x + ladder.w + 16 && s.x + s.w > ladder.x - 16)
      .sort((a, b) => a.s.y - b.s.y);
    for (let i = 0; i < near.length; i++) {
      for (let j = i + 1; j < near.length; j++) {
        const up = near[i], down = near[j];
        const ax = ladder.x + ladder.w / 2;
        const rise = down.s.y - up.s.y;
        if (rise < 8 || rise > ladder.h + 35) continue;
        const penalty = 80 + rise * .5 + (j - i - 1) * 50;
        add(down.i, up.i, 'climb-up', anchor(down.s, ax), anchor(up.s, ax), penalty);
        add(up.i, down.i, 'climb-down', anchor(up.s, ax), anchor(down.s, ax), penalty);
      }
    }
  }

  // Bounded platform-to-platform jumps and drops. Prefer ladders where
  // possible; no teleportation is involved.
  for (let a = 0; a < surfaces.length; a++) {
    for (let b = 0; b < surfaces.length; b++) {
      if (a === b) continue;
      const from = surfaces[a], to = surfaces[b];
      const gap = Math.max(0, to.x - (from.x + from.w), from.x - (to.x + to.w));
      const height = from.y - to.y;
      if (height > 8 && height < 82 && gap < 118) {
        const xFrom = to.x > from.x + from.w ? from.x + from.w - 24 :
                      to.x + to.w < from.x ? from.x + 14 : midpoint(to);
        const xTo = from.x + from.w < to.x ? to.x + 18 :
                    from.x > to.x + to.w ? to.x + to.w - 20 : midpoint(to);
        add(a, b, 'jump', anchor(from, xFrom), anchor(to, xTo), 230 + gap * 1.9 + height);
      } else if (height < -14 && height > -310 && gap < 145) {
        // Only connect drops at a walkable edge. Long falls are costly.
        const toRight = midpoint(to) > midpoint(from);
        const edgeX = toRight ? from.x + from.w - 9 : from.x + 9;
        const landX = toRight ? to.x + 15 : to.x + to.w - 15;
        add(a, b, 'drop', anchor(from, edgeX), anchor(to, landX), 255 + gap * 1.7 + Math.abs(height) * .35);
      }
    }
  }

  function surfaceAt(x, feet, tolerance = 25) {
    const matches = surfaces.map((s, i) => ({s,i}))
      .filter(({s}) => x >= s.x - 6 && x <= s.x + s.w + 6 && Math.abs(feet - s.y) <= tolerance)
      .sort((a,b) => Math.abs(feet-a.s.y) - Math.abs(feet-b.s.y));
    return matches.length ? matches[0].i : -1;
  }
  function itemSurface(item) {
    // Loot normally floats roughly 22–35 pixels above its supporting surface.
    const guess = item.y + 28;
    const ranked = surfaces.map((s,i) => {
      const dx = Math.max(0, s.x - item.x, item.x - (s.x+s.w));
      const dy = Math.abs(s.y - guess);
      return {i,cost:dy + dx*1.1 + (s.y < item.y - 10 ? 250 : 0)};
    }).sort((a,b) => a.cost-b.cost);
    return ranked[0]?.i ?? 0;
  }
  function actorSurface(actor) {
    const cx = actor.x + actor.w/2, feet=actor.y+actor.h;
    const exact = surfaceAt(cx, feet, 20);
    if (exact >= 0) { actor.navSurface = exact; return exact; }
    // During an ascent or drop, keep the last stable platform until landing.
    if (actor.navSurface !== undefined && actor.navSurface >= 0) return actor.navSurface;
    const next = surfaces.map((s,i)=>({i,score:Math.abs(s.y-feet)+Math.max(0,s.x-cx,cx-(s.x+s.w))*1.5}))
      .sort((a,b)=>a.score-b.score)[0];
    return next?.i ?? 0;
  }
  function route(start, target, actorX, goalX) {
    if (start === target) return [];
    const distances = surfaces.map(() => Infinity);
    const routes = surfaces.map(()=>null);
    const seen=new Set();
    distances[start]=0;
    const queue = [{i:start,x:actorX,cost:0}];
    while(queue.length){
      queue.sort((a,b)=>a.cost-b.cost);
      const curr=queue.shift();
      if(seen.has(curr.i))continue;
      seen.add(curr.i);
      if(curr.i===target)break;
      for(const edge of graph[curr.i]){
        const extra=Math.abs(edge.xA - curr.x)*.7 + edge.cost;
        const cost=curr.cost+extra;
        if(cost < distances[edge.to]){
          distances[edge.to]=cost;
          routes[edge.to]={prior:curr.i, edge};
          queue.push({i:edge.to,x:edge.xB,cost});
        }
      }
    }
    if(!Number.isFinite(distances[target])) return null;
    const chain=[];
    let cursor=target;
    while(cursor!==start){
      const step=routes[cursor];
      if(!step) return null;
      chain.unshift(step.edge);
      cursor=step.prior;
    }
    return chain;
  }

  function estimate(actor, target) {
    const from=actorSurface(actor), to=itemSurface(target);
    const path=route(from,to,actor.x+actor.w/2,target.x);
    if(path === null) return Infinity;
    let currentX=actor.x+actor.w/2, cost=0;
    for(const edge of path){ cost+=Math.abs(edge.xA-currentX)+edge.cost; currentX=edge.xB; }
    cost+=Math.abs(target.x-currentX)+Math.abs(target.y+28-surfaces[to].y)*.65;
    return cost;
  }

  // The AI uses a visible, continuous traversal animation to negotiate
  // authored ladders, jumps and drops. It never teleports to a pickup.
  // This avoids the original physics engine's single-player ladder-entry
  // edge cases that trapped bots under furniture.
  function advance(actor, dt) {
    const transit = actor._navTransit;
    if (!transit) return false;
    const target = surfaces[transit.edge?.to];
    const destX = transit.edge?.xB;
    const destY = target?.y - actor.h;
    // A stale graph edge or an interrupted transition must never hold an
    // NPC in a permanent climbing or moving state.
    transit.age = (transit.age || 0) + dt;
    if (!target || !Number.isFinite(destX) || !Number.isFinite(destY) ||
        !Number.isFinite(actor.x) || !Number.isFinite(actor.y) ||
        transit.age > 4.2) {
      actor._navTransit = null;
      actor.navSurface = undefined;
      actor.climbing = false;
      return false;
    }
    actor.prevX = actor.x;
    actor.prevY = actor.y;
    actor.onGround = false;
    actor.climbing = transit.edge.type.startsWith('climb');
    actor.vx = 0;
    actor.vy = 0;
    const speed = transit.edge.type.startsWith('climb') ? 195 : 245;
    const toward = (a,b,s) => a < b ? Math.min(a+s,b) : Math.max(a-s,b);
    if (transit.edge.type.startsWith('climb')) {
      const ladderX = transit.edge.ladderX ?? transit.edge.xA;
      if (transit.phase === 0) {
        actor.x = toward(actor.x,ladderX,speed*dt);
        if (Math.abs(actor.x-ladderX)<1.5) transit.phase=1;
      } else if (transit.phase === 1) {
        actor.y = toward(actor.y,destY,155*dt);
        if (Math.abs(actor.y-destY)<1.5) transit.phase=2;
      } else {
        actor.x = toward(actor.x,destX,speed*dt);
        if (Math.abs(actor.x-destX)<1.5) transit.phase=3;
      }
    } else {
      const duration = transit.edge.type === 'jump' ? .8 : .65;
      transit.progress = Math.min(1,transit.progress+dt/duration);
      const t=transit.progress;
      actor.x=transit.startX+(destX-transit.startX)*t;
      actor.y=transit.startY+(destY-transit.startY)*t-
        (transit.edge.type==='jump'?64*Math.sin(Math.PI*t):0);
      if(t>=1)transit.phase=3;
    }
    actor.face=actor.x>=actor.prevX?1:-1;
    actor.animDistance=(actor.animDistance||0)+Math.abs(actor.x-actor.prevX)+
      Math.abs(actor.y-actor.prevY)*.25;
    if(transit.phase===3){
      actor.x=destX;
      actor.y=destY;
      actor.prevX=actor.x;
      actor.prevY=actor.y;
      actor.navSurface=transit.edge.to;
      actor.climbing=false;
      actor.onGround=true;
      actor.ledgePull=.4;
      actor.coyote=.1;
      actor.jumpBuffer=0;
      actor._navTransit=null;
    }
    return true;
  }
  function steer(actor, goal, dt) {
    const idle={left:false,right:false,up:false,down:false,jumpHeld:false};
    if(actor._navTransit || !goal || !Number.isFinite(goal.x) || !Number.isFinite(goal.y)) return idle;
    const current=actorSurface(actor);
    const goalSurface=itemSurface(goal);
    let path=route(current,goalSurface,actor.x+actor.w/2,goal.x);
    let targetX=goal.x;
    if(path === null && current!==goalSurface) {
      // Never walk forever into a wall while trying to reach an isolated
      // platform. Select a connected intermediate platform instead.
      let fallback=actor._navFallback;
      if(!fallback || fallback.from!==current || fallback.to!==goalSurface || fallback.ttl<=0) {
        let choice=null;
        for(let i=0;i<surfaces.length;i++) {
          if(i===current)continue;
          const candidate=route(current,i,actor.x+actor.w/2,goal.x);
          if(!candidate?.length)continue;
          const s=surfaces[i];
          const cost=Math.abs(midpoint(s)-goal.x)+Math.abs(s.y-(goal.y+28))*1.5+candidate.length*30;
          if(!choice || cost<choice.cost)choice={i,cost,path:candidate};
        }
        fallback={from:current,to:goalSurface,path:choice?.path||null,
          waypoint:choice ? midpoint(surfaces[choice.i]) :
            (surfaces[current] ? midpoint(surfaces[current]) : actor.x + actor.w/2),ttl:1};
        actor._navFallback=fallback;
      }
      fallback.ttl-=Math.max(0,dt);
      path=fallback.path;
      if(!path?.length)targetX=fallback.waypoint;
    } else actor._navFallback=null;
    // If we arrive horizontally but stand on a different height, force a
    // fresh surface assessment rather than returning idle forever.
    if(!path?.length && Math.abs(targetX-(actor.x+actor.w/2))<10 &&
       Math.abs((actor.y+actor.h)-surfaces[goalSurface].y)>48) {
      actor.navSurface=undefined;
      const s=surfaces[current];
      if(s)targetX=actor.x+actor.w/2 < midpoint(s) ? s.x+s.w-actor.w-18 : s.x+18;
    }
    if(path?.length){
      const edge=path[0];
      targetX=edge.xA+actor.w/2;
      if(Math.abs(targetX-(actor.x+actor.w/2))<21){
        let ladderX=edge.xA;
        if(edge.type.startsWith('climb')){
          const ladders=level.climbs.filter(l=>
            l.x < surfaces[edge.from].x + surfaces[edge.from].w + 18 &&
            l.x+l.w > surfaces[edge.from].x-18 &&
            l.x < surfaces[edge.to].x + surfaces[edge.to].w + 18 &&
            l.x+l.w > surfaces[edge.to].x-18 &&
            surfaces[edge.from].y>=l.y-38 && surfaces[edge.to].y>=l.y-38 &&
            surfaces[edge.from].y<=l.y+l.h+25 && surfaces[edge.to].y<=l.y+l.h+25);
          const best=ladders.sort((a,b)=>Math.abs(a.x+a.w/2-targetX)-Math.abs(b.x+b.w/2-targetX))[0];
          if(best) ladderX=best.x+best.w/2-actor.w/2;
        }
        actor._navTransit={edge,ladderX,phase:0,progress:0,startX:actor.x,startY:actor.y};
        return idle;
      }
    }
    const cx=actor.x+actor.w/2;
    return {left:targetX<cx-9,right:targetX>cx+9,up:false,down:false,jumpHeld:false};
  }
  // A bot that has been physically blocked may traverse an alternate connection
  // from its last stable platform. The crossing remains visible in the world.
  function recover(actor, attempt = 0) {
    if (!actor || !Number.isFinite(actor.x) || !Number.isFinite(actor.y)) return false;
    actor._navTransit = null;
    actor.navSurface = undefined;
    actor._navFallback = null;
    const from = actorSurface(actor);
    const edges = (graph[from] || []).filter(edge =>
      edge && surfaces[edge.to] && Number.isFinite(edge.xB) && Number.isFinite(edge.cost)
    );
    if (!edges.length) return false;
    const edge = edges[Math.abs(attempt) % edges.length];
    actor._navTransit = {
      edge, ladderX: edge.xA, phase: 0, progress: 0,
      startX: actor.x, startY: actor.y
    };
    return true;
  }
  return { steer, advance, recover, estimate, itemSurface, actorSurface, route, graph };
}
