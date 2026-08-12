import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { clone, mergeProfile } from "./defaults";
import { REQUIRED_PLACEHOLDER_FEATURES, auditPresetPlaceholders, buildPromptMessages, estimateMeguminPayloadTokens, getLogic } from "./prompt-engine";
import { extractNpcBlocks } from "./text";
import { patchComfyWorkflow } from "./image-workflow";
import { DEFAULT_PROFILE } from "./defaults";
import type { ChatContext, ChatMessage, EngineMode, LlmMessage } from "./types";

const frontendSource = readFileSync(new URL("./frontend.ts", import.meta.url), "utf8");
const backendSource = readFileSync(new URL("./backend.ts", import.meta.url), "utf8");
const spindleManifest = JSON.parse(readFileSync(new URL("../spindle.json", import.meta.url), "utf8")) as { permissions: string[] };

const context: ChatContext = {
  chatId: "chat_test",
  chatName: "Test Chat",
  characterId: "char_test",
  characterName: "Yunyun",
  characterAvatarUrl: "/api/v1/characters/char_test/avatar?size=lg",
  isGroup: false,
  scope: "chat_chat_test"
};

describe("Megumin UI parity audit", () => {
  test("keeps ST tab copy, gated panels, and preset bridge wording", () => {
    const requiredLabels = [
      "Choose the core ruleset that drives all NPC behavior and world logic.",
      "Define the personality and extra toggles.",
      "Set response length, output language, and how the AI addresses you.",
      "Attach extra modules that appear at the end of every response.",
      "Control the AI's internal reasoning process before it writes.",
      "Wire up ComfyUI to auto-generate scene images during roleplay.",
      "V7 Modules (Turn off to disable)",
      "Dialogue / Narration Ratio",
      "ComfyUI Server & Workflow",
      "Send Portraits to AI",
      "Requires V6",
      "Cinematic Sounds",
      "Important:",
      "Megumin Engine Preset",
      "Megumin Image Preset",
      "id=\"ig_main_content\"",
      "id=\"npc_main_content\"",
      "id=\"dev_btn_new\"",
      "id=\"dev_btn_import\"",
      "id=\"dev_save_mode\"",
      "id=\"ps_btn_scan_slop\"",
      "id=\"ig_enable_card\"",
      "id=\"npc_enable_card\"",
      "slider.id = \"dnr_slider\"",
      "narrValue.id = \"lbl_narr\"",
      "preview.id = \"dnr_preview\"",
      "meg-manual-image-prompt",
      "data-action=\"image-manual\"",
      "data-action=\"ban-import\"",
      "data-action=\"npc-upload\"",
      "showPromptPreview",
      "presetFeatureWarning",
      "bindFloatWidgetButton",
      "pointerdown",
      "suppressClick",
      "flushProfileSave",
      "scope: state.context?.scope",
      "event.target !== event.currentTarget",
      "CHAT_SWITCHED",
      "CHAT_CHANGED",
      "CHARACTER_AVATAR_CHANGED",
      "characterAvatarUrl",
      "heroName",
      "updateSaveIndicator",
      "statusClearTimer",
      "shouldRenderAfterBind",
      "ST_PARITY_CSS",
      "@import url('https://fonts.googleapis.com/css2?family=Inter",
      ".mtab-card-grid {",
      "grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));",
      ".ps-modern-input {",
      "padding: 12px 16px;",
      "font-size: 0.85rem;",
      ".ps-modern-btn {",
      "font-weight: 600;",
      ".mtab-param-row input[type=\"range\"]",
      "accent-color: var(--gold);",
      "id=\"ps_btn_reset\"",
      "fa-floppy-disk",
      "fa-shield-halved",
      "fa-right-from-bracket",
      "fa-pen-to-square",
      "fa-code-branch",
      "fa-clock",
      "fa-align-left"
    ];
    for (const label of requiredLabels) expect(frontendSource).toContain(label);

    const forbiddenLabels = [
      "Use Lumiverse image connections",
      "tracker is injected",
      "Scan Last Message",
      "Lumiverse quiet generation",
      "Preset-specific Main 3",
      "Ready"
    ];
    for (const label of forbiddenLabels) expect(frontendSource).not.toContain(label);

    expect(frontendSource).not.toContain("<p>${escapeHtml(current.sub)}</p>");
    expect(frontendSource).not.toContain("--accent:${engine.color");
    expect(frontendSource).not.toContain("data-action=\"image-manual\"><span");
    expect(frontendSource).not.toContain("floatWidget.root.querySelector(\"button\")?.addEventListener(\"click\", () => openApp())");
    expect(frontendSource).not.toContain("syncRangeInput");
    expect(frontendSource).not.toContain("::-webkit-slider-thumb");
    expect(frontendSource).not.toContain("::-moz-range-thumb");
    expect(frontendSource).not.toContain("color-mix(");
    expect(spindleManifest.permissions).toContain("presets");
    expect(backendSource).toContain("preset:resolve");
    expect(backendSource).toContain("preset:status");
    expect(backendSource).toContain("preset:audit");
    expect(backendSource).toContain("style:generate");
    expect(backendSource).toContain("style:insights");
    expect(backendSource).toContain("image:prompt");
    expect(backendSource).toContain("npc:uploadPortrait");
    expect(backendSource).toContain("spindle.images.uploadFromDataUrl");
    expect(backendSource).toContain("force_preset_id");
    expect(backendSource).toContain("spindle.storage.read(path)");
    expect(backendSource).toContain("spindle.storage.write(path");
    expect(backendSource).not.toContain("spindle.userStorage");
    expect(backendSource).toContain("safeProfileScope");
    expect(frontendSource).not.toContain(".mtab-panel, .wstyle-dnr-panel");
    const compactFrontend = frontendSource.replace(/\s+/g, "");
    expect(compactFrontend).toContain(".wstyle-dnr-label.narr{color:#a855f7");
    expect(compactFrontend).toContain(".wstyle-dnr-label.dial{color:#10b981");
    expect(frontendSource).toContain("if (shouldRenderAfterBind(input)) render();");
  });
});

