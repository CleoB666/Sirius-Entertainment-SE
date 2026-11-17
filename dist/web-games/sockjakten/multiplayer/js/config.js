export const GAME = {
  width: 1280,
  height: 720,
  gravity: 1500,
  maxFall: 760,
  saveKey: "sockjakten-progress-v4",
  fixedStep: 1 / 120,
  characterSelectMusic: "assets/AmbienceTTHCPickCharacter.mp3",
};

export const CHARACTERS = {
  draco: {
    id: "draco", name: "Draco", role: "Guardian", roleShort: "DRACO",
    asset: "assets/draco.png", portraitAsset: "assets/draco-portrait.png", motionAsset: "assets/draco-motion.webp", color: "#73d5f7", accent: "#e9fbff",
    description: "Roams the house and guards what the others want to steal.",
    ability: "Guardian Pulse",
    abilityText: "A short pulse stuns nearby thieves – you still have to catch them.",
    abilityHint: "Get close, press E, then catch the stunned thief.",
    cooldown: 10, speed: 245, acceleration: 1650, jump: 565,
    width: 36, height: 88, drawHeight: 124,
  },
  clawster: {
    id: "clawster", name: "Clawster", role: "Sock Thief · Tinkerer", roleShort: "SOCK THIEF",
    asset: "assets/clawster.png", portraitAsset: "assets/clawster-portrait.png", motionAsset: "assets/clawster-motion.webp", color: "#ff7838", accent: "#ffc083",
    description: "Four arms, four times the opportunity.",
    ability: "Magnet Claw", abilityText: "Pulls one visible nearby item toward you.",
    abilityHint: "Press E when an item is within range.",
    cooldown: 10, speed: 260, acceleration: 1900, jump: 540,
    width: 38, height: 52, drawHeight: 79,
  },
  lairy: {
    id: "lairy", name: "Lairy", role: "Sock Thief · Scout", roleShort: "SOCK THIEF",
    asset: "assets/lairy.png", portraitAsset: "assets/lairy-portrait.png", motionAsset: "assets/lairy-motion.webp", color: "#e9a13d", accent: "#9de6ff",
    description: "Those wings find paths where others fall.",
    ability: "Wing Burst", abilityText: "A short, controlled mid-air boost – not a full flight.",
    abilityHint: "Press E in the air for a short wing burst.",
    cooldown: 9, speed: 275, acceleration: 2000, jump: 525,
    width: 42, height: 47, drawHeight: 76,
  },
  gramp: {
    id: "gramp", name: "Gramp", role: "Sock Thief · Brains", roleShort: "SOCK THIEF",
    asset: "assets/gramp.png", portraitAsset: "assets/gramp-portrait.png", motionAsset: "assets/gramp-motion.webp", color: "#7fa8c5", accent: "#d7ecf9",
    description: "Not the fastest. Almost always the smartest.",
    ability: "Master Plan", abilityText: "Slows a nearby Draco for a brief moment.",
    abilityHint: "Press E when Draco is close – the effect is brief.",
    cooldown: 13, speed: 225, acceleration: 1500, jump: 490,
    width: 37, height: 54, drawHeight: 80,
  },
  strappy: {
    id: "strappy", name: "Strappy", role: "Sock Thief · Con Artist", roleShort: "SOCK THIEF",
    asset: "assets/strappy.png", portraitAsset: "assets/strappy-portrait.png", motionAsset: "assets/strappy-motion.webp", color: "#ffad3f", accent: "#ffe1a8",
    description: "Slips away before anyone can blink.",
    ability: "False Trail", abilityText: "Sends Draco the wrong way for a couple of seconds.",
    abilityHint: "Works best once Draco is already looking for you.",
    cooldown: 12, speed: 292, acceleration: 2200, jump: 530,
    width: 45, height: 52, drawHeight: 84,
  },
  trasselsudd: {
    id: "trasselsudd", name: "Trasselsudd", role: "Sock Thief · Sneak", roleShort: "SOCK THIEF",
    asset: "assets/trasselsudd.png", portraitAsset: "assets/trasselsudd-portrait.png", motionAsset: "assets/trasselsudd-motion.webp", color: "#bb67d8", accent: "#f0cfff",
    description: "Small enough to vanish in plain sight.",
    ability: "Tangle Veil", abilityText: "Becomes hard to spot for one very short escape window.",
    abilityHint: "Press E when you need to break Draco's line of sight.",
    cooldown: 13, speed: 280, acceleration: 2050, jump: 555,
    width: 27, height: 40, drawHeight: 60,
  },
};

export const CHARACTER_ORDER = ["draco", "clawster", "lairy", "gramp", "strappy", "trasselsudd"];
export const THIEF_IDS = CHARACTER_ORDER.filter((id) => id !== "draco");

export const CONTROLS = {
  left: ["ArrowLeft", "KeyA"], right: ["ArrowRight", "KeyD"],
  up: ["ArrowUp", "KeyW"], down: ["ArrowDown", "KeyS"],
  jump: ["Space"], ability: ["KeyE", "ShiftLeft", "ShiftRight"],
  hide: ["KeyQ", "KeyF"], pause: ["KeyP", "Escape"], music: ["KeyM"],
};

export const ITEM_LABELS = {
  sock: "sock", key: "key", button: "button", spoon: "spoon",
  spool: "spool", clip: "hair clip", remote: "remote",
};
