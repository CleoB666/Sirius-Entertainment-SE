import { GAME, CHARACTERS, CHARACTER_ORDER, THIEF_IDS, CONTROLS, ITEM_LABELS } from "./config.js";
import { LEVELS } from "./levels.js";

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
  selectedId: "clawster", levelIndex: 0, level: null, player: null, enemies: [], items: [], particles: [], dust: [],
  elapsed: 0, remaining: 0, collected: 0, caught: 0, hearts: 3, abilityCooldown: 0, abilityUses: 0,
  slowTimer: 0, invisibleTimer: 0, glideTimer: 0, damageCooldown: 0,
  hidden: false, hiddenSpot: null, hideTimer: 0, hideNoise: false,
  decoy: null, noise: null, footstepTimer: 0, hintTimer: 0, currentHint: -1,
  jumpBuffer: 0, coyote: 0, muted: false,
};

const keys = new Set();
const touchKeys = new Set();
const sprites = new Map();
const portraits = new Map();
const rooms = new Map();
let lastFrame = performance.now();
let accumulator = 0;

function showScreen(name) {
  Object.entries(screens).forEach(([key, screen]) => screen.classList.toggle("active", key === name));
  state.screen = name;
  syncAudioForContext();
}

function setGameChrome(visible) {
  dom.hud.classList.toggle("hidden", !visible);
  dom.touch.classList.toggle("hidden", !visible);
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
  setTimeout(() => showScreen("start"), 180);
}

function makeCharacterPortrait(id) {
  const portrait = document.createElement("div"); portrait.className = "character-portrait";
  const image = portraits.get(id).cloneNode(); image.src = CHARACTERS[id].portraitAsset;
  image.alt = `${CHARACTERS[id].name}, full character`;
  portrait.append(image);
  return portrait;
}

function buildMenus() {
  dom.characterGrid.textContent = "";
  CHARACTER_ORDER.forEach((id) => {
    const character = CHARACTERS[id]; const card = document.createElement("button");
    card.type = "button"; card.className = `character-card ${id === "draco" ? "guard-card" : ""}`;
    card.style.setProperty("--character-color", character.color); card.append(makeCharacterPortrait(id));
    const info = document.createElement("div"); info.className = "character-info";
    info.innerHTML = `<small>${character.role}</small><h3>${character.name}</h3><p>${character.ability} · ${character.description}</p>`;
    card.append(info); card.addEventListener("click", () => selectCharacter(id)); dom.characterGrid.append(card);
  });
  dom.startCast.textContent = "";
  const cast = document.createElement("img"); cast.className = "start-cast-image";
  cast.src = "assets/crew-cast.png"; cast.alt = ""; dom.startCast.append(cast);
  const abilityRules = $("#abilityRules"); abilityRules.textContent = "";
  CHARACTER_ORDER.forEach((id) => {
    const character = CHARACTERS[id]; const rule = document.createElement("div"); rule.className = "ability-rule";
    rule.style.setProperty("--ability-color", character.color);
    rule.innerHTML = `<strong>${character.name} · ${character.ability}</strong><span>${character.abilityText}</span>`;
    abilityRules.append(rule);
  });
}

function getProgress() {
  try { return clamp(Number(localStorage.getItem(GAME.saveKey)) || 1, 1, LEVELS.length); } catch { return 1; }
}
function saveProgress(value) {
  try { localStorage.setItem(GAME.saveKey, String(clamp(value, 1, LEVELS.length))); } catch { /* The game remains playable without storage. */ }
}

function selectCharacter(id) {
  state.selectedId = id; const character = CHARACTERS[id];
  $("#chosenRole").textContent = character.roleShort;
  $("#chosenSummary").textContent = `${character.name}: ${character.abilityText}`;
  buildLevelCards(); showScreen("levels");
}

function buildLevelCards() {
  const unlocked = getProgress(); dom.levelGrid.textContent = "";
  LEVELS.forEach((level, index) => {
    const card = document.createElement("button"); card.type = "button"; card.className = "level-card";
    card.disabled = index + 1 > unlocked;
    const sockCount = level.items.filter((item) => item.kind === "sock").length;
    const guardGoal = state.selectedId === "draco" ? `<span class="level-guard-goal">${sockCount} SOCK${sockCount === 1 ? "" : "S"} TO PROTECT · ${level.catches} THIEVES</span>` : "";
    card.innerHTML = `<span class="level-visual"></span><span class="level-card-content"><small>LEVEL ${level.number}</small><h3>${level.name}</h3><p>${level.tagline}</p>${guardGoal}</span>`;
    card.querySelector(".level-visual").style.backgroundImage = `linear-gradient(180deg, transparent 15%, rgba(3,8,14,.9) 88%), url(${level.background})`;
    card.addEventListener("click", () => prepareLevel(index)); dom.levelGrid.append(card);
  });
}

function prepareLevel(index) {
  state.levelIndex = index; const level = LEVELS[index]; const character = CHARACTERS[state.selectedId];
  const isGuard = state.selectedId === "draco";
  $("#briefingNumber").textContent = `LEVEL ${index + 1} OF ${LEVELS.length}`;
  $("#briefingEyebrow").textContent = level.name; $("#briefingTitle").textContent = level.title;
  $("#briefingStory").textContent = isGuard ? level.guardStory : level.thiefStory;
  const sockCount = level.items.filter((item) => item.kind === "sock").length;
  $("#briefingMission").textContent = isGuard ? `Catch ${level.catches} sock thieves before they steal ${sockGoalText(sockCount)}. There is no time limit.` : `Collect ${level.items.length} items, avoid Draco and reach ${level.exit.label}.`;
  $("#briefingAbility").textContent = `${character.ability}: ${character.abilityHint}`;
  showScreen("briefing");
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
    roamSpeed: .42, feintTimer: .8 + Math.random() * 1.8,
    stuckX: x, stuckCheckTimer: .65,
    hidden: false, hideSpot: null, hideTimer: 0, hideReveal: 0,
    invisible: 0, boostTimer: 0, abilityCooldown: 2.4 + Math.random() * 2.8,
    decisionTimer: .45 + Math.random() * .8, lootTarget: -1,
  };
}