describe("Megumin preset bridge", () => {
  test("discovers uploaded Lumiverse presets without seeding or mutating them", () => {
    for (const name of ["Megumin Engine", "Megumin Image", "Megumin Suite V7 DS4", "Megumin Suite V7 Gemini"]) {
      expect(backendSource).toContain(name);
    }

    expect(backendSource).not.toContain("MEGUMIN_PRESET_SEEDS");
    expect(backendSource).not.toContain("convertStPromptToBlock");
    expect(backendSource).not.toContain("presets.create");
    expect(backendSource).not.toContain("presets.update");
    expect(backendSource).not.toContain("presets.delete");
    expect(backendSource).not.toContain("blocks.create");
    expect(backendSource).not.toContain("blocks.delete");
    expect(backendSource).toContain("spindle.presets.blocks.list");
    expect(backendSource).toContain("REQUIRED_PLACEHOLDER_FEATURES");
    expect(backendSource).toContain("payloadEstimateTokens");
    expect(backendSource).toContain("suiteDs4PresetId");
    expect(backendSource).toContain("suiteGeminiPresetId");
    expect(spindleManifest.permissions).toContain("presets");
    expect(backendSource).toContain("___PS_STORY_PLAN___");
    expect(backendSource).toContain("___PS_IMAGE_GEN___");
  });
});

describe("Megumin preset contract audit", () => {
  const featureById = (features: ReturnType<typeof auditPresetPlaceholders>, id: string) => {
    const feature = features.find((item) => item.id === id);
    expect(feature).toBeTruthy();
    return feature!;
  };

  test("accepts official DS4 double-bracket core placeholders without single-bracket aliases", () => {
    const features = auditPresetPlaceholders([
      "[[prompt1]]",
      "[[prompt2]]",
      "[[prompt3]]",
      "[[prompt4]]",
      "[[prompt5]]",
      "[[prompt6]]",
      "[[main]]",
      "[[AI1]]",
      "[[AI2]]",
      "[[OOC]]",
      "[[control]]"
    ], true);
    const core = featureById(features, "core-engines");

    expect(core.connected).toBe(true);
    expect(core.missing).toEqual([]);
    expect(core.present).not.toContain("[prompt1]");
  });

  test("treats single-bracket prompt hooks as aliases instead of separate requirements", () => {
    const features = auditPresetPlaceholders([
      "[prompt1]",
      "[prompt2]",
      "[prompt3]",
      "[prompt4]",
      "[prompt5]",
      "[prompt6]",
      "[[main]]",
      "[[AI1]]",
      "[[AI2]]",
      "[[OOC]]",
      "[[control]]"
    ], true);
    const core = featureById(features, "core-engines");

    expect(core.connected).toBe(true);
    expect(core.missing).toEqual([]);
    expect(core.present).toContain("[prompt1]");
  });

  test("does not manufacture per-tab missing-hook spam when no suite preset was scanned", () => {
    const features = auditPresetPlaceholders([], false);

    expect(features.every((feature) => feature.connected)).toBe(true);
    expect(features.flatMap((feature) => feature.missing)).toEqual([]);
  });

  test("reports compact hook labels for truly missing scanned preset hooks", () => {
    const features = auditPresetPlaceholders(["[[prompt1]]", "[[main]]"], true);
    const core = featureById(features, "core-engines");

    expect(core.connected).toBe(false);
    expect(core.missing).toContain("prompt2 hook");
    expect(core.missing).not.toContain("[[prompt2]]");
    expect(frontendSource).toContain("presetStatusWarning");
    expect(frontendSource).toContain("payloadTokenLabel");
    expect(frontendSource).not.toContain("feature.missing.map((placeholder) => `${feature.label}: ${placeholder}`)");
  });
});

