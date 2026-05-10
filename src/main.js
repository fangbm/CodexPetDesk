import "./styles.css";

const CELL_WIDTH = 192;
const CELL_HEIGHT = 208;
const COLUMNS = 8;
const ROWS = 9;
const PET_WINDOW_PADDING = 16;
const MIN_SCALE = 0.6;
const MAX_SCALE = 2;
const WHEEL_SCALE_STEP = 0.08;
const STARTUP_UPDATE_CHECK_KEY = "codex-pet-desk.check-updates-on-startup";
const UPDATE_CHECK_TIMEOUT = 20000;
const UPDATE_PROXY_CANDIDATES = [
  "http://127.0.0.1:7890",
  "http://127.0.0.1:7897",
  "http://127.0.0.1:10809"
];
const isSettingsWindow = new URLSearchParams(window.location.search).has("settings");

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

const SAMPLE_PET = {
  id: "sample",
  displayName: "Codex Pet",
  description: "Load a Codex-compatible pet package to begin."
};

const appEl = document.querySelector("#app");
const petEl = document.querySelector("#pet");
const panelEl = document.querySelector("#panel");
const fileInputEl = document.querySelector("#file-input");
const folderInputEl = document.querySelector("#folder-input");
const scaleEl = document.querySelector("#scale");
const nativePetsEl = document.querySelector("#native-pets");
const nativePetSelectEl = document.querySelector("#native-pet-select");
const petDescriptionEl = document.querySelector("#pet-description");
const appVersionEl = document.querySelector("#app-version");
const startupUpdateCheckEl = document.querySelector("#startup-update-check");
const checkUpdateEl = document.querySelector("#check-update");
const updateStatusEl = document.querySelector("#update-status");
const stateButtons = [...document.querySelectorAll(".state-button")];

let currentPet = SAMPLE_PET;
let installedPets = [];
let currentState = "idle";
let frameIndex = 0;
let frameTimer = 0;
let scale = Number(scaleEl.value);
let rafId = 0;
let lastTimestamp = 0;
let loadedObjectUrl = "";
let currentWindow = null;
let LogicalSize = null;
let emitEvent = null;
let isPetHovered = false;
let lastWindowX = null;
let movementSettleTimer = 0;
let appVersion = "0.1.0";

appEl.classList.toggle("shell--settings", isSettingsWindow);
appEl.classList.toggle("shell--pet", !isSettingsWindow);
applyScale();
setState("idle");
requestAnimationFrame(tick);
initializeTauriRuntime();
initializeUpdateSettings();

fileInputEl.addEventListener("change", () => loadFromFiles([...fileInputEl.files]));
folderInputEl.addEventListener("change", () => loadFromFiles([...folderInputEl.files]));
nativePetSelectEl.addEventListener("change", () => {
  const pet = installedPets.find((candidate) => candidate.id === nativePetSelectEl.value);
  if (pet) loadNativePet(pet);
});

scaleEl.addEventListener("input", () => {
  updateScale(Number(scaleEl.value));
});

stateButtons.forEach((button) => {
  button.addEventListener("click", () => setState(button.dataset.state));
});

startupUpdateCheckEl.addEventListener("change", () => {
  localStorage.setItem(STARTUP_UPDATE_CHECK_KEY, startupUpdateCheckEl.checked ? "1" : "0");
  setUpdateStatus(startupUpdateCheckEl.checked
    ? "Updates are checked automatically."
    : "Startup checks are disabled.");
});

checkUpdateEl.addEventListener("click", () => {
  checkForUpdates({ manual: true });
});

petEl.addEventListener("click", () => {
  if (!petEl.classList.contains("is-loaded")) return;
  if (currentState === "idle") setState("waving");
});

petEl.addEventListener("dblclick", () => {
  if (isSettingsWindow) return;
  setState("waving");
});

petEl.addEventListener("mouseenter", () => {
  if (isSettingsWindow) return;
  isPetHovered = true;
  if (!movementSettleTimer) setState("jumping");
});

