// THE SOCK HEIST: HEIST RUSH
// Optional Eurogame-inspired contracts, resource stashes and shared alarm.

export function createHeistMode() {
  return {
    heat: 0,
    frenzy: 0,
    cooldown: 0,
    contracts: [
      { id: 'socks', name: 'SOCK SPRINT', goal: 3, reward: 5, owner: null },
      { id: 'tools', name: 'SUPPLY RUN', goal: 2, reward: 4, owner: null },
      { id: 'gold', name: 'GOLD RUSH', goal: 1, reward: 4, owner: null },
      { id: 'vault', name: 'JACKPOT STARTER', goal: 1, reward: 3, owner: null },
      { id: 'combo', name: 'QUICK SWAP', goal: 1, reward: 4, owner: null },
      { id: 'relay', name: 'FIRST DELIVERY', goal: 1, reward: 5, owner: null }
    ]
  };
}

function maybeStartFrenzy(mode) {
  if (!mode || mode.heat < 100 || mode.frenzy > 0 || mode.cooldown > 0) return false;
  mode.heat = 10;
  mode.frenzy = 9;
  mode.cooldown = 23;
  return true;
}

export function tickHeist(mode, dt) {
  if (!mode) return;
  mode.frenzy = Math.max(0, mode.frenzy - dt);
  mode.cooldown = Math.max(0, mode.cooldown - dt);
  if (mode.frenzy <= 0) mode.heat = Math.max(0, mode.heat - dt * .3);
  maybeStartFrenzy(mode);
}

export function recordHeistPickup(mode, player, item) {
  if (!mode || !player) return '';
  const isSock = item.kind === 'sock' || item.premium;
  player.contractCounters ??= { socks: 0, tools: 0, gold: 0 };
  if (isSock) player.contractCounters.socks++;
  if (item.premium) player.contractCounters.gold++;
  if (!isSock) player.contractCounters.tools++;

  const celebrations = [];
  // During a shared alarm, stealing becomes more valuable but Draco is faster.
  if (mode.frenzy > 0) {
    const bonus = item.premium ? 2 : 1;
    player.points += bonus;
    celebrations.push('ALARM BONUS +' + bonus);
  }
  for (const contract of mode.contracts) {
    if (contract.owner === null && player.contractCounters[contract.id] >= contract.goal) {
      contract.owner = player.mpIndex;
      player.points += contract.reward;
      player.contractWins = (player.contractWins || 0) + 1;
      celebrations.push(contract.name + ' +' + contract.reward + ' HP!');
    }
  }
  mode.heat = Math.min(100, mode.heat + (item.premium ? 23 : isSock ? 15 : 10));
  if (maybeStartFrenzy(mode)) celebrations.push('DRACO ALERT! 9 SEC!');
  return celebrations.join('  ');
}

export function recordHeistVault(mode, player=null) {
  if(!mode)return false;
  if(player) {
    player.contractCounters ??= {};
    player.contractCounters.vault=(player.contractCounters.vault||0)+1;
    const contract=mode.contracts.find(c=>c.id==='vault');
    if(contract && contract.owner===null) {
      contract.owner=player.mpIndex;
      player.points+=contract.reward;
      player.contractWins=(player.contractWins||0)+1;
    }
  }
  mode.heat=Math.min(100,mode.heat+28);
  return maybeStartFrenzy(mode);
}

export function recordHeistCombo(mode, player) {
  if(!mode||!player)return false;
  player.contractCounters ??= {};
  player.contractCounters.combo=(player.contractCounters.combo||0)+1;
  const contract=mode.contracts.find(c=>c.id==='combo');
  if(!contract||contract.owner!==null)return false;
  contract.owner=player.mpIndex;
  player.points+=contract.reward;
  player.contractWins=(player.contractWins||0)+1;
  return true;
}

// First delivery is a contested, one-time contract. Deliveries also raise heat,
// so banking points has a shared risk for every thief in the room.
export function recordHeistRelay(mode, player) {
  if (!mode || !player) return '';
  player.contractCounters ??= {};
  player.contractCounters.relay = (player.contractCounters.relay || 0) + 1;
  let message = '';
  const contract = mode.contracts.find(c => c.id === 'relay');
  if (contract && contract.owner === null) {
    contract.owner = player.mpIndex;
    player.points += contract.reward;
    player.contractWins = (player.contractWins || 0) + 1;
    message = 'FIRST DELIVERY CONTRACT +' + contract.reward + '!';
  }
  mode.heat = Math.min(100, mode.heat + 18);
  if (maybeStartFrenzy(mode)) message += ' DRACO ALERT!';
  return message;
}