function initLevel() {
  const level = LEVELS[state.levelIndex]; const isGuard = state.selectedId === "draco";
  const spawn = level.playerSpawn[isGuard ? "guard" : "thief"];
  state.level = level; state.player = createEntity(state.selectedId, spawn[0], spawn[1]);
  state.items = level.items.map((item, index) => ({ ...item, index, w: 26, h: 26, collected: false, magnet: false, phase: index * 1.7 }));
  state.enemies = [];
  if (isGuard) {
    for (let index = 0; index < level.catches; index += 1) {
      const id = THIEF_IDS[index % THIEF_IDS.length]; const surface = level.surfaces[1 + (index * 2) % (level.surfaces.length - 1)];
      const enemy = createEntity(id, clamp(surface.x + 20 + index * 29, surface.x + 4, surface.x + surface.w - CHARACTERS[id].width - 4), surface.y - CHARACTERS[id].height, true);
      state.enemies.push(enemy); chooseThiefRoamTarget(enemy, true);
    }
  } else {
    const spawnGuard = level.playerSpawn.guard; const draco = createEntity("draco", spawnGuard[0], spawnGuard[1], true);
    state.enemies.push(draco); chooseDracoRoamTarget(draco, true);
  }
  Object.assign(state, {
    particles: [], elapsed: 0, remaining: level.time, collected: 0, caught: 0, hearts: 3,
    abilityCooldown: 0, abilityUses: 0, slowTimer: 0, invisibleTimer: 0, glideTimer: 0,
    damageCooldown: 0, hidden: false, hiddenSpot: null, hideTimer: 0, hideNoise: false,
    decoy: null, noise: null, footstepTimer: 0, currentHint: -1, hintTimer: 0, jumpBuffer: 0, coyote: 0,
    running: true, paused: false,
  });
  state.dust = Array.from({ length: 38 }, (_, index) => ({ x: (index * 89 + 47) % GAME.width, y: 100 + (index * 137) % 510, r: .6 + index % 3 * .4, speed: 2 + index % 5 }));
  keys.clear(); touchKeys.clear(); updateHud(); setGameChrome(true);
  Object.values(screens).forEach((screen) => screen.classList.remove("active")); state.screen = "game";
  syncAudioForContext();
  showHint(isGuard ? `Catch the Crew before they steal ${sockGoalText(guardSockTotal())}. They change routes, hide and use abilities – there is no time limit.` : "Move across the floor and the highlighted tops of furniture. Jump toward an edge to grab it.", 6.5);
}

function inputDown(action) { return CONTROLS[action].some((code) => keys.has(code)) || touchKeys.has(action); }
function climbFor(entity) {
  const sensor = { x: entity.x + entity.w * .25, y: entity.y - 2, w: entity.w * .5, h: entity.h + 5 };
  return state.level.climbs.find((climb) => overlaps(sensor, climb));
}

function supportSurface(entity) {
  const feet = entity.y + entity.h;
  return state.level.surfaces.find((surface) =>
    entity.x + entity.w - 5 > surface.x && entity.x + 5 < surface.x + surface.w &&
    Math.abs(feet - surface.y) < 9
  );
}

function pullOntoLedge(entity, direction) {
  if (!direction || entity.climbing || entity.onGround || entity.vy < -230) return false;
  const handY = entity.y + entity.h * .2;
  const feetY = entity.y + entity.h;
  const ledge = state.level.surfaces.find((surface) => {
    if (surface.type === "floor" || surface.y < handY - 20 || surface.y > feetY + 14) return false;
    const atLeftEdge = direction > 0 && Math.abs(entity.x + entity.w - surface.x) < 21;
    const atRightEdge = direction < 0 && Math.abs(entity.x - (surface.x + surface.w)) < 21;
    return atLeftEdge || atRightEdge;
  });
  if (!ledge) return false;
  entity.x = direction > 0 ? ledge.x + 5 : ledge.x + ledge.w - entity.w - 5;
  entity.y = ledge.y - entity.h; entity.vx *= .35; entity.vy = 0;
  entity.onGround = true; entity.ledgePull = .24; entity.landSquash = .18;
  if (entity === state.player) burst(entity.x + entity.w / 2, ledge.y, CHARACTERS[entity.id].color, 4);
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
  if (climb && climbDir !== 0) entity.climbing = true;
  if (entity.climbing && !climb) entity.climbing = false;
  if (entity.climbing && entity.jumpBuffer > 0) { entity.climbing = false; entity.vy = -character.jump * .78; entity.jumpBuffer = 0; state.jumpBuffer = 0; }

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
        entity.climbing = false; entity.onGround = true; entity.vy = 0; entity.ledgePull = .24;
        entity.x = clamp(entity.x, mount.x + 5, mount.x + mount.w - entity.w - 5);
        entity.y = mount.y - entity.h;
      }
    }
  } else {
    if (entity.jumpBuffer > 0 && entity.coyote > 0) {
      entity.vy = -character.jump; entity.onGround = false; entity.coyote = 0; entity.jumpBuffer = 0; state.jumpBuffer = 0;
      burst(entity.x + entity.w / 2, entity.y + entity.h, character.color, 5);
    }
    let gravityScale = 1;
    if (entity.vy < 0 && !controls.jumpHeld) gravityScale = 1.95;
    if (isPlayer && state.glideTimer > 0) gravityScale = .24;
    entity.vy = Math.min(GAME.maxFall, entity.vy + GAME.gravity * gravityScale * dt);
  }

  const oldBottom = entity.y + entity.h; const wasGrounded = entity.onGround;
  entity.x = clamp(entity.x + entity.vx * dt, 0, GAME.width - entity.w); entity.y += entity.vy * dt; entity.onGround = false;
  const grabbedLedge = pullOntoLedge(entity, dir);
  if (!grabbedLedge && !entity.climbing && entity.vy >= 0) {
    let landing = null;
    state.level.surfaces.forEach((surface) => {
      const nextBottom = entity.y + entity.h;
      const horizontal = entity.x + entity.w - 5 > surface.x && entity.x + 5 < surface.x + surface.w;
      if (horizontal && oldBottom <= surface.y + 5 && nextBottom >= surface.y && (!landing || surface.y < landing.y)) landing = surface;
    });
    if (landing) {
      const landingSpeed = entity.vy; entity.y = landing.y - entity.h; entity.vy = 0; entity.onGround = true;
      if (!wasGrounded && landingSpeed > 170) { entity.landSquash = clamp(landingSpeed / 850, .15, .7); if (isPlayer) burst(entity.x + entity.w / 2, landing.y, "#d8e3e8", 4); }
    }
  }
  entity.animDistance += Math.abs(entity.x - entity.prevX) + Math.abs(entity.y - entity.prevY) * .28;
  if (entity.y > GAME.height + 80) {
    if (isPlayer) takeDamage("You lost your footing.");
    else { entity.x = 80 + Math.random() * 1100; entity.y = 380; entity.vy = 0; }
  }
}

function playerControls() {
  return {
    left: inputDown("left"), right: inputDown("right"), up: inputDown("up"), down: inputDown("down"),
    jumpHeld: inputDown("jump"),
  };
}

function queueJump() {
  if (!state.running || state.paused || state.hidden) return;
  state.jumpBuffer = .13;
}

function nearbyHideSpot() {
  if (!state.player || state.selectedId === "draco") return null;
  const expanded = { x: state.player.x - 34, y: state.player.y - 25, w: state.player.w + 68, h: state.player.h + 50 };
  return state.level.hideSpots.find((spot) => overlaps(expanded, spot));
}

function toggleHide() {
  if (!state.running || state.paused || state.selectedId === "draco") return;
  if (state.hidden) {
    state.hidden = false; state.player.x = clamp(state.hiddenSpot.x + state.hiddenSpot.w + 8, 0, GAME.width - state.player.w);
    state.player.y = state.level.floorY - state.player.h - 2; state.player.prevX = state.player.x; state.player.prevY = state.player.y;
    state.hiddenSpot = null; state.hideTimer = 0;
    showHint("You leave the hiding place.", 1.4); return;
  }
  const spot = nearbyHideSpot();
  if (!spot) { showHint("Move closer to a dark hiding place first.", 1.5); return; }
  const draco = state.enemies.find((enemy) => enemy.id === "draco" && enemy.active);
  if (draco && draco.mode === "chase" && distance(draco, state.player) < 175 && canSeePlayer(draco)) {
    showHint("Draco can see you – break his line of sight before hiding!", 2.3); return;
  }
  state.hidden = true; state.hiddenSpot = spot; state.hideTimer = 0; state.hideNoise = false;
  state.player.vx = 0; state.player.vy = 0;
  state.player.x = spot.x + spot.w / 2 - state.player.w / 2; state.player.y = spot.y + spot.h - state.player.h - 5;
  state.player.prevX = state.player.x; state.player.prevY = state.player.y;
  if (draco?.mode === "chase") draco.memory = Math.min(draco.memory, 1.1);
  showHint(`Hidden ${spot.label}. Press Q to leave.`, 2.4);
}

