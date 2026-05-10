import "./styles.css";

const CELL_WIDTH = 192;
const CELL_HEIGHT = 208;
const COLUMNS = 8;
const ROWS = 9;
const PET_WINDOW_PADDING = 16;
const BUBBLE_WINDOW_WIDTH = 276;
const MIN_SCALE = 0.6;
const MAX_SCALE = 2;
const WHEEL_SCALE_STEP = 0.08;
const STARTUP_UPDATE_CHECK_KEY = "codex-pet-desk.check-updates-on-startup";
const PET_STORAGE_DIR_KEY = "codex-pet-desk.pet-storage-dir";
const UPDATE_PROXY_KEY = "codex-pet-desk.update-proxy";
const HOOK_PROMPT_KEY = "codex-pet-desk.hook-prompt-v1";
const UPDATE_CHECK_TIMEOUT = 20000;
const UPDATE_PROXY_CANDIDATES = [
  "http://127.0.0.1:7890",
  "http://127.0.0.1:7897",
  "http://127.0.0.1:10809"
];
const searchParams = new URLSearchParams(window.location.search);
const isSettingsWindow = searchParams.has("settings");
const initialSettingsPage = searchParams.get("page") === "pets" ? "pets" : "settings";

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
  id: "hachiroku",
  displayName: "Hachiroku",
  description: "A chibi pixel Hachiroku companion in a black railway conductor uniform."
};

const appEl = document.querySelector("#app");
const petEl = document.querySelector("#pet");
const panelEl = document.querySelector("#panel");
const fileInputEl = document.querySelector("#file-input");
const folderInputEl = document.querySelector("#folder-input");
const scaleEl = document.querySelector("#scale");
const petDescriptionEl = document.querySelector("#pet-description");
const appVersionEl = document.querySelector("#app-version");
const speechBubbleEl = document.querySelector("#speech-bubble");
const startupUpdateCheckEl = document.querySelector("#startup-update-check");
const checkUpdateEl = document.querySelector("#check-update");
const updateStatusEl = document.querySelector("#update-status");
const updateProxyEl = document.querySelector("#update-proxy");
const installHooksEl = document.querySelector("#install-hooks");
const testHookBubbleEl = document.querySelector("#test-hook-bubble");
const hookStatusEl = document.querySelector("#hook-status");
const petStoragePathEl = document.querySelector("#pet-storage-path");
const chooseStorageEl = document.querySelector("#choose-storage");
const resetStorageEl = document.querySelector("#reset-storage");
const localPetListEl = document.querySelector("#local-pet-list");
const petdexSearchEl = document.querySelector("#petdex-search");
const petdexStatusEl = document.querySelector("#petdex-status");
const petdexListEl = document.querySelector("#petdex-list");
const stateButtons = [...document.querySelectorAll(".state-button")];
const tabButtons = [...document.querySelectorAll("[data-page].tab-button")];
const pageEls = [...document.querySelectorAll(".settings-page")];
const petPageButtons = [...document.querySelectorAll("[data-pet-page].tab-button")];
const petPageEls = [...document.querySelectorAll(".pet-page")];

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
let PhysicalPosition = null;
let emitEvent = null;
let invokeCommand = null;
let openDialog = null;
let askDialog = null;
let isPetHovered = false;
let lastWindowX = null;
let movementSettleTimer = 0;
let appVersion = "0.1.0";
let defaultPetStorageDir = "";
let petStorageDir = localStorage.getItem(PET_STORAGE_DIR_KEY) || "";
let petdexPets = [];
let speechBubbleTimer = 0;
let hookPollTimer = 0;
let windowLayoutMoveTimer = 0;

appEl.classList.toggle("shell--settings", isSettingsWindow);
appEl.classList.toggle("shell--pet", !isSettingsWindow);
setSettingsPage(initialSettingsPage);
applyScale();
setState("idle");
requestAnimationFrame(tick);
initializeTauriRuntime();
initializeUpdateSettings();

