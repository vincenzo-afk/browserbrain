import * as webllm from "https://esm.run/@mlc-ai/web-llm";
import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2";
env.allowLocalModels = false;

// ── CONFIG ──
const MODEL_ID = "Dolphin3.0-Qwen2.5-1.5B-q4f16_1-MLC";
const MAX_TOKENS = 768;
const TEMPERATURE = 0.7;
const TOP_P = 0.95;
const SEARCH_TIMEOUT = 8000;
const SYSTEM_PROMPT = `You are Vanta, an expert AI assistant that reasons carefully.
For any question:
- Think through it step by step internally
- Give structured, clear answers
- For code: explain then write then explain output
- For concepts: define, example, use case
- For comparisons: use bullet points
- Never truncate your answer
Be thorough, precise, and genuinely helpful.`;

// ── STATE ──
let engine = null, embedder = null;
let isReady = false, embedderReady = false;
let isGenerating = false, abortFlag = false;
let webSearchEnabled = true;
let conversationHistory = [];
let tpsHistory = [], genStartTime = 0, tokenCount = 0;
let knowledgeBase = []; // [{id, text, embedding}]
let kbPanelOpen = false;

// ── DOM ──
const $ = id => document.getElementById(id);
const elStatusBadge   = $("status-badge");
const elStatusText    = $("status-text");
const elStatusIcon    = $("status-icon");
const elEmbBadge      = $("embedder-badge");
const elEmbText       = $("emb-text");
const elEmbInd        = $("emb-indicator");
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
const elKbToggle      = $("kb-toggle");
const elKbCount       = $("kb-count");
const elKbPanel       = $("kb-panel");
const elKbOverlay     = $("kb-overlay");
const elKbClose       = $("kb-close");
const elKbInput       = $("kb-input");
const elKbAddBtn      = $("kb-add-btn");
const elKbStatus      = $("kb-status");
const elKbList        = $("kb-list");
const elKbChunksLabel = $("kb-chunks-label");
const elKbClearAll    = $("kb-clear-all");

// ── UTILS ──
function isSecureCtx() {
  return window.isSecureContext || location.hostname === "localhost" || location.hostname === "127.0.0.1";
}
function fetchWithTimeout(url, ms = SEARCH_TIMEOUT) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(id));
}
function scrollToBottom() {
  requestAnimationFrame(() => elChatArea.scrollTo({ top: elChatArea.scrollHeight, behavior: "smooth" }));
}
function autoResize(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 160) + "px";
}

// ── RAG: COSINE SIMILARITY ──
function cosineSimilarity(a, b) {
  const dot = a.reduce((s, ai, i) => s + ai * b[i], 0);
  const magA = Math.sqrt(a.reduce((s, ai) => s + ai * ai, 0));
  const magB = Math.sqrt(b.reduce((s, bi) => s + bi * bi, 0));
  return dot / (magA * magB);
}

// ── RAG: CHUNK TEXT ──
function chunkText(text, size = 400, overlap = 50) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, start + size));
    start += size - overlap;
  }
  return chunks.filter(c => c.trim().length > 30);
}

// ── RAG: EMBED ──
async function embed(text) {
  if (!embedderReady || !embedder) return null;
  const out = await embedder(text, { pooling: "mean", normalize: true });
  return Array.from(out.data);
}

// ── RAG: SAVE/LOAD ──
function saveKB() {
  try { localStorage.setItem("vanta_kb", JSON.stringify(knowledgeBase)); } catch {}
}
function loadKB() {
  try {
    const raw = localStorage.getItem("vanta_kb");
    if (raw) knowledgeBase = JSON.parse(raw);
  } catch { knowledgeBase = []; }
}

// ── RAG: ADD TO KB ──
async function addToKB(text) {
  if (!embedderReady) { setKbStatus("RAG embedder not ready yet.", "err"); return; }
  if (!text.trim()) { setKbStatus("Please paste some text first.", "err"); return; }
  setKbStatus("Chunking and embedding…", "");
  elKbAddBtn.disabled = true;
  const chunks = chunkText(text.trim());
  let added = 0;
  for (const chunk of chunks) {
    try {
      const embedding = await embed(chunk);
      if (!embedding) continue;
      knowledgeBase.push({ id: Date.now() + Math.random(), text: chunk, embedding });
      added++;
    } catch {}
  }
  saveKB();
  renderKBList();
  elKbAddBtn.disabled = false;
  setKbStatus(`✓ Added ${added} chunk${added !== 1 ? "s" : ""}.`, "ok");
  elKbInput.value = "";
}