export function recordHeistAbility(mode) {
  if (!mode) return false;
  mode.heat = Math.min(100, mode.heat + 12);
  return maybeStartFrenzy(mode);
}

// Stashing is a meaningful alternative to saving tools for golden socks.
// Each stash costs one Tool, secures 3 current points, and grants 2 bonus points.
export function tryStash(player) {
  if (!player || player.tools < 1 || (player.stashes || 0) >= 2) return false;
  const unprotected = player.points - (player.protectedPoints || 0);
  if (unprotected < 3) return false;
  player.tools--;
  player.stashes = (player.stashes || 0) + 1;
  player.points += 2;
  player.protectedPoints = (player.protectedPoints || 0) + 5;
  return true;
}

export function contractPreference(mode, player, item) {
  if (!mode || !player) return 0;
  const counters = player.contractCounters || { socks: 0, tools: 0, gold: 0 };
  let value = 0;
  for (const contract of mode.contracts) {
    if (contract.owner !== null) continue;
    const relevant = contract.id === 'gold' ? Boolean(item.premium)
      : contract.id === 'socks' ? (item.kind === 'sock' || item.premium)
      : (item.kind !== 'sock' && !item.premium);
    if (contract.id !== 'relay' && relevant) value += (counters[contract.id] + 1 >= contract.goal) ? 80 : 36;
  }
  return value;
}

export function drawHeistOverlay(ctx, mode, players, width, vaults = [], supplyTimer = 0) {
  if (!mode) return;
  const x = width - 340, y = 78, w = 322, h = 194;
  ctx.save();
  ctx.fillStyle = 'rgba(5, 13, 27, 0.9)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = mode.frenzy > 0 ? '#ff6868' : 'rgba(250,189,98,.58)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.font = '900 15px system-ui';
  ctx.fillStyle = mode.frenzy > 0 ? '#ff8a8a' : '#ffc174';
  ctx.textAlign = 'left';
  ctx.fillText(mode.frenzy > 0 ? 'DRACO ALERT - ' + Math.ceil(mode.frenzy) + 's' : 'HEIST CONTRACTS', x + 12, y + 22);
  ctx.font = '12px system-ui';
  mode.contracts.forEach((contract, index) => {
    ctx.fillStyle = contract.owner === null ? '#eaf0f8' : '#85e3bb';
    const owner = players.find(p => p.mpIndex === contract.owner);
    const suffix = owner ? ' - ' + owner.displayName : '  +' + contract.reward + ' HP';
    ctx.fillText((owner ? '✓ ' : '○ ') + contract.name + suffix, x + 13, y + 49 + index * 23);
  });
  ctx.fillStyle = '#9fb3c8';
  ctx.fillText('SHARED ALARM', x + 12, y + 129);
  ctx.fillStyle = '#2d4356';
  ctx.fillRect(x + 117, y + 118, w - 130, 12);
  ctx.fillStyle = mode.frenzy > 0 ? '#ff626c' : '#ffb34d';
  ctx.fillRect(x + 117, y + 118, (w - 130) * mode.heat / 100, 12);
  ctx.font = '11px system-ui';
  ctx.fillStyle = '#bdcce0';
  const opened=vaults.filter(v=>v.owner!==null).length;
  ctx.fillStyle='#ffe3a3';
  ctx.fillText('JACKPOTS FIRED '+opened+'/'+vaults.length+' · COST 2 TOOLS',x+12,y+152);
  ctx.fillStyle='#a9dfe1';
  ctx.fillText('NEXT SUPPLY: '+Math.max(0,Math.ceil(supplyTimer))+'s',x+12,y+170);
  ctx.fillStyle='#bdcce0';
  ctx.fillText('F/G/RB = vault  ·  R/Y/gamepad Y = stash', x + 12, y + 185);
  ctx.restore();
}
