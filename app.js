import * as webllm from "https://esm.run/@mlc-ai/web-llm";
import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2";
env.allowLocalModels = false;

// ── CONFIG ──
const MODEL_ID = "Dolphin3.0-Qwen2.5-1.5B-q4f16_1-MLC";
const SEARCH_TIMEOUT = 8000;
const BASE_SYSTEM = `You are Vanta, an expert AI assistant that reasons carefully.
For any question:
- Think through it step by step internally
- Give structured, clear answers with sufficient detail — never truncate
- For code: explain then write then explain output
- For concepts: define, example, use case
- For comparisons: use bullet points
- Be thorough, precise, and genuinely helpful.
Always show your reasoning inside <think>your reasoning here</think> before your final answer.`;

const PERSONAS = {
  default: BASE_SYSTEM,
  dev: "You are Vanta in developer mode. Be terse, code-first, no fluff. Always show working code. Use technical terms freely. Show <think> reasoning before answering.",
  teacher: "You are Vanta in teacher mode. Explain everything step by step as if teaching a beginner. Use analogies. Be patient and very thorough. Show <think> reasoning before answering.",
  research: "You are Vanta in research mode. Structure all answers with headers, cite your reasoning, use bullet points, be academic and comprehensive. Show <think> reasoning before answering.",
  creative: "You are Vanta in creative mode. Be imaginative, think outside the box, use vivid language and unexpected angles. Show <think> reasoning before answering."
};

// ── SETTINGS STATE ──
let cfg = { temp:0.7, tokens:768, rep:1.15, persona:"default", ttsOn:false };
function loadCfg() {
  try { const s=JSON.parse(localStorage.getItem("vanta-cfg")||"{}"); Object.assign(cfg,s); } catch {}
}
function saveCfg() { try { localStorage.setItem("vanta-cfg",JSON.stringify(cfg)); } catch {} }

// ── RUNTIME STATE ──
let engine=null, embedder=null;
let isReady=false, embedderReady=false, isGenerating=false, abortFlag=false;
let webSearchEnabled=true, ttsEnabled=false;
let conversationHistory=[];
let tpsHistory=[], genStartTime=0, tokenCount=0;
let knowledgeBase=[];
let kbPanelOpen=false, settingsOpen=false;
let recognition=null, isRecording=false;
let lastKbChunksUsed=[];

// ── DOM ──
const $=id=>document.getElementById(id);
const elStatusBadge=$("status-badge"),elStatusText=$("status-text"),elStatusIcon=$("status-icon");
const elEmbBadge=$("embedder-badge"),elEmbText=$("emb-text");
const elMemBadge=$("memory-badge");
const elTpsValue=$("tps-value"),elTpsWrap=$("tps-wrap");
const elProgressCont=$("progress-container"),elProgressFill=$("progress-fill"),elProgressLabel=$("progress-label");
const elTemplateBar=$("template-bar"),elChatArea=$("chat-area"),elMessagesList=$("messages-list"),elEmptyState=$("empty-state");
const elUserInput=$("user-input"),elSendBtn=$("send-btn"),elClearBtn=$("clear-btn"),elHintStatus=$("hint-status");
const elWebToggle=$("web-toggle"),elMicBtn=$("mic-btn"),elSoundwave=elMicBtn.querySelector(".soundwave");
const elTtsToggle=$("tts-toggle"),elSettingsBtn=$("settings-btn"),elSettingsPanel=$("settings-panel"),elSettingsClose=$("settings-close");
const elPersonaSelect=$("persona-select");
const elKbToggle=$("kb-toggle"),elKbCount=$("kb-count"),elKbPanel=$("kb-panel"),elKbOverlay=$("kb-overlay"),elKbClose=$("kb-close");
const elKbInput=$("kb-input"),elKbAddBtn=$("kb-add-btn"),elKbStatus=$("kb-status"),elKbList=$("kb-list"),elKbChunksLabel=$("kb-chunks-label"),elKbClearAll=$("kb-clear-all");
const elPdfInput=$("pdf-input"),elPdfStatus=$("pdf-status");
const elUrlInput=$("url-input"),elUrlAddBtn=$("url-add-btn"),elUrlStatus=$("url-status");
const elSlTemp=$("sl-temp"),elSlTokens=$("sl-tokens"),elSlRep=$("sl-rep");
const elValTemp=$("val-temp"),elValTokens=$("val-tokens"),elValRep=$("val-rep");

