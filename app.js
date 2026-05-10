import * as webllm from "https://esm.run/@mlc-ai/web-llm";

const MODEL_ID    = "SmolLM2-360M-Instruct-q4f16_1-MLC";
const MAX_TOKENS  = 512;
const TEMPERATURE = 0.7;
const TOP_P       = 0.95;
const SEARCH_TIMEOUT = 8000;

let engine = null, isReady = false, isGenerating = false, abortFlag = false;
let webSearchEnabled = true;
let conversationHistory = [];
let tpsHistory = [], genStartTime = 0, tokenCount = 0;

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
const elWebToggle     = $("web-toggle");

// ── UTILS ──
function isSecureCtx() {
  return window.isSecureContext ||
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1";
}

function fetchWithTimeout(url, ms = SEARCH_TIMEOUT) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(id));
}

// ── WEB SEARCH DETECTION ──
function needsWebSearch(prompt) {
  const triggers = [
    'search','find','latest','news','current','today','who is','what is happening',
    'price','weather','stock','recent','right now','2024','2025','2026','yesterday',
    'this week','trending','top','live','what happened','hacker news','tech news'
  ];
  const lower = prompt.toLowerCase();
  return triggers.some(t => lower.includes(t));
}

// ── WEATHER ──
async function getWeather(query) {
  const cityMatch = query.match(/weather\s+(?:in\s+)?([a-zA-Z\s]+)/i);
  if (!cityMatch) return null;
  const city = cityMatch[1].trim();
  try {
    const geoRes = await fetchWithTimeout(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`
    );
    const geo = await geoRes.json();
    if (!geo.results?.length) return null;
    const { latitude, longitude, name, country } = geo.results[0];
    const wxRes = await fetchWithTimeout(
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true&hourly=relativehumidity_2m&forecast_days=1`
    );
    const wx = await wxRes.json();
    const cw = wx.current_weather;
    const wmoDesc = {0:'Clear Sky',1:'Mainly Clear',2:'Partly Cloudy',3:'Overcast',45:'Fog',48:'Icy Fog',51:'Light Drizzle',53:'Drizzle',55:'Heavy Drizzle',61:'Light Rain',63:'Rain',65:'Heavy Rain',71:'Light Snow',73:'Snow',75:'Heavy Snow',80:'Light Showers',81:'Showers',82:'Heavy Showers',95:'Thunderstorm',99:'Thunderstorm w/ Hail'};
    return {
      city: `${name}, ${country}`,
      temp: cw.temperature,
      wind: cw.windspeed,
      condition: wmoDesc[cw.weathercode] || `Code ${cw.weathercode}`
    };
  } catch { return null; }
}