function canSeePlayer(draco) {
  if (state.hidden || state.invisibleTimer > 0 || !state.player) return false;
  const dx = state.player.x - draco.x; const dy = state.player.y - draco.y;
  const sight = draco.mode === "chase" ? 390 : 305;
  const inFront = Math.sign(dx || draco.face) === draco.face || Math.abs(dx) < 78;
  return inFront && Math.hypot(dx, dy * 1.35) < sight && Math.abs(dy) < 205;
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

function updatePlayer(dt) {
  if (state.damageCooldown > 0) state.damageCooldown -= dt;
  if (state.abilityCooldown > 0) state.abilityCooldown -= dt;
  if (state.slowTimer > 0) state.slowTimer -= dt;
  if (state.invisibleTimer > 0) state.invisibleTimer -= dt;
  if (state.glideTimer > 0) state.glideTimer -= dt;
  if (state.noise) { state.noise.time -= dt; if (state.noise.time <= 0) state.noise = null; }

  if (state.hidden) {
    state.player.prevX = state.player.x; state.player.prevY = state.player.y;
    state.hideTimer += dt;
    if (state.hideTimer > 5.2 && !state.hideNoise) { state.hideNoise = true; emitNoise(state.player.x, .7); showHint("You have been hiding too long – Draco hears something…", 2.2); }
  } else {
    updateEntity(state.player, dt, playerControls(), 1, true);
    state.footstepTimer -= dt;
    if (state.player.onGround && Math.abs(state.player.vx) > 235 && state.footstepTimer <= 0) {
      state.footstepTimer = .34; emitNoise(state.player.x, .13);
    }
    state.level.noiseZones.forEach((zone) => {
      if (overlaps(state.player, zone, 4) && Math.abs(state.player.vx) > 45 && state.footstepTimer <= .18) emitNoise(state.player.x, .48);
    });
    if (state.selectedId !== "draco") {
      state.level.hazards.forEach((hazard) => {
        if (overlaps(state.player, { x: hazard.x, y: hazard.y - 4, w: hazard.w, h: hazard.h + 8 }, 5)) takeDamage("That was not a safe route.");
      });
    }
  }

  if (state.selectedId !== "draco") {
    state.items.forEach((item) => {
      if (item.collected) return;
      if (item.magnet) {
        const dx = state.player.x + state.player.w / 2 - item.x; const dy = state.player.y + state.player.h / 2 - item.y;
        const length = Math.max(1, Math.hypot(dx, dy)); item.x += dx / length * 255 * dt; item.y += dy / length * 255 * dt;
      }
      if (!state.hidden && overlaps(state.player, { x: item.x - 13, y: item.y - 13, w: 26, h: 26 }, 2)) collectItem(item);
    });
    if (!state.hidden && state.collected === state.items.length && overlaps(state.player, state.level.exit, 3)) finishLevel(true);
  }
}

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
    .filter(({ surface, climbLink }) => surface.w >= 75 && (Math.abs(surface.y - currentY) <= 160 || climbLink));
  const raised = candidates.filter(({ surface, index }) => surface.type !== "floor" && (!forceDifferent || index !== draco.roamSurface));
  const floor = candidates.filter(({ surface }) => surface.type === "floor");
  if (raised.length && Math.random() < .42) candidates = raised;
  else if (floor.length && Math.random() < .72) candidates = floor;
  if (forceDifferent && candidates.length > 1) candidates = candidates.filter(({ index }) => index !== draco.roamSurface);
  const choice = candidates[Math.floor(Math.random() * candidates.length)] || { surface: state.level.surfaces[0], index: 0, climbLink: null };
  const margin = Math.min(42, Math.max(10, choice.surface.w * .14));
  const available = Math.max(1, choice.surface.w - draco.w - margin * 2);
  const x = clamp(choice.surface.x + margin + Math.random() * available, 8, GAME.width - draco.w - 8);
  const y = choice.surface.y - draco.h;
  draco.roamTarget = { x, y, surface: choice.surface.type, viaClimb: choice.surface.y < currentY - 155 ? choice.climbLink : null };
  draco.roamSurface = choice.index;
  draco.roamTimer = 3.1 + Math.abs(x - draco.x) / 175 + Math.abs(y - draco.y) / 130 + Math.random() * 1.8;
  draco.roamSpeed = .32 + Math.random() * .22; draco.feintTimer = .65 + Math.random() * 1.7;
}

function keepDracoMoving(draco, dt) {
  draco.stuckCheckTimer -= dt;
  if (draco.stuckCheckTimer > 0) return;
  const barelyMoved = Math.abs(draco.x - draco.stuckX) < 3;
  if (barelyMoved) {
    if (draco.mode === "patrol") chooseDracoRoamTarget(draco, true);
    else { draco.searchSide *= -1; draco.lastSeenX = clamp(draco.x + draco.searchSide * (75 + Math.random() * 95), 20, GAME.width - 20); }
    draco.face *= -1; draco.vx = draco.face * 72;
    if (draco.onGround) { draco.jumpBuffer = .12; draco.aiJump = .7; }
  }
  draco.stuckX = draco.x; draco.stuckCheckTimer = .5 + Math.random() * .24;
}