fileInputEl.addEventListener("change", () => loadFromFiles([...fileInputEl.files]));
folderInputEl.addEventListener("change", () => loadFromFiles([...folderInputEl.files]));

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

updateProxyEl.addEventListener("change", () => {
  const proxy = normalizeProxyUrl(updateProxyEl.value);
  updateProxyEl.value = proxy;
  if (proxy) {
    localStorage.setItem(UPDATE_PROXY_KEY, proxy);
    setUpdateStatus(`Update proxy set to ${proxy}.`);
  } else {
    localStorage.removeItem(UPDATE_PROXY_KEY);
    setUpdateStatus("Update checks will connect directly first.");
  }
});

installHooksEl.addEventListener("click", () => installCodeHooksFromSettings());
testHookBubbleEl.addEventListener("click", () => testHookBubbleFromSettings());
chooseStorageEl.addEventListener("click", choosePetStorageDir);
resetStorageEl.addEventListener("click", async () => {
  localStorage.removeItem(PET_STORAGE_DIR_KEY);
  petStorageDir = defaultPetStorageDir;
  renderPetStorageDir();
  await loadInstalledPets(invokeCommand);
});

petdexSearchEl.addEventListener("input", () => {
  renderLocalPets();
  renderPetdexPets();
});

tabButtons.forEach((button) => {
  button.addEventListener("click", () => setSettingsPage(button.dataset.page));
});

petPageButtons.forEach((button) => {
  button.addEventListener("click", () => setPetManagementPage(button.dataset.petPage));
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
    setPetdexStatus("Petdex install is available in the desktop app.");
    panelEl.hidden = !isSettingsWindow;
    return;
  }

  currentWindow = tauri.currentWindow;
  LogicalSize = tauri.LogicalSize;
  PhysicalPosition = tauri.PhysicalPosition;
  emitEvent = tauri.emit;
  invokeCommand = tauri.invoke;
  openDialog = tauri.openDialog;
  askDialog = tauri.askDialog;
  appVersion = await tauri.getVersion();
  setAppVersion(`Version ${appVersion}`);
  defaultPetStorageDir = await tauri.invoke("default_pet_storage_dir");
  if (!petStorageDir) petStorageDir = defaultPetStorageDir;
  renderPetStorageDir();
  await loadBuiltinDefaultPet(tauri.invoke);
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

  await tauri.listen("code-task-complete", (event) => {
    if (!event.payload || isSettingsWindow) return;
    showCodeTaskBubble(event.payload);
  });

  if (!isSettingsWindow) {
    await currentWindow.onMoved(({ payload }) => {
      if (windowLayoutMoveTimer) {
        lastWindowX = payload.x;
        return;
      }
      handleWindowMoved(payload.x);
    });
    if (shouldCheckUpdatesOnStartup()) checkForUpdates();
    startHookPolling();
    await maybePromptForHooks();
  }

  await refreshHookStatus();
  await loadInstalledPets(tauri.invoke);
  if (isSettingsWindow && initialSettingsPage === "pets") loadPetdexPets();
  panelEl.hidden = !isSettingsWindow;
}

async function loadInstalledPets(invoke) {
  if (!invoke) return;

  try {
    installedPets = await invoke("list_codex_pets", { petsDir: petStorageDir || null });
  } catch (error) {
    showSettingsMessage(String(error));
    return;
  }

  renderLocalPets();
  renderPetdexPets();
  if (!installedPets.length) return;

  if (currentPet === SAMPLE_PET) {
    loadNativePet(installedPets[0]);
  }
}

async function loadBuiltinDefaultPet(invoke) {
  if (!invoke) return;

  try {
    const pet = await invoke("default_builtin_pet");
    loadNativePet(pet);
  } catch (error) {
    console.info("Builtin default pet unavailable:", error);
  }
}

function loadNativePet(pet) {
  if (loadedObjectUrl) URL.revokeObjectURL(loadedObjectUrl);
  loadedObjectUrl = "";
  currentPet = normalizeManifest(pet);
  currentPet.spriteDataUrl = pet.spriteDataUrl;

  applyPet(currentPet);
  emitEvent?.("active-pet-changed", pet);
  setState("idle");
  renderLocalPets();
}