describe("Megumin ST function coverage audit", () => {
  test("keeps Lumiverse equivalents for the major original render and backend flows", () => {
    const frontendMappings = [
      "function renderEngines",
      "function renderPersona",
      "function renderStyle",
      "function renderGlobalSettings",
      "function renderBlocks",
      "function renderThinking",
      "function renderStory",
      "function renderBanList",
      "function renderImage",
      "function renderNpc",
      "function renderDev"
    ];
    for (const marker of frontendMappings) expect(frontendSource).toContain(marker);

    const backendMappings = [
      "buildPromptMessages",
      "story:generate",
      "banlist:analyze",
      "npc:scan",
      "image:manual",
      "engine:save",
      "preset:status",
      "preset:audit",
      "prompt:dryRun",
      "prompt:preview"
    ];
    for (const marker of backendMappings) expect(backendSource).toContain(marker);
  });
});

describe("Megumin prompt assembly", () => {
  test("coerces numeric UI values before prompt assembly", () => {
    // Pinned to V7: the flat word count is a legacy-engine feature. V9 replaces it
    // with a length band and emits [[count]] empty — covered separately below.
    const profile = mergeProfile({ mode: "v7-core", userWordCount: 400, userLanguage: "French", customThinkEffort: 250 });
    const result = buildPromptMessages([{ role: "system", content: "[[count]]\n[[Language]]" }], [], profile, [], context);
    const joined = result.messages.map((message) => typeof message.content === "string" ? message.content : "").join("\n");

    expect(profile.userWordCount).toBe("400");
    expect(profile.customThinkEffort).toBe("250");
    expect(joined).toContain("maximum 400 words");
    expect(joined).toContain("FRENCH");
    expect(joined).not.toContain("[[count]]");
  });

  test("replaces every visible control placeholder across uploaded preset messages", () => {
    const profile = clone(DEFAULT_PROFILE);
    // This sweeps the legacy V7 preset surface, [[count]] included, so it pins the
    // engine rather than following whatever the default happens to be.
    profile.mode = "v7-core";
    profile.userWordCount = "420";
    profile.userLanguage = "French";
    profile.userPronouns = "male";
    profile.addons = ["death", "combat", "direct", "dn", "color", "npc_events"];
    profile.blocks = ["info", "summary", "cyoa", "mvu", "npc_inner_chatter"];
    profile.model = "cot-v1-english";
    profile.thinkingV2 = true;
    profile.dnRatio = { enabled: true, dialogue: 70 };
    profile.onomatopoeia = { enabled: true, useStyling: true };
    profile.storyPlan.enabled = true;
    profile.storyPlan.currentPlan = "A summer festival exposes the hidden archive clue.";
    profile.banList = ["a shiver ran down their spine"];
    profile.imageGen.enabled = true;
    profile.imageGen.triggerMode = "always";
    profile.npcBank.enabled = true;
    profile.npcBank.npcs = [{ name: "Arue", appearance: "Crimson eyes", timestamp: 1 }];

    const chatMessages: ChatMessage[] = [
      { id: "0", role: "user", content: "Arue appears near the festival stage." }
    ];
    const incoming: LlmMessage[] = [
      { role: "system", content: "[[Language]]\n[[pronouns]]\n[[count]]\n[[DNRATIO]]" },
      { role: "system", content: "[[death]] [[combat]] [[Direct]] [[DN]] [[COLOR]] [[npc_events]] [[onomato]]" },
      { role: "system", content: "[[infoblock]] [[summary]] [[cyoa]] [[cyoa2]] [[MVU]] [[npc_inner_chatter]] [[npc_inner_chatter2]]" },
      { role: "system", content: "[[COT]]\n[[prefill]]\n[[THINK]]" },
      { role: "system", content: "[[storyplan]]\n[[storytracker]]\n[[storytracker2]]\n[[banlist]]\n[[img1]]\n[[img2]]\n[[npc list]]\n[[npc_dossier]]\n[[npc_dossier2]]\n[[long-Memory]]\n[[Short-memory]]" }
    ];
    const result = buildPromptMessages(incoming, chatMessages, profile, [], context);
    const joined = result.messages.map((message) => typeof message.content === "string" ? message.content : "").join("\n");

    expect(result.breakdown).toHaveLength(0);
    expect(result.changedMessages).toHaveLength(5);
    expect(joined).toContain("ALL OUTPUT EXCEPT THINKING MUST BE IN FRENCH ONLY");
    expect(joined).toContain("{{user}} is male. Always portray and address him as such.");
    expect(joined).toContain("— maximum 420 words");
    expect(joined).toContain("- Ratio: Maintain a balance of 70% Dialogue and 30% Narration.");
    expect(joined).toContain("Narration must utilize onomatopoeia");
    expect(joined).toContain("[BAN LIST]");
    expect(joined).toContain("dead language");
    expect(joined).toContain("<Story_Plan>");
    expect(joined).toContain("A summer festival exposes the hidden archive clue.");
    expect(joined).toContain("<Story_Tracker>");
    expect(joined).toContain("[IMAGE GENERATION]");
    expect(joined).toContain("<img prompt=\"prompt\">");
    expect(joined).toContain("[RELEVANT NPCs]");
    expect(joined).toContain("<npc_dossier>");
    for (const feature of REQUIRED_PLACEHOLDER_FEATURES) {
      for (const placeholder of feature.placeholders) expect(joined).not.toContain(placeholder);
    }
  });

  test("tracks changed uploaded preset messages without duplicating them in Prompt Breakdown", () => {
    // V7: both blocks must survive substitution with content, so both count as
    // changed. Under V9 the [[count]] block resolves empty and is dropped entirely.
    const profile = mergeProfile({ mode: "v7-core", userLanguage: "Spanish", userWordCount: 250 });
    const result = buildPromptMessages([
      { role: "system", content: "[[Language]]" },
      { role: "system", content: "[[count]]" },
      { role: "system", content: "Plain unchanged block" }
    ], [], profile, [], context);

    expect(result.breakdown).toEqual([]);
    expect(result.changedMessages.map((entry) => entry.messageIndex)).toEqual([0, 1]);
    expect(result.replacementsMade).toBeGreaterThanOrEqual(2);
    expect(result.estimatedInjectionTokens).toBeGreaterThan(0);
  });

  test("V9 resolves its length bands and drops the legacy word count", () => {
    const profile = clone(DEFAULT_PROFILE);
    profile.mode = "v9-core";
    profile.v9Limits = { leanMin: 111, leanMax: 222, fullMin: 333, fullMax: 444 };
    // Set deliberately: V9 must ignore it rather than emit both length systems.
    profile.userWordCount = "999";

    // All six anchors: which slot carries the bands is the corpus's business.
    const result = buildPromptMessages(
      [{ role: "system", content: "[[prompt1]][[prompt2]][[prompt3]][[prompt4]][[prompt5]][[prompt6]]\n[[count]]" }],
      [],
      profile,
      [],
      context
    );
    const joined = result.messages.map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");

    // The bands are written inside the V9 engine body, so they must be resolved
    // before substitution or they reach the model as raw tokens.
    expect(joined).toContain("111");
    expect(joined).toContain("222");
    expect(joined).not.toContain("[[v9_lean_min]]");
    expect(joined).not.toContain("[[v9_full_max]]");
    expect(joined).not.toContain("maximum 999 words");
    expect(joined).not.toContain("[[count]]");
  });

  test("V9 folds the writing style into the engine body and clears the loose anchor", () => {
    const profile = clone(DEFAULT_PROFILE);
    profile.mode = "v9-core";
    profile.aiRule = "SENTINEL_STYLE_RULE";

    const result = buildPromptMessages(
      [
        { role: "system", content: "[[prompt1]][[prompt2]][[prompt3]][[prompt4]][[prompt5]][[prompt6]]" },
        { role: "system", content: "[[aiprompt]]" }
      ],
      [],
      profile,
      [],
      context
    );
    const joined = result.messages.map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");

    // Present once — inside the engine prompt — not twice.
    expect(joined).toContain("SENTINEL_STYLE_RULE");
    expect(joined.split("SENTINEL_STYLE_RULE").length - 1).toBe(1);
    expect(joined).not.toContain("[[aiprompt]]");
  });

  test("the thinking framework is delivered through THINK, not duplicated in COT", () => {
    const profile = clone(DEFAULT_PROFILE);
    profile.mode = "v9-core";
    profile.model = "cot-v9-english";

    const result = buildPromptMessages(
      [{ role: "system", content: "COT:[[COT]]" }, { role: "system", content: "THINK:[[THINK]]" }],
      [],
      profile,
      [],
      context
    );
    const contents = result.messages.map((m) => (typeof m.content === "string" ? m.content : ""));
    const think = contents.find((c) => c.startsWith("THINK:")) || "";

    expect(think).toContain("<think>");
    expect(think.length).toBeGreaterThan(50);
    // COT resolved empty, so its block collapsed to the bare label or was dropped.
    expect(contents.some((c) => c.startsWith("COT:") && c.trim() !== "COT:")).toBe(false);
  });

  test("V9 engines and their CoT frameworks are present in the corpus", () => {
    const ids = new Set(getLogic().modes.map((mode) => mode.id));
    for (const id of ["v9-core", "v9-lite", "v9-director", "v9-immersion", "v8-fusion", "v7.5"]) {
      expect(ids.has(id)).toBe(true);
    }
    const modelIds = new Set(getLogic().models.map((model) => model.id));
    for (const id of ["cot-v9-english", "cot-v9-lite-english", "cot-v8-english"]) {
      expect(modelIds.has(id)).toBe(true);
    }
    // Every engine must name a CoT framework that exists, or thinking silently dies.
    expect(modelIds.has(DEFAULT_PROFILE.model)).toBe(true);
    expect(ids.has(DEFAULT_PROFILE.mode)).toBe(true);
  });

  test("Story Config compiles into a <config> block and vanishes when off", () => {
    const on = clone(DEFAULT_PROFILE);
    on.storyConfig = { ...on.storyConfig, enabled: true, genre: "noir", tone: "bleak", era: "1950s" };
    const built = buildPromptMessages([{ role: "system", content: "[[config]]" }], [], on, [], context);
    const joined = built.messages.map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");

    expect(joined).toContain("<config>");
    expect(joined).toContain("- genre: noir");
    expect(joined).toContain("- era: 1950s");
    expect(joined).toContain("- narration tone: bleak");
    expect(joined).not.toContain("[[config]]");

    // Off, or on with every field blank, must leave nothing behind at all.
    const off = clone(DEFAULT_PROFILE);
    const empty = buildPromptMessages([{ role: "system", content: "A\n[[config]]\nB" }], [], off, [], context);
    expect(empty.messages[0].content).toBe("A\nB");

    const enabledButBlank = clone(DEFAULT_PROFILE);
    enabledButBlank.storyConfig = { ...enabledButBlank.storyConfig, enabled: true };
    const blank = buildPromptMessages([{ role: "system", content: "A\n[[config]]\nB" }], [], enabledButBlank, [], context);
    expect(blank.messages[0].content).toBe("A\nB");
  });

  test("a field set to its own named default is treated as Default and dropped", () => {
    const profile = clone(DEFAULT_PROFILE);
    // "ordinary" is npcDisposition's documented default, so it must not emit a line.
    profile.storyConfig = { ...profile.storyConfig, enabled: true, genre: "noir", npcDisposition: "ordinary" };
    const built = buildPromptMessages([{ role: "system", content: "[[config]]" }], [], profile, [], context);
    const joined = built.messages.map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");

    expect(joined).toContain("- genre: noir");
    expect(joined).not.toContain("npc_disposition");
  });

  test("the Blocks envelope wraps the stack in order and blanks the loose anchors", () => {
    const profile = clone(DEFAULT_PROFILE);
    profile.blocks = ["info", "cyoa"];
    profile.blockStack.order = ["world", "cyoa", "bonds"];

    const built = buildPromptMessages(
      [{ role: "system", content: "[[blocks]]" }, { role: "system", content: "LOOSE:[[cyoa]][[infoblock]]" }],
      [],
      profile,
      [],
      context
    );
    const joined = built.messages.map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");

    expect(joined).toContain("<Blocks>");
    expect(joined).toContain("</Blocks>");
    // Stack order is the emitted order.
    expect(joined.indexOf("<World_State>")).toBeLessThan(joined.indexOf("<CYOA>"));
    expect(joined.indexOf("<CYOA>")).toBeLessThan(joined.indexOf("<Bonds>"));
    // Bonds is generated from the stat field list, not from a token.
    expect(joined).toContain("Affection: [0-100]/100");
    // The loose anchors are blanked, so that block collapsed to its bare label.
    const loose = built.messages.map((m) => (typeof m.content === "string" ? m.content : "")).find((c) => c.startsWith("LOOSE:"));
    expect(loose).toBe("LOOSE:");
  });

  test("an empty block stack leaves legacy per-block anchors working", () => {
    const profile = clone(DEFAULT_PROFILE);
    profile.blocks = ["info", "cyoa"];
    // No blockStack.order: V7-era presets must behave exactly as they always did.
    const built = buildPromptMessages(
      [{ role: "system", content: "[[blocks]]" }, { role: "system", content: "LOOSE:[[cyoa]]" }],
      [],
      profile,
      [],
      context
    );
    const joined = built.messages.map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");

    expect(joined).not.toContain("<Blocks>");
    const loose = built.messages.map((m) => (typeof m.content === "string" ? m.content : "")).find((c) => c.startsWith("LOOSE:"));
    expect(loose).not.toBe("LOOSE:");
    expect(loose).toContain("[Short suggestion]");
  });

  test("a legacy preset keeps [[storytracker]] even though system blocks fill the envelope", () => {
    // Story Tracker is a system block: it joins the envelope whenever the Story
    // Planner is on, with no block stack involved. A V7 preset has [[storytracker]]
    // and no [[blocks]], so surrendering the anchor would drop the tracker entirely.
    const profile = clone(DEFAULT_PROFILE);
    profile.storyPlan.enabled = true;
    profile.storyPlan.currentPlan = "The festival hides the archive clue.";

    const built = buildPromptMessages([{ role: "system", content: "T:[[storytracker]]" }], [], profile, [], context);
    const joined = built.messages.map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");

    expect(joined).toContain("<Story_Tracker>");
  });

  test("no block body reaches the model twice when the envelope is active", () => {
    const profile = clone(DEFAULT_PROFILE);
    profile.blocks = ["info", "cyoa"];
    profile.blockStack.order = ["cyoa", "world"];

    const built = buildPromptMessages(
      [{ role: "system", content: "[[blocks]]\n[[cyoa]]\n[[infoblock]]\n[[cyoa2]]\n[[infoblock2]]" }],
      [],
      profile,
      [],
      context
    );
    const joined = built.messages.map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");

    // A distinctive line from the CYOA template must appear exactly once.
    expect(joined.split("1. [Short suggestion]").length - 1).toBe(1);
    expect((joined.match(/<CYOA>/g) || []).length).toBe(1);
    expect((joined.match(/<World_State>/g) || []).length).toBe(1);
  });

  test("compact World State replaces the full block off-cadence", () => {
    const profile = clone(DEFAULT_PROFILE);
    profile.blocks = ["info"];
    profile.blockStack.order = ["world"];
    profile.worldState = { compactEnabled: true, fullFreq: 5 };

    const at = (assistantTurns: number) => {
      const chat: ChatMessage[] = Array.from({ length: assistantTurns }, (_, i) => ({
        id: String(i),
        role: "assistant" as const,
        content: "..."
      }));
      const built = buildPromptMessages([{ role: "system", content: "[[blocks]]" }], chat, profile, [], context);
      return built.messages.map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");
    };

    // Reply 5 (four already sent) is the full one; reply 1 is compact.
    expect(at(0)).toContain("Omit deep lore");
    expect(at(4)).not.toContain("Omit deep lore");
  });

  test("the shipped V9.1 preset resolves with no raw tokens left behind", () => {
    const preset = JSON.parse(readFileSync(new URL("../Presets/Megumin Suite V9.1 Universal.json", import.meta.url), "utf8")) as {
      prompts: Array<{ content?: string }>;
    };
    const incoming: LlmMessage[] = (preset.prompts || [])
      .filter((entry) => typeof entry.content === "string" && entry.content.trim())
      .map((entry) => ({ role: "system", content: entry.content as string }));
    expect(incoming.length).toBeGreaterThan(5);

    const profile = clone(DEFAULT_PROFILE);
    profile.blocks = ["info", "cyoa"];
    profile.blockStack.order = ["cyoa", "world", "bonds"];
    profile.storyConfig = { ...profile.storyConfig, enabled: true, genre: "noir" };

    const built = buildPromptMessages(incoming, [], profile, [], context);
    const joined = built.messages.map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");

    // The whole point: nothing that looks like engine syntax survives to the model.
    expect(joined.match(/\[\[[^\]]{1,30}\]\]/g)).toBeNull();
    expect(joined).toContain("<config>");
    expect(joined).toContain("<Blocks>");
  });

  test("removes empty placeholder lines when a feature has no active payload", () => {
    const result = buildPromptMessages([
      { role: "system", content: "Before\n[[banlist]]\nAfter" }
    ], [], clone(DEFAULT_PROFILE), [], context);

    expect(result.messages[0].content).toBe("Before\nAfter");
    expect(String(result.messages[0].content)).not.toContain("[[banlist]]");
  });

  test("honors custom dev-engine overrides for global and utility placeholders", () => {
    const profile = clone(DEFAULT_PROFILE);
    profile.mode = "custom_override";
    profile.userLanguage = "French";
    profile.userWordCount = "400";
    profile.userPronouns = "female";
    profile.dnRatio = { enabled: true, dialogue: 20 };
    profile.onomatopoeia.enabled = true;
    profile.storyPlan.enabled = true;
    profile.storyPlan.currentPlan = "Default plan";
    profile.banList = ["default ban"];

    const customEngine: EngineMode = {
      id: "custom_override",
      label: "Custom Override",
      p1: "[[Language]]\n[[pronouns]]\n[[count]]\n[[DNRATIO]]\n[[onomato]]\n[[banlist]]\n[[storytracker]]",
      language: "LANGUAGE OVERRIDE",
      pronouns: "PRONOUN OVERRIDE",
      count: "COUNT OVERRIDE",
      dnratio: "DNRATIO OVERRIDE",
      onomato: "ONOMATO OVERRIDE",
      banlist: "BANLIST OVERRIDE",
      storytracker: "STORYTRACKER OVERRIDE",
      customToggles: [{ id: "extra_module", attachPoint: "p1", content: "CUSTOM TOGGLE PAYLOAD" }]
    };
    profile.toggles.extra_module = true;

    const result = buildPromptMessages([{ role: "system", content: "[[prompt1]]" }], [], profile, [customEngine], context);
    const joined = result.messages.map((message) => typeof message.content === "string" ? message.content : "").join("\n");

    for (const expected of ["LANGUAGE OVERRIDE", "PRONOUN OVERRIDE", "COUNT OVERRIDE", "DNRATIO OVERRIDE", "ONOMATO OVERRIDE", "BANLIST OVERRIDE", "STORYTRACKER OVERRIDE", "CUSTOM TOGGLE PAYLOAD"]) {
      expect(joined).toContain(expected);
    }
    expect(joined).not.toContain("ALL OUTPUT EXCEPT THINKING");
    expect(joined).not.toContain("Default plan");
  });

  test("payload token estimate can be constrained to detected preset hooks", () => {
    const profile = mergeProfile({ userLanguage: "Japanese", userWordCount: 800, dnRatio: { enabled: true, dialogue: 40 } });
    const fallback = estimateMeguminPayloadTokens(profile, [], [], context);
    const audited = estimateMeguminPayloadTokens(profile, [], [], context, new Set(["[[Language]]"]));

    expect(fallback).toBeGreaterThan(audited);
    expect(audited).toBeGreaterThan(0);
  });

  test("replaces uploaded preset placeholders and strips the dropped memory hooks", () => {
    const profile = clone(DEFAULT_PROFILE);
    // Asserts on V7's <system_config> prompt body, so the engine is pinned.
    profile.mode = "v7-core";

    const chatMessages: ChatMessage[] = [
      { id: "0", role: "user", content: "The party crossed the northern bridge while ash fell for hours." },
      { id: "1", role: "assistant", content: "The keeper revealed that the ruby key unlocks the archive shrine beneath the guild hall." },
      { id: "2", role: "user", content: "We should use the ruby key now." }
    ];
    const incoming: LlmMessage[] = [
      { role: "system", content: ["[[prompt1]]", "[[long-Memory]]", "[[Short-memory]]", "[[npc_dossier2]]"].join("\n") },
      ...chatMessages.map((message) => ({ role: message.role, content: message.content }))
    ];

    const result = buildPromptMessages(incoming, chatMessages, profile, [], context);
    const joined = result.messages.map((message) => typeof message.content === "string" ? message.content : "").join("\n");

    expect(joined).toContain("<system_config>");
    // Memory Core is dropped from this port, but its hooks must still be swept so a
    // preset carrying them never ships raw tokens to the model.
    expect(joined).not.toContain("[[long-Memory]]");
    expect(joined).not.toContain("[[Short-memory]]");
    // Nothing prunes chat turns any more, so every message survives.
    expect(result.prunedCount).toBe(0);
    expect(result.messages.some((message) => message.content === chatMessages[0].content)).toBe(true);
    expect(result.changedMessages.length).toBeGreaterThan(0);
    expect(result.breakdown.some((entry) => entry.name?.includes("Placeholder Injection"))).toBe(false);
  });
});