petEl.addEventListener("mouseleave", () => {
  if (isSettingsWindow) return;
  isPetHovered = false;
  if (!movementSettleTimer) setState("idle");
});

document.addEventListener("mousedown", async (event) => {
  if (isSettingsWindow || event.button !== 0) return;
  event.preventDefault();
  await currentWindow?.startDragging();
});

document.addEventListener("wheel", (event) => {
  if (!event.ctrlKey || isSettingsWindow) return;
  event.preventDefault();
  const direction = event.deltaY < 0 ? 1 : -1;
  updateScale(scale + direction * WHEEL_SCALE_STEP);
}, { passive: false });

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") panelEl.classList.toggle("is-hidden");
  if (event.key === "ArrowRight") setState("running-right");
  if (event.key === "ArrowLeft") setState("running-left");
});

document.addEventListener("dragover", (event) => {
  event.preventDefault();
  document.body.classList.add("is-dragging");
});

document.addEventListener("dragleave", (event) => {
  if (event.relatedTarget === null) document.body.classList.remove("is-dragging");
});

document.addEventListener("drop", async (event) => {
  event.preventDefault();
  document.body.classList.remove("is-dragging");
  await loadFromFiles([...event.dataTransfer.files]);
});

async function loadFromFiles(files) {
  const manifestFile = findManifest(files);
  if (!manifestFile) {
    showSettingsMessage("pet.json was not found");
    return;
  }

  let manifest;
  try {
    manifest = JSON.parse(await manifestFile.text());
  } catch {
    showSettingsMessage("pet.json is invalid");
    return;
  }

  const spriteFile = findSpritesheet(files, manifest);
  if (!spriteFile) {
    showSettingsMessage(`Expected ${manifest.spritesheetPath || "spritesheet.webp"}.`);
    return;
  }

  const spriteUrl = await readFileAsDataUrl(spriteFile);
  if (loadedObjectUrl) URL.revokeObjectURL(loadedObjectUrl);
  loadedObjectUrl = "";
  currentPet = normalizeManifest(manifest);
  currentPet.spriteDataUrl = spriteUrl;

  applyPet(currentPet);
  emitEvent?.("active-pet-changed", currentPet);
  setState("idle");
}

async function initializeTauriRuntime() {
  const tauri = await getTauriApi();
  if (!tauri) {
    setAppVersion("Browser preview");
    panelEl.hidden = !isSettingsWindow;
    return;
  }

  currentWindow = tauri.currentWindow;
  LogicalSize = tauri.LogicalSize;
  emitEvent = tauri.emit;
  appVersion = await tauri.getVersion();
  setAppVersion(`Version ${appVersion}`);
  resizePetWindow();

  await tauri.listen("active-pet-changed", (event) => {
    if (!event.payload) return;
    currentPet = normalizeManifest(event.payload);
    currentPet.spriteDataUrl = event.payload.spriteDataUrl;
    applyPet(currentPet);
  });

  await tauri.listen("pet-scale-changed", (event) => {
    const nextScale = Number(event.payload);
    if (!Number.isFinite(nextScale)) return;
    updateScale(nextScale, false);
  });

  await tauri.listen("pet-state-changed", (event) => {
    setState(String(event.payload), false);
  });

  if (!isSettingsWindow) {
    await currentWindow.onMoved(({ payload }) => {
      handleWindowMoved(payload.x);
    });
    if (shouldCheckUpdatesOnStartup()) checkForUpdates();
  }

  await loadInstalledPets(tauri.invoke);
  panelEl.hidden = !isSettingsWindow;
}

async function loadInstalledPets(invoke) {
  if (!invoke) return;

  try {
    installedPets = await invoke("list_codex_pets");
  } catch (error) {
    showSettingsMessage(String(error));
    return;
  }

  if (!installedPets.length) return;
  nativePetsEl.classList.remove("is-hidden");
  nativePetSelectEl.innerHTML = installedPets
    .map((pet) => `<option value="${escapeAttribute(pet.id)}">${escapeText(pet.displayName)}</option>`)
    .join("");
  loadNativePet(installedPets[0]);
}