function updateDraco(draco, dt) {
  if (!draco.active) return;
  const visible = canSeePlayer(draco); const slowScale = state.slowTimer > 0 ? .48 : 1;
  const controls = { jumpHeld: true };
  if (visible) {
    draco.lastSeenX = state.player.x; draco.lastSeenY = state.player.y;
    draco.suspicion = clamp(draco.suspicion + dt * (draco.mode === "chase" ? 2.5 : 1.25), 0, 1);
    if (draco.suspicion >= 1) { draco.mode = "chase"; draco.memory = 4; }
    else if (draco.mode === "patrol") { draco.mode = "alert"; draco.searchTimer = 1.8; }
  } else if (draco.mode !== "chase") draco.suspicion = Math.max(0, draco.suspicion - dt * .23);

  if (state.decoy) {
    draco.mode = "chase"; draco.lastSeenX = state.decoy.x; draco.lastSeenY = state.decoy.y; draco.memory = state.decoy.time;
  }

  if (draco.mode === "patrol") {
    if (!draco.roamTarget) chooseDracoRoamTarget(draco);
    draco.roamTimer -= dt; draco.feintTimer -= dt;
    let dx = draco.roamTarget.x - draco.x; let dy = draco.roamTarget.y - draco.y;
    const arrived = Math.abs(dx) < 20 && Math.abs(dy) < 28;
    if (arrived || draco.roamTimer <= 0) { chooseDracoRoamTarget(draco, true); dx = draco.roamTarget.x - draco.x; dy = draco.roamTarget.y - draco.y; }
    if (draco.feintTimer <= 0 && !draco.climbing) {
      if (Math.random() < .38) chooseDracoRoamTarget(draco, true);
      else { draco.face *= -1; draco.roamSpeed = .3 + Math.random() * .25; }
      draco.feintTimer = .65 + Math.random() * 1.8; dx = draco.roamTarget.x - draco.x; dy = draco.roamTarget.y - draco.y;
    }
    const climb = draco.roamTarget.viaClimb;
    if (draco.climbing) controls.up = true;
    else if (climb && dy < -70) {
      const climbDx = climb.x + climb.w / 2 - (draco.x + draco.w / 2);
      controls.left = climbDx < -7; controls.right = climbDx > 7; controls.up = Math.abs(climbDx) <= 10;
    } else { controls.left = dx < -8; controls.right = dx > 8; }
    if (!climb && dy < -42 && draco.onGround && draco.aiJump <= 0) { draco.jumpBuffer = .12; draco.aiJump = .85 + Math.random() * .55; }
    draco.aiJump -= dt; updateEntity(draco, dt, controls, draco.roamSpeed * slowScale);
  } else if (draco.mode === "alert") {
    draco.searchTimer -= dt; let dx = draco.lastSeenX - draco.x; draco.face = Math.sign(dx || draco.face);
    if (Math.abs(dx) <= 34) { draco.searchSide *= -1; dx = draco.searchSide * (48 + Math.random() * 36); }
    controls.left = dx < 0; controls.right = dx > 0;
    updateEntity(draco, dt, controls, .34 * slowScale);
    if (draco.suspicion >= 1) { draco.mode = "chase"; draco.memory = 4; }
    else if (draco.searchTimer <= 0 && !visible) { draco.mode = "search"; draco.searchTimer = 3.4; }
  } else if (draco.mode === "chase") {
    const targetX = state.decoy ? state.decoy.x : draco.lastSeenX;
    const targetY = state.decoy ? state.decoy.y : draco.lastSeenY;
    const dx = targetX - draco.x; const dy = targetY - draco.y;
    controls.left = dx < -12; controls.right = dx > 12;
    if (dy < -65 && draco.onGround && draco.aiJump <= 0) { draco.jumpBuffer = .12; draco.aiJump = 1.3; }
    draco.aiJump -= dt; updateEntity(draco, dt, controls, 1.02 * slowScale);
    if (visible && !state.decoy) draco.memory = 4; else draco.memory -= dt * (state.hidden ? 2.6 : 1);
    if (draco.memory <= 0) { draco.mode = "search"; draco.searchTimer = 4.4; draco.searchSide = 1; draco.suspicion = .58; }
  } else {
    draco.searchTimer -= dt;
    const targetX = draco.lastSeenX + draco.searchSide * 78;
    if (Math.abs(targetX - draco.x) < 14) draco.searchSide *= -1;
    controls.left = targetX < draco.x; controls.right = targetX > draco.x;
    updateEntity(draco, dt, controls, .48 * slowScale);
    if (visible) { draco.suspicion = clamp(draco.suspicion + dt * 2, 0, 1); if (draco.suspicion >= 1) { draco.mode = "chase"; draco.memory = 4; } }
    if (draco.searchTimer <= 0) { draco.mode = "patrol"; draco.suspicion = 0; chooseDracoRoamTarget(draco, true); }
  }

  keepDracoMoving(draco, dt);

  const close = distance(draco, state.player);
  if (state.hidden && state.hideTimer > 5.2 && close < 78) {
    state.hidden = false; state.hiddenSpot = null; takeDamage("Draco found your hiding place!");
  } else if (!state.hidden && state.invisibleTimer <= 0 && state.damageCooldown <= 0 && close < 58 && overlaps(state.player, draco, 4)) takeDamage("Draco caught up with you!");
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
    .filter(({ surface, climbLink }) => surface.w >= 72 && (Math.abs(surface.y - currentY) <= 175 || climbLink));
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
  const margin = Math.min(34, Math.max(8, choice.surface.w * .12));
  const available = Math.max(1, choice.surface.w - thief.w - margin * 2);
  const randomX = choice.surface.x + margin + Math.random() * available;
  const targetX = lootTarget && !threatened ? clamp(lootTarget.x - thief.w / 2, choice.surface.x + margin, choice.surface.x + choice.surface.w - thief.w - margin) : randomX;
  const x = clamp(targetX, 7, GAME.width - thief.w - 7);
  thief.roamTarget = {
    x,
    y: choice.surface.y - thief.h,
    viaClimb: choice.surface.y < currentY - 45 ? choice.climbLink : null,
  };
  thief.roamSurface = choice.index;
  thief.roamTimer = 2.5 + Math.abs(x - thief.x) / 190 + Math.random() * 2.2;
  thief.roamSpeed = .48 + Math.random() * .2;
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
  if (!spots.length || Math.random() > .42) return false;
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
  thief.abilityCooldown = Math.max(5.4, CHARACTERS[thief.id].cooldown * .7) + Math.random() * 2.4;
  thief.pulse = .48; burst(thief.x + thief.w / 2, thief.y + thief.h / 2, CHARACTERS[thief.id].color, 10);
}

function updateThiefAi(enemy, dt) {
  if (!enemy.active || !state.running) return;
  enemy.aiTimer -= dt; enemy.aiJump -= dt; enemy.decisionTimer -= dt; enemy.abilityCooldown -= dt;
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
  const speed = (threatDistance < 320 ? .88 : enemy.roamSpeed) * (enemy.boostTimer > 0 ? 1.28 : 1);
  updateEntity(enemy, dt, controls, speed);

  enemy.stuckCheckTimer -= dt;
  if (enemy.stuckCheckTimer <= 0) {
    if (Math.abs(enemy.x - enemy.stuckX) < 2.5) {
      chooseThiefRoamTarget(enemy, true); enemy.face *= -1; enemy.vx = enemy.face * 90;
      if (enemy.onGround) enemy.jumpBuffer = .12;
    }
    enemy.stuckX = enemy.x; enemy.stuckCheckTimer = .55 + Math.random() * .35;
  }

  if (!enemy.hidden && enemy.invisible <= 0 && overlaps(state.player, enemy, 5)) catchEnemy(enemy);
  if (!enemy.active || !state.running) return;
  const sock = state.items.find((item) => item.kind === "sock" && !item.collected && overlaps(enemy, { x: item.x - 13, y: item.y - 13, w: 26, h: 26 }, 2));
  if (sock) stealSock(enemy, sock);
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
  if (!state.hidden) {
    const nextIndex = state.level.tutorial.findIndex((hint, index) => index > state.currentHint && state.player.x >= hint.x);
    if (nextIndex >= 0) { state.currentHint = nextIndex; showHint(state.level.tutorial[nextIndex].text, 3.3); }
  }
}

function update(dt) {
  const isGuard = state.selectedId === "draco";
  state.elapsed += dt;
  if (!isGuard) state.remaining = Math.max(0, state.remaining - dt);
  updatePlayer(dt); updateEnemies(dt); updateEffects(dt);
  if (!isGuard && state.remaining <= 0) finishLevel(false, "Time ran out.");
  updateHud();
}