describe("Megumin NPC parsing", () => {
  test("extracts assistant NPC dossier blocks into structured records", () => {
    const [npc] = extractNpcBlocks(`
<details>
<summary>New NPC: Arue</summary>
**Name:** Arue | **Age:** 16 | **Sex:** Female
**Appearance:** Crimson eyes, black mantle, dramatic pose.
**Occupation:** Student novelist
**Background:** She writes disaster romances in secret.
**Inner Circle:**
* Megumin - rival and friend
**Personality Snapshot:** Grandiose but sincere.
**Current Agenda:** Finish her manuscript.
**Hidden Layer:** She fears nobody reads her drafts.
</details>`);

    expect(npc.name).toBe("Arue");
    expect(npc.age).toBe("16");
    expect(npc.appearance).toContain("Crimson eyes");
    expect(npc.agenda).toContain("manuscript");
  });
});

describe("Megumin image workflow patching", () => {
  test("patches ComfyUI mapped fields without mutating the stored template", () => {
    const profile = clone(DEFAULT_PROFILE);
    profile.imageGen.customNegative = "low quality";
    profile.imageGen.imgWidth = 832;
    profile.imageGen.imgHeight = 1216;
    profile.imageGen.steps = 24;
    profile.imageGen.cfg = 6.5;
    profile.imageGen.selectedSampler = "euler";
    profile.imageGen.customSeed = 1234;

    const connection = {
      metadata: {
        comfyui: {
          workflow_api_json: {
            "6": { inputs: { text: "old positive" } },
            "7": { inputs: { text: "old negative" } },
            "8": { inputs: { width: 512, height: 512, seed: 0 } }
          },
          field_mappings: [
            { nodeId: "6", fieldName: "text", mappedAs: "positive_prompt" },
            { nodeId: "7", fieldName: "text", mappedAs: "negative_prompt" },
            { nodeId: "8", fieldName: "width", mappedAs: "width" },
            { nodeId: "8", fieldName: "height", mappedAs: "height" },
            { nodeId: "8", fieldName: "seed", mappedAs: "seed" }
          ]
        }
      }
    };

    const patched = patchComfyWorkflow(connection, profile, "Megumin casting explosion") as any;

    expect(patched["6"].inputs.text).toBe("Megumin casting explosion");
    expect(patched["7"].inputs.text).toBe("low quality");
    expect(patched["8"].inputs.width).toBe(832);
    expect(patched["8"].inputs.height).toBe(1216);
    expect(patched["8"].inputs.seed).toBe(1234);
    expect(connection.metadata.comfyui.workflow_api_json["6"].inputs.text).toBe("old positive");
  });
});

