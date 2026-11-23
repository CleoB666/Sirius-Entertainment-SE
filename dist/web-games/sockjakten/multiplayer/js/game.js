import { GAME, CHARACTERS, CHARACTER_ORDER, THIEF_IDS, CONTROLS, ITEM_LABELS } from "./config.js";
import { createOnlineClient } from "./online-client.js";
import { LEVELS } from "./levels.js";
import { createNavigator } from "./ai-navigation.js";
import { createHeistMode, tickHeist, recordHeistPickup, recordHeistCombo, recordHeistRelay, recordHeistAbility, recordHeistVault, tryStash, contractPreference, drawHeistOverlay } from "./heist-mode.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, amount) => a + (b - a) * amount;
const moveToward = (value, target, amount) => value < target ? Math.min(value + amount, target) : Math.max(value - amount, target);
const distance = (a, b) => Math.hypot((a.x + (a.w || 0) / 2) - (b.x + (b.w || 0) / 2), (a.y + (a.h || 0) / 2) - (b.y + (b.h || 0) / 2));
const overlaps = (a, b, padding = 0) =>
  a.x + padding < b.x + b.w && a.x + a.w - padding > b.x &&
  a.y + padding < b.y + b.h && a.y + a.h - padding > b.y;

const canvas = $("#gameCanvas");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = true;
ctx.imageSmoothingQuality = "high";
const themeAudio = $("#themeAudio");
const ambienceAudio = $("#ambienceAudio");
const coarsePointer = window.matchMedia("(pointer: coarse)");
const AMBIENCE_LOOP_ENDS = new Map([
  ["assets/AmbienceTTHCBedroom.mp3", 33.24],
  ["assets/AmbienceTTHCLivingroom.mp3", 33.27],
]);

const screens = {
  loading: $("#loadingScreen"), start: $("#startScreen"), select: $("#selectScreen"),
  levels: $("#levelScreen"), briefing: $("#briefingScreen"), pause: $("#pauseScreen"), result: $("#resultScreen"),
};

const dom = {
  hud: $("#hud"), level: $("#hudLevel"), place: $("#hudPlace"), role: $("#hudRole"),
  objective: $("#hudObjective"), progress: $("#objectiveProgress"), time: $("#hudTime"), hearts: $("#hudHearts"),
  abilityName: $("#abilityName"), abilityState: $("#abilityState"), abilityFill: $("#abilityFill"),
  stealth: $("#stealthHud"), stealthIcon: $("#stealthIcon"), stealthState: $("#stealthState"),
  stealthTip: $("#stealthTip"), stealthFill: $("#stealthFill"), hint: $("#gameHint"),
  characterGrid: $("#characterGrid"), levelGrid: $("#levelGrid"), startCast: $("#startCast"),
  touch: $("#touchControls"), rules: $("#rulesModal"),
};

const state = {
  screen: "loading", running: false, paused: false, pauseBeforeRules: false,
  selectedId: "clawster", levelIndex: 0, level: null, player: null, mpPlayers: [], heist: null, enemies: [], items: [], particles: [], dust: [],
  elapsed: 0, remaining: 0, collected: 0, caught: 0, hearts: 3, abilityCooldown: 0, abilityUses: 0,
  slowTimer: 0, invisibleTimer: 0, glideTimer: 0, damageCooldown: 0,
  hidden: false, hiddenSpot: null, hideTimer: 0, hideNoise: false,
  decoy: null, noise: null, footstepTimer: 0, hintTimer: 0, currentHint: -1,
  jumpBuffer: 0, coyote: 0, muted: false,
};

// MP_KEYMAPS_V4: each player owns a unique, non-overlapping keyboard cluster.
const MP_KEYMAPS_V4 = [
  {left:'KeyA',right:'KeyD',up:'KeyW',down:'KeyS',hide:'KeyQ',ability:'KeyE',vault:'KeyZ',stash:'KeyX'},
  {left:'KeyF',right:'KeyH',up:'KeyT',down:'KeyG',hide:'KeyR',ability:'KeyY',vault:'KeyV',stash:'KeyB'},
  {left:'KeyJ',right:'KeyL',up:'KeyI',down:'KeyK',hide:'KeyU',ability:'KeyO',vault:'KeyN',stash:'Comma'},
  {left:'ArrowLeft',right:'ArrowRight',up:'ArrowUp',down:'ArrowDown',hide:'ShiftRight',ability:'ControlRight',vault:'Enter',stash:'Backspace'}
];
const MP_ALL_KEYS_V4 = new Set(MP_KEYMAPS_V4.flatMap(map=>Object.values(map)));
function mpKeyLegendV4(n){const map=MP_KEYMAPS_V4[n];return 'P'+(n+1)+': '+[map.left,map.right,map.up,map.down,map.hide,map.ability,map.vault,map.stash].map(s=>s.replace(/^Key/,'').replace(/^Arrow/,'').replace(/Right$/,' Rt')).join(' / ')+(n===0?' · Space: Jump':'')}

const keys = new Set();
const touchKeys = new Set();
let mpNavigator = null;
const sprites = new Map();
const portraits = new Map();
const rooms = new Map();
let lastFrame = performance.now();
let accumulator = 0;
const MP_FRAME_STEP_V4 = 1 / 60;
let mpRuntimeErrorV4 = false;
let mpLastOnlineSnapshot = 0;
const MP_SNAPSHOT_INTERVAL = 70;
function mpSafePosition(entity, start, name) {
  if (!entity || !entity.active) return;
  const invalid = !Number.isFinite(entity.x) || !Number.isFinite(entity.y) ||
    !Number.isFinite(entity.vx) || !Number.isFinite(entity.vy) ||
    Math.abs(entity.x) > GAME.width * 3 || Math.abs(entity.y) > GAME.height * 3;
  if (invalid) {
    console.warn('[TTHC] Recovered invalid coordinates for', name, { x: entity.x, y: entity.y });
    entity.x = clamp(start[0], 0, GAME.width - entity.w);
    entity.y = start[1]; entity.prevX = entity.x; entity.prevY = entity.y;
    entity.vx = 0; entity.vy = 0; entity.hidden = false; entity.invisible = 0;
    entity.climbing = false; entity.onGround = false; entity._navTransit = null;
    entity.aiTarget = -1; entity.aiDecision = 0; entity.aiScoutGoal = null;
    entity.navSurface = undefined;
  }
}
function mpValidateWorld() {
  if (!state.level) return;
  const start = state.level.playerSpawn.thief;
  for (const p of state.mpPlayers) mpSafePosition(p, [start[0] + p.mpIndex * 52, start[1]], p.displayName);
  for (const guard of state.enemies) mpSafePosition(guard, state.level.playerSpawn.guard, 'Draco');
}


function showScreen(name) {
  Object.entries(screens).forEach(([key, screen]) => screen.classList.toggle("active", key === name));
  state.screen = name;
  syncAudioForContext();
}

