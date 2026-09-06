const LINKS = {
  youtube: "https://www.youtube.com/@SiriusEntertainment-k7o",
  tiktok: "https://www.tiktok.com/@siriusentertainment777?_r=1&_t=ZN-99SZbrkqBhD",
  spotify: "https://open.spotify.com/artist/75t48ljrcloH7Mtr987cOW?si=VX_07Qt_T8WqZgjo4JZxZA&utm_source=copy-link",
  lyricsYoutube: "https://www.youtube.com/@SiriusLyrics89",
  lyricsTiktok: "https://www.tiktok.com/@sirius.lyrics4?_r=1&_t=ZN-99SZvnrd810",
  portfolio: "https://dianabunjaku.com/",
};

// Add future App Store, Google Play and PC store links here only when those releases are ready.

const ICONS = {
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  bag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8h12l1 13H5L6 8Z"/><path d="M9 9V6a3 3 0 0 1 6 0v3"/></svg>',
  book: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5a3 3 0 0 1 3-3h5v18H7a3 3 0 0 0-3 3V5Z"/><path d="M20 5a3 3 0 0 0-3-3h-5v18h5a3 3 0 0 1 3 3V5Z"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>',
  external: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4h5v5M20 4l-9 9"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/></svg>',
  feedback: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z"/><path d="m9 12 2 2 4-5"/></svg>',
  film: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M17 9h4M3 15h4M17 15h4"/></svg>',
  gamepad: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10a5 5 0 0 1 4.7 6.7l-1.1 3.2a2.5 2.5 0 0 1-4.1 1l-1.3-1.2H8.8l-1.3 1.2a2.5 2.5 0 0 1-4.1-1l-1.1-3.2A5 5 0 0 1 7 7Z"/><path d="M7 11v4M5 13h4M16.5 12h.01M18.5 14h.01"/></svg>',
  globe: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10M9 20v-6h6v6"/></svg>',
  info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></svg>',
  message: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z"/></svg>',
  music: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>',
  news: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v16H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4V8Z"/></svg>',
  route: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h3a3 3 0 0 0 3-3v-1a3 3 0 0 0-3-3H9a3 3 0 0 1-3-3V7a2 2 0 0 1 2-2h8"/></svg>',
  settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></svg>',
  shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 20 6v6c0 5-3.4 8-8 9-4.6-1-8-4-8-9V6l8-3Z"/><path d="m8.5 12 2.2 2.2 4.8-5"/></svg>',
  shirt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 4-5 3 2 5 3-1v10h8V11l3 1 2-5-5-3a4 4 0 0 1-8 0Z"/></svg>',
  sparkles: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.4 4.1L17.5 8l-4.1 1.4L12 13.5l-1.4-4.1L6.5 8l4.1-.9L12 3ZM19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14ZM5 14l.8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8L5 14Z"/></svg>',
  users: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a5 5 0 0 1 10 0v2M16 4a3 3 0 0 1 0 6M17 13a5 5 0 0 1 4 5v2"/></svg>',
  video: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/></svg>',
  youtube: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 8.2a3 3 0 0 0-2.1-2.1C17 5.6 12 5.6 12 5.6s-5 0-6.9.5A3 3 0 0 0 3 8.2 31 31 0 0 0 2.6 12a31 31 0 0 0 .5 3.8 3 3 0 0 0 2.1 2.1c1.8.5 6.8.5 6.8.5s5 0 6.9-.5a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .4-3.8 31 31 0 0 0-.4-3.8Z"/><path d="m10 9 5 3-5 3V9Z"/></svg>',
};