describe("Megumin V9 profile plumbing", () => {
  test("every key a tab claims is actually syncable on the backend", () => {
    // activeTabProfileKeys drives "sync this tab everywhere". A key the backend
    // whitelist does not know is dropped in silence, so the two lists must agree.
    const claimed = frontendSource.match(/^\s{4}\w+: \[(.*?)\],?$/gm) || [];
    const keys = new Set<string>();
    for (const line of claimed) {
      for (const match of line.matchAll(/"([a-zA-Z0-9_]+)"/g)) keys.add(match[1]);
    }
    expect(keys.size).toBeGreaterThan(10);
    for (const key of keys) {
      expect(backendSource.includes(`"${key}"`)).toBe(true);
    }
  });

  test("the V9 profile fields survive a save/hydrate round trip", () => {
    const profile = clone(DEFAULT_PROFILE);
    profile.storyConfig = { ...profile.storyConfig, enabled: true, genre: "noir" };
    profile.blockStack = { order: ["cyoa", "world"], custom: [{ id: "c1", name: "Weather", tag: "Weather", content: "x" }], overrides: {} };
    profile.worldState = { compactEnabled: true, fullFreq: 3 };
    profile.statBlocks.bonds.fields.push({ id: "jealousy", label: "Jealousy", type: "meter", max: 100, start: 5 });

    const round = mergeProfile(JSON.parse(JSON.stringify(profile)));
    expect(round.storyConfig.genre).toBe("noir");
    expect(round.blockStack.order).toEqual(["cyoa", "world"]);
    expect(round.blockStack.custom[0].tag).toBe("Weather");
    expect(round.worldState).toEqual({ compactEnabled: true, fullFreq: 3 });
    expect(round.statBlocks.bonds.fields.some((f) => f.label === "Jealousy")).toBe(true);
  });
});