// ── RAG: RETRIEVE CONTEXT ──
async function retrieveContext(query) {
  if (!knowledgeBase.length || !embedderReady) return null;
  const qEmb = await embed(query);
  if (!qEmb) return null;
  const scored = knowledgeBase.map(entry => ({
    text: entry.text,
    score: cosineSimilarity(qEmb, entry.embedding)
  }));
  const top = scored.filter(x => x.score >= 0.3).sort((a, b) => b.score - a.score).slice(0, 3);
  if (!top.length) return null;
  return top.map(x => x.text).join("\n\n");
}

// ── KB UI ──
function setKbStatus(msg, cls = "") {
  elKbStatus.textContent = msg;
  elKbStatus.className = "kb-status" + (cls ? " " + cls : "");
}
function renderKBList() {
  elKbList.innerHTML = "";
  const count = knowledgeBase.length;
  elKbCount.textContent = `(${count})`;
  elKbChunksLabel.textContent = count ? `${count} chunk${count !== 1 ? "s" : ""} stored` : "";
  elKbClearAll.style.display = count ? "block" : "none";
  knowledgeBase.forEach((entry, i) => {
    const div = document.createElement("div");
    div.className = "kb-chunk";
    const span = document.createElement("span");
    span.className = "kb-chunk-text";
    span.textContent = `${i + 1}. ${entry.text.slice(0, 60)}…`;
    const btn = document.createElement("button");
    btn.className = "kb-chunk-del";
    btn.title = "Delete chunk";
    btn.textContent = "✕";
    btn.addEventListener("click", () => {
      knowledgeBase = knowledgeBase.filter(e => e.id !== entry.id);
      saveKB(); renderKBList();
      setKbStatus("Chunk removed.", "ok");
    });
    div.appendChild(span);
    div.appendChild(btn);
    elKbList.appendChild(div);
  });
}
function openKBPanel() {
  kbPanelOpen = true;
  elKbPanel.classList.add("open");
  elKbPanel.setAttribute("aria-hidden", "false");
  elKbOverlay.classList.add("visible");
  elKbOverlay.setAttribute("aria-hidden", "false");
  elKbToggle.classList.add("is-open");
  elKbToggle.setAttribute("aria-expanded", "true");
}
function closeKBPanel() {
  kbPanelOpen = false;
  elKbPanel.classList.remove("open");
  elKbPanel.setAttribute("aria-hidden", "true");
  elKbOverlay.classList.remove("visible");
  elKbOverlay.setAttribute("aria-hidden", "true");
  elKbToggle.classList.remove("is-open");
  elKbToggle.setAttribute("aria-expanded", "false");
}

// ── SEARCH DETECTION ──
function needsWebSearch(prompt) {
  const triggers = ['search','find','latest','news','current','today','who is','what is happening',
    'price','weather','stock','recent','right now','2024','2025','2026','yesterday',
    'this week','trending','top','live','what happened','hacker news','tech news'];
  const lower = prompt.toLowerCase();
  return triggers.some(t => lower.includes(t));
}

// ── WEATHER ──
async function getWeather(query) {
  const m = query.match(/weather\s+(?:in\s+)?([a-zA-Z\s]+)/i);
  if (!m) return null;
  const city = m[1].trim();
  try {
    const gr = await fetchWithTimeout(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`);
    const geo = await gr.json();
    if (!geo.results?.length) return null;
    const { latitude, longitude, name, country } = geo.results[0];
    const wr = await fetchWithTimeout(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true&forecast_days=1`);
    const wx = await wr.json();
    const cw = wx.current_weather;
    const wmo = {0:'Clear Sky',1:'Mainly Clear',2:'Partly Cloudy',3:'Overcast',45:'Fog',61:'Light Rain',63:'Rain',65:'Heavy Rain',71:'Light Snow',80:'Showers',95:'Thunderstorm'};
    return { city:`${name}, ${country}`, temp:cw.temperature, wind:cw.windspeed, condition:wmo[cw.weathercode]||`Code ${cw.weathercode}` };
  } catch { return null; }
}