// ── HACKER NEWS ──
async function getHackerNews() {
  const idsRes = await fetchWithTimeout("https://hacker-news.firebaseio.com/v0/topstories.json");
  const ids = await idsRes.json();
  const top5 = ids.slice(0, 5);
  const stories = await Promise.all(top5.map(async id => {
    try {
      const r = await fetchWithTimeout(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
      return await r.json();
    } catch { return null; }
  }));
  return stories.filter(Boolean);
}

// ── MAIN WEB SEARCH ──
async function webSearch(query) {
  const results = [];

  // DuckDuckGo
  try {
    const r = await fetchWithTimeout(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`
    );
    const d = await r.json();
    if (d.AbstractText) results.push(`DuckDuckGo: ${d.AbstractText}`);
    if (d.Answer)       results.push(`Answer: ${d.Answer}`);
    if (d.RelatedTopics?.[0]?.Text) results.push(d.RelatedTopics[0].Text);
  } catch {}

  // Wikipedia summary
  try {
    const term = query.split(' ').slice(0,4).join('_');
    const r = await fetchWithTimeout(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(term)}`
    );
    const w = await r.json();
    if (w.extract) results.push(`Wikipedia: ${w.extract.slice(0, 600)}`);
  } catch {}

  // allorigins scrape
  try {
    const target = `https://en.wikipedia.org/wiki/${encodeURIComponent(query.split(' ').slice(0,4).join('_'))}`;
    const r = await fetchWithTimeout(`https://api.allorigins.win/get?url=${encodeURIComponent(target)}`);
    const data = await r.json();
    const doc = new DOMParser().parseFromString(data.contents, 'text/html');
    const paras = [...doc.querySelectorAll('p')]
      .map(p => p.textContent).filter(t => t.trim().length > 80).slice(0,3).join(' ');
    if (paras) results.push(`Web: ${paras.slice(0, 800)}`);
  } catch {}

  return results.join('\n\n');
}
// ── STATUS ──
function setStatus(type, text) {
  elStatusBadge.className = "badge badge-status";
  elStatusText.textContent = text;
  if (type === "downloading") {
    elStatusBadge.classList.add("is-downloading");
    elStatusText.textContent = "↓ Downloading";
    elStatusIcon.textContent = "↓"; elStatusIcon.title = "Downloading…";
  } else if (type === "ready") {
    elStatusBadge.classList.add("is-ready");
    elStatusText.textContent = "✓ Offline";
    elStatusIcon.textContent = "✓"; elStatusIcon.title = "Ready";
  } else if (type === "generating") {
    elStatusBadge.classList.add("is-ready");
    elStatusText.textContent = "● Generating";
    elStatusIcon.textContent = "●";
  } else if (type === "error") {
    elStatusBadge.classList.add("is-error");
    elStatusIcon.textContent = "✕"; elStatusIcon.title = "Error";
  } else {
    elStatusIcon.textContent = "…"; elStatusIcon.title = text;
  }
}

// ── TPS ──
function updateTps(v) {
  if (v === null) { elTpsValue.textContent = "—"; elTpsWrap.classList.remove("is-generating"); return; }
  elTpsWrap.classList.add("is-generating");
  elTpsValue.textContent = v.toFixed(1);
}
function resetTps() { tpsHistory=[]; genStartTime=0; tokenCount=0; updateTps(null); }
function recordToken() {
  const now = performance.now();
  if (!genStartTime) genStartTime = now;
  tokenCount++;
  const elapsed = (now - genStartTime) / 1000;
  if (elapsed < 0.1) return null;
  const raw = tokenCount / elapsed;
  const prev = tpsHistory[tpsHistory.length-1] ?? raw;
  tpsHistory.push(prev*0.7 + raw*0.3);
  if (tpsHistory.length > 20) tpsHistory.shift();
  return tpsHistory[tpsHistory.length-1];
}

// ── PROGRESS ──
function showProgress(pct, label) {
  elProgressCont.classList.remove("hidden");
  elProgressCont.setAttribute("aria-valuenow", Math.round(pct));
  elProgressFill.style.width = `${pct}%`;
  elProgressLabel.textContent = label;
}
function hideProgress() { elProgressCont.classList.add("hidden"); elProgressFill.style.width = "0%"; }

// ── INPUT STATE ──
function setInputEnabled(on) {
  elUserInput.disabled = !on;
  elClearBtn.disabled  = !on;
  elSendBtn.disabled   = !on;
  elTemplateBar.querySelectorAll(".chip").forEach(c => c.disabled = !on);
}
function setGeneratingUI(gen) {
  isGenerating = gen;
  if (gen) {
    elSendBtn.classList.add("is-generating");
    elSendBtn.title = "Stop";
    elSendBtn.querySelector("span").textContent = "Stop";
    elSendBtn.querySelector("svg").innerHTML = `<rect x="3" y="3" width="8" height="8" rx="1" fill="currentColor"/>`;
    setStatus("generating","● Generating");
  } else {
    elSendBtn.classList.remove("is-generating");
    elSendBtn.title = "Send message";
    elSendBtn.querySelector("span").textContent = "Send";
    elSendBtn.querySelector("svg").innerHTML = `<path d="M7 12V2M2 7l5-5 5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;
    setStatus("ready","✓ Offline");
  }
}

// ── MESSAGES ──
function hideEmptyState() { elEmptyState.classList.add("hidden"); elEmptyState.setAttribute("aria-hidden","true"); }

function createSystemMessage(text, state="") {
  const div = document.createElement("div");
  div.className = `message system${state?" "+state:""}`;
  const t = document.createElement("div");
  t.className = "message-text";
  t.textContent = text;
  div.appendChild(t);
  elMessagesList.appendChild(div);
  scrollToBottom();
  return div;
}

function createMessageEl(role, text, state="done", webEnhanced=false) {
  const wrap   = document.createElement("div");
  wrap.className = `message ${role}${state!=="done"?" "+state:""}`;
  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.setAttribute("aria-hidden","true");
  avatar.textContent = role==="user"?"U":"AI";
  const body     = document.createElement("div");
  body.className = "message-body";
  const roleDiv  = document.createElement("div");
  roleDiv.className = "message-role";
  roleDiv.textContent = role==="user"?"You":"SmolLM2";
  if (role==="assistant" && webEnhanced) {
    const badge = document.createElement("span");
    badge.className = "web-badge";
    badge.textContent = "🌐 Web";
    roleDiv.appendChild(badge);
  }
  const textEl = document.createElement("div");
  textEl.className = "message-text";
  textEl.textContent = text;
  body.appendChild(roleDiv);
  body.appendChild(textEl);
  wrap.appendChild(avatar);
  wrap.appendChild(body);
  elMessagesList.appendChild(wrap);
  scrollToBottom();
  return { wrap, textEl, body };
}

function createWeatherCard(data) {
  const card = document.createElement("div");
  card.className = "weather-card";
  card.innerHTML = `
    <div class="weather-title">🌡 Weather in ${data.city}</div>
    <span class="wrow-label">Temperature</span><span class="wrow-val">${data.temp}°C</span>
    <span class="wrow-label">Wind</span><span class="wrow-val">${data.wind} km/h</span>
    <span class="wrow-label">Condition</span><span class="wrow-val">${data.condition}</span>`;
  return card;
}

function createHNList(stories) {
  const wrap = document.createElement("div");
  wrap.className = "hn-list";
  stories.forEach((s,i) => {
    const item = document.createElement("div");
    item.className = "hn-item";
    item.innerHTML = `<a href="${s.url||'https://news.ycombinator.com/item?id='+s.id}" target="_blank" rel="noopener">${i+1}. ${s.title}</a>
      <div class="hn-meta">▲ ${s.score} · by ${s.by}</div>`;
    wrap.appendChild(item);
  });
  return wrap;
}

function scrollToBottom() {
  requestAnimationFrame(() => elChatArea.scrollTo({ top: elChatArea.scrollHeight, behavior:"smooth" }));
}

// ── MODEL INIT ──
async function initModel() {
  setStatus("init","Initializing…");
  elHintStatus.textContent = "Loading model…";
  setInputEnabled(false);

  if (!isSecureCtx()) {
    const msg = "⚠️ Secure Context Required: Open this via a local server (npx serve .) or HTTPS — not file://.";
    setStatus("error","Security Error"); elHintStatus.textContent="HTTPS Required";
    createMessageEl("assistant",msg,"error"); hideEmptyState(); return;
  }
  if (!navigator.gpu) {
    const msg = "⚠️ WebGPU not found. Use Chrome 113+ and enable chrome://flags/#enable-unsafe-webgpu if needed.";
    setStatus("error","No WebGPU"); elHintStatus.textContent="WebGPU missing";
    createMessageEl("assistant",msg,"error"); hideEmptyState(); return;
  }

  let firstProgress = false;
  const initProgressCallback = (report) => {
    const pct = report.progress*100, text = report.text||"";
    if (!firstProgress) {
      firstProgress = true;
      const isDl = text.toLowerCase().includes("fetch")||text.toLowerCase().includes("download")||pct<5;
      setStatus(isDl?"downloading":"init", isDl?"↓ Downloading":"Loading from cache…");
    }
    if (pct > 0) showProgress(pct, text||`Loading… ${pct.toFixed(0)}%`);
    if (report.progress >= 1) hideProgress();
  };

  try {
    engine = await webllm.CreateMLCEngine(MODEL_ID, { initProgressCallback, logLevel:"SILENT" });
    if (engine.device) {
      engine.device.lost.then(info => {
        isReady=false; setStatus("error","GPU Lost");
        elHintStatus.textContent="GPU crashed — refresh";
        createMessageEl("assistant","WebGPU device lost: "+info.message+". Please refresh.","error");
      });
    }
    isReady=true; setStatus("ready","✓ Offline");
    elHintStatus.textContent="Ready · Model cached";
    setInputEnabled(true); hideProgress(); elUserInput.focus();
  } catch(err) {
    let msg = err.message||String(err);
    if (msg.includes("Cache")||msg.includes("network error"))
      msg="Network/Cache error — check connection and serve over HTTPS.";
    setStatus("error","Load failed"); elHintStatus.textContent="Failed to load"; hideProgress();
    createMessageEl("assistant",`Failed to load: ${msg}\n\n• Chrome 113+ required\n• Serve via HTTPS or localhost\n• ~700MB RAM needed`,"error");
    hideEmptyState();
  }
}

// ── GENERATE ──
async function generate(userText) {
  if (!isReady||isGenerating) return;
  const trimmed = userText.trim(); if (!trimmed) return;
  hideEmptyState();
  conversationHistory.push({ role:"user", content:trimmed });
  createMessageEl("user", trimmed, "done");

  const { wrap:aWrap, textEl:aTextEl, body:aBody } = createMessageEl("assistant","","loading");

  elUserInput.value=""; autoResize(elUserInput);
  setInputEnabled(false); setGeneratingUI(true); resetTps(); abortFlag=false;

  let contextPrompt = trimmed;
  let webEnhanced = false;
  let weatherData = null;
  let hnStories   = null;

  // ── WEB SEARCH FLOW ──
  if (webSearchEnabled && needsWebSearch(trimmed)) {
    const sysMsg = createSystemMessage("🔍 Searching the web…","searching");
    elHintStatus.textContent="↗ Fetching web…"; elHintStatus.className="is-searching";

    const lower = trimmed.toLowerCase();
    const isWeather = lower.includes("weather");
    const isHN = lower.includes("hacker news")||lower.includes("tech news")||lower.includes("trending");

    let searchContext = "";
    let allFailed = true;

    try {
      if (isWeather) {
        weatherData = await getWeather(trimmed);
        if (weatherData) {
          searchContext = `Weather data for ${weatherData.city}: Temp ${weatherData.temp}°C, Wind ${weatherData.wind}km/h, Condition: ${weatherData.condition}.`;
          allFailed = false;
        }
      } else if (isHN) {
        hnStories = await getHackerNews();
        if (hnStories?.length) {
          searchContext = "Top Hacker News stories:\n" + hnStories.map((s,i)=>`${i+1}. ${s.title} (${s.score} pts by ${s.by})`).join("\n");
          allFailed = false;
        }
      } else {
        searchContext = await webSearch(trimmed);
        if (searchContext.trim()) allFailed = false;
      }
    } catch { allFailed = true; }

    if (allFailed) {
      sysMsg.className="message system warn";
      sysMsg.querySelector(".message-text").textContent="⚠️ Web search unavailable — answering from local knowledge.";
    } else {
      sysMsg.className="message system success";
      sysMsg.querySelector(".message-text").textContent="✅ Web context found. Generating answer…";
      webEnhanced = true;
      contextPrompt = `The user asked: "${trimmed}"\n\nReal-time web context:\n---\n${searchContext}\n---\nUsing the above, answer the user concisely and accurately. If context is irrelevant, use your own knowledge.`;
    }

    elHintStatus.textContent="🌐 Web enhanced"; elHintStatus.className="is-web-done";
  }

  // If web enhanced, add web badge to avatar role label
  if (webEnhanced) {
    const roleDiv = aBody.querySelector(".message-role");
    const badge = document.createElement("span");
    badge.className="web-badge"; badge.textContent="🌐 Web";
    roleDiv.appendChild(badge);
  }

  // Weather card in chat
  if (weatherData) {
    aBody.appendChild(createWeatherCard(weatherData));
  }
  // HN list in chat
  if (hnStories?.length) {
    aBody.appendChild(createHNList(hnStories));
  }

  const messages = [
    { role:"system", content:"You are a helpful, concise AI assistant running in the user's browser. Keep responses clear and brief." },
    ...conversationHistory.slice(0,-1),
    { role:"user", content: contextPrompt }
  ];

  let fullText="", firstChunk=true;
  try {
    const stream = await engine.chat.completions.create({
      messages, stream:true, stream_options:{ include_usage:true },
      max_tokens:MAX_TOKENS, temperature:TEMPERATURE, top_p:TOP_P
    });
    for await (const chunk of stream) {
      if (abortFlag) { try { await engine.interruptGenerate(); } catch {} break; }
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        if (firstChunk) { aWrap.classList.remove("loading"); aWrap.classList.add("streaming"); firstChunk=false; }
        fullText+=delta; aTextEl.textContent=fullText;
        const s=recordToken(); if (s!==null) updateTps(s);
        scrollToBottom();
      }
      if (chunk.usage) {
        const elapsed=(performance.now()-genStartTime)/1000;
        if (elapsed>0.05) updateTps((chunk.usage.completion_tokens||tokenCount)/elapsed);
      }
    }
    aWrap.classList.remove("streaming","loading");
    if (!fullText) { aTextEl.textContent="(No response generated)"; aWrap.classList.add("error"); }
    else conversationHistory.push({ role:"assistant", content:fullText });
  } catch(err) {
    if (abortFlag) {
      aWrap.classList.remove("streaming","loading");
      if (!fullText) aTextEl.textContent="(Stopped)";
      if (fullText) conversationHistory.push({ role:"assistant", content:fullText });
    } else {
      aWrap.classList.remove("streaming","loading"); aWrap.classList.add("error");
      aTextEl.textContent=`Error: ${err.message||err}`;
    }
  } finally {
    setGeneratingUI(false); setInputEnabled(true);
    elHintStatus.textContent="Ready · Model cached"; elHintStatus.className="";
    elUserInput.focus(); scrollToBottom();
  }
}

// ── HANDLERS ──
function handleSend() {
  if (!isReady) return;
  if (isGenerating) { abortFlag=true; return; }
  const text=elUserInput.value;
  if (!text.trim()) return;
  generate(text);
}

function handleClear() {
  if (isGenerating) return;
  conversationHistory=[]; elMessagesList.innerHTML="";
  elEmptyState.classList.remove("hidden"); elEmptyState.setAttribute("aria-hidden","false");
  resetTps(); elUserInput.value=""; autoResize(elUserInput); elUserInput.focus();
  elHintStatus.textContent="Ready · Model cached"; elHintStatus.className="";
}

function autoResize(el) {
  el.style.height="auto";
  el.style.height=Math.min(el.scrollHeight,160)+"px";
}

// ── WEB TOGGLE ──
elWebToggle.addEventListener("click", () => {
  webSearchEnabled = !webSearchEnabled;
  elWebToggle.classList.toggle("is-on", webSearchEnabled);
  elWebToggle.setAttribute("aria-pressed", webSearchEnabled);
  elWebToggle.title = webSearchEnabled ? "Web search enabled — click to disable" : "Web search disabled — click to enable";
});

// ── TEMPLATE CHIPS ──
elTemplateBar.addEventListener("click", e => {
  const chip=e.target.closest(".chip");
  if (!chip||!isReady||isGenerating) return;
  const prompt=chip.dataset.prompt; if (!prompt) return;
  elUserInput.value=prompt; autoResize(elUserInput); elUserInput.focus();
});

// ── EVENTS ──
elSendBtn.addEventListener("click", handleSend);
elClearBtn.addEventListener("click", handleClear);
elUserInput.addEventListener("input", () => autoResize(elUserInput));
elUserInput.addEventListener("keydown", e => {
  if (e.key==="Enter"&&!e.shiftKey) { e.preventDefault(); handleSend(); }
});

// ── BOOT ──
initModel();