function loadNativePet(pet) {
  if (loadedObjectUrl) URL.revokeObjectURL(loadedObjectUrl);
  loadedObjectUrl = "";
  currentPet = normalizeManifest(pet);
  currentPet.spriteDataUrl = pet.spriteDataUrl;

  applyPet(currentPet);
  nativePetSelectEl.value = pet.id;
  emitEvent?.("active-pet-changed", pet);
  setState("idle");
}

async function getTauriApi() {
  if (!("__TAURI_INTERNALS__" in window)) return null;
  try {
    const [{ invoke }, { listen, emit }, { getCurrentWindow, LogicalSize: TauriLogicalSize }, { getVersion }] = await Promise.all([
      import("@tauri-apps/api/core"),
      import("@tauri-apps/api/event"),
      import("@tauri-apps/api/window"),
      import("@tauri-apps/api/app")
    ]);
    return { invoke, listen, emit, getVersion, currentWindow: getCurrentWindow(), LogicalSize: TauriLogicalSize };
  } catch {
    return null;
  }
}

function initializeUpdateSettings() {
  startupUpdateCheckEl.checked = shouldCheckUpdatesOnStartup();
  setUpdateStatus(startupUpdateCheckEl.checked
    ? "Updates are checked automatically."
    : "Startup checks are disabled.");
}

function shouldCheckUpdatesOnStartup() {
  return localStorage.getItem(STARTUP_UPDATE_CHECK_KEY) !== "0";
}

function setAppVersion(text) {
  appVersionEl.textContent = text;
}

function setUpdateStatus(message) {
  updateStatusEl.textContent = message;
  updateStatusEl.title = message;
}

async function checkForUpdates({ manual = false } = {}) {
  let lastError = null;

  try {
    if (manual) {
      checkUpdateEl.disabled = true;
      setUpdateStatus("Checking for updates...");
    }

    const [{ check }, { relaunch }] = await Promise.all([
      import("@tauri-apps/plugin-updater"),
      import("@tauri-apps/plugin-process")
    ]);

    let update = null;
    for (const attempt of getUpdateCheckAttempts()) {
      try {
        if (manual && attempt.proxy) setUpdateStatus(`Checking through ${attempt.proxy}...`);
        update = await check(attempt.options);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (!isRequestError(error)) throw error;
      }
    }

    if (lastError) throw lastError;
    if (!update) {
      if (manual) setUpdateStatus(`Version ${appVersion} is up to date.`);
      return;
    }

    if (manual) setUpdateStatus(`Downloading version ${update.version}...`);
    await update.downloadAndInstall();
    if (manual) setUpdateStatus("Update installed. Restarting...");
    await relaunch();
  } catch (error) {
    const message = updateErrorMessage(error);
    if (manual) setUpdateStatus(message);
    console.info("Update check skipped:", error);
  } finally {
    if (manual) checkUpdateEl.disabled = false;
  }
}

function getUpdateCheckAttempts() {
  return [
    { options: { timeout: UPDATE_CHECK_TIMEOUT } },
    ...UPDATE_PROXY_CANDIDATES.map((proxy) => ({
      proxy,
      options: { timeout: UPDATE_CHECK_TIMEOUT, proxy }
    }))
  ];
}

function isRequestError(error) {
  return /request|connect|connection|dns|resolve|timeout|timed out|network|url/i.test(String(error?.message || error || ""));
}

function updateErrorMessage(error) {
  const detail = String(error?.message || error || "").trim();
  if (!detail) return "Update check failed.";
  if (isRequestError(detail)) return "Update check failed. GitHub may be unreachable. Check your network or start a local proxy on 127.0.0.1:7890.";
  if (/platform/i.test(detail)) return "No update package for this platform yet.";
  if (/signature|pubkey|public key/i.test(detail)) return "Update signature verification failed.";
  if (/404|not found/i.test(detail)) return "Update manifest was not found.";
  return `Update check failed: ${detail}`;
}