// ── UTILS ──
function isSecureCtx(){return window.isSecureContext||location.hostname==="localhost"||location.hostname==="127.0.0.1";}
function fetchWithTimeout(url,ms=SEARCH_TIMEOUT){const c=new AbortController();const t=setTimeout(()=>c.abort(),ms);return fetch(url,{signal:c.signal}).finally(()=>clearTimeout(t));}
function scrollToBottom(){requestAnimationFrame(()=>elChatArea.scrollTo({top:elChatArea.scrollHeight,behavior:"smooth"}));}
function autoResize(el){el.style.height="auto";el.style.height=Math.min(el.scrollHeight,160)+"px";}

// ── MEMORY ──
function getMemory(){try{return localStorage.getItem("vanta-memory")||"";}catch{return "";}}
function setMemory(s){try{localStorage.setItem("vanta-memory",s);}catch{}}
function updateMemoryBadge(){elMemBadge.classList.toggle("hidden",!getMemory());}
async function maybeSummarize(){
  if(!isReady||conversationHistory.length<10)return;
  const oldest=conversationHistory.splice(0,5);
  const text=oldest.map(m=>`${m.role}: ${m.content}`).join("\n");
  try{
    const res=await engine.chat.completions.create({
      messages:[{role:"system",content:"You are a summarizer."},{role:"user",content:`Summarize this conversation in 3 bullet points:\n${text}`}],
      max_tokens:200,temperature:0.3,stream:false
    });
    const summary=res.choices[0].message.content||"";
    const prev=getMemory();
    setMemory((prev?prev+"\n":"")+summary);
    updateMemoryBadge();
  }catch{}
}

// ── RAG ──
function cosineSimilarity(a,b){
  let dot=0,mA=0,mB=0;
  for(let i=0;i<a.length;i++){dot+=a[i]*b[i];mA+=a[i]*a[i];mB+=b[i]*b[i];}
  return dot/(Math.sqrt(mA)*Math.sqrt(mB));
}
function chunkText(text,size=400,overlap=50){
  const c=[];let s=0;
  while(s<text.length){c.push(text.slice(s,s+size));s+=size-overlap;}
  return c.filter(x=>x.trim().length>30);
}
async function embed(text){
  if(!embedderReady||!embedder)return null;
  const out=await embedder(text,{pooling:"mean",normalize:true});
  return Array.from(out.data);
}
function saveKB(){try{localStorage.setItem("vanta_kb",JSON.stringify(knowledgeBase));}catch{}}
function loadKB(){try{const r=localStorage.getItem("vanta_kb");if(r)knowledgeBase=JSON.parse(r);}catch{knowledgeBase=[];}}
async function storeChunks(text){
  const chunks=chunkText(text);let added=0;
  for(const chunk of chunks){try{const emb=await embed(chunk);if(!emb)continue;knowledgeBase.push({id:Date.now()+Math.random(),text:chunk,embedding:emb});added++;}catch{}}
  saveKB();renderKBList();return added;
}
async function retrieveContext(query){
  if(!knowledgeBase.length||!embedderReady)return null;
  const qEmb=await embed(query);if(!qEmb)return null;
  const scored=knowledgeBase.map(e=>({text:e.text,id:e.id,score:cosineSimilarity(qEmb,e.embedding)}));
  const top=scored.filter(x=>x.score>=0.3).sort((a,b)=>b.score-a.score).slice(0,3);
  if(!top.length)return null;
  lastKbChunksUsed=top;
  return top.map(x=>x.text).join("\n\n");
}

// ── PDF ──
async function processPDF(file){
  elPdfStatus.textContent="⏳ Extracting PDF text…";elPdfStatus.className="kb-status";
  try{
    if(typeof pdfjsLib==="undefined")throw new Error("PDF.js not loaded");
    pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    const ab=await file.arrayBuffer();
    const pdf=await pdfjsLib.getDocument({data:ab}).promise;
    let fullText="";
    for(let i=1;i<=pdf.numPages;i++){const pg=await pdf.getPage(i);const tc=await pg.getTextContent();fullText+=tc.items.map(x=>x.str).join(" ")+"\n";}
    if(!fullText.trim())throw new Error("No text found in PDF");
    const n=await storeChunks(fullText);
    elPdfStatus.textContent=`✅ PDF added: ${file.name} (${n} chunks)`;
    elPdfStatus.className="kb-status ok";
  }catch(e){elPdfStatus.textContent=`⚠️ PDF error: ${e.message}`;elPdfStatus.className="kb-status err";}
}

