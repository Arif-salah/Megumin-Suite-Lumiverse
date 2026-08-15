import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faAddressCard,
  faAddressBook,
  faAlignLeft,
  faArrowLeft,
  faArrowDown,
  faArrowUp,
  faCompress,
  faListOl,
  faClapperboard,
  faInfinity,
  faFire,
  faMoon,
  faWind,
  faForwardFast,
  faLockOpen,
  faPenFancy,
  faBoxOpen,
  faChevronDown,
  faRulerHorizontal,
  faCoins,
  faArrowsRotate,
  faBan,
  faBolt,
  faBook,
  faBookOpen,
  faBoxArchive,
  faBrain,
  faBriefcase,
  faBullseye,
  faChartGantt,
  faCheck,
  faChevronRight,
  faClock,
  faCircle,
  faCircleCheck,
  faCircleHalfStroke,
  faCircleInfo,
  faCircleNotch,
  faCircleXmark,
  faCode,
  faCodeBranch,
  faCopy,
  faCube,
  faCubes,
  faDatabase,
  faDiagramProject,
  faDownload,
  faEarthAmericas,
  faEye,
  faEyeSlash,
  faFileExport,
  faFileImport,
  faFireBurner,
  faFlask,
  faFloppyDisk,
  faGaugeHigh,
  faGears,
  faHammer,
  faImage,
  faLanguage,
  faLayerGroup,
  faLightbulb,
  faLink,
  faList,
  faLock,
  faMagnifyingGlass,
  faMap,
  faMapLocationDot,
  faMasksTheater,
  faMemory,
  faMicrochip,
  faPen,
  faPenNib,
  faPenToSquare,
  faPeopleGroup,
  faPlug,
  faPlus,
  faPlusCircle,
  faPowerOff,
  faPuzzlePiece,
  faRightFromBracket,
  faRotateLeft,
  faRotateRight,
  faSatelliteDish,
  faScaleBalanced,
  faScroll,
  faServer,
  faShieldHalved,
  faSliders,
  faSpinner,
  faStar,
  faToggleOn,
  faTrash,
  faTrashCan,
  faTriangleExclamation,
  faUnlock,
  faUpRightAndDownLeftFromCenter,
  faUpload,
  faUser,
  faUserAstronaut,
  faUserLock,
  faUserSecret,
  faUsers,
  faWandMagicSparkles,
  faWifi,
  faXmark
} from "@fortawesome/free-solid-svg-icons";
import type { CustomBlock, EngineMode, MeguminProfile, RpcResponse } from "./types";
import { DEFAULT_PROFILE, clone, mergeProfile } from "./defaults";
import { KAZUMA_PLACEHOLDERS, RESOLUTIONS } from "./image-data";
import type { StoryConfigField } from "./story-config";
import {
  allConfigPresets,
  configOptionLabel,
  configOptionValue,
  countActiveConfigFields,
  storyConfigFields
} from "./story-config";
import type { BlockDef } from "./blocks";
import { BLOCK_REGISTRY, BLOCK_VISIBILITY_CHOICES, STAT_FIELD_PACKS, STAT_FIELD_TYPES, activeBlocks, blockById, syncLegacyBlockIds } from "./blocks";
import { SD_CONTENT_RATINGS, SD_FLAVORS, SD_GENRES, SD_PACING } from "./story-director";

type Ctx = SpindleFrontendContext & Record<string, any>;

type AppState = {
  ready: boolean;
  visible: boolean;
  saving: boolean;
  activeTab: number;
  devMode: boolean;
  devEditorId: string | null;
  styleEditorId: string | null;
  engineFilter: string;
  openConfigRow: string | null;
  styleFilter: string;
  context: any;
  profile: MeguminProfile;
  logic: any;
  engines: EngineMode[];
  customEngines: EngineMode[];
  imageConnections: any[];
  uiAssets: { heroImages: string[]; groupImage?: string; mascotImage?: string };
  presetBridge: { available: boolean; enginePresetId?: string; imagePresetId?: string; suiteDs4PresetId?: string; suiteGeminiPresetId?: string; missing?: string[] };
  presetAudit: {
    available?: boolean;
    statusMessage?: string;
    features?: Array<{ id: string; label: string; placeholders: string[]; present: string[]; missing: string[]; connected: boolean }>;
    missingFeatures?: string[];
    missingPlaceholders?: string[];
    presentPlaceholders?: string[];
    payloadEstimateTokens?: number;
    payloadEstimateSource?: "preset-audit" | "fallback";
    scannedPresetIds?: string[];
    scannedPresetNames?: string[];
  };
  status: string;
};

let ctxRef: Ctx | null = null;
let appMount: any = null;
let floatWidget: any = null;
let removeStyle: (() => void) | null = null;
let cleanupTagInterceptor: (() => void) | null = null;
let eventUnsubscribers: Array<() => void> = [];
let pending = new Map<string, { resolve: (value: any) => void; reject: (err: Error) => void }>();
let seq = 0;
let contextRefreshPromise: Promise<void> | null = null;

const state: AppState = {
  ready: false,
  visible: false,
  saving: false,
  activeTab: 0,
  devMode: false,
  devEditorId: null,
  styleEditorId: null,
  engineFilter: "all",
  openConfigRow: null,
  styleFilter: "direct",
  context: null,
  profile: clone(DEFAULT_PROFILE),
  logic: null,
  engines: [],
  customEngines: [],
  imageConnections: [],
  uiAssets: { heroImages: [] },
  presetBridge: { available: false },
  presetAudit: {},
  status: "Loading..."
};

export const MEGUMIN_PARITY_LABELS = {
  tabs: [
    ["Core Engine", "Choose the core ruleset that drives all NPC behavior and world logic."],
    ["Persona & Toggles", "Define the personality and extra toggles."],
    ["Writing Style", "Apply a prebuilt style, generate one with AI, or build your own."],
    ["Global Settings", "Set response length, output language, and how the AI addresses you."],
    ["Add-ons & Blocks", "Attach extra modules that appear at the end of every response."],
    ["Chain of Thought", "Control the AI's internal reasoning process before it writes."],
    ["Story Planner", "Generate and track future plot developments."],
    ["Dynamic Ban List", "Scan and ban repetitive AI phrases."],
    ["Image Generation", "Wire up ComfyUI to auto-generate scene images during roleplay."],
    ["NPCs Bank", "Automatically extract and track significant NPCs in the story."],
    ["Memory Core", "Advanced 3-Tier Context & History Management."]
  ]
};

const tabs = [
  { title: "Core Engine", sub: "Choose the core ruleset that drives all NPC behavior and world logic.", short: "Engine", icon: "fa-server", color: "#f59e0b", render: renderEngines },
  { title: "Persona & Toggles", sub: "Define the personality and extra toggles.", short: "Persona", icon: "fa-user-astronaut", color: "#ec4899", render: renderPersona },
  { title: "Story Config", sub: "Set the standing rules of the story, then pick the prose style that carries them.", short: "Config", icon: "fa-sliders", color: "#eab308", render: renderStoryConfig },
  { title: "Global Toggles & Blocks", sub: "Configure global parameters, add-ons, and UI tracker blocks.", short: "Global", icon: "fa-earth-americas", color: "#3b82f6", render: renderGlobalSettings },
  { title: "Add-ons & Blocks", sub: "Attach extra modules that appear at the end of every response.", short: "Blocks", icon: "fa-puzzle-piece", color: "#10b981", render: renderBlocks },
  { title: "Chain of Thought", sub: "Control the AI's internal reasoning process before it writes.", short: "Thinking", icon: "fa-brain", color: "#8b5cf6", render: renderThinking },
  { title: "Story Planner", sub: "Generate and track future plot developments.", short: "Story", icon: "fa-map", color: "#f59e0b", render: renderStory },
  { title: "Dynamic Ban List", sub: "Scan and ban repetitive AI phrases.", short: "Ban", icon: "fa-ban", color: "#ef4444", render: renderBanList },
  { title: "Image Generation", sub: "Wire up ComfyUI to auto-generate scene images during roleplay.", short: "Image", icon: "fa-image", color: "#06b6d4", render: renderImage },
  { title: "NPCs Bank", sub: "Automatically extract and track significant NPCs in the story.", short: "NPCs", icon: "fa-address-book", color: "#f43f5e", render: renderNpc },
  { title: "Global Settings", sub: "Extension preferences and about info.", short: "Settings", icon: "fa-gear", color: "#64748b", render: renderSettings }
];

const devTab = { title: "Dev Engine Builder", sub: "Clone, edit, and save custom Megumin engine blocks.", short: "Dev", icon: "fa-code", color: "#a855f7", render: renderDev };

export function setup(ctx: SpindleFrontendContext) {
  ctxRef = ctx as Ctx;
  removeStyle = ctxRef.dom.addStyle(styles());
  appMount = ctxRef.ui.mountApp({ className: "megumin-suite-app", position: "app-overlay" });
  appMount.setVisible(false);
  floatWidget = ctxRef.ui.createFloatWidget({
    width: 52,
    height: 52,
    initialPosition: { x: 24, y: 160 },
    snapToEdge: true,
    tooltip: "Megumin Suite",
    chromeless: true
  });
  floatWidget.root.className = "meg-float";
  floatWidget.root.innerHTML = `<button class="meg-float-btn" title="Megumin Suite" type="button" aria-label="Megumin Suite">${icon("fa-wand-magic-sparkles")}</button>`;
  bindFloatWidgetButton(floatWidget.root.querySelector("button"));

  const unsubscribeBackend = ctxRef.onBackendMessage((payload: unknown) => {
    const response = payload as RpcResponse;
    if ((payload as any)?.type === "prompt:preview") {
      showPromptPreview((payload as any).payload);
      return;
    }
    if (!response?.requestId) return;
    const waiter = pending.get(response.requestId);
    if (!waiter) return;
    pending.delete(response.requestId);
    if (response.type === "rpc:error") waiter.reject(new Error(response.error || "Megumin request failed"));
    else waiter.resolve(response.payload);
  });

  cleanupTagInterceptor = ctxRef.messages?.registerTagInterceptor?.(
    { tagName: "megumin-image", removeFromMessage: true },
    (payload: any) => renderMeguminImageTag(payload)
  );
  eventUnsubscribers = subscribeContextEvents();

  bootstrap().catch((err) => {
    state.status = err.message;
    render();
  });

  return () => {
    unsubscribeBackend?.();
    for (const unsubscribe of eventUnsubscribers) unsubscribe?.();
    eventUnsubscribers = [];
    cleanupTagInterceptor?.();
    if (statusClearTimer) window.clearTimeout(statusClearTimer);
    floatWidget?.destroy?.();
    appMount?.destroy?.();
    removeStyle?.();
    ctxRef?.dom.cleanup?.();
  };
}

function bindFloatWidgetButton(button: HTMLButtonElement | null | undefined) {
  if (!button) return;
  const threshold = 6;
  let start: { x: number; y: number } | null = null;
  let suppressClick = false;

  button.addEventListener("pointerdown", (event) => {
    start = { x: event.clientX, y: event.clientY };
    suppressClick = false;
  });
  button.addEventListener("pointermove", (event) => {
    if (!start) return;
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (moved > threshold) suppressClick = true;
  });
  button.addEventListener("pointerup", (event) => {
    if (!start) return;
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (moved > threshold) suppressClick = true;
    start = null;
  });
  button.addEventListener("pointercancel", () => {
    start = null;
    suppressClick = true;
  });
  button.addEventListener("click", (event) => {
    if (suppressClick) {
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    openApp();
  }, true);
}

function subscribeContextEvents(): Array<() => void> {
  const on = ctxRef?.events?.on?.bind(ctxRef.events);
  if (!on) return [];
  const events = ["CHAT_SWITCHED", "CHAT_CHANGED", "CHARACTER_AVATAR_CHANGED"];
  return events
    .map((eventName) => on(eventName, () => { void refreshActiveContext(); }))
    .filter((unsubscribe): unsubscribe is () => void => typeof unsubscribe === "function");
}

async function request<T = any>(type: string, payload?: unknown): Promise<T> {
  if (!ctxRef) throw new Error("Megumin frontend is not ready");
  const requestId = `meg-${Date.now()}-${++seq}`;
  const promise = new Promise<T>((resolve, reject) => pending.set(requestId, { resolve, reject }));
  ctxRef.sendToBackend({ type, requestId, payload });
  return promise;
}

async function pickOneFile(accept: string[], maxSizeBytes: number): Promise<any | null> {
  const files = await ctxRef?.uploads?.pickFile?.({ accept, multiple: false, maxSizeBytes });
  return Array.isArray(files) ? files[0] || null : null;
}

function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.slice(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return `data:${mimeType || "application/octet-stream"};base64,${btoa(binary)}`;
}

function showPromptPreview(payload: any) {
  if (!state.profile.toggles.promptPreview) return;
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  const body = messages
    .map((message: any, index: number) => `#${index + 1} ${String(message.role || "system").toUpperCase()}\n${String(message.content || "")}`)
    .join("\n\n---\n\n");
  const text = `Megumin Prompt Preview\nEstimated Megumin payload: ~${Number(payload?.estimatedInjectionTokens || 0)} tokens\n\n${body}`;
  window.alert(text.length > 14000 ? `${text.slice(0, 14000)}\n\n[Preview truncated]` : text);
}

async function bootstrap() {
  const data = await request<any>("bootstrap");
  state.context = data.context;
  state.profile = mergeProfile(data.profile);
  state.logic = data.logic;
  state.engines = data.engines || [];
  state.customEngines = data.customEngines || [];
  state.imageConnections = data.imageConnections || [];
  state.uiAssets = data.uiAssets || { heroImages: [] };
  state.presetBridge = data.presetBridge || { available: false };
  state.presetAudit = data.presetAudit || {};
  state.ready = true;
  state.status = "";
  render();
}

async function refreshActiveContext() {
  if (contextRefreshPromise) return contextRefreshPromise;
  contextRefreshPromise = (async () => {
    await flushProfileSave();
    await bootstrap();
  })().catch((err) => {
    state.status = err instanceof Error ? err.message : "Refresh failed";
    render();
  }).finally(() => {
    contextRefreshPromise = null;
  });
  return contextRefreshPromise;
}

async function refreshPresetAudit() {
  try {
    const data = await request<any>("preset:audit");
    state.presetAudit = data.presetAudit || state.presetAudit;
    state.presetBridge = data.presetBridge || state.presetBridge;
  } catch {
    // Preset audit is diagnostic only; the extension still saves and runs without it.
  }
}

function openApp() {
  state.visible = true;
  appMount?.setVisible(true);
  render();
}

let closingApp = false;
async function closeApp(options: { save?: boolean } = {}) {
  if (closingApp) return;
  closingApp = true;
  try {
    if (options.save && !await flushProfileSave()) return;
  } finally {
    closingApp = false;
  }
  state.visible = false;
  appMount?.setVisible(false);
}

function root(): HTMLElement {
  return appMount.root as HTMLElement;
}

function hostElement<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const element = (ctxRef?.dom?.createElement?.(tag) || document.createElement(tag)) as HTMLElementTagNameMap[K];
  if (className) element.className = className;
  return element;
}

function render() {
  if (!appMount || !state.visible) return;
  const current = state.devMode ? devTab : tabs[state.activeTab] || tabs[0];
  const heroImage = heroImageUrl();
  const status = heroStatus();
  root().innerHTML = `
    <div class="meg-overlay">
      <div class="ps-modern-modal app-container">
        <nav class="dock" id="ps_dynamic_dots" aria-label="Megumin Suite sections">
          ${tabs.map((tab, index) => dockButton(tab, index)).join("")}
        </nav>
        <div class="main-wrapper">
          <section class="hero-banner" ${heroImage ? `style="background-image:url('${escapeHtml(heroImage)}')"` : ""}>
            <div class="hero-overlay"></div>
            <div class="top-app-bar">
              <div class="app-actions">
                <div class="live-token-count" title="${escapeHtml(payloadTokenTitle())}">${icon("fa-microchip")} ${escapeHtml(payloadTokenLabel())}</div>
                ${state.devMode ? "" : `<button id="btn_apply_tab_all" type="button" class="ps-modern-btn secondary" data-action="sync-tab">${icon("fa-earth-americas")} Sync Tab Globally</button>`}
                <button id="ps_btn_reset" type="button" class="ps-modern-btn secondary" data-action="reset">${icon("fa-rotate-left")} Reset</button>
                <button id="ps_btn_dev_mode" type="button" class="ps-modern-btn secondary ${state.devMode ? "active" : ""}" data-action="open-dev">${icon(state.devMode ? "fa-right-from-bracket" : "fa-code")} ${state.devMode ? "Exit Dev" : "Dev"}</button>
                <span id="ps_save_indicator" class="ps-save-indicator ${state.saving ? "saving" : ""}" ${state.status ? "" : "hidden"}>${escapeHtml(state.status)}</span>
                ${state.devMode ? "" : `<button id="ps_btn_save_close" type="button" class="ps-modern-btn primary" data-action="close">${icon("fa-floppy-disk")} Save & Close</button>`}
              </div>
            </div>
            <div class="hero-content">
              <div class="status" id="ps_rule_status_main" style="color:${status.color};text-shadow:${status.shadow};">${escapeHtml(status.text)}</div>
              <h2 class="name" id="ps_char_rule_label">${escapeHtml(heroName())}</h2>
            </div>
          </section>
          <section class="main-content" id="ps_stage_content">
            ${current.render()}
          </section>
        </div>
      </div>
    </div>`;
  wire(root());
}

function dockButton(tab: typeof tabs[number], index: number): string {
  const active = !state.devMode && index === state.activeTab;
  return `<button type="button" class="dock-icon ${active ? "active" : ""}" data-tab="${index}" title="${escapeHtml(tab.title)}">
    ${icon(tab.icon)}<span>${escapeHtml(tab.title)}</span>
  </button>`;
}

function scopeLabel(): string {
  return state.context?.chatId ? `Chat Profile: ${state.context.chatId}` : "Global Default";
}

function heroImageUrl(): string {
  if (state.context?.isGroup && state.uiAssets.groupImage) return state.uiAssets.groupImage;
  if (state.context?.characterAvatarUrl) return state.context.characterAvatarUrl;
  const heroes = state.uiAssets.heroImages || [];
  return heroes[(state.activeTab + (state.context?.chatId || "").length) % Math.max(1, heroes.length)] || "";
}

function heroStatus(): { text: string; color: string; shadow: string } {
  if (state.context?.isGroup) return { text: "CUSTOM GROUP PROFILE", color: "#3b82f6", shadow: "0 0 10px rgba(59,130,246,0.5)" };
  if (state.context?.characterId) return { text: "CUSTOM CHARACTER PROFILE", color: "#10b981", shadow: "0 0 10px rgba(16,185,129,0.5)" };
  if (state.context?.chatId) return { text: "USING SYSTEM DEFAULT", color: "#f59e0b", shadow: "0 0 10px rgba(245,158,11,0.5)" };
  return { text: "MODIFYING GLOBAL DEFAULT", color: "#a855f7", shadow: "0 0 10px rgba(168,85,247,0.5)" };
}

function heroName(): string {
  if (state.context?.isGroup) return state.context.groupName || state.context.chatName || "Group Chat";
  if (state.context?.characterId && state.context.characterName !== "the character") return state.context.characterName;
  return state.context?.chatName || "Global Default";
}

function wire(container: HTMLElement) {
  mountDnrPanel(container);
  container.querySelector<HTMLElement>(".meg-overlay")?.addEventListener("click", (event) => {
    if (event.target !== event.currentTarget) return;
    void closeApp({ save: true });
  });
  container.querySelectorAll<HTMLElement>("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.devMode = false;
      state.styleEditorId = null;
      state.devEditorId = null;
      state.activeTab = Number(button.dataset.tab || 0);
      render();
    });
  });
  container.querySelectorAll<HTMLElement>("[data-action]").forEach((el) => {
    el.addEventListener("click", () => handleAction(el));
  });
  // Story Config selects carry a "Write my own…" escape hatch, so they cannot just
  // bind: picking it has to reveal the free-text box rather than store the sentinel.
  container.querySelectorAll<HTMLSelectElement>("select[data-action=\"config-select\"]").forEach((select) => {
    select.addEventListener("change", () => {
      const path = select.dataset.bind || select.dataset.path!;
      const row = select.closest(".cfg-row-control");
      const custom = row?.querySelector<HTMLInputElement>(".cfg-custom");
      if (select.value === "__custom") {
        if (custom) {
          custom.style.display = "block";
          custom.focus();
          setPath(state.profile as any, path, custom.value || "");
        }
      } else {
        if (custom) custom.style.display = "none";
        setPath(state.profile as any, path, select.value);
      }
      saveProfileSoon();
      render();
    });
  });
  container.querySelectorAll<HTMLSelectElement>("select[data-action=\"blk-vis\"]").forEach((select) => {
    select.addEventListener("change", () => {
      const id = select.dataset.id!;
      const overrides = state.profile.blockStack.overrides as unknown as Record<string, { visibility?: string }>;
      overrides[id] = { ...(overrides[id] || {}), visibility: select.value };
      saveProfileSoon();
      render();
    });
  });
  container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("[data-bind]").forEach((input) => {
    input.addEventListener("change", () => {
      const path = input.dataset.bind!;
      const value = readInputValue(input);
      setPath(state.profile as any, path, value);
      saveProfileSoon();
      if (shouldRenderAfterBind(input)) render();
    });
    if (input.tagName === "TEXTAREA" || input.type === "text" || input.type === "number" || input.type === "range") {
      input.addEventListener("input", () => {
        const path = input.dataset.bind!;
        setPath(state.profile as any, path, readInputValue(input));
        if (path === "dnRatio.dialogue") updateDnrUi(container, Number(readInputValue(input)));
        saveProfileSoon();
      });
    }
  });
  container.querySelector<HTMLElement>("#dnr_header_toggle")?.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("#dnr_toggle,[data-action],input,select,textarea")) return;
    state.profile.dnRatio.enabled = !state.profile.dnRatio.enabled;
    saveProfileSoon();
    render();
  });
  container.querySelector<HTMLSelectElement>("#ig_res_preset")?.addEventListener("change", (event) => {
    const index = Number((event.currentTarget as HTMLSelectElement).value);
    const res = RESOLUTIONS[index];
    if (!res) return;
    state.profile.imageGen.imgWidth = res.w;
    state.profile.imageGen.imgHeight = res.h;
    saveProfileSoon();
    render();
  });
  container.querySelectorAll<HTMLElement>(".dev-preset-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.target || "";
      const input = target ? container.querySelector<HTMLTextAreaElement>(`#${CSS.escape(target)}`) : null;
      if (input) input.value = button.dataset.val || "";
    });
  });
  container.querySelectorAll<HTMLSelectElement>(".dev-preset-dropdown").forEach((select) => {
    select.addEventListener("change", () => {
      const target = select.dataset.target || "";
      const input = target ? container.querySelector<HTMLTextAreaElement>(`#${CSS.escape(target)}`) : null;
      if (input) input.value = select.value || "";
      select.selectedIndex = 0;
    });
  });
  container.querySelectorAll<HTMLTextAreaElement>(".npc-field-edit").forEach((input) => {
    input.addEventListener("change", () => {
      const card = input.closest<HTMLElement>("[data-npc-name]");
      const name = card?.dataset.npcName || "";
      const npc = state.profile.npcBank.npcs.find((item) => item.name === name) as any;
      if (!npc || !input.dataset.field) return;
      npc[input.dataset.field] = input.value;
      saveProfileSoon();
    });
  });
  container.querySelector<HTMLInputElement>("#dev_import_file")?.addEventListener("change", (event) => {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const imported = JSON.parse(String(reader.result || "{}"));
        const id = `custom_${Date.now()}`;
        const label = imported.label || imported.name || "Imported Engine";
        const data = await request<any>("engine:save", { engine: { ...imported, id, label } });
        state.engines = data.engines;
        state.customEngines = data.customEngines;
        state.status = `Imported ${label}`;
        state.devEditorId = id;
        render();
      } catch {
        state.status = "Invalid engine JSON";
        render();
      }
    };
    reader.readAsText(file);
  });
}

function shouldRenderAfterBind(input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): boolean {
  if (input instanceof HTMLSelectElement) return true;
  if (input instanceof HTMLInputElement && input.type === "checkbox") return true;
  return false;
}

function mountDnrPanel(container: HTMLElement) {
  const mount = container.querySelector<HTMLElement>("#dnr_mount");
  if (!mount || mount.querySelector("#dnr_panel")) return;

  const dVal = clamp(Number(state.profile.dnRatio?.dialogue ?? 50), 0, 100);
  const nVal = 100 - dVal;
  const isDnr = !!state.profile.dnRatio?.enabled;

  const panel = hostElement("div", "wstyle-dnr-panel");
  panel.id = "dnr_panel";

  const header = hostElement("div", "wstyle-dnr-header");
  header.id = "dnr_header_toggle";

  const info = hostElement("div", "dnr-info");
  const dnrIcon = hostElement("div", "dnr-icon");
  dnrIcon.innerHTML = icon("fa-scale-balanced");
  const textWrap = hostElement("div");
  const title = hostElement("div", "dnr-title");
  title.textContent = "Dialogue / Narration Ratio";
  const subtitle = hostElement("div", "dnr-subtitle");
  subtitle.textContent = "Fine\u2011tune the balance between spoken dialogue and descriptive prose.";
  textWrap.append(title, subtitle);
  info.append(dnrIcon, textWrap);

  const toggle = hostElement("div", `ps-toggle-card ${isDnr ? "active" : ""}`);
  toggle.id = "dnr_toggle";
  toggle.dataset.action = "toggle";
  toggle.dataset.path = "dnRatio.enabled";
  const switchEl = hostElement("div", "ps-switch");
  toggle.append(switchEl);
  header.append(info, toggle);

  const body = hostElement("div", `wstyle-dnr-body ${isDnr ? "open" : ""}`);
  body.id = "dnr_body";

  const track = hostElement("div", "wstyle-dnr-slider-track");
  const narrLabel = hostElement("span", "wstyle-dnr-label narr");
  const narrValue = hostElement("span");
  narrValue.id = "lbl_narr";
  narrValue.textContent = String(nVal);
  narrLabel.append(narrValue, "% Narration");

  const slider = hostElement("input");
  slider.type = "range";
  slider.id = "dnr_slider";
  slider.min = "0";
  slider.max = "100";
  slider.step = "10";
  slider.value = String(dVal);
  slider.dataset.bind = "dnRatio.dialogue";

  const dialLabel = hostElement("span", "wstyle-dnr-label dial");
  const dialValue = hostElement("span");
  dialValue.id = "lbl_dial";
  dialValue.textContent = String(dVal);
  dialLabel.append(dialValue, "% Dialogue");
  track.append(narrLabel, slider, dialLabel);

  const preview = hostElement("div", "dnr-preview");
  preview.id = "dnr_preview";
  const prevD = hostElement("span");
  prevD.id = "lbl_prev_d";
  prevD.textContent = String(dVal);
  const prevN = hostElement("span");
  prevN.id = "lbl_prev_n";
  prevN.textContent = String(nVal);
  preview.append("Preview \u2192 \"Maintain a balance of ", prevD, "% Dialogue and ", prevN, "% Narration.\"");

  body.append(track, preview);
  panel.append(header, body);
  mount.replaceChildren(panel);
}

function readInputValue(input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): unknown {
  if (input instanceof HTMLInputElement && input.type === "checkbox") return input.checked;
  if (input instanceof HTMLInputElement && (input.type === "number" || input.type === "range")) return Number(input.value);
  return input.value;
}

let saveTimer: number | null = null;
let profileDirty = false;
let savePromise: Promise<boolean> | null = null;
let statusClearTimer: number | null = null;

function updateSaveIndicator() {
  const indicator = appMount?.root?.querySelector?.("#ps_save_indicator") as HTMLElement | null;
  if (!indicator) return;
  indicator.textContent = state.status;
  indicator.hidden = !state.status;
  indicator.classList.toggle("saving", state.saving);
}

function setStatus(message: string, options: { saving?: boolean; autoClear?: boolean } = {}) {
  if (statusClearTimer) {
    window.clearTimeout(statusClearTimer);
    statusClearTimer = null;
  }
  state.status = message;
  state.saving = !!options.saving;
  updateSaveIndicator();
  if (message && options.autoClear) {
    statusClearTimer = window.setTimeout(() => {
      if (state.status !== message) return;
      state.status = "";
      state.saving = false;
      updateSaveIndicator();
      statusClearTimer = null;
    }, 1500);
  }
}

async function saveProfileToBackend(): Promise<boolean> {
  setStatus("Saving...", { saving: true });
  try {
    const data = await request<any>("profile:save", { profile: state.profile, scope: state.context?.scope });
    state.profile = mergeProfile(data.profile);
    await refreshPresetAudit();
    setStatus("Saved", { autoClear: true });
    return true;
  } catch (err) {
    profileDirty = true;
    setStatus(err instanceof Error ? err.message : "Save failed");
    return false;
  }
}

async function flushProfileSave(): Promise<boolean> {
  if (saveTimer) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (savePromise) await savePromise;
  if (!profileDirty) return true;
  profileDirty = false;
  savePromise = saveProfileToBackend();
  try {
    return await savePromise;
  } finally {
    savePromise = null;
  }
}

function saveProfileSoon() {
  if (saveTimer) window.clearTimeout(saveTimer);
  profileDirty = true;
  setStatus("Saving...", { saving: true });
  saveTimer = window.setTimeout(() => { void flushProfileSave(); }, 250);
}

