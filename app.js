/**
 * SmolLM2 Chat · app.js
 * Uses @mlc-ai/web-llm via CDN (ESM)
 * Works by opening index.html directly in Chrome — no build step.
 */

import * as webllm from "https://esm.run/@mlc-ai/web-llm";

// ─── CONFIG ─────────────────────────────────────────────────────────────────
const MODEL_ID    = "SmolLM2-360M-Instruct-q4f16_1-MLC";
const MAX_TOKENS  = 512;
const TEMPERATURE = 0.7;
const TOP_P       = 0.95;

// ─── STATE ──────────────────────────────────────────────────────────────────
let engine        = null;
let isReady       = false;
let isGenerating  = false;
let abortFlag     = false;
let conversationHistory = [];   // [{role, content}, …]

// tok/s tracking
let tpsHistory    = [];         // rolling window of recent tok/s samples
let genStartTime  = 0;
let tokenCount    = 0;

// ─── DOM REFS ────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const elStatusBadge   = $("status-badge");
const elStatusText    = $("status-text");
const elStatusInd     = $("status-indicator");
const elStatusIcon    = $("status-icon");
const elTpsValue      = $("tps-value");
const elTpsWrap       = $("tps-wrap");
const elProgressCont  = $("progress-container");
const elProgressFill  = $("progress-fill");
const elProgressLabel = $("progress-label");
const elTemplateBar   = $("template-bar");
const elChatArea      = $("chat-area");
const elMessagesList  = $("messages-list");
const elEmptyState    = $("empty-state");
const elUserInput     = $("user-input");
const elSendBtn       = $("send-btn");
const elClearBtn      = $("clear-btn");
const elHintStatus    = $("hint-status");

// ─── STATUS HELPERS ──────────────────────────────────────────────────────────
function setStatus(type, text) {
  // type: "init" | "downloading" | "ready" | "generating" | "error"
  elStatusBadge.className = "badge badge-status";
  elStatusText.textContent = text;

  if (type === "downloading") {
    elStatusBadge.classList.add("is-downloading");
    elStatusText.textContent = "↓ Downloading";
    elStatusIcon.textContent = "↓";
    elStatusIcon.title = "Downloading model…";
  } else if (type === "ready") {
    elStatusBadge.classList.add("is-ready");
    elStatusText.textContent = "✓ Offline";
    elStatusIcon.textContent = "✓";
    elStatusIcon.title = "Model ready · Offline";
  } else if (type === "generating") {
    elStatusBadge.classList.add("is-ready");
    elStatusText.textContent = "● Generating";
    elStatusIcon.textContent = "●";
  } else if (type === "error") {
    elStatusBadge.classList.add("is-error");
    elStatusIcon.textContent = "✕";
    elStatusIcon.title = "Error";
  } else {
    // init / neutral
    elStatusIcon.textContent = "…";
    elStatusIcon.title = text;
  }
}

// ─── TOK/S DISPLAY ───────────────────────────────────────────────────────────
function updateTps(value) {
  if (value === null) {
    elTpsValue.textContent = "—";
    elTpsWrap.classList.remove("is-generating");
    return;
  }
  elTpsWrap.classList.add("is-generating");
  elTpsValue.textContent = value.toFixed(1);
}

function resetTps() {
  tpsHistory  = [];
  genStartTime = 0;
  tokenCount   = 0;
  updateTps(null);
}

/** Called each time a new token arrives. Returns smoothed tok/s. */
function recordToken() {
  const now = performance.now();
  if (genStartTime === 0) genStartTime = now;
  tokenCount++;

  // elapsed in seconds
  const elapsed = (now - genStartTime) / 1000;
  if (elapsed < 0.1) return null;   // too early for a useful reading

  const raw = tokenCount / elapsed;

  // EWA smoothing: weight last sample 30 %, history 70 %
  if (tpsHistory.length === 0) {
    tpsHistory.push(raw);
  } else {
    const prev = tpsHistory[tpsHistory.length - 1];
    tpsHistory.push(prev * 0.7 + raw * 0.3);
  }

  // keep at most 20 samples
  if (tpsHistory.length > 20) tpsHistory.shift();

  return tpsHistory[tpsHistory.length - 1];
}

// ─── PROGRESS UI ─────────────────────────────────────────────────────────────
function showProgress(pct, label) {
  elProgressCont.classList.remove("hidden");
  elProgressCont.setAttribute("aria-valuenow", Math.round(pct));
  elProgressFill.style.width = `${pct}%`;
  elProgressLabel.textContent = label;
}