document.querySelectorAll("[data-icon]").forEach((element) => {
  const icon = ICONS[element.dataset.icon];
  if (icon) element.insertAdjacentHTML("afterbegin", icon);
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function createCutout(image) {
  const work = document.createElement("canvas");
  work.width = image.naturalWidth; work.height = image.naturalHeight;
  const context = work.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, work.width, work.height);
  const data = pixels.data; const width = work.width; const height = work.height;
  let red = 0; let green = 0; let blue = 0; let count = 0;
  for (let y = 2; y < height; y += 14) {
    for (const x of [2, width - 3]) { const offset = (y * width + x) * 4; red += data[offset]; green += data[offset + 1]; blue += data[offset + 2]; count += 1; }
  }
  for (let x = 2; x < width; x += 14) {
    for (const y of [2, height - 3]) { const offset = (y * width + x) * 4; red += data[offset]; green += data[offset + 1]; blue += data[offset + 2]; count += 1; }
  }
  red /= count; green /= count; blue /= count;
  const isBackground = (index) => {
    const offset = index * 4;
    if (data[offset + 3] < 18) return true;
    const r = data[offset]; const g = data[offset + 1]; const b = data[offset + 2];
    const saturation = Math.max(r, g, b) - Math.min(r, g, b);
    const light = (r + g + b) / 3;
    return Math.hypot(r - red, g - green, b - blue) < 72 && saturation < 38 && light > 70;
  };
  const visited = new Uint8Array(width * height); const queue = new Int32Array(width * height);
  let head = 0; let tail = 0;
  const enqueue = (index) => { if (!visited[index] && isBackground(index)) { visited[index] = 1; queue[tail++] = index; } };
  for (let x = 0; x < width; x += 1) { enqueue(x); enqueue((height - 1) * width + x); }
  for (let y = 0; y < height; y += 1) { enqueue(y * width); enqueue(y * width + width - 1); }
  while (head < tail) {
    const index = queue[head++]; const x = index % width; const y = Math.floor(index / width);
    if (x > 0) enqueue(index - 1); if (x < width - 1) enqueue(index + 1);
    if (y > 0) enqueue(index - width); if (y < height - 1) enqueue(index + width);
  }
  let minX = width; let minY = height; let maxX = 0; let maxY = 0;
  for (let index = 0; index < visited.length; index += 1) {
    const offset = index * 4;
    if (visited[index]) data[offset + 3] = 0;
    if (data[offset + 3] > 24) {
      const x = index % width; const y = Math.floor(index / width);
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
  }
  context.putImageData(pixels, 0, 0);
  minX = clamp(minX - 8, 0, width - 1); minY = clamp(minY - 8, 0, height - 1);
  maxX = clamp(maxX + 8, 1, width); maxY = clamp(maxY + 8, 1, height);
  const cutout = document.createElement("canvas");
  cutout.width = Math.max(1, maxX - minX); cutout.height = Math.max(1, maxY - minY);
  cutout.getContext("2d").drawImage(work, minX, minY, cutout.width, cutout.height, 0, 0, cutout.width, cutout.height);
  cutout.className = image.className;
  cutout.setAttribute("role", "img"); cutout.setAttribute("aria-label", image.alt || "Sirius Entertainment character");
  return cutout;
}

document.querySelectorAll("img[data-cutout]").forEach((image) => {
  const render = () => {
    if (!image.isConnected) return;
    try { image.replaceWith(createCutout(image)); }
    catch { image.removeAttribute("data-cutout"); }
  };
  if (image.complete) render(); else image.addEventListener("load", render, { once: true });
});

document.querySelectorAll("[data-link]").forEach((link) => {
  const url = LINKS[link.dataset.link];
  if (url) {
    link.href = url;
    if (link.dataset.external === "true") {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }
  } else {
    link.href = "#";
    link.setAttribute("aria-disabled", "true");
    link.title = "This link will activate when the release is ready";
    link.addEventListener("click", (event) => event.preventDefault());
  }
});

const menuButton = document.querySelector(".menu-button");
const navigation = document.querySelector(".main-nav");
menuButton?.addEventListener("click", () => {
  const open = navigation.classList.toggle("open");
  menuButton.setAttribute("aria-expanded", String(open));
  menuButton.setAttribute("aria-label", open ? "Close menu" : "Open menu");
});

navigation?.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => {
  navigation.classList.remove("open");
  menuButton?.setAttribute("aria-expanded", "false");
  menuButton?.setAttribute("aria-label", "Open menu");
}));

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

if (!reducedMotion.matches) {
  const shootingStarLayer = document.createElement("div");
  shootingStarLayer.className = "shooting-star-layer";
  shootingStarLayer.setAttribute("aria-hidden", "true");
  document.body.append(shootingStarLayer);

  const launchShootingStar = () => {
    if (!document.hidden) {
      const star = document.createElement("span");
      star.className = "shooting-star";
      star.style.setProperty("--star-x", `${randomBetween(-8, 72).toFixed(1)}vw`);
      star.style.setProperty("--star-y", `${randomBetween(5, 58).toFixed(1)}vh`);
      star.style.setProperty("--star-length", `${randomBetween(76, 148).toFixed(0)}px`);
      star.style.setProperty("--star-angle", `${randomBetween(18, 32).toFixed(1)}deg`);
      star.style.setProperty("--star-duration", `${randomBetween(.78, 1.28).toFixed(2)}s`);
      shootingStarLayer.append(star);
      star.addEventListener("animationend", () => star.remove(), { once: true });
    }
    window.setTimeout(launchShootingStar, randomBetween(4800, 15800));
  };
  window.setTimeout(launchShootingStar, randomBetween(1200, 4200));

  if (window.matchMedia("(pointer:fine)").matches) {
    const glow = document.createElement("div");
    glow.className = "cosmic-glow";
    glow.setAttribute("aria-hidden", "true");
    document.body.append(glow);
    let glowFrame = 0;
    window.addEventListener("pointermove", (event) => {
      if (glowFrame) return;
      glowFrame = requestAnimationFrame(() => {
        glow.style.setProperty("--glow-x", `${event.clientX}px`);
        glow.style.setProperty("--glow-y", `${event.clientY}px`);
        glowFrame = 0;
      });
    }, { passive: true });
  }
}

const observer = "IntersectionObserver" in window
  ? new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: .12 })
  : null;

document.querySelectorAll("[data-reveal]").forEach((element) => {
  if (observer) observer.observe(element);
  else element.classList.add("visible");
});

document.querySelectorAll("[data-year]").forEach((element) => {
  element.textContent = String(new Date().getFullYear());
});