function applyPet(pet) {
  if (!pet.spriteDataUrl) return;
  petEl.style.backgroundImage = `url("${pet.spriteDataUrl}")`;
  petEl.classList.add("is-loaded");
  petDescriptionEl.textContent = pet.description;
}

function normalizeManifest(manifest) {
  return {
    id: String(manifest.id || "codex-pet"),
    displayName: String(manifest.displayName || manifest.id || "Codex Pet"),
    description: String(manifest.description || "Codex-compatible desktop companion."),
    spritesheetPath: String(manifest.spritesheetPath || "spritesheet.webp")
  };
}

function findManifest(files) {
  return files.find((file) => file.name.toLowerCase() === "pet.json");
}

function findSpritesheet(files, manifest) {
  const wanted = basename(manifest.spritesheetPath || "spritesheet.webp").toLowerCase();
  return files.find((file) => basename(file.name).toLowerCase() === wanted)
    || files.find((file) => /\.(webp|png)$/i.test(file.name));
}

function basename(path) {
  return path.split(/[\\/]/).pop();
}

function escapeText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttribute(value) {
  return escapeText(value).replaceAll('"', "&quot;");
}

function showSettingsMessage(message) {
  petDescriptionEl.textContent = message;
}

function handleWindowMoved(nextX) {
  if (!Number.isFinite(nextX)) return;

  if (Number.isFinite(lastWindowX)) {
    const deltaX = nextX - lastWindowX;
    if (Math.abs(deltaX) >= 1) {
      setState(deltaX > 0 ? "running-right" : "running-left");
    }
  }

  lastWindowX = nextX;
  window.clearTimeout(movementSettleTimer);
  movementSettleTimer = window.setTimeout(() => {
    movementSettleTimer = 0;
    lastWindowX = null;
    setState(isPetHovered ? "jumping" : "idle");
  }, 180);
}

function setState(state, broadcast = true) {
  if (!STATES[state]) return;
  if (currentState === state) return;
  currentState = state;
  frameIndex = 0;
  frameTimer = 0;
  stateButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.state === state);
  });
  if (broadcast) emitEvent?.("pet-state-changed", state);
  renderFrame();
}

function tick(timestamp) {
  const elapsed = lastTimestamp ? timestamp - lastTimestamp : 0;
  lastTimestamp = timestamp;

  const state = STATES[currentState];
  frameTimer += elapsed;
  const duration = state.durations[frameIndex] || state.durations[0];

  if (frameTimer >= duration) {
    frameTimer = 0;
    frameIndex = (frameIndex + 1) % state.durations.length;
    renderFrame();
  }

  rafId = requestAnimationFrame(tick);
}

function renderFrame() {
  const state = STATES[currentState];
  const x = frameIndex * CELL_WIDTH * scale;
  const y = state.row * CELL_HEIGHT * scale;
  petEl.style.backgroundPosition = `-${x}px -${y}px`;
}

function applyScale() {
  petEl.style.width = `${CELL_WIDTH * scale}px`;
  petEl.style.height = `${CELL_HEIGHT * scale}px`;
  petEl.style.backgroundSize = `${CELL_WIDTH * COLUMNS * scale}px ${CELL_HEIGHT * ROWS * scale}px`;
  resizePetWindow();
}

function updateScale(nextScale, broadcast = true) {
  const clampedScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
  scale = Math.round(clampedScale * 100) / 100;
  scaleEl.value = String(scale);
  applyScale();
  renderFrame();
  if (broadcast) emitEvent?.("pet-scale-changed", scale);
}

function resizePetWindow() {
  if (isSettingsWindow || !currentWindow || !LogicalSize) return;
  const width = Math.ceil(CELL_WIDTH * scale + PET_WINDOW_PADDING);
  const height = Math.ceil(CELL_HEIGHT * scale + PET_WINDOW_PADDING);
  currentWindow.setSize(new LogicalSize(width, height));
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

window.addEventListener("beforeunload", () => {
  cancelAnimationFrame(rafId);
  if (loadedObjectUrl) URL.revokeObjectURL(loadedObjectUrl);
});
