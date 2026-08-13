// BrowserBrain style reminder: this client-only service layer keeps the product calm and evidence-led.
// Web context is additive and clearly labeled; failures fall back to the local model instead of blocking chat.

export type WebSource = {
  title: string;
  url: string;
  snippet: string;
  kind: "search" | "scrape" | "crawl" | "reference";
};

export type WebContext = {
  query: string;
  summary: string;
  sources: WebSource[];
  fetchedAt: string;
};

const SEARCH_TIMEOUT = 9000;
const MAX_TEXT = 3600;

function timeoutFetch(url: string, timeout = SEARCH_TIMEOUT) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);
  return fetch(url, { signal: controller.signal }).finally(() => window.clearTimeout(timer));
}

function cleanText(value: string) { return value.replace(/\s+/g, " ").replace(/\u00a0/g, " ").trim(); }
function trimText(value: string, max = MAX_TEXT) { const text = cleanText(value); return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text; }
function safeUrl(url: string) { try { const parsed = new URL(url); return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null; } catch { return null; } }

function extractReadableText(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,noscript,svg,nav,footer,header,form").forEach((node) => node.remove());
  const title = cleanText(doc.querySelector("title")?.textContent || "Untitled page");
  const paragraphs = Array.from(doc.querySelectorAll("main p, article p, p, li")).map((node) => cleanText(node.textContent || "")).filter((text) => text.length > 45).slice(0, 28);
  return { title, text: trimText(paragraphs.join(" ")) };
}

export function shouldUseWeb(query: string) {
  return /(latest|today|current|now|recent|news|weather|price|stock|release|launched|announced|who is|what is|when did|where is|search|find|look up|source|cite|compare)/.test(query.toLowerCase());
}

async function duckDuckGo(query: string): Promise<WebSource[]> {
  const response = await timeoutFetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`);
  const data = await response.json();
  const sources: WebSource[] = [];
  if (data.AbstractText) sources.push({ title: data.Heading || "DuckDuckGo instant answer", url: data.AbstractURL || `https://duckduckgo.com/?q=${encodeURIComponent(query)}`, snippet: trimText(data.AbstractText), kind: "reference" });
  if (Array.isArray(data.RelatedTopics)) data.RelatedTopics.filter((topic: any) => topic?.Text).slice(0, 4).forEach((topic: any) => sources.push({ title: cleanText(topic.Text).slice(0, 72), url: topic.FirstURL || `https://duckduckgo.com/?q=${encodeURIComponent(query)}`, snippet: trimText(topic.Text, 420), kind: "search" }));
  return sources;
}

async function wikipedia(query: string): Promise<WebSource[]> {
  const title = query.replace(/[^a-z0-9 ]/gi, " ").split(/\s+/).filter(Boolean).slice(0, 7).join("_");
  if (!title) return [];
  const response = await timeoutFetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
  if (!response.ok) return [];
  const data = await response.json();
  if (!data.extract || data.type === "disambiguation") return [];
  return [{ title: data.title || "Wikipedia", url: data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${title}`, snippet: trimText(data.extract), kind: "reference" }];
}

export async function searchWeb(query: string, crawl = false): Promise<WebContext> {
  const settled = await Promise.allSettled([duckDuckGo(query), wikipedia(query)]);
  const sources = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const unique = Array.from(new Map(sources.map((source) => [source.url, source])).values()).slice(0, 7);
  let summary = unique.map((source) => `${source.title}: ${source.snippet}`).join("\n");
  if (crawl) { const first = unique.find((source) => source.url.startsWith("http")); if (first) { const crawled = await crawlUrl(first.url, 3); unique.push(...crawled.sources); summary = `${summary}\n${crawled.summary}`; } }
  return { query, summary: trimText(summary, 9000), sources: unique.slice(0, 10), fetchedAt: new Date().toISOString() };
}

export async function scrapeUrl(rawUrl: string): Promise<WebContext> {
  const url = safeUrl(rawUrl);
  if (!url) throw new Error("Enter a valid http or https URL.");
  const response = await timeoutFetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`, 12000);
  const data = await response.json();
  if (!data.contents) throw new Error("The page could not be read through the free proxy.");
  const page = extractReadableText(data.contents);
  if (!page.text) throw new Error("No readable text was found on that page.");
  const source: WebSource = { title: page.title, url, snippet: page.text, kind: "scrape" };
  return { query: `Read ${url}`, summary: page.text, sources: [source], fetchedAt: new Date().toISOString() };
}

export async function crawlUrl(rawUrl: string, limit = 4): Promise<WebContext> {
  const url = safeUrl(rawUrl);
  if (!url) throw new Error("Enter a valid http or https URL.");
  const root = await scrapeUrl(url);
  const rootHost = new URL(url).hostname;
  const pageHtml = await (await timeoutFetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`, 12000)).json();
  const doc = new DOMParser().parseFromString(pageHtml.contents || "", "text/html");
  const links = Array.from(doc.querySelectorAll("a[href]")).map((node) => (node as HTMLAnchorElement).href).map((href) => safeUrl(href)).filter((href): href is string => Boolean(href)).filter((href) => new URL(href).hostname === rootHost).filter((href) => !href.includes("#")).filter((href, index, all) => all.indexOf(href) === index).slice(0, limit);
  const pages = await Promise.allSettled(links.map((link) => scrapeUrl(link)));
  const children = pages.flatMap((result) => result.status === "fulfilled" ? result.value.sources : []);
  const sources = [root.sources[0], ...children].slice(0, limit + 1);
  return { query: `Crawl ${url}`, summary: sources.map((source) => `${source.title}: ${source.snippet}`).join("\n\n"), sources, fetchedAt: new Date().toISOString() };
}

export function scoreLocalNote(note: string, query: string) { const terms = query.toLowerCase().split(/\W+/).filter((term) => term.length > 2); if (!terms.length) return 0; const haystack = note.toLowerCase(); return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0) / terms.length; }
export function selectRelevantNotes(notes: string[], query: string) { return notes.map((note) => ({ note, score: scoreLocalNote(note, query) })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 4).map((item) => item.note); }