// ── HACKER NEWS ──
async function getHackerNews() {
  const r = await fetchWithTimeout("https://hacker-news.firebaseio.com/v0/topstories.json");
  const ids = await r.json();
  return Promise.all(ids.slice(0,5).map(async id => {
    try { const s = await fetchWithTimeout(`https://hacker-news.firebaseio.com/v0/item/${id}.json`); return s.json(); } catch { return null; }
  })).then(a => a.filter(Boolean));
}

// ── WEB SEARCH ──
async function webSearch(query) {
  const results = [];
  try {
    const r = await fetchWithTimeout(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`);
    const d = await r.json();
    if (d.AbstractText) results.push(`DuckDuckGo: ${d.AbstractText}`);
    if (d.Answer) results.push(`Answer: ${d.Answer}`);
    if (d.RelatedTopics?.[0]?.Text) results.push(d.RelatedTopics[0].Text);
  } catch {}
  try {
    const term = query.split(' ').slice(0,4).join('_');
    const r = await fetchWithTimeout(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(term)}`);
    const w = await r.json();
    if (w.extract) results.push(`Wikipedia: ${w.extract.slice(0,600)}`);
  } catch {}
  try {
    const target = `https://en.wikipedia.org/wiki/${encodeURIComponent(query.split(' ').slice(0,4).join('_'))}`;
    const r = await fetchWithTimeout(`https://api.allorigins.win/get?url=${encodeURIComponent(target)}`);
    const data = await r.json();
    const doc = new DOMParser().parseFromString(data.contents,'text/html');
    const paras = [...doc.querySelectorAll('p')].map(p=>p.textContent).filter(t=>t.trim().length>80).slice(0,3).join(' ');
    if (paras) results.push(`Web: ${paras.slice(0,800)}`);
  } catch {}
  return results.join('\n\n');
}
// ── STATUS ──
function setStatus(type, text) {
  elStatusBadge.className = "badge badge-status";
  elStatusText.textContent = text;
  if (type==="downloading"){elStatusBadge.classList.add("is-downloading");elStatusText.textContent="↓ Downloading";elStatusIcon.textContent="↓";}
  else if(type==="ready"){elStatusBadge.classList.add("is-ready");elStatusText.textContent="✓ Ready";elStatusIcon.textContent="✓";}
  else if(type==="generating"){elStatusBadge.classList.add("is-ready");elStatusText.textContent="● Generating";elStatusIcon.textContent="●";}
  else if(type==="error"){elStatusBadge.classList.add("is-error");elStatusIcon.textContent="✕";}
  else{elStatusIcon.textContent="…";}
}
function setEmbStatus(type) {
  elEmbBadge.className = "badge badge-embedder";
  if(type==="loading"){elEmbBadge.classList.add("is-downloading");elEmbText.textContent="RAG ↓";}
  else if(type==="ready"){elEmbBadge.classList.add("is-ready");elEmbText.textContent="RAG ✓";}
  else if(type==="error"){elEmbBadge.classList.add("is-error");elEmbText.textContent="RAG ✕";}
  else{elEmbText.textContent="RAG…";}
}

// ── TPS ──
function updateTps(v){if(v===null){elTpsValue.textContent="—";elTpsWrap.classList.remove("is-generating");return;}elTpsWrap.classList.add("is-generating");elTpsValue.textContent=v.toFixed(1);}
function resetTps(){tpsHistory=[];genStartTime=0;tokenCount=0;updateTps(null);}
function recordToken(){
  const now=performance.now();
  if(!genStartTime)genStartTime=now;
  tokenCount++;
  const elapsed=(now-genStartTime)/1000;
  if(elapsed<0.1)return null;
  const raw=tokenCount/elapsed;
  const prev=tpsHistory[tpsHistory.length-1]??raw;
  tpsHistory.push(prev*0.7+raw*0.3);
  if(tpsHistory.length>20)tpsHistory.shift();
  return tpsHistory[tpsHistory.length-1];
}

// ── PROGRESS ──
function showProgress(pct,label){elProgressCont.classList.remove("hidden");elProgressCont.setAttribute("aria-valuenow",Math.round(pct));elProgressFill.style.width=`${pct}%`;elProgressLabel.textContent=label;}
function hideProgress(){elProgressCont.classList.add("hidden");elProgressFill.style.width="0%";}