async function getTauriApi() {
  if (!("__TAURI_INTERNALS__" in window)) return null;
  try {
    const [{ invoke }, { listen, emit }, { getCurrentWindow, LogicalSize: TauriLogicalSize, PhysicalPosition: TauriPhysicalPosition }, { getVersion }, { open: openDialog, ask }] = await Promise.all([
      import("@tauri-apps/api/core"),
      import("@tauri-apps/api/event"),
      import("@tauri-apps/api/window"),
      import("@tauri-apps/api/app"),
      import("@tauri-apps/plugin-dialog")
    ]);
    return {
      invoke,
      listen,
      emit,
      getVersion,
      openDialog,
      askDialog: ask,
      currentWindow: getCurrentWindow(),
      LogicalSize: TauriLogicalSize,
      PhysicalPosition: TauriPhysicalPosition
    };
  } catch {
    return null;
  }
}

function setSettingsPage(page) {
  tabButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.page === page));
  pageEls.forEach((pageEl) => pageEl.classList.toggle("is-active", pageEl.dataset.page === page));
  if (page === "pets") loadPetdexPets();
}

function setPetManagementPage(page) {
  petPageButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.petPage === page));
  petPageEls.forEach((pageEl) => pageEl.classList.toggle("is-active", pageEl.dataset.petPage === page));
  if (page === "petdex") loadPetdexPets();
}

function renderPetStorageDir() {
  petStoragePathEl.value = petStorageDir || defaultPetStorageDir || "";
}

async function choosePetStorageDir() {
  if (!openDialog) return;
  const selected = await openDialog({ directory: true, multiple: false, defaultPath: petStorageDir || defaultPetStorageDir });
  if (!selected) return;
  petStorageDir = String(selected);
  localStorage.setItem(PET_STORAGE_DIR_KEY, petStorageDir);
  renderPetStorageDir();
  await loadInstalledPets(invokeCommand);
}

async function loadPetdexPets({ force = false } = {}) {
  if (!invokeCommand) return;
  if (petdexPets.length && !force) return;

  setPetdexStatus("Loading Petdex...");
  try {
    petdexPets = await invokeCommand("fetch_petdex_pets");
    setPetdexStatus(`${petdexPets.length} pets found.`);
    renderPetdexPets();
  } catch (error) {
    setPetdexStatus(`Petdex load failed: ${error}`);
  }
}

function renderPetdexPets() {
  const query = getPetSearchQuery();
  const shown = petdexPets
    .filter((pet) => {
      return matchesPetSearch(query, [pet.displayName, pet.slug, pet.kind, pet.submittedBy]);
    })
    .slice(0, 60);

  petdexListEl.innerHTML = shown.length
    ? shown.map(renderPetdexPetCard).join("")
    : '<div class="empty-state">No matching Petdex pets.</div>';

  petdexListEl.querySelectorAll("[data-install-pet]").forEach((button) => {
    button.addEventListener("click", () => installPetdexPet(button.dataset.installPet));
  });
}

function renderLocalPets() {
  if (!localPetListEl) return;
  const query = getPetSearchQuery();
  const shown = installedPets.filter((pet) => {
    return matchesPetSearch(query, [pet.displayName, pet.description, pet.id, pet.sourceDir]);
  });

  localPetListEl.innerHTML = shown.length
    ? shown.map(renderLocalPetCard).join("")
    : `<div class="empty-state">${query ? "No matching local pets." : "No local pets found in the selected folder."}</div>`;

  localPetListEl.querySelectorAll("[data-use-pet]").forEach((button) => {
    button.addEventListener("click", () => {
      const pet = installedPets.find((candidate) => candidate.id === button.dataset.usePet);
      if (pet) loadNativePet(pet);
    });
  });
}

function getPetSearchQuery() {
  return petdexSearchEl.value.trim().toLowerCase();
}