describe("Megumin CoT picker", () => {
  const models = getLogic().models.map((model) => model.id);
  const split = (id: string) => {
    const match = /^cot-(.+)-([a-z]{2,8})$/.exec(id);
    return match ? { type: match[1], lang: match[2] } : null;
  };
  const typeIds = () => {
    const ids = new Set<string>();
    for (const id of models) {
      if (id === "cot-off") continue;
      const parts = split(id);
      if (parts) ids.add(parts.type);
    }
    return [...ids].sort((a, b) => b.length - a.length);
  };
  const resolveType = (model: string) => {
    if (model === "cot-off") return "off";
    for (const type of typeIds()) if (model.startsWith(`cot-${type}-`)) return type;
    return split(model)?.type || "off";
  };

  test("every CoT family in the corpus has a label in the picker", () => {
    // The V8/V9 frameworks shipped in the data but were absent from the hardcoded
    // picker list, so a V9 profile displayed as "CoT V1" and any click on the tab
    // overwrote it with a V1 model.
    for (const type of typeIds()) {
      expect(frontendSource).toContain(`"${type}"`);
    }
    for (const type of ["v9", "v9-lite", "v9-director", "v9-immersion", "v9-hybrid", "v8", "v8-fusion", "v7.5"]) {
      expect(typeIds()).toContain(type);
      expect(frontendSource).toContain(`"${type}"`);
    }
  });

  test("a model id resolves to its own family, longest match winning", () => {
    expect(resolveType("cot-v9-english")).toBe("v9");
    expect(resolveType("cot-v9-lite-english")).toBe("v9-lite");
    expect(resolveType("cot-v9-immersion-english")).toBe("v9-immersion");
    expect(resolveType("cot-v8-fusion-english")).toBe("v8-fusion");
    expect(resolveType("cot-v7.5-english")).toBe("v7.5");
    expect(resolveType("cot-v6-lite-jp")).toBe("v6-lite");
    expect(resolveType("cot-off")).toBe("off");
    // The default must round-trip, or the tab misreports the active framework.
    expect(resolveType(DEFAULT_PROFILE.model)).toBe("v9");
  });

  test("a family never advertises a language it was not written in", () => {
    for (const type of typeIds()) {
      const langs = models.filter((id) => split(id)?.type === type).map((id) => split(id)!.lang);
      for (const lang of langs) {
        expect(models).toContain(`cot-${type}-${lang}`);
      }
      // V9/V8/V7 are English-only; a French option would name a model that does
      // not exist, which silently disables thinking.
      if (type.startsWith("v9") || type.startsWith("v8") || type.startsWith("v7")) {
        expect(langs).toEqual(["english"]);
      }
    }
  });
});