async function handleAction(el: HTMLElement) {
  const action = el.dataset.action;
  try {
    if (action === "close") return closeApp({ save: true });
    if (action === "open-dev") {
      state.devMode = !state.devMode;
      state.styleEditorId = null;
      state.devEditorId = null;
      render();
      return;
    }
    if (action === "refresh") {
      state.status = "Refreshing...";
      render();
      await flushProfileSave();
      await bootstrap();
      return;
    }
    if (action === "reset") {
      if (!confirm("Reset this Megumin profile to defaults?")) return;
      const data = await request<any>("profile:reset");
      state.profile = mergeProfile(data.profile);
      await refreshPresetAudit();
      state.status = "Reset";
      state.devMode = false;
      state.devEditorId = null;
      render();
      return;
    }
    if (action === "sync-tab") {
      const data = await request<any>("profile:syncTab", { keys: activeTabProfileKeys() });
      state.profile = mergeProfile(data.profile);
      await refreshPresetAudit();
      state.status = "Synced";
      render();
      return;
    }
    if (action === "engine-filter") {
      state.engineFilter = el.dataset.value || "all";
      render();
      return;
    }
    if (action === "style-filter") {
      state.styleFilter = el.dataset.value || "direct";
      render();
      return;
    }
    if (action === "style-off") {
      state.profile.activeStyleId = null;
      state.profile.aiRule = "";
      saveProfileSoon();
      render();
      return;
    }
    if (action === "style-create") {
      state.styleEditorId = "__new";
      render();
      return;
    }
    if (action === "style-edit") {
      state.styleEditorId = el.dataset.value || "__new";
      render();
      return;
    }
    if (action === "style-back") {
      state.styleEditorId = null;
      render();
      return;
    }
    if (action === "style-direct") {
      const style = [...(state.logic?.directStyles || []), ...(state.profile.customStyles || [])].find((item: any) => item.id === el.dataset.value);
      if (style) {
        state.profile.activeStyleId = style.id;
        state.profile.aiRule = style.rule || "";
        saveProfileSoon();
        render();
      }
      return;
    }
    if (action === "style-template") {
      const template = (state.logic?.styleTemplates || [])[Number(el.dataset.index || 0)];
      if (template) {
        state.status = "Generating style...";
        render();
        const data = await request<any>("style:generate", { name: template.name, notes: template.notes, tags: template.tags || [] });
        const rule = String(data.rule || "").trim();
        if (!rule) throw new Error("Style generation returned empty output");
        const id = `style_${Date.now()}`;
        const newStyle = { id, name: template.name, notes: template.notes || "", rule };
        state.profile.customStyles = [...(state.profile.customStyles || []), newStyle];
        state.profile.activeStyleId = id;
        state.profile.aiRule = rule;
        saveProfileSoon();
        render();
      }
      return;
    }
    if (action === "style-generate-rule") {
      const name = ((root().querySelector("#style-name") as HTMLInputElement)?.value || "Custom AI Style").trim();
      const notes = ((root().querySelector("#style-notes") as HTMLTextAreaElement)?.value || "").trim();
      state.status = "Generating style...";
      const data = await request<any>("style:generate", { name, notes });
      const rule = String(data.rule || "").trim();
      const ruleArea = root().querySelector("#style-rule") as HTMLTextAreaElement | null;
      if (ruleArea) ruleArea.value = rule;
      state.profile.aiRule = rule || state.profile.aiRule;
      state.status = rule ? "Done" : "Style generation returned empty output";
      return;
    }
    if (action === "style-load-template") {
      const select = root().querySelector("#style-template-select") as HTMLSelectElement | null;
      const template = (state.logic?.styleTemplates || [])[Number(select?.value || -1)];
      if (!template) return;
      const nameInput = root().querySelector("#style-name") as HTMLInputElement | null;
      const notesInput = root().querySelector("#style-notes") as HTMLTextAreaElement | null;
      const ruleInput = root().querySelector("#style-rule") as HTMLTextAreaElement | null;
      if (nameInput) nameInput.value = template.name || "";
      if (notesInput) notesInput.value = template.notes || "";
      if (ruleInput) ruleInput.value = "";
      return;
    }
    if (action === "style-insights") {
      const name = ((root().querySelector("#style-name") as HTMLInputElement)?.value || "Custom AI Style").trim();
      const notes = ((root().querySelector("#style-notes") as HTMLTextAreaElement)?.value || "").trim();
      state.status = "Generating insights...";
      const data = await request<any>("style:insights", { name, notes });
      const insights = String(data.insights || "").trim();
      const notesArea = root().querySelector("#style-notes") as HTMLTextAreaElement | null;
      if (notesArea && insights) notesArea.value = notes ? `${notes}\n\n${insights}` : insights;
      state.status = insights ? "Done" : "No insights returned";
      return;
    }
    if (action === "style-regenerate") {
      const id = el.dataset.value || "";
      const style = (state.profile.customStyles || []).find((item) => item.id === id);
      if (!style) return;
      state.status = "Regenerating style...";
      render();
      const data = await request<any>("style:generate", { name: style.name, notes: style.notes || style.rule });
      const rule = String(data.rule || "").trim();
      if (rule) {
        style.rule = rule;
        if (state.profile.activeStyleId === id) state.profile.aiRule = rule;
        saveProfileSoon();
      }
      render();
      return;
    }
    if (action === "style-save-custom") {
      const name = ((root().querySelector("#style-name") as HTMLInputElement)?.value || "Custom AI Style").trim();
      const notes = ((root().querySelector("#style-notes") as HTMLTextAreaElement)?.value || "").trim();
      const rule = ((root().querySelector("#style-rule") as HTMLTextAreaElement)?.value || state.profile.aiRule).trim();
      if (!rule) throw new Error("Write or generate a rule before saving");
      const id = state.styleEditorId && state.styleEditorId !== "__new"
        ? state.styleEditorId
        : `custom_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || Date.now()}`;
      const existing = (state.profile.customStyles || []).filter((style) => style.id !== id);
      state.profile.customStyles = [...existing, { id, name, rule, notes }];
      state.profile.activeStyleId = id;
      state.profile.aiRule = rule;
      state.styleEditorId = null;
      saveProfileSoon();
      render();
      return;
    }
    if (action === "style-delete") {
      const id = el.dataset.value || "";
      state.profile.customStyles = (state.profile.customStyles || []).filter((style) => style.id !== id);
      if (state.profile.activeStyleId === id) {
        state.profile.activeStyleId = null;
        state.profile.aiRule = "";
      }
      saveProfileSoon();
      render();
      return;
    }
    if (action === "toggle") {
      const path = el.dataset.path!;
      setPath(state.profile as any, path, !getPath(state.profile as any, path));
      saveProfileSoon();
      render();
      return;
    }
    if (action === "select") {
      setPath(state.profile as any, el.dataset.path!, el.dataset.value);
      saveProfileSoon();
      render();
      return;
    }
    if (action === "sd-flavor") {
      const flavor = el.dataset.value || "";
      const tags = state.profile.storyPlan.flavorTags;
      const at = tags.indexOf(flavor);
      if (at >= 0) tags.splice(at, 1);
      // The label says "pick up to 3", so the cap is enforced rather than advisory.
      else if (tags.length < 3) tags.push(flavor);
      else state.status = "Pick up to 3 flavor tags";
      saveProfileSoon();
      render();
      return;
    }
    if (action === "story-evolve") return runTask("Evolving directive...", "story:generate");
    if (action === "cfg-row") {
      // One row open at a time keeps the list readable at fifteen settings.
      const key = el.dataset.value || "";
      state.openConfigRow = state.openConfigRow === key ? null : key;
      render();
      return;
    }
    if (action === "cfg-chip") {
      const path = el.dataset.path!;
      const chip = el.dataset.value || "";
      const current = String(getPath(state.profile as any, path) || "");
      const parts = current.split(",").map((part) => part.trim()).filter(Boolean);
      const at = parts.indexOf(chip);
      if (at > -1) parts.splice(at, 1);
      else parts.push(chip);
      setPath(state.profile as any, path, parts.join(", "));
      saveProfileSoon();
      render();
      return;
    }
    if (action === "cfg-preset-load") {
      const select = document.querySelector<HTMLSelectElement>("#cfg_preset_select");
      const id = select?.value || "";
      if (!id) { state.status = "Pick a preset first."; render(); return; }
      const preset = allConfigPresets(state.profile.configPresets || []).find((item) => item.id === id);
      if (!preset) return;
      // Every field is written, so a field the preset omits goes back to Default
      // rather than keeping whatever happened to be there.
      for (const field of storyConfigFields) {
        (state.profile.storyConfig as Record<string, string | boolean>)[field.key] = preset.values[field.key] || "";
      }
      saveProfileSoon();
      render();
      return;
    }
    if (action === "cfg-preset-save") {
      const name = prompt("Name this config preset:");
      if (!name || !name.trim()) return;
      const values: Record<string, string> = {};
      for (const field of storyConfigFields) values[field.key] = String(state.profile.storyConfig[field.key] || "");
      state.profile.configPresets = [
        ...(state.profile.configPresets || []),
        { id: "cfgp_" + Date.now(), name: name.trim(), builtin: false, values }
      ];
      saveProfileSoon();
      render();
      return;
    }
    if (action === "cfg-preset-delete") {
      const select = document.querySelector<HTMLSelectElement>("#cfg_preset_select");
      const id = select?.value || "";
      if (!id) { state.status = "Pick a preset first."; render(); return; }
      const preset = allConfigPresets(state.profile.configPresets || []).find((item) => item.id === id);
      if (!preset) return;
      if (preset.builtin) { state.status = "Built-in presets can't be deleted."; render(); return; }
      if (!confirm(`Delete the preset "${preset.name}"?`)) return;
      state.profile.configPresets = (state.profile.configPresets || []).filter((item) => item.id !== id);
      saveProfileSoon();
      render();
      return;
    }
    if (action === "cfg-reset-all") {
      if (!confirm("Set every setting back to preset default?")) return;
      for (const field of storyConfigFields) {
        (state.profile.storyConfig as Record<string, string | boolean>)[field.key] = "";
      }
      saveProfileSoon();
      render();
      return;
    }
    if (action === "blk-add") {
      const id = el.dataset.id || "";
      const def = blockById(state.profile, id) as BlockDef | undefined;
      // Choices is the one block the reader acts on, so it opens the strip.
      if (def?.preferFirst) state.profile.blockStack.order.unshift(id);
      else state.profile.blockStack.order.push(id);
      state.profile.blocks = syncLegacyBlockIds(state.profile);
      saveProfileSoon();
      render();
      return;
    }
    if (action === "blk-remove") {
      const id = el.dataset.id || "";
      state.profile.blockStack.order = state.profile.blockStack.order.filter((item) => item !== id);
      state.profile.blocks = syncLegacyBlockIds(state.profile);
      saveProfileSoon();
      render();
      return;
    }
    if (action === "blk-move") {
      const id = el.dataset.id || "";
      const delta = Number(el.dataset.dir || 0);
      const order = state.profile.blockStack.order;
      const at = order.indexOf(id);
      const to = at + delta;
      if (at < 0 || to < 0 || to >= order.length) return;
      order.splice(to, 0, ...order.splice(at, 1));
      state.profile.blocks = syncLegacyBlockIds(state.profile);
      saveProfileSoon();
      render();
      return;
    }
    if (action === "blk-new") {
      const name = prompt("Name for the custom block:");
      if (!name || !name.trim()) return;
      // The tag is what the model writes, so it has to be a legal XML name.
      const tag = name.trim().replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "Custom_Block";
      const taken = new Set([
        ...BLOCK_REGISTRY.map((b) => b.tag.toLowerCase()),
        ...state.profile.blockStack.custom.map((b) => b.tag.toLowerCase())
      ]);
      if (taken.has(tag.toLowerCase())) {
        alert(`A block already uses the tag <${tag}>. Pick another name.`);
        return;
      }
      const id = "custom_" + Date.now().toString(36);
      state.profile.blockStack.custom.push({ id, name: name.trim(), tag, content: "" });
      state.profile.blockStack.order.push(id);
      state.profile.blocks = syncLegacyBlockIds(state.profile);
      saveProfileSoon();
      render();
      return;
    }
    if (action === "blk-edit") {
      const id = el.dataset.id || "";
      const block = state.profile.blockStack.custom.find((item) => item.id === id);
      if (!block) return;
      const next = prompt(`What should the model put inside <${block.tag}>?`, block.content);
      if (next === null) return;
      block.content = next;
      saveProfileSoon();
      render();
      return;
    }
    if (action === "sf-add") {
      const blockId = el.dataset.block || "";
      const target = state.profile.statBlocks[blockId] || (state.profile.statBlocks[blockId] = { fields: [] });
      target.fields.push({ id: "f_" + Date.now(), label: "New field", type: "meter", max: 100, start: 0 });
      saveProfileSoon();
      render();
      return;
    }
    if (action === "sf-del") {
      const fields = state.profile.statBlocks[el.dataset.block || ""]?.fields;
      const index = Number(el.dataset.index || -1);
      if (!fields || index < 0 || index >= fields.length) return;
      fields.splice(index, 1);
      saveProfileSoon();
      render();
      return;
    }
    if (action === "sf-up") {
      const fields = state.profile.statBlocks[el.dataset.block || ""]?.fields;
      const index = Number(el.dataset.index || -1);
      if (!fields || index <= 0) return;
      fields.splice(index - 1, 0, ...fields.splice(index, 1));
      saveProfileSoon();
      render();
      return;
    }
    if (action === "sf-pack") {
      const blockId = el.dataset.block || "";
      const pack = (STAT_FIELD_PACKS[blockId] || []).find((item) => item.id === el.dataset.value);
      if (!pack) return;
      const target = state.profile.statBlocks[blockId] || (state.profile.statBlocks[blockId] = { fields: [] });
      // Merge, never replace: a field already there keeps its settings.
      for (const field of pack.fields) {
        if (!target.fields.some((existing) => String(existing.label).toLowerCase() === field.label.toLowerCase())) {
          target.fields.push({ ...field });
        }
      }
      saveProfileSoon();
      render();
      return;
    }
    if (action === "select-engine") {
      const engineId = el.dataset.value || "";
      state.profile.mode = engineId;
      const style = preferredStyleForEngine(engineId);
      if (style) {
        state.profile.activeStyleId = style.id;
        state.profile.aiRule = style.rule || state.profile.aiRule;
      }
      saveProfileSoon();
      render();
      return;
    }
    if (action === "toggle-array") {
      const path = el.dataset.path!;
      const value = el.dataset.value!;
      const current = [...(getPath(state.profile as any, path) || [])];
      setPath(state.profile as any, path, current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
      saveProfileSoon();
      render();
      return;
    }
    if (action === "select-resolution") {
      state.profile.imageGen.imgWidth = Number(el.dataset.w || state.profile.imageGen.imgWidth);
      state.profile.imageGen.imgHeight = Number(el.dataset.h || state.profile.imageGen.imgHeight);
      saveProfileSoon();
      render();
      return;
    }
    if (action === "story-generate") return runTask("Generating story plan...", "story:generate");
    if (action === "ban-analyze") return runTask("Analyzing style...", "banlist:analyze");
    if (action === "npc-scan") return runTask("Scanning NPCs...", "npc:scan");
    if (action === "image-manual") {
      let prompt = (root().querySelector("#meg-manual-image-prompt") as HTMLTextAreaElement)?.value || "";
      if (state.profile.imageGen.previewPrompt) {
        if (!prompt.trim()) {
          state.status = "Building image prompt...";
          render();
          const data = await request<any>("image:prompt");
          prompt = String(data.prompt || "");
        }
        const edited = window.prompt("Image prompt", prompt);
        if (edited === null) {
          state.status = "";
          render();
          return;
        }
        prompt = edited;
      }
      return runTask("Generating image...", "image:manual", { prompt });
    }
    if (action === "image-test") return runTask("Testing ComfyUI connection...", "image:connections");
    if (action === "image-workflow-noop") {
      state.status = "Workflow settings are saved";
      render();
      return;
    }
    if (action === "preset-ensure") {
      const data = await request<any>("preset:resolve", { kind: el.dataset.kind || "engine" });
      state.presetBridge = data.presetBridge || state.presetBridge;
      await refreshPresetAudit();
      state.status = data.preset?.name ? `${data.preset.name} found` : "Preset missing";
      render();
      return;
    }
    if (action === "npc-portrait") return runTask("Generating portrait...", "npc:portrait", { name: el.dataset.name });
    if (action === "npc-upload") {
      const file = await pickOneFile(["image/png", "image/jpeg", "image/webp", ".png", ".jpg", ".jpeg", ".webp"], 8 * 1024 * 1024);
      if (!file) return;
      const dataUrl = bytesToDataUrl(file.bytes, file.mimeType || "image/png");
      return runTask("Uploading portrait...", "npc:uploadPortrait", { name: el.dataset.name, dataUrl, filename: file.name });
    }
    if (action === "npc-clear") {
      if (!state.profile.npcBank.npcs.length || !confirm("Clear all saved NPCs?")) return;
      state.profile.npcBank.npcs = [];
      saveProfileSoon();
      render();
      return;
    }
    if (action === "ban-remove") {
      state.profile.banList = state.profile.banList.filter((item) => item !== el.dataset.value);
      saveProfileSoon();
      render();
      return;
    }
    if (action === "ban-clear") {
      if (!state.profile.banList.length || !confirm("Clear every banned phrase?")) return;
      state.profile.banList = [];
      saveProfileSoon();
      render();
      return;
    }
    if (action === "ban-add") {
      const raw = (root().querySelector("#ps_manual_ban_input") as HTMLInputElement)?.value || "";
      const additions = raw.split(/\n+/).map((item) => item.trim()).filter(Boolean);
      for (const item of additions) if (!state.profile.banList.includes(item)) state.profile.banList.push(item);
      saveProfileSoon();
      render();
      return;
    }
    if (action === "ban-import") {
      const file = await pickOneFile([".json", "application/json"], 1024 * 1024);
      if (!file) return;
      const text = new TextDecoder().decode(file.bytes);
      const parsed = JSON.parse(text);
      const items: unknown[] = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.banList) ? parsed.banList : [];
      for (const item of items.map(String).map((value: string) => value.trim()).filter(Boolean)) {
        if (!state.profile.banList.includes(item)) state.profile.banList.push(item);
      }
      saveProfileSoon();
      render();
      return;
    }
    if (action === "npc-remove") {
      state.profile.npcBank.npcs = state.profile.npcBank.npcs.filter((item) => item.name !== el.dataset.name);
      saveProfileSoon();
      render();
      return;
    }
    if (action === "ban-export") {
      const blob = new Blob([JSON.stringify(state.profile.banList, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "megumin-ban-list.json";
      anchor.click();
      URL.revokeObjectURL(url);
      return;
    }
    if (action === "dev-new") {
      state.devEditorId = "__new";
      render();
      return;
    }
    if (action === "dev-import") {
      root().querySelector<HTMLInputElement>("#dev_import_file")?.click();
      return;
    }
    if (action === "dev-back") {
      state.devEditorId = null;
      render();
      return;
    }
    if (action === "dev-clone" || action === "dev-edit") {
      state.devEditorId = el.dataset.id || "__new";
      render();
      return;
    }
    if (action === "dev-export") {
      const engine = state.customEngines.find((item) => item.id === el.dataset.id);
      if (!engine) return;
      const blob = new Blob([JSON.stringify(engine, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${(engine.label || engine.id).replace(/\s+/g, "_")}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      return;
    }
    if (action === "dev-save") return saveDevEngine();
    if (action === "dev-delete") return deleteDevEngine(el.dataset.id || "");
  } catch (err) {
    state.status = err instanceof Error ? err.message : String(err);
    render();
  }
}

async function runTask(status: string, type: string, payload?: unknown) {
  state.status = status;
  render();
  const data = await request<any>(type, payload);
  if (data.profile) state.profile = mergeProfile(data.profile);
  if (data.imageConnections) state.imageConnections = data.imageConnections;
  if (data.profile) await refreshPresetAudit();
  state.status = "Done";
  render();
}

async function saveDevEngine() {
  const label = (root().querySelector("#dev_mode_name") as HTMLInputElement)?.value.trim();
  const id = ((root().querySelector("#dev_mode_id") as HTMLInputElement)?.value || label || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "");
  const p1 = (root().querySelector("#dev_edit_p1") as HTMLTextAreaElement)?.value || "";
  const p3 = (root().querySelector("#dev_edit_p3") as HTMLTextAreaElement)?.value || "";
  const p4 = (root().querySelector("#dev_edit_p4") as HTMLTextAreaElement)?.value || "";
  const p5 = (root().querySelector("#dev_edit_p5") as HTMLTextAreaElement)?.value || "";
  const p6 = (root().querySelector("#dev_edit_p6") as HTMLTextAreaElement)?.value || "";
  if (!id || !label) throw new Error("Engine id and label are required");
  const existing = state.customEngines.find((engine) => engine.id === id) || {};
  const engine: Record<string, unknown> = { ...existing, id, label, color: "#a855f7", p1, p3, p4, p5, p6 };
  const fields = ["cot", "prefill", "cyoa", "info", "summary", "death", "combat", "direct", "dn", "dialogueColor", "mvu", "storytracker", "think", "language", "pronouns", "count", "dnratio", "onomato", "banlist"];
  for (const field of fields) {
    const input = root().querySelector(`#dev_edit_${field}`) as HTMLTextAreaElement | null;
    if (input) engine[field] = input.value;
  }
  const data = await request<any>("engine:save", { engine });
  state.engines = data.engines;
  state.customEngines = data.customEngines;
  state.devEditorId = id;
  state.status = "Engine saved";
  render();
}

async function deleteDevEngine(id: string) {
  if (!id || !confirm(`Delete ${id}?`)) return;
  const data = await request<any>("engine:delete", { id });
  state.engines = data.engines;
  state.customEngines = data.customEngines;
  state.status = "Engine deleted";
  render();
}

function renderEngines(): string {
  const descriptions: Record<string, string> = {
    balance: "The original Secret Sauce. NPCs react naturally - no simping, no needless hostility.",
    "balance Test": "New and improved balance mode that aims to use less tokens and more creativity.",
    cinematic: "Hollywood-inspired storytelling. Dramatic beats and heightened tension.",
    dark: "Balance but harsher. The world is unforgiving and consequences hit harder.",
    "v6-anime-director": "Advanced cinematic framing and pacing. Designed to emulate high-budget anime direction.",
    "v6-dream-team": "The ultimate 6-specialist writer room. Unprecedented narrative consistency and realism.",
    "v6-dream-team-lite": "A streamlined version of the Dream Team. Faster generation with lower token overhead.",
    "v7-core": "The V7 Core engine. The perfect middle ground: cinematic pacing, realistic friction, and relentless world progression.",
    "v7-reality": "The V7 Reality engine. Grounded, unrelenting simulation with zero narrative protection.",
    "v7-gentle": "The V7 Gentle engine. A softer, For pussies."
  };
  const active = state.engines.find((engine) => engine.id === state.profile.mode);
  const visible = state.engines.filter((engine) => engineMatchesFilter(engine, state.engineFilter));
  const isV7 = state.profile.mode.startsWith("v7");
  const v7Toggles = [
    { id: "v7_ooc", label: "OOC Protocol", desc: "Allows out-of-character directives." },
    { id: "v7_pcsolo", label: "PC Solo Physicality", desc: "Narration of PC when unobserved." },
    { id: "v7_intro", label: "Introduction Protocol", desc: "How new NPCs enter the story." },
    { id: "v7_culture", label: "Cultural Anchoring", desc: "Real-world integration and references." },
    { id: "v7_scene", label: "Scene Choreography", desc: "Focus shifting and crowd management." }
  ];

  return `
    ${tabHeader("Core Engines", "Choose the narrative engine that drives your AI's behavior.", "fa-microchip", "#f59e0b", active?.label || state.profile.mode, "#10b981", "fa-circle-check")}
    ${presetStatusWarning()}
    ${presetFeatureWarning(["core-engines"])}
    <div class="wstyle-filters">
      ${["all", "V9", "V8", "V7", "V6"].map((filter) => filterPill(filter, state.engineFilter === filter, engineCount(filter))).join("")}
    </div>
    <div class="mtab-card-grid">
      ${visible.map((engine) => engineCard(engine, descriptions[engine.id] || `${engine.label || engine.id} engine flow.`)).join("")}
    </div>
    <div id="v6-empty-msg" style="display:${state.engineFilter === "V6" ? "block" : "none"};">${lockedState("fa-hammer", "V6 Engines are in the forge.", "Stay tuned for the next update! Later this week.")}</div>
    ${isV7 ? `<div class="wstyle-section-head blue">${icon("fa-layer-group")} V7 Modules (Turn off to disable)</div>
    <div class="mtab-card-list">
      ${v7Toggles.map((tog) => toggleGeneric(tog.label, `toggles.${tog.id}`, state.profile.toggles[tog.id] !== false, tog.desc)).join("")}
    </div>` : ""}
    ${state.customEngines.length ? `<div class="wstyle-section-head green">${icon("fa-puzzle-piece")} Custom User Engines</div><div class="mtab-card-grid">${state.customEngines.map((engine) => engineCard(engine, "Custom Engine Flow")).join("")}</div>` : ""}`;
}

function renderPersona(): string {
  const personalities = state.logic?.personalities || [];
  // V8 and V9 wipe the persona in the same way V7 does, so the picker is locked
  // for them too rather than offering a choice the engine discards.
  const mode = state.profile.mode;
  const isV9Mode = mode.startsWith("v9");
  const isV8Mode = mode.startsWith("v8");
  const locked = mode.startsWith("v7") || isV8Mode || isV9Mode || mode.includes("v6-dream-team");
  const lockedText = isV9Mode
    ? "The V9 engine carries its own authorial voice. Standard persona injections are disabled to prevent logic conflicts."
    : isV8Mode
      ? "The V8 engine carries its own authorial voice. Standard persona injections are disabled to prevent logic conflicts."
      : mode.startsWith("v7")
        ? "The V7 engine utilizes a pure narrative framework. Standard persona injections are disabled to prevent logic conflicts."
        : "The V6 Dream Team engine utilizes an intrinsic 6-specialist framework. Standard persona injections are disabled to prevent logic conflicts.";
  return `
    ${tabHeader("Persona & Toggles", "Set the narrator's voice and fine-tune engine behavior.", "fa-masks-theater", "#ec4899", locked ? "Locked" : state.profile.personality, "#ec4899", "fa-user")}
    ${locked ? lockedState("fa-user-lock", "Persona Selection Locked", lockedText) : `
      <div class="wstyle-section-head purple">${icon("fa-masks-theater")} Select Persona</div>
      <div class="mtab-card-grid">
        ${personalities.map((item: any) => infoCard({
          title: item.label,
          sub: personaDesc(item.id, item.content),
          active: state.profile.personality === item.id,
          action: "select",
          path: "personality",
          value: item.id,
          badge: item.recommended ? "Recommended" : ""
        })).join("")}
      </div>`}
    <div class="wstyle-section-head gold">${icon("fa-sliders")} Extra Toggles</div>
    <div class="mtab-card-list">
      ${(Object.entries(state.logic?.toggles || {}) as Array<[string, any]>).map(([key, toggle]) => toggleGeneric(toggle.label, `toggles.${key}`, !!state.profile.toggles[key], toggle.recommendedOff ? "Off by default - most engines handle this natively" : "")).join("")}
    </div>`;
}

function renderStyle(): string {
  if (state.styleEditorId) return renderStyleEditor();
  const directStyles = state.logic?.directStyles || [];
  const templates = state.logic?.styleTemplates || [];
  const filter = ["all", "precooked", "custom", "generators"].includes(state.styleFilter) ? state.styleFilter : "all";
  const isV7 = state.profile.mode.startsWith("v7");
  const isOff = !state.profile.activeStyleId && !state.profile.aiRule;
  const customStyles = state.profile.customStyles || [];
  const existingNames = customStyles.map((style) => style.name);
  const genTemplates = templates.filter((template: any) => !existingNames.includes(template.name));
  const activeName = state.profile.activeStyleId
    ? directStyles.find((item: any) => item.id === state.profile.activeStyleId)?.name || customStyles.find((item) => item.id === state.profile.activeStyleId)?.name || "Custom"
    : state.profile.aiRule ? "Custom Rule" : "No Style Active";
  return `
    <div class="wstyle-header">
      <div class="wstyle-header-left">
        <div class="wstyle-header-icon">${icon("fa-pen-nib")}</div>
        <div><h2>Writing Style</h2><p>Apply a prebuilt style, generate one with AI, or craft your own.</p></div>
      </div>
      <div class="wstyle-active-badge ${isOff ? "off" : ""}">${icon(isOff ? "fa-power-off" : "fa-circle-check")} ${escapeHtml(activeName)}</div>
    </div>
    ${!isV7 ? `<button type="button" class="wstyle-off-card ${isOff ? "active" : ""}" data-action="style-off">
      <span class="off-left"><span class="off-icon">${icon("fa-power-off")}</span><span><strong>No Style (Off)</strong><small>Let the engine decide &mdash; no extra style directives injected.</small></span></span>
      ${isOff ? `<span class="card-status active-status">${icon("fa-check")} Active</span>` : ""}
    </button>` : `<div class="wstyle-off-card locked-card"><span class="off-left"><span class="off-icon blue">${icon("fa-lock")}</span><span><strong>No Style (Off) - Locked</strong><small>V7 Engines require a narrative style directive. Defaulting to V7 Recommended.</small></span></span></div>`}
    ${presetFeatureWarning(["writing-style"])}
    <div id="dnr_mount" class="dnr-mount"></div>
    ${presetFeatureWarning(["dialogue-narration"])}
    <div class="wstyle-filters">
      ${stylePill("all", "All", directStyles.length + customStyles.length + genTemplates.length)}
      ${stylePill("precooked", "Precooked", directStyles.length, "fa-fire-burner")}
      ${stylePill("custom", "My Library", customStyles.length, "fa-book")}
      ${stylePill("generators", "AI Generators", genTemplates.length, "fa-wand-magic-sparkles")}
    </div>
    ${filter === "all" || filter === "precooked" ? `<div class="style-section"><div class="wstyle-section-head gold">${icon("fa-fire-burner")} Precooked Styles</div><div class="wstyle-list">${directStyles.map((style: any) => styleCard(style.name, style.desc, style.rule, state.profile.activeStyleId === style.id, "style-direct", style.id)).join("")}</div></div>` : ""}
    ${filter === "all" || filter === "custom" ? `<div class="style-section"><div class="wstyle-section-head green">${icon("fa-book")} My Library</div><div class="wstyle-list">${customStyles.map((style) => styleCardWithActions(style.name, style.notes || "Custom AI style.", style.rule, state.profile.activeStyleId === style.id, style.id)).join("")}<button type="button" class="wstyle-create-card" data-action="style-create">${icon("fa-plus")} Create Custom AI Style</button></div></div>` : ""}
    ${filter === "all" || filter === "generators" ? `<div class="style-section"><div class="wstyle-section-head purple">${icon("fa-wand-magic-sparkles")} AI Style Generators</div><div class="mtab-card-grid">${genTemplates.map((template: any, index: number) => `<button type="button" class="wstyle-gen-card" data-action="style-template" data-index="${index}"><span class="gen-info"><span class="gen-title">${escapeHtml(template.name)}</span><span class="gen-desc">${escapeHtml((template.notes || (template.tags || []).join(", ")).slice(0, 180))}</span></span><span class="wstyle-gen-btn">${icon("fa-bolt")} Generate</span></button>`).join("")}</div></div>` : ""}
    `;
}

function renderGlobalSettings(): string {
  const addons = state.logic?.addons || [];
  const activeMode = state.engines.find((engine) => engine.id === state.profile.mode) as any;
  const isV6 = !!activeMode && (String(activeMode.id).includes("v6") || String(activeMode.label).includes("V6"));
  const customSettings = Array.isArray(activeMode?.customToggles)
    ? activeMode.customToggles.filter((item: any) => item.location === "settings")
    : [];
  return `
    ${tabHeader("Global Settings", "Toggle add-ons, set output preferences, and configure extras.", "fa-puzzle-piece", "#3b82f6", `${state.profile.addons.length} Active`, "#3b82f6", "fa-toggle-on")}
    ${presetFeatureWarning(["global-settings", "gameplay-addons"])}
    <div class="wstyle-section-head blue">${icon("fa-puzzle-piece")} Gameplay Add-ons</div>
    <div class="mtab-card-grid">
      ${addons.map((item: any) => addonCard(item, isV6)).join("")}
      ${cinematicSoundsCard()}
    </div>
    ${customSettings.length ? `<div class="wstyle-section-head green" style="margin-top:16px;">${icon("fa-gear")} Custom Engine Settings</div><div class="mtab-card-list">${customSettings.map((item: any) => toggleGeneric(item.name, `toggles.${item.id}`, !!state.profile.toggles[item.id], `Custom Module -> [[${item.attachPoint}]]`)).join("")}</div>` : ""}
    <div class="wstyle-section-head blue" style="margin-top:16px;">${icon("fa-earth-americas")} Extra</div>
    <div class="mtab-panel">
      <div id="ps_toggle_prompt_preview" class="mtab-toggle-row ${state.profile.toggles.promptPreview ? "active" : ""}" data-action="toggle" data-path="toggles.promptPreview" style="margin-bottom: 16px;">
        <div class="toggle-info"><div class="toggle-label">${icon("fa-magnifying-glass")} Prompt Payload Preview</div><div class="toggle-desc">Show a popup of the final constructed prompt right before it is sent to the AI. only enable if you know what you doing it maybe buggy.</div></div>
        <div class="ps-switch"></div>
      </div>
      <div id="ps_toggle_utility_prefill" class="mtab-toggle-row ${state.profile.disableUtilityPrefill ? "active" : ""}" data-action="toggle" data-path="disableUtilityPrefill" style="margin-bottom: 16px;">
        <div class="toggle-info"><div class="toggle-label">Disable Utility Prefills</div><div class="toggle-desc">Turn this ON if your API (like Claude) errors out during Image Gen, Banlist, or Story Planner generation.</div></div>
        <div class="ps-switch"></div>
      </div>
      ${state.profile.mode.startsWith("v9") ? `
      <div class="wstyle-section-head blue">${icon("fa-ruler-horizontal")} V9 Response Length</div>
      <div class="mtab-setting-row">${settingText("Lean Reply", "Most turns. Words, min to max.")}
        <input type="number" class="ps-modern-input" data-bind="v9Limits.leanMin" style="width: 84px;" value="${escapeHtml(String(state.profile.v9Limits?.leanMin ?? 300))}" min="1" />
        <input type="number" class="ps-modern-input" data-bind="v9Limits.leanMax" style="width: 84px;" value="${escapeHtml(String(state.profile.v9Limits?.leanMax ?? 400))}" min="1" />
      </div>
      <div class="mtab-setting-row">${settingText("Full Reply", "When the scene earns it. Words, min to max.")}
        <input type="number" class="ps-modern-input" data-bind="v9Limits.fullMin" style="width: 84px;" value="${escapeHtml(String(state.profile.v9Limits?.fullMin ?? 700))}" min="1" />
        <input type="number" class="ps-modern-input" data-bind="v9Limits.fullMax" style="width: 84px;" value="${escapeHtml(String(state.profile.v9Limits?.fullMax ?? 1200))}" min="1" />
      </div>` : `
      <div class="mtab-setting-row">${settingText("Target Word Count", "Leave empty for no limit")}<input type="number" id="ps_input_wordcount" class="ps-modern-input" data-bind="userWordCount" style="width: 180px;" placeholder="e.g. 400" value="${escapeHtml(state.profile.userWordCount || "")}" min="1" /></div>`}
      <div class="mtab-setting-row">${settingText("Language Output", "Leave empty for default (English)")}<input type="text" id="ps_input_language" class="ps-modern-input" data-bind="userLanguage" style="width: 180px;" placeholder="e.g. Arabic, French..." value="${escapeHtml(state.profile.userLanguage || "")}" /></div>
      <div class="mtab-setting-row">${settingText("User Gender", "Ensure the AI addresses you correctly")}<select id="ps_select_pronouns" class="ps-modern-input" data-bind="userPronouns" style="width: 180px; cursor: pointer;">
        <option value="off" ${state.profile.userPronouns === "off" ? "selected" : ""}>Off</option>
        <option value="male" ${state.profile.userPronouns === "male" ? "selected" : ""}>Male (Him/He)</option>
        <option value="female" ${state.profile.userPronouns === "female" ? "selected" : ""}>Female (Her/She)</option>
      </select></div>
    </div>`;
}

// Empty text fields say so in the box itself, so nobody has to guess what blank means.
function fieldPlaceholder(f: StoryConfigField): string {
  return `${f.placeholder || ""} — leave empty for preset default`;
}

function renderStoryConfig(): string {
  const cfg = state.profile.storyConfig;
  const presets = allConfigPresets(state.profile.configPresets || []);

  let presetOpts = `<option value="">Load a config preset…</option>`;
  presetOpts += `<optgroup label="Built-in">`;
  presets.filter((p) => p.builtin).forEach((p) => { presetOpts += `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`; });
  presetOpts += `</optgroup>`;
  const savedPresets = presets.filter((p) => !p.builtin);
  if (savedPresets.length) {
    presetOpts += `<optgroup label="My Presets">`;
    savedPresets.forEach((p) => { presetOpts += `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`; });
    presetOpts += `</optgroup>`;
  }

  const summaryFor = (f: StoryConfigField, v: unknown): string => {
    const t = String(v || "").trim();
    if (t === "") return f.defaultLabel ? `Preset default — ${f.defaultLabel}` : "Preset default";
    // Show the option's short label rather than the long text the model reads.
    const match = (f.options || []).find((o) => typeof o !== "string" && o.value === t);
    return match && typeof match !== "string" ? match.label : t;
  };

  const fieldRow = (f: StoryConfigField): string => {
    const val = String(cfg[f.key] || "");
    const isOn = val.trim() !== "";
    const isOpen = state.openConfigRow === f.key;
    const path = `storyConfig.${f.key}`;

    let control = "";
    if (f.type === "select") {
      // An option is either a plain string, or { label, value } when the value the
      // model reads is longer than the words that belong in a dropdown.
      const opList = (f.options || []).map((o) => (typeof o === "string" ? { label: o, value: o } : o));
      const isCustom = isOn && !opList.some((o) => o.value === val);
      // Fields with a named default (friction: normal, npc_disposition: ordinary,
      // narrator_presence: light) name it here — picking it still drops the line,
      // because the preset already behaves that way.
      const defLabel = f.defaultLabel ? `Preset default — ${f.defaultLabel}` : `Preset default`;
      let opts = `<option value="" ${!isOn ? "selected" : ""}>${escapeHtml(defLabel)}</option>`;
      opList.forEach((o) => {
        opts += `<option value="${escapeHtml(o.value)}" ${val === o.value ? "selected" : ""}>${escapeHtml(o.label)}</option>`;
      });
      opts += `<option value="__custom" ${isCustom ? "selected" : ""}>Write my own…</option>`;

      control = `
        <select class="ps-modern-input cfg-select" data-action="config-select" data-path="${path}" style="width:100%; cursor:pointer;">${opts}</select>
        <input type="text" class="ps-modern-input cfg-custom" data-bind="${path}" style="width:100%; margin-top:8px; display:${isCustom ? "block" : "none"};" placeholder="${escapeHtml(f.customPlaceholder || "Write it your own way")}" value="${isCustom ? escapeHtml(val) : ""}" />`;
    } else if (f.type === "textarea") {
      control = `<textarea class="ps-modern-input" data-bind="${path}" rows="3" style="width:100%; resize:vertical;" placeholder="${escapeHtml(fieldPlaceholder(f))}">${escapeHtml(val)}</textarea>`;
    } else {
      control = `<input type="text" class="ps-modern-input" data-bind="${path}" style="width:100%;" placeholder="${escapeHtml(fieldPlaceholder(f))}" value="${escapeHtml(val)}" />`;
      if (f.chips && f.chips.length) {
        const parts = val.split(",").map((s) => s.trim()).filter(Boolean);
        const chips = f.chips.map((chip) => {
          const selected = parts.includes(chip);
          return `<span class="wstyle-tag cfg-chip ${selected ? "selected" : ""}" data-action="cfg-chip" data-path="${path}" data-value="${escapeHtml(chip)}">${escapeHtml(chip)}</span>`;
        }).join("");
        control += `<div class="cfg-chips">${chips}</div>`;
      }
    }

    return `
      <div class="cfg-row ${isOn ? "on" : ""} ${isOpen ? "open" : ""}" data-key="${escapeHtml(f.key)}">
        <div class="cfg-row-head" data-action="cfg-row" data-value="${escapeHtml(f.key)}">
          <span class="cfg-row-label">${icon(f.icon || "fa-circle")} ${escapeHtml(f.label)}</span>
          <span class="cfg-row-summary">${escapeHtml(summaryFor(f, val))}</span>
          <span class="cfg-row-chev">${icon("fa-chevron-down")}</span>
        </div>
        <div class="cfg-row-body">
          <div class="cfg-row-hint">${escapeHtml(f.hint || "")}</div>
          <div class="cfg-row-control">${control}</div>
        </div>
      </div>`;
  };

  return `
    <div class="ws-section" id="sec-config">
      <h3 style="margin-top: 0; color: var(--gold); font-size: 1.1rem; border-bottom: 1px solid var(--border-color); padding-bottom: 10px;">${icon("fa-sliders")} Story Config</h3>

      ${presetFeatureWarning(["story-config"])}

      <div class="cfg-master ${cfg.enabled ? "active" : ""}">
        <div>
          <div class="cfg-master-title">${icon("fa-scroll")} Inject Config Block</div>
          <div class="cfg-master-desc">Standing settings for the whole story. Anything left on preset default is left to your preset.</div>
        </div>
        <div class="ps-toggle-card ${cfg.enabled ? "active" : ""}" id="cfg_master_toggle" data-action="toggle" data-path="storyConfig.enabled" style="padding: 2px; min-width: 44px; background: transparent; border-color: ${cfg.enabled ? "#10b981" : "var(--border-color)"}; cursor: pointer; border-radius: 8px;">
          <div class="ps-switch" style="transform: scale(0.75); ${cfg.enabled ? "background: #10b981;" : ""}"></div>
        </div>
      </div>

      <div class="cfg-preset-bar">
        <select id="cfg_preset_select" class="ps-modern-input" style="flex: 1; min-width: 160px; cursor: pointer;">${presetOpts}</select>
        <button class="ws-btn-small" type="button" id="cfg_preset_load" data-action="cfg-preset-load">${icon("fa-download")} Load</button>
        <button class="ws-btn-small" type="button" id="cfg_preset_save" data-action="cfg-preset-save" style="color:#10b981; border-color: rgba(16,185,129,0.35);">${icon("fa-floppy-disk")} Save Current</button>
        <button class="ws-btn-small" type="button" id="cfg_preset_delete" data-action="cfg-preset-delete" style="color:#ef4444; border-color: rgba(239,68,68,0.3);">${icon("fa-trash")}</button>
        <button class="ws-btn-small" type="button" id="cfg_reset_all" data-action="cfg-reset-all" style="margin-left:auto;">${icon("fa-rotate-left")} Reset All</button>
      </div>

      <div class="cfg-fields ${cfg.enabled ? "" : "disabled"}">
        ${storyConfigFields.map(fieldRow).join("")}
      </div>
    </div>

    ${renderStyle()}`;
}

// The field list for a stat block, editable in place under its row.
function renderStatFieldEditor(def: BlockDef): string {
  const cfg = state.profile.statBlocks[def.id] || { fields: [] };
  const fields = cfg.fields || [];

  const rows = fields.map((f, i) => `
    <div class="stat-field">
      <input type="text" class="ps-modern-input sf-label" data-bind="statBlocks.${def.id}.fields.${i}.label" value="${escapeHtml(f.label)}" placeholder="Name" />
      <select class="ps-modern-input sf-type" data-bind="statBlocks.${def.id}.fields.${i}.type">
        ${STAT_FIELD_TYPES.map((t) => `<option value="${t.v}" ${f.type === t.v ? "selected" : ""} title="${escapeHtml(t.hint)}">${t.label}</option>`).join("")}
      </select>
      <input type="number" class="ps-modern-input sf-max" data-bind="statBlocks.${def.id}.fields.${i}.max" value="${f.max || 100}" title="Maximum" style="display:${f.type === "meter" ? "" : "none"};" />
      <input type="number" class="ps-modern-input sf-start" data-bind="statBlocks.${def.id}.fields.${i}.start" value="${f.start !== undefined ? f.start : 0}" title="Starting value" style="display:${f.type === "meter" || f.type === "number" ? "" : "none"};" />
      <button class="ws-btn-small sf-up" type="button" data-action="sf-up" data-block="${def.id}" data-index="${i}" ${i === 0 ? "disabled" : ""}>${icon("fa-arrow-up")}</button>
      <button class="ws-btn-small sf-del" type="button" data-action="sf-del" data-block="${def.id}" data-index="${i}" style="color:#ef4444;">${icon("fa-xmark")}</button>
    </div>`).join("");

  const packs = (STAT_FIELD_PACKS[def.id] || [])
    .map((pack) => `<button class="blk-add" type="button" data-action="sf-pack" data-block="${def.id}" data-value="${escapeHtml(pack.id)}">${icon("fa-box-open")} ${escapeHtml(pack.label)}</button>`)
    .join("");

  return `
    <div class="blk-sub blk-sub-fields">
      <div class="blk-sub-label" style="margin-bottom:2px;">Fields</div>
      <div class="blk-sub-desc" style="margin-bottom:8px;">What the AI is asked to track${def.id === "bonds" ? " for each NPC" : ""}. Every field costs tokens on every reply.</div>
      <div class="stat-field-list">${rows}</div>
      <div class="blk-pool" style="margin-top:8px;">
        <button class="blk-add" type="button" data-action="sf-add" data-block="${def.id}">${icon("fa-plus")} Add field</button>
        ${packs}
      </div>
    </div>`;
}

function renderBlocks(): string {
  const stack = state.profile.blockStack;
  const all = [...BLOCK_REGISTRY, ...(stack.custom || [])].filter((b) => !(b as BlockDef).system);
  const inStack = stack.order.map((id) => blockById(state.profile, id)).filter((b): b is BlockDef => Boolean(b) && !(b as BlockDef).system);
  const available = all.filter((b) => !stack.order.includes(b.id));

  const visOf = (b: BlockDef) => {
    const override = stack.overrides[b.id] as unknown as { visibility?: string } | string | undefined;
    if (override && typeof override === "object" && override.visibility) return override.visibility;
    return b.visibility || "open";
  };

  const stackRows = inStack.map((b, i) => {
    const off = typeof b.requires === "function" && !b.requires(state.profile);
    const custom = !b.builtin;
    let html = `
      <div class="blk-row ${off ? "blk-row-off" : ""}">
        <div class="blk-row-main">
          <span class="blk-emoji">${escapeHtml(b.emoji || "📦")}</span>
          <div>
            <div class="blk-name">${escapeHtml(b.label || (b as unknown as CustomBlock).name || b.id)}${custom ? ` <span class="blk-custom-flag">custom</span>` : ""}</div>
            <div class="blk-tag">&lt;${escapeHtml(b.tag)}&gt;${off ? " — its feature is switched off, so it is not sent" : ""}</div>
          </div>
        </div>
        <div class="blk-row-actions">
          <button class="ws-btn-small blk-up" type="button" data-action="blk-move" data-id="${escapeHtml(b.id)}" data-dir="-1" ${i === 0 ? "disabled" : ""}>${icon("fa-arrow-up")}</button>
          <button class="ws-btn-small blk-down" type="button" data-action="blk-move" data-id="${escapeHtml(b.id)}" data-dir="1" ${i === inStack.length - 1 ? "disabled" : ""}>${icon("fa-arrow-down")}</button>
          <select class="ps-modern-input blk-vis" data-action="blk-vis" data-id="${escapeHtml(b.id)}">
            ${BLOCK_VISIBILITY_CHOICES.map((o) => `<option value="${o.v}" ${(visOf(b) === "hidden" ? "hidden" : "open") === o.v ? "selected" : ""} title="${escapeHtml(o.hint)}">${o.label}</option>`).join("")}
          </select>
          ${b.builtin ? "" : `<button class="ws-btn-small blk-edit" type="button" data-action="blk-edit" data-id="${escapeHtml(b.id)}" style="color:var(--gold);">${icon("fa-pen")}</button>`}
          <button class="ws-btn-small blk-remove" type="button" data-action="blk-remove" data-id="${escapeHtml(b.id)}" style="color:#ef4444;">${icon("fa-xmark")}</button>
        </div>
      </div>`;

    // World State is the one block with a setting of its own: on most turns it can
    // send a shortened template and spend the full one only every few replies. It
    // rides under its own row because it is meaningless apart from this block.
    if (b.id === "world") {
      const ws = state.profile.worldState;
      html += `
        <div class="blk-sub">
          <div class="blk-sub-row">
            <div>
              <div class="blk-sub-label">Compact mode</div>
              <div class="blk-sub-desc">Sends a shorter World State on most turns to save tokens.</div>
            </div>
            <div class="ps-toggle-card ${ws.compactEnabled ? "active" : ""}" id="blk_compact_toggle" data-action="toggle" data-path="worldState.compactEnabled" style="padding:2px; min-width:40px; background:transparent; border-color:${ws.compactEnabled ? "#10b981" : "var(--border-color)"}; cursor:pointer; border-radius:8px;">
              <div class="ps-switch" style="transform: scale(0.7); ${ws.compactEnabled ? "background:#10b981;" : ""}"></div>
            </div>
          </div>
          <div class="blk-sub-row" id="blk_freq_row" style="display:${ws.compactEnabled ? "flex" : "none"};">
            <div>
              <div class="blk-sub-label">Full state every</div>
              <div class="blk-sub-desc">How often the complete template comes back.</div>
            </div>
            <div style="display:flex; align-items:center; gap:6px;">
              <input type="number" id="blk_full_freq" class="ps-modern-input" data-bind="worldState.fullFreq" min="1" value="${ws.fullFreq || 5}" style="width:60px; padding:4px; text-align:center; font-size:0.72rem;" />
              <span style="font-size:0.68rem; color:var(--text-muted);">replies</span>
            </div>
          </div>
        </div>`;
    }

    // Stat blocks are generated from a field list, so they get an editor for it.
    if (b.id === "bonds" || b.id === "sheet") html += renderStatFieldEditor(b);
    return html;
  }).join("");

  const pool = available
    .map((b) => `<button class="blk-add" type="button" data-action="blk-add" data-id="${escapeHtml(b.id)}"><span>${escapeHtml((b as BlockDef).emoji || "📦")}</span> ${escapeHtml((b as BlockDef).label || (b as unknown as CustomBlock).name || b.id)}</button>`)
    .join("");

  return `
    <div class="mtab-header">
      <div class="mtab-header-left">
        <div class="mtab-header-icon" style="background: linear-gradient(135deg, #f59e0b, #b45309);">${icon("fa-cubes")}</div>
        <div>
          <h2>Blocks</h2>
          <p>Everything in this list is sent as one master block at the end of the reply, and drawn in the chat as one collapsible card.</p>
        </div>
      </div>
      <div class="mtab-header-badge" style="background: rgba(245,158,11,0.12); color:#f59e0b; border:1px solid rgba(245,158,11,0.25);">
        ${icon("fa-layer-group")} ${inStack.length} in block
      </div>
    </div>

    ${presetFeatureWarning(["blocks-envelope"])}

    <div class="blk-layout">
      <div class="blk-col">
        <div class="wstyle-section-head gold">${icon("fa-list-ol")} Inside the master block</div>
        <div class="blk-stack">
          ${inStack.length ? stackRows : `<div class="blk-empty">Nothing here yet. Add a block from the right.</div>`}
        </div>

        <div class="wstyle-section-head green" style="margin-top:18px;">${icon("fa-plus")} Add a block</div>
        <div class="blk-pool">
          ${available.length ? pool : `<div class="blk-empty">Every block is already in.</div>`}
          <button class="blk-add blk-add-new" type="button" data-action="blk-new">${icon("fa-wand-magic-sparkles")} Create custom block</button>
        </div>
      </div>

      <div class="blk-col">
        <div class="wstyle-section-head purple">${icon("fa-eye")} Preview</div>
        <div class="blk-preview-note">This is the card the chat draws. Click a header to fold it.</div>
        <div class="blk-preview">${renderBlocksPreview()}</div>
      </div>
    </div>`;
}

/**
 * The preview card. The ST build renders this through the same code the chat
 * uses; this port has no chat renderer yet, so it draws the tags and bodies the
 * envelope would actually emit rather than inventing a different shape.
 */
function renderBlocksPreview(): string {
  const active = activeBlocks(state.profile);
  if (!active.length) return `<div class="blk-empty">Nothing in the block yet.</div>`;
  return active.map((b) => {
    const def = b as BlockDef;
    return `
      <div class="blk-preview-tab">
        <span class="blk-emoji">${escapeHtml(def.emoji || "📦")}</span>
        <span class="blk-name">${escapeHtml(def.label || (b as CustomBlock).name || b.id)}</span>
        <span class="blk-tag">&lt;${escapeHtml(b.tag)}&gt;</span>
      </div>`;
  }).join("");
}

function renderThinking(): string {
  const currentType = currentCotType();
  const currentLang = currentCotLang();
  const activeEngine = state.engines.find((engine) => engine.id === state.profile.mode) as any;
  return `
    ${tabHeader("Chain of Thought", "Configure the AI's thinking framework and reasoning depth.", "fa-brain", "#a855f7", "", "#a855f7")}
    ${activeEngine?.cot && String(activeEngine.cot).trim() ? `<div class="mtab-callout green" style="margin-bottom:20px;">${icon("fa-shield-halved")}<span><strong>Custom Engine Logic Active</strong> &mdash; This Engine provides its own [[COT]] and [[prefill]]. Selections below will be overridden by the Engine's code.</span></div>` : ""}
    ${presetFeatureWarning(["chain-of-thought"])}
    <div class="wstyle-section-head purple">${icon("fa-gauge-high")} Thinking Effort</div>
    <div class="mtab-callout purple">${icon("fa-circle-info")} <span><strong>Hint:</strong> When using V7 CoT, it is highly recommended to <strong>not</strong> use low Thinking Effort.</span></div>
    <div class="mtab-card-grid compact">
      ${[
        ["100", "100 Words"],
        ["250", "250 Words"],
        ["450", "450 Words"],
        ["custom", "Custom"],
        ["unspecified", "Unspecified"]
      ].map(([id, label]) => infoCard({ title: label, sub: "", active: state.profile.thinkEffort === normalizeEffort(id), action: "select", path: "thinkEffort", value: normalizeEffort(id) })).join("")}
    </div>
    ${state.profile.thinkEffort === "custom" ? `<div class="mtab-panel" style="margin-top:-10px; margin-bottom:20px;"><div class="mtab-setting-row"><div class="set-info"><div class="set-label">Custom Word Count</div></div><input type="number" id="ps_input_custom_effort" class="ps-modern-input" data-bind="customThinkEffort" style="width: 150px;" value="${escapeHtml(state.profile.customThinkEffort)}" min="1" /></div></div>` : ""}
    ${toggleGeneric(`${icon("fa-brain")} Gemini Thinking`, "thinkingV2", state.profile.thinkingV2, "Enable only for Gemini. When enabled, you MUST add <think> and </think> to the Reasoning Formatting prefix/suffix. Note: Enable Prefill ONLY if using Gemini models.", true)}
    <div class="wstyle-section-head purple">${icon("fa-diagram-project")} Thinking Framework</div>
    <div class="mtab-callout gold">${icon("fa-triangle-exclamation")} <span><strong>Important:</strong> When using GLM or DS4 models, you must disable "Main 3" and enable "Main 3 DS4 + GLM" in the Megumin Suite preset.</span></div>
    <div class="mtab-card-grid">
      ${cotFrameworks(currentType, currentLang).map((item) => infoCard({ title: item.label, sub: item.desc, active: currentType === item.id, action: "select", path: "model", value: item.value, badge: item.isNew ? "New" : "" })).join("")}
    </div>
    ${currentType !== "off" ? `<div class="wstyle-section-head gold">${icon("fa-language")} Language</div><div class="mtab-card-grid compact">${cotLanguages(currentType).map((item) => infoCard({ title: item.label, sub: "", active: currentLang === item.id, action: "select", path: "model", value: `cot-${currentType}-${item.id}`, badge: item.rec ? "Pro Tip" : "" })).join("")}</div>` : ""}`;
}

function renderStory(): string {
  const sp = state.profile.storyPlan;

  const genreOptions = Object.entries(SD_GENRES)
    .map(([id, g]) => `<option value="${id}" ${sp.primaryGenre === id ? "selected" : ""}>${escapeHtml(g.label)}</option>`)
    .join("");

  const flavorChips = SD_FLAVORS
    .map((f) => `<button type="button" class="sd-chip ${sp.flavorTags.includes(f) ? "active" : ""}" data-action="sd-flavor" data-value="${escapeHtml(f)}">${escapeHtml(f)}</button>`)
    .join("");

  return `
    <div class="mtab-header">
      <div class="mtab-header-left">
        <div class="mtab-header-icon" style="background: linear-gradient(135deg, #f59e0b, #d97706);">${icon("fa-clapperboard")}</div>
        <div>
          <h2>Story Director</h2>
          <p>Direct the narrative. Shape what happens next.</p>
        </div>
      </div>
      <div id="sd_header_badge" class="mtab-header-badge" style="background: ${sp.enabled ? "rgba(16,185,129,0.12)" : "rgba(255,255,255,0.06)"}; color: ${sp.enabled ? "#10b981" : "var(--text-muted)"}; border: 1px solid ${sp.enabled ? "rgba(16,185,129,0.25)" : "var(--border-color)"};">
        ${icon(sp.enabled ? "fa-circle-check" : "fa-circle-xmark")} ${sp.enabled ? "Enabled" : "Disabled"}
      </div>
    </div>

    ${presetFeatureWarning(["story-planner"])}

    <div class="mtab-toggle-row ${sp.enabled ? "active" : ""}" id="sd_enable_card" data-action="toggle" data-path="storyPlan.enabled" style="margin-bottom: 20px;">
      <div class="toggle-info">
        <div class="toggle-label">${icon("fa-clapperboard")} Enable Story Director</div>
        <div class="toggle-desc">Analyze your RP and generate narrative directives that steer the plot forward.</div>
      </div>
      <div class="ps-switch"></div>
    </div>

    <div id="sd_main_content" style="display: ${sp.enabled ? "block" : "none"};">

      <div class="mtab-panel">
        <div class="mtab-panel-title gold">${icon("fa-sliders")} Director's Console</div>

        <div class="sd-setting-group">
          <div class="sd-setting-label">Content Rating</div>
          <div class="sd-rating-pills">
            <button type="button" class="sd-pill ${sp.contentRating === "none" ? "active" : ""}" data-action="select" data-path="storyPlan.contentRating" data-value="none">${icon("fa-infinity")} No Limit</button>
            <button type="button" class="sd-pill ${sp.contentRating === "sfw" ? "active" : ""}" data-action="select" data-path="storyPlan.contentRating" data-value="sfw">${icon("fa-shield-halved")} SFW</button>
            <button type="button" class="sd-pill ${sp.contentRating === "nsfw" ? "active" : ""}" data-action="select" data-path="storyPlan.contentRating" data-value="nsfw">${icon("fa-fire")} NSFW</button>
          </div>
        </div>

        <div class="sd-setting-group">
          <div class="sd-setting-label">Pacing</div>
          <div class="sd-pacing-selector">
            <button type="button" class="sd-pacing-btn ${sp.pacing === "slowburn" ? "active" : ""}" data-action="select" data-path="storyPlan.pacing" data-value="slowburn">
              ${icon("fa-moon")}
              <span class="sd-pacing-name">Slow Burn</span>
              <span class="sd-pacing-desc">Character moments, no rush</span>
            </button>
            <button type="button" class="sd-pacing-btn ${sp.pacing === "natural" ? "active" : ""}" data-action="select" data-path="storyPlan.pacing" data-value="natural">
              ${icon("fa-wind")}
              <span class="sd-pacing-name">Natural</span>
              <span class="sd-pacing-desc">Organic flow, balanced</span>
            </button>
            <button type="button" class="sd-pacing-btn ${sp.pacing === "accelerate" ? "active" : ""}" data-action="select" data-path="storyPlan.pacing" data-value="accelerate">
              ${icon("fa-forward-fast")}
              <span class="sd-pacing-name">Accelerate</span>
              <span class="sd-pacing-desc">Push forward, big moves</span>
            </button>
          </div>
        </div>

        <div class="sd-setting-group">
          <div class="sd-setting-label">Primary Genre</div>
          <select id="sd_genre" class="ps-modern-input" data-bind="storyPlan.primaryGenre" style="width: 100%; cursor: pointer;">
            ${genreOptions}
          </select>
          <div class="sd-genre-desc" id="sd_genre_desc">${escapeHtml(SD_GENRES[sp.primaryGenre]?.desc || "")}</div>
        </div>

        <div class="sd-setting-group" style="margin-bottom: 0;">
          <div class="sd-setting-label">Flavor Tags <span class="sd-label-hint">(pick up to 3)</span></div>
          <div class="sd-chip-container" id="sd_flavor_chips">
            ${flavorChips}
          </div>
        </div>
      </div>

      <div class="mtab-toggle-row ${sp.unrestrictedContent ? "active" : ""}" id="sd_unrestricted_card" data-action="toggle" data-path="storyPlan.unrestrictedContent">
        <div class="toggle-info">
          <div class="toggle-label">${icon("fa-lock-open")} Unrestricted Content</div>
          <div class="toggle-desc">Inject a content policy override into the story context. Enables darker, more explicit narrative directions without AI refusals.</div>
        </div>
        <div class="ps-switch"></div>
      </div>

      <div class="mtab-panel">
        <div class="mtab-panel-title gold">${icon("fa-pen-fancy")} Director's Note</div>
        <div class="sd-directors-note-hint">
          ${icon("fa-lightbulb")}
          Tell the AI what you want to happen. It will weave your instruction into a long-term plot — not a hard cut. Leave empty to let the AI decide freely.
        </div>
        <textarea id="sd_directors_note" class="ps-modern-input sd-directors-note-input" data-bind="storyPlan.directorsNote" placeholder="e.g. &quot;I want the maid from my past to show up again&quot; or &quot;make the rival discover the secret&quot; or &quot;I want this NPC to betray me&quot;">${escapeHtml(sp.directorsNote || "")}</textarea>
      </div>

      <div class="mtab-panel">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; flex-wrap: wrap; gap: 8px;">
          <div class="mtab-panel-title gold" style="margin-bottom:0;">${icon("fa-scroll")} Current Directive</div>
          <div style="display: flex; gap: 8px;">
            <button id="sd_btn_generate" class="wstyle-gen-btn" type="button" data-action="story-generate" style="padding: 8px 18px; font-size: 0.78rem;">${icon("fa-bolt")} Generate Directive</button>
            <button id="sd_btn_evolve" class="wstyle-gen-btn" type="button" data-action="story-evolve" style="padding: 8px 18px; font-size: 0.78rem; background: rgba(139, 92, 246, 0.15); border-color: rgba(139, 92, 246, 0.3);" ${sp.currentPlan ? "" : "disabled"}>${icon("fa-arrows-rotate")} Evolve</button>
          </div>
        </div>
        <textarea id="sd_current_plan" class="ps-modern-input sd-directive-output" data-bind="storyPlan.currentPlan" placeholder="Your narrative directive will appear here after generation.">${escapeHtml(sp.currentPlan || "")}</textarea>
        <div class="mtab-callout">
          ${icon("fa-circle-info")}
          <span>This directive is injected via <code>[[storyplan]]</code>. A feedback tracker is appended via <code>[[storytracker]]</code>.</span>
        </div>
      </div>

      <div class="mtab-panel">
        <div class="mtab-panel-title gold">${icon("fa-gears")} Engine Settings</div>
        <div class="mtab-setting-row">
          <div class="set-info"><div class="set-label">Generation Backend</div></div>
          <select id="sd_backend" class="ps-modern-input" data-bind="storyPlan.backend" style="width: 220px; cursor: pointer;">
            ${presetBackendOptions("engine").map(([id, label]) => `<option value="${id}" ${sp.backend === id ? "selected" : ""}>${label}</option>`).join("")}
          </select>
        </div>
        <div class="mtab-setting-row">
          <div class="set-info">
            <div class="set-label">Context Limit</div>
            <div class="set-desc">How much chat history the Director reads to analyze the plot.</div>
          </div>
          <select id="sd_context_limit" class="ps-modern-input" data-bind="storyPlan.contextLimit" style="width: 220px; cursor: pointer;">
            <option value="100" ${sp.contextLimit === 100 ? "selected" : ""}>Last 100 Messages</option>
            <option value="0" ${sp.contextLimit === 0 ? "selected" : ""}>Full Chat History</option>
          </select>
        </div>
        <div class="mtab-setting-row">
          <div class="set-info">
            <div class="set-label">Auto-Trigger Mode</div>
            <div class="set-desc">When should the Director evolve the story?</div>
          </div>
          <div style="display:flex; gap:8px; align-items:center;">
            <select id="sd_trigger" class="ps-modern-input" data-bind="storyPlan.triggerMode" style="width: 170px; cursor: pointer;">
              <option value="manual" ${sp.triggerMode === "manual" ? "selected" : ""}>Manual Only</option>
              <option value="auto" ${sp.triggerMode === "auto" ? "selected" : ""}>Auto (Smart Status)</option>
              <option value="frequency" ${sp.triggerMode === "frequency" ? "selected" : ""}>Every X Replies (Safety Net)</option>
            </select>
            <input type="number" id="sd_freq" class="ps-modern-input" data-bind="storyPlan.autoFreq" value="${sp.autoFreq}" min="1" style="width: 60px; text-align: center; display: ${sp.triggerMode === "frequency" ? "block" : "none"};" title="Fallback safety net interval" />
          </div>
        </div>
      </div>
    </div>`;
}

function renderBanList(): string {
  const banList = state.profile.banList || [];

  const tags = banList.length
    ? banList.map((phrase) => `
        <div class="mtab-ban-item" data-action="ban-remove" data-value="${escapeHtml(phrase)}">
          <span style="padding-right: 15px;">${escapeHtml(phrase)}</span>
          ${icon("fa-xmark")}
        </div>`).join("")
    : `<span style="color: var(--text-muted); font-size: 0.8rem; font-style: italic;">No phrases banned yet.</span>`;

  return `
    ${tabHeader("Dynamic Ban List", "Detect and ban overused phrases from AI responses.", "fa-ban", "#ef4444", `${banList.length} Banned`, "#ef4444", "fa-ban")}
    ${presetFeatureWarning(["dynamic-ban-list"])}

    <div class="mtab-panel" style="margin-bottom:16px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
        <div class="mtab-panel-title purple" style="margin-bottom:0;">${icon("fa-radar")} AI Slop Detector</div>
        <button id="ps_btn_scan_slop" class="wstyle-gen-btn" type="button" data-action="ban-analyze" style="padding: 8px 18px; font-size: 0.78rem; background: linear-gradient(135deg, #a855f7, #7c3aed);">${icon("fa-radar")} Analyze Chat</button>
      </div>
      <div class="mtab-setting-row">
        <div class="set-info">
          <div class="set-label">Generator Backend</div>
          <div class="set-desc">Choose how to generate the analysis.</div>
        </div>
        <select id="ban_list_backend" class="ps-modern-input" data-bind="banListBackend" style="width: 200px; cursor: pointer;">
          ${presetBackendOptions("engine").map(([id, label]) => `<option value="${id}" ${state.profile.banListBackend === id ? "selected" : ""}>${label}</option>`).join("")}
        </select>
      </div>
    </div>

    <div class="mtab-panel" style="margin-bottom:16px;">
      <div class="mtab-panel-title red">${icon("fa-plus-circle")} Add Phrase</div>
      <div style="display: flex; gap: 10px;">
        <input type="text" id="ps_manual_ban_input" class="ps-modern-input" placeholder="Manually add a phrase to ban…" style="flex: 1;" />
        <button id="ps_btn_add_ban" class="ps-modern-btn secondary" type="button" data-action="ban-add" style="padding: 0 15px;">Add</button>
      </div>
    </div>

    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
      <div class="wstyle-section-head red" style="margin-bottom:0;">${icon("fa-list")} Active Banned Phrases</div>
      <div class="mtab-btn-row">
        <input type="file" id="ps_import_bans_file" accept=".json" style="display: none;">
        <button id="ps_btn_import_bans" class="ps-modern-btn secondary" type="button" data-action="ban-import" style="padding: 4px 10px; font-size: 0.72rem; color: #3b82f6; border-color: rgba(59, 130, 246, 0.3);">${icon("fa-file-import")} Import</button>
        <button id="ps_btn_export_bans" class="ps-modern-btn secondary" type="button" data-action="ban-export" style="padding: 4px 10px; font-size: 0.72rem; color: #10b981; border-color: rgba(16, 185, 129, 0.3);">${icon("fa-file-export")} Export</button>
        <button id="ps_btn_clear_bans" class="ps-modern-btn secondary" type="button" data-action="ban-clear" style="padding: 4px 10px; font-size: 0.72rem; color: #ef4444; border-color: rgba(239, 68, 68, 0.3);">${icon("fa-trash-can")} Clear All</button>
      </div>
    </div>
    <div id="ps_banlist_container" class="mtab-card-list" style="min-height: 50px; padding: 10px; border: 1px dashed var(--border-color); border-radius: 10px; margin-bottom: 16px;">${tags}</div>

    <div class="mtab-callout purple" style="margin-top: 16px;">
      ${icon("fa-circle-info")}
      <span>This is a beta feature. Don't complain if you have to generate more than once.</span>
    </div>`;
}

function renderImage(): string {
  const ig = state.profile.imageGen;
  const modelOptions: Array<[string, string]> = ig.selectedModel ? [["", "Loading Models..."], [ig.selectedModel, ig.selectedModel]] : [["", "Loading Models..."]];
  const samplerOptions: Array<[string, string]> = ig.selectedSampler ? [["", "Loading Samplers..."], [ig.selectedSampler, ig.selectedSampler]] : [["", "Loading Samplers..."]];
  return `
    ${tabHeader("Image Generation", "ComfyUI integration for automatic scene rendering.", "fa-image", "#06b6d4", ig.enabled ? "Enabled" : "Disabled", ig.enabled ? "#10b981" : "#a1a1aa", ig.enabled ? "fa-circle-check" : "fa-circle-xmark")}
    ${presetFeatureWarning(["image-generation"])}
    <div class="mtab-toggle-row ${ig.enabled ? "active" : ""}" id="ig_enable_card" data-action="toggle" data-path="imageGen.enabled" style="margin-bottom: 20px;">
      <div class="toggle-info"><div class="toggle-label">${icon("fa-image")} Enable Image Generation</div><div class="toggle-desc">Activate ComfyUI integration for this specific character/group.</div></div>
      <div class="ps-switch"></div>
    </div>
    <div class="mtab-panel" style="margin-bottom:16px;">
      <div class="mtab-panel-title blue">${icon("fa-gears")} Prompt Generator Backend</div>
      <div class="mtab-setting-row">${settingText("Generation Method", "\"Direct\" is faster. \"Megumin Image\" is more creative.")}<select id="img_gen_backend" class="ps-modern-input" data-bind="imageGen.generatorBackend" style="width: 220px; cursor: pointer;">${presetBackendOptions("image").map(([id, label]) => `<option value="${id}" ${ig.generatorBackend === id ? "selected" : ""}>${label}</option>`).join("")}</select></div>
    </div>
    <div id="ig_main_content" style="display:${ig.enabled ? "block" : "none"};">
    <div class="mtab-panel" style="margin-bottom:16px;">
      <div class="mtab-panel-title blue">${icon("fa-link")} ComfyUI Server & Workflow</div>
      <div style="display: flex; gap: 10px; margin-bottom: 15px;">
        <input type="text" id="ig_url" class="ps-modern-input" data-bind="imageGen.comfyUrl" value="${escapeHtml(ig.comfyUrl)}" placeholder="http://127.0.0.1:8188" style="flex: 1;" />
        <button id="ig_test_btn" class="ps-modern-btn secondary" style="padding: 0 15px;" type="button" data-action="image-test">${icon("fa-wifi")} Test</button>
      </div>
      <div style="display: flex; gap: 10px; align-items: center;">
        <select id="ig_workflow_list" class="ps-modern-input" data-bind="imageGen.currentWorkflowName" style="flex: 1; cursor: pointer;"><option value="">Default Lumiverse Workflow</option>${ig.currentWorkflowName ? `<option value="${escapeHtml(ig.currentWorkflowName)}" selected>${escapeHtml(ig.currentWorkflowName)}</option>` : ""}</select>
        <button id="ig_new_wf" class="ps-modern-btn secondary" title="New Workflow" type="button" style="display:none;" aria-hidden="true" tabindex="-1">${icon("fa-plus")}</button>
        <button id="ig_edit_wf" class="ps-modern-btn secondary" title="Edit JSON" type="button" style="display:none;" aria-hidden="true" tabindex="-1">${icon("fa-pen")}</button>
        <button id="ig_format_wf" class="ps-modern-btn secondary" title="Format JSON" type="button" style="display:none;" aria-hidden="true" tabindex="-1">${icon("fa-align-left")}</button>
        <button id="ig_del_wf" class="ps-modern-btn secondary danger" title="Delete" type="button" style="display:none;" aria-hidden="true" tabindex="-1">${icon("fa-trash-can")}</button>
      </div>
    </div>
    <div class="mtab-panel" style="margin-bottom:16px;">
      <div class="mtab-panel-title gold">${icon("fa-pen-nib")} Triggers & Formatting</div>
      <div style="display: flex; gap: 15px; margin-bottom: 15px;">
        <div style="flex: 2;"><div class="mini-label">Trigger Mode</div><select id="ig_trigger_mode" class="ps-modern-input" data-bind="imageGen.triggerMode" style="padding: 8px; font-size: 0.8rem; cursor: pointer;"><option value="always" ${ig.triggerMode === "always" ? "selected" : ""}>Always (Every Reply)</option><option value="frequency" ${ig.triggerMode === "frequency" ? "selected" : ""}>After X Replies</option><option value="conditional" ${ig.triggerMode === "conditional" ? "selected" : ""}>Only when character sends a pic</option><option value="manual" ${ig.triggerMode === "manual" ? "selected" : ""}>Manual Button Only</option></select></div>
        <div style="flex: 1; display:${ig.triggerMode === "frequency" ? "block" : "none"};" id="ig_freq_container"><div class="mini-label">Every X Replies</div><input type="number" id="ig_auto_freq" class="ps-modern-input" data-bind="imageGen.autoGenFreq" value="${ig.autoGenFreq}" min="1" style="padding: 8px; font-size: 0.8rem; text-align: center;" /></div>
      </div>
      <div class="mtab-toggle-row ${ig.previewPrompt ? "active" : ""}" id="ig_preview_card" data-action="toggle" data-path="imageGen.previewPrompt" style="padding: 12px 18px; margin-bottom: 15px;"><div class="toggle-info"><div class="toggle-label" style="font-size:0.85rem;">Preview Prompt Before Sending</div><div class="toggle-desc">Show a popup to view or edit the AI's prompt before rendering.</div></div><div class="ps-switch"></div></div>
      <div id="ig_prompt_builder" style="background: rgba(0,0,0,0.15); padding: 15px; border-radius: 10px; border-left: 3px solid var(--gold);">
        <div style="display: flex; gap: 15px; margin-bottom: 10px;">
          <div style="flex:1;"><div class="mini-label">Model Style Format</div><select id="ig_style" class="ps-modern-input" data-bind="imageGen.promptStyle" style="padding: 8px; font-size: 0.8rem;"><option value="standard" ${ig.promptStyle === "standard" ? "selected" : ""}>Standard (Descriptive)</option><option value="illustrious" ${ig.promptStyle === "illustrious" ? "selected" : ""}>Illustrious/Pony (Tags)</option><option value="sdxl" ${ig.promptStyle === "sdxl" ? "selected" : ""}>SDXL (Natural Prose)</option></select></div>
          <div style="flex:1;"><div class="mini-label">Camera Perspective</div><select id="ig_persp" class="ps-modern-input" data-bind="imageGen.promptPerspective" style="padding: 8px; font-size: 0.8rem;"><option value="scene" ${ig.promptPerspective === "scene" ? "selected" : ""}>Cinematic Scene</option><option value="pov" ${ig.promptPerspective === "pov" ? "selected" : ""}>First Person (POV)</option><option value="character" ${ig.promptPerspective === "character" ? "selected" : ""}>Character Portrait</option></select></div>
        </div>
        <input type="text" id="ig_extra" class="ps-modern-input" data-bind="imageGen.promptExtra" placeholder="Extra Instructions (e.g. moody lighting, dark atmosphere...)" value="${escapeHtml(ig.promptExtra)}" style="padding: 8px; font-size: 0.8rem;" />
        <div style="display:flex; gap:15px; margin-top:10px;">
          <div style="flex:1;"><div class="mini-label">Images Per Response</div><input type="number" class="ps-modern-input" data-bind="imageGen.imageCount" value="${ig.imageCount}" min="1" max="4" style="padding:8px; font-size:0.8rem;" /></div>
        </div>
        <div class="mtab-callout" style="margin-top:12px;">${icon("fa-circle-info")}<span>Style and perspective together pick the prompt template — six are shipped, one per Illustrious/SDXL × POV/Cinematic/Portrait pairing.</span></div>
      </div>
      ${toggleGeneric(`${icon("fa-list-ol")} Include Worked Examples`, "imageGen.includeExamples", ig.includeExamples, "Ships the template's example prompts alongside its rules. Costs tokens; markedly improves format adherence.", true)}
      ${toggleGeneric(`${icon("fa-align-left")} Direct Language`, "imageGen.directLanguage", ig.directLanguage, "Exact Booru tags with the explicit tag reference, instead of euphemisms. For NSFW scenes.", true)}
      ${toggleGeneric(`${icon("fa-address-book")} Inject NPC Tags`, "imageGen.injectNpcTags", ig.injectNpcTags, "Send stored appearance tags for NPC Bank characters the recent scene mentions, so they are drawn consistently.", true)}
    </div>
    <div class="mtab-panel" style="margin-bottom:16px;">
      <div class="panel-heading-row">
        <div class="mtab-panel-title blue">${icon("fa-image")} Manual Generation</div>
        <button id="ig_btn_manual" class="wstyle-gen-btn" type="button" data-action="image-manual">${icon("fa-bolt")} Generate Image</button>
      </div>
      <textarea id="meg-manual-image-prompt" class="ps-modern-input" placeholder="Leave blank to generate a prompt from the current chat."></textarea>
    </div>
    <div class="mtab-panel" style="margin-bottom:16px;">
      <div class="mtab-panel-title gold">${icon("fa-sliders")} Image Parameters</div>
      <div style="display: flex; gap: 10px; margin-bottom: 15px;">
        <select id="ig_model" class="ps-modern-input" data-bind="imageGen.selectedModel" style="flex: 2;">${modelOptions.map(([id, label]) => `<option value="${escapeHtml(id)}" ${ig.selectedModel === id ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select>
        <select id="ig_sampler" class="ps-modern-input" data-bind="imageGen.selectedSampler" style="flex: 1;">${samplerOptions.map(([id, label]) => `<option value="${escapeHtml(id)}" ${ig.selectedSampler === id ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select>
      </div>
      <div class="ig-param-grid">
        ${sliderPair("steps", "Steps", "imageGen.steps", ig.steps, 1, 100, 1)}
        ${sliderPair("cfg", "CFG", "imageGen.cfg", ig.cfg, 1, 30, 0.5)}
        ${sliderPair("denoise", "Denoise", "imageGen.denoise", ig.denoise, 0, 1, 0.05)}
        ${sliderPair("clip", "CLIP", "imageGen.clipSkip", ig.clipSkip, 1, 12, 1)}
      </div>
      <div style="display: flex; gap: 10px; margin-bottom: 15px;"><div style="flex:2;"><div class="mini-label">Resolution Preset</div><select id="ig_res_preset" class="ps-modern-input" style="padding: 8px; font-size: 0.8rem;"><option value="">-- Select Preset --</option>${RESOLUTIONS.map((res, index) => `<option value="${index}" ${ig.imgWidth === res.w && ig.imgHeight === res.h ? "selected" : ""}>${escapeHtml(res.label)}</option>`).join("")}</select></div><div style="flex:1; display:flex; align-items:flex-end; gap:5px;"><input type="number" id="ig_w" class="ps-modern-input" data-bind="imageGen.imgWidth" value="${ig.imgWidth}" placeholder="W" style="padding:8px;text-align:center;font-size:.8rem;" /><span style="color: var(--text-muted); padding-bottom: 8px;">x</span><input type="number" id="ig_h" class="ps-modern-input" data-bind="imageGen.imgHeight" value="${ig.imgHeight}" placeholder="H" style="padding:8px;text-align:center;font-size:.8rem;" /></div></div>
      <div style="display: flex; gap: 10px;"><div style="flex:1;"><div class="mini-label">Seed (-1 for random)</div><input type="number" id="ig_seed" class="ps-modern-input" data-bind="imageGen.customSeed" value="${ig.customSeed}" style="padding: 8px; font-size: 0.8rem;" /></div><div style="flex:2;"><div class="mini-label">Negative Prompt Override</div><input type="text" id="ig_neg" class="ps-modern-input" data-bind="imageGen.customNegative" value="${escapeHtml(ig.customNegative)}" style="padding: 8px; font-size: 0.8rem;" /></div></div>
    </div>
    <div class="mtab-panel">
      <div class="mtab-panel-title gold">${icon("fa-align-left")} Prompt Prefix</div>
      <input type="text" id="ig_prefix" class="ps-modern-input" data-bind="imageGen.promptPrefix" value="${escapeHtml(ig.promptPrefix || "")}" placeholder="e.g. score_9, score_8_up, masterpiece..." style="padding: 8px; font-size: 0.8rem;" />
      <div class="mtab-callout">${icon("fa-circle-info")}<span>Prepended ahead of everything else, including the LoRA trigger words.</span></div>
    </div>
    <div class="mtab-panel">
      <div class="mtab-panel-title purple">${icon("fa-flask")} LoRA Lab</div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">${[1, 2, 3, 4].map((slot) => loraSlot(slot)).join("")}</div>
      <div class="mtab-callout purple">${icon("fa-circle-info")}<span>Trigger words are added to the prompt automatically whenever that slot has a LoRA selected. Many LoRAs do nothing without them.</span></div>
    </div>
    <details class="mtab-panel">
      <summary class="mtab-panel-title blue">${icon("fa-code")} ComfyUI Field Placeholders</summary>
      <div class="placeholder-grid">${KAZUMA_PLACEHOLDERS.map((item) => `<div><code>${escapeHtml(item.key)}</code><span>${escapeHtml(item.desc)}</span></div>`).join("")}</div>
    </details>
    </div>`;
}

function renderNpc(): string {
  const bank = state.profile.npcBank;
  return `
    ${tabHeader("NPCs Bank", "Automatically extract and track significant NPCs in the story.", "fa-address-book", "#f43f5e", bank.enabled ? "Enabled" : "Disabled", bank.enabled ? "#10b981" : "#a1a1aa", bank.enabled ? "fa-circle-check" : "fa-circle-xmark")}
    ${presetFeatureWarning(["npc-bank"])}
    <div class="mtab-panel">
      <div id="npc_enable_card" class="mtab-toggle-row ${bank.enabled ? "active" : ""}" data-action="toggle" data-path="npcBank.enabled" style="margin-bottom: 10px;"><div class="toggle-info"><div class="toggle-label">${icon("fa-users")} Enable NPC Bank</div><div class="toggle-desc">When enabled, the AI generates detailed dossiers for new NPCs, which are saved here and injected when relevant.</div></div><div class="ps-switch"></div></div>
      <div id="npc_send_portraits" class="mtab-toggle-row ${bank.sendPortraitsToAi ? "active" : ""}" data-action="toggle" data-path="npcBank.sendPortraitsToAi"><div class="toggle-info"><div class="toggle-label">${icon("fa-image")} Send Portraits to AI</div><div class="toggle-desc">If an injected NPC has a portrait, send the image to the AI to help it visualize the character.</div></div><div class="ps-switch"></div></div>
    </div>
    <div id="npc_main_content" style="display:${bank.enabled ? "block" : "none"};">
    <div class="npc-heading"><div>${icon("fa-address-card")} Saved NPCs <span id="npc_count">(${bank.npcs.length})</span></div><button id="npc_btn_clear_all" class="ps-modern-btn secondary danger mini" type="button" data-action="npc-clear">${icon("fa-trash-can")} Clear All</button></div>
    ${bank.npcs.length ? `<div id="npc_bank_list" class="npc-list">${[...bank.npcs].reverse().map(renderNpcCard).join("")}</div>` : `<div id="npc_bank_list" class="npc-empty">No NPCs saved yet. The AI will add them automatically when significant NPCs are introduced.</div>`}
    </div>`;
}

function renderNpcCard(npc: any): string {
  const pfp = npc.pfpImageUrl || npc.pfp || "";
  const isMale = String(npc.sex || "").trim().toLowerCase().startsWith("m");
  const accent = isMale ? "#3b82f6" : "#f43f5e";
  const accentRgb = isMale ? "59,130,246" : "244,63,94";
  const date = new Date(npc.timestamp || Date.now()).toLocaleDateString();
  const fields = [
    ["appearance", "Appearance", "fa-eye", "#a78bfa"],
    ["occupation", "Occupation", "fa-briefcase", "#60a5fa"],
    ["background", "Background", "fa-book", "#34d399"],
    ["innerCircle", "Inner Circle", "fa-people-group", "#fbbf24"],
    ["personality", "Personality", "fa-masks-theater", "#f472b6"],
    ["agenda", "Current Agenda", "fa-bullseye", "#fb923c"],
    ["hiddenLayer", "Hidden Layer", "fa-eye-slash", "#ef4444"]
  ];
  return `
    <details class="npc-card" data-npc-name="${escapeHtml(npc.name || "")}" style="--npc-accent:${accent};--npc-rgb:${accentRgb};">
      <summary class="npc-card-header">
        <span class="npc-title-left">${icon("fa-chevron-right")} ${pfp ? `<img class="npc-mini-pfp" src="${escapeHtml(pfp)}" alt="">` : ""}<strong>${escapeHtml(npc.name || "Unknown NPC")}</strong><small>${escapeHtml(npc.age || "?")} &middot; ${escapeHtml(npc.sex || "?")}</small></span>
        <span class="npc-title-right"><small>${icon("fa-clock")} ${escapeHtml(date)}</small><button class="icon-btn danger" type="button" data-action="npc-remove" data-name="${escapeHtml(npc.name)}">${icon("fa-trash")}</button></span>
      </summary>
      <div class="npc-card-body">
        <div class="npc-pfp-column">
          <div class="npc-pfp-container">${pfp ? `<img src="${escapeHtml(pfp)}" alt="">` : `<span>${icon("fa-user-secret")}</span>`}</div>
          <div class="npc-pfp-name">${escapeHtml(npc.name || "Unknown NPC")}</div>
          <button class="npc-pfp-btn upload" type="button" data-action="npc-upload" data-name="${escapeHtml(npc.name)}">${icon("fa-upload")} Upload</button>
          <button class="npc-pfp-btn generate" type="button" data-action="npc-portrait" data-name="${escapeHtml(npc.name)}">${icon("fa-wand-magic-sparkles")} Generate</button>
        </div>
        <div class="npc-fields">
          ${fields.map(([key, label, fieldIcon, color]) => npcField(key, label, fieldIcon, color, npc[key])).join("")}
        </div>
      </div>
    </details>`;
}

function renderSettings(): string {
  const p = state.profile;
  return `
    <div class="mtab-header">
      <div class="mtab-header-left">
        <div class="mtab-header-icon" style="background: linear-gradient(135deg, #64748b, #475569);">${icon("fa-gear")}</div>
        <div>
          <h2>Global Settings</h2>
          <p>Extension preferences and about info.</p>
        </div>
      </div>
    </div>

    <div style="display:flex; flex-direction:column; gap:16px;">

      <div class="mtab-toggle-row ${p.toggles.promptPreview ? "active" : ""}" id="gs_toggle_prompt_preview" data-action="toggle" data-path="toggles.promptPreview" style="cursor: pointer;">
        <div class="toggle-info">
          <div class="toggle-label">${icon("fa-magnifying-glass")} Prompt Payload Preview</div>
          <div class="toggle-desc">Show a popup of the final constructed prompt right before it is sent to the AI.</div>
        </div>
        <div class="ps-switch" style="${p.toggles.promptPreview ? "background: var(--gold);" : ""}"></div>
      </div>

      <div class="mtab-toggle-row ${p.disableUtilityPrefill ? "active" : ""}" id="gs_toggle_utility_prefill" data-action="toggle" data-path="disableUtilityPrefill" style="cursor: pointer;">
        <div class="toggle-info">
          <div class="toggle-label">${icon("fa-ban")} Disable Utility Prefills</div>
          <div class="toggle-desc">Turn this ON if your API (like Claude) errors out during Image Gen, Banlist, or Story Director generation.</div>
        </div>
        <div class="ps-switch" style="${p.disableUtilityPrefill ? "background: #ef4444;" : ""}"></div>
      </div>

      <div class="mtab-panel" style="margin-top: 15px; text-align: center;">
        <div style="font-size: 1.5rem; font-weight: 900; color: var(--gold); margin-bottom: 4px; text-shadow: 0 2px 10px rgba(245,158,11,0.3);">Megumin Suite v9</div>
        <div style="font-size: 0.85rem; color: var(--text-muted); font-weight: 600;">Made by KazumaONIISAN</div>

        <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 15px; align-items: center;">
          <a href="https://github.com/Arif-salah/Megumin-Suite" target="_blank" rel="noreferrer" style="color: var(--text-main); text-decoration: none; font-size: 0.8rem; background: rgba(255,255,255,0.05); padding: 8px 16px; border-radius: 8px; border: 1px solid var(--border-color); display: flex; align-items: center; gap: 8px; transition: background 0.2s ease; cursor: pointer;">
            ${icon("fa-code-branch")} GitHub Repository
          </a>
          <div style="color: var(--text-main); font-size: 0.8rem; background: rgba(59, 130, 246, 0.1); padding: 8px 16px; border-radius: 8px; border: 1px solid rgba(59, 130, 246, 0.3); display: flex; align-items: center; gap: 8px;">
            ${icon("fa-link")} arifsalah10@gmail.com
          </div>
          <div style="color: var(--text-main); font-size: 0.75rem; background: rgba(161, 161, 170, 0.1); padding: 8px 16px; border-radius: 8px; border: 1px solid rgba(161, 161, 170, 0.3); display: flex; align-items: center; gap: 8px; word-break: break-all; max-width: 90%; text-align: left;">
            ${icon("fa-coins")} LTC: LSjf1DczHxs3GEbkoMmi1UWH2GikmXDtis
          </div>
        </div>

        <div style="font-size: 0.7rem; color: #a855f7; margin-top: 15px; background: rgba(168,85,247,0.1); display: inline-block; padding: 4px 12px; border-radius: 12px; border: 1px solid rgba(168,85,247,0.3);">
          ${icon("fa-earth-americas")} These settings are saved globally
        </div>
      </div>
    </div>`;
}

function renderDev(): string {
  const coreEngines = state.engines.filter((engine) => !state.customEngines.some((custom) => custom.id === engine.id));
  if (!state.devEditorId) {
    return `
      ${tabHeader("Dev Engine Builder", "Design your own chronological AI logic flow. Clone an existing template or start from scratch.", "fa-code", "#a855f7", `${state.customEngines.length} Custom`, "#a855f7", "fa-code")}
      <div class="dev-top-actions">
        <button id="dev_btn_new" class="ps-modern-btn primary" type="button" data-action="dev-new">${icon("fa-wand-magic-sparkles")} Create Blank Engine</button>
        <button id="dev_btn_import" class="ps-modern-btn secondary" type="button" data-action="dev-import">${icon("fa-file-import")} Import Engine (JSON)</button>
        <input id="dev_import_file" type="file" accept=".json" style="display:none;">
      </div>
      <div class="ps-rule-title gold">${icon("fa-cube")} Core Templates (Clone)</div>
      <div class="ps-grid">
        ${coreEngines.map((engine) => `<div class="ps-card"><div><div class="ps-card-title">${escapeHtml(engine.label || engine.id)}</div><div class="ps-card-desc">System Default Engine</div></div><button class="ps-modern-btn secondary dev-clone" type="button" data-action="dev-clone" data-id="${escapeHtml(engine.id)}">${icon("fa-copy")} Clone & Edit</button></div>`).join("")}
      </div>
      <div class="ps-rule-title green">${icon("fa-microchip")} Your Custom Engines</div>
      ${state.customEngines.length ? `<div class="ps-grid">${state.customEngines.map((engine) => `<div class="ps-card custom"><div><div class="ps-card-title green">${escapeHtml(engine.label || engine.id)}</div><div class="ps-card-desc">Custom User Logic Flow</div></div><div class="dev-card-actions"><button class="ps-modern-btn secondary" title="Export" type="button" data-action="dev-export" data-id="${escapeHtml(engine.id)}">${icon("fa-download")}</button><button class="ps-modern-btn primary gold-fill" type="button" data-action="dev-edit" data-id="${escapeHtml(engine.id)}">${icon("fa-pen")} Edit</button><button class="ps-modern-btn secondary danger" title="Delete" type="button" data-action="dev-delete" data-id="${escapeHtml(engine.id)}">${icon("fa-trash")}</button></div></div>`).join("")}</div>` : `<div class="dev-empty">No custom engines yet. Create or import one above!</div>`}`;
  }
  const source = resolveDevEngineSource(state.devEditorId);
  const modeData = source.mode;
  const isCoreClone = source.kind === "core";
  const modeId = source.kind === "new" ? `custom_${Date.now()}` : isCoreClone ? `custom_${Date.now()}` : modeData.id;
  const modeLabel = source.kind === "new" ? "New Custom Engine" : isCoreClone ? `${modeData.label || "Core Engine"} (Copy)` : modeData.label || "Custom Engine";
  return `
    ${tabHeader("Dev Engine Builder", "Clone, edit, and save custom Megumin engine blocks.", "fa-code", "#a855f7", `${state.customEngines.length} Custom`, "#a855f7", "fa-code")}
    <div class="mtab-panel">
      <div class="dev-editor-toolbar">
        <button id="dev_back_list" class="ps-modern-btn secondary" type="button" data-action="dev-back">${icon("fa-arrow-left")} Back</button>
        <input type="text" id="dev_mode_name" class="ps-modern-input" value="${escapeHtml(modeLabel)}" />
        <input type="hidden" id="dev_mode_id" value="${escapeHtml(modeId)}">
        <button id="dev_save_mode" class="ps-modern-btn primary" type="button" data-action="dev-save">${icon("fa-floppy-disk")} Save Engine</button>
      </div>
      <div class="dev-flow">
        ${isCoreClone ? `${devLockedBlock("[[prompt1]]", String(modeData.p1 || ""))}${devLockedBlock("[[prompt2]]", String(modeData.p2 || ""))}` : devEditableBlock("[[prompt1]]", "p1", String(modeData.p1 || ""))}
        ${devEditableBlock("[[prompt3]]", "p3", String(modeData.p3 || ""))}
        ${devCustomModules(modeData, "p3")}
        ${devInsertPoint("p3")}
        ${devLockedBlock("[[AI1]]", "Understood.")}
        ${devEditableBlock("[[prompt4]]", "p4", String(modeData.p4 || ""))}
        ${devEditableBlock("[[prompt5]]", "p5", String(modeData.p5 || ""))}
        ${devCustomModules(modeData, "p5")}
        ${devInsertPoint("p5")}
        ${devEditableBlock("[[prompt6]]", "p6", String(modeData.p6 || ""))}
        ${devCustomModules(modeData, "p6")}
        ${devInsertPoint("p6")}
        ${devLockedBlock("[[AI2]]", "Understood.")}
        <div class="ps-rule-title blue">${icon("fa-brain")} CoT & Logic Overrides</div>
        ${devCotDropdownBlock("[[COT]]", "cot", String(modeData.cot || ""), "cot")}
        ${devCotDropdownBlock("[[prefill]]", "prefill", String(modeData.prefill || ""), "prefill")}
        ${devOverrideBlock("[[THINK]]", "think", String(modeData.think || ""), [["No Change", ""], ["Default", "<think>\\n<think>\\n<think>\\n{Thinking}\\n</think>"]])}
        <div class="ps-rule-title green">${icon("fa-puzzle-piece")} Add-ons & Formatting Overrides</div>
        ${devOverrideBlock("[[cyoa]]", "cyoa", String(modeData.cyoa || ""), [["No Change", ""], ["Default", logicBlock("blocks", "cyoa")]])}
        ${devOverrideBlock("[[infoblock]]", "info", String(modeData.info || ""), [["No Change", ""], ["Default", logicBlock("blocks", "info")]])}
        ${devOverrideBlock("[[summary]]", "summary", String(modeData.summary || ""), [["No Change", ""], ["Default", logicBlock("blocks", "summary")]])}
        ${devOverrideBlock("[[death]]", "death", String(modeData.death || ""), [["No Change", ""], ["Default", logicBlock("addons", "death")]])}
        ${devOverrideBlock("[[combat]]", "combat", String(modeData.combat || ""), [["No Change", ""], ["Default", logicBlock("addons", "combat")]])}
        ${devOverrideBlock("[[Direct]]", "direct", String(modeData.direct || ""), [["No Change", ""], ["Default", logicBlock("addons", "direct")]])}
        ${devOverrideBlock("[[DN]]", "dn", String(modeData.dn || ""), [["No Change", ""], ["Default", logicBlock("addons", "dn")]])}
        ${devOverrideBlock("[[COLOR]]", "dialogueColor", String(modeData.dialogueColor || ""), [["No Change", ""], ["Default", logicBlock("addons", "color")]])}
        ${devOverrideBlock("[[MVU]]", "mvu", String(modeData.mvu || ""), [["No Change", ""], ["Default", logicBlock("blocks", "mvu")]])}
        ${devOverrideBlock("[[storytracker]]", "storytracker", String(modeData.storytracker || ""), [["No Change", ""], ["Default", "# at the very end of the response put this block:\\n<Story_Tracker>\\narc: The Arc that is now active.\\nchapter: The chapter that is now active.\\nEpisode: The episode that is now active.\\nSecrets: Any secret that the user/{{user}} doesn't know.\\n</Story_Tracker>"]])}
        <div class="ps-rule-title gold">${icon("fa-earth-americas")} Global Variables Overrides</div>
        ${devOverrideBlock("[[Language]]", "language", String(modeData.language || ""), [["No Change", ""], ["English Template", "[LANGUAGE RULE]\\nALL OUTPUT EXCEPT THINKING MUST BE IN ENGLISH ONLY."]])}
        ${devOverrideBlock("[[pronouns]]", "pronouns", String(modeData.pronouns || ""), [["No Change", ""], ["Male Template", "{{user}} is male. Always portray and address him as such."]])}
        ${devOverrideBlock("[[count]]", "count", String(modeData.count || ""), [["No Change", ""], ["Example 400", "- maximum 400 words"]])}
        ${devOverrideBlock("[[DNRATIO]]", "dnratio", String(modeData.dnratio || ""), [["No Change", ""], ["Example 50/50", "- Ratio: Maintain a balance of 50% Dialogue and 50% Narration."]])}
        ${devOverrideBlock("[[onomato]]", "onomato", String(modeData.onomato || ""), [["No Change", ""], ["Default", "- Narration must utilize onomatopoeia. Use precise, context-specific phonetic representations for physical interactions (e.g., the click of a latch, the thud of a heavy object, the soughing of wind) rather than abstract descriptions of sound."]])}
        ${devOverrideBlock("[[banlist]]", "banlist", String(modeData.banlist || ""), [["No Change", ""], ["Example", "[BAN LIST]\\nNever rely on these cliches, tropes, or repetitive patterns. They are dead language:\\n- A shiver ran down their spine."]])}
      </div>
    </div>`;
}

function resolveDevEngineSource(id: string): { kind: "new" | "core" | "custom"; mode: Record<string, any> } {
  if (id === "__new") {
    return {
      kind: "new",
      mode: {
        id: "",
        label: "New Custom Engine",
        p1: "",
        p3: "",
        p4: "",
        p5: "",
        p6: "",
        cot: "",
        prefill: "",
        cyoa: "",
        info: "",
        summary: "",
        customToggles: []
      }
    };
  }
  const custom = state.customEngines.find((engine) => engine.id === id) as Record<string, any> | undefined;
  if (custom) return { kind: "custom", mode: custom };
  const core = state.engines.find((engine) => engine.id === id) as Record<string, any> | undefined;
  if (core) return { kind: "core", mode: core };
  return resolveDevEngineSource("__new");
}

function logicBlock(collection: "addons" | "blocks", id: string): string {
  return String((state.logic?.[collection] || []).find((item: any) => item.id === id)?.content || "");
}

function devInsertPoint(attach: string): string {
  return `<div class="dev-insert-point" data-attach="${escapeHtml(attach)}">${icon("fa-plus")} Add Module Here</div>`;
}

function devLockedBlock(title: string, content: string): string {
  return `<div class="dev-block locked"><div class="dev-block-title">${escapeHtml(title)} ${icon("fa-lock")}</div><div class="dev-locked-content">${escapeHtml(content)}</div></div>`;
}

function devEditableBlock(title: string, key: string, value: string): string {
  return `<div class="dev-block"><div class="dev-block-title">${escapeHtml(title)}</div><textarea id="dev_edit_${escapeHtml(key)}" class="ps-modern-input dev-area">${escapeHtml(value)}</textarea></div>`;
}

function devOverrideBlock(title: string, key: string, value: string, presets: Array<[string, string]>): string {
  const buttons = presets.map(([label, preset]) => {
    const active = value === preset;
    return `<button type="button" class="ps-modern-btn secondary mini dev-preset-btn ${active ? "active" : ""}" data-target="dev_edit_${escapeHtml(key)}" data-val="${escapeHtml(preset)}">${escapeHtml(label)}</button>`;
  }).join("");
  return `<div class="dev-block">
    <div class="dev-block-heading"><div class="dev-block-title">${escapeHtml(title)}</div><div class="dev-preset-row">${buttons}</div></div>
    <textarea id="dev_edit_${escapeHtml(key)}" class="ps-modern-input dev-area">${escapeHtml(value)}</textarea>
  </div>`;
}

function devCotDropdownBlock(title: string, key: string, value: string, type: "cot" | "prefill"): string {
  const options = (state.logic?.models || [])
    .filter((model: any) => model.id !== "cot-off")
    .map((model: any) => `<option value="${escapeHtml(String(type === "cot" ? model.content || "" : model.prefill || ""))}">${escapeHtml(model.id)}</option>`)
    .join("");
  return `<div class="dev-block">
    <div class="dev-block-heading">
      <div class="dev-block-title">${escapeHtml(title)}</div>
      <select class="ps-modern-input dev-preset-dropdown" data-target="dev_edit_${escapeHtml(key)}"><option value="" disabled selected>Load Language Template...</option>${options}</select>
    </div>
    <textarea id="dev_edit_${escapeHtml(key)}" class="ps-modern-input dev-area tall">${escapeHtml(value)}</textarea>
  </div>`;
}

function devCustomModules(modeData: Record<string, any>, attachPoint: string): string {
  const modules = Array.isArray(modeData.customToggles)
    ? modeData.customToggles.filter((item: any) => item.attachPoint === attachPoint)
    : [];
  return modules.map((item: any) => `<div class="dev-custom-module"><div><strong>${escapeHtml(item.name || "Custom Module")}</strong><span>${icon("fa-pen-to-square")}${icon("fa-trash")}</span></div><pre>${escapeHtml(item.content || "")}</pre></div>`).join("");
}

function renderStyleEditor(): string {
  const existing = state.styleEditorId && state.styleEditorId !== "__new"
    ? (state.profile.customStyles || []).find((style) => style.id === state.styleEditorId)
    : null;
  const name = existing?.name || "";
  const notes = existing?.notes || "";
  const rule = existing?.rule || state.profile.aiRule || "";
  const templateOptions = (state.logic?.styleTemplates || [])
    .map((template: any, index: number) => `<option value="${index}">${escapeHtml(template.name || `Template ${index + 1}`)}</option>`)
    .join("");
  return `
    <div class="wstyle-header">
      <div class="wstyle-header-left">
        <div class="wstyle-header-icon">${icon("fa-pen-nib")}</div>
        <div><h2>${existing ? "Edit Custom AI Style" : "Create Custom AI Style"}</h2><p>Apply a prebuilt style, generate one with AI, or build your own.</p></div>
      </div>
      <div class="mtab-btn-row">
        <button class="ps-modern-btn primary" type="button" data-action="style-save-custom">${icon("fa-floppy-disk")} Save</button>
        <button class="ps-modern-btn secondary" type="button" data-action="style-back">${icon("fa-arrow-left")} Back</button>
      </div>
    </div>
    <div class="wstyle-editor-bar">
      <input id="style-name" class="ps-modern-input" value="${escapeHtml(name)}" placeholder="Name your style...">
      <select id="style-template-select" class="ps-modern-input"><option value="" disabled selected>Load a Pre-configured Template...</option>${templateOptions}</select>
      <button class="ps-modern-btn secondary" type="button" data-action="style-load-template">${icon("fa-wand-magic-sparkles")} Load Template</button>
      <button class="ps-modern-btn secondary" type="button" data-action="style-insights">${icon("fa-lightbulb")} Generate Insights</button>
    </div>
    <div class="wstyle-insights-panel">
      <div class="mtab-panel-title purple">${icon("fa-sparkles")} Style Notes / Insights</div>
      <textarea id="style-notes" class="ps-modern-input" placeholder="Describe the style, scene texture, pacing, sentence shape, or motifs you want Megumin to learn.">${escapeHtml(notes)}</textarea>
    </div>
    <div class="wstyle-rule-panel">
      <div class="panel-heading-row">
        <div class="mtab-panel-title purple">${icon("fa-scroll")} Generated Rule</div>
        <button class="wstyle-gen-btn" type="button" data-action="style-generate-rule">${icon("fa-bolt")} Generate Writing Rule</button>
      </div>
      <textarea id="style-rule" class="ps-modern-input textarea-xl" placeholder="Select tags above and click Generate...">${escapeHtml(rule)}</textarea>
      <div class="wstyle-info-callout">${icon("fa-circle-info")}<span>After generating or editing your rule, hit <strong>Save</strong> in the toolbar above to apply it to your library.</span></div>
    </div>`;
}

function tabHeader(title: string, sub: string, iconName: string, color: string, badge: string, badgeColor: string, badgeIcon = "fa-circle-check"): string {
  const badgeIds: Record<string, string> = {
    "Story Planner": "sp_header_badge",
    "Dynamic Ban List": "ban_header_badge",
    "Image Generation": "ig_header_badge",
    "NPCs Bank": "npc_header_badge"
  };
  const badgeId = badgeIds[title] ? `id="${badgeIds[title]}"` : "";
  const badgeRgb = hexToRgb(badgeColor) || "16,185,129";
  return `
    <div class="mtab-header">
      <div class="mtab-header-left">
        <div class="mtab-header-icon" style="background:${headerGradient(color)};">${icon(iconName)}</div>
        <div>
          <h2>${escapeHtml(title)}</h2>
          <p>${escapeHtml(sub)}</p>
        </div>
      </div>
      ${badge ? `<div ${badgeId} class="mtab-header-badge" style="background:rgba(${badgeRgb},0.12); color:${badgeColor}; border:1px solid rgba(${badgeRgb},0.25);">${icon(badgeIcon)} ${escapeHtml(badge)}</div>` : ""}
    </div>`;
}

function headerGradient(color: string): string {
  const gradients: Record<string, string> = {
    "#f59e0b": "linear-gradient(135deg, #f59e0b, #d97706)",
    "#ec4899": "linear-gradient(135deg, #ec4899, #be185d)",
    "#3b82f6": "linear-gradient(135deg, #3b82f6, #1d4ed8)",
    "#10b981": "linear-gradient(135deg, #10b981, #059669)",
    "#a855f7": "linear-gradient(135deg, #a855f7, #7c3aed)",
    "#ef4444": "linear-gradient(135deg, #ef4444, #b91c1c)",
    "#06b6d4": "linear-gradient(135deg, #06b6d4, #0891b2)",
    "#f43f5e": "linear-gradient(135deg, #f43f5e, #be123c)"
  };
  return gradients[color] || `linear-gradient(135deg, ${color}, ${color})`;
}

function hexToRgb(hex: string): string | null {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!match) return null;
  return `${parseInt(match[1], 16)},${parseInt(match[2], 16)},${parseInt(match[3], 16)}`;
}

function filterPill(value: string, active: boolean, count: number): string {
  const label = value === "all" ? "All" : value;
  return `<button class="wstyle-filter-pill ${active ? "active" : ""}" type="button" data-action="engine-filter" data-value="${escapeHtml(value)}">${value === "V6" ? icon("fa-lock") : ""}${escapeHtml(label)} <span class="pill-count">${count}</span></button>`;
}

function stylePill(value: string, label: string, count: number, iconName?: string): string {
  const active = (["all", "precooked", "custom", "generators"].includes(state.styleFilter) ? state.styleFilter : "all") === value;
  return `<button class="wstyle-filter-pill ${active ? "active" : ""}" type="button" data-action="style-filter" data-value="${escapeHtml(value)}">${iconName ? icon(iconName) : ""}${escapeHtml(label)} <span class="pill-count">${count}</span></button>`;
}

function engineCount(filter: string): number {
  return state.engines.filter((engine) => engineMatchesFilter(engine, filter)).length;
}

function engineMatchesFilter(engine: EngineMode, filter: string): boolean {
  if (filter === "all") return true;
  const label = `${engine.label || ""} ${engine.id || ""}`.toUpperCase();
  return label.includes(filter.toUpperCase());
}

function engineCard(engine: EngineMode, desc: string): string {
  const active = state.profile.mode === engine.id;
  const locked = !!engine.locked;
  const badges = [
    engine.recommended ? `<span class="ecard-badge rec">${icon("star")} Recommended</span>` : "",
    engine.isNew ? `<span class="ecard-badge new">New</span>` : "",
    locked ? `<span class="ecard-badge locked">${icon("lock")} Coming Soon</span>` : ""
  ].filter(Boolean).join("");
  return `<button type="button" class="mtab-eng-card ${active ? "active" : ""} ${locked ? "locked-card" : ""}" ${locked ? "" : `data-action="select-engine" data-value="${escapeHtml(engine.id)}"`}>
    <span class="ecard-accent"></span>
    <span class="ecard-body">
      <span class="ecard-title"><span>${escapeHtml(engine.label || engine.id)}</span>${active ? `<span class="ecard-badge active-badge">${icon("fa-check")} Active</span>` : ""}</span>
      <span class="ecard-desc">${escapeHtml(desc)}</span>
      ${badges ? `<span class="badge-row">${badges}</span>` : ""}
    </span>
  </button>`;
}

function infoCard(input: { title: string; sub?: string; active?: boolean; action: string; path?: string; value?: string; badge?: string; index?: number }): string {
  const attrs = [
    `data-action="${escapeHtml(input.action)}"`,
    input.path ? `data-path="${escapeHtml(input.path)}"` : "",
    input.value !== undefined ? `data-value="${escapeHtml(input.value)}"` : "",
    input.index !== undefined ? `data-index="${input.index}"` : ""
  ].filter(Boolean).join(" ");
  return `<button type="button" class="mtab-eng-card ${input.active ? "active" : ""}" ${attrs}>
    <span class="ecard-accent"></span>
    <span class="ecard-body">
      <span class="ecard-title"><span>${escapeHtml(input.title)}</span>${input.badge ? `<span class="ecard-badge rec">${escapeHtml(input.badge)}</span>` : ""}</span>
      <span class="ecard-desc">${escapeHtml(strip(input.sub || "").slice(0, 240))}</span>
    </span>
  </button>`;
}

function moduleCard(item: any, active: boolean, path: "addons" | "blocks", overridden = false): string {
  const desc = moduleDesc(item.id) || strip(item.content).slice(0, 180);
  return `<button type="button" class="mtab-eng-card ${active ? "active" : ""}" data-action="toggle-array" data-path="${path}" data-value="${escapeHtml(item.id)}">
    <span class="ecard-accent"></span>
    <span class="ecard-body">
      <span class="ecard-title"><span>${escapeHtml(item.label)}</span>${active ? `<span class="ecard-badge active-badge">${icon("check")} On</span>` : ""}</span>
      <span class="ecard-desc">${escapeHtml(desc)}</span>
      ${item.recommended || overridden ? `<span class="badge-row">${item.recommended ? `<span class="ecard-badge rec">${icon("star")} Recommended</span>` : ""}${overridden ? `<span class="ecard-badge override">${icon("fa-code-branch")} Engine Override</span>` : ""}</span>` : ""}
    </span>
  </button>`;
}

function addonCard(item: any, isV6 = false): string {
  const active = state.profile.addons.includes(item.id);
  const isV6Addon = item.id === "npc_events";
  const desc = moduleDesc(item.id) || strip(item.content).slice(0, 180);
  const badges = [
    active ? `<span class="ecard-badge active-badge">${icon("fa-check")} On</span>` : "",
    item.recommended ? `<span class="ecard-badge rec">${icon("fa-star")} Recommended</span>` : "",
    isV6Addon && !isV6 ? `<span class="ecard-badge locked">${icon("fa-lock")} Requires V6</span>` : "",
    isV6Addon && isV6 ? `<span class="ecard-badge v6-active">${icon("fa-unlock")} V6 Active</span>` : ""
  ].filter(Boolean).join("");
  const action = isV6Addon && !isV6 ? "" : `data-action="toggle-array" data-path="addons" data-value="${escapeHtml(item.id)}"`;
  return `<button type="button" class="mtab-eng-card ${active ? "active" : ""} ${isV6Addon && !isV6 ? "locked-card" : ""}" ${action}>
    <span class="ecard-accent"></span>
    <span class="ecard-body">
      <span class="ecard-title"><span>${escapeHtml(item.label)}</span>${badges ? `<span class="badge-row">${badges}</span>` : ""}</span>
      <span class="ecard-desc">${escapeHtml(desc)}</span>
    </span>
  </button>`;
}

function cinematicSoundsCard(): string {
  const active = state.profile.onomatopoeia.enabled;
  return `<div class="mtab-eng-card ${active ? "active" : ""}">
    <span class="ecard-accent"></span>
    <button type="button" class="ecard-body card-button-reset" data-action="toggle" data-path="onomatopoeia.enabled">
      <span class="ecard-title"><span>Cinematic Sounds</span>${active ? `<span class="ecard-badge active-badge">${icon("fa-check")} On</span>` : ""}</span>
      <span class="ecard-desc">Force the AI to use precise phonetic sound words (e.g., click, thud) instead of abstract descriptions.</span>
    </button>
    <div style="display:${active ? "flex" : "none"}; margin: 8px 18px 16px; padding-top: 10px; border-top: 1px dashed var(--border-color); justify-content: space-between; align-items: center;">
      <div><div style="font-weight:700; font-size: 0.75rem; color: var(--text-main);">Animate Sounds</div><div style="font-size: 0.65rem; color: var(--text-muted);">Wrap in HTML tags. For capable AI only.</div></div>
      <button type="button" class="ps-toggle-card ${state.profile.onomatopoeia.useStyling ? "active" : ""}" id="ono_inner_toggle" data-action="toggle" data-path="onomatopoeia.useStyling" style="padding: 4px; min-width: 44px; justify-content: center; background: transparent; border-color: ${state.profile.onomatopoeia.useStyling ? "#10b981" : "var(--border-color)"};"><div class="ps-switch" style="transform: scale(0.75); ${state.profile.onomatopoeia.useStyling ? "background: #10b981;" : ""}"></div></button>
    </div>
  </div>`;
}

function presetBackendOptions(kind: "engine" | "image"): Array<[string, string]> {
  return kind === "image"
    ? [["direct", "Direct API Call (Fast)"], ["preset", "Megumin Image Preset"]]
    : [["direct", "Direct API Call (Fast)"], ["preset", "Megumin Engine Preset"]];
}

function toggleGeneric(label: string, path: string, active: boolean, desc: string, rawLabel = false): string {
  return `<button type="button" class="mtab-toggle-row ${active ? "active" : ""}" data-action="toggle" data-path="${escapeHtml(path)}">
    <span class="toggle-info"><span class="toggle-label">${rawLabel ? label : escapeHtml(label)}</span>${desc ? `<span class="toggle-desc">${escapeHtml(desc).replace(/&amp;mdash;/g, "&mdash;")}</span>` : ""}</span>
    <span class="ps-switch"></span>
  </button>`;
}

function inputField(label: string, path: string, value: string, placeholder = "", type = "text"): string {
  return `<label class="ps-field ${label ? "" : "bare"}">${label ? `<span>${escapeHtml(label)}</span>` : ""}<input class="ps-modern-input" type="${type}" data-bind="${escapeHtml(path)}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}"></label>`;
}

function rangeField(label: string, path: string, value: number, min: number, max: number): string {
  return `<label class="mtab-param-row"><span class="param-label">${escapeHtml(label)} <b>${value}</b></span><input class="ps-modern-input" type="range" min="${min}" max="${max}" data-bind="${escapeHtml(path)}" value="${value}"></label>`;
}

function sliderPair(id: string, label: string, path: string, value: number, min: number, max: number, step: number): string {
  return `<div class="mtab-param-row"><span class="param-label">${escapeHtml(label)}</span><input type="range" id="ig_${id}" min="${min}" max="${max}" step="${step}" data-bind="${escapeHtml(path)}" value="${value}"><input type="number" id="ig_${id}_val" class="ps-modern-input" data-bind="${escapeHtml(path)}" value="${value}"></div>`;
}

function selectField(label: string, path: string, value: string, options: Array<[string, string]>): string {
  return `<label class="ps-field ${label ? "" : "bare"}">${label ? `<span>${escapeHtml(label)}</span>` : ""}<select class="ps-modern-input" data-bind="${escapeHtml(path)}">
    ${options.map(([id, text]) => `<option value="${escapeHtml(id)}" ${id === value ? "selected" : ""}>${escapeHtml(text)}</option>`).join("")}
  </select></label>`;
}

function settingText(label: string, desc: string): string {
  return `<span class="set-info"><span class="set-label">${escapeHtml(label)}</span><span class="set-desc">${escapeHtml(desc)}</span></span>`;
}

function presetFeatureWarning(featureIds: string[]): string {
  const features = state.presetAudit?.features || [];
  if (!features.length) return "";
  const missing = features
    .filter((feature) => featureIds.includes(feature.id) && feature.missing.length > 0)
    .flatMap((feature) => feature.missing.map((hook) => `${feature.label}: ${hook}`));
  if (!missing.length) return "";
  return `<div class="mtab-callout gold preset-warning">${icon("fa-triangle-exclamation")} <span><strong>Preset hook missing:</strong> ${escapeHtml(missing.join(", "))}</span></div>`;
}

function presetStatusWarning(): string {
  const message = state.presetAudit?.statusMessage || "";
  const hasFeatureMisses = (state.presetAudit?.features || []).some((feature) => feature.missing.length > 0);
  if (!message || hasFeatureMisses) return "";
  return `<div class="mtab-callout gold preset-warning">${icon("fa-triangle-exclamation")} <span>${escapeHtml(message)}</span></div>`;
}

function lockedState(iconName: string, title: string, text: string): string {
  return `<div class="mtab-locked-state">${icon(iconName)}<h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p></div>`;
}

function emptyWithMascot(title: string, text: string): string {
  const image = state.uiAssets.mascotImage || "";
  return `<div class="mtab-locked-state empty-state">${image ? `<img src="${escapeHtml(image)}" alt="">` : icon("spark")}<h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p></div>`;
}

function styleCard(title: string, desc: string, rule: string, active: boolean, action: string, value: string): string {
  return `<button type="button" class="wstyle-card ${active ? "active" : ""}" data-action="${escapeHtml(action)}" data-value="${escapeHtml(value)}">
    <span class="card-accent"></span>
    <span class="card-body">
      <span class="card-top"><span><span class="card-title">${icon("fa-bolt")} ${escapeHtml(title)}</span><span class="card-desc">${escapeHtml(desc || "")}</span></span>${active ? `<span class="card-status active-status">${icon("fa-check")} Active</span>` : ""}</span>
      <span class="card-rule">${escapeHtml(strip(rule || "").slice(0, 360))}</span>
    </span>
  </button>`;
}

function styleCardWithActions(title: string, desc: string, rule: string, active: boolean, value: string): string {
  return `<div class="wstyle-card ${active ? "active" : ""}">
    <button type="button" class="card-button-reset" data-action="style-direct" data-value="${escapeHtml(value)}">
      <span class="card-accent"></span>
      <span class="card-body">
        <span class="card-top"><span><span class="card-title">${escapeHtml(title)}</span><span class="card-desc">${escapeHtml(desc || "")}</span></span>${active ? `<span class="card-status active-status">${icon("fa-check")} Active</span>` : ""}</span>
        <span class="card-rule">${escapeHtml(strip(rule || "").slice(0, 360))}</span>
      </span>
    </button>
    <div class="card-actions">
      <button type="button" class="ps-btn-edit" data-action="style-edit" data-value="${escapeHtml(value)}">${icon("fa-pen")} Edit</button>
      <button type="button" class="act-regen ps-btn-regen" data-action="style-regenerate" data-value="${escapeHtml(value)}">${icon("fa-rotate-right")} Redo</button>
      <button type="button" class="act-delete ps-btn-delete" data-action="style-delete" data-value="${escapeHtml(value)}">${icon("fa-trash-can")} Delete</button>
    </div>
  </div>`;
}

function loraSlot(slot: number): string {
  const suffix = slot === 1 ? "" : String(slot);
  const loraPath = `imageGen.selectedLora${suffix}`;
  const weightPath = `imageGen.selectedLoraWt${suffix}`;
  const triggerPath = `imageGen.loraTrigger${slot}`;
  const loraValue = String(getPath(state.profile as any, loraPath) || "");
  const weightValue = Number(getPath(state.profile as any, weightPath) || 1);
  const triggerValue = String(getPath(state.profile as any, triggerPath) || "");
  return `<div class="lora-slot"><div class="mini-label">Slot ${slot}</div><select id="ig_lora_${slot}" class="ps-modern-input" data-bind="${loraPath}" style="padding: 6px; font-size: 0.75rem; margin-bottom: 4px;"><option value="">Loading...</option>${loraValue ? `<option value="${escapeHtml(loraValue)}" selected>${escapeHtml(loraValue)}</option>` : ""}</select><input type="text" id="ig_lora_trig_${slot}" class="ps-modern-input" data-bind="${triggerPath}" placeholder="Trigger words..." value="${escapeHtml(triggerValue)}" style="padding: 6px; font-size: 0.7rem; margin-bottom: 8px; width: 100%; box-sizing: border-box;" title="Words automatically injected into the prompt when this LoRA is active." /><div class="mtab-param-row" style="padding:0;"><span class="param-label" style="min-width:30px;">Wt</span><input type="range" id="ig_lorawt_${slot}" min="-2" max="2" step="0.1" data-bind="${weightPath}" value="${weightValue}"><span id="ig_lorawt_lbl_${slot}" style="font-size:0.78rem; font-weight:600; color:var(--text-main); min-width:30px; text-align:center;">${weightValue}</span></div></div>`;
}

function npcField(key: string, label: string, fieldIcon: string, color: string, value?: string): string {
  return `<div class="npc-field-section"><strong style="color:${color};">${icon(fieldIcon)} ${escapeHtml(label)}</strong><textarea class="ps-modern-input npc-field-edit" data-field="${escapeHtml(key)}">${escapeHtml(value || "")}</textarea></div>`;
}

function memoryAccordion(chunk: any): string {
  return `<details class="mem-accordion"><summary class="mem-accordion-header">${escapeHtml(chunk.id || "Memory Chunk")} <span>${new Date(chunk.timestamp || Date.now()).toLocaleString()}</span></summary><div class="mem-accordion-body"><textarea readonly>${escapeHtml(chunk.text || chunk.summary || "")}</textarea></div></details>`;
}

function statTile(title: string, value: string, sub: string, color: string): string {
  return `<div class="mem-stat" style="--stat-color:${color};"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(title)}</span><small>${escapeHtml(sub)}</small></div>`;
}

function preferredStyleForEngine(engineId: string): any | null {
  const styles = state.logic?.directStyles || [];
  const target = engineId === "v7-core" ? "dir_v7_core" : engineId === "v7-gentle" ? "dir_v7_gentle" : engineId.startsWith("v7") ? "dir_v7" : "";
  return target ? styles.find((style: any) => style.id === target) || null : null;
}

function groupModels(models: any[]): Record<string, any[]> {
  const groups: Record<string, any[]> = {};
  for (const model of models) {
    const id = String(model.id || "");
    const group = id.includes("v7") ? "V7 Frameworks" : id.includes("chinese") ? "Chinese" : id.includes("japanese") ? "Japanese" : "Classic";
    if (!groups[group]) groups[group] = [];
    groups[group].push(model);
  }
  return groups;
}

function currentCotType(): string {
  const model = state.profile.model || "cot-off";
  if (model === "cot-off") return "off";
  // Longest family id first: cot-v9-lite-english must resolve to v9-lite, not v9.
  for (const type of cotTypeIds()) {
    if (model.startsWith(`cot-${type}-`)) return type;
  }
  // Falling back to a hardcoded family used to mean a V9 profile silently
  // displayed as V1, and touching the picker overwrote it. Report what the
  // profile actually holds instead.
  return splitCotId(model)?.type || "off";
}

function currentCotLang(): string {
  const type = currentCotType();
  if (type === "off") return "english";
  return (state.profile.model || "").replace(`cot-${type}-`, "") || "english";
}

function normalizeEffort(value: string): "unspecified" | "100" | "250" | "450" | "custom" {
  if (value === "250" || value === "450" || value === "custom" || value === "unspecified") return value;
  return "100";
}

/**
 * Presentation for each CoT family. This map is labels only — which families
 * actually exist, and in which languages, is read from the prompt corpus. Adding a
 * framework to megumin-data.js therefore surfaces it in the picker on its own,
 * which is how V8 and V9 came to be missing here in the first place.
 */
const COT_META: Record<string, { label: string; desc: string; isNew?: boolean }> = {
  v9: { label: "CoT V9 (Mirage)", desc: "The current flagship sequence. Full authorial reasoning with scene-temperature and proportionality passes.", isNew: true },
  "v9-lite": { label: "CoT V9 (Lite)", desc: "A trimmed V9 sequence. Same discipline, noticeably less thinking overhead.", isNew: true },
  "v9-director": { label: "CoT V9 (Director)", desc: "V9 reasoning tuned for the Director engine — scene staging and pacing take priority.", isNew: true },
  "v9-immersion": { label: "CoT V9 (Immersion)", desc: "The deepest V9 sequence. Heaviest world-state and continuity checking before writing.", isNew: true },
  "v9-hybrid": { label: "CoT V9 (Hybrid)", desc: "A blend of the V9 passes with the older V7 ground-truth rebuild.", isNew: true },
  "v8-fusion": { label: "CoT V8 (Fusion)", desc: "The V8 fusion sequence, balancing narrative planning against reality checks." },
  v8: { label: "CoT V8", desc: "The standard V8 reasoning sequence." },
  "v7.5": { label: "CoT V7.5", desc: "Paired with the V7.5 narrator engine and its opinionated narration voice." },
  v7: { label: "CoT V7", desc: "The V7 sequence with 5-phase strict ground truth rebuilding." },
  "v7-lite": { label: "CoT V7 (Lite)", desc: "A streamlined 5-phase sequence for V7." },
  v6: { label: "CoT V6 (Dream Team)", desc: "The full 4-phase sequence designed specifically for V6 engines. Specialized validation and modeling." },
  "v6-lite": { label: "CoT V6 (Lite)", desc: "A streamlined 3-phase sequence. Less token overhead while maintaining narrative rules." },
  v2: { label: "CoT V2", desc: "Stricter reality checks, info audits, better NPCs, and hook generation." },
  v1: { label: "CoT V1 (Classic)", desc: "The original 8-step framework. Focuses on the NPC's internal emotional landscape vs their observable actions." }
};

/** Newest first, so the current engine's framework is the first thing on screen. */
const COT_ORDER = [
  "v9", "v9-lite", "v9-director", "v9-immersion", "v9-hybrid",
  "v8-fusion", "v8", "v7.5", "v7", "v7-lite", "v6", "v6-lite", "v2", "v1"
];

/** Splits a model id into its family and language. `cot-v9-lite-english` → v9-lite / english. */
function splitCotId(id: string): { type: string; lang: string } | null {
  const match = /^cot-(.+)-([a-z]{2,8})$/.exec(id);
  return match ? { type: match[1], lang: match[2] } : null;
}

/** Every CoT family present in the corpus, longest first so v9-lite beats v9. */
function cotTypeIds(): string[] {
  const models = (state.logic?.models || []) as Array<{ id: string }>;
  const ids = new Set<string>();
  for (const model of models) {
    if (model.id === "cot-off") continue;
    const parts = splitCotId(model.id);
    if (parts) ids.add(parts.type);
  }
  return [...ids].sort((a, b) => b.length - a.length);
}

function cotFrameworks(currentType: string, currentLang: string): Array<{ id: string; value: string; label: string; desc: string; isNew?: boolean }> {
  void currentType;
  const present = new Set(cotTypeIds());
  const known = COT_ORDER.filter((type) => present.has(type));
  // Anything in the corpus that predates this map still gets an entry rather than
  // silently vanishing from the picker.
  const extra = [...present].filter((type) => !COT_ORDER.includes(type)).sort();

  const entries = [...known, ...extra].map((type) => {
    const languages = cotLanguages(type).map((item) => item.id);
    // Keep the reader's language when this family offers it; fall back to English.
    const lang = languages.includes(currentLang) ? currentLang : languages[0] || "english";
    const meta = COT_META[type] || { label: `CoT ${type.toUpperCase()}`, desc: "" };
    return { id: type, value: `cot-${type}-${lang}`, label: meta.label, desc: meta.desc, isNew: meta.isNew };
  });

  return [
    ...entries,
    { id: "off", value: "cot-off", label: "CoT Off", desc: "No Chain of Thought or prefill. The AI will respond normally." }
  ];
}

const COT_LANGUAGE_LABELS: Array<{ id: string; label: string; rec?: boolean }> = [
  { id: "english", label: "English" },
  { id: "arabic", label: "Arabic (العربية)", rec: true },
  { id: "spanish", label: "Spanish (Español)" },
  { id: "french", label: "French (Français)" },
  { id: "zh", label: "Mandarin (中文)" },
  { id: "ru", label: "Russian (Русский)" },
  { id: "jp", label: "Japanese (日本語)" },
  { id: "pt", label: "Portuguese (Português)" }
];

/**
 * Only the languages this family was actually written in. Read from the corpus
 * rather than listed by hand: offering French for a family that only ships English
 * would hand the engine a model id that resolves to nothing, which silently
 * disables thinking altogether.
 */
function cotLanguages(currentType: string): Array<{ id: string; label: string; rec?: boolean }> {
  const models = (state.logic?.models || []) as Array<{ id: string }>;
  const available = new Set<string>();
  for (const model of models) {
    // Split on the family rather than string-prefixing: `cot-v9-lite-english`
    // starts with `cot-v9-` and would otherwise register "lite-english" as one of
    // V9's languages.
    const parts = splitCotId(model.id);
    if (parts?.type === currentType) available.add(parts.lang);
  }
  const known = COT_LANGUAGE_LABELS.filter((item) => available.has(item.id));
  return known.length ? known : [{ id: "english", label: "English" }];
}

function activeTabProfileKeys(): string[] {
  if (state.devMode) return ["mode"];
  // Keyed by the tab's short name rather than its index: inserting a tab used to
  // silently shift every mapping below it onto the wrong panel.
  const map: Record<string, string[]> = {
    Engine: ["mode", "toggles", "activeStyleId", "aiRule"],
    Persona: ["personality", "toggles"],
    Config: ["storyConfig", "configPresets", "activeStyleId", "aiRule", "customStyles", "dnRatio"],
    Global: ["addons", "userWordCount", "v9Limits", "userLanguage", "userPronouns", "disableUtilityPrefill", "onomatopoeia", "toggles"],
    Blocks: ["blocks", "blockStack", "statBlocks", "worldState"],
    Thinking: ["model", "thinkEffort", "customThinkEffort", "thinkingV2"],
    Story: ["storyPlan"],
    Ban: ["banList", "banListBackend"],
    Image: ["imageGen"],
    NPCs: ["npcBank"],
    Settings: ["toggles", "disableUtilityPrefill"]
  };
  return map[tabs[state.activeTab]?.short || ""] || [];
}

function moduleDesc(id: string): string {
  const descriptions: Record<string, string> = {
    death: "Enables permanent consequences. Characters - including yours - can die for real. No safety net, no plot armor.",
    combat: "Activates a grounded, tactical combat layer. Actions have real weight, positioning matters, and you can lose badly.",
    direct: "Forces AI to say words like D and P. No dancing around the subject, no polite deflection. you know what i mean.",
    color: "Each character's dialogue is color-coded for easy visual parsing.",
    npc_events: "Requires all new story events to grow naturally from prior context or environmental cues - no random drama out of nowhere. V6 only.",
    dn: "Forces dialogue and narration to be wrapped in their respective XML tags. Useful for specific Models for better narration style adherence.",
    info: "Appends a tidy status panel after each response showing time, weather, location, and what characters are wearing.",
    summary: "Keeps a running story digest that the AI updates each turn - helps it remember names, events, and details over long sessions.",
    cyoa: "Choose-Your-Own-Adventure panel with 4 suggested actions for you to pick from each turn.",
    mvu: "Add MVU Compatibility still in test read more here: https://github.com/KritBlade/MVU_Game_Maker",
    npc_inner_chatter: "Reveal NPC private thoughts the PC never hears - crushes, resentment, scheming, anxiety. This feeds future NPC behavior.",
    npc_inner_chatter_v2: "A simpler version of NPC Inner Chatter. use less input token."
  };
  return descriptions[id] || "";
}

function personaDesc(id: string, content: string): string {
  const descriptions: Record<string, string> = {
    megumin: "A rebellious, dominant voice. Adds an edge of arrogance and chaos to the narration. Best for energetic or confrontational stories.",
    director: "Professional narrator. Clean, authoritative story direction with cinematic awareness.",
    Nora: "Nora should i say more.",
    engine: "No personality overlay at all. The engine speaks in its purest form - precise, neutral, and fully under your control. Recommended for most setups."
  };
  return descriptions[id] || content;
}

function readableModel(id: string): string {
  return id.replace(/^cot-/, "").replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function estimatePayloadTokens(): number {
  const activeEngine = state.engines.find((engine) => engine.id === state.profile.mode) as any;
  const selectedAddons = (state.logic?.addons || []).filter((item: any) => state.profile.addons.includes(item.id));
  const selectedBlocks = (state.logic?.blocks || []).filter((item: any) => state.profile.blocks.includes(item.id));
  const selectedModel = (state.logic?.models || []).find((item: any) => item.id === state.profile.model);
  const profileText = JSON.stringify({
    mode: state.profile.mode,
    engine: activeEngine ? [activeEngine.p1, activeEngine.p2, activeEngine.p3, activeEngine.p4, activeEngine.p5, activeEngine.p6].join("\n") : "",
    aiRule: state.profile.aiRule,
    addons: selectedAddons.map((item: any) => item.content).join("\n"),
    blocks: selectedBlocks.map((item: any) => item.content).join("\n"),
    model: selectedModel?.content || "",
    story: state.profile.storyPlan.currentPlan
  });
  return Math.max(0, Math.ceil(profileText.length / 4));
}

function payloadTokenCount(): number {
  const audited = Number(state.presetAudit?.payloadEstimateTokens);
  return Number.isFinite(audited) && audited >= 0 ? audited : estimatePayloadTokens();
}

function payloadTokenLabel(): string {
  const count = payloadTokenCount();
  return state.presetAudit?.payloadEstimateSource === "preset-audit" ? `~${count}` : `~${count} fallback`;
}

function payloadTokenTitle(): string {
  if (state.presetAudit?.payloadEstimateSource === "preset-audit") {
    const presetNames = state.presetAudit.scannedPresetNames?.length ? ` (${state.presetAudit.scannedPresetNames.join(", ")})` : "";
    return `Estimated Payload Tokens from uploaded Megumin preset hooks${presetNames}`;
  }
  return "Estimated Payload Tokens (fallback until uploaded preset hooks are detected)";
}

function updateDnrUi(container: HTMLElement, dialogue: number) {
  const d = clamp(dialogue, 0, 100);
  const n = 100 - d;
  container.querySelectorAll<HTMLElement>("#lbl_dial, #lbl_prev_d").forEach((item) => { item.textContent = String(d); });
  container.querySelectorAll<HTMLElement>("#lbl_narr, #lbl_prev_n").forEach((item) => { item.textContent = String(n); });
}

function getPath(target: any, path: string): any {
  return path.split(".").reduce((value, key) => value?.[key], target);
}

function setPath(target: any, path: string, value: unknown) {
  const parts = path.split(".");
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    if (!cursor[part] || typeof cursor[part] !== "object") cursor[part] = {};
    cursor = cursor[part];
  }
  cursor[parts[parts.length - 1]] = value;
}

function strip(html: string): string {
  return String(html || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function renderMeguminImageTag(payload: any) {
  if (!ctxRef || !payload?.messageId) return;
  const bubble = ctxRef.dom.findMessageElement(payload.messageId);
  if (!bubble) return;
  const id = payload.attrs?.["image-id"] || "";
  const src = payload.attrs?.src || (id ? `/api/v1/images/${id}` : "");
  const prompt = payload.attrs?.prompt || "";
  if (!src || bubble.querySelector(`[data-megumin-image="${CSS.escape(id || src)}"]`)) return;
  const html = `
    <div class="meg-inline-image" data-megumin-image="${escapeHtml(id || src)}">
      <img src="${escapeHtml(src)}" alt="Megumin generated image">
      <div><strong>Megumin Image</strong><span>${escapeHtml(prompt)}</span></div>
    </div>`;
  ctxRef.dom.inject(bubble, html, "beforeend");
}

const faLibrary: Record<string, IconDefinition> = {
  faAddressCard,
  faAddressBook,
  faAlignLeft,
  faArrowLeft,
  faArrowDown,
  faArrowUp,
  faCompress,
  faListOl,
  faClapperboard,
  faInfinity,
  faFire,
  faMoon,
  faWind,
  faForwardFast,
  faLockOpen,
  faPenFancy,
  faBoxOpen,
  faChevronDown,
  faRulerHorizontal,
  faCoins,
  faArrowsRotate,
  faBan,
  faBolt,
  faBook,
  faBookOpen,
  faBoxArchive,
  faBrain,
  faBriefcase,
  faBullseye,
  faChartGantt,
  faCheck,
  faChevronRight,
  faClock,
  faCircle,
  faCircleCheck,
  faCircleHalfStroke,
  faCircleInfo,
  faCircleNotch,
  faCircleXmark,
  faCode,
  faCodeBranch,
  faCopy,
  faCube,
  faCubes,
  faDatabase,
  faDiagramProject,
  faDownload,
  faEarthAmericas,
  faEye,
  faEyeSlash,
  faFileExport,
  faFileImport,
  faFireBurner,
  faFlask,
  faFloppyDisk,
  faGaugeHigh,
  faGears,
  faHammer,
  faImage,
  faLanguage,
  faLayerGroup,
  faLightbulb,
  faLink,
  faList,
  faLock,
  faMagnifyingGlass,
  faMap,
  faMapLocationDot,
  faMasksTheater,
  faMemory,
  faMicrochip,
  faPen,
  faPenNib,
  faPenToSquare,
  faPeopleGroup,
  faPlug,
  faPlus,
  faPlusCircle,
  faPowerOff,
  faPuzzlePiece,
  faRightFromBracket,
  faRotateLeft,
  faRotateRight,
  faSatelliteDish,
  faScaleBalanced,
  faScroll,
  faServer,
  faShieldHalved,
  faSliders,
  faSpinner,
  faStar,
  faToggleOn,
  faTrash,
  faTrashCan,
  faTriangleExclamation,
  faUnlock,
  faUpRightAndDownLeftFromCenter,
  faUpload,
  faUser,
  faUserAstronaut,
  faUserLock,
  faUserSecret,
  faUsers,
  faWandMagicSparkles,
  faWifi,
  faXmark
};

function iconExportName(name: string): string {
  const normalizedAliases: Record<string, string> = {
    wand: "fa-wand-magic-sparkles",
    spark: "fa-wand-magic-sparkles",
    check: "fa-check",
    star: "fa-star",
    lock: "fa-lock",
    "fa-save": "fa-floppy-disk",
    "fa-radar": "fa-satellite-dish",
    "fa-vial": "fa-flask",
    "fa-chart-pie": "fa-chart-gantt",
    "fa-sparkles": "fa-wand-magic-sparkles",
    "fa-gear": "fa-gears",
    "fa-trash-can": "fa-trash-can",
    "fa-trash": "fa-trash",
    "fa-arrows-rotate": "fa-arrows-rotate"
  };
  const faName = normalizedAliases[name] || name;
  const clean = faName.replace(/^fa-/, "");
  return `fa${clean.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("")}`;
}

function fontAwesomeIcon(name: string): string | null {
  const def = faLibrary[iconExportName(name)];
  if (!def?.icon) return null;
  const [width, height, , , pathData] = def.icon;
  const paths = Array.isArray(pathData)
    ? pathData.map((path) => `<path fill="currentColor" d="${path}"></path>`).join("")
    : `<path fill="currentColor" d="${pathData}"></path>`;
  const className = name.startsWith("fa-") ? name : iconExportName(name).replace(/[A-Z]/g, (letter, index) => `${index ? "-" : ""}${letter.toLowerCase()}`).replace(/^-/, "");
  return `<i class="fa-solid ${escapeHtml(className)} meg-fa" aria-hidden="true"><svg class="meg-svg" viewBox="0 0 ${width} ${height}" focusable="false">${paths}</svg></i>`;
}

function icon(name: string): string {
  const faIcon = fontAwesomeIcon(name);
  if (faIcon) return faIcon;
  const aliases: Record<string, string> = {
    "fa-server": "server",
    "fa-user-astronaut": "masks",
    "fa-pen-nib": "pen",
    "fa-earth-americas": "globe",
    "fa-puzzle-piece": "puzzle",
    "fa-brain": "brain",
    "fa-map": "map",
    "fa-ban": "ban",
    "fa-image": "image",
    "fa-address-book": "address",
    "fa-memory": "memory",
    "fa-code": "code",
    "fa-microchip": "microchip",
    "fa-circle-check": "check",
    "fa-check": "check",
    "fa-toggle-on": "settings",
    "fa-masks-theater": "masks",
    "fa-user": "address",
    "fa-user-lock": "lock",
    "fa-sliders": "sliders",
    "fa-fire-burner": "bolt",
    "fa-book": "book",
    "fa-wand-magic-sparkles": "wand",
    "fa-power-off": "power",
    "fa-lock": "lock",
    "fa-scale-balanced": "sliders",
    "fa-save": "save",
    "fa-arrow-left": "arrow-left",
    "fa-magnifying-glass": "search",
    "fa-cubes": "cubes",
    "fa-gauge-high": "settings",
    "fa-diagram-project": "cubes",
    "fa-language": "globe",
    "fa-map-location-dot": "map",
    "fa-circle-xmark": "x",
    "fa-gears": "settings",
    "fa-book-open": "book",
    "fa-radar": "radar",
    "fa-plus-circle": "plus",
    "fa-list": "list",
    "fa-file-import": "file-import",
    "fa-file-export": "file-export",
    "fa-rotate-left": "reset",
    "fa-trash-can": "trash",
    "fa-xmark": "x",
    "fa-plug": "link",
    "fa-vial": "flask",
    "fa-plus": "plus",
    "fa-pen": "pen",
    "fa-up-right-and-down-left-from-center": "image",
    "fa-flask": "flask",
    "fa-bolt": "bolt",
    "fa-upload": "upload",
    "fa-chevron-right": "chevron-right",
    "fa-users": "masks",
    "fa-chart-pie": "pie",
    "fa-spinner": "refresh",
    "fa-layer-group": "layers",
    "fa-database": "server",
    "fa-copy": "copy",
    "fa-circle-info": "info",
    "fa-scroll": "book",
    "fa-triangle-exclamation": "info",
    "fa-hammer": "hammer"
  };
  const key = aliases[name] || name;
  const paths: Record<string, string> = {
    wand: `<path d="m15 4 5 5-11 11-5-5 11-11Z"/><path d="m14 5 5 5"/><path d="M5 4v3M3.5 5.5h3M20 16v3M18.5 17.5h3M8 2l.7 1.7L10.5 4l-1.8.7L8 6.5l-.7-1.8L5.5 4l1.8-.7L8 2Z"/>`,
    spark: `<path d="M12 2l1.7 5.1L19 9l-5.3 1.9L12 16l-1.7-5.1L5 9l5.3-1.9L12 2Z"/><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14Z"/>`,
    server: `<rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 7h.01M7 17h.01M11 7h6M11 17h6"/>`,
    microchip: `<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M9 1v4M15 1v4M9 19v4M15 19v4M1 9h4M1 15h4M19 9h4M19 15h4"/>`,
    masks: `<path d="M7 10h.01M11 10h.01M9 14c1.5 1 3 1 4 0"/><path d="M3 5c4-2 8-2 12 0v5c0 5-3 8-6 8s-6-3-6-8V5Z"/><path d="M15 7c2-.4 4-.1 6 1v4c0 4-2 6-5 7"/>`,
    pen: `<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"/>`,
    globe: `<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2c3 3 3 17 0 20M12 2c-3 3-3 17 0 20"/>`,
    puzzle: `<path d="M9 3h6v4a2 2 0 1 0 0 4v4h-4a2 2 0 1 1-4 0H3V9h4a2 2 0 1 0 2-2V3Z"/>`,
    cubes: `<path d="m12 2 7 4v8l-7 4-7-4V6l7-4Z"/><path d="M12 10 5 6M12 10l7-4M12 10v8"/>`,
    brain: `<path d="M9 3a3 3 0 0 0-3 3v1a3 3 0 0 0-2 5 3 3 0 0 0 2 5v1a3 3 0 0 0 5 2V3H9Z"/><path d="M15 3a3 3 0 0 1 3 3v1a3 3 0 0 1 2 5 3 3 0 0 1-2 5v1a3 3 0 0 1-5 2V3h2Z"/>`,
    map: `<path d="m9 18-6 3V6l6-3 6 3 6-3v15l-6 3-6-3Z"/><path d="M9 3v15M15 6v15"/>`,
    ban: `<circle cx="12" cy="12" r="9"/><path d="M5.5 5.5 18.5 18.5"/>`,
    image: `<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8" cy="10" r="2"/><path d="m21 15-5-5L5 19"/>`,
    address: `<path d="M7 3h10a2 2 0 0 1 2 2v16H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M9 7h6M9 11h6M9 15h4"/>`,
    memory: `<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 1v3M16 1v3M8 20v3M16 20v3M1 8h3M1 16h3M20 8h3M20 16h3M8 8h8v8H8Z"/>`,
    code: `<path d="m8 9-4 3 4 3M16 9l4 3-4 3M14 4l-4 16"/>`,
    refresh: `<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>`,
    reset: `<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v6h6"/>`,
    save: `<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8M7 3v5h8"/>`,
    check: `<path d="M20 6 9 17l-5-5"/>`,
    star: `<path d="m12 2 3 6 7 .9-5 4.8 1.2 6.8L12 17l-6.2 3.5L7 13.7 2 8.9 9 8l3-6Z"/>`,
    lock: `<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>`,
    settings: `<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/><path d="M3 12h2M19 12h2M12 3v2M12 19v2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/>`,
    bolt: `<path d="M13 2 3 14h8l-1 8 11-14h-8l1-6Z"/>`,
    plus: `<path d="M12 5v14M5 12h14"/>`,
    trash: `<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15M10 11v6M14 11v6"/>`,
    link: `<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5"/>`,
    power: `<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/>`,
    "arrow-left": `<path d="M19 12H5M12 19l-7-7 7-7"/>`,
    "file-import": `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M12 11v6M9 14l3 3 3-3"/>`,
    "file-export": `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M12 17v-6M9 14l3-3 3 3"/>`,
    flask: `<path d="M9 2h6M10 2v6l-5 9a3 3 0 0 0 2.6 4.5h8.8A3 3 0 0 0 19 17l-5-9V2"/><path d="M7 16h10"/>`,
    upload: `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8 12 3 7 8M12 3v12"/>`,
    "chevron-right": `<path d="m9 18 6-6-6-6"/>`,
    pie: `<path d="M21 12a9 9 0 1 1-9-9v9Z"/><path d="M12 3a9 9 0 0 1 9 9h-9Z"/>`,
    layers: `<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>`,
    copy: `<rect x="9" y="9" width="11" height="11" rx="2"/><rect x="4" y="4" width="11" height="11" rx="2"/>`,
    sliders: `<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M2 14h4M10 8h4M18 16h4"/>`,
    info: `<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>`,
    radar: `<path d="M20 12a8 8 0 1 1-8-8"/><path d="M12 12 20 4M12 8a4 4 0 1 0 4 4"/>`,
    list: `<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>`,
    x: `<path d="M18 6 6 18M6 6l12 12"/>`,
    search: `<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>`,
    book: `<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15Z"/>`,
    hammer: `<path d="m15 12 6 6-3 3-6-6M14 4l6 6M4 14l7-7 3 3-7 7H4v-3Z"/>`
  };
  return `<svg class="meg-svg meg-${escapeHtml(name)}" viewBox="0 0 24 24" aria-hidden="true">${paths[key] || paths.spark}</svg>`;
}

/**
 * The SillyTavern build's stylesheet, copied verbatim.
 *
 * Loaded after ST_PARITY_CSS so the original rules win wherever the two
 * disagree — the goal here is to look identical to the ST panels, not to
 * improve on them. Only the handful of selectors that targeted
 * SillyTavern's own DOM were dropped.
 */
const BETA_STYLE_CSS = String.raw`
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

:root {
    --bg-main: #0e0e11;
    --bg-panel: #18181b99;
    --border-color: #27272a;
    --text-main: #f4f4f5;
    --text-muted: #a1a1aa;
    --accent-color: #ffffff;
    --gold: #f59e0b;
}

.ps-modern-modal.app-container {
    width: 1050px;
    max-width: 95vw;
    height: 85vh;
    max-height: 850px;
    background: var(--bg-panel);
    border: 1px solid var(--border-color);
    border-radius: 16px;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
    color: var(--text-main);
    display: flex;
    flex-direction: column;
    position: relative;
    overflow: hidden;
}

.main-wrapper {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

.hero-banner {
    height: 190px; 
    width: 100%;
    background-position: center 25%;
    background-size: cover;
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    flex-shrink: 0;
}

.hero-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(to right, rgba(0, 0, 0, 0.9) 0%, rgba(24, 24, 27, 0.4) 50%, rgba(24, 24, 27, 0.8) 100%);
}

.hero-overlay::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(to top, rgba(24, 24, 27, 0.95) 0%, transparent 80%);
}

.top-app-bar {
    position: relative;
    z-index: 2;
    padding: 20px 30px;
    display: flex;
    justify-content: flex-end;
}

.app-actions {
    display: flex;
    gap: 10px;
    align-items: center;
}

.hero-content {
    display: none !important; 
}

.hero-content .status {
    font-size: 0.7rem;
    font-weight: 800;
    color: #a855f7;
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-bottom: 5px;
    text-shadow: 0 2px 4px rgba(0, 0, 0, 0.8);
}

.hero-content .name {
    font-size: 1.7rem; 
    font-weight: 800;
    margin: 0;
    text-shadow: 0 4px 10px rgba(0, 0, 0, 0.8);
    color: #fff;
    line-height: 1.1;
}

.dock {
    position: absolute;
    top: 20px;
    bottom: 20px;
    left: 20px;
    width: 60px;
    background: rgba(18, 18, 20, 0.7);
    backdrop-filter: blur(15px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    padding-top: 15px;
    transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    overflow: hidden;
    white-space: nowrap;
    z-index: 50;
}

.dock:hover {
    width: 240px;
    box-shadow: 10px 10px 40px rgba(0, 0, 0, 0.8);
}

.dock-icon {
    display: flex;
    align-items: center;
    width: 240px;
    height: 50px;
    padding: 0 20px;
    color: #a1a1aa;
    cursor: pointer;
    transition: 0.2s;
    font-weight: 600;
    font-size: 0.9rem;
    margin-bottom: 5px;
}

.dock-icon i {
    width: 20px;
    text-align: center;
    margin-right: 15px;
    font-size: 1.1rem;
}

.dock-icon:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    margin-left: 10px;
    width: 220px;
}

.dock-icon.active {
    color: #f59e0b;
    background: rgba(245, 158, 11, 0.15);
    border-radius: 8px;
    margin-left: 10px;
    width: 220px;
}

.dock-icon span {
    opacity: 0;
    transition: opacity 0.2s;
    pointer-events: none;
}

.dock:hover .dock-icon span {
    opacity: 1;
    transition-delay: 0.1s;
}

.main-content {
    padding: 0 40px 40px 100px;
    margin-top: -80px; 
    position: relative;
    z-index: 10;
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 20px;
}

.main-content::-webkit-scrollbar {
    width: 6px;
}

.main-content::-webkit-scrollbar-thumb {
    background: var(--border-color);
    border-radius: 3px;
}

.ps-rule-title {
    font-size: 0.7rem;
    font-weight: 700;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 1px;
}

.ps-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 16px;
}

.ps-card {
    background: var(--bg-main);
    border: 1px solid var(--border-color);
    border-radius: 12px;
    padding: 20px;
    position: relative;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
}

.ps-card:hover {
    border-color: #52525b;
    transform: translateY(-2px);
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.4);
}

.ps-card.selected {
    border-color: var(--text-main);
    background: var(--text-main);
    color: #000;
}

.ps-card.selected .ps-card-title {
    color: #000;
}

.ps-card.selected .ps-card-desc,
.ps-card.selected div {
    color: #444;
}

.ps-card-title {
    font-size: 1.05rem;
    font-weight: 600;
    color: var(--text-main);
    margin-bottom: 6px;
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.ps-card-desc {
    font-size: 0.8rem;
    color: var(--text-muted);
    line-height: 1.5;
    margin-top: 4px;
}

.ps-rec-text {
    font-size: 0.65rem;
    font-weight: 800;
    color: var(--gold);
    display: flex;
    align-items: center;
    gap: 4px;
    text-transform: uppercase;
    margin: 0;
}

.ps-toggle-card {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: var(--bg-main);
    border: 1px solid var(--border-color);
    border-radius: 12px;
    padding: 18px 24px;
    cursor: pointer;
    transition: 0.2s;
}

.ps-toggle-card:hover {
    border-color: #52525b;
}

.ps-toggle-card.active {
    border-color: var(--accent-color);
    background: #27272a;
}

.ps-switch {
    width: 44px;
    height: 24px;
    background: #3f3f46;
    border-radius: 12px;
    position: relative;
    transition: 0.3s;
}

.ps-switch::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 20px;
    height: 20px;
    background: #fff;
    border-radius: 50%;
    transition: 0.3s;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.ps-toggle-card.active .ps-switch {
    background: var(--accent-color);
}

.ps-toggle-card.active .ps-switch::after {
    left: 22px;
    background: #000;
}

.ps-modern-tag {
    display: inline-block;
    padding: 6px 14px;
    margin: 4px;
    background: var(--bg-main);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.8rem;
    font-weight: 500;
    color: var(--text-main);
    transition: 0.2s;
}

.ps-modern-tag:hover {
    border-color: #52525b;
    background: #27272a;
}

.ps-modern-tag.selected {
    background: var(--text-main);
    color: #000;
    border-color: var(--text-main);
    font-weight: 600;
}

.ps-modern-input {
    width: 100%;
    background: var(--bg-main);
    border: 1px solid var(--border-color);
    color: var(--text-main);
    padding: 12px 16px;
    border-radius: 8px;
    font-family: inherit;
    font-size: 0.85rem;
    outline: none;
    transition: 0.2s;
    box-sizing: border-box;
}

.ps-modern-input:focus {
    border-color: var(--text-muted);
    background: var(--bg-panel);
}

.ps-modern-btn {
    border-radius: 8px;
    font-weight: 600;
    font-size: 0.85rem;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px 20px;
}

.ps-modern-btn.primary {
    background: var(--text-main);
    color: #000;
    border: none;
}

.ps-modern-btn.primary:hover:not(:disabled) {
    background: #d4d4d8;
    transform: translateY(-1px);
}

.ps-modern-btn.secondary {
    background: rgba(0, 0, 0, 0.5);
    color: var(--text-main);
    border: 1px solid var(--border-color);
    backdrop-filter: blur(5px);
}

.ps-modern-btn.secondary:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.1);
    border-color: #52525b;
}

.ps-modern-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.ps-tooltip-title {
    color: var(--gold);
    font-weight: 700;
}

.wstyle-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 15px; 
    padding-bottom: 12px; 
    border-bottom: 1px solid var(--border-color);
}

.wstyle-header-left {
    display: flex;
    align-items: center;
    gap: 14px;
}

.wstyle-header-icon {
    width: 34px; 
    height: 34px; 
    font-size: 0.9rem; 
    border-radius: 8px;
    background: linear-gradient(135deg, #a855f7 0%, #6366f1 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.2rem;
    color: #fff;
    flex-shrink: 0;
    box-shadow: 0 4px 15px rgba(168, 85, 247, 0.3);
}

.wstyle-header h2 {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 800;
    color: var(--text-main);
    letter-spacing: -0.02em;
}

.wstyle-header p {
    display: none;
}

.wstyle-active-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    border-radius: 20px;
    font-size: 0.75rem;
    font-weight: 700;
    background: rgba(16, 185, 129, 0.12);
    color: #10b981;
    border: 1px solid rgba(16, 185, 129, 0.25);
    white-space: nowrap;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.wstyle-active-badge.off {
    background: rgba(161, 161, 170, 0.1);
    color: var(--text-muted);
    border-color: var(--border-color);
}

.wstyle-active-badge i {
    font-size: 0.65rem;
}

.wstyle-filters {
    display: flex;
    gap: 6px;
    margin-bottom: 20px;
    flex-wrap: wrap;
    padding: 4px;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 12px;
    border: 1px solid var(--border-color);
}

.wstyle-filter-pill {
    padding: 8px 18px;
    border-radius: 10px;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-muted);
    background: transparent;
    border: none;
    cursor: pointer;
    transition: all 0.25s ease;
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
}

.wstyle-filter-pill:hover {
    color: var(--text-main);
    background: rgba(255, 255, 255, 0.05);
}

.wstyle-filter-pill.active {
    color: #fff;
    background: rgba(255, 255, 255, 0.1);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.wstyle-filter-pill .pill-count {
    font-size: 0.65rem;
    padding: 1px 6px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-muted);
    font-weight: 700;
}

.wstyle-filter-pill.active .pill-count {
    background: rgba(255, 255, 255, 0.15);
    color: #fff;
}

.wstyle-section-head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 20px 0 12px;
    font-size: 0.72rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    color: var(--text-muted);
}

.wstyle-section-head::after {
    content: '';
    flex: 1;
    height: 1px;
    background: linear-gradient(to right, var(--border-color), transparent);
}

.wstyle-section-head i {
    font-size: 0.7rem;
}

.wstyle-section-head.gold {
    color: var(--gold);
}

.wstyle-section-head.green {
    color: #10b981;
}

.wstyle-section-head.purple {
    color: #a855f7;
}

.wstyle-section-head.blue {
    color: #3b82f6;
}

.wstyle-section-head.red {
    color: #ef4444;
}

.wstyle-card {
    position: relative;
    display: flex;
    flex-direction: column;
    background: var(--bg-main);
    border: 1px solid var(--border-color);
    border-radius: 14px;
    overflow: hidden;
    cursor: pointer;
    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.wstyle-card:hover {
    border-color: #52525b;
    transform: translateY(-2px);
    box-shadow: 0 8px 25px rgba(0, 0, 0, 0.4);
}

.wstyle-card .card-accent {
    height: 3px;
    width: 100%;
    background: linear-gradient(90deg, var(--border-color), transparent);
    transition: background 0.3s ease;
}

.wstyle-card:hover .card-accent {
    background: linear-gradient(90deg, #a855f7, #6366f1, transparent);
}

.wstyle-card.active .card-accent {
    background: linear-gradient(90deg, #10b981, #059669) !important;
}

.wstyle-card .card-body {
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.wstyle-card .card-top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
}

.wstyle-card .card-title {
    font-weight: 700;
    font-size: 0.95rem;
    color: var(--text-main);
    display: flex;
    align-items: center;
    gap: 8px;
}

.wstyle-card .card-desc {
    font-size: 0.78rem;
    color: var(--text-muted);
    line-height: 1.5;
    margin: 0;
}

.wstyle-card .card-rule {
    font-size: 0.73rem;
    font-family: 'SF Mono', 'Fira Code', monospace;
    background: rgba(0, 0, 0, 0.3);
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.04);
    color: var(--text-muted);
    max-height: 52px;
    overflow: hidden;
    line-height: 1.5;
    -webkit-mask-image: linear-gradient(to bottom, #000 60%, transparent);
    mask-image: linear-gradient(to bottom, #000 60%, transparent);
}

.wstyle-card .card-status {
    font-size: 0.68rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    border-radius: 8px;
    white-space: nowrap;
}

.wstyle-card .card-status.active-status {
    background: rgba(16, 185, 129, 0.15);
    color: #10b981;
}

.wstyle-card .card-actions {
    display: flex;
    gap: 6px;
    margin-top: 4px;
    flex-wrap: wrap;
}

.wstyle-card .card-actions button {
    padding: 5px 12px;
    font-size: 0.7rem;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    border: 1px solid var(--border-color);
    background: transparent;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    gap: 5px;
}

.wstyle-card .card-actions button:hover {
    background: rgba(255, 255, 255, 0.06);
    border-color: #52525b;
    color: var(--text-main);
}

.wstyle-card .card-actions button.act-delete:hover {
    background: rgba(239, 68, 68, 0.1);
    border-color: rgba(239, 68, 68, 0.3);
    color: #ef4444;
}

.wstyle-card .card-actions button.act-regen:hover {
    background: rgba(245, 158, 11, 0.1);
    border-color: rgba(245, 158, 11, 0.3);
    color: var(--gold);
}

.wstyle-card.active {
    border-color: #10b981;
    background: rgba(16, 185, 129, 0.04);
}

.wstyle-card.active .card-title {
    color: #10b981;
}

.wstyle-off-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--bg-main);
    border: 1px solid var(--border-color);
    border-radius: 14px;
    padding: 16px 20px;
    cursor: pointer;
    transition: all 0.25s ease;
    margin-bottom: 8px;
}

.wstyle-off-card:hover {
    border-color: #52525b;
}

.wstyle-off-card.active {
    border-color: var(--text-muted);
    background: rgba(255, 255, 255, 0.04);
}

.wstyle-off-card .off-left {
    display: flex;
    align-items: center;
    gap: 12px;
}

.wstyle-off-card .off-icon {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.06);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    font-size: 0.95rem;
}

.wstyle-off-card.active .off-icon {
    color: var(--text-main);
    background: rgba(255, 255, 255, 0.1);
}

.wstyle-dnr-panel {
    background: var(--bg-main);
    border: 1px solid var(--border-color);
    border-radius: 14px;
    overflow: hidden;
    margin-bottom: 8px;
}

.wstyle-dnr-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    cursor: pointer;
    transition: background 0.2s;
}

.wstyle-dnr-header:hover {
    background: rgba(255, 255, 255, 0.02);
}

.wstyle-dnr-header .dnr-info {
    display: flex;
    align-items: center;
    gap: 12px;
}

.wstyle-dnr-header .dnr-icon {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: linear-gradient(135deg, rgba(245, 158, 11, 0.15), rgba(245, 158, 11, 0.05));
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--gold);
    font-size: 0.95rem;
}

.wstyle-dnr-body {
    padding: 0 20px 20px;
    display: none;
}

.wstyle-dnr-body.open {
    display: block;
}

.wstyle-dnr-slider-track {
    display: flex;
    align-items: center;
    gap: 14px;
    background: rgba(0, 0, 0, 0.25);
    padding: 14px 16px;
    border-radius: 10px;
    border: 1px solid var(--border-color);
}

.wstyle-dnr-slider-track input[type="range"] {
    flex: 1;
    accent-color: var(--gold);
    cursor: pointer;
}

.wstyle-dnr-label {
    font-size: 0.78rem;
    font-weight: 700;
    white-space: nowrap;
    min-width: 100px;
}

.wstyle-dnr-label.narr {
    color: #a855f7;
    text-align: right;
}

.wstyle-dnr-label.dial {
    color: #10b981;
}

.wstyle-gen-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--bg-main);
    border: 1px dashed rgba(168, 85, 247, 0.3);
    border-radius: 14px;
    padding: 18px 20px;
    gap: 16px;
    transition: all 0.25s ease;
}

.wstyle-gen-card:hover {
    border-color: rgba(168, 85, 247, 0.5);
    background: rgba(168, 85, 247, 0.03);
}

.wstyle-gen-card .gen-info {
    flex: 1;
}

.wstyle-gen-card .gen-title {
    font-weight: 700;
    font-size: 0.95rem;
    color: var(--text-main);
    margin-bottom: 4px;
}

.wstyle-gen-card .gen-desc {
    font-size: 0.75rem;
    color: var(--text-muted);
    line-height: 1.4;
}

.wstyle-gen-btn {
    padding: 10px 20px;
    border-radius: 10px;
    font-weight: 800;
    font-size: 0.78rem;
    background: linear-gradient(135deg, #a855f7, #6366f1);
    color: #fff;
    border: none;
    cursor: pointer;
    transition: all 0.25s;
    display: flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
    box-shadow: 0 4px 12px rgba(168, 85, 247, 0.25);
}

.wstyle-gen-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 6px 20px rgba(168, 85, 247, 0.35);
}

.wstyle-gen-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
    box-shadow: none;
}

.wstyle-create-card {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 20px;
    border: 1px dashed rgba(16, 185, 129, 0.3);
    border-radius: 14px;
    background: transparent;
    cursor: pointer;
    transition: all 0.25s;
    color: var(--text-muted);
    font-weight: 700;
    font-size: 0.85rem;
}

.wstyle-create-card:hover {
    border-color: rgba(16, 185, 129, 0.5);
    color: #10b981;
    background: rgba(16, 185, 129, 0.04);
}

.wstyle-editor-bar {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 16px 20px;
    background: var(--bg-main);
    border: 1px solid var(--border-color);
    border-radius: 14px;
    margin-bottom: 20px;
}

.wstyle-editor-bar input {
    flex: 1;
    background: transparent;
    border: none;
    color: var(--text-main);
    font-size: 1.15rem;
    font-weight: 800;
    font-family: inherit;
    outline: none;
    letter-spacing: -0.02em;
}

.wstyle-editor-bar input::placeholder {
    color: #52525b;
}

.wstyle-tag-section {
    background: var(--bg-main);
    border: 1px solid var(--border-color);
    border-radius: 14px;
    padding: 20px;
    margin-bottom: 16px;
}

.wstyle-tag-cat-title {
    font-size: 0.7rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    color: var(--text-muted);
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    gap: 8px;
}

.wstyle-tag-cat-title::before {
    content: '';
    width: 3px;
    height: 14px;
    border-radius: 2px;
    background: linear-gradient(to bottom, #a855f7, #6366f1);
}

.wstyle-tag-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}

.wstyle-tag {
    padding: 7px 14px;
    border-radius: 8px;
    font-size: 0.78rem;
    font-weight: 500;
    color: var(--text-muted);
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid var(--border-color);
    cursor: pointer;
    transition: all 0.2s ease;
    user-select: none;
}

.wstyle-tag:hover {
    border-color: #52525b;
    color: var(--text-main);
    background: rgba(255, 255, 255, 0.04);
}

.wstyle-tag.selected {
    background: rgba(168, 85, 247, 0.15);
    border-color: rgba(168, 85, 247, 0.4);
    color: #c084fc;
    font-weight: 600;
}

.wstyle-insights-panel {
    background: var(--bg-main);
    border: 1px solid var(--border-color);
    border-radius: 14px;
    padding: 20px;
    margin-bottom: 16px;
}

.wstyle-rule-panel {
    background: var(--bg-main);
    border: 1px solid var(--border-color);
    border-radius: 14px;
    padding: 20px;
}

.wstyle-rule-panel textarea {
    width: 100%;
    min-height: 100px;
    resize: vertical;
    background: rgba(0, 0, 0, 0.25);
    border: 1px solid var(--border-color);
    border-radius: 10px;
    padding: 14px;
    color: var(--text-main);
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 0.82rem;
    line-height: 1.6;
    outline: none;
    transition: border-color 0.2s;
    box-sizing: border-box;
}

.wstyle-rule-panel textarea:focus {
    border-color: #a855f7;
}

.wstyle-info-callout {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    margin-top: 16px;
    padding: 14px 16px;
    border-radius: 10px;
    background: rgba(99, 102, 241, 0.06);
    border-left: 3px solid #6366f1;
}

.wstyle-info-callout i {
    color: #6366f1;
    font-size: 0.85rem;
    margin-top: 2px;
}

.wstyle-info-callout span {
    font-size: 0.78rem;
    color: var(--text-muted);
    line-height: 1.5;
}

.mtab-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 24px;
    padding-bottom: 20px;
    border-bottom: 1px solid var(--border-color);
}

.mtab-header-left {
    display: flex;
    align-items: center;
    gap: 14px;
}

.mtab-header-icon {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.2rem;
    color: #fff;
    flex-shrink: 0;
    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
}

.mtab-header h2 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 800;
    color: var(--text-main);
    letter-spacing: -0.02em;
}

.mtab-header p {
    margin: 2px 0 0;
    font-size: 0.78rem;
    color: var(--text-muted);
}

.mtab-header-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 14px;
    border-radius: 20px;
    font-size: 0.72rem;
    font-weight: 700;
    white-space: nowrap;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.mtab-eng-card {
    position: relative;
    display: flex;
    flex-direction: column;
    background: var(--bg-main);
    border: 1px solid var(--border-color);
    border-radius: 14px;
    overflow: hidden;
    cursor: pointer;
    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    padding: 0;
}

.mtab-eng-card:hover {
    border-color: #52525b;
    transform: translateY(-2px);
    box-shadow: 0 8px 25px rgba(0, 0, 0, 0.35);
}

.mtab-eng-card .ecard-accent {
    height: 3px;
    width: 100%;
    background: linear-gradient(90deg, var(--border-color), transparent);
    transition: background 0.3s ease;
}

.mtab-eng-card:hover .ecard-accent {
    background: linear-gradient(90deg, var(--gold), #d97706, transparent);
}

.mtab-eng-card.active .ecard-accent {
    background: linear-gradient(90deg, #10b981, #059669) !important;
}

.mtab-eng-card .ecard-body {
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.mtab-eng-card .ecard-title {
    font-weight: 700;
    font-size: 0.95rem;
    color: var(--text-main);
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.mtab-eng-card .ecard-desc {
    font-size: 0.78rem;
    color: var(--text-muted);
    line-height: 1.5;
    margin: 0;
}

.mtab-eng-card .ecard-badge {
    font-size: 0.62rem;
    font-weight: 800;
    padding: 3px 10px;
    border-radius: 8px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
}

.mtab-eng-card .ecard-badge.rec {
    background: rgba(245, 158, 11, 0.12);
    color: var(--gold);
}

.mtab-eng-card .ecard-badge.new {
    background: rgba(59, 130, 246, 0.15);
    color: #3b82f6;
}

.mtab-eng-card .ecard-badge.locked {
    background: rgba(82, 82, 91, 0.2);
    color: #71717a;
}

.mtab-eng-card .ecard-badge.v6-active {
    background: rgba(16, 185, 129, 0.15);
    color: #10b981;
}

.mtab-eng-card .ecard-badge.override {
    background: rgba(16, 185, 129, 0.12);
    color: #10b981;
}

.mtab-eng-card.active {
    border-color: #10b981;
    background: rgba(16, 185, 129, 0.04);
}

.mtab-eng-card.active .ecard-title {
    color: #10b981;
}

.mtab-eng-card.locked-card {
    opacity: 0.5;
    filter: grayscale(60%);
    pointer-events: none;
}

.mtab-eng-card.locked-card:hover {
    transform: none;
    box-shadow: none;
}

.mtab-toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--bg-main);
    border: 1px solid var(--border-color);
    border-radius: 14px;
    padding: 16px 20px;
    gap: 16px;
    cursor: pointer;
    transition: all 0.25s ease;
}

.mtab-toggle-row:hover {
    border-color: #52525b;
}

.mtab-toggle-row.active {
    border-color: var(--gold);
    background: rgba(245, 158, 11, 0.03);
}

.mtab-toggle-row.active .ps-switch {
    background: var(--gold); 
}

.mtab-toggle-row.active .ps-switch::after {
    left: 22px;
    background: #000;
}

.mtab-toggle-row .toggle-info {
    flex: 1;
}

.mtab-toggle-row .toggle-label {
    font-weight: 700;
    font-size: 0.88rem;
    color: var(--text-main);
    display: flex;
    align-items: center;
    gap: 8px;
}

.mtab-toggle-row .toggle-desc {
    font-size: 0.73rem;
    color: var(--text-muted);
    margin-top: 3px;
    line-height: 1.4;
}

.mtab-panel {
    background: var(--bg-main);
    border: 1px solid var(--border-color);
    border-radius: 14px;
    padding: 20px;
    margin-bottom: 16px;
}

.mtab-panel-title {
    font-size: 0.72rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    color: var(--text-muted);
    margin-bottom: 16px;
    display: flex;
    align-items: center;
    gap: 8px;
}

.mtab-panel-title i {
    font-size: 0.85rem;
}

.mtab-panel-title.gold i {
    color: var(--gold);
}

.mtab-panel-title.green i {
    color: #10b981;
}

.mtab-panel-title.purple i {
    color: #a855f7;
}

.mtab-panel-title.blue i {
    color: #3b82f6;
}

.mtab-panel-title.red i {
    color: #ef4444;
}

.mtab-setting-row {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 14px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.mtab-setting-row:last-child {
    border-bottom: none;
    padding-bottom: 0;
}

.mtab-setting-row:first-child {
    padding-top: 0;
}

.mtab-setting-row .set-info {
    flex: 1;
}

.mtab-setting-row .set-label {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-main);
}

.mtab-setting-row .set-desc {
    font-size: 0.73rem;
    color: var(--text-muted);
    margin-top: 2px;
}

.mtab-param-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 0;
}

.mtab-param-row .param-label {
    min-width: 55px;
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.mtab-param-row input[type="range"] {
    flex: 1;
    accent-color: var(--gold);
    cursor: pointer;
}

.mtab-param-row input[type="number"] {
    width: 55px;
    padding: 5px 4px;
    text-align: center;
    font-size: 0.78rem;
    font-weight: 600;
    background: rgba(0, 0, 0, 0.25);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    color: var(--text-main);
    outline: none;
}

.mtab-ban-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 14px;
    border-radius: 10px;
    background: rgba(239, 68, 68, 0.06);
    border: 1px solid rgba(239, 68, 68, 0.2);
    color: #ef4444;
    font-size: 0.82rem;
    line-height: 1.4;
    cursor: pointer;
    transition: all 0.2s;
    word-break: break-word;
}

.mtab-ban-item:hover {
    background: rgba(239, 68, 68, 0.12);
    border-color: rgba(239, 68, 68, 0.35);
}

.mtab-ban-item i {
    opacity: 0.6;
    flex-shrink: 0;
    margin-left: 12px;
}

.mtab-locked-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
    text-align: center;
    background: var(--bg-main);
    border: 1px dashed rgba(168, 85, 247, 0.3);
    border-radius: 14px;
    margin-bottom: 20px;
}

.mtab-locked-state i {
    font-size: 2.5rem;
    margin-bottom: 15px;
}

.mtab-locked-state h3 {
    margin: 0 0 10px;
    color: var(--text-main);
    font-weight: 800;
}

.mtab-locked-state p {
    color: var(--text-muted);
    max-width: 500px;
    font-size: 0.82rem;
    line-height: 1.5;
}

.mtab-callout {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 14px 16px;
    border-radius: 10px;
    background: rgba(99, 102, 241, 0.06);
    border-left: 3px solid #6366f1;
}

.mtab-callout i {
    color: #6366f1;
    font-size: 0.85rem;
    margin-top: 2px;
    flex-shrink: 0;
}

.mtab-callout span {
    font-size: 0.78rem;
    color: var(--text-muted);
    line-height: 1.5;
}

.mtab-callout.gold {
    background: rgba(245, 158, 11, 0.06);
    border-left-color: var(--gold);
}

.mtab-callout.gold i {
    color: var(--gold);
}

.mtab-callout.green {
    background: rgba(16, 185, 129, 0.06);
    border-left-color: #10b981;
}

.mtab-callout.green i {
    color: #10b981;
}

.mtab-callout.purple {
    background: rgba(168, 85, 247, 0.06);
    border-left-color: #a855f7;
}

.mtab-callout.purple i {
    color: #a855f7;
}

.mtab-card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 12px;
}

.mtab-card-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.mtab-btn-row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
}

.mtab-btn-row button {
    font-size: 0.72rem;
}

.mobile-drawer-overlay {
    display: none;
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 90;
    opacity: 0;
    transition: opacity 0.3s ease;
}
.mobile-drawer-overlay.open {
    opacity: 1;
}

.mobile-hamburger {
    display: none; 
}

@media (max-width: 768px) {

    
    .ps-modern-modal.app-container {
        width: 100% !important;
        max-width: 100% !important;
        height: auto !important;
        max-height: none !important;
        position: absolute !important;
        top: 0 !important;
        bottom: 0 !important;
        left: 0 !important;
        right: 0 !important;
        border-radius: 0 !important;
        border: none !important;
        padding-top: env(safe-area-inset-top, 0px) !important;
    }

    #prompt-slot-modal-overlay {
        align-items: stretch !important;
        padding: 0 !important;
    }

    
    #prompt-slot-fixed-btn {
        width: 44px;
        height: 44px;
        border-radius: 50%;
    }

    
    .dock {
        position: absolute !important;
        top: 0 !important;
        bottom: 0 !important;
        left: 0 !important;
        right: auto !important;
        width: 280px !important;
        height: 100% !important;
        padding: 20px 0 0 0 !important;
        border-radius: 0 !important;
        border: none !important;
        border-right: 1px solid rgba(255, 255, 255, 0.08) !important;
        flex-direction: column !important;
        overflow-x: hidden !important;
        overflow-y: auto !important;
        gap: 0 !important;
        z-index: 100 !important;
        background: var(--bg-panel) !important;
        backdrop-filter: blur(20px) !important;
        box-shadow: 10px 0 40px rgba(0, 0, 0, 0.6) !important;

        
        transform: translateX(-100%);
        transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
    }

    .dock.mobile-open {
        transform: translateX(0) !important;
    }

    
    .mobile-drawer-overlay.open {
        display: block;
        opacity: 1;
    }

    
    .dock:hover {
        width: 280px !important;
        box-shadow: 10px 0 40px rgba(0, 0, 0, 0.6) !important;
    }

    
    .mobile-drawer-header {
        padding: 0 20px 16px 20px;
        margin-bottom: 8px;
        border-bottom: 1px solid var(--border-color);
        flex-shrink: 0;
    }
    .mobile-drawer-header h3 {
        font-size: 0.7rem;
        font-weight: 700;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 1px;
        margin: 0;
    }

    
    .dock-icon {
        flex-direction: row !important;
        width: 100% !important;
        height: 46px !important;
        padding: 0 20px !important;
        margin: 0 !important;
        margin-bottom: 2px !important;
        font-size: 0.85rem !important;
        font-weight: 600 !important;
        gap: 0 !important;
        justify-content: flex-start !important;
        align-items: center !important;
        flex-shrink: 0 !important;
        border-radius: 0 !important;
        color: var(--text-muted) !important;
        transition: background 0.15s ease, color 0.15s ease !important;
    }

    .dock-icon i {
        margin-right: 14px !important;
        font-size: 1rem !important;
        width: 20px !important;
        text-align: center !important;
    }

    .dock-icon span {
        opacity: 1 !important;
        pointer-events: auto !important;
        font-size: 0.85rem !important;
        white-space: nowrap !important;
    }

    .dock:hover .dock-icon span {
        transition-delay: 0s !important;
    }

    .dock-icon:hover,
    .dock-icon:active {
        margin-left: 0 !important;
        width: 100% !important;
        border-radius: 0 !important;
        background: rgba(255, 255, 255, 0.05) !important;
        color: var(--text-main) !important;
    }

    .dock-icon.active {
        margin-left: 0 !important;
        width: 100% !important;
        border-radius: 0 !important;
        background: rgba(245, 158, 11, 0.1) !important;
        color: var(--gold) !important;
        border-left: 3px solid var(--gold) !important;
    }

    
    .mobile-drawer-footer {
        margin-top: auto;
        padding: 12px 16px;
        border-top: 1px solid var(--border-color);
        display: flex;
        flex-direction: column;
        gap: 6px;
        flex-shrink: 0;
    }
    .mobile-drawer-footer-btn {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        border-radius: 8px;
        background: var(--bg-main);
        border: 1px solid var(--border-color);
        color: var(--text-muted);
        font-family: 'Inter', sans-serif;
        font-size: 0.78rem;
        font-weight: 600;
        cursor: pointer;
        transition: 0.15s;
    }
    .mobile-drawer-footer-btn:hover {
        background: rgba(255, 255, 255, 0.05);
    }
    .mobile-drawer-footer-btn.danger {
        color: #ef4444;
        border-color: rgba(239, 68, 68, 0.3);
    }
    .mobile-drawer-footer-btn.sync-global {
        color: var(--gold);
        border-color: rgba(245, 158, 11, 0.3);
    }

    
    .hero-banner {
        height: auto !important;
        min-height: 150px !important;
    }

    .hero-overlay {
        background: linear-gradient(
            to right,
            rgba(0, 0, 0, 0.85) 0%,
            rgba(24, 24, 27, 0.3) 60%,
            rgba(24, 24, 27, 0.7) 100%
        ) !important;
    }

    .hero-content {
        padding: 0 16px 14px 16px !important;
    }

    .hero-content .name {
        font-size: 1.4rem !important;
        max-width: calc(100vw - 32px);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .hero-content .status {
        font-size: 0.6rem !important;
    }

    
    .top-app-bar {
        padding-top: calc(10px + env(safe-area-inset-top, 0px)) !important;
        padding-bottom: 10px !important;
        padding-left: calc(12px + env(safe-area-inset-left, 0px)) !important;
        padding-right: calc(12px + env(safe-area-inset-right, 0px)) !important;
        justify-content: space-between !important;
    }

    
    .mobile-hamburger {
        display: flex !important;
        width: 38px;
        height: 38px;
        border-radius: 10px;
        background: rgba(0, 0, 0, 0.5);
        border: 1px solid var(--border-color);
        backdrop-filter: blur(5px);
        color: var(--text-main);
        align-items: center;
        justify-content: center;
        font-size: 1rem;
        cursor: pointer;
        flex-shrink: 0;
        transition: background 0.2s ease;
        -webkit-tap-highlight-color: transparent;
    }
    .mobile-hamburger:active {
        background: rgba(255, 255, 255, 0.15);
    }

    .app-actions {
        gap: 6px !important;
        flex-wrap: nowrap !important;
        justify-content: flex-end !important;
    }

    .app-actions .ps-modern-btn {
        padding: 6px 10px !important;
        font-size: 0 !important;  
    }

    .app-actions .ps-modern-btn i {
        font-size: 0.85rem !important;
    }

    
    #ps_btn_save_close {
        font-size: 0.7rem !important;
        padding: 8px 12px !important;
    }

    
    #ps_live_token_count {
        padding: 6px 10px !important;
        font-size: 0.7rem !important;
    }

    
    .main-content {
        padding: 10px 14px 20px 14px !important;
        margin-top: -30px !important; 
    }

    
    .ps-grid {
        grid-template-columns: 1fr !important;
        gap: 10px !important;
    }

    .ps-card {
        padding: 14px !important;
    }

    .ps-card-title {
        font-size: 0.95rem !important;
    }

    
    .ps-toggle-card {
        padding: 14px 16px !important;
    }

    
    .ps-modern-input {
        font-size: 0.85rem !important;
    }

    
    .ps-modern-tag {
        padding: 5px 10px !important;
        font-size: 0.75rem !important;
        margin: 2px !important;
    }

    
    .ps-modern-btn {
        padding: 10px 14px !important;
        font-size: 0.8rem !important;
        min-height: 40px;
    }

    
    .main-content div[style*="display: flex"][style*="align-items: center"][style*="gap: 15px"] {
        flex-wrap: wrap !important;
    }

    .main-content div[style*="display: flex"][style*="align-items: center"][style*="gap: 15px"] .ps-modern-input[style*="width: 200px"],
    .main-content div[style*="display: flex"][style*="align-items: center"][style*="gap: 15px"] select[style*="width: 200px"] {
        width: 100% !important;
    }

    
    div[style*="display: grid"][style*="grid-template-columns: 1fr 1fr"] {
        grid-template-columns: 1fr !important;
    }

    
    div[style*="display: grid"][style*="grid-template-columns: 1fr 1fr"][style*="gap: 15px"] {
        grid-template-columns: 1fr !important;
    }

    
    div[style*="display: flex"][style*="gap: 10px"] select[style*="flex: 2"],
    div[style*="display: flex"][style*="gap: 10px"] select[style*="flex: 1"] {
        min-width: 0 !important;
    }

    
    div[style*="display: flex"][style*="gap: 10px"][style*="margin-bottom: 20px"] {
        flex-wrap: wrap !important;
    }

    
    div[style*="display: flex"][style*="gap: 15px"][style*="margin-bottom: 20px"][style*="align-items: center"] {
        flex-direction: column !important;
        align-items: stretch !important;
    }

    
    .wf-textarea {
        min-height: 300px !important;
    }

    div[style*="width: 250px"][style*="flex-shrink: 0"] {
        display: none !important;
    }

    
    div[style*="display: flex"][style*="gap: 8px"][style*="margin-bottom: 20px"] {
        flex-wrap: wrap !important;
    }

    
    #ps-global-tooltip {
        max-width: 200px !important;
        font-size: 0.78rem !important;
    }

    
    #kazuma_progress_overlay {
        left: 10px !important;
        right: 10px !important;
        width: auto !important;
        bottom: 30px !important;
    }
}

@media (max-width: 420px) {
    .hero-banner {
        height: 120px !important;
    }

    .hero-content .name {
        font-size: 1.15rem !important;
    }

    .dock {
        width: 260px !important;
    }
    .dock:hover {
        width: 260px !important;
    }

    .dock-icon {
        height: 42px !important;
        padding: 0 16px !important;
    }
    .dock-icon span {
        font-size: 0.8rem !important;
    }

    .app-actions .ps-modern-btn {
        padding: 5px 8px !important;
    }

    #ps_btn_save_close {
        font-size: 0.65rem !important;
        padding: 6px 10px !important;
    }

    .main-content {
        padding: 8px 10px 16px 10px !important;
    }
}

.megumin_archived_text {
    opacity: 0.5 !important;
    font-style: italic !important;
    transition: opacity 0.3s ease-in-out;
}

.megumin_archived_text:hover {
    opacity: 0.8 !important; 
}

.mem-progress-container {
    width: 100%;
    height: 12px;
    background: rgba(0, 0, 0, 0.4);
    border-radius: 6px;
    overflow: hidden;
    display: flex;
    margin-top: 10px;
    border: 1px solid var(--border-color);
}

.mem-prog-working { background: #10b981; transition: width 0.4s ease; }
.mem-prog-short { background: #f59e0b; transition: width 0.4s ease; }
.mem-prog-long { background: #3b82f6; transition: width 0.4s ease; }

.mem-accordion {
    background: var(--bg-main);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    margin-bottom: 8px;
    overflow: hidden;
}

.mem-accordion-header {
    padding: 12px 16px;
    background: rgba(255, 255, 255, 0.02);
    cursor: pointer;
    font-weight: 600;
    font-size: 0.85rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.mem-accordion-header:hover { background: rgba(255, 255, 255, 0.05); }

.mem-accordion-body {
    padding: 16px;
    display: none;
    border-top: 1px solid var(--border-color);
}

.mem-accordion-body textarea {
    width: 100%;
    min-height: 100px;
    background: rgba(0,0,0,0.2);
    border: 1px solid var(--border-color);
    color: var(--text-main);
    padding: 10px;
    border-radius: 6px;
    font-family: monospace;
    font-size: 0.8rem;
    resize: vertical;
}

.mem-spinner {
    animation: spin 1s linear infinite;
    color: var(--gold);
}
@keyframes spin { 100% { transform: rotate(360deg); } }

.ps-prompt-editor {
    margin-top: 20px;
    border: 1px solid var(--border-color);
    border-radius: 12px;
    overflow: hidden;
    background: rgba(0, 0, 0, 0.15);
}

.ps-prompt-editor-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    cursor: pointer;
    transition: background 0.2s ease;
    user-select: none;
}

.ps-prompt-editor-toggle:hover {
    background: rgba(255, 255, 255, 0.03);
}

.ps-prompt-editor-toggle .pe-title {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.ps-prompt-editor-toggle .pe-title i {
    font-size: 0.75rem;
    color: #a855f7;
}

.ps-prompt-editor-toggle .pe-chevron {
    font-size: 0.7rem;
    color: var(--text-muted);
    transition: transform 0.3s ease;
}

.ps-prompt-editor.open .pe-chevron {
    transform: rotate(180deg);
}

.ps-prompt-editor-body {
    display: none;
    padding: 0 18px 18px;
}

.ps-prompt-editor.open .ps-prompt-editor-body {
    display: block;
}

.ps-prompt-field {
    margin-bottom: 16px;
}

.ps-prompt-field-label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
}

.ps-prompt-field-label .pf-name {
    font-size: 0.78rem;
    font-weight: 700;
    color: var(--text-main);
    display: flex;
    align-items: center;
    gap: 6px;
}

.ps-prompt-field-label .pf-name i {
    font-size: 0.65rem;
    color: #a855f7;
}

.ps-prompt-field-label .pf-reset {
    font-size: 0.65rem;
    font-weight: 600;
    color: var(--text-muted);
    cursor: pointer;
    padding: 3px 8px;
    border-radius: 6px;
    border: 1px solid transparent;
    transition: all 0.2s;
    background: transparent;
}

.ps-prompt-field-label .pf-reset:hover {
    color: #ef4444;
    border-color: rgba(239, 68, 68, 0.3);
    background: rgba(239, 68, 68, 0.08);
}

.ps-prompt-field textarea {
    width: 100%;
    min-height: 120px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid var(--border-color);
    color: var(--text-main);
    padding: 12px;
    border-radius: 8px;
    font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
    font-size: 0.75rem;
    line-height: 1.6;
    resize: vertical;
    outline: none;
    transition: border-color 0.2s;
    box-sizing: border-box;
}

.ps-prompt-field textarea:focus {
    border-color: rgba(168, 85, 247, 0.5);
}

.ps-prompt-field .pf-hint {
    margin-top: 5px;
    font-size: 0.68rem;
    color: var(--text-muted);
    line-height: 1.4;
}

.ps-prompt-field .pf-hint code {
    background: rgba(168, 85, 247, 0.15);
    color: #c084fc;
    padding: 1px 5px;
    border-radius: 4px;
    font-size: 0.65rem;
    font-family: 'SF Mono', 'Fira Code', monospace;
}

.ps-prompt-editor-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding-top: 10px;
    border-top: 1px solid var(--border-color);
}

.ws-layout {
    display: flex;
    gap: 20px;
    align-items: flex-start;
    margin-top: 15px;
}

.ws-sidebar {
    width: 260px; 
    flex-shrink: 0;
    background: transparent; 
    border-right: 1px solid var(--border-color); 
    padding: 0 15px 0 0;
    position: sticky;
    top: 0;
    display: flex;
    flex-direction: column;
    gap: 4px; 
}

.ws-sidebar-title {
    font-size: 0.65rem;
    color: var(--text-muted);
    text-transform: uppercase;
    font-weight: 800;
    margin-bottom: 8px;
    letter-spacing: 1px;
    padding-left: 5px;
}

.ws-nav-btn {
    width: 100%;
    background: transparent;
    border: 1px solid transparent; 
    color: var(--text-muted);
    text-align: left;
    padding: 14px 16px; 
    border-radius: 10px;
    font-weight: 600;
    font-size: 0.9rem; 
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    align-items: center;
    transition: all 0.2s ease;
    margin-bottom: 2px;
}

.ws-nav-btn i {
    width: 20px;
    text-align: center;
}

.ws-nav-btn:hover {
    background: rgba(255, 255, 255, 0.05);
    color: #fff;
}

.ws-nav-btn.active {
    background: rgba(168, 85, 247, 0.08);
    border-color: rgba(168, 85, 247, 0.3);
    color: var(--purple);
    box-shadow: 0 4px 12px rgba(0,0,0,0.15); 
}

.ws-nav-btn.active-green {
    background: rgba(16, 185, 129, 0.15);
    color: #10b981;
}

.ws-badge {
    background: rgba(0, 0, 0, 0.4);
    padding: 2px 8px;
    border-radius: 6px;
    font-size: 0.65rem;
}

.ws-main {
    flex: 1;
    min-width: 0; 
}

.ws-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 15px;
}

.ws-card {
    background: var(--bg-panel);
    border: 1px solid var(--border-color);
    border-radius: 12px;
    padding: 16px;
    cursor: pointer;
    transition: all 0.2s ease;
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
}

.ws-card:hover {
    border-color: #52525b;
    transform: translateY(-2px);
    box-shadow: 0 8px 20px rgba(0,0,0,0.3);
}

.ws-card.active {
    border-color: #10b981;
    background: rgba(16, 185, 129, 0.05);
}

.ws-card-title {
    font-weight: 700;
    font-size: 0.95rem;
    color: var(--text-main);
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 6px;
}

.ws-card-desc {
    font-size: 0.75rem;
    color: var(--text-muted);
    line-height: 1.4;
    flex: 1;
}

.ws-card-rule {
    margin-top: 12px;
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 0.7rem;
    color: var(--text-muted);
    background: rgba(0,0,0,0.3);
    padding: 8px 10px;
    border-radius: 6px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    border: 1px solid rgba(255,255,255,0.05);
}

.ws-card-actions {
    display: flex;
    gap: 8px;
    margin-top: 12px;
}

.ws-btn-small {
    flex: 1;
    background: transparent;
    border: 1px solid var(--border-color);
    color: var(--text-muted);
    padding: 6px 0;
    border-radius: 8px;
    font-size: 0.7rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
}

.ws-btn-small:hover {
    background: rgba(255,255,255,0.05);
    color: #fff;
}

@media (max-width: 850px) {
    .ws-layout {
        flex-direction: column;
    }
    .ws-sidebar {
        width: 100%;
        position: relative;
        padding: 10px;
        box-sizing: border-box;
    }
    .ws-main {
        width: 100%;
    }
}

.sd-setting-group {
    margin-bottom: 18px;
    padding-left: 2px;
}

.sd-setting-label {
    font-size: 0.8rem;
    font-weight: 700;
    color: #e4e4e7;
    margin-bottom: 10px;
    display: block;
}

.sd-setting-label .sd-label-hint {
    font-weight: 400;
    color: #71717a;
    font-size: 0.75rem;
}

.sd-rating-pills {
    display: flex;
    gap: 8px;
}

.sd-pill {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 10px;
    padding: 8px 16px;
    color: #a1a1aa;
    font-size: 0.82rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.2s ease;
}

.sd-pill:hover {
    border-color: rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.08);
}

.sd-pill.active {
    background: rgba(245, 158, 11, 0.15);
    border-color: rgba(245, 158, 11, 0.4);
    color: #f59e0b;
}

.sd-pacing-selector {
    display: flex;
    gap: 8px;
}

.sd-pacing-btn {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    padding: 14px 10px;
    cursor: pointer;
    transition: all 0.2s ease;
    font-family: inherit;
    color: #a1a1aa;
}

.sd-pacing-btn:hover {
    border-color: rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.08);
}

.sd-pacing-btn.active {
    background: rgba(245, 158, 11, 0.15);
    border-color: rgba(245, 158, 11, 0.4);
    color: #f59e0b;
}

.sd-pacing-btn i {
    font-size: 1.2rem;
    margin-bottom: 6px;
}

.sd-pacing-btn .sd-pacing-name {
    font-weight: 600;
    font-size: 0.82rem;
}

.sd-pacing-btn .sd-pacing-desc {
    font-size: 0.68rem;
    color: #71717a;
    margin-top: 2px;
}

.sd-pacing-btn.active .sd-pacing-desc {
    color: rgba(245, 158, 11, 0.7);
}

.sd-chip-container {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}

.sd-chip {
    border-radius: 20px;
    padding: 5px 12px;
    font-size: 0.72rem;
    font-weight: 600;
    font-family: inherit;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: #a1a1aa;
    cursor: pointer;
    transition: all 0.2s ease;
}

.sd-chip:hover {
    border-color: rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.08);
}

.sd-chip.active {
    background: rgba(139, 92, 246, 0.15);
    border-color: rgba(139, 92, 246, 0.4);
    color: #a78bfa;
}

.sd-genre-desc {
    font-size: 0.73rem;
    color: #71717a;
    margin-top: 6px;
    padding-left: 2px;
    line-height: 1.4;
}

.sd-directors-note-hint {
    background: rgba(245, 158, 11, 0.06);
    border: 1px solid rgba(245, 158, 11, 0.15);
    border-radius: 8px;
    padding: 10px 14px;
    margin-bottom: 12px;
    font-size: 0.78rem;
    color: #b4935a;
    line-height: 1.5;
    display: flex;
    align-items: flex-start;
    gap: 8px;
}

.sd-directors-note-hint i {
    color: #f59e0b;
    flex-shrink: 0;
    margin-top: 2px;
}

.sd-directors-note-input {
    width: 100%;
    height: 80px;
    resize: vertical;
    font-size: 0.85rem;
    line-height: 1.5;
    font-family: inherit;
    background: #0e0e11;
    border: 1px solid #27272a;
    color: #f4f4f5;
    padding: 12px 16px;
    border-radius: 8px;
    outline: none;
    transition: border-color 0.2s ease;
    box-sizing: border-box;
}

.sd-directors-note-input:focus {
    border-color: #52525b;
    background: #18181b;
}

.sd-directive-output {
    width: 100%;
    height: 300px;
    resize: vertical;
    font-size: 0.83rem;
    line-height: 1.6;
    margin-bottom: 12px;
    font-family: inherit;
    background: #0e0e11;
    border: 1px solid #27272a;
    color: #f4f4f5;
    padding: 12px 16px;
    border-radius: 8px;
    outline: none;
    transition: border-color 0.2s ease;
    box-sizing: border-box;
}

.sd-directive-output:focus {
    border-color: #52525b;
    background: #18181b;
}

:root {
  --c-brand:  #f59e0b;            
  --c-select: #ffffff;            
  --c-live:   #10b981;            
  --c-danger: #ef4444;            
  --c-info:   #3b82f6;            
  --c-ai:     #a855f7;            

  --glass:        rgba(24,24,27,.55);
  --glass-lit:    rgba(40,40,46,.72);
  --glass-line:   rgba(255,255,255,.10);
  --glass-line-hi:rgba(255,255,255,.22);
  --spec:         inset 0 1px 0 rgba(255,255,255,.08),
                  inset 0 0 0 1px rgba(255,255,255,.02);
  --spec-hi:      inset 0 1px 0 rgba(255,255,255,.16);
  --ease-spring:  cubic-bezier(.34,1.56,.64,1);
  --ease:         cubic-bezier(.22,.61,.36,1);
}

#prompt-slot-modal-overlay::before {
  content: ""; position: fixed; inset: -20%; z-index: 0; pointer-events: none;
  background:
    radial-gradient(40vw 40vw at 22% 8%,  rgba(245,158,11,.16), transparent 60%),
    radial-gradient(34vw 34vw at 86% 92%, rgba(99,102,241,.10), transparent 62%);
  filter: blur(8px);
  animation: coh-drift 30s var(--ease) infinite alternate;
}
@keyframes coh-drift {
  from { transform: translate3d(0,0,0) scale(1); }
  to   { transform: translate3d(3%,2%,0) scale(1.08); }
}

.ps-modern-modal.app-container,
.dock,
.ps-card, .mtab-eng-card, .ws-card, .wstyle-card,
.mtab-panel, .mtab-toggle-row, .wstyle-dnr-panel, .wstyle-tag-section,
.wstyle-insights-panel, .wstyle-rule-panel,
#ps-global-tooltip {
  box-shadow: var(--spec), 0 18px 40px -22px rgba(0,0,0,.8);
}
.ps-modern-modal.app-container { background: var(--glass); }
.dock { background: rgba(18,18,20,.62); }

.ps-card, .mtab-eng-card, .ws-card, .wstyle-card {
  position: relative; overflow: hidden;
  background: var(--glass);
  border-color: var(--glass-line);
  transition: transform .28s var(--ease), border-color .28s var(--ease),
              background .28s var(--ease), box-shadow .28s var(--ease);
}
.ps-card::after, .mtab-eng-card::after, .ws-card::after, .wstyle-card::after {
  content: ""; position: absolute; top: 0; left: -120%; width: 60%; height: 100%;
  background: linear-gradient(105deg, transparent, rgba(255,255,255,.10), transparent);
  transform: skewX(-18deg); transition: left .6s var(--ease); pointer-events: none;
}
.ps-card:hover::after, .mtab-eng-card:hover::after,
.ws-card:hover::after, .wstyle-card:hover::after { left: 130%; }
.ps-card:hover, .mtab-eng-card:hover, .ws-card:hover, .wstyle-card:hover {
  transform: translateY(-3px);
  border-color: var(--glass-line-hi);
  background: var(--glass-lit);
  box-shadow: var(--spec-hi), 0 22px 44px -20px rgba(0,0,0,.85);
}

.ps-card.selected,
.mtab-eng-card.active,
.ws-card.active,
.wstyle-card.active {
  background: var(--glass-lit) !important;
  border-color: rgba(245,158,11,.55) !important;
  color: var(--text-main) !important;
  box-shadow: var(--spec-hi), inset 3px 0 0 var(--c-brand),
              0 0 0 1px rgba(245,158,11,.18), 0 18px 40px -18px rgba(245,158,11,.25);
}

.ps-card.selected .ps-card-title,
.ps-card.selected .ps-card-desc,
.ps-card.selected div { color: inherit !important; }
.mtab-eng-card.active .ecard-title,
.ws-card.active .ws-card-title,
.wstyle-card.active .card-title { color: var(--text-main) !important; }
.mtab-eng-card.active .ecard-accent,
.ws-card.active .card-accent,
.wstyle-card.active .card-accent {
  background: linear-gradient(90deg, var(--c-brand), transparent) !important;
}

.ws-nav-btn.active {
  background: rgba(245,158,11,.12) !important;
  border-color: rgba(245,158,11,.34) !important;
  color: var(--c-brand) !important;
  box-shadow: inset 3px 0 0 var(--c-brand), var(--spec);
}
.ws-nav-btn.active-green {
  background: rgba(16,185,129,.12) !important;
  border-color: rgba(16,185,129,.34) !important;
  color: var(--c-live) !important;
  box-shadow: inset 3px 0 0 var(--c-live), var(--spec);
}

.ps-switch { background: #3f3f46; transition: background .3s var(--ease-spring); }
.ps-switch::after { transition: left .3s var(--ease-spring), background .3s var(--ease); }
.ps-toggle-card.active .ps-switch,
.mtab-toggle-row.active .ps-switch { background: var(--c-live) !important; }
.ps-toggle-card.active .ps-switch::after,
.mtab-toggle-row.active .ps-switch::after { left: 22px; background: #06281d; }

.wstyle-header-icon, .mtab-header-icon {
  background: var(--glass-lit) !important;
  color: var(--c-brand) !important;
  border: 1px solid var(--glass-line-hi);
  box-shadow: var(--spec-hi), 0 0 18px -6px rgba(245,158,11,.5);
}
.wstyle-header h2, .mtab-header h2 {
  font-size: 1.4rem; font-weight: 800; letter-spacing: -.03em;
}
.wstyle-header h2::before, .mtab-header h2::before {
  content: ""; display: block; width: 26px; height: 2px; margin-bottom: 6px;
  border-radius: 2px; background: linear-gradient(90deg, var(--c-brand), transparent);
}

.wstyle-section-head, .mtab-panel-title { color: var(--text-muted); }
.wstyle-section-head i, .mtab-panel-title i { color: var(--c-brand); }
.wstyle-section-head.green  i, .mtab-panel-title.green  i { color: var(--c-live); }
.wstyle-section-head.purple i, .mtab-panel-title.purple i { color: var(--c-ai); }
.wstyle-section-head.blue   i, .mtab-panel-title.blue   i { color: var(--c-info); }
.wstyle-section-head.red    i, .mtab-panel-title.red    i { color: var(--c-danger); }
.wstyle-section-head.gold   i, .mtab-panel-title.gold   i { color: var(--c-brand); }

.ecard-badge.rec   { background: rgba(245,158,11,.14); color: var(--c-brand); }
.ecard-badge.new   { background: rgba(59,130,246,.14); color: var(--c-info); }
.ecard-badge.locked{ background: rgba(113,113,122,.18); color: #a1a1aa; }
.ecard-badge.v6-active,
.ecard-badge.override { background: rgba(16,185,129,.14); color: var(--c-live); }

.wstyle-gen-btn,
#ps_btn_get_authors_style:hover {
  background: linear-gradient(135deg, rgba(168,85,247,.22), rgba(99,102,241,.16)) !important;
  color: #d8b4fe !important;
  border: 1px solid rgba(168,85,247,.45);
  box-shadow: var(--spec), 0 8px 22px -10px rgba(168,85,247,.5);
}
.wstyle-tag.selected {
  background: rgba(168,85,247,.16); border-color: rgba(168,85,247,.45); color: #d8b4fe;
}
.wstyle-rule-panel textarea:focus,
.ps-prompt-field textarea:focus { border-color: rgba(168,85,247,.55); }

.ps-modern-btn.primary {
  background: linear-gradient(180deg, #ffffff, #e4e4e7);
  color: #0a0a0a; box-shadow: var(--spec-hi), 0 10px 24px -12px rgba(255,255,255,.4);
}
.ps-modern-btn.secondary { box-shadow: var(--spec); }

.wstyle-filter-pill.active {
  background: var(--glass-lit); color: var(--text-main);
  box-shadow: var(--spec-hi), inset 0 -2px 0 var(--c-brand);
}
.wstyle-filter-pill.active .pill-count { background: rgba(245,158,11,.22); color: var(--c-brand); }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}

.cfg-master {
  display: flex; align-items: center; justify-content: space-between; gap: 14px;
  padding: 14px 16px; margin: 14px 0 12px;
  border: 1px solid var(--border-color); border-radius: 12px;
  background: rgba(0,0,0,.22);
  transition: border-color .18s ease, background .18s ease;
}
.cfg-master.active { border-color: rgba(16,185,129,.45); background: rgba(16,185,129,.06); }
.cfg-master-title { font-size: .85rem; font-weight: 700; color: var(--text-main); }
.cfg-master-title i { color: var(--gold); margin-right: 6px; }
.cfg-master-desc { font-size: .68rem; color: var(--text-muted); margin-top: 4px; line-height: 1.35; }

.cfg-preset-bar {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
  padding: 10px 12px; margin-bottom: 16px;
  border: 1px solid var(--border-color); border-radius: 10px;
  background: rgba(0,0,0,.15);
}

.cfg-fields { display: flex; flex-direction: column; gap: 12px; }
.cfg-fields.disabled { opacity: .45; pointer-events: none; filter: grayscale(.4); }

.cfg-row {
  border: 1px solid var(--border-color); border-left: 3px solid var(--border-color);
  border-radius: 10px; background: rgba(0,0,0,.18);
  transition: border-color .18s ease, background .18s ease;
  overflow: hidden;
}
.cfg-row.on { border-left-color: #10b981; background: rgba(16,185,129,.05); }
.cfg-row.open { background: rgba(255,255,255,.03); }
.cfg-row.on.open { background: rgba(16,185,129,.07); }

.cfg-row-head {
  display: flex; align-items: center; gap: 10px;
  padding: 11px 14px; cursor: pointer; user-select: none;
}
.cfg-row-head:hover { background: rgba(255,255,255,.03); }
.cfg-row-label {
  font-size: .8rem; font-weight: 700; color: var(--text-main);
  display: flex; align-items: center; gap: 8px; flex: 0 0 auto;
}
.cfg-row-summary {
  flex: 1 1 auto; min-width: 0; text-align: right;
  font-size: .68rem; color: var(--text-muted);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.cfg-row.on .cfg-row-summary { color: #10b981; }
.cfg-row-chev {
  flex: 0 0 auto; font-size: .65rem; color: var(--text-muted);
  transition: transform .2s ease;
}
.cfg-row.open .cfg-row-chev { transform: rotate(180deg); }

.cfg-row-body { display: none; padding: 0 14px 14px; }
.cfg-row.open .cfg-row-body { display: block; }
.cfg-row-hint { font-size: .66rem; color: var(--text-muted); margin: 0 0 10px; line-height: 1.45; }

.cfg-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.cfg-chip { cursor: pointer; }

.meg-blocks {
  margin: 14px 0 4px;
  border: 1px solid var(--border-color, rgba(255,255,255,.14));
  border-radius: 12px;
  background: rgba(0,0,0,.22);
  overflow: hidden;
}
.meg-blocks.meg-blocks-empty { display: none; }

.meg-blocks-tabs {
  display: flex; align-items: stretch; gap: 0;
  background: rgba(0,0,0,.28);
  border-bottom: 1px solid var(--border-color, rgba(255,255,255,.12));
  overflow-x: auto; scrollbar-width: thin;
}
.meg-blocks-tab {
  display: flex; align-items: center; gap: 7px;
  padding: 9px 15px; cursor: pointer; white-space: nowrap;
  background: transparent; border: 0;
  border-right: 1px solid var(--border-color, rgba(255,255,255,.1));
  border-bottom: 2px solid transparent;
  color: var(--text-muted, #9aa0a6);
  font-size: .74rem; font-weight: 600; font-family: inherit;
  transition: background .15s ease, color .15s ease;
}
.meg-blocks-tab:hover { background: rgba(255,255,255,.05); color: var(--text-main, #e8e8e8); }
.meg-blocks-tab.active {
  background: rgba(245,158,11,.1);
  color: var(--text-main, #e8e8e8);
  border-bottom-color: #f59e0b;
}
.meg-blocks-tab-emoji { font-size: .85rem; }
.meg-blocks-tab-label { max-width: 160px; overflow: hidden; text-overflow: ellipsis; }

.meg-blocks-collapse {
  margin-left: auto; padding: 9px 14px; cursor: pointer;
  background: transparent; border: 0; border-left: 1px solid var(--border-color, rgba(255,255,255,.1));
  color: var(--text-muted, #9aa0a6); font-size: .7rem;
}
.meg-blocks-collapse:hover { background: rgba(255,255,255,.05); color: var(--text-main, #e8e8e8); }
.meg-blocks-collapse i { transition: transform .2s ease; display: inline-block; }
.meg-blocks.meg-blocks-shut .meg-blocks-collapse i { transform: rotate(-90deg); }

.meg-blocks.meg-blocks-shut .meg-blocks-panel { display: none; }
.meg-blocks.meg-blocks-shut .meg-blocks-tabs { border-bottom: 0; }

.meg-blocks-panel { padding: 12px 14px; }
.meg-block-body.meg-block-truncated { opacity: .85; }

.meg-block-flag {
  font-size: .52rem; font-weight: 800; text-transform: uppercase; letter-spacing: .05em;
  padding: 1px 5px; border-radius: 999px;
  background: rgba(239,68,68,.15); color: #ef4444; border: 1px solid rgba(239,68,68,.3);
}

.meg-block-body p { margin: 0 0 6px; font-size: .8rem; line-height: 1.5; }
.meg-block-body p:last-child { margin-bottom: 0; }
.meg-block-body ul { margin: 0 0 8px; padding-left: 20px; }
.meg-block-body li { font-size: .8rem; line-height: 1.5; margin-bottom: 3px; }
.meg-block-body hr {
  border: 0; border-top: 1px solid var(--border-color, rgba(255,255,255,.12));
  margin: 8px 0;
}
.meg-block-body code {
  font-size: .75rem; padding: 1px 4px; border-radius: 4px;
  background: rgba(255,255,255,.07);
}

.blk-layout { display: flex; gap: 18px; align-items: flex-start; flex-wrap: wrap; }
.blk-col { flex: 1 1 320px; min-width: 300px; }

.blk-stack { display: flex; flex-direction: column; gap: 8px; }
.blk-row {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 10px 12px; border: 1px solid var(--border-color); border-radius: 10px;
  background: rgba(0,0,0,.18);
}
.blk-row-off { opacity: .55; }
.blk-row-main { display: flex; align-items: center; gap: 10px; min-width: 0; }
.blk-emoji { font-size: 1rem; }
.blk-name { font-size: .8rem; font-weight: 700; color: var(--text-main); }
.blk-tag {
  font-size: .62rem; color: var(--text-muted); margin-top: 2px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.blk-custom-flag {
  font-size: .52rem; font-weight: 800; text-transform: uppercase; letter-spacing: .05em;
  padding: 1px 5px; border-radius: 999px; margin-left: 4px;
  background: rgba(56,189,248,.15); color: #38bdf8; border: 1px solid rgba(56,189,248,.3);
}
.blk-row-actions { display: flex; align-items: center; gap: 5px; flex-shrink: 0; }
.blk-row-actions .ws-btn-small { padding: 4px 7px; }
.blk-row-actions .ws-btn-small[disabled] { opacity: .3; cursor: not-allowed; }
.blk-vis { padding: 4px 6px; font-size: .68rem; width: 92px; cursor: pointer; }

.blk-pool { display: flex; flex-wrap: wrap; gap: 8px; }
.blk-add {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 7px 12px; border-radius: 999px; cursor: pointer;
  font-size: .72rem; font-weight: 600; color: var(--text-main);
  background: rgba(255,255,255,.04); border: 1px dashed var(--border-color);
}
.blk-add:hover { background: rgba(255,255,255,.08); border-color: var(--gold); }
.blk-add-new { color: #10b981; border-color: rgba(16,185,129,.45); }

.blk-empty {
  padding: 14px; border: 1px dashed var(--border-color); border-radius: 10px;
  font-size: .72rem; color: var(--text-muted); text-align: center;
}
.blk-preview-note { font-size: .66rem; color: var(--text-muted); margin-bottom: 10px; }
.blk-preview .meg-blocks { margin-top: 0; }
.blk-preview-source {
  margin-top: 8px; font-size: .62rem; color: var(--text-muted); font-style: italic;
}

.blk-sub {
  margin: -4px 0 2px 0; padding: 10px 12px 10px 34px;
  border: 1px solid var(--border-color); border-top: 0;
  border-radius: 0 0 10px 10px;
  background: rgba(0,0,0,.28);
  display: flex; flex-direction: column; gap: 9px;
}
.blk-sub-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.blk-sub-label { font-size: .72rem; font-weight: 600; color: var(--text-main); }
.blk-sub-desc { font-size: .62rem; color: var(--text-muted); margin-top: 2px; line-height: 1.35; }

.blk-row-system { background: rgba(59,130,246,.05); border-style: dashed; }
.blk-sys-flag {
  font-size: .58rem; font-weight: 800; letter-spacing: .04em;
  padding: 3px 9px; border-radius: 999px;
  background: rgba(59,130,246,.14); color: #60a5fa; border: 1px solid rgba(59,130,246,.3);
}

.meg-stat-row { margin-bottom: 12px; }
.meg-stat-row:last-child { margin-bottom: 0; }
.meg-stat-subject {
  font-size: .78rem; font-weight: 700; color: var(--text-main, #e8e8e8);
  margin-bottom: 6px; padding-bottom: 4px;
  border-bottom: 1px solid var(--border-color, rgba(255,255,255,.1));
}
.meg-stat-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px 14px;
}
.meg-stat-top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.meg-stat-label {
  font-size: .68rem; font-weight: 600; letter-spacing: .02em;
  color: var(--text-muted, #9aa0a6);
}
.meg-stat-value { font-size: .78rem; font-weight: 700; color: var(--text-main, #e8e8e8); }
.meg-stat-max { font-size: .62rem; font-weight: 500; color: var(--text-muted, #9aa0a6); }
.meg-stat-bar {
  height: 5px; margin-top: 4px; border-radius: 999px; overflow: hidden;
  background: rgba(255,255,255,.08);
}
.meg-stat-fill {
  height: 100%; border-radius: 999px;
  background: linear-gradient(90deg, #f43f5e, #fb7185);
  transition: width .3s ease;
}
.meg-stat-note { font-size: .62rem; margin-top: 3px; color: var(--text-muted, #9aa0a6); line-height: 1.35; }
.meg-stat-note.meg-stat-up { color: #10b981; }
.meg-stat-note.meg-stat-down { color: #ef4444; }
.meg-stat-plain .meg-stat-top { padding-bottom: 2px; }

.blk-sub-fields { padding-left: 12px; }
.stat-field-list { display: flex; flex-direction: column; gap: 6px; }
.stat-field { display: flex; align-items: center; gap: 6px; }
.stat-field .sf-label { flex: 1 1 auto; min-width: 90px; padding: 5px 8px; font-size: .72rem; }
.stat-field .sf-type { width: 92px; padding: 5px; font-size: .68rem; cursor: pointer; }
.stat-field .sf-max,
.stat-field .sf-start { width: 62px; padding: 5px; font-size: .68rem; text-align: center; }
.stat-field .ws-btn-small { padding: 4px 7px; }
.stat-field .ws-btn-small[disabled] { opacity: .3; cursor: not-allowed; }
`;

const ST_PARITY_CSS = String.raw`.meg-overlay {
    --bg-main: #0e0e11;
    --bg-panel: #18181b;
    --border-color: #27272a;
    --text-main: #f4f4f5;
    --text-muted: #a1a1aa;
    --accent-color: #ffffff;
    --gold: #f59e0b;
}

#prompt-slot-fixed-btn {
    position: fixed;
    top: 60px;
    right: 20px;
    z-index: 9999;
    width: 48px;
    height: 48px;
    border-radius: 12px;
    background: var(--bg-panel);
    color: var(--text-main);
    font-size: 1.4rem;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    border: 1px solid var(--border-color);
    transition: background-color 0.2s ease, transform 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
}

#prompt-slot-fixed-btn:hover {
    background: #27272a;
    transform: translateY(-2px);
}

#prompt-slot-modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    height: 100dvh;
    background-color: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(4px);
    z-index: 10000;
    display: none;
    align-items: center;
    justify-content: center;
    font-family: 'Inter', sans-serif;
}

/* The Main App Window */
.ps-modern-modal.app-container {
    width: 1050px;
    max-width: 95vw;
    height: 85vh;
    max-height: 850px;
    background: var(--bg-panel);
    border: 1px solid var(--border-color);
    border-radius: 16px;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
    color: var(--text-main);
    display: flex;
    flex-direction: column;
    position: relative;
    overflow: hidden;
}

.main-wrapper {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

/* Full Width Hero Banner */
.hero-banner {
    height: 200px;
    width: 100%;
    background-position: center 25%;
    background-size: cover;
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    flex-shrink: 0;
}

.hero-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(to right, rgba(0, 0, 0, 0.9) 0%, rgba(24, 24, 27, 0.4) 50%, rgba(24, 24, 27, 0.8) 100%);
}

.hero-overlay::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(to top, var(--bg-panel) 0%, transparent 100%);
}

/* Top App Bar (Action Buttons) */
.top-app-bar {
    position: relative;
    z-index: 2;
    padding: 20px 30px;
    display: flex;
    justify-content: flex-end;
}

.app-actions {
    display: flex;
    gap: 10px;
    align-items: center;
}

/* Hero Text */
.hero-content {
    position: relative;
    z-index: 2;
    padding: 0 30px 25px 100px;
}

.hero-content .status {
    font-size: 0.7rem;
    font-weight: 800;
    color: #a855f7;
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-bottom: 5px;
    text-shadow: 0 2px 4px rgba(0, 0, 0, 0.8);
}

.hero-content .name {
    font-size: 2.2rem;
    font-weight: 800;
    margin: 0;
    text-shadow: 0 4px 10px rgba(0, 0, 0, 0.8);
    color: #fff;
    line-height: 1.1;
}

/* Floating Glass Dock */
.dock {
    position: absolute;
    top: 20px;
    bottom: 20px;
    left: 20px;
    width: 60px;
    background: rgba(18, 18, 20, 0.7);
    backdrop-filter: blur(15px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    padding-top: 15px;
    transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    overflow: hidden;
    white-space: nowrap;
    z-index: 50;
}

.dock:hover {
    width: 240px;
    box-shadow: 10px 10px 40px rgba(0, 0, 0, 0.8);
}

.dock-icon {
    display: flex;
    align-items: center;
    width: 240px;
    height: 50px;
    padding: 0 20px;
    color: #a1a1aa;
    cursor: pointer;
    transition: 0.2s;
    font-weight: 600;
    font-size: 0.9rem;
    margin-bottom: 5px;
}

.dock-icon i {
    width: 20px;
    text-align: center;
    margin-right: 15px;
    font-size: 1.1rem;
}

.dock-icon:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    margin-left: 10px;
    width: 220px;
}

.dock-icon.active {
    color: #f59e0b;
    background: rgba(245, 158, 11, 0.15);
    border-radius: 8px;
    margin-left: 10px;
    width: 220px;
}

.dock-icon span {
    opacity: 0;
    transition: opacity 0.2s;
    pointer-events: none;
}

.dock:hover .dock-icon span {
    opacity: 1;
    transition-delay: 0.1s;
}

/* Main Content Area */
.main-content {
    padding: 10px 40px 40px 100px;
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 20px;
}

.main-content::-webkit-scrollbar {
    width: 6px;
}

.main-content::-webkit-scrollbar-thumb {
    background: var(--border-color);
    border-radius: 3px;
}

/* UI Components */
.ps-rule-title {
    font-size: 0.7rem;
    font-weight: 700;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 1px;
}

.ps-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 16px;
}

.ps-card {
    background: var(--bg-main);
    border: 1px solid var(--border-color);
    border-radius: 12px;
    padding: 20px;
    position: relative;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
}

.ps-card:hover {
    border-color: #52525b;
    transform: translateY(-2px);
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.4);
}

.ps-card.selected {
    border-color: var(--text-main);
    background: var(--text-main);
    color: #000;
}

.ps-card.selected .ps-card-title {
    color: #000;
}

.ps-card.selected .ps-card-desc,
.ps-card.selected div {
    color: #444;
}

.ps-card-title {
    font-size: 1.05rem;
    font-weight: 600;
    color: var(--text-main);
    margin-bottom: 6px;
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.ps-card-desc {
    font-size: 0.8rem;
    color: var(--text-muted);
    line-height: 1.5;
    margin-top: 4px;
}

.ps-rec-text {
    font-size: 0.65rem;
    font-weight: 800;
    color: var(--gold);
    display: flex;
    align-items: center;
    gap: 4px;
    text-transform: uppercase;
    margin: 0;
}

.ps-toggle-card {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: var(--bg-main);
    border: 1px solid var(--border-color);
    border-radius: 12px;
    padding: 18px 24px;
    cursor: pointer;
    transition: 0.2s;
}

.ps-toggle-card:hover {
    border-color: #52525b;
}

.ps-toggle-card.active {
    border-color: var(--accent-color);
    background: #27272a;
}

.ps-switch {
    width: 44px;
    height: 24px;
    background: #3f3f46;
    border-radius: 12px;
    position: relative;
    transition: 0.3s;
}

.ps-switch::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 20px;
    height: 20px;
    background: #fff;
    border-radius: 50%;
    transition: 0.3s;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.ps-toggle-card.active .ps-switch {
    background: var(--accent-color);
}

.ps-toggle-card.active .ps-switch::after {
    left: 22px;
    background: #000;
}

.ps-modern-tag {
    display: inline-block;
    padding: 6px 14px;
    margin: 4px;
    background: var(--bg-main);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.8rem;
    font-weight: 500;
    color: var(--text-main);
    transition: 0.2s;
}

.ps-modern-tag:hover {
    border-color: #52525b;
    background: #27272a;
}

.ps-modern-tag.selected {
    background: var(--text-main);
    color: #000;
    border-color: var(--text-main);
    font-weight: 600;
}

.ps-modern-input {
    width: 100%;
    background: var(--bg-main);
    border: 1px solid var(--border-color);
    color: var(--text-main);
    padding: 12px 16px;
    border-radius: 8px;
    font-family: inherit;
    font-size: 0.85rem;
    outline: none;
    transition: 0.2s;
    box-sizing: border-box;
}

.ps-modern-input:focus {
    border-color: var(--text-muted);
    background: var(--bg-panel);
}

.ps-modern-btn {
    border-radius: 8px;
    font-weight: 600;
    font-size: 0.85rem;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px 20px;
}

.ps-modern-btn.primary {
    background: var(--text-main);
    color: #000;
    border: none;
}

.ps-modern-btn.primary:hover:not(:disabled) {
    background: #d4d4d8;
    transform: translateY(-1px);
}

.ps-modern-btn.secondary {
    background: rgba(0, 0, 0, 0.5);
    color: var(--text-main);
    border: 1px solid var(--border-color);
    backdrop-filter: blur(5px);
}

.ps-modern-btn.secondary:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.1);
    border-color: #52525b;
}

.ps-modern-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

#ps-global-tooltip {
    position: fixed;
    background: #2a2a2b;
    color: #f4f4f5;
    padding: 8px 14px;
    border-radius: 8px;
    font-size: 0.85rem;
    font-weight: 500;
    width: max-content;
    max-width: 280px;
    white-space: normal;
    line-height: 1.4;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.7);
    border: 1px solid var(--border-color);
    pointer-events: none;
    z-index: 999999;
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.15s ease-in-out;
}

#ps-global-tooltip.visible {
    opacity: 1;
    visibility: visible;
}

.ps-tooltip-title {
    color: var(--gold);
    font-weight: 700;
}

/* ================================================================
   WRITING STYLE TAB — Premium Redesign
   ================================================================ */

/* — Header — */
.wstyle-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 24px;
    padding-bottom: 20px;
    border-bottom: 1px solid var(--border-color);
}

.wstyle-header-left {
    display: flex;
    align-items: center;
    gap: 14px;
}

.wstyle-header-icon {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    background: linear-gradient(135deg, #a855f7 0%, #6366f1 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.2rem;
    color: #fff;
    flex-shrink: 0;
    box-shadow: 0 4px 15px rgba(168, 85, 247, 0.3);
}

.wstyle-header h2 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 800;
    color: var(--text-main);
    letter-spacing: -0.02em;
}

.wstyle-header p {
    margin: 2px 0 0;
    font-size: 0.78rem;
    color: var(--text-muted);
}

/* — Active Style Badge — */
.wstyle-active-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    border-radius: 20px;
    font-size: 0.75rem;
    font-weight: 700;
    background: rgba(16, 185, 129, 0.12);
    color: #10b981;
    border: 1px solid rgba(16, 185, 129, 0.25);
    white-space: nowrap;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.wstyle-active-badge.off {
    background: rgba(161, 161, 170, 0.1);
    color: var(--text-muted);
    border-color: var(--border-color);
}

.wstyle-active-badge i {
    font-size: 0.65rem;
}

/* — Filter Pills — */
.wstyle-filters {
    display: flex;
    gap: 6px;
    margin-bottom: 20px;
    flex-wrap: wrap;
    padding: 4px;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 12px;
    border: 1px solid var(--border-color);
}

.wstyle-filter-pill {
    padding: 8px 18px;
    border-radius: 10px;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-muted);
    background: transparent;
    border: none;
    cursor: pointer;
    transition: all 0.25s ease;
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
}

.wstyle-filter-pill:hover {
    color: var(--text-main);
    background: rgba(255, 255, 255, 0.05);
}

.wstyle-filter-pill.active {
    color: #fff;
    background: rgba(255, 255, 255, 0.1);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.wstyle-filter-pill .pill-count {
    font-size: 0.65rem;
    padding: 1px 6px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-muted);
    font-weight: 700;
}

.wstyle-filter-pill.active .pill-count {
    background: rgba(255, 255, 255, 0.15);
    color: #fff;
}

/* — Section Headers — */
.wstyle-section-head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 20px 0 12px;
    font-size: 0.72rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    color: var(--text-muted);
}

.wstyle-section-head::after {
    content: '';
    flex: 1;
    height: 1px;
    background: linear-gradient(to right, var(--border-color), transparent);
}

.wstyle-section-head i {
    font-size: 0.7rem;
}

.wstyle-section-head.gold {
    color: var(--gold);
}

.wstyle-section-head.green {
    color: #10b981;
}

.wstyle-section-head.purple {
    color: #a855f7;
}

.wstyle-section-head.blue {
    color: #3b82f6;
}

.wstyle-section-head.red {
    color: #ef4444;
}

/* — Style Cards (Precooked & Custom) — */
.wstyle-card {
    position: relative;
    display: flex;
    flex-direction: column;
    background: var(--bg-main);
    border: 1px solid var(--border-color);
    border-radius: 14px;
    overflow: hidden;
    cursor: pointer;
    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.wstyle-card:hover {
    border-color: #52525b;
    transform: translateY(-2px);
    box-shadow: 0 8px 25px rgba(0, 0, 0, 0.4);
}

.wstyle-card .card-accent {
    height: 3px;
    width: 100%;
    background: linear-gradient(90deg, var(--border-color), transparent);
    transition: background 0.3s ease;
}

.wstyle-card:hover .card-accent {
    background: linear-gradient(90deg, #a855f7, #6366f1, transparent);
}

.wstyle-card.active .card-accent {
    background: linear-gradient(90deg, #10b981, #059669) !important;
}

.wstyle-card .card-body {
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.wstyle-card .card-top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
}

.wstyle-card .card-title {
    font-weight: 700;
    font-size: 0.95rem;
    color: var(--text-main);
    display: flex;
    align-items: center;
    gap: 8px;
}

.wstyle-card .card-desc {
    font-size: 0.78rem;
    color: var(--text-muted);
    line-height: 1.5;
    margin: 0;
}

.wstyle-card .card-rule {
    font-size: 0.73rem;
    font-family: 'SF Mono', 'Fira Code', monospace;
    background: rgba(0, 0, 0, 0.3);
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.04);
    color: var(--text-muted);
    max-height: 52px;
    overflow: hidden;
    line-height: 1.5;
    -webkit-mask-image: linear-gradient(to bottom, #000 60%, transparent);
    mask-image: linear-gradient(to bottom, #000 60%, transparent);
}

.wstyle-card .card-status {
    font-size: 0.68rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    border-radius: 8px;
    white-space: nowrap;
}

.wstyle-card .card-status.active-status {
    background: rgba(16, 185, 129, 0.15);
    color: #10b981;
}

.wstyle-card .card-actions {
    display: flex;
    gap: 6px;
    margin-top: 4px;
    flex-wrap: wrap;
}

.wstyle-card .card-actions button {
    padding: 5px 12px;
    font-size: 0.7rem;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    border: 1px solid var(--border-color);
    background: transparent;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    gap: 5px;
}

.wstyle-card .card-actions button:hover {
    background: rgba(255, 255, 255, 0.06);
    border-color: #52525b;
    color: var(--text-main);
}

.wstyle-card .card-actions button.act-delete:hover {
    background: rgba(239, 68, 68, 0.1);
    border-color: rgba(239, 68, 68, 0.3);
    color: #ef4444;
}

.wstyle-card .card-actions button.act-regen:hover {
    background: rgba(245, 158, 11, 0.1);
    border-color: rgba(245, 158, 11, 0.3);
    color: var(--gold);
}

/* Active card state */
.wstyle-card.active {
    border-color: #10b981;
    background: rgba(16, 185, 129, 0.04);
}

.wstyle-card.active .card-title {
    color: #10b981;
}

/* — Off Card — */
.wstyle-off-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--bg-main);
    border: 1px solid var(--border-color);
    border-radius: 14px;
    padding: 16px 20px;
    cursor: pointer;
    transition: all 0.25s ease;
    margin-bottom: 8px;
}

.wstyle-off-card:hover {
    border-color: #52525b;
}

.wstyle-off-card.active {
    border-color: var(--text-muted);
    background: rgba(255, 255, 255, 0.04);
}

.wstyle-off-card .off-left {
    display: flex;
    align-items: center;
    gap: 12px;
}

.wstyle-off-card .off-icon {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.06);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    font-size: 0.95rem;
}

.wstyle-off-card.active .off-icon {
    color: var(--text-main);
    background: rgba(255, 255, 255, 0.1);
}

/* — DN Ratio Panel — */
.wstyle-dnr-panel {
    background: var(--bg-main);
    border: 1px solid var(--border-color);
    border-radius: 14px;
    overflow: hidden;
    margin-bottom: 8px;
}

.wstyle-dnr-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    cursor: pointer;
    transition: background 0.2s;
}

.wstyle-dnr-header:hover {
    background: rgba(255, 255, 255, 0.02);
}

.wstyle-dnr-header .dnr-info {
    display: flex;
    align-items: center;
    gap: 12px;
}

.wstyle-dnr-header .dnr-icon {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: linear-gradient(135deg, rgba(245, 158, 11, 0.15), rgba(245, 158, 11, 0.05));
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--gold);
    font-size: 0.95rem;
}

.wstyle-dnr-body {
    padding: 0 20px 20px;
    display: none;
}

.wstyle-dnr-body.open {
    display: block;
}

.wstyle-dnr-slider-track {
    display: flex;
    align-items: center;
    gap: 14px;
    background: rgba(0, 0, 0, 0.25);
    padding: 14px 16px;
    border-radius: 10px;
    border: 1px solid var(--border-color);
}

.wstyle-dnr-slider-track input[type="range"] {
    flex: 1;
    accent-color: var(--gold);
    cursor: pointer;
}

.wstyle-dnr-label {
    font-size: 0.78rem;
    font-weight: 700;
    white-space: nowrap;
    min-width: 100px;
}

.wstyle-dnr-label.narr {
    color: #a855f7;
    text-align: right;
}

.wstyle-dnr-label.dial {
    color: #10b981;
}

/* — Generator Card — */
.wstyle-gen-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--bg-main);
    border: 1px dashed rgba(168, 85, 247, 0.3);
    border-radius: 14px;
    padding: 18px 20px;
    gap: 16px;
    transition: all 0.25s ease;
}

.wstyle-gen-card:hover {
    border-color: rgba(168, 85, 247, 0.5);
    background: rgba(168, 85, 247, 0.03);
}

.wstyle-gen-card .gen-info {
    flex: 1;
}

.wstyle-gen-card .gen-title {
    font-weight: 700;
    font-size: 0.95rem;
    color: var(--text-main);
    margin-bottom: 4px;
}

.wstyle-gen-card .gen-desc {
    font-size: 0.75rem;
    color: var(--text-muted);
    line-height: 1.4;
}

.wstyle-gen-btn {
    padding: 10px 20px;
    border-radius: 10px;
    font-weight: 800;
    font-size: 0.78rem;
    background: linear-gradient(135deg, #a855f7, #6366f1);
    color: #fff;
    border: none;
    cursor: pointer;
    transition: all 0.25s;
    display: flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
    box-shadow: 0 4px 12px rgba(168, 85, 247, 0.25);
}

.wstyle-gen-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 6px 20px rgba(168, 85, 247, 0.35);
}

.wstyle-gen-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
    box-shadow: none;
}

/* — Create Card — */
.wstyle-create-card {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 20px;
    border: 1px dashed rgba(16, 185, 129, 0.3);
    border-radius: 14px;
    background: transparent;
    cursor: pointer;
    transition: all 0.25s;
    color: var(--text-muted);
    font-weight: 700;
    font-size: 0.85rem;
}

.wstyle-create-card:hover {
    border-color: rgba(16, 185, 129, 0.5);
    color: #10b981;
    background: rgba(16, 185, 129, 0.04);
}

/* — Style Editor — */
.wstyle-editor-bar {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 16px 20px;
    background: var(--bg-main);
    border: 1px solid var(--border-color);
    border-radius: 14px;
    margin-bottom: 20px;
}

.wstyle-editor-bar input {
    flex: 1;
    background: transparent;
    border: none;
    color: var(--text-main);
    font-size: 1.15rem;
    font-weight: 800;
    font-family: inherit;
    outline: none;
    letter-spacing: -0.02em;
}

.wstyle-editor-bar input::placeholder {
    color: #52525b;
}

.wstyle-tag-section {
    background: var(--bg-main);
    border: 1px solid var(--border-color);
    border-radius: 14px;
    padding: 20px;
    margin-bottom: 16px;
}

.wstyle-tag-cat-title {
    font-size: 0.7rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    color: var(--text-muted);
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    gap: 8px;
}

.wstyle-tag-cat-title::before {
    content: '';
    width: 3px;
    height: 14px;
    border-radius: 2px;
    background: linear-gradient(to bottom, #a855f7, #6366f1);
}

.wstyle-tag-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}

.wstyle-tag {
    padding: 7px 14px;
    border-radius: 8px;
    font-size: 0.78rem;
    font-weight: 500;
    color: var(--text-muted);
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid var(--border-color);
    cursor: pointer;
    transition: all 0.2s ease;
    user-select: none;
}

.wstyle-tag:hover {
    border-color: #52525b;
    color: var(--text-main);
    background: rgba(255, 255, 255, 0.04);
}

.wstyle-tag.selected {
    background: rgba(168, 85, 247, 0.15);
    border-color: rgba(168, 85, 247, 0.4);
    color: #c084fc;
    font-weight: 600;
}

.wstyle-insights-panel {
    background: var(--bg-main);
    border: 1px solid var(--border-color);
    border-radius: 14px;
    padding: 20px;
    margin-bottom: 16px;
}

.wstyle-rule-panel {
    background: var(--bg-main);
    border: 1px solid var(--border-color);
    border-radius: 14px;
    padding: 20px;
}

.wstyle-rule-panel textarea {
    width: 100%;
    min-height: 100px;
    resize: vertical;
    background: rgba(0, 0, 0, 0.25);
    border: 1px solid var(--border-color);
    border-radius: 10px;
    padding: 14px;
    color: var(--text-main);
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 0.82rem;
    line-height: 1.6;
    outline: none;
    transition: border-color 0.2s;
    box-sizing: border-box;
}

.wstyle-rule-panel textarea:focus {
    border-color: #a855f7;
}

.wstyle-info-callout {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    margin-top: 16px;
    padding: 14px 16px;
    border-radius: 10px;
    background: rgba(99, 102, 241, 0.06);
    border-left: 3px solid #6366f1;
}

.wstyle-info-callout i {
    color: #6366f1;
    font-size: 0.85rem;
    margin-top: 2px;
}

.wstyle-info-callout span {
    font-size: 0.78rem;
    color: var(--text-muted);
    line-height: 1.5;
}

/* ================================================================
   SHARED TAB REDESIGN — All remaining tabs
   ================================================================ */

/* — Tab Header (reusable) — */
.mtab-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 24px;
    padding-bottom: 20px;
    border-bottom: 1px solid var(--border-color);
}

.mtab-header-left {
    display: flex;
    align-items: center;
    gap: 14px;
}

.mtab-header-icon {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.2rem;
    color: #fff;
    flex-shrink: 0;
    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
}

.mtab-header h2 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 800;
    color: var(--text-main);
    letter-spacing: -0.02em;
}

.mtab-header p {
    margin: 2px 0 0;
    font-size: 0.78rem;
    color: var(--text-muted);
}

.mtab-header-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 14px;
    border-radius: 20px;
    font-size: 0.72rem;
    font-weight: 700;
    white-space: nowrap;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

/* — Engine / Selection Cards — */
.mtab-eng-card {
    position: relative;
    display: flex;
    flex-direction: column;
    background: var(--bg-main);
    border: 1px solid var(--border-color);
    border-radius: 14px;
    overflow: hidden;
    cursor: pointer;
    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    padding: 0;
}

.mtab-eng-card:hover {
    border-color: #52525b;
    transform: translateY(-2px);
    box-shadow: 0 8px 25px rgba(0, 0, 0, 0.35);
}

.mtab-eng-card .ecard-accent {
    height: 3px;
    width: 100%;
    background: linear-gradient(90deg, var(--border-color), transparent);
    transition: background 0.3s ease;
}

.mtab-eng-card:hover .ecard-accent {
    background: linear-gradient(90deg, var(--gold), #d97706, transparent);
}

.mtab-eng-card.active .ecard-accent {
    background: linear-gradient(90deg, #10b981, #059669) !important;
}

.mtab-eng-card .ecard-body {
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.mtab-eng-card .ecard-title {
    font-weight: 700;
    font-size: 0.95rem;
    color: var(--text-main);
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.mtab-eng-card .ecard-desc {
    font-size: 0.78rem;
    color: var(--text-muted);
    line-height: 1.5;
    margin: 0;
}

.mtab-eng-card .ecard-badge {
    font-size: 0.62rem;
    font-weight: 800;
    padding: 3px 10px;
    border-radius: 8px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
}

.mtab-eng-card .ecard-badge.rec {
    background: rgba(245, 158, 11, 0.12);
    color: var(--gold);
}

.mtab-eng-card .ecard-badge.new {
    background: rgba(59, 130, 246, 0.15);
    color: #3b82f6;
}

.mtab-eng-card .ecard-badge.locked {
    background: rgba(82, 82, 91, 0.2);
    color: #71717a;
}

.mtab-eng-card .ecard-badge.v6-active {
    background: rgba(16, 185, 129, 0.15);
    color: #10b981;
}

.mtab-eng-card .ecard-badge.override {
    background: rgba(16, 185, 129, 0.12);
    color: #10b981;
}

.mtab-eng-card.active {
    border-color: #10b981;
    background: rgba(16, 185, 129, 0.04);
}

.mtab-eng-card.active .ecard-title {
    color: #10b981;
}

.mtab-eng-card.locked-card {
    opacity: 0.5;
    filter: grayscale(60%);
    pointer-events: none;
}

.mtab-eng-card.locked-card:hover {
    transform: none;
    box-shadow: none;
}

/* — Toggle Row (modern) — */
.mtab-toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--bg-main);
    border: 1px solid var(--border-color);
    border-radius: 14px;
    padding: 16px 20px;
    gap: 16px;
    cursor: pointer;
    transition: all 0.25s ease;
}

.mtab-toggle-row:hover {
    border-color: #52525b;
}

.mtab-toggle-row.active {
    border-color: var(--gold);
    background: rgba(245, 158, 11, 0.03);
}

.mtab-toggle-row.active .ps-switch {
    background: var(--gold); /* Or accent-color depending on intended style, using gold to match border */
}

.mtab-toggle-row.active .ps-switch::after {
    left: 22px;
    background: #000;
}

.mtab-toggle-row .toggle-info {
    flex: 1;
}

.mtab-toggle-row .toggle-label {
    font-weight: 700;
    font-size: 0.88rem;
    color: var(--text-main);
    display: flex;
    align-items: center;
    gap: 8px;
}

.mtab-toggle-row .toggle-desc {
    font-size: 0.73rem;
    color: var(--text-muted);
    margin-top: 3px;
    line-height: 1.4;
}

/* — Panel (settings groups) — */
.mtab-panel {
    background: var(--bg-main);
    border: 1px solid var(--border-color);
    border-radius: 14px;
    padding: 20px;
    margin-bottom: 16px;
}

.mtab-panel-title {
    font-size: 0.72rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    color: var(--text-muted);
    margin-bottom: 16px;
    display: flex;
    align-items: center;
    gap: 8px;
}

.mtab-panel-title i {
    font-size: 0.85rem;
}

.mtab-panel-title.gold i {
    color: var(--gold);
}

.mtab-panel-title.green i {
    color: #10b981;
}

.mtab-panel-title.purple i {
    color: #a855f7;
}

.mtab-panel-title.blue i {
    color: #3b82f6;
}

.mtab-panel-title.red i {
    color: #ef4444;
}

/* — Setting Row (label + input) — */
.mtab-setting-row {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 14px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.mtab-setting-row:last-child {
    border-bottom: none;
    padding-bottom: 0;
}

.mtab-setting-row:first-child {
    padding-top: 0;
}

.mtab-setting-row .set-info {
    flex: 1;
}

.mtab-setting-row .set-label {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-main);
}

.mtab-setting-row .set-desc {
    font-size: 0.73rem;
    color: var(--text-muted);
    margin-top: 2px;
}

/* — Param Slider — */
.mtab-param-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 0;
}

.mtab-param-row .param-label {
    min-width: 55px;
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.mtab-param-row input[type="range"] {
    flex: 1;
    accent-color: var(--gold);
    cursor: pointer;
}

.mtab-param-row input[type="number"] {
    width: 55px;
    padding: 5px 4px;
    text-align: center;
    font-size: 0.78rem;
    font-weight: 600;
    background: rgba(0, 0, 0, 0.25);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    color: var(--text-main);
    outline: none;
}

/* — Ban item — */
.mtab-ban-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 14px;
    border-radius: 10px;
    background: rgba(239, 68, 68, 0.06);
    border: 1px solid rgba(239, 68, 68, 0.2);
    color: #ef4444;
    font-size: 0.82rem;
    line-height: 1.4;
    cursor: pointer;
    transition: all 0.2s;
    word-break: break-word;
}

.mtab-ban-item:hover {
    background: rgba(239, 68, 68, 0.12);
    border-color: rgba(239, 68, 68, 0.35);
}

.mtab-ban-item i {
    opacity: 0.6;
    flex-shrink: 0;
    margin-left: 12px;
}

/* — Locked Overlay — */
.mtab-locked-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
    text-align: center;
    background: var(--bg-main);
    border: 1px dashed rgba(168, 85, 247, 0.3);
    border-radius: 14px;
    margin-bottom: 20px;
}

.mtab-locked-state i {
    font-size: 2.5rem;
    margin-bottom: 15px;
}

.mtab-locked-state h3 {
    margin: 0 0 10px;
    color: var(--text-main);
    font-weight: 800;
}

.mtab-locked-state p {
    color: var(--text-muted);
    max-width: 500px;
    font-size: 0.82rem;
    line-height: 1.5;
}

/* — Info Callout — */
.mtab-callout {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 14px 16px;
    border-radius: 10px;
    background: rgba(99, 102, 241, 0.06);
    border-left: 3px solid #6366f1;
}

.mtab-callout i {
    color: #6366f1;
    font-size: 0.85rem;
    margin-top: 2px;
    flex-shrink: 0;
}

.mtab-callout span {
    font-size: 0.78rem;
    color: var(--text-muted);
    line-height: 1.5;
}

.mtab-callout.gold {
    background: rgba(245, 158, 11, 0.06);
    border-left-color: var(--gold);
}

.mtab-callout.gold i {
    color: var(--gold);
}

.mtab-callout.green {
    background: rgba(16, 185, 129, 0.06);
    border-left-color: #10b981;
}

.mtab-callout.green i {
    color: #10b981;
}

.mtab-callout.purple {
    background: rgba(168, 85, 247, 0.06);
    border-left-color: #a855f7;
}

.mtab-callout.purple i {
    color: #a855f7;
}

/* — Engine Card Grid — */
.mtab-card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 12px;
}

.mtab-card-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.mtab-btn-row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
}

.mtab-btn-row button {
    font-size: 0.72rem;
}

/* ================================================================
   MOBILE RESPONSIVE — All rules scoped to @media only.
   Desktop UI is completely untouched.
   ================================================================ */

@media (max-width: 768px) {

    /* ── Modal: full-screen takeover ── */
    .ps-modern-modal.app-container {
        width: 100% !important;
        max-width: 100% !important;
        height: auto !important;
        max-height: none !important;
        position: absolute !important;
        top: 0 !important;
        bottom: 0 !important;
        left: 0 !important;
        right: 0 !important;
        border-radius: 0 !important;
        border: none !important;
    }

    #prompt-slot-modal-overlay {
        align-items: stretch !important;
        padding: 0 !important;
    }

    /* ── Floating open button: larger touch target ── */
    #prompt-slot-fixed-btn {
        width: 44px;
        height: 44px;
        top: 70px !important;
        bottom: auto !important;
        right: 12px !important;
        border-radius: 50%;
    }

    /* ── Dock → Horizontal bottom tab bar ── */
    .dock {
        position: absolute !important;
        /* Safer than fixed on mobile */
        top: auto !important;
        bottom: 0 !important;
        left: 0 !important;
        right: 0 !important;
        width: 100% !important;
        height: auto !important;
        min-height: 84px !important;
        padding: 0 0 env(safe-area-inset-bottom, 0px) 0 !important;
        border-radius: 0 !important;
        border: none !important;
        border-top: 1px solid rgba(255, 255, 255, 0.08) !important;
        flex-direction: row !important;
        overflow-x: auto !important;
        overflow-y: hidden !important;
        gap: 0 !important;
        z-index: 100 !important;
        background: rgba(14, 14, 17, 0.95) !important;
        backdrop-filter: blur(20px) !important;
        -webkit-overflow-scrolling: touch;
    }

    .dock:hover {
        width: 100% !important;
        box-shadow: none !important;
    }

    .dock-icon {
        flex-direction: column !important;
        width: auto !important;
        min-width: 65px !important;
        /* Slightly wider for better touch */
        height: 84px !important;
        /* Match the new dock height */
        padding: 10px 10px !important;
        /* Added more padding */
        margin: 0 !important;
        font-size: 0.7rem !important;
        /* Slightly larger text */
        gap: 4px;
        /* More space between icon and text */
        justify-content: center;
        align-items: center;
        flex-shrink: 0;
    }

    .dock-icon i {
        margin-right: 0 !important;
        font-size: 1rem !important;
        width: auto !important;
    }

    .dock-icon span {
        opacity: 1 !important;
        pointer-events: auto !important;
        font-size: 0.55rem !important;
        white-space: nowrap;
        text-align: center;
        line-height: 1.1;
    }

    .dock:hover .dock-icon span {
        transition-delay: 0s !important;
    }

    .dock-icon:hover,
    .dock-icon.active {
        margin-left: 0 !important;
        width: auto !important;
        min-width: 56px !important;
        border-radius: 0 !important;
        background: rgba(255, 255, 255, 0.06) !important;
    }

    .dock-icon.active {
        background: rgba(245, 158, 11, 0.12) !important;
        border-top: 2px solid var(--gold) !important;
    }

    /* ── Hero banner: keep it, slightly shorter ── */
    .hero-banner {
        height: 150px !important;
    }

    .hero-content {
        padding: 0 16px 14px 16px !important;
    }

    .hero-content .name {
        font-size: 1.5rem !important;
    }

    .hero-content .status {
        font-size: 0.6rem !important;
    }

    /* ── Top app bar: compact action buttons ── */
    .top-app-bar {
        padding: 10px 12px !important;
    }

    .app-actions {
        gap: 6px !important;
        flex-wrap: wrap !important;
        justify-content: flex-end !important;
    }

    .app-actions .ps-modern-btn {
        padding: 6px 10px !important;
        font-size: 0.7rem !important;
    }

    /* Hide button labels on mobile, keep icons */
    #btn_apply_tab_all,
    #ps_btn_reset {
        font-size: 0 !important;
    }

    #btn_apply_tab_all i,
    #ps_btn_reset i {
        font-size: 0.85rem !important;
    }

    /* ── Main content area: adjust padding for bottom dock ── */
    .main-content {
        padding: 10px 14px calc(100px + env(safe-area-inset-bottom, 0px)) 14px !important;
    }

    /* ── Cards grid: single column ── */
    .ps-grid {
        grid-template-columns: 1fr !important;
        gap: 10px !important;
    }

    .ps-card {
        padding: 14px !important;
    }

    .ps-card-title {
        font-size: 0.95rem !important;
    }

    /* ── Toggle cards: tighter ── */
    .ps-toggle-card {
        padding: 14px 16px !important;
    }

    /* ── Inputs: full width on small screens ── */
    .ps-modern-input {
        font-size: 0.85rem !important;
    }

    /* ── Tags: slightly smaller for wrapping ── */
    .ps-modern-tag {
        padding: 5px 10px !important;
        font-size: 0.75rem !important;
        margin: 2px !important;
    }

    /* ── Buttons: touch-friendly sizing ── */
    .ps-modern-btn {
        padding: 10px 14px !important;
        font-size: 0.8rem !important;
        min-height: 40px;
    }

    /* ── Fix inline flex rows that overflow on mobile ── */
    /* Settings rows (word count, language, pronouns) */
    .main-content div[style*="display: flex"][style*="align-items: center"][style*="gap: 15px"] {
        flex-wrap: wrap !important;
    }

    .main-content div[style*="display: flex"][style*="align-items: center"][style*="gap: 15px"] .ps-modern-input[style*="width: 200px"],
    .main-content div[style*="display: flex"][style*="align-items: center"][style*="gap: 15px"] select[style*="width: 200px"] {
        width: 100% !important;
    }

    /* Image gen parameter sliders: stack vertically on small screens */
    div[style*="display: grid"][style*="grid-template-columns: 1fr 1fr"] {
        grid-template-columns: 1fr !important;
    }

    /* LoRA lab grid */
    div[style*="display: grid"][style*="grid-template-columns: 1fr 1fr"][style*="gap: 15px"] {
        grid-template-columns: 1fr !important;
    }

    /* Image gen dropdowns full width */
    div[style*="display: flex"][style*="gap: 10px"] select[style*="flex: 2"],
    div[style*="display: flex"][style*="gap: 10px"] select[style*="flex: 1"] {
        min-width: 0 !important;
    }

    /* Dev mode: editor top bar */
    div[style*="display: flex"][style*="gap: 10px"][style*="margin-bottom: 20px"] {
        flex-wrap: wrap !important;
    }

    /* Style editor: name + buttons row */
    div[style*="display: flex"][style*="gap: 15px"][style*="margin-bottom: 20px"][style*="align-items: center"] {
        flex-direction: column !important;
        align-items: stretch !important;
    }

    /* Workflow editor: sidebar placeholders panel hidden on mobile */
    .wf-textarea {
        min-height: 300px !important;
    }

    div[style*="width: 250px"][style*="flex-shrink: 0"] {
        display: none !important;
    }

    /* Filter buttons wrap */
    div[style*="display: flex"][style*="gap: 8px"][style*="margin-bottom: 20px"] {
        flex-wrap: wrap !important;
    }

    /* Tooltip: position safely on mobile */
    #ps-global-tooltip {
        max-width: 200px !important;
        font-size: 0.78rem !important;
    }

    /* Progress overlay: full width on mobile */
    #kazuma_progress_overlay {
        left: 10px !important;
        right: 10px !important;
        width: auto !important;
        bottom: 120px !important;
    }
}

/* Extra small screens (phones in portrait) */
@media (max-width: 420px) {
    .hero-banner {
        height: 120px !important;
    }

    .hero-content .name {
        font-size: 1.2rem !important;
    }

    .dock-icon {
        min-width: 48px !important;
        padding: 6px 6px !important;
    }

    .dock-icon span {
        font-size: 0.5rem !important;
    }

    .app-actions .ps-modern-btn {
        padding: 6px 8px !important;
        font-size: 0 !important;
    }

    .app-actions .ps-modern-btn i {
        font-size: 0.85rem !important;
    }

    #ps_btn_save_close {
        font-size: 0.7rem !important;
    }

    .main-content {
        padding: 8px 10px 68px 10px !important;
    }
}

/* ================================================================
   MEMORY CORE EXTENSION — Visuals & UI
   ================================================================ */

/* Rule B: Visual fading for archived messages in the ST Chat UI */
.megumin_archived_text {
    opacity: 0.5 !important;
    font-style: italic !important;
    transition: opacity 0.3s ease-in-out;
}

.megumin_archived_text:hover {
    opacity: 0.8 !important; /* Let users peek at it if they hover */
}

/* Memory Tab: Dashboard Progress Bar */
    width: 100%;
    height: 12px;
    background: rgba(0, 0, 0, 0.4);
    border-radius: 6px;
    overflow: hidden;
    display: flex;
    margin-top: 10px;
    border: 1px solid var(--border-color);
}

.mem-prog-short { background: #f59e0b; transition: width 0.4s ease; }

/* Memory Tab: Short-Term Accordion */
    background: var(--bg-main);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    margin-bottom: 8px;
    overflow: hidden;
}

    padding: 12px 16px;
    background: rgba(255, 255, 255, 0.02);
    cursor: pointer;
    font-weight: 600;
    font-size: 0.85rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
}


    padding: 16px;
    display: none;
    border-top: 1px solid var(--border-color);
}

    width: 100%;
    min-height: 100px;
    background: rgba(0,0,0,0.2);
    border: 1px solid var(--border-color);
    color: var(--text-main);
    padding: 10px;
    border-radius: 6px;
    font-family: monospace;
    font-size: 0.8rem;
    resize: vertical;
}

/* Loading Spinner */
    animation: spin 1s linear infinite;
    color: var(--gold);
}
@keyframes spin { 100% { transform: rotate(360deg); } }`;

const LUMIVERSE_COMPAT_CSS = String.raw`

/* Lumiverse mount and SVG Font Awesome compatibility. */
.megumin-suite-app { z-index: 1; }
.meg-float { width:52px; height:52px; }
.meg-float-btn { width:52px; height:52px; border-radius:14px; border:1px solid rgba(255,255,255,.12); background:var(--bg-panel,#18181b); color:var(--text-main,#f4f4f5); cursor:pointer; display:grid; place-items:center; box-shadow:0 16px 34px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.05); transition:background-color .2s ease, transform .2s ease; }
.meg-float-btn:hover { background:#27272a; transform:translateY(-2px); }
.meg-float-btn .meg-fa, .meg-float-btn .meg-svg { width:30px; height:30px; color:#fff; filter:drop-shadow(0 2px 6px rgba(0,0,0,.45)); }
.meg-fa { width:1em; height:1em; flex:0 0 auto; display:inline-flex; align-items:center; justify-content:center; line-height:1; vertical-align:-.125em; }
.meg-svg { width:1em; height:1em; fill:currentColor; stroke:none; }
.meg-overlay { position:fixed; inset:0; display:flex; align-items:center; justify-content:center; background-color:rgba(0,0,0,.7); backdrop-filter:blur(4px); font-family:'Inter', sans-serif; color:var(--text-main); }
.meg-overlay button, .meg-overlay input, .meg-overlay select, .meg-overlay textarea { font-family:'Inter', sans-serif; }
.dock-icon { border:0; background:transparent; }
.dock-icon i.meg-fa { width:20px; text-align:center; margin-right:15px; font-size:1.1rem; flex:0 0 20px; }
.dock-icon i.meg-fa .meg-svg { width:20px; height:20px; }
.dock-icon span { display:inline; }
.mtab-header-icon i.meg-fa, .wstyle-header-icon i.meg-fa { font-size:1.2rem; }
.mtab-header-icon i.meg-fa .meg-svg, .wstyle-header-icon i.meg-fa .meg-svg { width:1.2rem; height:1.2rem; }
.ps-modern-btn { border-width:1px; border-style:solid; }
.app-actions .ps-modern-btn i.meg-fa { font-size:.9rem; }
#btn_apply_tab_all { color:var(--gold); border-color:rgba(245,158,11,.3); }
#ps_btn_reset { color:#ef4444; border-color:rgba(239,68,68,.3); }
#ps_btn_dev_mode { color:#a855f7; border-color:rgba(168,85,247,.3); }
#ps_btn_dev_mode.active { color:#10b981; border-color:rgba(16,185,129,.3); }
#ps_btn_save_close { background:#10b981 !important; color:#fff !important; border:none !important; }
.live-token-count { color:#c9c9d2; background:rgba(26,26,31,.78); padding:10px 14px; border-radius:8px; border:1px solid rgba(255,255,255,.1); backdrop-filter:blur(6px); font-size:.85rem; font-weight:600; display:flex; gap:8px; align-items:center; box-shadow:0 10px 24px rgba(0,0,0,.28); }
.ps-save-indicator { color:var(--text-muted); font-size:.78rem; font-weight:600; min-width:54px; }
.ps-save-indicator.saving { color:var(--gold); }
.mtab-eng-card { color:var(--text-main); text-align:left; }
.mtab-eng-card .ecard-badge.active-badge { background:rgba(16,185,129,.15); color:#10b981; }
.badge-row { display:flex; gap:6px; flex-wrap:wrap; margin-top:4px; }
.card-button-reset { border:0; background:transparent; color:inherit; text-align:left; width:100%; cursor:pointer; }
.dnr-mount { display:block; }
#dnr_panel { display:block !important; visibility:visible !important; }
.dnr-preview { font-size:.7rem; color:var(--text-muted); text-align:center; margin-top:10px; font-family:monospace; opacity:.7; }
.preset-warning { margin:0 0 14px; }
.ps-field { display:flex; flex-direction:column; gap:6px; color:var(--text-muted); font-size:.73rem; font-weight:700; }
.ps-field.bare span { display:none; }
.textarea-xl { min-height:180px !important; resize:vertical; }
.setting-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:10px; }
.inline-form { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:10px; align-items:center; }
.image-lab { display:grid; grid-template-columns:minmax(0,1.25fr) minmax(260px,.75fr); gap:14px; }
.visual-preview { min-height:260px; border-radius:8px; border:1px solid var(--border-color); background:var(--bg-main) center/cover; overflow:hidden; position:relative; display:flex; align-items:flex-end; }
.visual-preview::before { content:""; position:absolute; inset:0; background:linear-gradient(to top, rgba(0,0,0,.9), transparent 75%); }
.visual-preview div { position:relative; z-index:1; padding:16px; font-weight:700; color:#fff; display:flex; gap:8px; align-items:center; }
.resolution-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:8px; margin-bottom:14px; }
.res-pill { border:1px solid var(--border-color); background:var(--bg-main); color:var(--text-muted); border-radius:8px; padding:9px; cursor:pointer; font-weight:700; font-size:.75rem; text-align:left; }
.res-pill.active { color:#111; background:var(--gold); border-color:var(--gold); }
.placeholder-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:8px; margin-top:12px; }
.placeholder-grid div { display:flex; flex-direction:column; gap:4px; border:1px solid var(--border-color); border-radius:8px; padding:10px; background:var(--bg-main); }
.placeholder-grid code { color:var(--gold); font-size:.75rem; }
.placeholder-grid span { color:var(--text-muted); font-size:.75rem; }
.ig-param-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:15px; background:rgba(0,0,0,.1); padding:15px; border-radius:10px; border:1px solid var(--border-color); }
.ig-param-grid .mtab-param-row { display:grid; grid-template-columns:64px minmax(0,1fr) 64px; align-items:center; gap:10px; margin:0; }
.ig-param-grid .mtab-param-row input[type="number"] { padding:6px 8px; text-align:center; }
.lora-slot { border:1px solid var(--border-color); border-radius:8px; padding:12px; background:rgba(0,0,0,.16); }
.npc-heading { display:flex; justify-content:space-between; align-items:center; margin:15px 0 12px; color:#f43f5e; font-size:.85rem; font-weight:800; text-transform:uppercase; letter-spacing:.5px; }
.npc-heading #npc_count { color:var(--text-muted); font-size:.75rem; margin-left:8px; }
.npc-empty { text-align:center; color:var(--text-muted); font-size:.8rem; padding:20px; border:1px dashed var(--border-color); border-radius:10px; }
.npc-list { display:flex; flex-direction:column; gap:14px; padding:4px; }
.npc-card { border:1px solid rgba(var(--npc-rgb),.2); border-radius:12px; background:rgba(0,0,0,.3); overflow:hidden; }
.npc-card:hover { border-color:rgba(var(--npc-rgb),.5); }
.npc-card[open] .npc-title-left .fa-chevron-right { transform:rotate(90deg); }
.npc-card-header { list-style:none; display:flex; justify-content:space-between; align-items:center; gap:12px; padding:8px 14px; cursor:pointer; background:linear-gradient(135deg,rgba(var(--npc-rgb),.15),rgba(var(--npc-rgb),.08)); }
.npc-card-header::-webkit-details-marker { display:none; }
.npc-title-left, .npc-title-right { display:flex; align-items:center; gap:8px; min-width:0; }
.npc-title-left .fa-chevron-right { color:var(--npc-accent); transition:.2s; }
.npc-title-left strong { color:var(--npc-accent); font-size:.85rem; }
.npc-title-left small, .npc-title-right small { color:var(--text-muted); font-size:.6rem; }
.npc-title-left small { background:rgba(0,0,0,.3); padding:2px 6px; border-radius:4px; white-space:nowrap; }
.npc-mini-pfp { width:34px; height:34px; border-radius:8px; object-fit:cover; border:1px solid var(--border-color); background:var(--bg-main); display:grid; place-items:center; color:var(--gold); font-weight:800; }
.npc-card-body { display:grid; grid-template-columns:180px minmax(0,1fr); gap:12px; padding:12px; border-top:1px solid rgba(var(--npc-rgb),.15); }
.npc-pfp-column { width:160px; display:flex; flex-direction:column; gap:8px; }
.npc-pfp-container { width:160px; height:240px; border-radius:10px; overflow:hidden; border:2px solid rgba(var(--npc-rgb),.3); background:rgba(0,0,0,.4); display:grid; place-items:center; color:var(--npc-accent); font-size:2rem; }
.npc-pfp-container img { width:100%; height:100%; object-fit:cover; }
.npc-pfp-name { text-align:center; font-size:.95rem; font-weight:800; color:var(--npc-accent); text-shadow:0 1px 2px rgba(0,0,0,.5); }
.npc-pfp-btn { width:100%; font-size:.65rem; padding:5px 0; border-radius:6px; cursor:pointer; border:1px solid rgba(var(--npc-rgb),.3); background:rgba(var(--npc-rgb),.1); color:var(--npc-accent); }
.npc-pfp-btn.generate { border-color:rgba(168,85,247,.3); background:rgba(168,85,247,.1); color:#a855f7; }
.npc-fields { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:6px; min-width:0; }
.npc-field-section { margin-bottom:6px; }
.npc-field-section strong { font-size:.65rem; font-weight:700; margin-bottom:2px; display:flex; align-items:center; gap:4px; }
.npc-field-edit { height:32px; min-height:32px !important; resize:vertical; font-size:.7rem; padding:4px 6px; background:rgba(0,0,0,.25); border-color:rgba(255,255,255,.06); border-radius:6px; line-height:1.3; }
.memory-dashboard { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; }
.mem-stat strong { display:block; color:var(--stat-color); font-size:28px; line-height:1; }
.mem-stat small { color:var(--text-muted); }
.mem-legend span { display:flex; gap:5px; align-items:center; }
.mem-status-text { margin-top:10px; font-size:.7rem; color:var(--text-muted); text-align:center; }
.mem-help div { color:var(--gold); font-weight:800; margin-bottom:6px; }
.gold-input { color:var(--gold); border-color:rgba(245,158,11,.3); }
.mem-slider-row { flex-direction:row; align-items:center; gap:12px; }
.mem-slider-row input { flex:1; }
.param-value { font-size:.8rem; font-weight:800; min-width:30px; text-align:right; }
.green-text { color:#10b981 !important; border-color:rgba(16,185,129,.3) !important; }
.blue-text { color:#3b82f6 !important; border-color:rgba(59,130,246,.3) !important; }
.dev-layout { display:grid; grid-template-columns:minmax(0,1.35fr) minmax(280px,.65fr); gap:14px; }
.custom-engine-row { display:flex; justify-content:space-between; align-items:center; gap:10px; padding:10px; border:1px solid var(--border-color); border-radius:8px; background:var(--bg-main); margin-bottom:8px; }
.custom-engine-row div { display:flex; flex-direction:column; gap:3px; }
.custom-engine-row span { color:var(--text-muted); font-size:.75rem; }
.dev-full { grid-column:1 / -1; }
.dev-top-actions { display:flex; gap:15px; margin:10px 0 30px; }
.dev-top-actions .ps-modern-btn { flex:1; padding:12px; font-size:1rem; }
.ps-card.custom { border-color:#10b981; background:rgba(16,185,129,.05); }
.ps-card-title.green { color:#10b981; }
.dev-card-actions { display:flex; gap:8px; width:100%; }
.dev-card-actions .ps-modern-btn { flex:1; padding:6px; font-size:.8rem; }
.gold-fill { background:var(--gold) !important; color:#000 !important; border-color:var(--gold) !important; }
/* Story Director console — copied from the SillyTavern build. */
.sd-setting-group {
    margin-bottom: 18px;
    padding-left: 2px;
}

.sd-setting-label {
    font-size: 0.8rem;
    font-weight: 700;
    color: #e4e4e7;
    margin-bottom: 10px;
    display: block;
}

.sd-setting-label .sd-label-hint {
    font-weight: 400;
    color: #71717a;
    font-size: 0.75rem;
}

.sd-rating-pills {
    display: flex;
    gap: 8px;
}

.sd-pill {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 10px;
    padding: 8px 16px;
    color: #a1a1aa;
    font-size: 0.82rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.2s ease;
}

.sd-pill:hover {
    border-color: rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.08);
}

.sd-pill.active {
    background: rgba(245, 158, 11, 0.15);
    border-color: rgba(245, 158, 11, 0.4);
    color: #f59e0b;
}

.sd-pacing-selector {
    display: flex;
    gap: 8px;
}

.sd-pacing-btn {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    padding: 14px 10px;
    cursor: pointer;
    transition: all 0.2s ease;
    font-family: inherit;
    color: #a1a1aa;
}

.sd-pacing-btn:hover {
    border-color: rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.08);
}

.sd-pacing-btn.active {
    background: rgba(245, 158, 11, 0.15);
    border-color: rgba(245, 158, 11, 0.4);
    color: #f59e0b;
}

.sd-pacing-btn i {
    font-size: 1.2rem;
    margin-bottom: 6px;
}

.sd-pacing-btn .sd-pacing-name {
    font-weight: 600;
    font-size: 0.82rem;
}

.sd-pacing-btn .sd-pacing-desc {
    font-size: 0.68rem;
    color: #71717a;
    margin-top: 2px;
}

.sd-pacing-btn.active .sd-pacing-desc {
    color: rgba(245, 158, 11, 0.7);
}

.sd-chip-container {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}

.sd-chip {
    border-radius: 20px;
    padding: 5px 12px;
    font-size: 0.72rem;
    font-weight: 600;
    font-family: inherit;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: #a1a1aa;
    cursor: pointer;
    transition: all 0.2s ease;
}

.sd-chip:hover {
    border-color: rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.08);
}

.sd-chip.active {
    background: rgba(139, 92, 246, 0.15);
    border-color: rgba(139, 92, 246, 0.4);
    color: #a78bfa;
}

.sd-genre-desc {
    font-size: 0.73rem;
    color: #71717a;
    margin-top: 6px;
    padding-left: 2px;
    line-height: 1.4;
}

.sd-directors-note-hint {
    background: rgba(245, 158, 11, 0.06);
    border: 1px solid rgba(245, 158, 11, 0.15);
    border-radius: 8px;
    padding: 10px 14px;
    margin-bottom: 12px;
    font-size: 0.78rem;
    color: #b4935a;
    line-height: 1.5;
    display: flex;
    align-items: flex-start;
    gap: 8px;
}

.sd-directors-note-hint i {
    color: #f59e0b;
    flex-shrink: 0;
    margin-top: 2px;
}

.sd-directors-note-input {
    width: 100%;
    height: 80px;
    resize: vertical;
    font-size: 0.85rem;
    line-height: 1.5;
    font-family: inherit;
    background: #0e0e11;
    border: 1px solid #27272a;
    color: #f4f4f5;
    padding: 12px 16px;
    border-radius: 8px;
    outline: none;
    transition: border-color 0.2s ease;
    box-sizing: border-box;
}

.sd-directors-note-input:focus {
    border-color: #52525b;
    background: #18181b;
}

.sd-directive-output {
    width: 100%;
    height: 300px;
    resize: vertical;
    font-size: 0.83rem;
    line-height: 1.6;
    margin-bottom: 12px;
    font-family: inherit;
    background: #0e0e11;
    border: 1px solid #27272a;
    color: #f4f4f5;
    padding: 12px 16px;
    border-radius: 8px;
    outline: none;
    transition: border-color 0.2s ease;
    box-sizing: border-box;
}

.sd-directive-output:focus {
    border-color: #52525b;
    background: #18181b;
}

:root {
  --c-brand:  #f59e0b;            
  --c-select: #ffffff;            
  --c-live:   #10b981;            
  --c-danger: #ef4444;            
  --c-info:   #3b82f6;            
  --c-ai:     #a855f7;            

  --glass:        rgba(24,24,27,.55);
  --glass-lit:    rgba(40,40,46,.72);
  --glass-line:   rgba(255,255,255,.10);
  --glass-line-hi:rgba(255,255,255,.22);
  --spec:         inset 0 1px 0 rgba(255,255,255,.08),
                  inset 0 0 0 1px rgba(255,255,255,.02);
  --spec-hi:      inset 0 1px 0 rgba(255,255,255,.16);
  --ease-spring:  cubic-bezier(.34,1.56,.64,1);
  --ease:         cubic-bezier(.22,.61,.36,1);
}

#prompt-slot-modal-overlay::before {
  content: ""; position: fixed; inset: -20%; z-index: 0; pointer-events: none;
  background:
    radial-gradient(40vw 40vw at 22% 8%,  rgba(245,158,11,.16), transparent 60%),
    radial-gradient(34vw 34vw at 86% 92%, rgba(99,102,241,.10), transparent 62%);
  filter: blur(8px);
  animation: coh-drift 30s var(--ease) infinite alternate;
}
#prompt-slot-modal-overlay > .app-container { position: relative; z-index: 1; }
@keyframes coh-drift {
  from { transform: translate3d(0,0,0) scale(1); }
  to   { transform: translate3d(3%,2%,0) scale(1.08); }
}

.dev-empty { padding:20px; text-align:center; color:var(--text-muted); border:1px dashed var(--border-color); border-radius:12px; margin-bottom:30px; }

/* Story Config */
.cfg-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(300px, 1fr)); gap:14px; }
.cfg-field { background:var(--panel-bg); border:1px solid var(--border-color); border-radius:12px; padding:14px; }
.cfg-field-head { display:flex; align-items:center; gap:8px; font-weight:600; font-size:0.85rem; margin-bottom:4px; }
.cfg-field-head svg { width:14px; height:14px; }
.cfg-clear { margin-left:auto; background:none; border:none; color:var(--text-muted); cursor:pointer; padding:2px 4px; border-radius:6px; }
.cfg-clear:hover { color:var(--gold); background:rgba(255,255,255,0.06); }
.cfg-hint { font-size:0.7rem; color:var(--text-muted); line-height:1.45; margin-bottom:10px; }
.cfg-chips { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
.cfg-chip { font-size:0.68rem; padding:4px 9px; border-radius:999px; cursor:pointer; transition:0.15s;
  background:rgba(255,255,255,0.05); border:1px solid var(--border-color); color:var(--text-muted); }
.cfg-chip:hover { border-color:var(--gold); color:var(--text-main); }
.cfg-chip.active { background:var(--gold); border-color:var(--gold); color:#000; font-weight:600; }

/* Blocks envelope */
.bstack-list { display:flex; flex-direction:column; gap:8px; }
.bstack-row { display:flex; align-items:center; gap:12px; padding:10px 12px; border-radius:10px;
  background:rgba(255,255,255,0.03); border:1px solid var(--border-color); }
.bstack-grip { font-size:1.1rem; width:24px; text-align:center; flex-shrink:0; }
.bstack-name { flex:1; min-width:0; }
.bstack-title { font-weight:600; font-size:0.85rem; }
.bstack-tag { font-family:'Consolas', monospace; font-size:0.68rem; color:var(--text-muted); }
.bstack-actions { display:flex; gap:6px; flex-shrink:0; }
.bstack-actions .ps-modern-btn { padding:6px 9px; }
.bstack-actions .ps-modern-btn[disabled] { opacity:0.35; cursor:not-allowed; }
.bfield-row { display:flex; gap:8px; align-items:center; margin-bottom:8px; }
.bfield-row .ps-modern-input { padding:8px 10px; font-size:0.78rem; }
.textarea-sm { min-height:80px; resize:vertical; font-size:0.78rem; margin-bottom:10px; }
.dev-editor-toolbar { position:sticky; top:-11px; z-index:10; background:var(--bg-panel); padding:10px 0 15px; margin:-10px 0 20px; display:flex; gap:10px; border-bottom:1px solid var(--border-color); box-shadow:0 10px 15px -10px rgba(0,0,0,.6); }
.dev-editor-toolbar #dev_mode_name { flex:1; font-weight:800; font-size:1.1rem; border-color:var(--gold); }
.dev-flow { display:flex; flex-direction:column; }
.dev-block { background:var(--bg-panel); border:1px solid var(--border-color); border-radius:8px; padding:12px; margin-bottom:10px; }
.dev-block.locked { background:rgba(0,0,0,.4); }
.dev-block-heading { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:6px; }
.dev-block-title { font-weight:800; color:var(--accent-color); font-size:.8rem; margin-bottom:6px; display:flex; justify-content:space-between; gap:8px; }
.dev-block-heading .dev-block-title { margin-bottom:0; }
.dev-locked-content { font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:.75rem; color:#666; white-space:pre-wrap; }
.dev-preset-row { display:flex; gap:6px; flex-wrap:wrap; }
.dev-preset-btn.active { background:rgba(16,185,129,.15); border-color:#10b981; color:#10b981; }
.dev-preset-dropdown { width:250px; padding:4px; font-size:.75rem; cursor:pointer; color:var(--gold); border-color:var(--gold); }
.dev-area { min-height:90px !important; font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:.75rem; }
.dev-area.tall { min-height:120px !important; }
.dev-insert-point { text-align:center; padding:10px; cursor:pointer; color:var(--gold); border:2px dashed rgba(245,158,11,.3); border-radius:8px; margin:10px 0; }
.dev-custom-module { background:rgba(16,185,129,.05); border:1px solid #10b981; border-radius:8px; padding:10px; margin-bottom:10px; }
.dev-custom-module div { display:flex; justify-content:space-between; color:#10b981; font-size:.75rem; margin-bottom:5px; }
.dev-custom-module span { display:flex; gap:8px; color:var(--gold); }
.dev-custom-module pre { margin:0; border:0; padding:0; color:var(--text-muted); font-size:.7rem; }
.meg-inline-image { margin-top:10px; border:1px solid var(--border-color); background:var(--bg-main); border-radius:8px; overflow:hidden; max-width:420px; }
.meg-inline-image img { display:block; width:100%; height:auto; }
.meg-inline-image div { padding:10px; display:flex; flex-direction:column; gap:4px; }
.meg-inline-image span { color:var(--text-muted); font-size:.75rem; }
.fa-spin .meg-svg, .mem-spinner .meg-svg { animation:spin 1s linear infinite; }
@media (max-width:768px) {
  .dock-icon i.meg-fa { margin-right:0 !important; font-size:1rem !important; width:auto !important; flex:0 0 auto; }
  .image-lab, .dev-layout { grid-template-columns:1fr; }
  .memory-dashboard { grid-template-columns:repeat(2,minmax(0,1fr)); }
  .inline-form { grid-template-columns:1fr; }
  .mtab-card-grid.compact, .npc-grid, .setting-grid, .resolution-grid { grid-template-columns:1fr; }
}
`;

function styles(): string {
  return `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
${ST_PARITY_CSS}
${BETA_STYLE_CSS}
${LUMIVERSE_COMPAT_CSS}`;
}