// ── URL SCRAPE ──
async function scrapeURL(url){
  elUrlStatus.textContent="⏳ Scraping…";elUrlStatus.className="kb-status";
  try{
    const r=await fetchWithTimeout(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`);
    const data=await r.json();
    const doc=new DOMParser().parseFromString(data.contents,"text/html");
    const text=[...doc.querySelectorAll("p")].map(p=>p.textContent).filter(t=>t.trim().length>50).join("\n");
    if(!text)throw new Error("No content found");
    const n=await storeChunks(text);
    const domain=new URL(url).hostname;
    elUrlStatus.textContent=`✅ URL scraped: ${domain} (${n} chunks)`;
    elUrlStatus.className="kb-status ok";
    elUrlInput.value="";
  }catch(e){elUrlStatus.textContent=`⚠️ Could not scrape this URL`;elUrlStatus.className="kb-status err";}
}

// ── WEB SEARCH ──
function needsWebSearch(p){
  return["search","find","latest","news","current","today","who is","price","weather","stock","recent","right now","2024","2025","2026","yesterday","trending","live","what happened","hacker news","tech news"].some(t=>p.toLowerCase().includes(t));
}
async function getWeather(q){
  const m=q.match(/weather\s+(?:in\s+)?([a-zA-Z\s]+)/i);if(!m)return null;
  try{
    const gr=await fetchWithTimeout(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(m[1].trim())}&count=1`);
    const geo=await gr.json();if(!geo.results?.length)return null;
    const{latitude,longitude,name,country}=geo.results[0];
    const wr=await fetchWithTimeout(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true&forecast_days=1`);
    const wx=await wr.json();const cw=wx.current_weather;
    const wmo={0:"Clear Sky",1:"Mainly Clear",2:"Partly Cloudy",3:"Overcast",61:"Rain",63:"Heavy Rain",80:"Showers",95:"Thunderstorm"};
    return{city:`${name}, ${country}`,temp:cw.temperature,wind:cw.windspeed,condition:wmo[cw.weathercode]||`Code ${cw.weathercode}`};
  }catch{return null;}
}
async function getHackerNews(){
  const r=await fetchWithTimeout("https://hacker-news.firebaseio.com/v0/topstories.json");
  const ids=await r.json();
  return Promise.all(ids.slice(0,5).map(async id=>{try{return await(await fetchWithTimeout(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)).json();}catch{return null;}})).then(a=>a.filter(Boolean));
}
async function webSearch(q){
  const results=[];
  try{const r=await fetchWithTimeout(`https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`);const d=await r.json();if(d.AbstractText)results.push(`DuckDuckGo: ${d.AbstractText}`);if(d.Answer)results.push(`Answer: ${d.Answer}`);}catch{}
  try{const r=await fetchWithTimeout(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q.split(" ").slice(0,4).join("_"))}`);const w=await r.json();if(w.extract)results.push(`Wikipedia: ${w.extract.slice(0,600)}`);}catch{}
  try{const tgt=`https://en.wikipedia.org/wiki/${encodeURIComponent(q.split(" ").slice(0,4).join("_"))}`;const r=await fetchWithTimeout(`https://api.allorigins.win/get?url=${encodeURIComponent(tgt)}`);const d=await r.json();const doc=new DOMParser().parseFromString(d.contents,"text/html");const p=[...doc.querySelectorAll("p")].map(x=>x.textContent).filter(t=>t.trim().length>80).slice(0,3).join(" ");if(p)results.push(`Web: ${p.slice(0,800)}`);}catch{}
  return results.join("\n\n");
}
// ── STATUS ──
function setStatus(type,text){
  elStatusBadge.className="badge badge-status";elStatusText.textContent=text;
  if(type==="downloading"){elStatusBadge.classList.add("is-downloading");elStatusText.textContent="↓ Downloading";elStatusIcon.textContent="↓";}
  else if(type==="ready"){elStatusBadge.classList.add("is-ready");elStatusText.textContent="✓ Ready";elStatusIcon.textContent="✓";}
  else if(type==="generating"){elStatusBadge.classList.add("is-ready");elStatusText.textContent="● Generating";elStatusIcon.textContent="●";}
  else if(type==="error"){elStatusBadge.classList.add("is-error");elStatusText.textContent=text||"Error";elStatusIcon.textContent="✕";}
  else{elStatusIcon.textContent="…";}
}
function setEmbStatus(type){
  elEmbBadge.className="badge badge-embedder";
  if(type==="loading"){elEmbBadge.classList.add("is-downloading");elEmbText.textContent="RAG ↓";}
  else if(type==="ready"){elEmbBadge.classList.add("is-ready");elEmbText.textContent="RAG ✓";}
  else if(type==="error"){elEmbBadge.classList.add("is-error");elEmbText.textContent="RAG ✕";}
}
function updateTps(v){if(v===null){elTpsValue.textContent="—";elTpsWrap.classList.remove("is-generating");return;}elTpsWrap.classList.add("is-generating");elTpsValue.textContent=v.toFixed(1);}
function resetTps(){tpsHistory=[];genStartTime=0;tokenCount=0;updateTps(null);}
function recordToken(){
  const now=performance.now();if(!genStartTime)genStartTime=now;tokenCount++;
  const el=(now-genStartTime)/1000;if(el<0.1)return null;
  const raw=tokenCount/el,prev=tpsHistory[tpsHistory.length-1]??raw;
  tpsHistory.push(prev*0.7+raw*0.3);if(tpsHistory.length>20)tpsHistory.shift();
  return tpsHistory[tpsHistory.length-1];
}
function showProgress(pct,label){elProgressCont.classList.remove("hidden");elProgressCont.setAttribute("aria-valuenow",Math.round(pct));elProgressFill.style.width=`${pct}%`;elProgressLabel.textContent=label;}
function hideProgress(){elProgressCont.classList.add("hidden");elProgressFill.style.width="0%";}
function setInputEnabled(on){
  elUserInput.disabled=!on;elClearBtn.disabled=!on;elSendBtn.disabled=!on;elMicBtn.disabled=!on;
  elTemplateBar.querySelectorAll(".chip").forEach(c=>c.disabled=!on);
}
function setGeneratingUI(gen){
  isGenerating=gen;
  if(gen){elSendBtn.classList.add("is-generating");elSendBtn.querySelector(".btn-label").textContent="Stop";elSendBtn.querySelector("svg").innerHTML=`<rect x="3" y="3" width="8" height="8" rx="1" fill="currentColor"/>`;setStatus("generating","● Generating");}
  else{elSendBtn.classList.remove("is-generating");elSendBtn.querySelector(".btn-label").textContent="Send";elSendBtn.querySelector("svg").innerHTML=`<path d="M7 12V2M2 7l5-5 5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;setStatus("ready","✓ Ready");}
}

// ── KB UI ──
function setKbStatus(el,msg,cls=""){el.textContent=msg;el.className="kb-status"+(cls?" "+cls:"");}
function renderKBList(){
  elKbList.innerHTML="";const n=knowledgeBase.length;
  elKbCount.textContent=`(${n})`;
  elKbChunksLabel.textContent=n?`${n} chunk${n!==1?"s":""} stored`:"";
  elKbClearAll.style.display=n?"block":"none";
  knowledgeBase.forEach((entry,i)=>{
    const div=document.createElement("div");div.className="kb-chunk";
    const span=document.createElement("span");span.className="kb-chunk-text";span.textContent=`${i+1}. ${entry.text.slice(0,60)}…`;
    const btn=document.createElement("button");btn.className="kb-chunk-del";btn.title="Delete";btn.textContent="✕";
    btn.addEventListener("click",()=>{knowledgeBase=knowledgeBase.filter(e=>e.id!==entry.id);saveKB();renderKBList();setKbStatus(elKbStatus,"Chunk removed.","ok");});
    div.appendChild(span);div.appendChild(btn);elKbList.appendChild(div);
  });
}
function openKBPanel(){kbPanelOpen=true;elKbPanel.classList.add("open");elKbPanel.setAttribute("aria-hidden","false");elKbOverlay.classList.add("visible");elKbToggle.classList.add("is-open");elKbToggle.setAttribute("aria-expanded","true");}
function closeKBPanel(){kbPanelOpen=false;elKbPanel.classList.remove("open");elKbPanel.setAttribute("aria-hidden","true");elKbOverlay.classList.remove("visible");elKbToggle.classList.remove("is-open");elKbToggle.setAttribute("aria-expanded","false");}

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
  stories.forEach((s,i)=>{const item=document.createElement("div");item.className="hn-item";item.innerHTML=`<a href="${s.url||"https://news.ycombinator.com/item?id="+s.id}" target="_blank" rel="noopener">${i+1}. ${s.title}</a><div class="hn-meta">▲ ${s.score} · by ${s.by}</div>`;w.appendChild(item);});
  return w;
}

// ── THINKING BLOCK PARSER ──
// Returns {thinkText, answerText}
function parseThinkTags(raw){
  const s=raw.indexOf("<think>"),e=raw.indexOf("</think>");
  if(s===-1)return{thinkText:"",answerText:raw};
  const thinkText=e>s?raw.slice(s+7,e):"";
  const answerText=(e>s?raw.slice(e+8):raw.slice(s+7)).trim();
  return{thinkText,answerText};
}
function attachThinkBlock(body,thinkText){
  if(!thinkText.trim())return;
  const toggle=document.createElement("button");toggle.className="thinking-toggle";toggle.textContent="💭 Show thinking";
  const block=document.createElement("div");block.className="thinking-block";
  const label=document.createElement("div");label.className="thinking-label";label.textContent="Vanta's Reasoning";
  const content=document.createElement("div");content.textContent=thinkText.trim();
  block.appendChild(label);block.appendChild(content);
  toggle.addEventListener("click",()=>{block.classList.toggle("visible");toggle.textContent=block.classList.contains("visible")?"💭 Hide thinking":"💭 Show thinking";});
  body.appendChild(toggle);body.appendChild(block);
}

// ── SOURCES BLOCK ──
function attachSources(body,chunks){
  if(!chunks||!chunks.length)return;
  const sec=document.createElement("div");sec.className="sources-section";
  const tog=document.createElement("button");tog.className="sources-toggle";tog.textContent=`📚 Sources (${chunks.length})`;
  const list=document.createElement("div");list.className="sources-list";
  chunks.forEach((c,i)=>{const pill=document.createElement("span");pill.className="source-pill";pill.textContent=`${i+1}. ${c.text.slice(0,60)}…`;list.appendChild(pill);});
  tog.addEventListener("click",()=>{list.classList.toggle("visible");tog.textContent=list.classList.contains("visible")?`📚 Hide sources`:`📚 Sources (${chunks.length})`;});
  sec.appendChild(tog);sec.appendChild(list);body.appendChild(sec);
}

// ── CODE BLOCK RENDERER ──
function renderCodeBlocks(body,rawText){
  const codeRe=/```(\w*)\n?([\s\S]*?)```/g;
  let m;const fragments=[];let last=0;
  while((m=codeRe.exec(rawText))!==null){
    if(m.index>last)fragments.push({type:"text",content:rawText.slice(last,m.index)});
    fragments.push({type:"code",lang:m[1]||"text",code:m[2].trim()});
    last=m.index+m[0].length;
  }
  if(!fragments.length)return;
  // rebuild body text without code blocks, then add code wraps
  const textEl=body.querySelector(".message-text");
  if(last>0)textEl.textContent=rawText.slice(0,fragments[0].type==="text"?Math.min(rawText.length,fragments[0].content.length):0)||fragments.filter(f=>f.type==="text").map(f=>f.content).join(" ");
  // remove existing plain text, re-render
  textEl.textContent=fragments.filter(f=>f.type==="text").map(f=>f.content).join("\n").trim();
  fragments.filter(f=>f.type==="code").forEach(f=>{
    const wrap=document.createElement("div");wrap.className="msg-code-wrap";
    const isJS=["js","javascript",""].includes(f.lang.toLowerCase());
    wrap.innerHTML=`<div class="msg-code-header"><span class="msg-code-lang">${f.lang||"code"}</span><div class="msg-code-actions">${isJS?`<button class="run-btn">▶ Run</button>`:""}<button class="copy-btn">📋 Copy</button></div></div><div class="msg-code-body"><code>${f.code.replace(/</g,"&lt;").replace(/>/g,"&gt;")}</code></div>`;
    const outDiv=document.createElement("div");outDiv.className="code-output";outDiv.style.display="none";
    wrap.appendChild(outDiv);
    if(isJS){
      wrap.querySelector(".run-btn").addEventListener("click",()=>{
        outDiv.style.display="block";outDiv.className="code-output";
        const code=`try{${f.code}\n}catch(e){parent.__vantaErr(e.message);}`;
        window.__vantaErr=(msg)=>{outDiv.textContent="Error: "+msg;outDiv.classList.add("has-error");};
        const fr=document.createElement("iframe");fr.style.display="none";
        fr.srcdoc=`<script>${code}<\/script>`;
        fr.onload=()=>{try{const logs=[];fr.contentWindow.console={log:(...a)=>logs.push(a.join(" ")),error:(...a)=>logs.push("ERR: "+a.join(" "))};if(!outDiv.classList.contains("has-error"))outDiv.textContent=logs.join("\n")||"(no output)";}catch{} setTimeout(()=>fr.remove(),2000);};
        document.body.appendChild(fr);
      });
    }
    wrap.querySelector(".copy-btn").addEventListener("click",()=>{navigator.clipboard.writeText(f.code).then(()=>{const btn=wrap.querySelector(".copy-btn");btn.textContent="✓ Copied";setTimeout(()=>btn.textContent="📋 Copy",1500);});});
    body.appendChild(wrap);
  });
}

// ── TTS ──
function speak(text){
  if(!ttsEnabled||!window.speechSynthesis)return;
  window.speechSynthesis.cancel();
  const utt=new SpeechSynthesisUtterance(text.replace(/<think>[\s\S]*?<\/think>/g,"").slice(0,500));
  utt.rate=0.95;utt.pitch=1.0;utt.volume=1;
  window.speechSynthesis.speak(utt);
}
// ── VOICE INPUT ──
function initVoice(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){elMicBtn.disabled=true;elMicBtn.title="Speech recognition not supported";return;}
  recognition=new SR();recognition.lang="en-US";recognition.continuous=false;recognition.interimResults=false;
  recognition.onresult=(e)=>{const t=e.results[0][0].transcript;elUserInput.value=t;autoResize(elUserInput);stopRecording();setTimeout(()=>handleSend(),300);};
  recognition.onerror=()=>stopRecording();
  recognition.onend=()=>stopRecording();
}
function startRecording(){if(!recognition||isRecording)return;isRecording=true;recognition.start();elMicBtn.classList.add("recording");elSoundwave.classList.remove("hidden");elMicBtn.querySelector(".mic-icon").style.display="none";}
function stopRecording(){if(!isRecording)return;isRecording=false;try{recognition.stop();}catch{}elMicBtn.classList.remove("recording");elSoundwave.classList.add("hidden");elMicBtn.querySelector(".mic-icon").style.display="";}