function useAbility() {
  if (!state.running || state.paused || state.hidden || state.abilityCooldown > 0) return;
  const character = CHARACTERS[state.selectedId]; const center = { x: state.player.x + state.player.w / 2, y: state.player.y + state.player.h / 2 };
  let used = false;
  if (state.selectedId === "draco") {
    const targets = state.enemies.filter((enemy) => enemy.active && !enemy.hidden && enemy.invisible <= 0 && distance(enemy, state.player) < 155);
    if (targets.length) { targets.forEach((enemy) => { enemy.stunned = 1.45; }); state.player.pulse = .62; burst(center.x, center.y, character.color, 19); showHint("The thieves are stunned – catch them now!", 1.8); used = true; }
    else showHint("No thief is within Guardian Pulse range.", 1.5);
  } else if (state.selectedId === "clawster") {
    const candidates = state.items.filter((item) => !item.collected && Math.hypot(item.x - center.x, item.y - center.y) <= 230);
    candidates.sort((a, b) => Math.hypot(a.x - center.x, a.y - center.y) - Math.hypot(b.x - center.x, b.y - center.y));
    if (candidates[0]) { candidates[0].magnet = true; burst(candidates[0].x, candidates[0].y, character.color, 11); showHint("Magnet Claw pulls in a nearby item.", 1.7); used = true; }
    else showHint("No item is close enough.", 1.5);
  } else if (state.selectedId === "lairy") {
    if (!state.player.onGround) { state.player.vy = Math.min(state.player.vy, -290); state.player.vx += state.player.face * 95; state.glideTimer = 1.05; burst(center.x, center.y, character.accent, 13); used = true; }
    else showHint("Wing Burst can only be used in the air.", 1.4);
  } else if (state.selectedId === "gramp") {
    const draco = state.enemies[0];
    if (draco && distance(draco, state.player) < 340) { state.slowTimer = 2.25; burst(center.x, center.y, character.color, 15); showHint("Master Plan gives you a brief head start.", 1.8); used = true; }
    else showHint("Draco is too far away for Master Plan.", 1.5);
  } else if (state.selectedId === "strappy") {
    const draco = state.enemies[0];
    if (draco && draco.suspicion > .2) { state.decoy = { x: state.player.x - state.player.face * 70, y: state.player.y, w: state.player.w, h: state.player.h, face: -state.player.face, time: 2.4 }; draco.lastSeenX = state.decoy.x; burst(center.x, center.y, character.color, 12); showHint("False Trail! Change direction now.", 1.8); used = true; }
    else showHint("Save False Trail until Draco becomes suspicious.", 1.6);
  } else if (state.selectedId === "trasselsudd") {
    state.invisibleTimer = 1.8; const draco = state.enemies[0]; if (draco?.mode === "chase") draco.memory = Math.min(draco.memory, 1.2);
    burst(center.x, center.y, character.color, 13); showHint("Tangle Veil – break Draco's line of sight!", 1.6); used = true;
  }
  if (used) { state.abilityCooldown = character.cooldown; state.abilityUses += 1; }
}

function collectItem(item) {
  if (item.collected) return; item.collected = true; state.collected += 1; burst(item.x, item.y, "#ffb653", 12); emitNoise(item.x, .12);
  if (state.collected === state.items.length) showHint(`Everything is collected! Reach ${state.level.exit.label}.`, 4);
  else { const label = ITEM_LABELS[item.kind]; showHint(`${label[0].toUpperCase()}${label.slice(1)} found · ${state.collected}/${state.items.length}`, 1.6); }
}

function guardSockItems() { return state.items.filter((item) => item.kind === "sock"); }
function guardSockTotal() { return guardSockItems().length; }
function sockGoalText(count) { return count === 1 ? "the last sock" : `all ${count} socks`; }

function stealSock(thief, item) {
  if (item.collected || !thief.active || !state.running) return;
  item.collected = true; state.collected += 1;
  state.enemies.forEach((enemy) => { if (enemy.lootTarget === item.index) enemy.lootTarget = -1; });
  burst(item.x, item.y, CHARACTERS[thief.id].color, 14);
  showHint(`${CHARACTERS[thief.id].name} stole a sock · ${state.collected}/${guardSockTotal()}`, 1.8);
  if (state.collected >= guardSockTotal()) finishLevel(false, "The Crew stole every sock.");
  else chooseThiefRoamTarget(thief, true);
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

function takeDamage(message) {
  if (state.damageCooldown > 0 || !state.running || state.invisibleTimer > 0) return;
  state.hearts -= 1; state.damageCooldown = 1.8; state.hidden = false; state.hiddenSpot = null; state.hideTimer = 0;
  burst(state.player.x + state.player.w / 2, state.player.y + state.player.h / 2, "#ff5b68", 17);
  if (state.hearts <= 0) { finishLevel(false, message); return; }
  const spawn = state.level.playerSpawn.thief; state.player.x = spawn[0]; state.player.y = spawn[1]; state.player.prevX = spawn[0]; state.player.prevY = spawn[1];
  state.player.vx = 0; state.player.vy = 0; resetDracoAfterCatch(); showHint(`${message} ${state.hearts} lives left.`, 2.7);
}

function burst(x, y, color, amount) {
  for (let index = 0; index < amount; index += 1) {
    const angle = Math.PI * 2 * index / amount + Math.random() * .35; const speed = 45 + Math.random() * 145;
    state.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 30, life: .42 + Math.random() * .4, maxLife: .82, color, size: 1.5 + Math.random() * 3 });
  }
}

function showHint(text, duration = 2.5) { dom.hint.textContent = text; dom.hint.classList.remove("hidden"); state.hintTimer = duration; }

function updateStealthHud() {
  dom.stealth.className = "stealth-hud";
  if (state.selectedId === "draco") {
    const visible = state.enemies.filter((enemy) => enemy.active && !enemy.hidden && enemy.invisible <= 0);
    const hiddenCount = state.enemies.filter((enemy) => enemy.active && (enemy.hidden || enemy.invisible > 0)).length;
    const nearest = visible.sort((a, b) => distance(a, state.player) - distance(b, state.player))[0];
    const near = nearest ? distance(nearest, state.player) : 999;
    dom.stealth.classList.add(near < 230 ? "wary" : "safe"); dom.stealthIcon.textContent = "⌖";
    dom.stealthState.textContent = near < 150 ? "THIEF VERY CLOSE" : near < 300 ? "TRACKS IN THE ROOM" : hiddenCount ? "SOMEONE IS HIDING" : "LISTEN";
    dom.stealthTip.textContent = hiddenCount ? "Search near dark hiding places" : "Touch a thief to catch them"; dom.stealthFill.style.width = `${clamp(100 - near / 5, 0, 100)}%`; return;
  }
  const draco = state.enemies[0]; if (!draco) return;
  if (state.hidden) {
    dom.stealth.classList.add("hidden-state"); dom.stealthIcon.textContent = "◌"; dom.stealthState.textContent = "HIDDEN";
    dom.stealthTip.textContent = state.hideTimer > 5 ? "You are starting to make noise…" : `Safe for ${Math.max(0, 6 - state.hideTimer).toFixed(1)} s`;
    dom.stealthFill.style.width = `${clamp(state.hideTimer / 6 * 100, 0, 100)}%`; return;
  }
  if (draco.mode === "chase") {
    dom.stealth.classList.add("chase"); dom.stealthIcon.textContent = "!"; dom.stealthState.textContent = "SPOTTED – HIDE";
    dom.stealthTip.textContent = "Break line of sight and find a hiding place"; dom.stealthFill.style.width = "100%";
  } else if (draco.mode === "search") {
    dom.stealth.classList.add("search"); dom.stealthIcon.textContent = "?"; dom.stealthState.textContent = "DRACO IS SEARCHING";
    dom.stealthTip.textContent = "He is checking where you were last seen"; dom.stealthFill.style.width = `${clamp(draco.searchTimer / 4.4 * 100, 0, 100)}%`;
  } else if (draco.mode === "alert" || draco.suspicion > .15) {
    dom.stealth.classList.add("wary"); dom.stealthIcon.textContent = "◉"; dom.stealthState.textContent = "DRACO IS SUSPICIOUS";
    dom.stealthTip.textContent = "Slow down and leave the area"; dom.stealthFill.style.width = `${draco.suspicion * 100}%`;
  } else {
    dom.stealth.classList.add("safe"); dom.stealthIcon.textContent = "◉"; dom.stealthState.textContent = "CLEAR";
    dom.stealthTip.textContent = "Draco is roaming freely"; dom.stealthFill.style.width = `${draco.suspicion * 100}%`;
  }
}