function matchesPetSearch(query, values) {
  if (!query) return true;
  return values
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function renderLocalPetCard(pet) {
  const isActive = pet.id === currentPet.id;
  return `
    <article class="pet-card ${isActive ? "is-active" : ""}">
      <div class="pet-card-thumb" style="--sprite-url: url('${escapeAttribute(pet.spriteDataUrl || "")}')"></div>
      <div class="pet-card-body">
        <strong>${escapeText(pet.displayName)}</strong>
        <span>${escapeText(pet.description || pet.sourceDir || pet.id)}</span>
      </div>
      <button class="pet-card-action" data-use-pet="${escapeAttribute(pet.id)}" type="button">${isActive ? "Active" : "Use"}</button>
    </article>
  `;
}

function renderPetdexPetCard(pet) {
  const isInstalled = isPetdexPetInstalled(pet);
  return `
    <article class="pet-card ${isInstalled ? "is-installed" : ""}">
      <div class="pet-card-thumb" style="--sprite-url: url('${escapeAttribute(pet.spritesheetUrl || "")}')"></div>
      <div class="pet-card-body">
        <strong>${escapeText(pet.displayName || pet.slug)}</strong>
        <span>${escapeText([pet.kind, pet.submittedBy && `by ${pet.submittedBy}`].filter(Boolean).join(" - ") || pet.slug)}</span>
      </div>
      <button class="pet-card-action" data-install-pet="${escapeAttribute(pet.slug)}" type="button" ${isInstalled ? "disabled" : ""}>
        ${isInstalled ? "Installed" : "Install"}
      </button>
    </article>
  `;
}

function isPetdexPetInstalled(pet) {
  const slug = normalizePetKey(pet.slug);
  if (!slug) return false;
  return installedPets.some((installed) => {
    const sourceDirName = normalizePetKey(pathBaseName(installed.sourceDir || ""));
    return normalizePetKey(installed.id) === slug || sourceDirName === slug;
  });
}

function pathBaseName(path) {
  return String(path).split(/[\\/]/).filter(Boolean).pop() || "";
}

function normalizePetKey(value) {
  return String(value || "").trim().toLowerCase();
}

async function installPetdexPet(slug) {
  const pet = petdexPets.find((candidate) => candidate.slug === slug);
  if (!pet || !invokeCommand) return;

  const button = petdexListEl.querySelector(`[data-install-pet="${CSS.escape(slug)}"]`);
  if (button) {
    button.disabled = true;
    button.textContent = "Installing";
  }

  try {
    const installed = await invokeCommand("install_petdex_pet", {
      request: { ...pet, installDir: petStorageDir || null }
    });
    setPetdexStatus(`${installed.displayName} installed.`);
    await loadInstalledPets(invokeCommand);
    loadNativePet(installed);
    setSettingsPage("pets");
    setPetManagementPage("local");
  } catch (error) {
    setPetdexStatus(`Install failed: ${error}`);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Install";
    }
  }
}

function setPetdexStatus(message) {
  petdexStatusEl.textContent = message;
  petdexStatusEl.title = message;
}