// ── INPUT ──
function setInputEnabled(on){
  elUserInput.disabled=!on; elClearBtn.disabled=!on; elSendBtn.disabled=!on;
  elTemplateBar.querySelectorAll(".chip").forEach(c=>c.disabled=!on);
}
function setGeneratingUI(gen){
  isGenerating=gen;
  if(gen){
    elSendBtn.classList.add("is-generating");elSendBtn.title="Stop";
    elSendBtn.querySelector("span").textContent="Stop";
    elSendBtn.querySelector("svg").innerHTML=`<rect x="3" y="3" width="8" height="8" rx="1" fill="currentColor"/>`;
    setStatus("generating","● Generating");
  } else {
    elSendBtn.classList.remove("is-generating");elSendBtn.title="Send message";
    elSendBtn.querySelector("span").textContent="Send";
    elSendBtn.querySelector("svg").innerHTML=`<path d="M7 12V2M2 7l5-5 5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;
    setStatus("ready","✓ Ready");
  }
}

// ── MESSAGES ──
function hideEmptyState(){elEmptyState.classList.add("hidden");elEmptyState.setAttribute("aria-hidden","true");}
function createSystemMessage(text,state=""){
  const div=document.createElement("div");div.className=`message system${state?" "+state:""}`;
  const t=document.createElement("div");t.className="message-text";t.textContent=text;
  div.appendChild(t);elMessagesList.appendChild(div);scrollToBottom();return div;
}
function createMessageEl(role,text,state="done",badges=[]){
  const wrap=document.createElement("div");wrap.className=`message ${role}${state!=="done"?" "+state:""}`;
  const avatar=document.createElement("div");avatar.className="message-avatar";avatar.setAttribute("aria-hidden","true");avatar.textContent=role==="user"?"U":"AI";
  const body=document.createElement("div");body.className="message-body";
  const roleDiv=document.createElement("div");roleDiv.className="message-role";
  roleDiv.textContent=role==="user"?"You":"Vanta";
  badges.forEach(b=>{const s=document.createElement("span");s.className=b.cls;s.textContent=b.text;roleDiv.appendChild(s);});
  const textEl=document.createElement("div");textEl.className="message-text";textEl.textContent=text;
  body.appendChild(roleDiv);body.appendChild(textEl);
  wrap.appendChild(avatar);wrap.appendChild(body);
  elMessagesList.appendChild(wrap);scrollToBottom();
  return{wrap,textEl,body,roleDiv};
}
function createWeatherCard(d){
  const c=document.createElement("div");c.className="weather-card";
  c.innerHTML=`<div class="weather-title">🌡 Weather in ${d.city}</div><span class="wrow-label">Temperature</span><span class="wrow-val">${d.temp}°C</span><span class="wrow-label">Wind</span><span class="wrow-val">${d.wind} km/h</span><span class="wrow-label">Condition</span><span class="wrow-val">${d.condition}</span>`;
  return c;
}
function createHNList(stories){
  const w=document.createElement("div");w.className="hn-list";
  stories.forEach((s,i)=>{
    const item=document.createElement("div");item.className="hn-item";
    item.innerHTML=`<a href="${s.url||'https://news.ycombinator.com/item?id='+s.id}" target="_blank" rel="noopener">${i+1}. ${s.title}</a><div class="hn-meta">▲ ${s.score} · by ${s.by}</div>`;
    w.appendChild(item);
  });
  return w;
}

// ── INIT EMBEDDER ──
async function initEmbedder(){
  setEmbStatus("loading");
  try{
    embedder=await pipeline('feature-extraction','Xenova/all-MiniLM-L6-v2',{device:'wasm'});
    embedderReady=true;setEmbStatus("ready");
    loadKB();renderKBList();
  } catch(e){
    console.error("[Vanta] Embedder error:",e);setEmbStatus("error");
  }
}

// ── INIT MODEL ──
async function initModel(){
  setStatus("init","Initializing…");elHintStatus.textContent="Loading model…";setInputEnabled(false);
  if(!isSecureCtx()){
    const msg="⚠️ Requires HTTPS or localhost (file:// not supported for WebGPU/Cache).";
    setStatus("error","Security Error");createMessageEl("assistant",msg,"error");hideEmptyState();return;
  }
  if(!navigator.gpu){
    const msg="⚠️ WebGPU not found. Use Chrome 113+ and enable chrome://flags/#enable-unsafe-webgpu.";
    setStatus("error","No WebGPU");createMessageEl("assistant",msg,"error");hideEmptyState();return;
  }
  let firstProgress=false;
  const initProgressCallback=(report)=>{
    const pct=report.progress*100,text=report.text||"";
    if(!firstProgress){firstProgress=true;const isDl=text.toLowerCase().includes("fetch")||pct<5;setStatus(isDl?"downloading":"init",isDl?"↓ Downloading":"Loading cache…");}
    if(pct>0)showProgress(pct,text||`Loading… ${pct.toFixed(0)}%`);
    if(report.progress>=1)hideProgress();
  };
  try{
    engine=await webllm.CreateMLCEngine(MODEL_ID,{initProgressCallback,logLevel:"SILENT"});
    if(engine.device)engine.device.lost.then(info=>{isReady=false;setStatus("error","GPU Lost");createMessageEl("assistant","GPU device lost: "+info.message+". Refresh please.","error");});
    isReady=true;setStatus("ready","✓ Ready");elHintStatus.textContent="Ready · Qwen2.5-1.5B";
    setInputEnabled(true);hideProgress();elUserInput.focus();
  } catch(err){
    let msg=err.message||String(err);
    if(msg.includes("Cache")||msg.includes("network"))msg="Network/Cache error — check connection and use HTTPS/localhost.";
    setStatus("error","Load failed");elHintStatus.textContent="Failed";hideProgress();
    createMessageEl("assistant",`Failed to load model: ${msg}\n\n• Chrome 113+ required\n• Serve via HTTPS or localhost\n• ~1GB RAM needed`,"error");
    hideEmptyState();
  }
}

// ── GENERATE ──
async function generate(userText){
  if(!isReady||isGenerating)return;
  const trimmed=userText.trim();if(!trimmed)return;
  hideEmptyState();
  conversationHistory.push({role:"user",content:trimmed});
  createMessageEl("user",trimmed,"done");
  const{wrap:aWrap,textEl:aTextEl,body:aBody,roleDiv:aRoleDiv}=createMessageEl("assistant","","loading");
  elUserInput.value="";autoResize(elUserInput);
  setInputEnabled(false);setGeneratingUI(true);resetTps();abortFlag=false;

  let contextPrompt=trimmed, webEnhanced=false, kbEnhanced=false;
  let weatherData=null, hnStories=null;

  // ── KB RETRIEVAL ──
  if(knowledgeBase.length && embedderReady){
    try{
      const kbCtx=await retrieveContext(trimmed);
      if(kbCtx){
        kbEnhanced=true;
        createSystemMessage("📚 Using KB context","kb");
        contextPrompt=`Context from your knowledge base:\n---\n${kbCtx}\n---\nUsing the above, answer: ${trimmed}`;
      }
    } catch{}
  }

  // ── WEB SEARCH ──
  if(webSearchEnabled&&needsWebSearch(trimmed)){
    const sysMsg=createSystemMessage("🔍 Searching the web…","searching");
    elHintStatus.textContent="↗ Fetching web…";elHintStatus.className="is-searching";
    const lower=trimmed.toLowerCase();
    const isWeather=lower.includes("weather");
    const isHN=lower.includes("hacker news")||lower.includes("tech news")||lower.includes("trending");
    let searchCtx="",allFailed=true;
    try{
      if(isWeather){weatherData=await getWeather(trimmed);if(weatherData){searchCtx=`Weather: ${weatherData.city} — ${weatherData.temp}°C, ${weatherData.wind}km/h, ${weatherData.condition}`;allFailed=false;}}
      else if(isHN){hnStories=await getHackerNews();if(hnStories?.length){searchCtx="Top HN: "+hnStories.map((s,i)=>`${i+1}. ${s.title} (▲${s.score})`).join("; ");allFailed=false;}}
      else{searchCtx=await webSearch(trimmed);if(searchCtx.trim())allFailed=false;}
    } catch{}
    if(allFailed){sysMsg.className="message system warn";sysMsg.querySelector(".message-text").textContent="⚠️ Web unavailable — using local knowledge.";}
    else{
      sysMsg.className="message system success";sysMsg.querySelector(".message-text").textContent="✅ Web context found.";
      webEnhanced=true;
      const prefix=kbEnhanced?contextPrompt:trimmed;
      contextPrompt=`${prefix}\n\nReal-time web data:\n---\n${searchCtx}\n---\nAnswer accurately using the above.`;
    }
    elHintStatus.textContent="🌐 Web enhanced";elHintStatus.className="is-web-done";
  }

  // Add badges to role label
  if(kbEnhanced){const s=document.createElement("span");s.className="kb-badge";s.textContent="📚 KB";aRoleDiv.appendChild(s);}
  if(webEnhanced){const s=document.createElement("span");s.className="web-badge";s.textContent="🌐 Web";aRoleDiv.appendChild(s);}
  if(weatherData)aBody.appendChild(createWeatherCard(weatherData));
  if(hnStories?.length)aBody.appendChild(createHNList(hnStories));

  const messages=[
    {role:"system",content:SYSTEM_PROMPT},
    ...conversationHistory.slice(0,-1),
    {role:"user",content:contextPrompt}
  ];

  let fullText="",firstChunk=true;
  try{
    const stream=await engine.chat.completions.create({messages,stream:true,stream_options:{include_usage:true},max_tokens:MAX_TOKENS,temperature:TEMPERATURE,top_p:TOP_P});
    for await(const chunk of stream){
      if(abortFlag){try{await engine.interruptGenerate();}catch{} break;}
      const delta=chunk.choices?.[0]?.delta?.content;
      if(delta){
        if(firstChunk){aWrap.classList.remove("loading");aWrap.classList.add("streaming");firstChunk=false;}
        fullText+=delta;aTextEl.textContent=fullText;
        const s=recordToken();if(s!==null)updateTps(s);
        scrollToBottom();
      }
      if(chunk.usage){const el=(performance.now()-genStartTime)/1000;if(el>0.05)updateTps((chunk.usage.completion_tokens||tokenCount)/el);}
    }
    aWrap.classList.remove("streaming","loading");
    if(!fullText){aTextEl.textContent="(No response generated)";aWrap.classList.add("error");}
    else conversationHistory.push({role:"assistant",content:fullText});
  } catch(err){
    if(abortFlag){aWrap.classList.remove("streaming","loading");if(!fullText)aTextEl.textContent="(Stopped)";if(fullText)conversationHistory.push({role:"assistant",content:fullText});}
    else{aWrap.classList.remove("streaming","loading");aWrap.classList.add("error");aTextEl.textContent=`Error: ${err.message||err}`;}
  } finally{
    setGeneratingUI(false);setInputEnabled(true);
    elHintStatus.textContent="Ready · Qwen2.5-1.5B";elHintStatus.className="";
    elUserInput.focus();scrollToBottom();
  }
}

// ── HANDLERS ──
function handleSend(){if(!isReady)return;if(isGenerating){abortFlag=true;return;}const t=elUserInput.value;if(!t.trim())return;generate(t);}
function handleClear(){
  if(isGenerating)return;
  conversationHistory=[];elMessagesList.innerHTML="";
  elEmptyState.classList.remove("hidden");elEmptyState.setAttribute("aria-hidden","false");
  resetTps();elUserInput.value="";autoResize(elUserInput);elUserInput.focus();
  elHintStatus.textContent="Ready · Qwen2.5-1.5B";elHintStatus.className="";
}

// ── EVENTS ──
elSendBtn.addEventListener("click",handleSend);
elClearBtn.addEventListener("click",handleClear);
elUserInput.addEventListener("input",()=>autoResize(elUserInput));
elUserInput.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();handleSend();}});
elWebToggle.addEventListener("click",()=>{
  webSearchEnabled=!webSearchEnabled;
  elWebToggle.classList.toggle("is-on",webSearchEnabled);
  elWebToggle.setAttribute("aria-pressed",webSearchEnabled);
  elWebToggle.title=webSearchEnabled?"Web search enabled":"Web search disabled";
});
elKbToggle.addEventListener("click",()=>kbPanelOpen?closeKBPanel():openKBPanel());
elKbClose.addEventListener("click",closeKBPanel);
elKbOverlay.addEventListener("click",closeKBPanel);
elKbAddBtn.addEventListener("click",()=>addToKB(elKbInput.value));
elKbClearAll.addEventListener("click",()=>{knowledgeBase=[];saveKB();renderKBList();setKbStatus("Knowledge base cleared.","ok");});
elTemplateBar.addEventListener("click",e=>{
  const chip=e.target.closest(".chip");
  if(!chip||!isReady||isGenerating)return;
  const p=chip.dataset.prompt;if(!p)return;
  elUserInput.value=p;autoResize(elUserInput);elUserInput.focus();
});

// ── BOOT ──
initEmbedder();
initModel();