function updateHud() {
  if (!state.level || !state.player) return;
  const character = CHARACTERS[state.selectedId]; const isGuard = state.selectedId === "draco";
  const total = isGuard ? state.level.catches : state.items.length; const value = isGuard ? state.caught : state.collected;
  dom.level.textContent = `LEVEL ${state.levelIndex + 1}`; dom.place.textContent = state.level.name; dom.role.textContent = character.roleShort;
  dom.objective.textContent = isGuard ? `Caught ${value}/${total}` : `Items ${value}/${total}`; dom.progress.style.width = `${value / total * 100}%`;
  const socksSafe = isGuard ? guardSockTotal() - state.collected : 0;
  dom.time.classList.toggle("guard-stock", isGuard);
  dom.time.classList.toggle("urgent", isGuard && socksSafe <= Math.max(1, Math.ceil(guardSockTotal() * .35)));
  if (isGuard) {
    dom.time.textContent = `SOCKS ${socksSafe}/${guardSockTotal()}`;
    dom.time.setAttribute("aria-label", `${socksSafe} of ${guardSockTotal()} socks are still safe`);
  } else {
    const minutes = Math.floor(state.remaining / 60); const seconds = Math.ceil(state.remaining % 60);
    dom.time.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    dom.time.setAttribute("aria-label", `${minutes} minutes and ${seconds} seconds remaining`);
  }
  dom.hearts.textContent = isGuard ? "GUARDIAN" : `${"◆ ".repeat(state.hearts)}${"◇ ".repeat(3 - state.hearts)}`.trim();
  dom.abilityName.textContent = character.ability;
  const ratio = state.abilityCooldown <= 0 ? 1 : 1 - state.abilityCooldown / character.cooldown;
  dom.abilityFill.style.transform = `scaleX(${clamp(ratio, 0, 1)})`; dom.abilityState.textContent = state.abilityCooldown <= 0 ? "READY" : `${state.abilityCooldown.toFixed(1)} S`;
  updateStealthHud();
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
  const playerCenter = state.player.x + state.player.w / 2;
  const playerFeet = state.player.y + state.player.h;
  const furniture = state.level.surfaces.filter((surface) => surface.type !== "floor");
  const nearestSurface = furniture.reduce((nearest, surface) => {
    const horizontalGap = Math.max(0, Math.abs(playerCenter - (surface.x + surface.w / 2)) - surface.w / 2);
    const score = horizontalGap + Math.abs(playerFeet - surface.y) * .55;
    return !nearest || score < nearest.score ? { surface, score } : nearest;
  }, null);
  furniture.forEach((surface) => {
    const active = nearestSurface?.surface === surface && nearestSurface.score < 165;
    ctx.globalAlpha = active ? .88 : .3; ctx.strokeStyle = active ? "#b8f1ff" : "#82bed0"; ctx.lineWidth = active ? 3 : 1.5;
    ctx.beginPath(); ctx.moveTo(surface.x + 4, surface.y); ctx.lineTo(surface.x + surface.w - 4, surface.y); ctx.stroke();
    ctx.fillStyle = active ? "#dcf8ff" : "#82bed0";
    for (const edgeX of [surface.x + 5, surface.x + surface.w - 5]) {
      ctx.beginPath(); ctx.arc(edgeX, surface.y, active ? 3.5 : 2, 0, Math.PI * 2); ctx.fill();
    }
  });
  if (nearestSurface && nearestSurface.score < 165 && nearestSurface.surface.label) {
    const surface = nearestSurface.surface; const labelX = clamp(playerCenter, surface.x + 62, surface.x + surface.w - 62);
    ctx.globalAlpha = .92; ctx.fillStyle = "rgba(4,13,22,.88)"; ctx.fillRect(labelX - 62, surface.y - 28, 124, 20);
    ctx.fillStyle = "#d9f7ff"; ctx.font = "900 10px system-ui"; ctx.textAlign = "center";
    ctx.fillText(`JUMP/LAND · ${surface.label.toUpperCase()}`, labelX, surface.y - 14);
  }
  state.level.climbs.forEach((climb) => {
    const near = Math.abs(playerCenter - (climb.x + climb.w / 2)) <= 105;
    ctx.globalAlpha = near ? .75 : .2; ctx.strokeStyle = near ? "#9be7ff" : "#67aabc"; ctx.lineWidth = near ? 3 : 1.5; ctx.setLineDash([5, 7]);
    ctx.beginPath(); ctx.moveTo(climb.x + climb.w / 2, climb.y); ctx.lineTo(climb.x + climb.w / 2, climb.y + climb.h); ctx.stroke(); ctx.setLineDash([]);
    if (!near) return;
    ctx.fillStyle = "rgba(5,14,23,.88)"; ctx.fillRect(climb.x - 8, climb.y - 25, Math.max(90, climb.w + 30), 20);
    ctx.fillStyle = "#bdeeff"; ctx.font = "800 10px system-ui"; ctx.textAlign = "left"; ctx.fillText("W/S  CLIMB", climb.x, climb.y - 11);
  });
  if (state.selectedId !== "draco" && !state.hidden) {
    const spot = nearbyHideSpot();
    if (spot) {
      ctx.globalAlpha = .8; ctx.fillStyle = "rgba(4,10,18,.78)"; ctx.fillRect(spot.x + spot.w / 2 - 49, spot.y - 26, 98, 21);
      ctx.fillStyle = "#e8c6f4"; ctx.font = "900 10px system-ui"; ctx.textAlign = "center"; ctx.fillText("Q  HIDE", spot.x + spot.w / 2, spot.y - 12);
    }
  }
  state.level.noiseZones.forEach((zone, index) => {
    ctx.globalAlpha = .18 + Math.sin(state.elapsed * 3 + index) * .06; ctx.strokeStyle = "#f3b55c"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(zone.x, zone.y); ctx.lineTo(zone.x + zone.w * .35, zone.y - 3); ctx.lineTo(zone.x + zone.w * .65, zone.y + 2); ctx.lineTo(zone.x + zone.w, zone.y - 2); ctx.stroke();
  }); ctx.globalAlpha = 1;
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

function drawItem(item) {
  if (item.collected || (state.selectedId === "draco" && item.kind !== "sock")) return;
  const y = item.y + Math.sin(state.elapsed * 3.1 + item.phase) * 4;
  ctx.save(); ctx.translate(item.x, y); ctx.shadowBlur = 16; ctx.shadowColor = "#ffad4b"; ctx.fillStyle = "#ffc269"; ctx.strokeStyle = "#5d2e0c"; ctx.lineWidth = 2;
  if (state.selectedId === "draco") {
    const markerRadius = 19 + Math.sin(state.elapsed * 4.2 + item.phase) * 2;
    ctx.save(); ctx.shadowColor = "#73d5f7"; ctx.shadowBlur = 14; ctx.strokeStyle = "rgba(157,230,255,.92)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, markerRadius, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0; ctx.fillStyle = "#dff8ff"; ctx.font = "900 8px system-ui"; ctx.textAlign = "center"; ctx.fillText("SOCK", 0, -25); ctx.restore();
  }
  if (item.kind === "sock") {
    ctx.beginPath(); ctx.moveTo(-7,-12); ctx.lineTo(6,-12); ctx.lineTo(5,1); ctx.quadraticCurveTo(14,1,13,8); ctx.quadraticCurveTo(7,14,-6,9); ctx.lineTo(-3,2); ctx.closePath(); ctx.fill(); ctx.stroke();
  } else if (item.kind === "key") {
    ctx.beginPath(); ctx.arc(-6,-4,6,0,Math.PI*2); ctx.moveTo(0,0); ctx.lineTo(13,10); ctx.lineTo(9,14); ctx.lineTo(5,9); ctx.stroke();
  } else if (item.kind === "button") {
    ctx.beginPath(); ctx.arc(0,0,10,0,Math.PI*2); ctx.fill(); ctx.stroke(); ctx.fillStyle="#6b3510";
    [[-3,-3],[3,-3],[-3,3],[3,3]].forEach(([dx,dy])=>{ctx.beginPath();ctx.arc(dx,dy,1.5,0,Math.PI*2);ctx.fill();});
  } else if (item.kind === "spoon") {
    ctx.beginPath(); ctx.ellipse(-4,-6,6,9,-.45,0,Math.PI*2); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(11,14); ctx.stroke();
  } else if (item.kind === "spool") {
    ctx.fillRect(-8,-9,16,18); ctx.strokeRect(-8,-9,16,18); ctx.strokeStyle="#c65f28";
    for(let yy=-6;yy<=6;yy+=4){ctx.beginPath();ctx.moveTo(-7,yy);ctx.lineTo(7,yy);ctx.stroke();}
  } else if (item.kind === "remote") {
    ctx.rotate(-.22); ctx.fillStyle="#e6d1a2"; ctx.fillRect(-7,-13,14,26); ctx.strokeRect(-7,-13,14,26); ctx.fillStyle="#6b3510";
    for(let yy=-8;yy<8;yy+=6){ctx.beginPath();ctx.arc(0,yy,1.5,0,Math.PI*2);ctx.fill();}
  } else {
    ctx.beginPath();ctx.moveTo(-11,-5);ctx.quadraticCurveTo(0,-14,11,-5);ctx.lineTo(6,8);ctx.quadraticCurveTo(0,3,-6,8);ctx.closePath();ctx.fill();ctx.stroke();
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
  if (!entity.active) return;
  const character = CHARACTERS[entity.id]; const frames = sprites.get(entity.id); const sprite = frames[getCharacterFrame(entity)] || frames[0];
  const x = lerp(entity.prevX, entity.x, interpolation); const y = lerp(entity.prevY, entity.y, interpolation);
  const moving = Math.abs(entity.vx) > 24;
  const stepWave = Math.sin(entity.animDistance * .23);
  const bob = entity.onGround && moving ? Math.abs(stepWave) * -2.2 : Math.sin(state.elapsed * 2.6 + entity.idlePhase) * .7;
  const breath = moving ? 0 : Math.sin(state.elapsed * 2.4 + entity.idlePhase) * .012;
  const speedStretch = clamp(Math.abs(entity.vy) / 1600, 0, .09); const land = entity.landSquash * .12;
  const scaleY = 1 + speedStretch - land + breath; const scaleX = 1 - speedStretch * .5 + land * .65 - breath * .5;
  const drawH = character.drawHeight; const drawW = drawH * (sprite.width / sprite.height);
  const centerX = x + entity.w / 2; const bottom = y + entity.h + bob;
  const concealment = entity.hidden ? .045 : entity.invisible > 0 ? .16 + Math.sin(state.elapsed * 18) * .045 : 1;
  ctx.save(); ctx.globalAlpha = alpha * concealment * (entity.stunned > 0 && Math.floor(state.elapsed * 14) % 2 ? .38 : 1);
  if (!entity.climbing && entity.ledgePull <= 0) {
    const shadowWidth = Math.max(12, Math.min(drawW * .34, entity.w * 1.05));
    ctx.fillStyle = entity.onGround ? "rgba(0,0,0,.43)" : "rgba(0,0,0,.19)";
    ctx.beginPath(); ctx.ellipse(centerX, bottom + 3, shadowWidth, entity.onGround ? 5 : 3, 0, 0, Math.PI * 2); ctx.fill();
  }
  const climbSway = entity.climbing ? Math.sin(entity.animDistance * .18) * .055 : 0;
  const airTilt = entity.onGround ? 0 : clamp(entity.vx / 1350, -.13, .13);
  ctx.translate(centerX, bottom); ctx.scale(entity.face * scaleX, scaleY);
  ctx.rotate(climbSway + airTilt + clamp(entity.vx / 2700, -.095, .095) * entity.face);
  ctx.filter = entity === state.player ? `drop-shadow(0 0 5px ${character.color})` : "drop-shadow(0 3px 3px rgba(0,0,0,.55))";
  ctx.drawImage(sprite, -drawW / 2, -drawH, drawW, drawH); ctx.restore();
}

function render(interpolation = 1) {
  if (!state.level) return; ctx.clearRect(0, 0, GAME.width, GAME.height); drawBackdrop(); drawVision(); drawRoomCues(); drawHazards();
  state.items.forEach(drawItem);
  if (state.selectedId !== "draco") drawExit();
  if (state.decoy) { const fake = { ...state.player, x: state.decoy.x, y: state.decoy.y, prevX: state.decoy.x, prevY: state.decoy.y, face: state.decoy.face }; drawCharacter(fake, interpolation, .38 + Math.sin(state.elapsed * 12) * .1); }
  state.enemies.forEach((enemy) => drawCharacter(enemy, interpolation));
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
  const playerAlpha = state.hidden ? .13 : state.invisibleTimer > 0 ? .24 + Math.sin(state.elapsed * 15) * .08 : state.damageCooldown > 0 && Math.floor(state.elapsed * 13) % 2 ? .35 : 1;
  drawCharacter(state.player, interpolation, playerAlpha);
  if (state.hidden && state.hiddenSpot) {
    ctx.fillStyle = "rgba(5,14,23,.86)"; ctx.fillRect(state.hiddenSpot.x + state.hiddenSpot.w / 2 - 52, state.hiddenSpot.y + 8, 104, 22);
    ctx.fillStyle = "#bfeeff"; ctx.font = "900 10px system-ui"; ctx.textAlign = "center"; ctx.fillText("Q  LEAVE", state.hiddenSpot.x + state.hiddenSpot.w / 2, state.hiddenSpot.y + 23);
  }
  if (state.player.pulse > 0) {
    state.player.pulse = Math.max(0, state.player.pulse - 1 / 60); const radius = (.62 - state.player.pulse) * 270;
    ctx.strokeStyle = `rgba(115,213,247,${state.player.pulse})`; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(state.player.x + state.player.w / 2, state.player.y + state.player.h / 2, radius, 0, Math.PI * 2); ctx.stroke();
  }
  state.particles.forEach((particle) => { ctx.globalAlpha = clamp(particle.life / particle.maxLife, 0, 1); ctx.fillStyle = particle.color; ctx.fillRect(particle.x, particle.y, particle.size, particle.size); }); ctx.globalAlpha = 1;
}

function finishLevel(success, reason = "") {
  if (!state.running) return; state.running = false; state.paused = false; setGameChrome(false);
  const level = state.level; const isGuard = state.selectedId === "draco"; const primary = $("#resultPrimaryBtn"); const secondary = $("#resultSecondaryBtn");
  $("#resultEyebrow").textContent = success ? "LEVEL COMPLETE" : "TRY AGAIN";
  $("#resultTitle").textContent = success ? isGuard ? "The room is safe!" : "The loot is yours!" : isGuard ? "The Crew got away!" : "Draco won this round";
  $("#resultText").textContent = success
    ? isGuard ? `Draco stopped the raid in the ${level.name}.` : `${CHARACTERS[state.selectedId].name} escaped the ${level.name} with all the loot.`
    : isGuard ? `${reason || "The Crew stole every sock."} Catch them before the stash is gone.` : `${reason || "The mission failed."} Try again and use the hiding places.`;
  const achieved = isGuard ? `${state.caught}/${level.catches}` : `${state.collected}/${state.items.length}`;
  const firstStat = isGuard ? `<small>SOCKS SAFE</small><strong>${guardSockTotal() - state.collected}/${guardSockTotal()}</strong>` : `<small>TIME LEFT</small><strong>${Math.ceil(state.remaining)} s</strong>`;
  $("#resultStats").innerHTML = `<span>${firstStat}</span><span><small>${isGuard ? "CAUGHT" : "FOUND"}</small><strong>${achieved}</strong></span><span><small>ABILITIES</small><strong>${state.abilityUses}</strong></span>`;
  if (success) saveProgress(Math.max(getProgress(), Math.min(LEVELS.length, state.levelIndex + 2)));
  if (success && state.levelIndex < LEVELS.length - 1) { primary.textContent = "Next level"; primary.onclick = () => prepareLevel(state.levelIndex + 1); }
  else { primary.textContent = success ? "Play this level again" : "Try again"; primary.onclick = initLevel; }
  secondary.textContent = success ? "Play again" : "Change level"; secondary.onclick = success ? initLevel : goToLevels; showScreen("result");
}

function goToLevels() { state.running = false; state.paused = false; setGameChrome(false); buildLevelCards(); showScreen("levels"); }
function pauseGame() { if (!state.running) return; state.paused = true; keys.clear(); touchKeys.clear(); screens.pause.classList.add("active"); syncAudioForContext(); }
function resumeGame() { if (!state.running) return; state.paused = false; screens.pause.classList.remove("active"); state.screen = "game"; lastFrame = performance.now(); syncAudioForContext(); }
function openRules() { state.pauseBeforeRules = state.paused; if (state.running) state.paused = true; dom.rules.classList.remove("hidden"); syncAudioForContext(); }
function closeRules() { dom.rules.classList.add("hidden"); if (state.running && !state.pauseBeforeRules) { state.paused = false; lastFrame = performance.now(); } syncAudioForContext(); }

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
  const delta = Math.min(.05, (now - lastFrame) / 1000); lastFrame = now;
  if (state.running && !state.paused) {
    accumulator += delta; let steps = 0;
    while (accumulator >= GAME.fixedStep && steps < 8) { update(GAME.fixedStep); accumulator -= GAME.fixedStep; steps += 1; }
  } else accumulator = 0;
  if (state.running || state.screen === "game" || state.screen === "pause" || state.screen === "result") render(accumulator / GAME.fixedStep);
  requestAnimationFrame(frame);
}

function bindEvents() {
  $("#startBtn").addEventListener("click", () => showScreen("select"));
  $("#rulesBtn").addEventListener("click", openRules); $("#rulesHudBtn").addEventListener("click", openRules); $("#briefingRulesBtn").addEventListener("click", openRules);
  $("#closeRulesBtn").addEventListener("click", closeRules); dom.rules.addEventListener("click", (event) => { if (event.target === dom.rules) closeRules(); });
  $("#playLevelBtn").addEventListener("click", initLevel); $("#pauseBtn").addEventListener("click", pauseGame); $("#introMusicBtn").addEventListener("click", toggleMusic);
  $("#resumeBtn").addEventListener("click", resumeGame); $("#restartBtn").addEventListener("click", initLevel); $("#quitBtn").addEventListener("click", goToLevels); $("#resultMenuBtn").addEventListener("click", goToLevels);
  $$('[data-back="start"]').forEach((button) => button.addEventListener("click", () => showScreen("start")));
  $$('[data-back="select"]').forEach((button) => button.addEventListener("click", () => showScreen("select")));
  window.addEventListener("keydown", (event) => {
    if (Object.values(CONTROLS).flat().includes(event.code) && state.running) event.preventDefault(); keys.add(event.code); if (event.repeat) return;
    if (CONTROLS.jump.includes(event.code)) queueJump(); if (CONTROLS.ability.includes(event.code)) useAbility(); if (CONTROLS.hide.includes(event.code)) toggleHide();
    if (CONTROLS.pause.includes(event.code)) { if (!dom.rules.classList.contains("hidden")) closeRules(); else if (state.paused) resumeGame(); else pauseGame(); }
    if (CONTROLS.music.includes(event.code)) toggleMusic();
  });
  window.addEventListener("keyup", (event) => keys.delete(event.code));
  window.addEventListener("blur", () => { if (state.running && !state.paused) pauseGame(); });
  $$('[data-control]').forEach((button) => {
    const action = button.dataset.control;
    const start = (event) => { event.preventDefault(); if (action === "jump") queueJump(); else if (action === "ability") useAbility(); else if (action === "hide") toggleHide(); else touchKeys.add(action); };
    const end = (event) => { event.preventDefault(); touchKeys.delete(action); };
    button.addEventListener("pointerdown", start); button.addEventListener("pointerup", end); button.addEventListener("pointercancel", end); button.addEventListener("pointerleave", end);
  });
}

bindEvents(); syncAudioForContext(); requestAnimationFrame(frame);
loadAssets().catch((error) => { console.error(error); $("#loadingScreen p").textContent = "Something went wrong while loading the images. Start the page with VS Code Live Server."; });