// ── SETTINGS UI ──
function applySettingsUI(){
  elSlTemp.value=cfg.temp;elValTemp.textContent=cfg.temp;
  elSlTokens.value=cfg.tokens;elValTokens.textContent=cfg.tokens;
  elSlRep.value=cfg.rep;elValRep.textContent=cfg.rep;
  elPersonaSelect.value=cfg.persona;
  elTtsToggle.classList.toggle("is-on",cfg.ttsOn);
  ttsEnabled=cfg.ttsOn;
}

// ── INIT EMBEDDER ──
async function initEmbedder(){
  setEmbStatus("loading");
  try{embedder=await pipeline("feature-extraction","Xenova/all-MiniLM-L6-v2",{device:"wasm"});embedderReady=true;setEmbStatus("ready");loadKB();renderKBList();}
  catch(e){console.error("[Vanta] Embedder:",e);setEmbStatus("error");}
}

// ── INIT MODEL ──
async function initModel(){
  setStatus("init","Initializing…");elHintStatus.textContent="Loading model…";setInputEnabled(false);
  if(!isSecureCtx()){createMessageEl("assistant","⚠️ Requires HTTPS or localhost (not file://).","error");hideEmptyState();setStatus("error","Security");return;}
  if(!navigator.gpu){createMessageEl("assistant","⚠️ WebGPU not found. Use Chrome 113+ with WebGPU enabled.","error");hideEmptyState();setStatus("error","No WebGPU");return;}
  let fp=false;
  const initProgressCallback=(r)=>{
    const pct=r.progress*100,txt=r.text||"";
    if(!fp){fp=true;const isDl=txt.toLowerCase().includes("fetch")||pct<5;setStatus(isDl?"downloading":"init",isDl?"↓ Downloading":"Loading cache…");}
    if(pct>0)showProgress(pct,txt||`Loading… ${pct.toFixed(0)}%`);
    if(r.progress>=1)hideProgress();
  };
  try{
    engine=await webllm.CreateMLCEngine(MODEL_ID,{initProgressCallback,logLevel:"SILENT"});
    if(engine.device)engine.device.lost.then(i=>{isReady=false;setStatus("error","GPU Lost");createMessageEl("assistant","GPU lost: "+i.message+". Refresh.","error");});
    isReady=true;setStatus("ready","✓ Ready");elHintStatus.textContent="Ready · Qwen2.5-1.5B";setInputEnabled(true);hideProgress();elUserInput.focus();updateMemoryBadge();
  }catch(err){
    let msg=err.message||String(err);
    if(msg.includes("Cache")||msg.includes("network"))msg="Network/Cache error. Use HTTPS or localhost.";
    setStatus("error","Load failed");elHintStatus.textContent="Failed";hideProgress();
    createMessageEl("assistant",`Failed: ${msg}\n\n• Chrome 113+ required\n• Serve via HTTPS/localhost\n• ~1GB RAM needed`,"error");hideEmptyState();
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
  lastKbChunksUsed=[];

  let contextPrompt=trimmed,webEnhanced=false,kbEnhanced=false;
  let weatherData=null,hnStories=null;

  // Memory
  const mem=getMemory();
  const memPrefix=mem?`Previous conversation summary:\n${mem}\n\n`:"";

  // KB
  if(knowledgeBase.length&&embedderReady){
    try{const kbCtx=await retrieveContext(trimmed);if(kbCtx){kbEnhanced=true;createSystemMessage("📚 Using KB context","kb");contextPrompt=`Context from knowledge base:\n---\n${kbCtx}\n---\nUsing the above, answer: ${trimmed}`;}}
    catch{}
  }

  // Web
  if(webSearchEnabled&&needsWebSearch(trimmed)){
    const sysMsg=createSystemMessage("🔍 Searching the web…","searching");
    elHintStatus.textContent="↗ Fetching…";elHintStatus.className="is-searching";
    const lower=trimmed.toLowerCase();
    const isWeather=lower.includes("weather"),isHN=lower.includes("hacker news")||lower.includes("tech news")||lower.includes("trending");
    let sc="",failed=true;
    try{
      if(isWeather){weatherData=await getWeather(trimmed);if(weatherData){sc=`Weather: ${weatherData.city} — ${weatherData.temp}°C, ${weatherData.wind}km/h, ${weatherData.condition}`;failed=false;}}
      else if(isHN){hnStories=await getHackerNews();if(hnStories?.length){sc="Top HN: "+hnStories.map((s,i)=>`${i+1}. ${s.title} (▲${s.score})`).join("; ");failed=false;}}
      else{sc=await webSearch(trimmed);if(sc.trim())failed=false;}
    }catch{}
    if(failed){sysMsg.className="message system warn";sysMsg.querySelector(".message-text").textContent="⚠️ Web unavailable — local knowledge.";}
    else{sysMsg.className="message system success";sysMsg.querySelector(".message-text").textContent="✅ Web context found.";webEnhanced=true;contextPrompt+=`\n\nReal-time web:\n---\n${sc}\n---\nAnswer using the above.`;}
    elHintStatus.textContent="🌐 Web done";elHintStatus.className="is-web-done";
  }

  if(kbEnhanced){const s=document.createElement("span");s.className="kb-badge";s.textContent="📚 KB";aRoleDiv.appendChild(s);}
  if(webEnhanced){const s=document.createElement("span");s.className="web-badge";s.textContent="🌐 Web";aRoleDiv.appendChild(s);}
  if(weatherData)aBody.appendChild(createWeatherCard(weatherData));
  if(hnStories?.length)aBody.appendChild(createHNList(hnStories));

  const systemPrompt=PERSONAS[cfg.persona]||BASE_SYSTEM;
  const messages=[
    {role:"system",content:systemPrompt},
    ...(memPrefix?[{role:"system",content:memPrefix}]:[]),
    ...conversationHistory.slice(0,-1),
    {role:"user",content:contextPrompt}
  ];

  let fullRaw="",firstChunk=true;
  // streaming buffer for think tag detection
  let streamBuf="";
  try{
    const stream=await engine.chat.completions.create({
      messages,stream:true,stream_options:{include_usage:true},
      max_tokens:cfg.tokens,temperature:cfg.temp,top_p:0.9,
      frequency_penalty:cfg.rep-1  // webllm uses frequency_penalty not repetition_penalty
    });
    for await(const chunk of stream){
      if(abortFlag){try{await engine.interruptGenerate();}catch{} break;}
      const delta=chunk.choices?.[0]?.delta?.content;
      if(delta){
        if(firstChunk){aWrap.classList.remove("loading");aWrap.classList.add("streaming");firstChunk=false;}
        fullRaw+=delta;streamBuf+=delta;
        // Show text, stripping <think> blocks while streaming
        const display=fullRaw.replace(/<think>[\s\S]*?<\/think>/g,"").replace(/<think>[\s\S]*/,"[reasoning…]").trim();
        aTextEl.textContent=display;
        const s=recordToken();if(s!==null)updateTps(s);
        scrollToBottom();
      }
      if(chunk.usage){const el=(performance.now()-genStartTime)/1000;if(el>0.05)updateTps((chunk.usage.completion_tokens||tokenCount)/el);}
    }
    aWrap.classList.remove("streaming","loading");

    if(!fullRaw){aTextEl.textContent="(No response)";aWrap.classList.add("error");}
    else{
      const{thinkText,answerText}=parseThinkTags(fullRaw);
      aTextEl.textContent=answerText||fullRaw;
      if(thinkText)attachThinkBlock(aBody,thinkText);
      if(kbEnhanced&&lastKbChunksUsed.length)attachSources(aBody,lastKbChunksUsed);
      renderCodeBlocks(aBody,answerText||fullRaw);
      conversationHistory.push({role:"assistant",content:answerText||fullRaw});
      speak(answerText||fullRaw);
      await maybeSummarize();
    }
  }catch(err){
    if(abortFlag){aWrap.classList.remove("streaming","loading");if(!fullRaw)aTextEl.textContent="(Stopped)";if(fullRaw)conversationHistory.push({role:"assistant",content:fullRaw});}
    else{aWrap.classList.remove("streaming","loading");aWrap.classList.add("error");aTextEl.textContent=`Error: ${err.message||err}`;}
  }finally{
    setGeneratingUI(false);setInputEnabled(true);
    elHintStatus.textContent="Ready · Qwen2.5-1.5B";elHintStatus.className="";
    elUserInput.focus();scrollToBottom();
  }
}

// ── HANDLERS ──
function handleSend(){if(!isReady)return;if(isGenerating){abortFlag=true;return;}const t=elUserInput.value;if(!t.trim())return;generate(t);}
function handleClear(){
  if(isGenerating)return;conversationHistory=[];elMessagesList.innerHTML="";
  elEmptyState.classList.remove("hidden");elEmptyState.setAttribute("aria-hidden","false");
  resetTps();elUserInput.value="";autoResize(elUserInput);elUserInput.focus();
  elHintStatus.textContent="Ready · Qwen2.5-1.5B";elHintStatus.className="";
}

// ── EVENTS ──
elSendBtn.addEventListener("click",handleSend);
elClearBtn.addEventListener("click",handleClear);
elUserInput.addEventListener("input",()=>autoResize(elUserInput));
elUserInput.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();handleSend();}});
elMicBtn.addEventListener("click",()=>isRecording?stopRecording():startRecording());
elWebToggle.addEventListener("click",()=>{webSearchEnabled=!webSearchEnabled;elWebToggle.classList.toggle("is-on",webSearchEnabled);elWebToggle.setAttribute("aria-pressed",webSearchEnabled);});
elTtsToggle.addEventListener("click",()=>{ttsEnabled=!ttsEnabled;cfg.ttsOn=ttsEnabled;saveCfg();elTtsToggle.classList.toggle("is-on",ttsEnabled);elTtsToggle.title=ttsEnabled?"TTS on — click to disable":"TTS off — click to enable";});
elSettingsBtn.addEventListener("click",()=>{settingsOpen=!settingsOpen;elSettingsPanel.classList.toggle("hidden",!settingsOpen);});
elSettingsClose.addEventListener("click",()=>{settingsOpen=false;elSettingsPanel.classList.add("hidden");});
elSlTemp.addEventListener("input",()=>{cfg.temp=parseFloat(elSlTemp.value);elValTemp.textContent=cfg.temp;saveCfg();});
elSlTokens.addEventListener("input",()=>{cfg.tokens=parseInt(elSlTokens.value);elValTokens.textContent=cfg.tokens;saveCfg();});
elSlRep.addEventListener("input",()=>{cfg.rep=parseFloat(elSlRep.value);elValRep.textContent=cfg.rep;saveCfg();});
elPersonaSelect.addEventListener("change",()=>{const mode=elPersonaSelect.value;cfg.persona=mode;saveCfg();createSystemMessage(`🎭 Switched to ${mode} mode`);});
elKbToggle.addEventListener("click",()=>kbPanelOpen?closeKBPanel():openKBPanel());
elKbClose.addEventListener("click",closeKBPanel);
elKbOverlay.addEventListener("click",closeKBPanel);
elKbAddBtn.addEventListener("click",async()=>{
  if(!embedderReady){setKbStatus(elKbStatus,"RAG not ready.","err");return;}
  const text=elKbInput.value.trim();if(!text){setKbStatus(elKbStatus,"Paste text first.","err");return;}
  setKbStatus(elKbStatus,"Chunking…","");elKbAddBtn.disabled=true;
  const n=await storeChunks(text);elKbAddBtn.disabled=false;
  setKbStatus(elKbStatus,`✓ Added ${n} chunk${n!==1?"s":""}.`,"ok");elKbInput.value="";
});
elKbClearAll.addEventListener("click",()=>{knowledgeBase=[];saveKB();renderKBList();setKbStatus(elKbStatus,"Cleared.","ok");});
elPdfInput.addEventListener("change",async(e)=>{const f=e.target.files[0];if(f){await processPDF(f);e.target.value="";}});
document.querySelector(".kb-file-label").addEventListener("click",()=>elPdfInput.click());
elUrlAddBtn.addEventListener("click",()=>{const u=elUrlInput.value.trim();if(u)scrapeURL(u);});
elUrlInput.addEventListener("keydown",e=>{if(e.key==="Enter")elUrlAddBtn.click();});
elTemplateBar.addEventListener("click",e=>{
  const chip=e.target.closest(".chip");if(!chip||!isReady||isGenerating)return;
  const p=chip.dataset.prompt;if(!p)return;elUserInput.value=p;autoResize(elUserInput);elUserInput.focus();
});
document.addEventListener("click",e=>{if(settingsOpen&&!elSettingsPanel.contains(e.target)&&!elSettingsBtn.contains(e.target)){settingsOpen=false;elSettingsPanel.classList.add("hidden");}});

// ── BOOT ──
loadCfg();applySettingsUI();
initVoice();
initEmbedder();
initModel();