function setGameChrome(visible) {
  dom.hud.classList.toggle("hidden", !visible);
  document.body.classList.toggle('mp-playing', visible);
  $('#heistDashboard')?.classList.toggle('hidden', !visible);
  dom.touch.classList.toggle("hidden", !visible);
  dom.touch.classList.toggle("guard-mode", state.selectedId === "draco");
  if (!visible) dom.hint.classList.add("hidden");
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load ${src}`));
    image.src = src;
  });
}

function prepareCutout(image) {
  const work = document.createElement("canvas");
  work.width = image.naturalWidth || image.width; work.height = image.naturalHeight || image.height;
  const workCtx = work.getContext("2d", { willReadFrequently: true });
  workCtx.drawImage(image, 0, 0);
  const pixels = workCtx.getImageData(0, 0, work.width, work.height);
  const data = pixels.data; const width = work.width; const height = work.height;
  let sampleR = 0; let sampleG = 0; let sampleB = 0; let sampleCount = 0;
  for (let y = 0; y < height; y += 12) {
    for (const x of [2, width - 3]) { const i = (y * width + x) * 4; sampleR += data[i]; sampleG += data[i + 1]; sampleB += data[i + 2]; sampleCount += 1; }
  }
  for (let x = 0; x < width; x += 12) {
    for (const y of [2, height - 3]) { const i = (y * width + x) * 4; sampleR += data[i]; sampleG += data[i + 1]; sampleB += data[i + 2]; sampleCount += 1; }
  }
  sampleR /= sampleCount; sampleG /= sampleCount; sampleB /= sampleCount;
  const isBackground = (index) => {
    const i = index * 4;
    if (data[i + 3] < 18) return true;
    const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
    const saturation = Math.max(r, g, b) - Math.min(r, g, b);
    const light = (r + g + b) / 3;
    const delta = Math.hypot(r - sampleR, g - sampleG, b - sampleB);
    // Keep pale wings, grey fur and thin limbs intact. Only pixels connected to
    // an edge and very close to the backdrop are removed.
    return (delta < 36 && saturation < 48) || (saturation < 17 && light > 205);
  };
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0; let tail = 0;
  const enqueue = (index) => {
    if (visited[index] || !isBackground(index)) return;
    visited[index] = 1; queue[tail++] = index;
  };
  for (let x = 0; x < width; x += 1) { enqueue(x); enqueue((height - 1) * width + x); }
  for (let y = 0; y < height; y += 1) { enqueue(y * width); enqueue(y * width + width - 1); }
  while (head < tail) {
    const index = queue[head++]; const x = index % width; const y = (index / width) | 0;
    if (x > 0) enqueue(index - 1); if (x < width - 1) enqueue(index + 1);
    if (y > 0) enqueue(index - width); if (y < height - 1) enqueue(index + width);
  }
  let minX = width; let minY = height; let maxX = 0; let maxY = 0;
  for (let index = 0; index < visited.length; index += 1) {
    const i = index * 4;
    if (visited[index]) data[i + 3] = 0;
    if (data[i + 3] > 24) {
      const x = index % width; const y = (index / width) | 0;
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
  }
  workCtx.putImageData(pixels, 0, 0);
  if (minX > maxX || minY > maxY) return work;
  const padding = 13;
  minX = clamp(minX - padding, 0, width - 1); minY = clamp(minY - padding, 0, height - 1);
  maxX = clamp(maxX + padding, 1, width); maxY = clamp(maxY + padding, 1, height);
  const cutout = document.createElement("canvas");
  cutout.width = Math.max(1, maxX - minX); cutout.height = Math.max(1, maxY - minY);
  cutout.getContext("2d").drawImage(work, minX, minY, cutout.width, cutout.height, 0, 0, cutout.width, cutout.height);
  return cutout;
}

function prepareAnimationFrames(image) {
  const columns = 3; const rows = 2;
  const cellWidth = Math.floor(image.naturalWidth / columns);
  const cellHeight = Math.floor(image.naturalHeight / rows);
  return Array.from({ length: columns * rows }, (_, index) => {
    const cell = document.createElement("canvas");
    cell.width = cellWidth; cell.height = cellHeight;
    const column = index % columns; const row = Math.floor(index / columns);
    cell.getContext("2d").drawImage(
      image,
      column * cellWidth, row * cellHeight, cellWidth, cellHeight,
      0, 0, cellWidth, cellHeight,
    );
    return prepareCutout(cell);
  });
}

async function loadAssets() {
  const fill = $("#loadingFill");
  const tasks = [
    ...CHARACTER_ORDER.map((id) => ({ type: "character", id, src: CHARACTERS[id].motionAsset })),
    ...CHARACTER_ORDER.map((id) => ({ type: "portrait", id, src: CHARACTERS[id].portraitAsset })),
    ...LEVELS.map((level) => ({ type: "room", id: level.id, src: level.background })),
  ];
  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index]; const image = await loadImage(task.src);
    if (task.type === "character") sprites.set(task.id, prepareAnimationFrames(image));
    else if (task.type === "portrait") portraits.set(task.id, image);
    else rooms.set(task.id, image);
    fill.style.width = `${8 + ((index + 1) / tasks.length) * 92}%`;
    await new Promise(requestAnimationFrame);
  }
  buildMenus();
  setTimeout(() => showScreen(new URLSearchParams(location.search).has("room") ? "select" : "start"), 180);
}

function makeCharacterPortrait(id) {
  const portrait = document.createElement("div"); portrait.className = "character-portrait";
  const image = portraits.get(id).cloneNode(); image.src = CHARACTERS[id].portraitAsset;
  image.alt = `${CHARACTERS[id].name}, full character`;
  portrait.append(image);
  return portrait;
}

// Shared start-menu easter egg. Only runs on the intro screen.
// Positions use the original 1672 x 941 cast illustration; no artwork is replaced.
function setupTongueCast() {
  const mount = dom.startCast;
  mount.textContent = '';
  const cast = document.createElement('img');
  cast.className = 'start-cast-image';
  cast.src = 'assets/crew-cast.png';
  cast.alt = '';
  mount.append(cast);
  // Mouth positions in the original image, left to right plus Draco.
  // Mouth anchors measured on the 1672 × 941 source illustration.
  // Character mapping matters: Lairy is yellow (left); Clawster is orange (far right).
  const mouths = [
    {label:'Strappy',asset:'strappy',x:408/1672,y:622/941,w:15,h:20},
    {label:'Lairy',asset:'lairy',x:603/1672,y:761/941,w:17,h:17},
    {label:'Trasselsudd',asset:'trasselsudd',x:854/1672,y:734/941,w:16,h:18},
    {label:'Gramp',asset:'gramp',x:1114/1672,y:724/941,w:14,h:16},
    {label:'Clawster',asset:'clawster',x:1451/1672,y:686/941,w:16,h:19},
    {label:'Draco',asset:'draco',x:1091/1672,y:210/941,w:12,h:17},
  ];
  const buttons = mouths.map((spot, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cast-tongue';
    button.dataset.character = spot.asset;
    button.setAttribute('aria-label', spot.label + ' is sticking out their tongue! Click for a group reaction.');
    button.title = 'Catch the cheeky tongue!';
    const tongue = document.createElement('img');
    tongue.className = 'cast-tongue-art';
    tongue.src = 'assets/tongues-fit/' + spot.asset + '.png';
    tongue.alt = '';
    tongue.draggable = false;
    tongue.setAttribute('aria-hidden', 'true');
    button.append(tongue);
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!button.classList.contains('is-visible') || !mount.classList.contains('tongue-one')) return;
      const now = performance.now();
      state._tongueAllUntil = now + 2000;
      state._tongueNextAt = now + 12000;
      mount.classList.remove('tongue-one');
      mount.classList.add('tongue-all');
      buttons.forEach(b => b.classList.add('is-visible'));
    });
    mount.append(button);
    return button;
  });
  const layout = () => {
    const w = mount.clientWidth, h = mount.clientHeight;
    if (!w || !h) return;
    const scale = Math.min(w / 1672, h / 941);
    const left = w - 1672 * scale;
    const top = h - 941 * scale;
    mouths.forEach((spot, i) => {
      buttons[i].style.left = Math.round(left + 1672 * scale * spot.x) + 'px';
      buttons[i].style.top = Math.round(top + 941 * scale * spot.y) + 'px';
      const image = buttons[i].querySelector('.cast-tongue-art');
      image.style.width = Math.max(7, Math.round(spot.w * scale)) + 'px';
      image.style.height = Math.max(9, Math.round(spot.h * scale)) + 'px';
      buttons[i].style.width = image.style.width;
      buttons[i].style.height = image.style.height;
    });
  };
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(layout).observe(mount);
  else window.addEventListener('resize', layout);
  cast.addEventListener('load', layout);
  let lastIndex = -1;
  let menuWasVisible = false;
  const resetVisual = () => {
    mount.classList.remove('tongue-one', 'tongue-all');
    buttons.forEach(button => button.classList.remove('is-visible'));
  };
  setInterval(() => {
    const visible = state.screen === 'start' && !document.hidden && dom.rules.classList.contains('hidden');
    const now = performance.now();
    if (!visible) { if (menuWasVisible) resetVisual(); menuWasVisible = false; return; }
    if (!menuWasVisible) { menuWasVisible = true; state._tongueNextAt = now + 10000; state._tongueAllUntil = 0; layout(); }
    if (state._tongueAllUntil > 0) {
      if (now < state._tongueAllUntil) return;
      state._tongueAllUntil = 0;
      resetVisual();
    }
    if (now >= state._tongueNextAt) {
      let index = Math.floor(Math.random() * (lastIndex < 0 ? mouths.length : mouths.length - 1));
      if (index >= lastIndex && lastIndex >= 0) index++;
      lastIndex = index;
      resetVisual();
      mount.classList.add('tongue-one');
      buttons[index].classList.add('is-visible');
      state._tongueNextAt = now + 10000;
      state._tongueOneUntil = now + 2000;
    }
    if (state._tongueOneUntil && now >= state._tongueOneUntil) {
      state._tongueOneUntil = 0;
      if (!state._tongueAllUntil) resetVisual();
    }
  }, 100);
}

// Subtle walkable furniture seams, with a stronger local highlight near any thief.
// Uses the existing room geometry; it does not introduce floating platforms.

// v11: legible climb routes without inserting floating platforms or replacing room art.
function drawSubtleClimbGuides() {
  if (!state.level?.climbs?.length) return;
  const actors = (state.mpPlayers?.length ? state.mpPlayers : [state.player]).filter(p => p?.active !== false && p && !p.hidden);
  ctx.save();
  for (const climb of state.level.climbs) {
    if (![climb.x, climb.y, climb.w, climb.h].every(Number.isFinite) || climb.h < 12) continue;
    const center = climb.x + climb.w/2;
    const near = actors.some(p => {
      const middle=p.x+p.w/2, feet=p.y+p.h;
      const gapY=Math.max(climb.y-feet,0,feet-(climb.y+climb.h));
      return Math.abs(middle-center)<105 && gapY<90;
    });
    const outer = near ? .56 : .20;
    const railX = Math.min(12, Math.max(6, climb.w*.18));
    const left = center-railX, right=center+railX;
    // The rails are light seams against the actual furniture/background.
    ctx.lineCap='round'; ctx.lineWidth=near?2.1:1.3;
    ctx.strokeStyle=`rgba(178,224,226,${outer})`;
    ctx.shadowColor=near?'rgba(124,213,235,.48)':'transparent';ctx.shadowBlur=near?8:0;
    ctx.beginPath();ctx.moveTo(left,climb.y+3);ctx.lineTo(left,climb.y+climb.h-3);
    ctx.moveTo(right,climb.y+3);ctx.lineTo(right,climb.y+climb.h-3);ctx.stroke();
    ctx.shadowBlur=0; ctx.strokeStyle=`rgba(238,231,204,${near?.58:.28})`;
    ctx.lineWidth=near?1.8:1.1;
    for(let y=climb.y+16;y<climb.y+climb.h-8;y+=29){
      ctx.beginPath();ctx.moveTo(left+2,y);ctx.lineTo(right-2,y);ctx.stroke();
    }
    if(near){
      ctx.fillStyle='rgba(202,239,245,.72)';
      ctx.beginPath();ctx.moveTo(center,climb.y+7);ctx.lineTo(center-4,climb.y+13);
      ctx.lineTo(center+4,climb.y+13);ctx.closePath();ctx.fill();
    }
  }
  ctx.restore();
}

function drawFurnitureSeams() {
  if (!state.level) return;
  const actors = state.mpPlayers?.length
    ? state.mpPlayers.filter(p => p.active && !p.hidden)
    : [state.player].filter(Boolean);
  ctx.save();
  for (const surface of state.level.surfaces) {
    if (surface.type === 'floor' || !Number.isFinite(surface.x) || !Number.isFinite(surface.y)) continue;
    const inset = Math.min(22, Math.max(7, surface.w * .09));
    const x = surface.x + inset;
    const width = Math.max(2, surface.w - 2 * inset);
    const near = actors.some(p => {
      const middle = p.x + p.w / 2;
      const gapX = middle < x ? x - middle : middle > x + width ? middle - (x + width) : 0;
      return gapX < 95 && Math.abs(p.y + p.h - surface.y) < 110;
    });
    const glow = near ? .78 + .12 * Math.sin(state.elapsed * 5.2) : .32;
    const sheen = ctx.createLinearGradient(x, surface.y, x + width, surface.y);
    sheen.addColorStop(0, 'rgba(184,221,235,0)');
    sheen.addColorStop(.14, `rgba(189,225,236,${glow * .7})`);
    sheen.addColorStop(.5, `rgba(230,248,252,${glow})`);
    sheen.addColorStop(.86, `rgba(189,225,236,${glow * .7})`);
    sheen.addColorStop(1, 'rgba(184,221,235,0)');
    ctx.fillStyle = 'rgba(5, 17, 24, .18)';
    ctx.fillRect(x, surface.y + 1, width, 2);
    ctx.fillStyle = sheen;
    ctx.fillRect(x, surface.y - (near ? 4 : 2), width, near ? 5 : 3);
    if (near) {
      ctx.strokeStyle = 'rgba(157, 227, 246, .24)';
      ctx.shadowColor = 'rgba(116, 221, 250, .68)';
      ctx.shadowBlur = 11;
      ctx.beginPath(); ctx.moveTo(x + 8, surface.y - 2); ctx.lineTo(x + width - 8, surface.y - 2); ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }
  ctx.restore();
}

function buildMenus() {
  setupTongueCast();
  mpRenderLobby();
  updateRulesContext();
}

function getProgress() { return LEVELS.length; }

function saveProgress(value) {
  try { localStorage.setItem(GAME.saveKey, String(clamp(value, 1, LEVELS.length))); } catch { /* The game remains playable without storage. */ }
}

function difficultyStep() {
  return clamp(state.levelIndex, 0, LEVELS.length - 1);
}

function hideTimeLimit() {
  return 6 - difficultyStep() * .3;
}

function updateRulesContext() {
  const title=$('#rulesTitle');
  if(!title) return;
  title.textContent='HOW TO PLAY · HEIST CIRCUIT';
  if($('#mpRules'))return;
  const section=document.createElement('section');
  section.id='mpRules';section.className='mp-rules-human';
  section.innerHTML=`
    <p class="mp-rules-intro">Welcome to <strong>HEIST CIRCUIT</strong>. This isn't the classic sock chase: you're competing to fill a bag, race to a moving drop-off, trigger jackpots and survive Draco. Everyone plays at the same time.</p>
    <div class="mp-rules-grid">
      <div class="mp-rule-card"><h3>1. Pick your rivals</h3>
        <p>For a local game, choose 2–4 thieves: friends on one keyboard, bots, or both. For online play, connect to the dedicated game server, create a private room, and share the invite link or room code. Your friends join on their own computers and choose a character. The room leader selects the room, adds bots if wanted, and starts the match. The server runs the match, even if the leader disconnects; a returning player can reclaim their seat. Online guests use the P1 keys on their own keyboards. Draco guards the house; nobody plays as Draco in this mode.</p></div>
      <div class="mp-rule-card"><h3>2. Find socks. Deliver your bag.</h3>
        <p>Walk over an ordinary sock to grab it. You get <strong>1 Heist Point</strong> right away and add <strong>one sock to your bag</strong> (maximum four). Follow the <strong>glowing turquoise RELAY DROP</strong> in the room. When you have at least two socks, stand beside it and press your <strong>USE/JACKPOT</strong> key to deliver.</p>
        <p>Each delivered sock earns <strong>4 more points</strong>; delivering four together earns an extra <strong>4-point full-bag bonus</strong>. The drop-off moves every <strong>23 seconds</strong> and moves again after a successful delivery. During the final 30 seconds, delivery points are <strong>doubled</strong>. The display above the drop-off shows where and when to go.</p>
        <p><strong>Watch out:</strong> if Draco catches you, the socks in your bag are lost. Some may spill back onto the furniture where a rival can take them.</p></div>
      <div class="mp-rule-card"><h3>3. Tools, gold and jackpots</h3>
        <p>Touch a small supply item to receive <strong>1 Tool, 1 Energy and 1 point</strong>. Keep two Tools to activate one of the two <strong>star-marked Jackpot Machines</strong> by standing near it and pressing USE. You receive <strong>3 points</strong>, an Energy refill and a shower of up to three golden socks that <strong>anybody</strong> can steal.</p>
        <p>Golden socks are worth <strong>6 immediate points</strong> and need no Tool. They don't go into the delivery bag. An activated machine is spent for the match, and the second machine briefly recharges. Neither machine is a hiding place.</p>
        <p>Instead of saving Tools for a jackpot, spend <strong>1 Tool at an ordinary hiding place</strong> with your STASH key to protect some of your points and gain a small bonus. You can stash twice per match.</p></div>
      <div class="mp-rule-card"><h3>4. Beat your opponents to prizes</h3>
        <p>Every sock, supply item and golden prize can only be taken once. New socks arrive approximately every <strong>24 seconds</strong>, and a Tool Drop arrives every <strong>34 seconds</strong>. Be ready to change your plan when someone beats you to a pickup or activates a jackpot.</p>
        <p>The first thief to complete each of these earns an exclusive contract bonus: <strong>Sock Sprint</strong> (3 socks, +5), <strong>Supply Run</strong> (2 supply items, +4), <strong>Gold Rush</strong> (first gold, +4), <strong>Jackpot Starter</strong> (first jackpot, +3), <strong>Quick Swap</strong> (two different loot types within 10 seconds, +4 plus a 3-point combo), and <strong>First Delivery</strong> (first Relay delivery, +5). You can't claim someone else's completed contract.</p></div>
      <div class="mp-rule-card"><h3>5. Draco changes everything</h3>
        <p>Each thief starts with <strong>three lives</strong>. Draco or a hazard costs a life. You respawn with <strong>5 seconds of protection</strong>, but the third hit takes you out of the match. A catch also costs a Tool if you have one; otherwise you lose up to three unprotected points. Your unbanked sock bag is always lost.</p>
        <p>Stealing items, using skills and making a delivery raise the shared alarm. When it fills, Draco becomes faster, while pickups gain extra points. Hide to break his pursuit, or spend Energy on your character's skill. The last 20 seconds are Final Rush.</p></div>
      <div class="mp-rule-card"><h3>6. How to win</h3>
        <p>When time runs out, <strong>the surviving thief with the most Heist Points wins</strong>; remaining Tools break a tie. If Draco catches every thief, the highest score among those caught wins. Make a delivery instead of carrying a full bag to the finish — undelivered socks are not worth the delivery bonus.</p></div>
      <div class="mp-rule-card"><h3>7. Four-player keyboard controls</h3>
        <p><strong>UP jumps</strong> when you're on the ground, and climbs when near a climbable object. LEFT and RIGHT move; DOWN climbs down. USE works at either a Relay Drop or a Jackpot Machine.</p>
        <ul><li><strong>P1:</strong> A/D move, W up/jump, S down, Q hide, E skill, Z use, X stash.</li>
        <li><strong>P2:</strong> F/H move, T up/jump, G down, R hide, Y skill, V use, B stash.</li>
        <li><strong>P3:</strong> J/L move, I up/jump, K down, U hide, O skill, N use, , (comma) stash.</li>
        <li><strong>P4:</strong> arrow keys move/climb/jump, Right Shift hide, Right Ctrl skill, Enter use, Backspace stash.</li></ul>
        <p>Escape pauses; M toggles music. Gamepads are optional. Touch controls operate P1. If several people share one keyboard, some keyboards may not register every simultaneous key press.</p></div>
    </div>
    <p style="margin-top:15px;color:#bfeeff">A good first strategy: collect two ordinary socks, deliver them at the turquoise drop-off, then decide whether your next Tools are better spent on a gold jackpot or on protecting your score.</p>
  `;
  title.insertAdjacentElement('afterend',section);
}

function selectCharacter(id) {
  state.selectedId = id; const character = CHARACTERS[id];
  $("#chosenRole").textContent = character.roleShort;
  $("#chosenSummary").textContent = `${character.name}: ${character.abilityText}`;
  updateRulesContext();
  buildLevelCards();
  showScreen("levels");
}

function buildLevelCards() {
  const unlocked = getProgress(); dom.levelGrid.textContent = "";
  LEVELS.forEach((level, index) => {
    const card = document.createElement("button"); card.type = "button"; card.className = "level-card";
    card.disabled = online.connected && online.role==='guest'; // Guests see the same rooms; the host selects.
    const sockCount = guardSockLayout(level).length;
    const guardGoal = state.selectedId === "draco" ? `<span class="level-guard-goal">${sockCount} SOCK${sockCount === 1 ? "" : "S"} TO PROTECT · ${level.catches} THIEVES</span>` : "";
    card.innerHTML = `<span class="level-visual"></span><span class="level-card-content"><small>LEVEL ${level.number}</small><h3>${level.name}</h3><p>${level.tagline}</p>${guardGoal}</span>`;
    card.querySelector(".level-visual").style.backgroundImage = `linear-gradient(180deg, transparent 15%, rgba(3,8,14,.9) 88%), url(${level.background})`;
    card.addEventListener("click", () => prepareLevel(index)); dom.levelGrid.append(card);
  });
}

function prepareLevel(index) {
  if(online.connected && online.role==='guest')return;
  if(online.connected && online.role==='host')online.send({type:'lobby-stage',stage:'briefing',levelIndex:index});
  state.levelIndex=index;
  const level=LEVELS[index];
  $('#briefingNumber').textContent='ROOM '+(index+1)+' OF '+LEVELS.length;
  $('#briefingEyebrow').textContent=level.name;
  $('#briefingTitle').textContent=level.title;
  $('#briefingStory').textContent='Collect socks, then chase the moving RELAY DROP to cash in your bag. Compete for Tools and trigger gold jackpots while Draco hunts the room.';
  $('#briefingMission').textContent='HEIST CIRCUIT: deliver 2–4 socks to the glowing Relay Drop using your JACKPOT/USE key. It moves every 23 seconds! Socks return every 24 seconds; Tools every 34 seconds.';
  $('#briefingAbility').textContent='Carried socks are lost when Draco catches you. Choose: bank your bag at the Relay, spend 2 Tools on a shared gold jackpot, or spend 1 Tool to secure points at a hiding spot. Three lives each.';
  updateRulesContext();showScreen('briefing');
}

function createEntity(id, x, y, enemy = false) {
  const character = CHARACTERS[id];
  return {
    id, x, y, prevX: x, prevY: y, w: character.width, h: character.height,
    vx: 0, vy: 0, face: enemy ? -1 : 1, onGround: false, climbing: false,
    enemy, active: true, stunned: 0, landSquash: 0, coyote: 0, jumpBuffer: 0,
    aiDir: Math.random() > .5 ? 1 : -1, aiTimer: .8 + Math.random() * 1.6, aiJump: Math.random() * 1.8,
    mode: "patrol", suspicion: 0,
    lastSeenX: x, lastSeenY: y, memory: 0, searchTimer: 0, searchSide: 1, pulse: 0,
    animDistance: Math.random() * 30, idlePhase: Math.random() * Math.PI * 2,
    ledgePull: 0, roamTarget: null, roamSurface: -1, roamTimer: 0,
    roamSpeed: .42, feintTimer: 1.1 + Math.random() * 2.4,
    stuckX: x, stuckY: y, stuckCheckTimer: .65,
    hidden: false, hideSpot: null, hideTimer: 0, hideReveal: 0,
    invisible: 0, boostTimer: 0, abilityCooldown: 2.4 + Math.random() * 2.8,
    decisionTimer: .45 + Math.random() * .8, lootTarget: -1,
    lootCooldown: 5.2 + Math.random() * 3.8,
  };
}

function guardSockLayout(level) {
  if (level.guardSocks?.length) {
    return level.guardSocks.map((item) => ({
      ...item,
      kind: "sock",
      protected: true,
    }));
  }

  return level.items
    .filter((item) => item.kind === "sock")
    .map((item) => ({
      ...item,
      protected: true,
    }));
}


// v11: reset the 2D drawing context when changing rooms, never carry old blending/transform state forward.
function mpPrepareCanvasForRoom(){
  if(typeof ctx.reset==='function')ctx.reset();
  else {ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.filter='none';ctx.shadowBlur=0;ctx.clearRect(0,0,GAME.width,GAME.height);}
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
}
function mpSafeRenderLayer(label,task){
  ctx.save();
  try{task();}
  catch(error){
    if(!state._renderWarnings)state._renderWarnings=new Set();
    if(!state._renderWarnings.has(label)){
      state._renderWarnings.add(label);
      console.error('[TTHC] Recovered drawing error in '+label,error);
    }
  }finally{ctx.restore();}
}

function initLevel() {
  if (online.connected && online.role === 'host') {
    online.send({type:'start',levelIndex:state.levelIndex,bots:mpLobby.bots,difficulty:mpLobby.difficulty});
    showHint('Starting a dedicated server match…',2);
    return;
  }
  if (online.role === 'guest') { showHint('Only the host can start a shared match.', 2); return; }
  if (online.role === 'host' && online.connected) online.send({ type: 'start', levelIndex: state.levelIndex });
  mpRuntimeErrorV4=false;
  document.querySelector('#mpSafeErrorV4')?.remove();
  state._renderWarnings=null;state._spriteFallbackLogged=false;
  mpPrepareCanvasForRoom();
  const level = LEVELS[state.levelIndex];
  const selected = mpLobbySlots();
  const start = level.playerSpawn.thief;
  const players = selected.map((slot, index) => {
    const character = CHARACTERS[slot.character];
    const x = clamp(start[0] + index * 52, 4, GAME.width - character.width - 4);
    const y = Math.min(start[1], level.floorY - character.height - 6);
    const p = createEntity(slot.character, x, y, slot.type === 'bot');
    Object.assign(p,{ mpIndex:index, remoteSlot:slot.remoteSlot ?? -1, mpType:slot.type, displayName:slot.type==='bot' ? 'BOT '+(index+1) : slot.name || 'P'+(index+1), points:0, lives:3, energy:3, tools:0, loot:0, cargo:0, relayDeliveries:0, protectedPoints:0, stashes:0, contractWins:0, contractCounters:{socks:0,tools:0,gold:0}, hidden:false, invisible:0, abilityCooldown:0, damageCooldown:0, mpJumpHeld:false, mpAbilityHeld:false, mpHideHeld:false, aiTarget:-1, aiDecision:0, aiStuck:0, aiLastX:x });
    return p;
  });
  state.level=level;
  mpNavigator=createNavigator(level,GAME.width);
  state.mpPlayers=players;
  state.player=players[0];
  state.selectedId=players[0].id;
  state.items=level.items.map((item,index)=>({...item,index,w:26,h:26,collected:false,magnet:false,phase:index*1.7}));
  // More shared pickups to support four participants. Everything remains physically reachable.
  const extras=level.surfaces.filter(s=>s.w>95 && s.type!=='floor').slice(0,7);
  extras.forEach((surface,i)=>{
    const x=surface.x+surface.w*(i%2===0?.38:.65), y=surface.y-23;
    if(state.items.some(item=>Math.hypot(item.x-x,item.y-y)<45))return;
    state.items.push({x,y,kind:i%3===0?'button':'sock',premium:i%3===1,index:state.items.length,w:26,h:26,collected:false,magnet:false,phase:i*.9});
  });
  state.heist=createHeistMode();
  state.vaults=mpBuildVaults(level);
  state.relay=mpCreateRelay(level);
  state.nextSupplyDrop=34;
  state.dropSerial=0;
  state.nextSockWave=24;
  state.sockWaveSerial=0;
  state.vaultLockdown=0;
  state.lastThiefWarned=false;
  state.finalRush=false;
  state.enemies=[];
  const guardSpawn=level.playerSpawn.guard;
  const draco=createEntity('draco',guardSpawn[0],guardSpawn[1],true);
  state.enemies.push(draco);
  Object.assign(state,{particles:[],elapsed:0,remaining:Math.max(150,level.time),collected:0,caught:0,hearts:3,
    abilityCooldown:0,abilityUses:0,slowTimer:0,invisibleTimer:0,glideTimer:0,damageCooldown:0,
    hidden:false,hiddenSpot:null,hideTimer:0,hideNoise:false,decoy:null,noise:null,footstepTimer:0,
    currentHint:-1,hintTimer:0,jumpBuffer:0,coyote:0,running:true,paused:false});
  state.dust=Array.from({length:38},(_,i)=>({x:(i*89+47)%GAME.width,y:100+(i*137)%510,r:.6+i%3*.4,speed:2+i%5}));
  keys.clear();touchKeys.clear();updateHud();setGameChrome(true);
  Object.values(screens).forEach(s=>s.classList.remove('active'));
  state.screen='game';syncAudioForContext();
  showHint('HEIST CIRCUIT! Grab 2 socks, find the glowing RELAY DROP, press USE to bank your bag. Beware Draco!',5);
}

function inputDown(action) { return CONTROLS[action].some((code) => keys.has(code)) || touchKeys.has(action); }
function climbFor(entity) {
  const sensor = { x: entity.x + entity.w * .32, y: entity.y + 4, w: entity.w * .36, h: Math.max(8, entity.h - 8) };
  return state.level.climbs.find((climb) => overlaps(sensor, climb));
}

function walkableSurfaceBounds(surface) {
  if (surface.type === "floor") {
    return {
      left: surface.x,
      right: surface.x + surface.w,
    };
  }

  const clearance = Math.min(24, Math.max(14, surface.w * .19));

  return {
    left: surface.x + clearance,
    right: surface.x + surface.w - clearance,
  };
}

function surfacePositionRange(surface, entityWidth, padding = 5) {
  const bounds = walkableSurfaceBounds(surface);
  const min = bounds.left + padding;
  return { min, max: Math.max(min, bounds.right - entityWidth - padding) };
}

function supportSurface(entity) {
  const feet = entity.y + entity.h;
  return state.level.surfaces.find((surface) => {
    const bounds = walkableSurfaceBounds(surface);
    return entity.x + entity.w - 7 > bounds.left && entity.x + 7 < bounds.right && Math.abs(feet - surface.y) < 9;
  });
}

function pullOntoLedge(entity, direction, wasGrounded = false) {
  if (
    !direction ||
    entity.climbing ||
    entity.onGround ||
    wasGrounded ||
    entity.ledgePull > 0 ||
    entity.vy < -230
  ) {
    return false;
  }

  const handY = entity.y + entity.h * .2;
  const feetY = entity.y + entity.h;

  const ledge = state.level.surfaces.find((surface) => {
    if (
      surface.type === "floor" ||
      surface.y < handY - 20 ||
      surface.y > feetY + 14
    ) {
      return false;
    }

    const bounds = walkableSurfaceBounds(surface);
    const atLeftEdge =
      direction > 0 &&
      Math.abs(entity.x + entity.w - bounds.left) < 21;

    const atRightEdge =
      direction < 0 &&
      Math.abs(entity.x - bounds.right) < 21;

    return atLeftEdge || atRightEdge;
  });

  if (!ledge) return false;

  const bounds = walkableSurfaceBounds(ledge);

  entity.x =
    direction > 0
      ? bounds.left + 6
      : bounds.right - entity.w - 6;

  entity.y = ledge.y - entity.h;
  entity.vx *= .35;
  entity.vy = 0;
  entity.onGround = true;
  entity.ledgePull = .42;
  entity.landSquash = .18;

  if (entity === state.player) {
    burst(
      entity.x + entity.w / 2,
      ledge.y,
      CHARACTERS[entity.id].color,
      4,
    );
  }

  return true;
}

function updateEntity(entity, dt, controls, speedScale = 1, isPlayer = false) {
  if (!entity.active) return;
  entity.prevX = entity.x; entity.prevY = entity.y;
  const character = CHARACTERS[entity.id];
  if (entity.stunned > 0) { entity.stunned -= dt; controls = {}; speedScale *= .1; }
  entity.ledgePull = Math.max(0, entity.ledgePull - dt);
  entity.landSquash = Math.max(0, entity.landSquash - dt * 4.8);
  entity.coyote = entity.onGround ? .105 : Math.max(0, entity.coyote - dt);
  entity.jumpBuffer = Math.max(0, entity.jumpBuffer - dt);
  if (isPlayer && state.jumpBuffer > 0) { entity.jumpBuffer = state.jumpBuffer; state.jumpBuffer = Math.max(0, state.jumpBuffer - dt); }
  const dir = (controls.right ? 1 : 0) - (controls.left ? 1 : 0);
  const climb = climbFor(entity); const climbDir = (controls.down ? 1 : 0) - (controls.up ? 1 : 0);
  if (climb && climbDir !== 0 && entity.ledgePull <= 0) entity.climbing = true;
  if (entity.climbing && !climb) entity.climbing = false;
  if (entity.climbing && entity.jumpBuffer > 0) { entity.climbing = false; entity.ledgePull = .32; entity.vx += entity.face * 95; entity.vy = -character.jump * .78; entity.jumpBuffer = 0; if (isPlayer) state.jumpBuffer = 0; }

  const targetVx = dir * character.speed * speedScale;
  const accel = character.acceleration * (entity.onGround ? 1 : .58) * speedScale;
  entity.vx = dir ? moveToward(entity.vx, targetVx, accel * dt) : moveToward(entity.vx, 0, character.acceleration * (entity.onGround ? 1.35 : .22) * dt);
  if (dir) entity.face = dir;

  if (entity.climbing && climb) {
    entity.vy = climbDir * character.speed * .68 * speedScale;
    entity.x = lerp(entity.x, climb.x + climb.w / 2 - entity.w / 2, .11);
    entity.onGround = false;
    if (climbDir < 0) {
      const mount = state.level.surfaces
        .filter((surface) => surface.type !== "floor" && Math.abs(surface.y - climb.y) < 70 && surface.x < climb.x + climb.w + 18 && surface.x + surface.w > climb.x - 18)
        .sort((a, b) => Math.abs(a.y - climb.y) - Math.abs(b.y - climb.y))[0];
      if (mount && entity.y + entity.h * .45 <= mount.y + 22) {
      const range = surfacePositionRange(mount, entity.w, 5);
      const leftOfClimb = climb.x - entity.w - 10;
      const rightOfClimb = climb.x + climb.w + 10;
      const options = entity.face >= 0 ? [rightOfClimb, leftOfClimb] : [leftOfClimb, rightOfClimb];
      const mountX = options.find((candidate) => candidate >= range.min && candidate <= range.max) ?? clamp(entity.x, range.min, range.max);
     entity.climbing = false; entity.onGround = true; entity.vy = 0; entity.ledgePull = .48;
     entity.x = mountX; entity.face = mountX >= climb.x + climb.w / 2 ? 1 : -1; entity.vx = entity.face * 65;
     entity.y = mount.y - entity.h;
     }
    }
  } else {
    if (entity.jumpBuffer > 0 && entity.coyote > 0) {
      entity.vy = -character.jump; entity.onGround = false; entity.coyote = 0; entity.jumpBuffer = 0; if (isPlayer) state.jumpBuffer = 0;
      burst(entity.x + entity.w / 2, entity.y + entity.h, character.color, 5);
    }
    let gravityScale = 1;
    if (entity.vy < 0 && !controls.jumpHeld) gravityScale = 1.95;
    if (isPlayer && state.glideTimer > 0) gravityScale = .24;
    entity.vy = Math.min(GAME.maxFall, entity.vy + GAME.gravity * gravityScale * dt);
  }

  const oldBottom = entity.y + entity.h; const wasGrounded = entity.onGround;
  entity.x = clamp(entity.x + entity.vx * dt, 0, GAME.width - entity.w); entity.y += entity.vy * dt; entity.onGround = false;
  const grabbedLedge = pullOntoLedge(entity, dir, wasGrounded);
  if (!grabbedLedge && !entity.climbing && entity.vy >= 0) {
    let landing = null;
    state.level.surfaces.forEach((surface) => {
      const nextBottom = entity.y + entity.h;
const bounds = walkableSurfaceBounds(surface);
const horizontal = entity.x + entity.w - 7 > bounds.left && entity.x + 7 < bounds.right;
if (horizontal && oldBottom <= surface.y + 5 && nextBottom >= surface.y && (!landing || surface.y < landing.y)) landing = surface;
    });
    if (landing) {
      const landingSpeed = entity.vy; entity.y = landing.y - entity.h; entity.vy = 0; entity.onGround = true;
      if (!wasGrounded && landingSpeed > 170) { entity.landSquash = clamp(landingSpeed / 850, .15, .7); if (isPlayer) burst(entity.x + entity.w / 2, landing.y, "#d8e3e8", 4); }
    }
   }

  if (wasGrounded && !entity.onGround && !entity.climbing) {
    entity.ledgePull = Math.max(entity.ledgePull, .18);
  }

  mpFloorSafety(entity);
  entity.animDistance += Math.abs(entity.x - entity.prevX) + Math.abs(entity.y - entity.prevY) * .28;
  if (entity.y > GAME.height + 80) {
  if (isPlayer && state.selectedId === "draco") {
    const spawn = state.level.playerSpawn.guard;

    Object.assign(entity, {
      x: spawn[0],
      y: spawn[1],
      prevX: spawn[0],
      prevY: spawn[1],
      vx: 0,
      vy: 0,
      onGround: false,
      climbing: false,
      ledgePull: .5,
    });

    state.damageCooldown = .65;
    showHint("Draco returned to safe ground.", 1.8);
  } else if (isPlayer) {
    takeDamage("You lost your footing.");
  } else {
    entity.x = 80 + Math.random() * 1100;
    entity.y = state.level.floorY - entity.h - 4;
    entity.prevX = entity.x;
    entity.prevY = entity.y;
    entity.vx = 0;
    entity.vy = 0;
    entity.climbing = false;
  }
}
}

function playerControls() {
  return {
    left: inputDown("left"), right: inputDown("right"), up: inputDown("up"), down: inputDown("down"),
    jumpHeld: inputDown("jump"),
  };
}

function queueJump() {
  if (!state.running || state.paused || state.player?.hidden) return;
  state.jumpBuffer = .16;
}

function nearbyHideSpot() {
  if (!state.player || state.selectedId === "draco") {
    return null;
  }

  const expanded = {
    x: state.player.x - 50,
    y: state.player.y - 35,
    w: state.player.w + 100,
    h: state.player.h + 70,
  };

  return state.level.hideSpots
    .filter((spot) => overlaps(expanded, spot))
    .sort((a, b) => {
      const aDistance = Math.abs(
        (a.x + a.w / 2) -
        (state.player.x + state.player.w / 2)
      );

      const bDistance = Math.abs(
        (b.x + b.w / 2) -
        (state.player.x + state.player.w / 2)
      );

      return aDistance - bDistance;
    })[0] || null;
}

function toggleHide() { mpToggleHide(state.player); }

function canSeePlayer(draco, target = state.player) {
  if(!target?.active || target.hidden || target.invisible>0)return false;
  const dx=target.x-draco.x, dy=target.y-draco.y;
  const sight=draco.mode==='chase'?390+difficultyStep()*10:305+difficultyStep()*12;
  return (Math.sign(dx||draco.face)===draco.face || Math.abs(dx)<78) && Math.hypot(dx,dy*1.35)<sight && Math.abs(dy)<205;
}

function emitNoise(x, strength = .25) {
  state.noise = { x, strength, time: .6 };
  if (state.selectedId === "draco") return;
  const draco = state.enemies.find((enemy) => enemy.id === "draco" && enemy.active);
  if (!draco || Math.abs(draco.x - x) > 360) return;
  draco.lastSeenX = x;
  draco.suspicion = clamp(draco.suspicion + strength * (1 - Math.abs(draco.x - x) / 500), 0, 1);
  if (draco.mode === "patrol" && draco.suspicion > .24) { draco.mode = "alert"; draco.searchTimer = 1.8; }
}

function updatePlayer(dt) { mpUpdatePlayers(dt); }

function chooseDracoRoamTarget(draco, forceDifferent = false) {
  const current = supportSurface(draco);
  const currentY = current?.y ?? state.level.floorY;
  let candidates = state.level.surfaces
    .map((surface, index) => {
      const climbLink = state.level.climbs.find((climb) => {
        const top = climb.y - 12; const bottom = climb.y + climb.h + 12;
        const touches = (candidate) => candidate.x < climb.x + climb.w + 55 && candidate.x + candidate.w > climb.x - 55;
        return current && current.y >= top && current.y <= bottom && surface.y >= top && surface.y <= bottom && touches(current) && touches(surface);
      });
      return { surface, index, climbLink };
    })
    .filter(({ surface, climbLink }) => {
      const verticalGap = surface.y - currentY;
      return surface.w >= 75 && (verticalGap >= 0 || Math.abs(verticalGap) <= 95 || climbLink);
    });
  const raised = candidates.filter(({ surface, index }) => surface.type !== "floor" && (!forceDifferent || index !== draco.roamSurface));
  const floor = candidates.filter(({ surface }) => surface.type === "floor");
  if (raised.length && Math.random() < .42) candidates = raised;
  else if (floor.length && Math.random() < .72) candidates = floor;
  if (forceDifferent && candidates.length > 1) candidates = candidates.filter(({ index }) => index !== draco.roamSurface);
  const choice = candidates[Math.floor(Math.random() * candidates.length)] || { surface: state.level.surfaces[0], index: 0, climbLink: null };
  const range = surfacePositionRange(choice.surface, draco.w, 6);
  const x = clamp(range.min + Math.random() * Math.max(1, range.max - range.min), 8, GAME.width - draco.w - 8);
  const y = choice.surface.y - draco.h;
  draco.roamTarget = { x, y, surface: choice.surface.type, viaClimb: choice.surface.y < currentY - 70 ? choice.climbLink : null };
  draco.roamSurface = choice.index;
  draco.roamTimer = 3.1 + Math.abs(x - draco.x) / 175 + Math.abs(y - draco.y) / 130 + Math.random() * 1.8;
  draco.roamSpeed = .36 + Math.random() * .2;
  draco.feintTimer = 1.1 + Math.random() * 2.4;
}

function keepDracoMoving(draco, dt) {
  draco.stuckCheckTimer -= dt;
  if (draco.stuckCheckTimer > 0) return;
  const barelyMoved = Math.hypot(draco.x - draco.stuckX, draco.y - draco.stuckY) < 4;
  if (barelyMoved) {
    if (draco.climbing) {
      draco.climbing = false; draco.ledgePull = .36; draco.face *= -1;
      draco.vx = draco.face * 120; draco.vy = -145;
    } else {
      if (draco.mode === "patrol" || draco.mode === "alert") chooseDracoRoamTarget(draco, true);
      else { draco.searchSide *= -1; draco.lastSeenX = clamp(draco.x + draco.searchSide * (75 + Math.random() * 95), 20, GAME.width - 20); }
      const targetX = draco.mode === "patrol" || draco.mode === "alert" ? draco.roamTarget?.x : draco.lastSeenX;
      draco.face = Math.sign((targetX ?? draco.x + 1) - draco.x) || -draco.face || 1;
      draco.vx = draco.face * 105;
      if (draco.onGround) { draco.jumpBuffer = .12; draco.aiJump = .7; }
    }
  }
  draco.stuckX = draco.x; draco.stuckY = draco.y; draco.stuckCheckTimer = .46 + Math.random() * .22;
}

function moveDracoAlongRoute(draco, dt, controls, slowScale, speedMultiplier = 1) {
  if (!draco.roamTarget) chooseDracoRoamTarget(draco);
  draco.roamTimer -= dt; draco.feintTimer -= dt;
  let dx = draco.roamTarget.x - draco.x; let dy = draco.roamTarget.y - draco.y;
  const arrived = Math.abs(dx) < 20 && Math.abs(dy) < 28;
  if (arrived || draco.roamTimer <= 0) {
    chooseDracoRoamTarget(draco, true); dx = draco.roamTarget.x - draco.x; dy = draco.roamTarget.y - draco.y;
  }
  if (draco.feintTimer <= 0 && !draco.climbing) {
    chooseDracoRoamTarget(draco, Math.random() < .72);
    draco.feintTimer = 1.1 + Math.random() * 2.4; dx = draco.roamTarget.x - draco.x; dy = draco.roamTarget.y - draco.y;
  }
  const climb = draco.roamTarget.viaClimb;
  if (draco.climbing) controls.up = true;
  else if (climb && dy < -45) {
    const climbDx = climb.x + climb.w / 2 - (draco.x + draco.w / 2);
    controls.left = climbDx < -7; controls.right = climbDx > 7; controls.up = Math.abs(climbDx) <= 10;
  } else { controls.left = dx < -8; controls.right = dx > 8; }
  if (!climb && dy < -42 && draco.onGround && draco.aiJump <= 0) {
    draco.jumpBuffer = .12; draco.aiJump = .85 + Math.random() * .55;
  }
  draco.aiJump -= dt;
  updateEntity(draco, dt, controls, draco.roamSpeed * speedMultiplier * slowScale);
}

function updateDraco(draco, dt) {
  if (!draco.active) return;

  const target = mpSelectTarget(draco);
  if (!target) return;
  const step = difficultyStep();
  const visible = canSeePlayer(draco, target);
  const slowScale = state.slowTimer > 0 ? .48 : 1;
  const controls = { jumpHeld: true };

  if (visible) {
    const firstNotice = draco.mode === "patrol";

    if (firstNotice || draco.mode === "chase") {
      draco.lastSeenX = target.x;
      draco.lastSeenY = target.y;
    }

    const noticeSpeed =
      draco.mode === "chase"
        ? 2.5 + step * .08
        : 1.15 + step * .1;

    draco.suspicion = clamp(
      draco.suspicion + dt * noticeSpeed,
      0,
      1,
    );

    if (draco.suspicion >= 1) {
      draco.mode = "chase";
      draco.lastSeenX = target.x;
      draco.lastSeenY = target.y;
      draco.memory = 4;
    } else if (firstNotice) {
      draco.mode = "alert";
      draco.searchTimer = .9 + Math.random() * .55;
    }
  } else if (draco.mode !== "chase") {
    draco.suspicion = Math.max(0, draco.suspicion - dt * .23);
  }

  if (state.decoy) {
    draco.mode = "chase";
    draco.lastSeenX = state.decoy.x;
    draco.lastSeenY = state.decoy.y;
    draco.memory = state.decoy.time;
  }

  if (draco.mode === "patrol") {
    moveDracoAlongRoute(
      draco,
      dt,
      controls,
      slowScale,
      1 + step * .04,
    );
  } else if (draco.mode === "alert") {
    draco.searchTimer -= dt;

    moveDracoAlongRoute(
      draco,
      dt,
      controls,
      slowScale,
      .82 + step * .035,
    );

    if (draco.suspicion >= 1) {
      draco.mode = "chase";
      draco.memory = 4;
    } else if (draco.searchTimer <= 0 && !visible) {
      draco.mode = "search";
      draco.searchTimer = 3.4;
    }
  } else if (draco.mode === "chase") {
    const targetX = state.decoy
      ? state.decoy.x
      : draco.lastSeenX;

    const targetY = state.decoy
      ? state.decoy.y
      : draco.lastSeenY;

    const dx = targetX - draco.x;
    const dy = targetY - draco.y;

    controls.left = dx < -12;
    controls.right = dx > 12;

    if (dy < -65 && draco.onGround && draco.aiJump <= 0) {
      draco.jumpBuffer = .12;
      draco.aiJump = 1.3;
    }

    draco.aiJump -= dt;

    updateEntity(
      draco,
      dt,
      controls,
      (1.03 + step * .035) * slowScale,
    );

    if (visible && !state.decoy) {
      draco.memory = 4;
    } else {
      draco.memory -= dt * (target.hidden ? 2.6 : 1);
    }

    if (draco.memory <= 0) {
      draco.mode = "search";
      draco.searchTimer = 4.4;
      draco.searchSide = 1;
      draco.suspicion = .58;
    }
  } else {
    draco.searchTimer -= dt;

    const targetX =
      draco.lastSeenX +
      draco.searchSide * 78;

    if (Math.abs(targetX - draco.x) < 14) {
      draco.searchSide *= -1;
    }

    controls.left = targetX < draco.x;
    controls.right = targetX > draco.x;

    updateEntity(
      draco,
      dt,
      controls,
      (.48 + step * .02) * slowScale,
    );

    if (draco.searchTimer <= 0) {
      draco.mode = "patrol";
      draco.suspicion = 0;
      chooseDracoRoamTarget(draco, true);
    }
  }

  keepDracoMoving(draco, dt);

  const close = distance(draco, target);

  if (
    target.hidden &&
    target.hideTimer > hideTimeLimit() &&
    close < 78
  ) {
    target.hidden = false;
    target.hiddenSpot = null;
    mpDamage(target, "Draco found your hiding place!");
  } else if (
    !target.hidden &&
    target.invisible <= 0 &&
    target.damageCooldown <= 0 &&
    close < 58 &&
    overlaps(target, draco, 4)
  ) {
    mpDamage(target, "Draco caught up with you!");
  }
}

function chooseThiefRoamTarget(thief, forceDifferent = false) {
  const current = supportSurface(thief);
  const currentY = current?.y ?? state.level.floorY;
  let candidates = state.level.surfaces
    .map((surface, index) => {
      const climbLink = state.level.climbs.find((climb) => {
        const top = climb.y - 16; const bottom = climb.y + climb.h + 16;
        const touches = (candidate) => candidate.x < climb.x + climb.w + 62 && candidate.x + candidate.w > climb.x - 62;
        return current && current.y >= top && current.y <= bottom && surface.y >= top && surface.y <= bottom && touches(current) && touches(surface);
      });
      return { surface, index, climbLink };
    })
    .filter(({ surface, climbLink }) => {
  const verticalGap = surface.y - currentY;
  return surface.w >= 72 && (verticalGap >= 0 || Math.abs(verticalGap) <= 90 || climbLink);
});
  if (forceDifferent && candidates.length > 1) candidates = candidates.filter(({ index }) => index !== thief.roamSurface);

  const threatened = distance(thief, state.player) < 330;
  const availableSocks = state.items.filter((item) => item.kind === "sock" && !item.collected);
  let lootTarget = availableSocks.find((item) => item.index === thief.lootTarget);
  if (!lootTarget && availableSocks.length) {
    lootTarget = availableSocks[Math.floor(Math.random() * availableSocks.length)];
    thief.lootTarget = lootTarget.index;
  }
  if (threatened && candidates.length > 2) {
    candidates.sort((a, b) => Math.abs((b.surface.x + b.surface.w / 2) - state.player.x) - Math.abs((a.surface.x + a.surface.w / 2) - state.player.x));
    candidates = candidates.slice(0, Math.max(2, Math.ceil(candidates.length * .55)));
  } else if (lootTarget && candidates.length > 1) {
    const score = ({ surface }) => {
      const horizontal = lootTarget.x < surface.x ? surface.x - lootTarget.x : lootTarget.x > surface.x + surface.w ? lootTarget.x - (surface.x + surface.w) : 0;
      return horizontal + Math.abs(surface.y - (lootTarget.y + 30)) * 1.35;
    };
    candidates.sort((a, b) => score(a) - score(b));
    const best = score(candidates[0]);
    candidates = candidates.filter((candidate) => score(candidate) <= best + 48);
  } else {
    const raised = candidates.filter(({ surface }) => surface.type !== "floor");
    if (raised.length && Math.random() < .5) candidates = raised;
  }

  const choice = candidates[Math.floor(Math.random() * candidates.length)] || { surface: state.level.surfaces[0], index: 0, climbLink: null };
  const range = surfacePositionRange(choice.surface, thief.w, 5);
  const randomX = range.min + Math.random() * Math.max(1, range.max - range.min);
  const targetX = lootTarget && !threatened ? clamp(lootTarget.x - thief.w / 2, range.min, range.max) : randomX;
  const x = clamp(targetX, 7, GAME.width - thief.w - 7);
  thief.roamTarget = {
    x,
    y: choice.surface.y - thief.h,
    viaClimb: choice.surface.y < currentY - 45 ? choice.climbLink : null,
  };
  thief.roamSurface = choice.index;
  thief.roamTimer = 2.5 + Math.abs(x - thief.x) / 190 + Math.random() * 2.2;
  thief.roamSpeed = .4 + Math.random() * .15;
}

function leaveThiefHideSpot(thief, startled = false) {
  const spot = thief.hideSpot;
  thief.hidden = false; thief.hideSpot = null; thief.hideTimer = 0; thief.hideReveal = 0;
  thief.x = clamp((spot?.x || thief.x) + (Math.random() > .5 ? (spot?.w || 50) + 8 : -thief.w - 8), 4, GAME.width - thief.w - 4);
  thief.y = state.level.floorY - thief.h - 2; thief.prevX = thief.x; thief.prevY = thief.y;
  thief.vx = (thief.x < state.player.x ? -1 : 1) * (startled ? 175 : 95);
  if (startled) thief.stunned = Math.max(thief.stunned, .28);
  chooseThiefRoamTarget(thief, true);
}

function tryThiefHide(thief, threatDistance) {
  if (threatDistance > 285 || thief.hidden || thief.invisible > 0) return false;
  const spots = state.level.hideSpots
    .map((spot) => ({ spot, gap: Math.hypot((spot.x + spot.w / 2) - thief.x, (spot.y + spot.h / 2) - thief.y) }))
    .filter(({ gap }) => gap < 235)
    .sort((a, b) => a.gap - b.gap);
  if (
  !spots.length ||
  Math.random() > .41 + difficultyStep() * .05
) {
  return false;
}
  const spot = spots[Math.min(spots.length - 1, Math.floor(Math.random() * 2))].spot;
  thief.hidden = true; thief.hideSpot = spot; thief.hideTimer = 1.4 + Math.random() * 2.25; thief.hideReveal = 0;
  thief.vx = 0; thief.vy = 0; thief.climbing = false;
  thief.x = spot.x + spot.w / 2 - thief.w / 2; thief.y = spot.y + spot.h - thief.h - 5;
  thief.prevX = thief.x; thief.prevY = thief.y;
  return true;
}

function useThiefAiAbility(thief, threatDistance) {
  if (thief.abilityCooldown > 0 || threatDistance > 330 || thief.hidden || thief.stunned > 0) return;
  const away = thief.x < state.player.x ? -1 : 1;
  let used = true;
  if (thief.id === "clawster") {
    thief.boostTimer = 1.05; thief.vx = away * 235; chooseThiefRoamTarget(thief, true);
  } else if (thief.id === "lairy") {
    thief.boostTimer = 1.15; thief.vx = away * 150; thief.vy = Math.min(thief.vy, -390); thief.onGround = false;
  } else if (thief.id === "gramp" && threatDistance < 235) {
    state.player.stunned = Math.max(state.player.stunned, .62); thief.boostTimer = .72;
  } else if (thief.id === "strappy") {
    thief.face = -away; thief.invisible = .42; thief.boostTimer = 1.15; thief.vx = away * 210; chooseThiefRoamTarget(thief, true);
  } else if (thief.id === "trasselsudd") {
    thief.invisible = 1.45; thief.boostTimer = .78;
  } else used = false;
  if (!used) return;
  thief.abilityCooldown =
  Math.max(
    4.7,
    Math.max(
      5.4,
      CHARACTERS[thief.id].cooldown * .7,
    ) - difficultyStep() * .38,
  ) +
  Math.random() * 2.2;
  thief.pulse = .48; burst(thief.x + thief.w / 2, thief.y + thief.h / 2, CHARACTERS[thief.id].color, 10);
}

function updateThiefAi(enemy, dt) {
  if (!enemy.active || !state.running) return;
  enemy.aiTimer -= dt; enemy.aiJump -= dt; enemy.decisionTimer -= dt; enemy.abilityCooldown -= dt;
  enemy.lootCooldown = Math.max(0, enemy.lootCooldown - dt);
  enemy.invisible = Math.max(0, enemy.invisible - dt); enemy.boostTimer = Math.max(0, enemy.boostTimer - dt);
  const threatDistance = distance(enemy, state.player);

  if (enemy.hidden) {
    enemy.prevX = enemy.x; enemy.prevY = enemy.y; enemy.hideTimer -= dt;
    if (threatDistance < 112) enemy.hideReveal += dt; else enemy.hideReveal = Math.max(0, enemy.hideReveal - dt * .7);
    if (enemy.hideReveal > .72) leaveThiefHideSpot(enemy, true);
    else if (enemy.hideTimer <= 0 && threatDistance > 105) leaveThiefHideSpot(enemy);
    return;
  }

  if (enemy.decisionTimer <= 0) {
    enemy.decisionTimer = .55 + Math.random() * 1.05;
    if (!tryThiefHide(enemy, threatDistance)) {
      if (threatDistance < 335 || !enemy.roamTarget || Math.random() < .36) chooseThiefRoamTarget(enemy, true);
      useThiefAiAbility(enemy, threatDistance);
    }
  }

  if (!enemy.roamTarget) chooseThiefRoamTarget(enemy);
  enemy.roamTimer -= dt;
  let dx = enemy.roamTarget.x - enemy.x; let dy = enemy.roamTarget.y - enemy.y;
  if (Math.abs(dx) < 18 && Math.abs(dy) < 30 || enemy.roamTimer <= 0) {
    chooseThiefRoamTarget(enemy, true); dx = enemy.roamTarget.x - enemy.x; dy = enemy.roamTarget.y - enemy.y;
  }
  const controls = { jumpHeld: true };
  const climb = enemy.roamTarget.viaClimb;
  if (enemy.climbing) controls.up = true;
  else if (climb && dy < -35) {
    const climbDx = climb.x + climb.w / 2 - (enemy.x + enemy.w / 2);
    controls.left = climbDx < -7; controls.right = climbDx > 7; controls.up = Math.abs(climbDx) <= 10;
  } else {
    let direction = Math.sign(dx || enemy.face);
    if (threatDistance < 245 && Math.abs(state.player.y - enemy.y) < 130) direction = enemy.x < state.player.x ? -1 : 1;
    controls.left = direction < 0; controls.right = direction > 0;
  }
  const targetSock = state.items.find((item) => item.index === enemy.lootTarget && !item.collected);
  const sockNeedsJump = targetSock && Math.abs(targetSock.x - (enemy.x + enemy.w / 2)) < 74 && targetSock.y < enemy.y + enemy.h * .3;
  if (sockNeedsJump && enemy.onGround && enemy.aiJump <= 0) { enemy.jumpBuffer = .12; enemy.aiJump = .75 + Math.random() * .45; }
  if (!climb && dy < -38 && enemy.onGround && enemy.aiJump <= 0) { enemy.jumpBuffer = .12; enemy.aiJump = .7 + Math.random() * .7; }
  const speed =
  (threatDistance < 320 ? .79 : enemy.roamSpeed) *
  (enemy.boostTimer > 0 ? 1.2 : 1) *
  (1 + difficultyStep() * .06);
  updateEntity(enemy, dt, controls, speed);

  enemy.stuckCheckTimer -= dt;
if (enemy.stuckCheckTimer <= 0) {
  if (Math.hypot(enemy.x - enemy.stuckX, enemy.y - enemy.stuckY) < 3.5) {
    if (enemy.climbing) {
      enemy.climbing = false; enemy.ledgePull = .34; enemy.face *= -1; enemy.vx = enemy.face * 110; enemy.vy = -135;
    } else {
      chooseThiefRoamTarget(enemy, true); enemy.face = Math.sign(enemy.roamTarget.x - enemy.x) || -enemy.face || 1; enemy.vx = enemy.face * 90;
      if (enemy.onGround) enemy.jumpBuffer = .12;
    }
  }
  enemy.stuckX = enemy.x; enemy.stuckY = enemy.y; enemy.stuckCheckTimer = .55 + Math.random() * .35;
}

  if (!enemy.hidden && enemy.invisible <= 0 && overlaps(state.player, enemy, 5)) catchEnemy(enemy);
  if (!enemy.active || !state.running) return;
  const sock = state.items.find((item) => item.kind === "sock" && !item.collected && overlaps(enemy, { x: item.x - 13, y: item.y - 13, w: 26, h: 26 }, 2));
  if (sock && enemy.lootCooldown <= 0) stealSock(enemy, sock);
}

function updateEnemies(dt) {
  if (state.selectedId === "draco") state.enemies.forEach((enemy) => updateThiefAi(enemy, dt));
  else state.enemies.forEach((enemy) => updateDraco(enemy, dt));
}

function updateEffects(dt) {
  if (state.decoy) { state.decoy.time -= dt; if (state.decoy.time <= 0) state.decoy = null; }
  state.particles.forEach((particle) => { particle.life -= dt; particle.x += particle.vx * dt; particle.y += particle.vy * dt; particle.vy += 150 * dt; });
  state.particles = state.particles.filter((particle) => particle.life > 0);
  state.dust.forEach((dust) => { dust.y -= dust.speed * dt; if (dust.y < 80) dust.y = GAME.height; });
  state.enemies.forEach((enemy) => { enemy.pulse = Math.max(0, (enemy.pulse || 0) - dt); });
  if (state.hintTimer > 0) { state.hintTimer -= dt; if (state.hintTimer <= 0) dom.hint.classList.add("hidden"); }
  if (false && !state.hidden) {
    const nextIndex = state.level.tutorial.findIndex((hint, index) => index > state.currentHint && state.player.x >= hint.x);
    if (nextIndex >= 0) { state.currentHint = nextIndex; showHint(state.level.tutorial[nextIndex].text, 3.3); }
  }
}

function update(dt) {
  state.elapsed+=dt;
  mpValidateWorld();
  state.remaining=Math.max(0,state.remaining-dt);
  if(state.slowTimer>0)state.slowTimer=Math.max(0,state.slowTimer-dt);
  if(state.noise){state.noise.time-=dt;if(state.noise.time<=0)state.noise=null;}
  tickHeist(state.heist,dt);
  state.vaultLockdown=Math.max(0,(state.vaultLockdown||0)-dt);
  mpTickRelay(dt);
  state.nextSupplyDrop-=dt;
  if(state.nextSupplyDrop<=0 && state.remaining>15){
    mpSpawnSupplyDrop();
    state.nextSupplyDrop=34;
  }
  state.nextSockWave-=dt;
  if(state.nextSockWave<=0 && state.remaining>14){
    mpSpawnSockWave();
    state.nextSockWave=24;
  }
  if(!state.finalRush && state.remaining<=20){
    state.finalRush=true;
    state.heist.frenzy=Math.max(state.heist.frenzy,14);
    state.heist.cooldown=Math.max(state.heist.cooldown,21);
    showHint('FINAL RUSH! Draco is hunting. Every point counts!',3.2);
  }
  mpUpdatePlayers(dt);
  state.enemies.forEach(enemy=>{
    try{mpGuardianUpdate(enemy,dt);}
    catch(error){console.error('[TTHC] Guardian recovered from update error:',error);mpSafePosition(enemy,state.level.playerSpawn.guard,'Draco');enemy._navTransit=null;enemy.mode='patrol';enemy.suspicion=0;}
  });
  const stillPlaying=state.mpPlayers.filter(player=>player.active);
  if(stillPlaying.length===0){
    finishLevel(true,'Draco caught everybody. Highest score among the caught thieves decides the match.');
    return;
  }
  if(stillPlaying.length===1 && !state.lastThiefWarned && state.elapsed>=25 && state.mpPlayers.length>1){
    state.lastThiefWarned=true;
    state.remaining=Math.min(state.remaining,16);
    showHint('LAST THIEF STANDING! 16-second final dash to claim the win!',3.5);
  }
  updateEffects(dt);
  mpValidateWorld();
  updateHud();
  if(state.remaining<=0) finishLevel(true);
}

function useAbility() { mpAbility(state.player); }

function collectItem(item, collector=state.player) {
  if(item.collected || !collector?.active)return;
  item.collected=true;state.collected++;
  collector.loot++;
  let comboMessageV4='';
  const lootFamily=item.premium?'gold':item.kind==='sock'?'sock':'supply';
  if(Number.isFinite(collector.mpLastPickupTimeV4) && state.elapsed-collector.mpLastPickupTimeV4<=10 && collector.mpLastPickupFamilyV4!==lootFamily) {
    collector.points+=3;
    collector.mpLastPickupTimeV4=-1000;
    collector.mpLastPickupFamilyV4='';
    collector.mpComboCountV4=(collector.mpComboCountV4||0)+1;
    comboMessageV4=' QUICK SWAP +3 HP!';
    if(recordHeistCombo(state.heist,collector))comboMessageV4+=' +4 CONTRACT!';
  } else {
    collector.mpLastPickupTimeV4=state.elapsed;
    collector.mpLastPickupFamilyV4=lootFamily;
  }
  if(item.premium){collector.points+=6;collector.energy=Math.min(5,collector.energy+1);}
  else if(item.kind==='sock'){collector.points+=1;collector.cargo=Math.min(4,(collector.cargo||0)+1);collector.energy=Math.min(5,collector.energy+1);}
  else {collector.points++;collector.tools=Math.min(3,collector.tools+1);collector.energy=Math.min(5,collector.energy+1);}
  const heistMessage=recordHeistPickup(state.heist,collector,item);
  burst(item.x,item.y,CHARACTERS[collector.id].color,12);
  emitNoise(item.x,item.premium?.38:.12);
  showHint((heistMessage || collector.displayName+' picked up '+(item.premium?'GOLD SOCK':item.kind.toUpperCase())+'!')+comboMessageV4+' · '+collector.points+' HP',heistMessage||comboMessageV4?2.6:1.7);
}

function guardSockItems() { return state.items.filter((item) => item.kind === "sock"); }
function guardSockTotal() { return guardSockItems().length; }
function sockGoalText(count) { return count === 1 ? "the last sock" : `all ${count} socks`; }

function stealSock(thief, item) {
  if (item.collected || !thief.active || !state.running) return;

  item.collected = true;
  state.collected += 1;

  thief.lootCooldown =
  Math.max(4.4, 5.9 - difficultyStep() * .42) +
  Math.random() * 2.8;

  state.enemies.forEach((enemy) => {
    if (enemy.lootTarget === item.index) {
      enemy.lootTarget = -1;
    }
  });

  burst(
    item.x,
    item.y,
    CHARACTERS[thief.id].color,
    14,
  );

  showHint(
    `${CHARACTERS[thief.id].name} stole a sock · ${state.collected}/${guardSockTotal()}`,
    1.8,
  );

  if (state.collected >= guardSockTotal()) {
    finishLevel(false, "The Crew stole every sock.");
  } else {
    chooseThiefRoamTarget(thief, true);
  }
}

function catchEnemy(enemy) {
  if (!enemy.active || enemy.hidden || enemy.invisible > 0 || !state.running) return; enemy.active = false; state.caught += 1;
  burst(enemy.x + enemy.w / 2, enemy.y + enemy.h / 2, CHARACTERS[enemy.id].color, 16);
  showHint(`${CHARACTERS[enemy.id].name} caught · ${state.caught}/${state.level.catches}`, 1.8);
  if (state.caught >= state.level.catches) finishLevel(true);
}

function resetDracoAfterCatch() {
  const draco = state.enemies.find((enemy) => enemy.id === "draco"); if (!draco) return;
  const spawn = state.level.playerSpawn.guard; draco.x = spawn[0]; draco.y = spawn[1]; draco.vx = 0; draco.vy = 0;
  draco.mode = "patrol"; draco.suspicion = 0; chooseDracoRoamTarget(draco, true);
}

function takeDamage(message) { mpDamage(state.player,message); }

function burst(x, y, color, amount) {
  for (let index = 0; index < amount; index += 1) {
    const angle = Math.PI * 2 * index / amount + Math.random() * .35; const speed = 45 + Math.random() * 145;
    state.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 30, life: .42 + Math.random() * .4, maxLife: .82, color, size: 1.5 + Math.random() * 3 });
  }
}

function showHint(text, duration = 2.5) { dom.hint.textContent = text; dom.hint.classList.remove("hidden"); state.hintTimer = duration; }

function updateStealthHud() {
  const draco=state.enemies[0];if(!draco)return;
  dom.stealth.className='stealth-hud '+(draco.mode==='chase'?'chase':draco.mode==='alert'?'wary':'safe');
  dom.stealthIcon.textContent=draco.mode==='chase'?'!':'◉';
  dom.stealthState.textContent=draco.mode==='chase'?'DRACO IS CHASING':'DRACO IS PATROLLING';
  dom.stealthTip.textContent='Shared threat · every thief can be targeted';
  dom.stealthFill.style.width=(100*draco.suspicion)+'%';
}

function updateHud() {
  if(!state.level || !state.mpPlayers?.length)return;
  dom.level.textContent='MULTIPLAYER';dom.place.textContent=state.level.name;
  dom.role.textContent=online.connected?'HEIST CIRCUIT · ONLINE':'HEIST CIRCUIT';
  if(online.connected){
    dom.objective.textContent=state.collected+' PICKUPS · '+state.items.length+' AVAILABLE';
    dom.progress.style.width=Math.min(100,Math.max(0,state.mpPlayers.some(p=>p.cargo>0)?Math.max(...state.mpPlayers.map(p=>p.cargo))*25:0))+'%';
  }else{
    dom.objective.textContent=state.collected+'/'+state.items.length+' SHARED LOOT';
    dom.progress.style.width=(100*state.collected/state.items.length)+'%';
  }
  const me=online.connected ? state.mpPlayers.find(p=>p.remoteSlot===online.slot)||state.player : state.player;
  const secs=Math.ceil(state.remaining);
  dom.time.textContent=Math.floor(secs/60)+':'+String(secs%60).padStart(2,'0');
  dom.hearts.textContent=me.active?me.displayName+' '+me.points+' HP · '+me.lives+' LIVES · BAG '+me.cargo+'/4':me.displayName+' OUT · SPECTATING';
  dom.abilityName.textContent=CHARACTERS[me.id].ability;
  dom.abilityState.textContent=me.energy+' ENERGY · '+me.tools+' TOOLS';
  dom.abilityFill.style.transform='scaleX('+Math.min(1,me.energy/5)+')';
  updateStealthHud();
  mpUpdateDashboard();
}

let lastDashboardRender=0;
function mpUpdateDashboard() {
  const root=$('#heistDashboard');
  if(!root||!state.heist||!state.mpPlayers.length||!state.running)return;
  const now=performance.now();
  if(now-lastDashboardRender<180)return;
  lastDashboardRender=now;
  const mode=state.heist;
  const alarm=$('#mpDashAlarm'),vault=$('#mpDashVault'),supply=$('#mpDashSupply');
  const contracts=$('#mpDashContracts'),players=$('#mpDashPlayers');
  const frenzy=mode.frenzy>0;
  alarm.innerHTML='<span>'+(frenzy?'🚨 DRACO ALERT '+Math.ceil(mode.frenzy)+'s':'ALARM '+Math.round(mode.heat)+'%')+'</span><span class="mp-dash-bar"><i style="width:'+Math.min(100,Math.max(0,mode.heat))+'%"></i></span>';
  const opened=state.vaults.filter(v=>v.owner!==null).length;
  vault.textContent='JACKPOTS '+opened+'/'+state.vaults.length+' FIRED · 2 TOOLS → 3 GOLD SOCKS + 3 HP'+(state.vaultLockdown>0?' · RECHARGING '+Math.ceil(state.vaultLockdown)+'s':'');
  supply.textContent='RELAY '+Math.ceil(state.relay?.timer||0)+'s · SOCKS '+Math.ceil(Math.max(0,state.nextSockWave))+'s · TOOLS '+Math.ceil(Math.max(0,state.nextSupplyDrop))+'s';
  contracts.innerHTML=mode.contracts.map(c=>{
    const owner=state.mpPlayers.find(p=>p.mpIndex===c.owner);
    const race=state.mpPlayers.map(p=>({name:p.displayName,done:Math.min(c.goal,p.contractCounters?.[c.id]||0)}))
      .sort((a,b)=>b.done-a.done).slice(0,2).map(p=>p.name+' '+p.done+'/'+c.goal).join(' · ');
    return '<div class="mp-dash-contract'+(owner?' claimed':'')+'"><strong>'+c.name+'</strong><span>'+(owner?'Won by '+owner.displayName:'+'+c.reward+' HP · '+race)+'</span></div>';
  }).join('');
  players.innerHTML=state.mpPlayers.map(p=>'<div class="mp-dash-player" style="--mp-player-color:'+CHARACTERS[p.id].color+'"><strong>'+p.displayName+' · '+CHARACTERS[p.id].name+'</strong><span>★'+p.points+' ❤'+p.lives+(p.active?'':' · OUT')+' BAG '+p.cargo+'/4 · ⚡'+p.energy+' ⚒'+p.tools+'</span></div>').join('');
}

function drawBackdrop() {
  const room = rooms.get(state.level.id); if (room) ctx.drawImage(room, 0, 0, GAME.width, GAME.height);
  ctx.fillStyle = "rgba(2, 8, 14, .08)"; ctx.fillRect(0, 0, GAME.width, GAME.height);
  state.dust.forEach((dust) => {
    ctx.globalAlpha = .12 + dust.r * .05; ctx.fillStyle = "#d9edf7";
    ctx.beginPath(); ctx.arc(dust.x, dust.y, dust.r, 0, Math.PI * 2); ctx.fill();
  }); ctx.globalAlpha = 1;
}

function drawRoomCues() {
  const playerCenter =
    state.player.x + state.player.w / 2;

  const playerFeet =
    state.player.y + state.player.h;

  const furniture = state.level.surfaces.filter(
    (surface) => surface.type !== "floor"
  );

  /*
   * Find only the closest usable furniture surface.
   * The room image remains the visible level.
   * No permanent platform outlines are drawn.
   */
  const nearestSurface = furniture.reduce(
    (nearest, surface) => {
      const bounds = walkableSurfaceBounds(surface);

      const horizontalGap =
        playerCenter < bounds.left
          ? bounds.left - playerCenter
          : playerCenter > bounds.right
            ? playerCenter - bounds.right
            : 0;

      const score =
        horizontalGap +
        Math.abs(playerFeet - surface.y) * .55;

      return !nearest || score < nearest.score
        ? { surface, bounds, score }
        : nearest;
    },
    null
  );

  /*
   * A soft local light appears on the closest furniture
   * edge only when the player is close enough.
   */
  if (nearestSurface && nearestSurface.score < 145) {
    const { surface, bounds, score } = nearestSurface;

    const pulse =
      .72 + Math.sin(state.elapsed * 4.2) * .16;

    const glow = ctx.createLinearGradient(
      bounds.left,
      surface.y,
      bounds.right,
      surface.y
    );

    glow.addColorStop(0, "rgba(120,220,246,0)");
    glow.addColorStop(
      .18,
      `rgba(150,230,250,${.18 * pulse})`
    );
    glow.addColorStop(
      .5,
      `rgba(218,248,255,${.34 * pulse})`
    );
    glow.addColorStop(
      .82,
      `rgba(150,230,250,${.18 * pulse})`
    );
    glow.addColorStop(1, "rgba(120,220,246,0)");

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.shadowColor = "rgba(120,220,246,.65)";
    ctx.shadowBlur = 24;
    ctx.fillStyle = glow;

    ctx.fillRect(
      bounds.left,
      surface.y - 7,
      Math.max(1, bounds.right - bounds.left),
      14
    );

    ctx.restore();

    if (score < 105 && surface.label) {
      const action =
        playerFeet > surface.y + 35
          ? "JUMP"
          : "ROUTE";

      const label =
        `${action} · ${surface.label.toUpperCase()}`;

      ctx.save();
      ctx.font = "900 10px system-ui";

      const tagWidth = Math.min(
        190,
        ctx.measureText(label).width + 22
      );

      const labelX = clamp(
        playerCenter,
        tagWidth / 2 + 8,
        GAME.width - tagWidth / 2 - 8
      );

      ctx.fillStyle = "rgba(4,13,22,.76)";

      ctx.fillRect(
        labelX - tagWidth / 2,
        surface.y - 29,
        tagWidth,
        20
      );

      ctx.fillStyle = "#d9f7ff";
      ctx.textAlign = "center";

      ctx.fillText(
        label,
        labelX,
        surface.y - 15
      );

      ctx.restore();
    }
  }

  /*
   * Find the closest fabric, handle, pipe or other
   * climbable part of the actual room.
   */
  const nearestClimb = state.level.climbs.reduce(
    (nearest, climb) => {
      const center = climb.x + climb.w / 2;

      const verticalGap =
        playerFeet < climb.y
          ? climb.y - playerFeet
          : playerFeet > climb.y + climb.h
            ? playerFeet - (climb.y + climb.h)
            : 0;

      const score =
        Math.abs(playerCenter - center) +
        verticalGap * .55;

      return !nearest || score < nearest.score
        ? { climb, center, score }
        : nearest;
    },
    null
  );

  /*
   * The climbable object glows only while nearby.
   */
  if (nearestClimb && nearestClimb.score < 105) {
    const { climb, center, score } = nearestClimb;

    const pulse =
      .68 + Math.sin(state.elapsed * 4.8) * .14;

    const glow = ctx.createRadialGradient(
      center,
      playerFeet,
      4,
      center,
      playerFeet,
      Math.max(70, climb.w * 1.8)
    );

    glow.addColorStop(
      0,
      `rgba(132,222,248,${.3 * pulse})`
    );

    glow.addColorStop(
      1,
      "rgba(132,222,248,0)"
    );

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = glow;

    ctx.fillRect(
      climb.x - 36,
      climb.y,
      climb.w + 72,
      climb.h
    );

    ctx.restore();

    if (score < 76) {
      const label = coarsePointer.matches
        ? "↑↓  CLIMB"
        : "W/S  CLIMB";

      const labelY = clamp(
        playerFeet - 55,
        climb.y + 20,
        climb.y + climb.h - 10
      );

      ctx.save();
      ctx.fillStyle = "rgba(5,14,23,.78)";

      ctx.fillRect(
        center - 47,
        labelY - 15,
        94,
        20
      );

      ctx.fillStyle = "#bdeeff";
      ctx.font = "900 10px system-ui";
      ctx.textAlign = "center";

      ctx.fillText(
        label,
        center,
        labelY - 1
      );

      ctx.restore();
    }
  }

  /*
   * Calculate the closest hiding place without
   * drawing any permanent rectangle around it.
   */
  const hideCandidates = state.level.hideSpots
    .map((spot) => {
      const dx = Math.max(
        spot.x - playerCenter,
        0,
        playerCenter - (spot.x + spot.w)
      );

      const dy = Math.max(
        spot.y - playerFeet,
        0,
        playerFeet - (spot.y + spot.h)
      );

      return {
        spot,
        gap: Math.hypot(dx, dy),
      };
    })
    .sort((a, b) => a.gap - b.gap);

  const closestHide = hideCandidates[0];

  const usableHide =
    state.selectedId !== "draco" && !state.hidden
      ? nearbyHideSpot()
      : null;

  const activeHide =
    usableHide ||
    (closestHide?.gap < 78
      ? closestHide.spot
      : null);

  /*
   * The hiding place gets a soft violet glow only
   * when the player is close. No border is drawn.
   */
  if (activeHide && !state.hidden) {
    const centerX =
      activeHide.x + activeHide.w / 2;

    const centerY =
      activeHide.y + activeHide.h * .68;

    const radius = Math.max(
      70,
      activeHide.w * .65
    );

    const pulse =
      .72 + Math.sin(state.elapsed * 4.4) * .16;

    const glow = ctx.createRadialGradient(
      centerX,
      centerY,
      4,
      centerX,
      centerY,
      radius
    );

    glow.addColorStop(
      0,
      `rgba(205,126,232,${.32 * pulse})`
    );

    glow.addColorStop(
      .46,
      `rgba(154,77,184,${.18 * pulse})`
    );

    glow.addColorStop(
      1,
      "rgba(111,53,132,0)"
    );

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = glow;

    ctx.fillRect(
      centerX - radius,
      centerY - radius,
      radius * 2,
      radius * 2
    );

    ctx.restore();

    const action =
      state.selectedId === "draco"
        ? "SEARCH"
        : coarsePointer.matches
          ? "HIDE"
          : "Q  HIDE";

    const label =
      `${action} · ${activeHide.label.toUpperCase()}`;

    ctx.save();
    ctx.font = "900 10px system-ui";

    const tagWidth = Math.min(
      220,
      Math.max(
        70,
        ctx.measureText(label).width + 20
      )
    );

    const labelX = clamp(
      centerX,
      tagWidth / 2 + 8,
      GAME.width - tagWidth / 2 - 8
    );

    ctx.fillStyle = "rgba(15,6,20,.78)";

    ctx.fillRect(
      labelX - tagWidth / 2,
      activeHide.y - 24,
      tagWidth,
      19
    );

    ctx.fillStyle = "#efd1f8";
    ctx.textAlign = "center";

    ctx.fillText(
      label,
      labelX,
      activeHide.y - 11
    );

    ctx.restore();
  }

  /*
   * Noise zones also remain hidden until the player
   * is close enough to notice them.
   */
  state.level.noiseZones.forEach((zone, index) => {
    const close =
      playerCenter > zone.x - 90 &&
      playerCenter < zone.x + zone.w + 90 &&
      Math.abs(playerFeet - zone.y) < 85;

    if (!close) {
      return;
    }

    const glow = ctx.createLinearGradient(
      zone.x,
      zone.y,
      zone.x + zone.w,
      zone.y
    );

    const alpha =
      .13 + Math.sin(state.elapsed * 3 + index) * .035;

    glow.addColorStop(
      0,
      "rgba(243,181,92,0)"
    );

    glow.addColorStop(
      .5,
      `rgba(243,181,92,${alpha})`
    );

    glow.addColorStop(
      1,
      "rgba(243,181,92,0)"
    );

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = glow;

    ctx.fillRect(
      zone.x,
      zone.y - 8,
      zone.w,
      16
    );

    ctx.restore();
  });
}

function drawVision() {
  if (state.selectedId === "draco") return;
  const draco = state.enemies[0]; if (!draco?.active) return;
  const originX = draco.x + draco.w / 2; const originY = draco.y + draco.h * .32;
  const length = draco.mode === "chase" ? 370 : 285; const spread = draco.mode === "chase" ? 145 : 105;
  const endX = originX + draco.face * length; const gradient = ctx.createLinearGradient(originX, originY, endX, originY);
  gradient.addColorStop(0, draco.mode === "chase" ? "rgba(255,63,73,.19)" : "rgba(104,205,240,.11)"); gradient.addColorStop(1, "transparent");
  ctx.fillStyle = gradient; ctx.beginPath(); ctx.moveTo(originX, originY); ctx.lineTo(endX, originY - spread); ctx.lineTo(endX, originY + spread); ctx.closePath(); ctx.fill();
}

function drawHazards() {
  state.level.hazards.forEach((hazard, index) => {
    const pulse = .55 + Math.sin(state.elapsed * 5 + index) * .2;
    ctx.strokeStyle = hazard.kind === "hot" ? `rgba(255,79,61,${pulse})` : `rgba(255,166,85,${pulse})`; ctx.lineWidth = 3;
    for (let x = hazard.x + 6; x < hazard.x + hazard.w; x += 16) {
      ctx.beginPath(); ctx.moveTo(x, hazard.y + 5); ctx.bezierCurveTo(x - 6, hazard.y - 10, x + 7, hazard.y - 20, x, hazard.y - 34); ctx.stroke();
    }
  });
}

function drawExit() {
  if (state.selectedId === "draco") return;
  const exit = state.level.exit; const unlocked = state.collected === state.items.length;
  ctx.save(); ctx.globalAlpha = unlocked ? .95 : .42; ctx.shadowBlur = unlocked ? 28 : 8; ctx.shadowColor = unlocked ? "#ff9d3b" : "#82909a";
  ctx.strokeStyle = unlocked ? "#ffad4e" : "#83919a"; ctx.lineWidth = 4; ctx.setLineDash(unlocked ? [] : [7, 7]); ctx.strokeRect(exit.x, exit.y, exit.w, exit.h); ctx.setLineDash([]);
  ctx.fillStyle = unlocked ? "#ffc56a" : "#9aa6ad"; ctx.font = "900 10px system-ui"; ctx.textAlign = "center"; ctx.fillText(unlocked ? "ESCAPE" : "LOCKED", exit.x + exit.w / 2, exit.y - 9); ctx.restore();
}

function traceSockShape() {
  ctx.beginPath();
  ctx.moveTo(-7, -12);
  ctx.lineTo(6, -12);
  ctx.lineTo(5, 1);
  ctx.quadraticCurveTo(14, 1, 13, 8);
  ctx.quadraticCurveTo(7, 14, -6, 9);
  ctx.lineTo(-3, 2);
  ctx.closePath();
}

function drawProtectedSock(item, y) {
  const pulse =
    1 +
    Math.sin(
      state.elapsed * 3.4 + item.phase,
    ) * .045;

  ctx.save();
  ctx.translate(item.x, y);
  ctx.scale(pulse, pulse);

  ctx.shadowColor = "#67d8ff";
  ctx.shadowBlur = 18;
  ctx.fillStyle = "rgba(8,45,68,.88)";
  ctx.strokeStyle = "#8be3ff";
  ctx.lineWidth = 2.4;

  ctx.beginPath();

  for (let index = 0; index < 6; index += 1) {
    const angle =
      Math.PI / 3 * index -
      Math.PI / 2;

    const x = Math.cos(angle) * 21;
    const pointY = Math.sin(angle) * 21;

    if (index === 0) {
      ctx.moveTo(x, pointY);
    } else {
      ctx.lineTo(x, pointY);
    }
  }

  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.shadowBlur = 5;
  ctx.fillStyle = "#bfefff";
  ctx.strokeStyle = "#14384c";
  ctx.lineWidth = 2;

  ctx.save();
  ctx.scale(.76, .76);
  traceSockShape();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  ctx.shadowBlur = 0;
  ctx.fillStyle = "#dff8ff";
  ctx.font = "900 8px system-ui";
  ctx.textAlign = "center";
  ctx.fillText("PROTECT", 0, -29);

  ctx.restore();
}

function drawItem(item) {
  if (
    item.collected ||
    (
      state.selectedId === "draco" &&
      item.kind !== "sock"
    )
  ) {
    return;
  }

  const y =
    item.y +
    Math.sin(
      state.elapsed * 3.1 + item.phase,
    ) * 4;

  if (item.protected) {
    drawProtectedSock(item, y);
    return;
  }

  ctx.save();
  ctx.translate(item.x, y);
  ctx.shadowBlur = 16;
  ctx.shadowColor = "#ffad4b";
  ctx.fillStyle = "#ffc269";
  ctx.strokeStyle = "#5d2e0c";
  ctx.lineWidth = 2;

  if (item.kind === "sock") {
    traceSockShape();
    ctx.fill();
    ctx.stroke();
  } else if (item.kind === "key") {
    ctx.beginPath();
    ctx.arc(-6, -4, 6, 0, Math.PI * 2);
    ctx.moveTo(0, 0);
    ctx.lineTo(13, 10);
    ctx.lineTo(9, 14);
    ctx.lineTo(5, 9);
    ctx.stroke();
  } else if (item.kind === "button") {
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#6b3510";

    [[-3,-3], [3,-3], [-3,3], [3,3]].forEach(([dx, dy]) => {
      ctx.beginPath();
      ctx.arc(dx, dy, 1.5, 0, Math.PI * 2);
      ctx.fill();
    });
  } else if (item.kind === "spoon") {
    ctx.beginPath();
    ctx.ellipse(-4, -6, 6, 9, -.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(11, 14);
    ctx.stroke();
  } else if (item.kind === "spool") {
    ctx.fillRect(-8, -9, 16, 18);
    ctx.strokeRect(-8, -9, 16, 18);
    ctx.strokeStyle = "#c65f28";

    for (let yy = -6; yy <= 6; yy += 4) {
      ctx.beginPath();
      ctx.moveTo(-7, yy);
      ctx.lineTo(7, yy);
      ctx.stroke();
    }
  } else if (item.kind === "remote") {
    ctx.rotate(-.22);
    ctx.fillStyle = "#e6d1a2";
    ctx.fillRect(-7, -13, 14, 26);
    ctx.strokeRect(-7, -13, 14, 26);
    ctx.fillStyle = "#6b3510";

    for (let yy = -8; yy < 8; yy += 6) {
      ctx.beginPath();
      ctx.arc(0, yy, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.beginPath();
    ctx.moveTo(-11, -5);
    ctx.quadraticCurveTo(0, -14, 11, -5);
    ctx.lineTo(6, 8);
    ctx.quadraticCurveTo(0, 3, -6, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}

function getCharacterFrame(entity) {
  if (entity.climbing || entity.ledgePull > 0) return 4;
  if (!entity.onGround) return 3;
  if (Math.abs(entity.vx) > 26) return 1 + (Math.floor(entity.animDistance / 24) % 2);
  if (entity.id === "draco" && (entity.mode === "alert" || entity.mode === "search" || entity.suspicion > .18)) return 5;
  return 0;
}

function drawCharacter(entity, interpolation = 1, alpha = 1) {
  if (!entity || entity.active === false) return;
  const character = CHARACTERS[entity.id];
  if (!character) return;
  const frames = sprites.get(entity.id);
  const frameIndex = getCharacterFrame(entity);
  const sprite = frames?.[frameIndex] || frames?.[0];
  const xNow = Number.isFinite(entity.x) ? entity.x : Number.isFinite(entity.prevX) ? entity.prevX : 0;
  const yNow = Number.isFinite(entity.y) ? entity.y : Number.isFinite(entity.prevY) ? entity.prevY : 0;
  const xPrev = Number.isFinite(entity.prevX) ? entity.prevX : xNow;
  const yPrev = Number.isFinite(entity.prevY) ? entity.prevY : yNow;
  const t = Number.isFinite(interpolation) ? clamp(interpolation,0,1) : 1;
  const x=lerp(xPrev,xNow,t), y=lerp(yPrev,yNow,t);
  const phase = Number.isFinite(entity.idlePhase) ? entity.idlePhase : 0;
  const clock = Number.isFinite(state.elapsed) ? state.elapsed : 0;
  const distanceTravelled = Number.isFinite(entity.animDistance) ? entity.animDistance : 0;
  const vx = Number.isFinite(entity.vx) ? entity.vx : 0;
  const vy = Number.isFinite(entity.vy) ? entity.vy : 0;
  const w = Number.isFinite(entity.w) && entity.w>0 ? entity.w : character.width;
  const h = Number.isFinite(entity.h) && entity.h>0 ? entity.h : character.height;
  const face = entity.face === -1 ? -1 : 1;
  const moving=Math.abs(vx)>24;
  const bob=entity.onGround&&moving ? -2.2*Math.abs(Math.sin(distanceTravelled*.23)) : Math.sin(clock*2.6+phase)*.7;
  const breath=moving?0:Math.sin(clock*2.4+phase)*.012;
  const stretch=clamp(Math.abs(vy)/1600,0,.09),land=Number.isFinite(entity.landSquash)?entity.landSquash*.12:0;
  const scaleY=1+stretch-land+breath, scaleX=1-stretch*.5+land*.65-breath*.5;
  const drawH=character.drawHeight;
  const drawW=sprite?.width>0&&sprite?.height>0?drawH*(sprite.width/sprite.height):w;
  const centerX=x+w/2, bottom=y+h+bob;
  const hidden=!!entity.hidden;
  const invis=Number.isFinite(entity.invisible)?entity.invisible:0;
  const concealment=hidden?.34:invis>0?.36+Math.sin(clock*18)*.04:1;
  const cooldown=Number.isFinite(entity.damageCooldown)?entity.damageCooldown:0;
  const pulse=cooldown>0&&entity.id!=='draco'?.64+.23*Math.sin(clock*17):1;
  const stun=Number.isFinite(entity.stunned)?entity.stunned:0;
  const opacity=clamp((Number.isFinite(alpha)?alpha:1)*concealment*pulse*(stun>0&&Math.floor(clock*14)%2?.38:1),.28,1);
  ctx.save();
  try {
    ctx.globalAlpha=opacity;
    if(!entity.climbing && !(entity.ledgePull > 0)){
      ctx.fillStyle=entity.onGround?'rgba(0,0,0,.43)':'rgba(0,0,0,.19)';
      ctx.beginPath();ctx.ellipse(centerX,bottom+3,Math.max(12,Math.min(drawW*.34,w*1.05)),entity.onGround?5:3,0,0,Math.PI*2);ctx.fill();
    }
    ctx.translate(centerX,bottom);
    ctx.scale(face*scaleX,scaleY);
    const tilt=entity.onGround?0:clamp(vx/1350,-.13,.13);
    const sway=entity.climbing?Math.sin(distanceTravelled*.18)*.055:0;
    ctx.rotate(sway+tilt+clamp(vx/2700,-.095,.095)*face);
    const focus=online.role==='local'?state.player:state.mpPlayers.find(p=>p.remoteSlot===online.slot);
    ctx.filter=entity===focus?`drop-shadow(0 0 5px ${character.color})`:'drop-shadow(0 3px 3px rgba(0,0,0,.55))';
    if(sprite?.width>0&&sprite?.height>0){
      ctx.drawImage(sprite,-drawW/2,-drawH,drawW,drawH);
    } else {
      // Keep an avatar visible even if a sprite unexpectedly fails to load.
      ctx.fillStyle=character.color;
      ctx.beginPath();ctx.ellipse(0,-h/2,w*.48,h*.47,0,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#1b202c';ctx.font='bold 11px system-ui';ctx.textAlign='center';ctx.fillText(character.name.slice(0,2),0,-h/2+4);
      if(!state._spriteFallbackLogged){console.warn('[TTHC] Used avatar fallback for missing sprite',entity.id);state._spriteFallbackLogged=true;}
    }
  } finally {ctx.restore();}
}

function render(interpolation = 1) {
  if (!state.level) return;
  ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.filter='none';ctx.shadowBlur=0;ctx.clearRect(0,0,GAME.width,GAME.height);
  mpSafeRenderLayer('background',drawBackdrop);
  mpSafeRenderLayer('furniture seams',drawFurnitureSeams);
  mpSafeRenderLayer('climb guides',drawSubtleClimbGuides);
  mpSafeRenderLayer('vision',drawVision);
  mpSafeRenderLayer('room cues',drawRoomCues);
  mpSafeRenderLayer('hazards',drawHazards);
  state.items.forEach(item => {
    mpSafeRenderLayer('item '+item.kind,()=>drawItem(item));
    if(item.collected)return;
    if(item.sockWave && state.elapsed-item.spawnedAt<7){
      ctx.save();ctx.globalAlpha=.55+.2*Math.sin(state.elapsed*7);
      ctx.strokeStyle=item.premium?'#ffe29a':'#ffb7e1';ctx.lineWidth=3;
      ctx.beginPath();ctx.arc(item.x,item.y,20,0,Math.PI*2);ctx.stroke();
      ctx.font='900 10px system-ui';ctx.fillStyle='#fff1d7';ctx.strokeStyle='#132234';ctx.lineWidth=3;
      ctx.textAlign='center';
      const label=item.premium?'NEW GOLD SOCK':'NEW SOCK';
      ctx.strokeText(label,item.x,item.y-30);ctx.fillText(label,item.x,item.y-30);
      ctx.restore();
    }
    if(item.premium || item.supplyDrop){
      ctx.save();ctx.font='900 12px system-ui';ctx.textAlign='center';
      ctx.fillStyle=item.supplyDrop?'#9df1e3':'#fff1a3';
      ctx.strokeStyle='#172032';ctx.lineWidth=3;
      const label=item.supplyDrop?'SUPPLY · +1 TOOL':'GOLD SOCK · +6 HP';
      ctx.strokeText(label,item.x,item.y-28);
      ctx.fillText(label,item.x,item.y-28);ctx.restore();
    }
  });
  mpSafeRenderLayer('jackpot',mpDrawVaults);
  mpSafeRenderLayer('relay',mpDrawRelay);
  // Exit disabled in the multiplayer scoring match.
  if (state.decoy) { const fake = { ...state.player, x: state.decoy.x, y: state.decoy.y, prevX: state.decoy.x, prevY: state.decoy.y, face: state.decoy.face }; drawCharacter(fake, interpolation, .38 + Math.sin(state.elapsed * 12) * .1); }
  state.enemies.forEach((enemy) => mpSafeRenderLayer('enemy '+enemy.id,()=>drawCharacter(enemy, interpolation)));
  state.mpPlayers.slice(1).forEach(player => mpSafeRenderLayer('player '+player.mpIndex,()=>drawCharacter(player, interpolation)));
  if (state.selectedId === "draco") {
    state.enemies.forEach((enemy) => {
      if (!enemy.active || !enemy.hideSpot || distance(enemy, state.player) > 185) return;
      const cx = enemy.hideSpot.x + enemy.hideSpot.w / 2; const cy = enemy.hideSpot.y + enemy.hideSpot.h * .72;
      ctx.save(); ctx.globalAlpha = .24 + Math.sin(state.elapsed * 7 + enemy.idlePhase) * .08;
      ctx.strokeStyle = CHARACTERS[enemy.id].color; ctx.lineWidth = 2; ctx.setLineDash([4, 7]);
      ctx.beginPath(); ctx.ellipse(cx, cy, 24 + enemy.hideReveal * 12, 8 + enemy.hideReveal * 4, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    });
  }
  state.enemies.forEach((enemy) => {
    if (!enemy.active || enemy.pulse <= 0) return;
    const radius = (1 - enemy.pulse / .48) * 75 + 18;
    ctx.save(); ctx.globalAlpha = clamp(enemy.pulse * 1.7, 0, .7); ctx.strokeStyle = CHARACTERS[enemy.id].color; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(enemy.x + enemy.w / 2, enemy.y + enemy.h / 2, radius, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  });
  const playerAlpha = 1;
  mpSafeRenderLayer('player 1',()=>drawCharacter(state.player, interpolation, playerAlpha));
  if (online.role==='local' && state.hidden && state.hiddenSpot) {
    ctx.fillStyle = "rgba(5,14,23,.86)"; ctx.fillRect(state.hiddenSpot.x + state.hiddenSpot.w / 2 - 52, state.hiddenSpot.y + 8, 104, 22);
    ctx.fillStyle = "#bfeeff";
ctx.font = "900 10px system-ui";
ctx.textAlign = "center";

ctx.fillText(
  coarsePointer.matches
    ? "HIDE · LEAVE"
    : "Q  LEAVE",
  state.hiddenSpot.x + state.hiddenSpot.w / 2,
  state.hiddenSpot.y + 23,
);
  }
  if (state.player?.pulse > 0) {
    state.player.pulse = Math.max(0, state.player.pulse - 1 / 60); const radius = (.62 - state.player.pulse) * 270;
    ctx.strokeStyle = `rgba(115,213,247,${state.player.pulse})`; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(state.player.x + state.player.w / 2, state.player.y + state.player.h / 2, radius, 0, Math.PI * 2); ctx.stroke();
  }
  state.particles.forEach((particle) => { ctx.globalAlpha = clamp(particle.life / particle.maxLife, 0, 1); ctx.fillStyle = particle.color; ctx.fillRect(particle.x, particle.y, particle.size, particle.size); }); ctx.globalAlpha = 1;
  // Scoreboard and contracts are rendered in the separate dashboard
  // below the game, so they never cover the platforming playfield.
  state.mpPlayers.forEach(p=>{
    if(!(p.mpType==='human'||(online.connected&&p.remoteSlot===online.slot))||p.hidden||!mpNearbyHide(p)||p.tools<1||p.points-(p.protectedPoints||0)<3||(p.stashes||0)>=2)return;
    ctx.save();ctx.fillStyle='#9cf0c6';ctx.strokeStyle='#07111e';ctx.lineWidth=3;
    ctx.font='bold 13px system-ui';ctx.textAlign='center';
    const message=(MP_KEYMAPS_V4[online.connected?0:p.mpIndex]?.stash?.replace(/^Key/,'') || 'PAD Y')+' : STASH';
    ctx.strokeText(message,p.x+p.w/2,p.y-18);ctx.fillText(message,p.x+p.w/2,p.y-18);ctx.restore();
  });
}

function finishLevel(success, reason='') {
  if(!state.running)return;
  // Dedicated server decides match end and final scores. Browser cannot submit results.
  state.running=false;state.paused=false;setGameChrome(false);
  const order=[...state.mpPlayers].sort((a,b)=>Number(b.active)-Number(a.active)||b.points-a.points||b.tools-a.tools);
  const contenders=order.filter(p=>p.active);
  const eligible=contenders.length?contenders:order;
  const highest=eligible[0];
  const winners=eligible.filter(p=>p.points===highest.points && p.tools===highest.tools);
  $('#resultEyebrow').textContent='MULTIPLAYER RESULTS';
  $('#resultTitle').textContent=winners.length===1?winners[0].displayName+' WINS!':'SHARED VICTORY!';
  $('#resultText').textContent='Only surviving thieves qualify to win. Deliver ordinary socks to the moving Relay Drop for bonus points. Among survivors, most points wins; Tools break ties. '+(reason||'');
  $('#resultStats').innerHTML=order.map(p=>'<span><small>'+p.displayName+' · '+CHARACTERS[p.id].name+'</small><strong>'+p.points+' HP</strong><small>'+(p.active?'SURVIVED':'CAUGHT OUT')+' · '+p.lives+' lives · '+p.tools+' Tools · '+(p.protectedPoints||0)+' Safe · '+(p.contractWins||0)+' Contracts · '+(p.relayDeliveries||0)+' Deliveries</small></span>').join('');
  const primary=$('#resultPrimaryBtn'),secondary=$('#resultSecondaryBtn');
  if(state.levelIndex<LEVELS.length-1){primary.textContent='Next Room';primary.onclick=()=>prepareLevel(state.levelIndex+1);}
  else {primary.textContent='New Match';primary.onclick=()=>{buildLevelCards();showScreen('levels');};}
  secondary.textContent=online.connected?'Return to Online Lobby':'Replay Room';
  secondary.onclick=online.connected?()=>{online.send({type:'reset'});state.running=false;setGameChrome(false);showScreen('select');mpRenderLobby();}:initLevel;
  if(online.connected){primary.textContent=online.role==='host'?'Choose Next Match':'Back to Online Lobby';primary.onclick=online.role==='host'?()=>{online.send({type:'reset'});buildLevelCards();showScreen('levels');}:secondary.onclick;}
  showScreen('result');
}

function goToLevels() { if(online.role==='host'&&online.connected)online.send({type:'lobby-stage',stage:'levels'}); if(online.role==='guest'){online.disconnect();showScreen('select');mpRenderLobby();return;} state.running = false; state.paused = false; setGameChrome(false); buildLevelCards(); showScreen("levels"); }
function pauseGame() { if (!state.running) return; if(online.role==='guest'){showHint('Only the host can pause this match.',2);return;} if(online.role==='host'&&online.connected)online.send({type:'pause'}); state.paused = true; keys.clear(); touchKeys.clear(); screens.pause.classList.add("active"); syncAudioForContext(); }
function resumeGame() { if (!state.running) return; if(online.role==='guest')return; if(online.role==='host'&&online.connected)online.send({type:'resume'}); state.paused = false; screens.pause.classList.remove("active"); state.screen = "game"; lastFrame = performance.now(); syncAudioForContext(); }
function openRules() {
  updateRulesContext();

  state.pauseBeforeRules = state.paused;

  if (state.running) {
    state.paused = true;
    if(online.role==='host'&&online.connected)online.send({type:'pause'});
  }

  dom.rules.classList.remove("hidden");
  syncAudioForContext();
}
function closeRules() { dom.rules.classList.add("hidden"); if (state.running && !state.pauseBeforeRules) { state.paused = false; if(online.role==='host'&&online.connected)online.send({type:'resume'}); lastFrame = performance.now(); } syncAudioForContext(); }

function introMusicAllowed() {
  return (state.screen === "loading" || state.screen === "start") && dom.rules.classList.contains("hidden");
}

function updateIntroMusicButton() {
  const button = $("#introMusicBtn"); if (!button) return;
  const active = !state.muted && !themeAudio.paused && introMusicAllowed();
  button.textContent = active ? "♫" : "×♫";
  button.setAttribute("aria-pressed", String(active));
  button.setAttribute("aria-label", active ? "Mute intro music" : "Play intro music");
}

function stopTheme(reset = false) {
  themeAudio.pause();
  if (reset) { try { themeAudio.currentTime = 0; } catch { /* Audio is still loading. */ } }
  updateIntroMusicButton();
}

function playTheme() {
  if (state.muted || !introMusicAllowed()) { updateIntroMusicButton(); return; }
  themeAudio.volume = .34; themeAudio.muted = false;
  themeAudio.play().then(updateIntroMusicButton).catch(updateIntroMusicButton);
}

function desiredAmbience() {
  if (!dom.rules.classList.contains("hidden") || state.paused) return null;
  if (state.screen === "select") return GAME.characterSelectMusic;
  if (state.screen === "game" && state.running) return state.level?.music || null;
  return null;
}

function stopAmbience(reset = false) {
  ambienceAudio.pause();
  if (reset) { try { ambienceAudio.currentTime = 0; } catch { /* Audio is still loading. */ } }
}

function playAmbience(track) {
  if (!track || state.muted) return;
  if (ambienceAudio.dataset.track !== track) {
    ambienceAudio.pause(); ambienceAudio.src = track; ambienceAudio.dataset.track = track; ambienceAudio.load();
  }
  ambienceAudio.volume = state.screen === "select" ? .32 : .27; ambienceAudio.muted = false;
  ambienceAudio.play().catch(() => { /* A user gesture may be required by the browser. */ });
}

function maintainSeamlessAmbienceLoop() {
  if (ambienceAudio.paused || !Number.isFinite(ambienceAudio.duration) || ambienceAudio.duration <= 0) return;
  const configuredEnd = AMBIENCE_LOOP_ENDS.get(ambienceAudio.dataset.track);
  const loopAt = configuredEnd ?? Math.max(0, ambienceAudio.duration - .075);
  if (ambienceAudio.currentTime < loopAt) return;
  ambienceAudio.currentTime = 0;
  ambienceAudio.play().catch(() => { /* A user gesture may be required by the browser. */ });
}

function unlockAudio(event) {
  if (event?.target?.closest?.("#introMusicBtn")) return;
  if (event?.type === "keydown" && CONTROLS.music.includes(event.code)) return;
  if (!state.muted) syncAudioForContext();
}

function syncAudioForContext() {
  if (introMusicAllowed() && !state.muted) playTheme();
  else stopTheme(state.screen !== "loading" && state.screen !== "start");

  const track = desiredAmbience();
  if (track && !state.muted) playAmbience(track);
  else {
    const gameplayPaused = state.screen === "game" && (state.paused || !dom.rules.classList.contains("hidden"));
    stopAmbience(!gameplayPaused);
  }
}

function toggleMusic() {
  const hasAudioHere = introMusicAllowed() || Boolean(desiredAmbience());
  const audioIsPlaying = !themeAudio.paused || !ambienceAudio.paused;
  if (state.muted) state.muted = false;
  else if (!hasAudioHere || audioIsPlaying) state.muted = true;
  themeAudio.muted = state.muted; ambienceAudio.muted = state.muted;
  syncAudioForContext(); updateIntroMusicButton();
}

function frame(now) {
  try {
    const delta = Math.min(.05, Math.max(0, (now-lastFrame)/1000));
    lastFrame = now;
    maintainSeamlessAmbienceLoop();
    const badge=document.querySelector('#mpConnectionState');
    if(badge){
      const age=now-online.lastSnapshotAt;
      badge.hidden=!online.connected&&!state.running;
      badge.textContent=online.connected ? (state.running&&age>3500?'● CONNECTION DELAY':'● SERVER LIVE') : (online.role!=='local'?'● RECONNECTING':'');
      badge.style.color=online.connected&&age<=3500?'#a2ffda':'#ffbe91';
    }
    if(state.running && !state.paused && !mpRuntimeErrorV4 && online.role==='local') {
      accumulator = Math.min(.12, accumulator + delta);
      let steps=0;
      while(accumulator >= MP_FRAME_STEP_V4 && steps < 5 && state.running) {
        update(MP_FRAME_STEP_V4);
        accumulator -= MP_FRAME_STEP_V4;
        steps++;
      }
      if(steps >= 5)accumulator = 0;
    } else accumulator = 0;
    if(!mpRuntimeErrorV4 && (state.running || state.screen==='game' || state.screen==='pause' || state.screen==='result')) {
      render(online.role!=='local'?Math.max(0,Math.min(1,(now-online.lastSnapshotAt)/85)):Math.max(0,Math.min(1,accumulator/MP_FRAME_STEP_V4)));
    }
  } catch(error) {
    console.error('[TTHC Heist Circuit] Game loop stopped safely:',error);
    if(online.role==='host'&&online.connected)online.send({type:'pause'});
    mpRuntimeErrorV4 = true;
    state.paused = true;
    keys.clear(); touchKeys.clear();
    const panel = document.querySelector('#pauseScreen');
    if(panel) {
      let message=panel.querySelector('#mpSafeErrorV4');
      if(!message){message=document.createElement('p');message.id='mpSafeErrorV4';message.style.cssText='color:#ffd28e;background:#271a21;padding:12px;border:1px solid #e98182;border-radius:6px';panel.appendChild(message);}
      message.textContent='Technical error: '+String(error?.message||error)+'. Copy the full error from F12 Console. The match is paused to protect scores.';
      panel.classList.add('active');
    }
  }
  requestAnimationFrame(frame);
}

function bindEvents() {
  window.addEventListener('pointerdown',unlockAudio,{capture:true,once:true});
  window.addEventListener('keydown',unlockAudio,{capture:true,once:true});
  $('#startBtn').addEventListener('click',()=>showScreen('select'));
  $('#rulesBtn').addEventListener('click',openRules);
  $('#rulesHudBtn').addEventListener('click',openRules);
  $('#briefingRulesBtn').addEventListener('click',openRules);
  $('#closeRulesBtn').addEventListener('click',closeRules);
  dom.rules.addEventListener('click',e=>{if(e.target===dom.rules)closeRules();});
  $('#playLevelBtn').addEventListener('click',initLevel);
  $('#pauseBtn').addEventListener('click',pauseGame);
  $('#introMusicBtn').addEventListener('click',toggleMusic);
  $('#resumeBtn').addEventListener('click',resumeGame);
  $('#restartBtn').addEventListener('click',initLevel);
  $('#quitBtn').addEventListener('click',goToLevels);
  $('#resultMenuBtn').addEventListener('click',goToLevels);
  $$('[data-back="start"]').forEach(b=>b.addEventListener('click',()=>showScreen('start')));
  $$('[data-back="select"]').forEach(b=>b.addEventListener('click',()=>showScreen('select')));
  window.addEventListener('keydown',event=>{
    const tag=event.target?.tagName;
    if(tag==='INPUT'||tag==='SELECT'||tag==='TEXTAREA')return;
    if(state.running && (MP_ALL_KEYS_V4.has(event.code)||event.code==='Space'||event.code==='Escape'||event.code==='KeyP'||event.code==='KeyM'))event.preventDefault();
    keys.add(event.code);
    if(event.repeat)return;
    if(online.connected && online.role==='guest' && (event.code==='Escape'||event.code==='KeyP')){showHint('The host controls pause. You can keep playing.',2);return;}
    if(event.code==='Escape'||event.code==='KeyP'){
      if(!dom.rules.classList.contains('hidden'))closeRules();
      else if(state.paused)resumeGame();else pauseGame();
      return;
    }
    if(event.code==='KeyM'){toggleMusic();return;}
    if(!state.running||state.paused)return;
    if(online.connected){
      const map=MP_KEYMAPS_V4[0];
      if(event.code===map.hide)online.queueAction('hide');
      else if(event.code===map.ability)online.queueAction('ability');
      else if(event.code===map.vault)online.queueAction('use');
      else if(event.code===map.stash)online.queueAction('stash');
      return;
    }
    for(const p of state.mpPlayers){
      if(p.mpType!=='human'||!p.active)continue;
      const map=MP_KEYMAPS_V4[p.mpIndex];
      if(!map)continue;
      if(event.code===map.hide)mpToggleHide(p);
      else if(event.code===map.ability)mpAbility(p);
      else if(event.code===map.vault)mpOpenVault(p);
      else if(event.code===map.stash)mpStash(p);
    }
  });

window.addEventListener('keyup',e=>keys.delete(e.code));
  window.addEventListener('blur',()=>{keys.clear();if(online.connected)online.sendInput({left:false,right:false,up:false,down:false,jumpHeld:false});});
  document.addEventListener('visibilitychange',()=>{if(document.hidden && online.role==='local'&&state.running&&!state.paused)pauseGame();});
  $$('[data-control]').forEach(button=>{
    const action=button.dataset.control;
    const start=event=>{event.preventDefault();button.setPointerCapture?.(event.pointerId);
      if(online.connected){ if(['ability','hide','vault','stash'].includes(action))online.queueAction(action==='vault'?'use':action);else touchKeys.add(action);return;}
      if(action==='jump')queueJump();else if(action==='ability')mpAbility(state.mpPlayers[0]);
      else if(action==='hide')mpToggleHide(state.mpPlayers[0]);else if(action==='vault')mpOpenVault(state.mpPlayers[0]);else if(action==='stash')mpStash(state.mpPlayers[0]);else touchKeys.add(action);
    };
    const end=event=>{event.preventDefault();touchKeys.delete(action);if(button.hasPointerCapture?.(event.pointerId))button.releasePointerCapture(event.pointerId);};
    button.addEventListener('pointerdown',start);button.addEventListener('pointerup',end);
    button.addEventListener('pointercancel',end);button.addEventListener('lostpointercapture',()=>touchKeys.delete(action));
    button.addEventListener('contextmenu',e=>e.preventDefault());
  });
}


const mpLobby={ humans:1,bots:3,difficulty:'normal',choices:['clawster','lairy','gramp','strappy'],names:['P1','P2','P3','P4'] };
function mpEsc(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function mpLobbySlots(){
  if(online.role==='host'){
    const players=online.roster.filter(p=>p.connected).sort((a,b)=>a.slot-b.slot).map(p=>({type:p.slot===online.slot?'human':'remote',character:p.character,remoteSlot:p.slot,name:p.name}));
    const used=new Set(players.map(p=>p.character));
    const unused=THIEF_IDS.filter(id=>!used.has(id));
    const bots=Array.from({length:mpLobby.bots},(_,i)=>({type:'bot',character:unused[i%unused.length]||THIEF_IDS[i%THIEF_IDS.length],name:'BOT '+(i+1)}));
    return [...players,...bots].slice(0,4);
  }
  if(online.connected && online.role==='guest'){
    const players=online.roster.filter(p=>p.connected).sort((a,b)=>a.slot-b.slot).map(p=>({type:'remote',character:p.character,name:p.name,remoteSlot:p.slot}));
    const used=new Set(players.map(p=>p.character));const available=THIEF_IDS.filter(id=>!used.has(id));
    return [...players,...Array.from({length:mpLobby.bots},(_,i)=>({type:'bot',character:available[i%available.length]||THIEF_IDS[i%THIEF_IDS.length],name:'BOT '+(i+1)}))].slice(0,4);
  }
  const count=mpLobby.humans+mpLobby.bots;
  const used=new Set(mpLobby.choices.slice(0,mpLobby.humans));
  const unused=THIEF_IDS.filter(id=>!used.has(id));
  return Array.from({length:count},(_,i)=>i<mpLobby.humans
    ? {type:'human',character:mpLobby.choices[i],name:mpLobby.names[i]||'P'+(i+1)}
    : {type:'bot',character:unused[(i-mpLobby.humans)%Math.max(1,unused.length)]||THIEF_IDS[i%THIEF_IDS.length],name:'BOT '+(i-mpLobby.humans+1)});
}
function mpRenderLobby(message=''){
  const heading=$('#selectScreen .panel-heading');
  heading.innerHTML='<p class="overline">REAL-TIME MULTIPLAYER</p><h2>BUILD YOUR HEIST CREW</h2><p>Choose your thief and nickname. Race friends and bots while Draco guards the room.</p>';
  const guest=online.connected&&online.role==='guest';
  const host=online.connected&&online.role==='host';
  if(host||guest){mpLobby.humans=online.roster.filter(p=>p.connected).length;mpLobby.bots=Math.min(online.lobby.bots,4-mpLobby.humans);mpLobby.difficulty=online.lobby.difficulty;}
  else mpLobby.bots=Math.min(mpLobby.bots,4-mpLobby.humans);
  const maxBots=4-mpLobby.humans;
  const seats=mpLobbySlots();
  const choices=THIEF_IDS;
  const card=(seat,i)=>{
    const own=(host||guest) ? seat.remoteSlot===online.slot : seat.type==='human';
    const label=seat.type==='bot'?'BOT '+(i+1):'PLAYER '+(i+1)+(seat.type==='remote'?' · ONLINE':'');
    const char=CHARACTERS[seat.character]||CHARACTERS.clawster;
    const name=mpEsc(seat.name||label);
    return '<article class="mp-slot '+(own?'mp-slot-own':'mp-slot-view')+'">'+
      '<span class="mp-slot-header">'+label+'</span><img src="'+char.portraitAsset+'" alt="'+mpEsc(char.name)+' portrait">'+
      (own ? '<label>YOUR NICKNAME<input maxlength="18" data-mp-name="'+i+'" value="'+name+'" autocomplete="off" spellcheck="false"></label>'+
        '<label>YOUR CHARACTER<select data-mp-player="'+i+'">'+choices.map(id=>'<option value="'+id+'" '+(id===seat.character?'selected':'')+'>'+CHARACTERS[id].name+'</option>').join('')+'</select></label>'
        : '<strong>'+name+'</strong><span>'+char.name+'</span>')+'</article>';
  };
  dom.characterGrid.className='mp-lobby';
  const locked=guest?'disabled':'';
  const settings='<div class="mp-lobby-settings"><label>Human players<select id="mpHumans" '+(host||guest?'disabled':'')+'>'+[1,2,3,4].map(n=>'<option '+(n===mpLobby.humans?'selected':'')+'>'+n+'</option>').join('')+'</select></label>'+
    '<label>Bot players<select id="mpBots" '+locked+'>'+Array.from({length:maxBots+1},(_,n)=>'<option '+(n===mpLobby.bots?'selected':'')+'>'+n+'</option>').join('')+'</select></label>'+
    '<label>Bot difficulty<select id="mpDifficulty" '+locked+'>'+['easy','normal','hard'].map(d=>'<option '+(d===mpLobby.difficulty?'selected':'')+'>'+d.toUpperCase()+'</option>').join('')+'</select></label></div>';
  dom.characterGrid.innerHTML=settings+
    '<div class="mp-slots">'+seats.map(card).join('')+'</div>'+
    '<p class="mp-warning" id="mpLobbyMessage">'+mpEsc(message)+'</p>'+
    '<p class="mp-lobby-tip">'+(guest?'Everyone sees the same crew and room selection. The host starts the heist.':'Choose your crew. Friends can pick their own characters. The host starts the heist.')+'</p>'+
    (guest ? '<button class="btn btn-primary" type="button" disabled aria-disabled="true">WAITING FOR HOST</button>' : '<button id="mpProceed" class="btn btn-primary" type="button">CHOOSE ROOM</button>');
  if(!guest){
    $('#mpHumans').onchange=e=>{mpLobby.humans=+e.target.value;mpLobby.bots=Math.min(mpLobby.bots,4-mpLobby.humans);mpRenderLobby();};
    $('#mpBots').onchange=e=>{mpLobby.bots=+e.target.value;if(host)online.send({type:'lobby-settings',bots:mpLobby.bots,difficulty:mpLobby.difficulty});mpRenderLobby();};
    $('#mpDifficulty').onchange=e=>{mpLobby.difficulty=e.target.value;if(host)online.send({type:'lobby-settings',bots:mpLobby.bots,difficulty:mpLobby.difficulty});mpRenderLobby();};
  }
  dom.characterGrid.querySelectorAll('[data-mp-name]').forEach(input=>input.addEventListener('change',e=>{
    const index=+e.target.dataset.mpName;
    const normalized=e.target.value.trim().slice(0,18)||'P'+(index+1);
    if(guest){$('#mpOnlineName').value=normalized;online.send({type:'name',name:normalized});}
    else {mpLobby.names[index]=normalized;if(host){$('#mpOnlineName').value=normalized;online.send({type:'name',name:normalized});}}
    e.target.value=normalized;
  }));
  dom.characterGrid.querySelectorAll('[data-mp-player]').forEach(select=>select.onchange=e=>{
    const index=+e.target.dataset.mpPlayer;
    if(guest){$('#mpOnlineCharacter').value=e.target.value;online.send({type:'character',character:e.target.value});}
    else {mpLobby.choices[index]=e.target.value;if(host)online.send({type:'character',character:e.target.value});}
    mpRenderLobby();
  });
  if(!guest)$('#mpProceed').onclick=()=>{
    if(mpLobbySlots().length<2)return mpRenderLobby('Add another human or bot.');
    if(!host && new Set(mpLobby.choices.slice(0,mpLobby.humans)).size!==mpLobby.humans)return mpRenderLobby('Each human must choose a different thief.');
    const slots=mpLobbySlots();
    state.selectedId=slots[0].character;
    $('#chosenRole').textContent='HEIST CIRCUIT';
    $('#chosenSummary').textContent=mpLobby.humans+' human(s) and '+mpLobby.bots+' bot(s) · '+mpLobby.difficulty+' bots';
    if(host)online.send({type:'lobby-stage',stage:'levels'});
    $('#playLevelBtn').disabled=false;$('#playLevelBtn').textContent='START HEIST';
    buildLevelCards();showScreen('levels');
  };
}
function mpControls(p){
  if (p.mpType === 'remote') {
    const connected=online.roster.some(member=>member.slot===p.remoteSlot && member.connected);
    return connected?online.getInput(p.remoteSlot):mpBotControls(p);
  }
  if(p.mpType==='bot')return mpBotControls(p);
  const map=MP_KEYMAPS_V4[p.mpIndex];
  if(!map)return {left:false,right:false,up:false,down:false,jumpHeld:false};
  const value=key=>keys.has(map[key]) || (p.mpIndex===0 && touchKeys.has(key));
  const jump=value('up')||(p.mpIndex===0&&keys.has('Space'));
  const controls={left:value('left'),right:value('right'),up:jump,down:value('down'),jumpHeld:jump};
  // Gamepads are OPTIONAL for any player and do not take away the keyboard.
  const pads=navigator.getGamepads?.()||[];
  const pad=pads[p.mpIndex]||null;
  if(pad){
    const a=pad.axes||[],b=pad.buttons||[];const pressed=i=>!!b[i]?.pressed;
    controls.left ||= (a[0]||0)<-.3||pressed(14);
    controls.right ||= (a[0]||0)>.3||pressed(15);
    controls.up ||= (a[1]||0)<-.4||pressed(12)||pressed(0);
    controls.down ||= (a[1]||0)>.4||pressed(13);
    controls.jumpHeld ||= pressed(0);
    if(pressed(1)&&!p.mpHideHeld)mpToggleHide(p);
    if(pressed(2)&&!p.mpAbilityHeld)mpAbility(p);
    if(pressed(5)&&!p.mpVaultHeld)mpOpenVault(p);
    if(pressed(3)&&!p.mpStashHeld)mpStash(p);
    p.mpHideHeld=pressed(1);p.mpAbilityHeld=pressed(2);p.mpVaultHeld=pressed(5);p.mpStashHeld=pressed(3);
  }
  return controls;
}

// HEIST CIRCUIT: the relay is a physical, moving cash-in target.
// It is not a hiding spot, and cannot be used from anywhere in the room.
function mpCreateRelay(level) {
  const surfaces=(level.surfaces || []).filter(s =>
    s && s.type !== 'floor' && s.w >= 100 &&
    Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.w)
  ).sort((a,b)=>a.x-b.x);
  if(!surfaces.length) return {stations:[],index:0,timer:23,cooldown:0,deliveries:0};
  const indexes=[Math.floor(surfaces.length*.16), Math.floor(surfaces.length*.54), Math.floor(surfaces.length*.87)];
  const stations=[...new Set(indexes)].map((index,i) => {
    const s=surfaces[index];
    return { x:s.x+s.w*.5, y:s.y-25, kind:'relay', index:'relay-'+i };
  });
  return {stations,index:0,timer:23,cooldown:0,deliveries:0};
}
function mpCurrentRelay() {
  const relay=state.relay;
  return relay && relay.stations?.length ? relay.stations[relay.index%relay.stations.length] : null;
}
function mpRelayInReach(p,station=mpCurrentRelay()) {
  return Boolean(p && station &&
    Math.abs((p.x+p.w*.5)-station.x) < 68 &&
    Math.abs((p.y+p.h*.5)-station.y) < 77);
}
function mpTickRelay(dt) {
  const r=state.relay;
  if(!r || !r.stations.length) return;
  r.cooldown=Math.max(0,r.cooldown-dt);
  r.timer-=dt;
  if(r.timer<=0){
    r.index=(r.index+1)%r.stations.length;
    r.timer=23;
    burst(r.stations[r.index].x,r.stations[r.index].y,'#77fce1',15);
    showHint('RELAY MOVED! Follow the turquoise beam to deliver your sock bag.',2.8);
    for(const p of state.mpPlayers.filter(p=>p.active&&p.mpType==='bot')){
      p.aiTarget=-1;p.aiDecision=0;p.aiScoutGoal=null;
    }
  }
}
function mpTryRelay(p) {
  if(!p || !p.active || p.hidden || !state.running || state.paused) return false;
  const station=mpCurrentRelay();
  if(!mpRelayInReach(p,station)) return false;
  if(state.relay.cooldown>0){
    if(p.mpType==='human')showHint('Relay resetting: '+Math.ceil(state.relay.cooldown)+'s.',1.4);
    return true;
  }
  if((p.cargo||0)<2){
    if(p.mpType==='human')showHint('Collect at least 2 ordinary socks to make a delivery.',2);
    return true;
  }
  const delivered=p.cargo;
  const doubled=state.remaining<=30;
  const earned=delivered*4+(delivered>=4?4:0);
  const total=doubled?earned*2:earned;
  p.cargo=0;
  p.points+=total;
  p.energy=Math.min(5,p.energy+1);
  p.relayDeliveries=(p.relayDeliveries||0)+1;
  state.relay.deliveries++;
  state.relay.cooldown=2;
  state.relay.timer=23;
  state.relay.index=(state.relay.index+1)%state.relay.stations.length;
  const contract=recordHeistRelay(state.heist,p);
  burst(station.x,station.y,CHARACTERS[p.id].color,28);
  emitNoise(station.x,.65);
  showHint(p.displayName+' DELIVERED '+delivered+' SOCKS! +'+total+' HP'+(doubled?' DOUBLE FINAL DELIVERY!':'')+(contract?' · '+contract:''),3.4);
  return true;
}
function mpDrawRelay() {
  const st=mpCurrentRelay(),r=state.relay;
  if(!st || !r) return;
  const pulse=Math.sin(state.elapsed*4);
  ctx.save();
  ctx.translate(st.x,st.y);
  ctx.shadowColor='#4fffe3';ctx.shadowBlur=18+6*pulse;
  ctx.fillStyle='#092d42';ctx.strokeStyle='#6bffe0';ctx.lineWidth=4;
  ctx.beginPath();ctx.roundRect(-38,-46,76,70,10);ctx.fill();ctx.stroke();
  ctx.shadowBlur=0;
  ctx.fillStyle='#16aa9c';ctx.fillRect(-27,-33,54,35);
  ctx.strokeStyle='#c5fff4';ctx.lineWidth=2;ctx.strokeRect(-27,-33,54,35);
  ctx.fillStyle='#fcffda';ctx.font='900 23px system-ui';ctx.textAlign='center';ctx.fillText('⇧',0,-7);
  ctx.fillStyle='#8efbe6';ctx.font='900 12px system-ui';ctx.strokeStyle='#071725';ctx.lineWidth=4;
  ctx.strokeText('RELAY DROP · '+Math.ceil(r.timer)+'s',0,-64);
  ctx.fillText('RELAY DROP · '+Math.ceil(r.timer)+'s',0,-64);
  ctx.fillStyle='#f6ffeb';ctx.font='900 11px system-ui';
  ctx.strokeText('2–4 SOCKS → USE',0,44);ctx.fillText('2–4 SOCKS → USE',0,44);
  if(state.remaining<=30){ctx.fillStyle='#ffdb79';ctx.fillText('DOUBLE DELIVERY!',0,61);}
  ctx.restore();
  for(const p of state.mpPlayers){
    if(!p.active)continue;
    if(p.cargo>0){
      const label=p.displayName+' BAG '+p.cargo+'/4';
      const cx=p.x+p.w/2,cy=p.y-27;
      ctx.save();ctx.textAlign='center';ctx.font='900 12px system-ui';
      ctx.lineWidth=4;ctx.strokeStyle='#082033';ctx.fillStyle='#b5fff1';
      ctx.strokeText(label,cx,cy);ctx.fillText(label,cx,cy);
      ctx.restore();
    }
    if((p.mpType==='human'||(online.connected&&p.remoteSlot===online.slot)) && mpRelayInReach(p,st)){
      const map=MP_KEYMAPS_V4[p.mpIndex];
      const key=(online.connected?MP_KEYMAPS_V4[0]:map)?.vault?.replace(/^Key/,'').replace(/^Arrow/,'')||'RB';
      const prompt=p.cargo>=2?key+' · DELIVER BAG (+POINTS)': 'NEED '+Math.max(0,2-p.cargo)+' MORE SOCKS';
      ctx.save();ctx.textAlign='center';ctx.font='900 12px system-ui';ctx.lineWidth=4;
      ctx.strokeStyle='#082033';ctx.fillStyle='#b0ffee';
      ctx.strokeText(prompt,p.x+p.w/2,p.y-43);ctx.fillText(prompt,p.x+p.w/2,p.y-43);ctx.restore();
    }
  }
  // Compact, on-field hint: essential strategy does not depend on reading
  // the longer contracts list below the game.
  ctx.save();ctx.fillStyle='rgba(4,26,39,.88)';ctx.strokeStyle='#54ddc6';ctx.lineWidth=1.5;
  ctx.beginPath();ctx.roundRect(GAME.width/2-224,12,448,42,9);ctx.fill();ctx.stroke();
  ctx.font='900 13px system-ui';ctx.textAlign='center';ctx.fillStyle='#c3fff3';
  const leader=[...state.mpPlayers].sort((a,b)=>b.points-a.points)[0];
  const text='RELAY '+Math.ceil(r.timer)+'s  ·  '+(state.remaining<=30?'DOUBLE DELIVERY':'2+ SOCKS = BIG POINTS')+
    '  ·  LEADER '+(leader?.displayName||'-')+' '+(leader?.points||0);
  ctx.fillText(text,GAME.width/2,38);ctx.restore();
}

function mpBotScoutControls(p){
  // Between loot waves, move along furniture and scout likely supply-drop
  // positions. Do not freeze waiting for new items.
  const surfaces=state.level.surfaces.filter(s=>s.type!=='floor' && s.w>=85 && Number.isFinite(s.x) && Number.isFinite(s.y));
  if(!mpNavigator || !surfaces.length)return {left:false,right:false,up:false,down:false,jumpHeld:false};
  p.aiScoutTimer=(p.aiScoutTimer||0)-GAME.fixedStep;
  const cx=p.x+p.w/2;
  const target=p.aiScoutGoal;
  const reached=target && Math.hypot(cx-target.x,(p.y+p.h/2)-target.y)<58;
  if(!target || reached || p.aiScoutTimer<=0){
    p.aiScoutTurn=(p.aiScoutTurn||0)+1;
    const draco=state.enemies[0];
    const choices=surfaces.map((s,i)=>{
      const goal={x:s.x+s.w*(.33 + .34*((p.mpIndex+p.aiScoutTurn)%2)),y:s.y-26};
      const route=mpNavigator.estimate(p,goal);
      const nearDraco=draco?Math.hypot(goal.x-(draco.x+draco.w/2),goal.y-(draco.y+draco.h/2)):999;
      const farEnough=Math.abs(goal.x-cx)>125;
      return {goal,score:route+(nearDraco<260?420:0)+(farEnough?0:380)+((i+p.mpIndex+p.aiScoutTurn)%4)*42};
    }).filter(x=>Number.isFinite(x.score)).sort((a,b)=>a.score-b.score);
    p.aiScoutGoal=choices[0]?.goal||{x:GAME.width/2,y:state.level.floorY-25};
    p.aiScoutTimer=2.8+((p.mpIndex+p.aiScoutTurn)%3)*1.1;
  }
  const draco=state.enemies[0];
  if(draco && distance(draco,p)<145 && p.energy>=2 && p.abilityCooldown<=0 && mpLobby.difficulty!=='easy')mpAbility(p);
  return mpNavigator.steer(p,p.aiScoutGoal,GAME.fixedStep);
}

function mpBotControls(p){
  const loot=state.items.filter(item=>!item.collected);
  const vaultChoices=state.vaults.filter(v=>v.owner===null && p.tools>=2 && state.vaultLockdown<=0)
    .map(v=>({...v,index:'vault-'+v.id,kind:'vault',vaultRef:v,premium:false}));
  const available=[...loot,...vaultChoices];
  if(!mpNavigator)return {left:false,right:false,up:false,down:false,jumpHeld:false};
  const relay=mpCurrentRelay();
  // Score the bag instead of waiting indefinitely for the next sock wave.
  if(relay && p.cargo>=2 && (p.cargo>=3 || !loot.length || state.remaining<25)){
    if(mpRelayInReach(p,relay)){
      mpTryRelay(p);
      p.aiTarget=-1;p.aiDecision=0;
      return {left:false,right:false,up:false,down:false,jumpHeld:false};
    }
    p.aiScoutGoal=null;
    return mpNavigator.steer(p,relay,GAME.fixedStep);
  }
  if(!available.length){
    p.aiTarget=-1;p.aiDecision=0;
    if(p.tools>=1 && p.points-(p.protectedPoints||0)>=5 && (p.stashes||0)<2 && mpNearbyHide(p) && mpLobby.difficulty!=='easy')mpStash(p);
    return mpBotScoutControls(p);
  }
  p.aiScoutGoal=null;
  p.aiDecision=Math.max(0,p.aiDecision-GAME.fixedStep);
  let target=available.find(item=>item.index===p.aiTarget);
  if(!target || p.aiDecision<=0){
    const variation={easy:135,normal:48,hard:8}[mpLobby.difficulty];
    const scored=available.map(item=>{
      const distanceCost=mpNavigator.estimate(p,item);
      const value=item.vaultRef?18:item.premium?6:item.kind==='sock'?3:1;
      const wantsSupply=item.kind!=='sock'&&!item.premium&&!item.vaultRef;
      const supplyBonus=wantsSupply && p.tools<2 && state.vaults.some(v=>v.owner===null)
        ?(p.tools===0?125:85):0;
      const bonus=item.vaultRef?170:contractPreference(state.heist,p,item);
      const cost=distanceCost-value*(mpLobby.difficulty==='hard'?21:13)-supplyBonus-bonus;
      const blockedPenalty=p.aiBlockedTarget===item.index && state.elapsed<(p.aiBlockedUntil||0)?520:0;
      return {item,cost:cost+blockedPenalty+Math.random()*variation};
    }).filter(entry=>Number.isFinite(entry.cost)).sort((a,b)=>a.cost-b.cost);
    target=scored[0]?.item || available[0];
    p.aiTarget=target.index;
    p.aiDecision=mpLobby.difficulty==='hard'?1.7:2.6;
  }
  if(target.vaultRef && mpVaultInReach(p,target.vaultRef)){
    mpOpenVault(p);
    p.aiTarget=-1;p.aiDecision=0;
    return {left:false,right:false,up:false,down:false,jumpHeld:false};
  }
  if(p.tools>=1 && !(p.tools>=2&&state.vaults.some(v=>v.owner===null && state.vaultLockdown<=0)) &&
    p.points-(p.protectedPoints||0)>=5 && (p.stashes||0)<2 &&
    mpNearbyHide(p) && mpLobby.difficulty!=='easy')mpStash(p);
  const controls=mpNavigator.steer(p,target,GAME.fixedStep);
  const draco=state.enemies[0];
  if(p.energy>=2 && p.abilityCooldown<=0 && mpLobby.difficulty!=='easy'){
    if(p.id==='clawster' && !target.vaultRef &&
      Math.hypot(target.x-(p.x+p.w/2),target.y-(p.y+p.h/2))<160)mpAbility(p);
    else if(draco && distance(draco,p)<230 && draco.mode==='chase')mpAbility(p);
  }
  return controls;
}

// Two one-time JACKPOT MACHINES release contested gold socks.
// They never hide or shelter a thief: every player can chase the prizes.
function mpBuildVaults(level){
  const options=level.surfaces.filter(s=>s.type!=='floor'&&s.w>=100&&s.x>90&&s.x<1170);
  if(!options.length)return [];
  const chosen=[options[Math.floor(options.length*.28)],options[Math.floor(options.length*.76)]];
  return [...new Set(chosen)].map((s,i)=>({
    id:i+1,x:s.x+s.w*.5,y:s.y-27,owner:null,requiredTools:2,reward:3
  }));
}
function mpVaultInReach(p,v){
  return Math.abs(p.x+p.w/2-v.x)<65 && Math.abs(p.y+p.h*.5-v.y)<63;
}
function mpReleaseJackpotGold(machine){
  const surfaces=state.level.surfaces.filter(s=>s.type!=='floor' && s.w>=85 && Number.isFinite(s.x) && Number.isFinite(s.y));
  if(!surfaces.length)return 0;
  let created=0;
  const order=surfaces.map((s,index)=>({s,index,distance:Math.abs(s.x+s.w*.5-machine.x)}))
    .sort((a,b)=>b.distance-a.distance);
  for(const {s,index} of order){
    if(created>=3)break;
    const x=clamp(s.x+s.w*(created%2===0?.34:.69),s.x+23,s.x+s.w-23);
    const y=s.y-24;
    if(state.items.some(item=>!item.collected && Math.hypot(item.x-x,item.y-y)<48))continue;
    if(state.vaults.some(v=>v.owner===null && Math.hypot(v.x-x,v.y-y)<60))continue;
    const item={x,y,kind:'sock',premium:true,jackpotGold:true,sockWave:true,spawnedAt:state.elapsed,
      index:state.items.length,w:26,h:26,collected:false,magnet:false,phase:created*.9};
    state.items.push(item);
    burst(x,y,'#ffe7a0',15);
    created++;
  }
  // A congested room should still release rewards on valid furniture.
  if(created<3){
    for(let i=0;i<surfaces.length && created<3;i++){
      const s=surfaces[(i+machine.id)%surfaces.length];
      const x=clamp(s.x+s.w*.5,s.x+20,s.x+s.w-20),y=s.y-24;
      if(state.items.some(item=>!item.collected && Math.hypot(item.x-x,item.y-y)<28))continue;
      state.items.push({x,y,kind:'sock',premium:true,jackpotGold:true,sockWave:true,spawnedAt:state.elapsed,
        index:state.items.length,w:26,h:26,collected:false,magnet:false,phase:created*.9});
      burst(x,y,'#ffe7a0',15);created++;
    }
  }
  for(const bot of state.mpPlayers.filter(player=>player.active && player.mpType==='bot')){
    bot.aiTarget=-1;bot.aiDecision=0;bot.aiScoutGoal=null;
  }
  return created;
}
function mpOpenVault(p){
  if(!p||!p.active||p.hidden||!state.running||state.paused)return false;
  if(mpRelayInReach(p)) return mpTryRelay(p);
  if(state.vaultLockdown>0){
    if(p.mpType==='human' && state.elapsed-(p.lastVaultHint||-10)>1.8){
      p.lastVaultHint=state.elapsed;
      showHint('Jackpot machines recharging for '+Math.ceil(state.vaultLockdown)+'s.',1.7);
    }
    return false;
  }
  const v=state.vaults.find(v=>v.owner===null&&mpVaultInReach(p,v));
  if(!v)return false;
  if(p.tools<2){
    if(p.mpType==='human')showHint(p.displayName+': you need 2 Tools to start this jackpot.',2);
    return false;
  }
  p.tools-=2;p.points+=v.reward;p.energy=Math.min(5,p.energy+1);
  v.owner=p.mpIndex;p.vaultWins=(p.vaultWins||0)+1;
  if(state.vaults.some(other=>other.owner===null))state.vaultLockdown=8;
  burst(v.x,v.y,'#ffe4a3',24);
  const alarm=recordHeistVault(state.heist,p);
  const drops=mpReleaseJackpotGold(v);
  mpSpawnSupplyDrop(false);
  showHint(p.displayName+' STARTED JACKPOT '+v.id+'! +3 HP · '+drops+' GOLD SOCKS RELEASED FOR EVERYONE!'+(alarm?' DRACO ALERT!':''),4);
  return true;
}

function mpSpawnSupplyDrop(announce=true){
  const surfaces=(state.level?.surfaces || []).filter(s=>
    s && s.type!=='floor' && Number.isFinite(s.x) &&
    Number.isFinite(s.y) && Number.isFinite(s.w) && s.w>=105
  );
  if(!surfaces.length)return false;
  // The former crash was caused by an uninitialised dropSerial (NaN index).
  const serial=Number.isSafeInteger(state.dropSerial)&&state.dropSerial>=0 ? state.dropSerial : 0;
  state.dropSerial=serial+1;
  const elapsed=Number.isFinite(state.elapsed)?state.elapsed:0;
  const index=(Math.floor(elapsed/34)+serial)%surfaces.length;
  const surface=surfaces[index];
  if(!surface)return false;
  const x=clamp(surface.x+surface.w*(index%2===0?.38:.64),20,GAME.width-20);
  const y=surface.y-25;
  state.items.push({x,y,kind:'button',supplyDrop:true,premium:false,
    index:state.items.length,w:26,h:26,collected:false,magnet:false,phase:index*.7});
  burst(x,y,'#93f5d8',12);
  if(announce)showHint('NEW TOOL DROP! Reach it before another thief does!',2.7);
  return true;
}

// Every 24 seconds up to four socks reappear at reachable furniture surfaces.
// Players must still physically reach them. A gold sock sometimes appears.
function mpSpawnSockWave(announce=true){
  if(!state.level || !state.running || !Array.isArray(state.items))return 0;
  const surfaces=(state.level.surfaces||[]).filter(s=>s && s.type!=='floor' &&
    Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.w) && s.w>=78);
  if(!surfaces.length)return 0;
  const active=state.items.filter(item=>!item.collected && (item.kind==='sock'||item.premium)).length;
  const count=Math.min(4,Math.max(0,10-active));
  if(!count)return 0;
  const wave=Number.isSafeInteger(state.sockWaveSerial)?state.sockWaveSerial:0;
  state.sockWaveSerial=wave+1;
  const occupied=state.items.filter(item=>!item.collected);
  const obstacles=state.level.hazards||[];
  let created=0;
  // Rotate which furniture gets loot; avoid existing items and hazards.
  const attempts=Math.max(12,surfaces.length*8);
  for(let attempt=0;attempt<attempts && created<count;attempt++){
    const index=(wave*3+attempt*5+Math.floor(attempt/surfaces.length))%surfaces.length;
    const s=surfaces[index];
    const fraction=[.27,.50,.72][(wave+attempt)%3];
    const x=clamp(s.x+s.w*fraction,s.x+22,s.x+s.w-22);
    const y=s.y-24;
    if(!Number.isFinite(x)||!Number.isFinite(y)||x<20||x>GAME.width-20)continue;
    if(occupied.some(item=>Math.hypot(item.x-x,item.y-y)<58))continue;
    if((state.vaults||[]).some(v=>v.owner===null && Math.hypot(v.x-x,v.y-y)<64))continue;
    if(obstacles.some(h=>x>h.x-25 && x<h.x+h.w+25 && y>h.y-45 && y<h.y+h.h+20))continue;
    const premium=(wave%3===2 && created===count-1);
    const item={x,y,kind:'sock',premium,sockWave:true,spawnedAt:state.elapsed,
      index:state.items.length,w:26,h:26,collected:false,magnet:false,phase:(wave+created)*.93};
    state.items.push(item);occupied.push(item);created++;
    burst(x,y,premium?'#ffdd82':'#ffaad7',8);
  }
  if(created && announce)showHint('SOCK WAVE! '+created+' fresh socks have appeared. Race to the furniture!',3);
  return created;
}

function mpDrawVaults(){
  if(!Array.isArray(state.vaults))return;
  for(const machine of state.vaults){
    if(!Number.isFinite(machine.x)||!Number.isFinite(machine.y))continue;
    const used=machine.owner!==null;
    const locked=!used && state.vaultLockdown>0;
    const wobble=Math.sin(state.elapsed*5+machine.id)*2;
    ctx.save();ctx.translate(machine.x,machine.y);
    // Neon arcade machine. Not a hide spot: a jackpot trigger.
    ctx.shadowColor=used?'#87a8b5':locked?'#7d91b7':'#ffe17b';
    ctx.shadowBlur=used?2:14;
    ctx.fillStyle=used?'#374f5d':locked?'#4b587b':'#2f3b67';
    ctx.strokeStyle=used?'#85d6c4':locked?'#b0c4e3':'#ffd363';
    ctx.lineWidth=3;
    ctx.beginPath();ctx.roundRect(-33,-44,66,63,7);ctx.fill();ctx.stroke();
    ctx.shadowBlur=0;
    ctx.fillStyle=used?'#132f31':'#131d42';ctx.fillRect(-25,-36,50,37);
    ctx.strokeStyle=used?'#77ddce':'#f9c95c';ctx.lineWidth=2;ctx.strokeRect(-25,-36,50,37);
    ctx.fillStyle=used?'#78e5c6':locked?'#a6b9df':'#ffdf85';
    ctx.font='900 17px system-ui';ctx.textAlign='center';
    ctx.fillText(used?'✓':locked?'⌛':'★',0,-12+wobble);
    for(let i=-1;i<=1;i++){
      ctx.fillStyle=used?'#78bba7':'#f3b456';
      ctx.fillRect(i*11-4,5,8,6);
    }
    ctx.fillStyle=used?'#577786':'#8a5173';ctx.fillRect(-37,18,74,8);
    ctx.lineWidth=4;ctx.strokeStyle='#081a2b';
    ctx.font='900 12px system-ui';
    const owner=state.mpPlayers.find(p=>p.mpIndex===machine.owner);
    const title=used?'JACKPOT '+machine.id+' · '+(owner?.displayName||'FIRED'):
      locked?'JACKPOT '+machine.id+' · '+Math.ceil(state.vaultLockdown)+'s':
      'JACKPOT '+machine.id+' · 2 TOOLS';
    const subtitle=used?'3 GOLD SOCKS RELEASED':'TRIGGERS GOLD SOCK RUSH!';
    ctx.fillStyle=used?'#a5e9da':'#ffeba0';
    ctx.strokeText(title,0,-62);ctx.fillText(title,0,-62);
    ctx.font='900 10px system-ui';
    ctx.strokeText(subtitle,0,-49);ctx.fillText(subtitle,0,-49);
    ctx.restore();
  }
  for(const p of state.mpPlayers){
    if(!(p.mpType==='human'||(online.connected&&p.remoteSlot===online.slot))||!p.active||p.hidden)continue;
    const near=state.vaults.find(v=>v.owner===null&&mpVaultInReach(p,v));
    if(!near)continue;
    const key=MP_KEYMAPS_V4[online.connected?0:p.mpIndex]?.vault?.replace(/^Key/,'')||'RB';
    const message=state.vaultLockdown>0?'RECHARGING · '+Math.ceil(state.vaultLockdown)+'s':
      p.tools>=2?key+' · LAUNCH JACKPOT (2 TOOLS)':
      'JACKPOT: NEED '+(2-p.tools)+' TOOL'+(2-p.tools===1?'':'S');
    ctx.save();ctx.textAlign='center';ctx.font='900 12px system-ui';ctx.lineWidth=4;
    ctx.strokeStyle='#071324';ctx.fillStyle=p.tools>=2?'#a9fbc8':'#ffd0a9';
    ctx.strokeText(message,p.x+p.w/2,p.y-26);
    ctx.fillText(message,p.x+p.w/2,p.y-26);ctx.restore();
  }
}

// Rescue a character only if it has sunk below the actual continuous room floor.
// All four original room layouts use a full-width solid floor surface.
function mpFloorSafety(p) {
  if(!p || !p.active || p.hidden || p.climbing || !state.level)return;
  const floor=state.level.surfaces.find(s=>s.type==='floor');
  if(!floor || !Number.isFinite(p.x) || !Number.isFinite(p.y))return;
  const feet=p.y+p.h;
  if(feet>floor.y && p.vy>=0 && p.x+p.w>floor.x && p.x<floor.x+floor.w){
    p.y=floor.y-p.h; p.vy=0; p.onGround=true; p.coyote=.1;
    p.ledgePull=0;
    if(!Number.isFinite(p.prevY)||p.prevY>p.y+28)p.prevY=p.y;
  }
}

function mpNearbyHide(p){
  const area={x:p.x-50,y:p.y-35,w:p.w+100,h:p.h+70};
  return state.level.hideSpots.filter(spot=>overlaps(area,spot)).sort((a,b)=>Math.abs(a.x+a.w/2-p.x)-Math.abs(b.x+b.w/2-p.x))[0]||null;
}
function mpToggleHide(p){
  if(!state.running || state.paused || !p || !p.active)return;
  if(p.hidden){
    p.hidden=false; p.hideSpot=null; p.hideTimer=0; p.hideNoise=false;
    const back=p.mpHideReturn;
    p.mpHideReturn=null;
    if(back && Number.isFinite(back.x) && Number.isFinite(back.y)) {
      p.x=clamp(back.x,0,GAME.width-p.w);
      p.y=Math.min(back.y, state.level.floorY-p.h);
    } else {
      p.y=state.level.floorY-p.h;
    }
    p.prevX=p.x; p.prevY=p.y; p.vx=0; p.vy=0;
    p.climbing=false; p.jumpBuffer=0; p.coyote=0;
    p.onGround=false; p.damageCooldown=Math.max(p.damageCooldown||0,.3);
    if(p===state.player){state.hidden=false;state.hiddenSpot=null;state.hideTimer=0;}
    mpFloorSafety(p);
    return;
  }
  const spot=mpNearbyHide(p),draco=state.enemies[0];
  if(!spot)return showHint(p.displayName+': move near a hiding place.',1.4);
  if(draco?.mode==='chase'&&canSeePlayer(draco,p)&&distance(draco,p)<175)return showHint('Break Draco line of sight first.',1.5);
  p.mpHideReturn={x:p.x,y:p.y};
  p.hidden=true;p.hideSpot=spot;p.hideTimer=0;p.hideNoise=false;p.vx=0;p.vy=0;
  p.x=clamp(spot.x+spot.w/2-p.w/2,0,GAME.width-p.w);
  p.y=spot.y+spot.h-p.h-5;p.prevX=p.x;p.prevY=p.y;
  if(p===state.player){state.hidden=true;state.hiddenSpot=spot;state.hideTimer=0;}
}
function mpStash(p) {
  if (!p || !p.active || !state.running || state.paused || p.hidden) return;
  if (!mpNearbyHide(p)) {
    if (p.mpType === 'human') showHint(p.displayName + ': find a hiding spot to stash loot.', 1.5);
    return;
  }
  if (tryStash(p)) {
    burst(p.x + p.w / 2, p.y, '#85e3bb', 13);
    showHint(p.displayName + ' secured 3 points and earned +2 BONUS!', 2.3);
  } else if (p.mpType === 'human') {
    showHint('Need 1 Tool and 3 unsecured points (max 2 stashes).', 1.7);
  }
}
function mpAbility(p){
  if(!p||!p.active||!state.running||state.paused||p.hidden||p.abilityCooldown>0||p.energy<2)return;
  const draco=state.enemies[0],center={x:p.x+p.w/2,y:p.y+p.h/2};let used=false;
  if(p.id==='clawster'){
    const candidates=state.items.filter(item=>!item.collected&&(!item.premium||p.tools>0)&&Math.hypot(item.x-center.x,item.y-center.y)<185);
    candidates.sort((a,b)=>Math.hypot(a.x-center.x,a.y-center.y)-Math.hypot(b.x-center.x,b.y-center.y));
    if(candidates[0]){collectItem(candidates[0],p);used=true;}
  }else if(p.id==='lairy'){
    if(!p.onGround){p.vy=Math.min(p.vy,-290);p.vx+=p.face*90;used=true;}
  }else if(p.id==='gramp'){
    if(draco && distance(draco,p)<350){state.slowTimer=Math.max(state.slowTimer,2.1);used=true;}
  }else if(p.id==='strappy'){
    if(draco){state.decoy={x:p.x-p.face*70,y:p.y,w:p.w,h:p.h,face:-p.face,time:2.4};used=true;}
  }else if(p.id==='trasselsudd'){p.invisible=2;used=true;}
  if(used){p.energy-=2;p.abilityCooldown=CHARACTERS[p.id].cooldown;p.pulse=.4;burst(center.x,center.y,CHARACTERS[p.id].color,12);emitNoise(p.x,.2);if(recordHeistAbility(state.heist))showHint('DRACO ALERT! Fast guardian, bonus loot!',2.5);}
}
function mpSpillCargo(p,count) {
  const surfaces=state.level.surfaces.filter(s => s && Number.isFinite(s.x) &&
    Number.isFinite(s.w) && s.w>85 && s.type!=='floor');
  const nearby=[...surfaces].sort((a,b)=>
    Math.abs(a.x+a.w/2-p.x)-Math.abs(b.x+b.w/2-p.x));
  let spawned=0;
  for(const s of nearby){
    if(spawned>=Math.min(2,count))break;
    const x=s.x+s.w*.5,y=s.y-24;
    if(state.items.some(item=>!item.collected && Math.hypot(item.x-x,item.y-y)<40))continue;
    state.items.push({x,y,kind:'sock',premium:false,sockWave:true,
      spawnedAt:state.elapsed,index:state.items.length,w:26,h:26,
      collected:false,magnet:false,phase:spawned*.7});
    burst(x,y,'#ff7c90',12);spawned++;
  }
  if(spawned)showHint(p.displayName+' dropped '+count+' carried socks! '+spawned+' are back up for grabs!',2.5);
}

function mpDamage(p,reason){
  if(!state.running||!p||!p.active||p.damageCooldown>0)return;
  p.lives=Math.max(0,p.lives-1);
  const wasProtected=(p.protectedPoints||0);
  if(p.tools>0)p.tools--;
  else p.points=Math.max(wasProtected,p.points-3);
  p.hidden=false;p.hideSpot=null;p.hideTimer=0;p.hideNoise=false;p.mpHideReturn=null;
  p.climbing=false;p.onGround=false;p.stunned=0;p.jumpBuffer=0;p.coyote=0;p.ledgePull=0;
  p._navTransit=null;p.navSurface=undefined;
  p.aiTarget=-1;p.aiDecision=0;p.aiStuck=0;p.aiScoutGoal=null;p.aiLastX=p.x;
  p.aiWatchTimer=0;p.aiWatchX=p.x;p.aiWatchY=p.y;p.aiFrozen=0;p.aiRecovery=0;
  const lostCargo=p.cargo||0;
  p.cargo=0;
  if(lostCargo)mpSpillCargo(p,lostCargo);
  p.stuckX=p.x;p.stuckY=p.y;p.stuckCheckTimer=.6;
  p.mpJumpHeld=false;p.mpAbilityHeld=false;p.mpHideHeld=false;p.mpUpHeldV4=false;
  if(p===state.player){state.hidden=false;state.hiddenSpot=null;}
  burst(p.x+p.w/2,p.y+p.h/2,CHARACTERS[p.id].color,22);
  if(p.lives<=0){
    p.active=false;
    p.damageCooldown=0;
    showHint(p.displayName+' IS OUT! Draco caught them three times. The remaining thieves keep playing.',3.7);
    return;
  }
  p.damageCooldown=3.6; // Visible respawn protection: no rapid multiple catches.
  const start=state.level.playerSpawn.thief;
  p.x=clamp(start[0]+p.mpIndex*52,0,GAME.width-p.w);
  p.y=Math.min(start[1],state.level.floorY-p.h-6);
  p.prevX=p.x;p.prevY=p.y;p.vx=0;p.vy=0;
  showHint(p.displayName+' CAUGHT! '+p.lives+' '+(p.lives===1?'LIFE':'LIVES')+' LEFT. 3.6s safety after respawn.',2.4);
}

function mpSelectTarget(draco){
  return state.mpPlayers.filter(p=>p.active&&!p.hidden&&p.invisible<=0)
    .sort((a,b)=>distance(a,draco)-distance(b,draco))[0]||state.mpPlayers[0];
}
// Multiplayer guardian: shared threat using floor patrol and geometry-aware chase.
// Does not jump continually at the bot's X coordinate.
function mpGuardianUpdate(draco,dt){
  if(!draco.active || !mpNavigator)return;
  draco.mpDisengageV12=Math.max(0,(draco.mpDisengageV12||0)-dt);
  const candidates=state.mpPlayers.filter(p=>p.active && p.invisible<=0 && !p.hidden && p.damageCooldown<=0);
  // After hitting a dead end, finish a short escape route before chasing
  // an unreachable target again (otherwise chase immediately re-locks).
  const visible=draco.mpDisengageV12>0 ? null : candidates.filter(p=>canSeePlayer(draco,p) && distance(p,draco)<365)
    .sort((a,b)=>distance(a,draco)-distance(b,draco))[0];
  draco.mpPatrolTimer=(draco.mpPatrolTimer||0)-dt;
  draco.mpMemory=(draco.mpMemory||0)-dt;
  draco.mpSearchTimer=(draco.mpSearchTimer||0)-dt;
  const decoy=state.decoy;

  if(decoy){
    draco.mode='chase';
    draco.mpMemory=Math.max(draco.mpMemory,decoy.time);
    draco.lastSeenX=decoy.x;
    draco.lastSeenY=decoy.y;
  }else if(visible){
    draco.lastSeenX=visible.x+visible.w/2;
    draco.lastSeenY=visible.y+visible.h/2;
    const near=distance(visible,draco);
    draco.suspicion=clamp(draco.suspicion+dt*(near<145?2.4:1.18),0,1);
    if(draco.suspicion>=.75){
      draco.mode='chase';
      draco.mpMemory=3.6;
    } else if(draco.mode==='patrol'){
      draco.mode='alert';
      draco.mpSearchTimer=2.3;
    }
  }else if(draco.mode==='chase' && draco.mpMemory<=0){
    draco.mode='search';
    draco.mpSearchTimer=2.6;
    draco.suspicion=.35;
  }else if(draco.mode==='alert' && draco.mpSearchTimer<=0){
    draco.mode='patrol';
    draco.suspicion=0;
  }else if(draco.mode==='search' && draco.mpSearchTimer<=0){
    draco.mode='patrol';
    draco.suspicion=0;
  }
  if(!visible && draco.mode!=='chase')draco.suspicion=Math.max(0,draco.suspicion-dt*.18);

  let goal;
  if(draco.mode==='chase' || draco.mode==='search'){
    goal={x:draco.lastSeenX,y:draco.lastSeenY};
  }else if(draco.mode==='alert' && state.noise){
    goal={x:state.noise.x,y:state.level.floorY-22};
  }else{
    // Ground-based patrol is more natural than attempting random vertical jumps.
    const goalX=draco.mpPatrolX ?? 110;
    if(draco.mpPatrolTimer<=0 || Math.abs((draco.x+draco.w/2)-goalX)<35){
      draco.mpPatrolX=(draco.x+draco.w/2)<GAME.width*.5 ? GAME.width-115 : 115;
      draco.mpPatrolTimer=5+Math.random()*3;
    }
    goal={x:draco.mpPatrolX,y:state.level.floorY-25};
  }
  const controls=mpNavigator.steer(draco,goal,dt);
  if(!mpNavigator.advance(draco,dt))
    updateEntity(draco,dt,controls,(draco.mode==='chase'?1.05:draco.mode==='alert'?.76:.62)*(state.slowTimer>0?.5:1)*(state.heist?.frenzy>0?1.2:1));
  mpGuardianWatchdogV12(draco,dt,goal);

  // Checking every player prevents Draco from ignoring P2 or a nearby bot.
  for(const p of state.mpPlayers){
    if(!p.active || p.damageCooldown>0 || p.invisible>0)continue;
    const close=distance(draco,p);
    if(p.hidden){
      if(p.hideNoise && close<82)mpDamage(p,'Draco found your hiding place!');
      continue;
    }
    if(close<65 && overlaps(draco,p,4)){
      mpDamage(p,'Draco caught you!');
      draco.suspicion=0;
      draco.mode='search';
      draco.mpSearchTimer=2.2;
      draco.mpMemory=0;
    }
  }
}

// Both the guardian and thieves must be able to abandon an impossible route.
// This monitors real displacement, not whether an AI has selected an objective.
function mpGuardianWatchdogV12(draco, dt, goal) {
  if(!draco?.active || !mpNavigator || draco.stunned>0) return;
  draco.mpWatchAge=(draco.mpWatchAge||0)+dt;
  if(draco.mpWatchAge<1.05) return;
  const age=draco.mpWatchAge;
  draco.mpWatchAge=0;
  const oldX=Number.isFinite(draco.mpWatchX)?draco.mpWatchX:draco.x;
  const oldY=Number.isFinite(draco.mpWatchY)?draco.mpWatchY:draco.y;
  const moved=Math.hypot(draco.x-oldX,draco.y-oldY);
  draco.mpWatchX=draco.x;draco.mpWatchY=draco.y;
  const farGoal=goal && Number.isFinite(goal.x) && Math.hypot(
    draco.x+draco.w/2-goal.x, draco.y+draco.h/2-goal.y)>35;
  const chasingTarget=draco.mode==='chase' || draco.mode==='search';
  if((!farGoal && !chasingTarget) || moved>=8) {draco.mpWatchStalls=0;return;}
  draco.mpWatchStalls=(draco.mpWatchStalls||0)+age;
  if(draco.mpWatchStalls<1.9)return;
  draco.mpWatchStalls=0;
  draco.mpWatchRecoveries=(draco.mpWatchRecoveries||0)+1;
  draco._navTransit=null;
  draco.navSurface=undefined;
  draco._navFallback=null;
  draco.climbing=false;
  draco.ledgePull=0;
  draco.mode='patrol';draco.suspicion=0;
  draco.mpMemory=0;draco.mpSearchTimer=0;
  draco.mpDisengageV12=3.4;
  draco.mpPatrolTimer=4.5;
  const face=draco.x<GAME.width/2 ? 1 : -1;
  draco.mpPatrolX=clamp(draco.x+face*400,65,GAME.width-65);
  if(!mpNavigator.recover(draco,draco.mpWatchRecoveries)) {
    draco.face=face;draco.vx=face*110;
    if(draco.onGround)draco.jumpBuffer=.17;
  }
}

function mpBotWatchdog(p,dt,controls) {
  if(!p || !p.active || (p.mpType!=='bot' && p.mpType!=='remote') || p.hidden) return;
  p.aiWatchTimer=(p.aiWatchTimer||0)+dt;
  if(p.aiWatchTimer < 1.1) return;
  const oldX=Number.isFinite(p.aiWatchX)?p.aiWatchX:p.x;
  const oldY=Number.isFinite(p.aiWatchY)?p.aiWatchY:p.y;
  const moved=Math.hypot(p.x-oldX,p.y-oldY);
  p.aiWatchX=p.x;p.aiWatchY=p.y;p.aiWatchTimer=0;
  const hasObjective=Boolean(state.items.some(item=>!item.collected) ||
    (p.cargo>=2 && mpCurrentRelay()) ||
    state.vaults.some(v=>v.owner===null));
  // Even while waiting for the next drop, every bot gets a roaming objective.
  const distantGoal=p.aiScoutGoal || (p.cargo>=2 ? mpCurrentRelay() : null);
  const wantsMove=distantGoal && Math.abs((p.x+p.w/2)-distantGoal.x)>70;
  const intentional=Boolean(p._navTransit || controls.left || controls.right ||
    wantsMove || p.aiScoutGoal || (hasObjective && p.aiTarget!==-1));
  if(!intentional || moved>=10){p.aiFrozen=0;p.aiRecovery=0;return;}
  p.aiFrozen=(p.aiFrozen||0)+1.1;
  if(p.aiFrozen<2.2)return;
  const failedTarget=p.aiTarget;
  p.aiFrozen=0;
  p.aiRecovery=(p.aiRecovery||0)+1;
  p.aiBlockedTarget=failedTarget;
  p.aiBlockedUntil=state.elapsed+8;
  p.aiTarget=-1;p.aiDecision=0;p.aiScoutGoal=null;p.aiScoutTimer=0;
  p._navTransit=null;p.navSurface=undefined;p._navFallback=null;
  p.vx=0;p.vy=0;p.climbing=false;
  if(!mpNavigator.recover(p,p.aiRecovery+p.mpIndex)){
    // Try a normal, physically simulated escape when no graph edge exists.
    p.face=p.aiRecovery%2?1:-1;
    p.jumpBuffer=.18;p.vx=p.face*180;
  }
}

function mpUpdatePlayers(dt){
  for(const p of state.mpPlayers){
    try {
    if(!p.active)continue;
    p.abilityCooldown=Math.max(0,p.abilityCooldown-dt);
    p.damageCooldown=Math.max(0,p.damageCooldown-dt);
    p.invisible=Math.max(0,p.invisible-dt);
    if(p.hidden){
      p.prevX=p.x;p.prevY=p.y;p.hideTimer+=dt;
      if(p===state.player)state.hideTimer=p.hideTimer;
      if(p.hideTimer>hideTimeLimit()&&!p.hideNoise){p.hideNoise=true;emitNoise(p.x,.7);}
      if(p.mpType==='bot' && p.hideTimer>2.4)mpToggleHide(p);
      continue;
    }
    const controls=mpControls(p);
    const mpBotDriving=p.mpType==='bot' || (p.mpType==='remote' && online.role==='host' && !online.roster.some(member=>member.slot===p.remoteSlot && member.connected));
    if(p.mpType==='human' || (p.mpType==='remote'&&!mpBotDriving)) {
      const upNow=Boolean(controls.up);
      if(upNow && !p.mpUpHeldV4 && !climbFor(p) && !p.climbing) p.jumpBuffer=.19;
      p.mpUpHeldV4=upNow;
    }
    if(mpBotDriving && !p.hidden && state.enemies[0]?.mode==='chase' && distance(state.enemies[0],p)<125 && mpNearbyHide(p)){mpToggleHide(p);continue;}
    // Each entity uses the original movement, jumps, ladders and collision surfaces.
    if(!mpBotDriving || !mpNavigator.advance(p,dt))
      updateEntity(p,dt,controls,mpBotDriving?(mpLobby.difficulty==='easy'?.75:mpLobby.difficulty==='normal'?.9:1):1,p===state.player);
    mpFloorSafety(p);
    if(mpBotDriving)mpBotWatchdog(p,dt,controls);
    if(!state.running)return;
    if(p.y>GAME.height+40){mpDamage(p,'Fell');continue;}
    for(const hazard of state.level.hazards){if(overlaps(p,{x:hazard.x,y:hazard.y-4,w:hazard.w,h:hazard.h+8},5)){mpDamage(p,'Hazard');break;}}
    if(!p.active)continue;
    // Pickup forgiveness: make reaching a sock feel reliable on ledges.
    // The character still must physically reach the pickup's height.
    for(const item of state.items){
      if(item.collected)continue;
      // Forgiving but still physical pickup: the sprite must be close
      // to the character's actual collision box, not just their center.
      const itemBox={x:item.x-20,y:item.y-20,w:40,h:40};
      const playerBox={x:p.x-10,y:p.y-10,w:p.w+20,h:p.h+20};
      if(overlaps(playerBox,itemBox))collectItem(item,p);
    }
    if(p.onGround&&Math.abs(p.vx)>235&&Math.random()<dt*1.5)emitNoise(p.x,.08);
    } catch(error) {
      console.error('[TTHC] Recovered a player update error for',p.displayName,error);
      p._navTransit=null;p.navSurface=undefined;p.aiTarget=-1;p.aiDecision=0;
      mpSafePosition(p,[state.level.playerSpawn.thief[0]+p.mpIndex*52,state.level.playerSpawn.thief[1]],p.displayName);
      if((p.mpUpdateErrors=(p.mpUpdateErrors||0)+1)===1)showHint(p.displayName+' recovered from a movement error.',2);
    }
  }
}
function mpDrawScoreboard(){
  if(!state.mpPlayers?.length)return;
  ctx.save();
  const width=240, gap=12, total=state.mpPlayers.length;
  const start=(GAME.width-(width*total+gap*(total-1)))/2;
  state.mpPlayers.forEach((p,i)=>{
    const x=start+i*(width+gap),y=GAME.height-59;
    ctx.fillStyle='rgba(6,17,30,.86)';ctx.fillRect(x,y,width,51);
    ctx.fillStyle=CHARACTERS[p.id].color;ctx.fillRect(x,y,5,51);
    ctx.fillStyle='#fff';ctx.textAlign='left';ctx.font='bold 14px system-ui';
    ctx.fillText(p.displayName+' · '+CHARACTERS[p.id].name,x+12,y+19);
    ctx.font='12px system-ui';ctx.fillText('★ '+p.points+'  ❤ '+p.lives+(p.active?'':' OUT')+'  ⚡ '+p.energy+'  ⚒ '+p.tools+'  '+(p.protectedPoints||0)+' safe',x+12,y+39);
  });
  ctx.restore();
}


// ONLINE MULTIPLAYER | room-code host-authoritative matches.
const online = createOnlineClient({onEvent:mpOnlineHandle, onChange:mpOnlineUI});
const MP_ONLINE_FIELDS = ['id','x','y','prevX','prevY','w','h','vx','vy','face','onGround','climbing','active','stunned','landSquash','coyote','jumpBuffer','mode','suspicion','pulse','animDistance','idlePhase','ledgePull','hidden','hideTimer','hideNoise','hideSpot','invisible','boostTimer','damageCooldown','mpIndex','mpType','displayName','points','lives','energy','tools','loot','cargo','relayDeliveries','protectedPoints','stashes','contractWins','contractCounters','abilityCooldown','idlePhase','mpUpHeldV4','mpComboCountV4'];
function mpSerializeEntity(p) {
  const result={};
  for(const key of MP_ONLINE_FIELDS){const value=p?.[key];if(value!==undefined)result[key]=value;}
  return result;
}
function mpMakeSnapshot() {
  return {levelIndex:state.levelIndex, elapsed:state.elapsed, remaining:state.remaining,
    players:state.mpPlayers.map(mpSerializeEntity), enemies:state.enemies.map(mpSerializeEntity),
    items:state.items, vaults:state.vaults, relay:state.relay, heist:state.heist,
    nextSupplyDrop:state.nextSupplyDrop,nextSockWave:state.nextSockWave,
    vaultLockdown:state.vaultLockdown,finalRush:state.finalRush,
    collected:state.collected, noise:state.noise, decoy:state.decoy,
    hidden:state.hidden, hiddenSpot:state.hiddenSpot,
    particles:state.particles.slice(-100), running:state.running};
}
function mpReceiveSnapshot(snapshot) {
  if(online.role==='local'||!online.connected||!snapshot||!Number.isInteger(snapshot.levelIndex))return;
  if(snapshot.levelIndex<0||snapshot.levelIndex>=LEVELS.length)return;
  if(!state.level||state.levelIndex!==snapshot.levelIndex){
    state.levelIndex=snapshot.levelIndex;
    state.level=LEVELS[snapshot.levelIndex];
    mpRuntimeErrorV4=false;state.paused=false;
    document.querySelector('#mpSafeErrorV4')?.remove();
    state._renderWarnings=null;mpPrepareCanvasForRoom();
    state.dust=Array.from({length:38},(_,i)=>({x:(i*89+47)%GAME.width,y:100+(i*137)%510,r:.6+i%3*.4,speed:2+i%5}));
  }
  if(!Array.isArray(snapshot.players)||!snapshot.players.length||!Array.isArray(snapshot.items))return;
  const previous=state.mpPlayers;
  state.mpPlayers=snapshot.players.map((p,i)=>{
    const old=previous[i];
    return {...p, prevX:Number.isFinite(old?.x)?old.x:p.x,prevY:Number.isFinite(old?.y)?old.y:p.y};
  });
  state.player=state.mpPlayers[0];
  state.mpPlayers.forEach((p,i)=>{const start=state.level.playerSpawn.thief;mpSafePosition(p,[start[0]+i*52,start[1]],p.displayName||'Player');if(p.face!==1&&p.face!==-1)p.face=1;});
  state.enemies=(snapshot.enemies||[]).map((p,i)=>({ ...p,prevX:Number.isFinite(state.enemies[i]?.x)?state.enemies[i].x:p.x,prevY:Number.isFinite(state.enemies[i]?.y)?state.enemies[i].y:p.y }));
  state.items=snapshot.items;
  state.vaults=snapshot.vaults||[];
  state.relay=snapshot.relay;
  state.heist=snapshot.heist;
  state.selectedId=state.player.id;
  state.elapsed=snapshot.elapsed;
  state.remaining=snapshot.remaining;
  state.nextSupplyDrop=snapshot.nextSupplyDrop;
  state.nextSockWave=snapshot.nextSockWave;
  state.vaultLockdown=snapshot.vaultLockdown;
  state.finalRush=snapshot.finalRush;
  state.collected=snapshot.collected;
  state.noise=snapshot.noise;
  state.decoy=snapshot.decoy;
  state.hidden=snapshot.hidden;
  state.hiddenSpot=snapshot.hiddenSpot;
  state.particles=snapshot.particles||[];
  state.running=true;
  if(snapshot.events?.length){const last=snapshot.events.at(-1);if(last && last!==state._lastOnlineEvent){state._lastOnlineEvent=last;showHint(last,2.5);}}
  if(state.screen!=='game'&&state.screen!=='pause'){
    Object.values(screens).forEach(screen=>screen.classList.remove('active'));
    state.screen='game';
    state.paused=false;
    setGameChrome(true);
    syncAudioForContext();
  }
  updateHud();
  online.lastSnapshotAt=performance.now();
}
function mpOnlineHandle(packet) {
  if(packet.type==='welcome'&&online.role==='host'){online.send({type:'lobby-settings',bots:Math.min(mpLobby.bots,3),difficulty:mpLobby.difficulty});}
  if(packet.type==='roster'){
    if(online.connected){
      mpLobby.humans=online.roster.filter(p=>p.connected).length;
      mpLobby.bots=online.lobby.bots;mpLobby.difficulty=online.lobby.difficulty;
      if(online.role==='guest' && online.phase==='waiting'){
        const stage=online.lobby.stage;
        if(stage==='levels' && state.screen!=='levels'){
          $('#chosenRole').textContent='HEIST CIRCUIT';
          $('#chosenSummary').textContent=mpLobby.humans+' human(s) and '+mpLobby.bots+' bot(s) · '+mpLobby.difficulty+' bots';
          buildLevelCards();showScreen('levels');
        }
        else if(stage==='briefing' && state.screen!=='briefing'){
          const idx=online.lobby.levelIndex;
          state.levelIndex=idx;const level=LEVELS[idx];
          $('#briefingNumber').textContent='ROOM '+(idx+1)+' OF '+LEVELS.length;
          $('#briefingEyebrow').textContent=level.name;$('#briefingTitle').textContent=level.title;
          $('#briefingStory').textContent='Collect socks, then chase the moving RELAY DROP to cash in your bag. Compete for Tools and trigger gold jackpots while Draco hunts the room.';
          $('#briefingMission').textContent='HEIST CIRCUIT: deliver 2–4 socks to the glowing Relay Drop using your JACKPOT/USE key. It moves every 23 seconds! Socks return every 24 seconds; Tools every 34 seconds.';
          $('#briefingAbility').textContent='Carried socks are lost when Draco catches you. Choose: bank your bag at the Relay, spend 2 Tools on a shared gold jackpot, or spend 1 Tool to secure points at a hiding spot. Three lives each.';
          $('#playLevelBtn').disabled=true;$('#playLevelBtn').textContent='WAITING FOR HOST';
          showScreen('briefing');
        }else if(stage==='select' && state.screen!=='select'){showScreen('select');mpRenderLobby();}
      }
    }
    if(state.screen==='select')mpRenderLobby();
    return;
  }
  if(packet.type==='role'){
    if(state.screen==='select')mpRenderLobby();
    return;
  }
  if(packet.type==='start' && online.connected){
    state.levelIndex=packet.levelIndex;
    state.level=LEVELS[packet.levelIndex];
    mpRuntimeErrorV4=false;state.paused=false;
    document.querySelector('#mpSafeErrorV4')?.remove();
    state._renderWarnings=null;mpPrepareCanvasForRoom();
    online.phase='playing';
    showHint('Joining the host’s shared heist…',3);
  }
  if(packet.type==='snapshot'&&online.connected)mpReceiveSnapshot(packet.state);
  if(packet.type==='pause' && online.connected){
    state.paused=true;screens.pause.classList.add('active');
    const title=$('#pauseScreen h2');if(title)title.textContent='HOST PAUSED THE HEIST';
  }
  if(packet.type==='resume'&&online.connected){
    state.paused=false;screens.pause.classList.remove('active');
    lastFrame=performance.now();
  }
  if(packet.type==='finish' && online.connected) {
    if(packet.result?.final)mpReceiveSnapshot(packet.result.final);
    if(state.running)finishLevel(true,packet.result?.reason||'Online match complete.');
  }
  if(packet.type==='abort' && online.connected){
    state.running=false;state.paused=false;setGameChrome(false);showScreen('select');mpRenderLobby();
  }
  if(packet.type==='closed'){
    state.running=false;state.paused=false;setGameChrome(false);showScreen('select');mpRenderLobby('The host ended the online room.');
  }
}
function mpOnlineUI() {
  const box=$('#mpOnlineBox');if(!box)return;
  const status=$('#mpOnlineStatus');
  const url=$('#mpOnlineServer');
  const join=$('#mpOnlineRoom');
  if(!box.dataset.started)return;
  if(url&&online.server && document.activeElement!==url)url.value=online.server;
  if(join&&online.room && document.activeElement!==join)join.value=online.room;
  const busy=online.role==='host'||online.role==='guest';
  box.classList.toggle('mp-room-connected',online.connected);
  $('#mpOnlineHost').disabled=busy;
  $('#mpOnlineJoin').disabled=busy;
  $('#mpOnlineLeave').hidden=!busy;
  $('#mpOnlineGuestOptions').hidden=true; // Character choice lives in the shared lobby.
  $('#mpOnlineInvite').hidden=!online.connected;
  $('#mpOnlineCode').textContent=online.room;
  document.body.classList.toggle('mp-online-guest',online.role==='guest');
  status.textContent=online.message || (online.connected
    ? online.role==='host'?'DEDICATED ROOM '+online.room+' · '+online.roster.filter(p=>p.connected).length+'/4 connected · server runs the match':'CONNECTED · ROOM '+online.room+' · waiting for the host'
    : 'Local play works without an online server.');
  const mySeat=online.roster.find(p=>p.slot===online.slot);
  const onlineName=$('#mpOnlineName');
  if(online.connected&&mySeat&&onlineName&&document.activeElement!==onlineName)onlineName.value=mySeat.name;
  const list=$('#mpOnlineRoster');
  list.textContent=online.roster.map(p=>p.name+(p.connected?'':' (offline)')+' · '+CHARACTERS[p.character]?.name).join('   |   ');
  $('#resumeBtn').disabled=online.role==='guest';
  $('#restartBtn').disabled=online.connected;
  if(online.role==='guest'){
    $('#mpOnlineGuestStatus').textContent=online.phase==='playing'?'The dedicated server is running your match. Use P1 keys on this keyboard.':'Waiting for the room leader to start a match.';
  }
}
function mpOnlineSetup(){
  const box=$('#mpOnlineBox');if(!box)return;
  box.dataset.started='yes';
  const params=new URLSearchParams(location.search);
  const saved=localStorage.getItem('tthc-online-server')||'';
  const local=/^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  $('#mpOnlineServer').value=params.get('server')||saved||(local?`ws://${location.hostname}:4174/ws`:(window.TTHC_ONLINE_SERVER||''));
  $('#mpOnlineRoom').value=params.get('room')||'';
  $('#mpOnlineHost').onclick=()=>{
    const server=$('#mpOnlineServer').value.trim();
    localStorage.setItem('tthc-online-server',server);
    online.connect('host',server,'',mpLobby.choices[0],false,$('#mpOnlineName').value.trim()||'HOST');
  };
  const joinDialog=$('#mpJoinDialog');
  const joinInput=$('#mpOnlineRoom');
  const joinError=$('#mpJoinError');
  const closeJoin=()=>{if(joinDialog.open)joinDialog.close();};
  $('#mpOnlineJoin').onclick=()=>{
    joinError.textContent='';
    if(!joinDialog.open)joinDialog.showModal();
    joinInput.focus();joinInput.select();
  };
  $('#mpJoinCancel').onclick=closeJoin;
  $('#mpJoinBack').onclick=closeJoin;
  joinDialog.addEventListener('click',event=>{if(event.target===joinDialog)closeJoin();});
  $('#mpJoinForm').addEventListener('submit',event=>{
    event.preventDefault();
    const server=$('#mpOnlineServer').value.trim();
    const room=joinInput.value.trim().replace(/\s+/g,'').toUpperCase();
    if(!/^[A-Z0-9]{4,8}$/.test(room)){
      joinError.textContent='Enter the 4–8 character room code your friend shared.';
      joinInput.focus();return;
    }
    if(!server){joinError.textContent='The online server address is missing.';return;}
    localStorage.setItem('tthc-online-server',server);
    closeJoin();
    online.connect('guest',server,room,$('#mpOnlineCharacter').value,false,$('#mpOnlineName').value.trim()||'GUEST');
  });
  $('#mpOnlineCharacter').onchange=e=>{
    if(online.role==='guest')online.send({type:'character',character:e.target.value});
  };
  $('#mpOnlineLeave').onclick=()=>{
    online.disconnect();
    state.running=false;state.paused=false;setGameChrome(false);
    showScreen('select');mpRenderLobby();
  };
  $('#mpOnlineCopy').onclick=async()=>{
    const url=new URL(location.href);url.searchParams.set('room',online.room);url.searchParams.set('server',online.server);
    try{await navigator.clipboard.writeText(url.href);$('#mpOnlineStatus').textContent='Invite link copied. Send it to your friends.';}
    catch{$('#mpOnlineStatus').textContent='ROOM '+online.room+' · share this code and server address.';}
  };
  mpOnlineUI();
  if(params.get('room'))showScreen('select');
}
setInterval(()=>{
  if(online.connected&&state.running&&!state.paused){
    const map=MP_KEYMAPS_V4[0];
    const value=key=>keys.has(map[key])||touchKeys.has(key);
    const up=value('up') || keys.has('Space') || touchKeys.has('jump');
    online.sendInput({left:value('left'),right:value('right'),up,down:value('down'),jumpHeld:up});
  }
},50);

bindEvents(); syncAudioForContext(); requestAnimationFrame(frame);
mpOnlineSetup();
document.addEventListener('click',event=>{const back=event.target.closest?.('[data-back]');if(!back||online.role!=='host'||!online.connected||online.phase!=='waiting')return;const target=back.dataset.back;if(target==='select'||target==='levels')online.send({type:'lobby-stage',stage:target});});
loadAssets().catch((error) => { console.error(error); $("#loadingScreen p").textContent = "Something went wrong while loading the images. Start the page with VS Code Live Server."; });
