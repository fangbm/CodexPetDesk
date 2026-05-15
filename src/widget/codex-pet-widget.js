const CELL_WIDTH = 192;
const CELL_HEIGHT = 208;
const COLUMNS = 8;
const ROWS = 9;
const MIN_SCALE = 0.45;
const MAX_SCALE = 2.5;
const MIN_RENDER_SCALE = 0.36;
const WHEEL_SCALE_STEP = 0.08;
const MOBILE_VIEWPORT = 360;
const DESKTOP_VIEWPORT = 768;
const MIN_AUTO_SCALE_FACTOR = 0.64;
const BUBBLE_MAX_WIDTH = 252;
const BUBBLE_MIN_WIDTH = 176;
const BUBBLE_HEIGHT = 84;
const DESKTOP_EDGE_OFFSET = 24;
const MOBILE_EDGE_OFFSET = 12;

const STATES = {
  idle: { row: 0, durations: [280, 110, 110, 140, 140, 320] },
  "running-right": { row: 1, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  "running-left": { row: 2, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  waving: { row: 3, durations: [140, 140, 140, 280] },
  jumping: { row: 4, durations: [140, 140, 140, 140, 280] },
  failed: { row: 5, durations: [140, 140, 140, 140, 140, 140, 140, 240] },
  waiting: { row: 6, durations: [150, 150, 150, 150, 150, 260] },
  running: { row: 7, durations: [120, 120, 120, 120, 120, 220] },
  review: { row: 8, durations: [150, 150, 150, 150, 150, 280] }
};

const CSS = `
  :host {
    --codex-pet-z-index: 2147483000;
    --codex-pet-inline: 24px;
    --codex-pet-block: 24px;
    --codex-pet-stage-width: 252px;
    --codex-pet-bubble-width: 252px;
    position: fixed;
    z-index: var(--codex-pet-z-index);
    display: block;
    width: 252px;
    height: 290px;
    color: #111827;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    user-select: none;
    touch-action: none;
    overscroll-behavior: contain;
  }

  :host([position="bottom-right"]) {
    right: var(--codex-pet-inline);
    bottom: var(--codex-pet-block);
  }

  :host([position="bottom-left"]) {
    left: var(--codex-pet-inline);
    bottom: var(--codex-pet-block);
  }

  :host([position="top-right"]) {
    right: var(--codex-pet-inline);
    top: var(--codex-pet-block);
  }

  :host([position="top-left"]) {
    left: var(--codex-pet-inline);
    top: var(--codex-pet-block);
  }

  .stage {
    position: relative;
    display: grid;
    justify-items: center;
    gap: 8px;
    min-width: var(--codex-pet-stage-width);
    pointer-events: none;
  }

  .bubble {
    display: grid;
    gap: 2px;
    width: var(--codex-pet-bubble-width);
    max-height: 72px;
    padding: 8px 10px;
    border: 1px solid rgb(15 23 42 / 0.08);
    border-radius: 14px;
    background: rgb(255 255 255 / 0.94);
    box-shadow: 0 10px 28px rgb(15 23 42 / 0.18);
    font-size: 12px;
    line-height: 1.28;
    opacity: 0;
    overflow: hidden;
    transform: translateY(8px);
    transition: opacity 160ms ease, transform 160ms ease;
  }

  .bubble.is-visible {
    opacity: 1;
    transform: translateY(0);
  }

  .bubble strong,
  .bubble span {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    overflow-wrap: anywhere;
  }

  .bubble strong {
    font-size: 13px;
    font-weight: 800;
    -webkit-line-clamp: 1;
  }

  .bubble span {
    color: rgb(17 24 39 / 0.78);
    -webkit-line-clamp: 2;
  }

  .pet {
    image-rendering: pixelated;
    background-repeat: no-repeat;
    filter: drop-shadow(0 12px 12px rgb(0 0 0 / 0.26));
    cursor: grab;
    pointer-events: auto;
    -webkit-user-drag: none;
  }

  .pet:active {
    cursor: grabbing;
  }
`;

class CodexPetElement extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>${CSS}</style>
      <div class="stage">
        <div class="bubble" part="bubble" aria-live="polite"></div>
        <div class="pet" part="pet" aria-label="Codex pet"></div>
      </div>
    `;

    this.petEl = this.shadowRoot.querySelector(".pet");
    this.bubbleEl = this.shadowRoot.querySelector(".bubble");
    this.scale = readNumber(this.getAttribute("scale"), 1);
    this.renderScale = this.scale;
    this.state = "idle";
    this.frameIndex = 1;
    this.frameTimer = 0;
    this.lastTimestamp = 0;
    this.rafId = 0;
    this.drag = null;
    this.activePointers = new Map();
    this.pinch = null;
    this.hovered = false;
    this.settleTimer = 0;
    this.bubbleTimer = 0;
    this.manifestUrl = "";

    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onPointerCancel = this.onPointerCancel.bind(this);
    this.onWheel = this.onWheel.bind(this);
    this.onViewportResize = this.onViewportResize.bind(this);
    this.tick = this.tick.bind(this);
  }

  static get observedAttributes() {
    return ["src", "scale", "position", "auto-scale"];
  }

  connectedCallback() {
    if (!this.hasAttribute("position")) this.setAttribute("position", "bottom-right");
    this.petEl.addEventListener("pointerdown", this.onPointerDown);
    this.petEl.addEventListener("mouseenter", () => {
      this.hovered = true;
      if (!this.settleTimer) this.setState("jumping");
    });
    this.petEl.addEventListener("mouseleave", () => {
      this.hovered = false;
      if (!this.settleTimer) this.setState("idle");
    });
    this.addEventListener("wheel", this.onWheel, { passive: false });
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerCancel);
    window.addEventListener("resize", this.onViewportResize);
    window.visualViewport?.addEventListener("resize", this.onViewportResize);
    this.applyScale();
    this.setState("idle");
    this.rafId = requestAnimationFrame(this.tick);
    if (this.getAttribute("src")) this.load(this.getAttribute("src"));
  }

  disconnectedCallback() {
    cancelAnimationFrame(this.rafId);
    clearTimeout(this.settleTimer);
    clearTimeout(this.bubbleTimer);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerCancel);
    window.removeEventListener("resize", this.onViewportResize);
    window.visualViewport?.removeEventListener("resize", this.onViewportResize);
  }

  attributeChangedCallback(name, _oldValue, value) {
    if (name === "src" && value && this.isConnected) this.load(value);
    if (name === "scale") this.setScale(readNumber(value, this.scale));
    if (name === "auto-scale") {
      this.applyScale();
      this.renderFrame();
      this.constrainToViewport();
    }
  }

  async load(src) {
    this.manifestUrl = src;
    const response = await fetch(src);
    if (!response.ok) throw new Error(`Failed to load pet manifest: ${response.status}`);
    const manifest = await response.json();
    const spriteUrl = new URL(manifest.spritesheetPath || "spritesheet.webp", new URL(src, document.baseURI));
    this.petEl.style.backgroundImage = `url("${spriteUrl.href}")`;
    this.petEl.title = manifest.displayName || manifest.id || "Codex Pet";
    this.applyScale();
    this.renderFrame();
    return manifest;
  }

  say(message, options = {}) {
    const title = options.title || "";
    this.bubbleEl.innerHTML = `
      ${title ? `<strong>${escapeHtml(title)}</strong>` : ""}
      <span>${escapeHtml(message)}</span>
    `;
    this.bubbleEl.classList.add("is-visible");
    if (options.state) this.setState(options.state);
    clearTimeout(this.bubbleTimer);
    this.bubbleTimer = setTimeout(() => {
      this.bubbleEl.classList.remove("is-visible");
      if (!this.hovered) this.setState("idle");
    }, readNumber(options.timeout, 8500));
  }

  setState(state) {
    if (!STATES[state] || this.state === state) return;
    this.state = state;
    this.frameIndex = firstVisibleFrame(state);
    this.frameTimer = 0;
    this.renderFrame();
  }

  setScale(scale) {
    this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, readNumber(scale, this.scale)));
    const rounded = String(Math.round(this.scale * 100) / 100);
    if (this.getAttribute("scale") !== rounded) this.setAttribute("scale", rounded);
    this.applyScale();
    this.renderFrame();
  }

  onPointerDown(event) {
    event.preventDefault();
    this.activePointers.set(event.pointerId, pointerPoint(event));
    this.petEl.setPointerCapture?.(event.pointerId);
    if (this.activePointers.size >= 2) {
      this.beginPinch();
      return;
    }
    if (this.getAttribute("draggable") === "false") return;
    const rect = this.getBoundingClientRect();
    this.drag = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      lastX: event.clientX
    };
    this.style.right = "auto";
    this.style.bottom = "auto";
    this.style.left = `${rect.left}px`;
    this.style.top = `${rect.top}px`;
  }

  onPointerMove(event) {
    if (this.activePointers.has(event.pointerId)) this.activePointers.set(event.pointerId, pointerPoint(event));
    if (this.pinch && this.activePointers.size >= 2) {
      event.preventDefault();
      const [first, second] = firstTwoPointers(this.activePointers);
      const distance = pointDistance(first, second);
      if (distance > 0) {
        const center = pointCenter(first, second);
        this.setScaleAtPoint(this.pinch.scale * (distance / this.pinch.distance), center);
      }
      return;
    }
    if (!this.drag || this.drag.pointerId !== event.pointerId) return;
    const left = clamp(event.clientX - this.drag.offsetX, 0, window.innerWidth - this.offsetWidth);
    const top = clamp(event.clientY - this.drag.offsetY, 0, window.innerHeight - this.offsetHeight);
    this.style.left = `${left}px`;
    this.style.top = `${top}px`;
    const deltaX = event.clientX - this.drag.lastX;
    if (Math.abs(deltaX) >= 1) this.setState(deltaX > 0 ? "running-right" : "running-left");
    this.drag.lastX = event.clientX;
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.settleTimer = 0;
      this.setState(this.hovered ? "jumping" : "idle");
    }, 180);
  }

  onPointerUp(event) {
    this.activePointers.delete(event.pointerId);
    if (this.pinch) {
      if (this.activePointers.size < 2) this.pinch = null;
      this.petEl.releasePointerCapture?.(event.pointerId);
      return;
    }
    if (!this.drag || this.drag.pointerId !== event.pointerId) return;
    this.drag = null;
    this.petEl.releasePointerCapture?.(event.pointerId);
  }

  onPointerCancel(event) {
    this.activePointers.delete(event.pointerId);
    if (this.activePointers.size < 2) this.pinch = null;
    if (this.drag?.pointerId === event.pointerId) this.drag = null;
    this.petEl.releasePointerCapture?.(event.pointerId);
  }

  onWheel(event) {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const direction = event.deltaY < 0 ? 1 : -1;
    this.setScaleAtPoint(this.scale + direction * WHEEL_SCALE_STEP, pointerPoint(event));
  }

  beginPinch() {
    const [first, second] = firstTwoPointers(this.activePointers);
    const distance = pointDistance(first, second);
    if (distance <= 0) return;
    this.drag = null;
    this.pinch = { distance, scale: this.scale };
    this.anchorToCurrentRect();
  }

  setScaleAtPoint(scale, point) {
    const rect = this.getBoundingClientRect();
    const ratioX = rect.width ? clamp((point.x - rect.left) / rect.width, 0, 1) : 0.5;
    const ratioY = rect.height ? clamp((point.y - rect.top) / rect.height, 0, 1) : 0.5;
    this.anchorToCurrentRect(rect);
    this.setScale(scale);
    const width = this.offsetWidth;
    const height = this.offsetHeight;
    const left = clamp(point.x - width * ratioX, 0, Math.max(0, window.innerWidth - width));
    const top = clamp(point.y - height * ratioY, 0, Math.max(0, window.innerHeight - height));
    this.style.left = `${left}px`;
    this.style.top = `${top}px`;
  }

  anchorToCurrentRect(rect = this.getBoundingClientRect()) {
    this.style.right = "auto";
    this.style.bottom = "auto";
    this.style.left = `${rect.left}px`;
    this.style.top = `${rect.top}px`;
  }

  tick(timestamp) {
    const elapsed = this.lastTimestamp ? timestamp - this.lastTimestamp : 0;
    this.lastTimestamp = timestamp;
    const state = STATES[this.state];
    this.frameTimer += elapsed;
    const duration = state.durations[this.frameIndex] || state.durations[0];
    if (this.frameTimer >= duration) {
      this.frameTimer = 0;
      this.frameIndex = (this.frameIndex + 1) % state.durations.length;
      this.renderFrame();
    }
    this.rafId = requestAnimationFrame(this.tick);
  }

  applyScale() {
    this.renderScale = Math.min(MAX_SCALE, Math.max(MIN_RENDER_SCALE, this.scale * this.autoScaleFactor()));
    const petWidth = CELL_WIDTH * this.renderScale;
    const petHeight = CELL_HEIGHT * this.renderScale;
    const availableWidth = Math.max(128, window.innerWidth - 24);
    const bubbleWidth = Math.min(BUBBLE_MAX_WIDTH, Math.max(Math.min(BUBBLE_MIN_WIDTH, availableWidth), availableWidth));
    const edgeOffset = window.innerWidth < DESKTOP_VIEWPORT ? MOBILE_EDGE_OFFSET : DESKTOP_EDGE_OFFSET;
    this.style.setProperty("--codex-pet-inline", `${edgeOffset}px`);
    this.style.setProperty("--codex-pet-block", `${edgeOffset}px`);
    this.style.setProperty("--codex-pet-stage-width", `${Math.max(bubbleWidth, petWidth)}px`);
    this.style.setProperty("--codex-pet-bubble-width", `${bubbleWidth}px`);
    this.style.width = `${Math.ceil(Math.max(bubbleWidth, petWidth))}px`;
    this.style.height = `${Math.ceil(petHeight + BUBBLE_HEIGHT)}px`;
    this.petEl.style.width = `${CELL_WIDTH * this.renderScale}px`;
    this.petEl.style.height = `${CELL_HEIGHT * this.renderScale}px`;
    this.petEl.style.backgroundSize = `${CELL_WIDTH * COLUMNS * this.renderScale}px ${CELL_HEIGHT * ROWS * this.renderScale}px`;
  }

  renderFrame() {
    const state = STATES[this.state] || STATES.idle;
    const x = this.frameIndex * CELL_WIDTH * this.renderScale;
    const y = state.row * CELL_HEIGHT * this.renderScale;
    this.petEl.style.backgroundPosition = `-${x}px -${y}px`;
  }

  autoScaleFactor() {
    if (this.getAttribute("auto-scale") === "false") return 1;
    const shortestSide = Math.min(window.innerWidth || DESKTOP_VIEWPORT, window.innerHeight || DESKTOP_VIEWPORT);
    if (shortestSide >= DESKTOP_VIEWPORT) return 1;
    if (shortestSide <= MOBILE_VIEWPORT) return MIN_AUTO_SCALE_FACTOR;
    const progress = (shortestSide - MOBILE_VIEWPORT) / (DESKTOP_VIEWPORT - MOBILE_VIEWPORT);
    return MIN_AUTO_SCALE_FACTOR + progress * (1 - MIN_AUTO_SCALE_FACTOR);
  }

  onViewportResize() {
    this.applyScale();
    this.renderFrame();
    this.constrainToViewport();
  }

  constrainToViewport() {
    if (!this.style.left && !this.style.top) return;
    const left = clamp(this.offsetLeft, 0, Math.max(0, window.innerWidth - this.offsetWidth));
    const top = clamp(this.offsetTop, 0, Math.max(0, window.innerHeight - this.offsetHeight));
    this.style.left = `${left}px`;
    this.style.top = `${top}px`;
  }
}

function mount(options = {}) {
  const pet = document.createElement("codex-pet");
  pet.setAttribute("src", options.pet || options.src || "/pets/hachiroku/pet.json");
  pet.setAttribute("position", options.position || "bottom-right");
  pet.setAttribute("scale", String(options.scale ?? 1));
  if (options.autoScale === false) pet.setAttribute("auto-scale", "false");
  if (options.draggable === false) pet.setAttribute("draggable", "false");
  if (options.zIndex) pet.style.setProperty("--codex-pet-z-index", String(options.zIndex));
  document.body.appendChild(pet);
  return pet;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function readNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function pointerPoint(event) {
  return { x: event.clientX, y: event.clientY };
}

function firstTwoPointers(pointerMap) {
  return [...pointerMap.values()].slice(0, 2);
}

function pointDistance(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function pointCenter(first, second) {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2
  };
}

function firstVisibleFrame(state) {
  return state === "idle" ? 1 : 0;
}

if (!customElements.get("codex-pet")) {
  customElements.define("codex-pet", CodexPetElement);
}

const api = { mount, CodexPetElement };
window.CodexPet = Object.assign(window.CodexPet || {}, api);

export { CodexPetElement, mount };