describe("Megumin Memory Core removal", () => {
  test("no Memory Core surface survives in the source", () => {
    // Dropped deliberately from this port. These assertions exist so a later
    // merge cannot quietly reintroduce half of it.
    for (const source of [frontendSource, backendSource]) {
      expect(source).not.toContain("memoryCore");
      expect(source).not.toContain("longTermVault");
      expect(source).not.toContain("shortTermChunks");
    }
    expect(backendSource).not.toContain("processMemory");
    expect(backendSource).not.toContain("___PS_MEMORY_SUMMARIZE___");
    expect(frontendSource).not.toContain("renderMemory");
    // The permission it needed must go with it.
    expect(spindleManifest.permissions).not.toContain("memories");
  });

  test("the retired memory hooks still resolve to nothing rather than leaking", () => {
    const profile = clone(DEFAULT_PROFILE);
    const built = buildPromptMessages(
      [{ role: "system", content: "A\n[[long-Memory]]\n[[Short-memory]]\nB" }],
      [],
      profile,
      [],
      context
    );
    expect(built.messages[0].content).toBe("A\nB");
    // The audit must not ask a preset for hooks the port no longer fills.
    expect(REQUIRED_PLACEHOLDER_FEATURES.some((feature) => feature.id === "memory-core")).toBe(false);
  });
});