function hideProgress() {
  elProgressCont.classList.add("hidden");
  elProgressFill.style.width = "0%";
}

// ─── ENABLE / DISABLE INPUT ──────────────────────────────────────────────────
function setInputEnabled(enabled) {
  elUserInput.disabled   = !enabled;
  elClearBtn.disabled    = !enabled;
  elSendBtn.disabled     = !enabled;
  elTemplateBar.querySelectorAll(".chip").forEach(c => {
    c.disabled = !enabled;
  });
}

function setGeneratingUI(generating) {
  isGenerating = generating;
  if (generating) {
    elSendBtn.classList.add("is-generating");
    elSendBtn.title = "Stop generation";
    elSendBtn.querySelector("span").textContent = "Stop";
    elSendBtn.querySelector("svg").innerHTML =
      `<rect x="3" y="3" width="8" height="8" rx="1" fill="currentColor"/>`;
    setStatus("generating", "● Generating");
  } else {
    elSendBtn.classList.remove("is-generating");
    elSendBtn.title = "Send message";
    elSendBtn.querySelector("span").textContent = "Send";
    elSendBtn.querySelector("svg").innerHTML =
      `<path d="M7 12V2M2 7l5-5 5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;
    setStatus("ready", "✓ Offline");
  }
}

// ─── MESSAGE RENDERING ───────────────────────────────────────────────────────
function hideEmptyState() {
  elEmptyState.classList.add("hidden");
  elEmptyState.setAttribute("aria-hidden", "true");
}

function createMessageEl(role, text, state = "done") {
  // state: "done" | "streaming" | "loading" | "error"
  const wrap = document.createElement("div");
  wrap.className = `message ${role}${state !== "done" ? " " + state : ""}`;

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = role === "user" ? "U" : "AI";

  const body = document.createElement("div");
  body.className = "message-body";

  const roleLabel = document.createElement("div");
  roleLabel.className = "message-role";
  roleLabel.textContent = role === "user" ? "You" : "SmolLM2";

  const textEl = document.createElement("div");
  textEl.className = "message-text";
  textEl.textContent = text;

  body.appendChild(roleLabel);
  body.appendChild(textEl);
  wrap.appendChild(avatar);
  wrap.appendChild(body);

  elMessagesList.appendChild(wrap);
  scrollToBottom();
  return { wrap, textEl };
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    elChatArea.scrollTo({ top: elChatArea.scrollHeight, behavior: "smooth" });
  });
}

// ─── MODEL LOADING ───────────────────────────────────────────────────────────
async function initModel() {
  setStatus("init", "Initializing…");
  elHintStatus.textContent = "Loading model…";
  setInputEnabled(false);

  let firstProgressSeen = false;

  const initProgressCallback = (report) => {
    const pct   = report.progress * 100;
    const text  = report.text || "";

    if (!firstProgressSeen) {
      firstProgressSeen = true;
      // Decide: downloading or just loading from cache
      const isDownload = text.toLowerCase().includes("fetch") ||
                         text.toLowerCase().includes("download") ||
                         text.toLowerCase().includes("loading: ") ||
                         pct < 5;
      if (isDownload) {
        setStatus("downloading", "↓ Downloading");
      } else {
        setStatus("init", "Loading from cache…");
      }
    }

    if (pct > 0) {
      showProgress(pct, text || `Loading… ${pct.toFixed(0)}%`);
    }

    if (report.progress >= 1) {
      hideProgress();
    }
  };

  try {
    engine = await webllm.CreateMLCEngine(MODEL_ID, {
      initProgressCallback,
      logLevel: "SILENT",
    });

    isReady = true;
    setStatus("ready", "✓ Offline");
    elHintStatus.textContent = "Ready · Model cached";
    setInputEnabled(true);
    hideProgress();

    // Focus input
    elUserInput.focus();

  } catch (err) {
    console.error("[SmolLM2] Init error:", err);
    setStatus("error", "Error loading model");
    elHintStatus.textContent = "Failed to load model";
    hideProgress();

    // Show error in chat
    createMessageEl("assistant",
      `Failed to load model: ${err.message || err}\n\nPlease check:\n• You're using Chrome 113+ with WebGPU enabled\n• You have enough RAM (~700 MB free)\n• You're connected for the first download`,
      "error"
    );
    hideEmptyState();
  }
}

// ─── GENERATION ──────────────────────────────────────────────────────────────
async function generate(userText) {
  if (!isReady || isGenerating) return;

  const trimmed = userText.trim();
  if (!trimmed) return;

  hideEmptyState();

  // Add user message to history & DOM
  conversationHistory.push({ role: "user", content: trimmed });
  createMessageEl("user", trimmed, "done");

  // Create assistant placeholder
  const { wrap: assistantWrap, textEl: assistantTextEl } =
    createMessageEl("assistant", "", "loading");

  // Disable input during generation; send becomes "Stop"
  elUserInput.value = "";
  autoResize(elUserInput);
  setInputEnabled(false);
  setGeneratingUI(true);
  resetTps();
  abortFlag = false;

  // Build messages array
  const messages = [
    {
      role: "system",
      content:
        "You are a helpful, concise AI assistant running entirely in the user's browser. " +
        "Keep responses clear and appropriately brief.",
    },
    ...conversationHistory,
  ];

  let fullText = "";
  let firstChunk = true;

  try {
    const stream = await engine.chat.completions.create({
      messages,
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      top_p: TOP_P,
    });

    for await (const chunk of stream) {
      if (abortFlag) {
        // Try to interrupt gracefully
        try { await engine.interruptGenerate(); } catch (_) {}
        break;
      }

      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        if (firstChunk) {
          // Switch from loading spinner to streaming cursor
          assistantWrap.classList.remove("loading");
          assistantWrap.classList.add("streaming");
          firstChunk = false;
        }

        fullText += delta;
        assistantTextEl.textContent = fullText;

        // tok/s update every token
        const smooth = recordToken();
        if (smooth !== null) {
          updateTps(smooth);
        }

        scrollToBottom();
      }

      // Final usage chunk — use for definitive tok/s
      if (chunk.usage) {
        const completionTokens = chunk.usage.completion_tokens || tokenCount;
        const elapsedSec = (performance.now() - genStartTime) / 1000;
        if (elapsedSec > 0.05) {
          updateTps(completionTokens / elapsedSec);
        }
      }
    }

    // Finalise
    assistantWrap.classList.remove("streaming", "loading");

    if (!fullText) {
      assistantTextEl.textContent = "(No response generated)";
      assistantWrap.classList.add("error");
    } else {
      // Add to history
      conversationHistory.push({ role: "assistant", content: fullText });
    }

  } catch (err) {
    if (abortFlag) {
      // User-initiated stop — keep partial text
      assistantWrap.classList.remove("streaming", "loading");
      if (!fullText) assistantTextEl.textContent = "(Stopped)";
      if (fullText) conversationHistory.push({ role: "assistant", content: fullText });
    } else {
      console.error("[SmolLM2] Generation error:", err);
      assistantWrap.classList.remove("streaming", "loading");
      assistantWrap.classList.add("error");
      assistantTextEl.textContent = `Error: ${err.message || err}`;
    }
  } finally {
    setGeneratingUI(false);
    setInputEnabled(true);
    elUserInput.focus();
    scrollToBottom();
  }
}

// ─── SEND HANDLER ────────────────────────────────────────────────────────────
function handleSend() {
  if (!isReady) return;

  if (isGenerating) {
    // Act as stop button
    abortFlag = true;
    return;
  }

  const text = elUserInput.value;
  if (!text.trim()) return;
  generate(text);
}

// ─── CLEAR HANDLER ───────────────────────────────────────────────────────────
function handleClear() {
  if (isGenerating) return;
  conversationHistory = [];
  elMessagesList.innerHTML = "";
  elEmptyState.classList.remove("hidden");
  elEmptyState.setAttribute("aria-hidden", "false");
  resetTps();
  elUserInput.value = "";
  autoResize(elUserInput);
  elUserInput.focus();
}

// ─── TEXTAREA AUTO-RESIZE ────────────────────────────────────────────────────
function autoResize(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 160) + "px";
}

// ─── TEMPLATE CHIPS ──────────────────────────────────────────────────────────
elTemplateBar.addEventListener("click", e => {
  const chip = e.target.closest(".chip");
  if (!chip || !isReady || isGenerating) return;
  const prompt = chip.dataset.prompt;
  if (!prompt) return;
  elUserInput.value = prompt;
  autoResize(elUserInput);
  elUserInput.focus();
  // Optional: auto-send immediately
  // generate(prompt);
});

// ─── EVENT LISTENERS ─────────────────────────────────────────────────────────
elSendBtn.addEventListener("click", handleSend);
elClearBtn.addEventListener("click", handleClear);

elUserInput.addEventListener("input", () => autoResize(elUserInput));

elUserInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});

// ─── BOOT ────────────────────────────────────────────────────────────────────
initModel();