function initializeUpdateSettings() {
  startupUpdateCheckEl.checked = shouldCheckUpdatesOnStartup();
  updateProxyEl.value = getConfiguredUpdateProxy();
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

async function maybePromptForHooks() {
  if (!invokeCommand || !askDialog || localStorage.getItem(HOOK_PROMPT_KEY)) return;
  localStorage.setItem(HOOK_PROMPT_KEY, "asked");
  const shouldInstall = await askDialog(
    "是否安装 Code hooks？安装后 Codex CLI 和 Claude Code 当前任务结束时，桌宠会弹出气泡提醒你任务已完成。",
    { title: "Codex Pet Desk", kind: "info" }
  );
  if (!shouldInstall) return;

  try {
    await invokeCommand("install_code_hooks");
    await refreshHookStatus();
    showSpeechBubble({ title: "Code Hooks", message: "已安装，任务完成时我会提醒你。", state: "waving" });
  } catch (error) {
    console.info("Hook install skipped:", error);
  }
}

async function installCodeHooksFromSettings() {
  if (!invokeCommand) return;
  installHooksEl.disabled = true;
  setHookStatus("Installing hooks...");
  try {
    const status = await invokeCommand("install_code_hooks");
    renderHookStatus(status);
    showSettingsMessage("Code hooks installed. Restart or start a new Code session for hooks to take effect.");
    if (!isSettingsWindow) showSpeechBubble({ title: "Code Hooks", message: "已安装。", state: "waving" });
  } catch (error) {
    setHookStatus(`Hook install failed: ${error}`);
  } finally {
    installHooksEl.disabled = false;
  }
}

async function testHookBubbleFromSettings() {
  if (!invokeCommand) return;
  testHookBubbleEl.disabled = true;
  try {
    await invokeCommand("test_hook_bubble");
    setHookStatus("Test sent. Check the pet window for the bubble.");
  } catch (error) {
    setHookStatus(`Bubble test failed: ${error}`);
  } finally {
    testHookBubbleEl.disabled = false;
  }
}

async function refreshHookStatus() {
  if (!invokeCommand) return;
  try {
    renderHookStatus(await invokeCommand("hook_status"));
  } catch (error) {
    setHookStatus(`Hook status unavailable: ${error}`);
  }
}

function renderHookStatus(status) {
  const installedTargets = (status.targets || [])
    .filter((target) => target.installed)
    .map((target) => target.name);
  setHookStatus(installedTargets.length
    ? `Installed for ${installedTargets.join(", ")}. Restart open Code sessions to reload hooks.`
    : "Hooks are not installed yet.");
}

function setHookStatus(message) {
  hookStatusEl.textContent = message;
  hookStatusEl.title = message;
}

function startHookPolling() {
  if (!invokeCommand || hookPollTimer) return;
  pollHookEvents();
  hookPollTimer = window.setInterval(pollHookEvents, 2500);
}

async function pollHookEvents() {
  if (!invokeCommand || isSettingsWindow) return;
  try {
    const events = await invokeCommand("take_hook_events");
    const latestEvent = [...events].reverse().find((event) => {
      const type = event.type || event.eventType;
      return ["running", "approval", "complete"].includes(type);
    });
    if (latestEvent) {
      showCodeTaskBubble(latestEvent);
    }
  } catch (error) {
    console.info("Hook polling skipped:", error);
  }
}

function showCodeTaskBubble(event) {
  const type = event.type || event.eventType;
  const agent = formatHookAgent(event.agent);
  if (type === "approval") {
    showSpeechBubble({
      title: event.title || "需要审批",
      message: event.message || "有一个操作需要你审批。",
      state: "waiting",
      timeout: 120000
    });
    return;
  }
  if (type === "running") {
    showSpeechBubble({
      title: event.title || `${agent} 任务进行中`,
      message: event.message || "任务正在进行中。",
      state: "running",
      timeout: 120000
    });
    return;
  }

  showSpeechBubble({
    title: event.title || agent,
    message: event.message || "任务已经完成。",
    state: "waving",
    timeout: 8500
  });
}

function formatHookAgent(agent) {
  const normalized = String(agent || "").toLowerCase();
  if (normalized === "codex") return "Codex";
  if (normalized === "claude-code") return "Claude Code";
  return "Code";
}

function showSpeechBubble({ title = "", message = "", state = "waving", timeout = 8500 } = {}) {
  if (isSettingsWindow || !speechBubbleEl) return;
  const petViewportCenter = capturePetViewportCenter();
  speechBubbleEl.innerHTML = `
    <strong>${escapeText(title)}</strong>
    <span>${escapeText(message)}</span>
  `;
  appEl.classList.add("has-bubble");
  setState(state);
  window.clearTimeout(speechBubbleTimer);
  speechBubbleTimer = window.setTimeout(hideSpeechBubble, timeout);
  resizePetWindow({ petViewportCenter });
}

function hideSpeechBubble() {
  const petViewportCenter = capturePetViewportCenter();
  appEl.classList.remove("has-bubble");
  if (speechBubbleEl) speechBubbleEl.textContent = "";
  if (!isPetHovered) setState("idle");
  resizePetWindow({ petViewportCenter });
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
  const configuredProxy = getConfiguredUpdateProxy();
  const proxies = [
    configuredProxy,
    ...UPDATE_PROXY_CANDIDATES
  ].filter(Boolean);
  const uniqueProxies = [...new Set(proxies)];

  return [
    { options: { timeout: UPDATE_CHECK_TIMEOUT } },
    ...uniqueProxies.map((proxy) => ({
      proxy,
      options: { timeout: UPDATE_CHECK_TIMEOUT, proxy }
    }))
  ];
}

function getConfiguredUpdateProxy() {
  return normalizeProxyUrl(localStorage.getItem(UPDATE_PROXY_KEY) || "");
}

function normalizeProxyUrl(value) {
  const proxy = String(value || "").trim();
  if (!proxy) return "";
  if (/^(https?|socks5?):\/\/.+/i.test(proxy)) return proxy;
  if (/^(127\.0\.0\.1|localhost):\d+$/i.test(proxy)) return `http://${proxy}`;
  return proxy;
}

function isRequestError(error) {
  return /request|connect|connection|dns|resolve|timeout|timed out|network|url/i.test(String(error?.message || error || ""));
}

function updateErrorMessage(error) {
  const detail = String(error?.message || error || "").trim();
  if (!detail) return "Update check failed.";
  if (isRequestError(detail)) return `Update check failed. Set the proxy field to your active proxy, then retry. Detail: ${detail}`;
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

function resizePetWindow(options = {}) {
  void resizePetWindowToLayout(options);
}

async function resizePetWindowToLayout({ petViewportCenter = null } = {}) {
  if (isSettingsWindow || !currentWindow || !LogicalSize) return;

  const nextLayout = getPetWindowLayout(appEl.classList.contains("has-bubble"));

  try {
    await currentWindow.setSize(new LogicalSize(nextLayout.width, nextLayout.height));
    if (!petViewportCenter || !PhysicalPosition) return;

    await nextAnimationFrame();
    const nextPetCenter = capturePetViewportCenter();
    if (!nextPetCenter) return;

    const [position, scaleFactor] = await Promise.all([
      currentWindow.outerPosition(),
      currentWindow.scaleFactor?.() ?? Promise.resolve(1)
    ]);
    const factor = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
    const nextX = Math.round(position.x + (petViewportCenter.x - nextPetCenter.x) * factor);
    const nextY = Math.round(position.y + (petViewportCenter.y - nextPetCenter.y) * factor);

    ignoreLayoutMoveEvents();
    await currentWindow.setPosition(new PhysicalPosition(nextX, nextY));
  } catch (error) {
    console.info("Pet window resize skipped:", error);
    await currentWindow.setSize(new LogicalSize(nextLayout.width, nextLayout.height));
  }
}

function getPetWindowLayout(hasBubble) {
  const petWidth = CELL_WIDTH * scale;
  const petHeight = CELL_HEIGHT * scale;
  const baseWidth = petWidth + PET_WINDOW_PADDING;
  const width = Math.ceil(hasBubble ? Math.max(baseWidth, BUBBLE_WINDOW_WIDTH) : baseWidth);
  const height = Math.ceil(petHeight + PET_WINDOW_PADDING + (hasBubble ? 82 : 0));

  return { width, height };
}

function capturePetViewportCenter() {
  if (!petEl) return null;
  const rect = petEl.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2
  };
}

function nextAnimationFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function ignoreLayoutMoveEvents() {
  window.clearTimeout(windowLayoutMoveTimer);
  windowLayoutMoveTimer = window.setTimeout(() => {
    windowLayoutMoveTimer = 0;
  }, 160);
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
  window.clearInterval(hookPollTimer);
  window.clearTimeout(speechBubbleTimer);
  if (loadedObjectUrl) URL.revokeObjectURL(loadedObjectUrl);
});
