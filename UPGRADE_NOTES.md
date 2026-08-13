# BrowserBrain upgrade notes

## What changed

BrowserBrain now presents a Claude-like three-column workspace built for a local research loop: saved conversations on the left, a readable chat column in the center, and an evidence/context desk on the right. It includes streaming assistant output, stop and retry controls, copy actions, private local notes, an explicit local-model status pill, responsive drawers for mobile, and a direct link to the upstream GitHub repository.

## Local model strategy

The runtime attempts `Qwen2.5-1.5B-Instruct-q4f16_1-MLC` through WebLLM when WebGPU is available. If the device cannot load that model, it retries with `Qwen2.5-0.5B-Instruct-q4f16_1-MLC`. For browsers without WebGPU, it uses a dedicated browser-only Transformers.js v4 Web Worker with `Xenova/flan-t5-small` in plain `int8`, followed by an `fp32` rescue path. First-load time and memory use still depend on the device and browser cache.

The model files are downloaded by the browser and cached by the runtime. The app does not send prompts to a BrowserBrain server. Optional web tools are separate: the user chooses when to fetch public context, and the UI labels that context as sourced evidence rather than pretending it came from the local model.

## Answer-quality prompt iteration

The system prompt in `client/src/pages/Home.tsx` was tightened around nine observable behaviors: answer the actual question first, match the user's language, distinguish evidence from reasoning, state uncertainty, structure comparisons and plans, provide runnable code, make reasonable assumptions, avoid filler or fabricated sources, and silently check scope and support before responding.

This is a quality improvement layer, not a guarantee of a fixed percentage uplift. A small local model can still be limited by its weights, tokenizer, context window, device speed, and quantization. The prompt is written so the same answer-quality contract applies whether Qwen WebGPU or the WASM fallback is active.

## Free web tools

The context desk includes:

- DuckDuckGo Instant Answer API and Wikipedia REST summaries for lightweight search.
- A free AllOrigins relay for readable URL extraction when the target site permits it.
- Same-host crawl mode that follows a small number of links and limits page text to keep context manageable.
- Local note retrieval that scores saved notes against the current prompt before including them in the model context.

Public free relays can be rate-limited or blocked by target sites. The UI communicates that these tools are optional and best-effort rather than hiding the limitation. If all local model candidates exceed the bounded initialization window, the UI enters Research demo mode instead of retrying forever; web tools and notes remain available, but no fake model response is produced.

## Logo handoff

The generated symbol is a placeholder asset at the `BRAND_MARK` constant in `client/src/pages/Home.tsx`, and the same asset is used for the favicon and app manifest. When the final logo is provided, replace the asset URL in that one constant and update the favicon/manifest references in `client/index.html` and `client/public/manifest.webmanifest`.

## SEO handoff

The app includes a descriptive title, meta description, keyword coverage, Open Graph and Twitter card metadata, canonical metadata, JSON-LD `SoftwareApplication` structured data, a robots file, a sitemap, and a web manifest. The current canonical and sitemap host use `browserbrain.vercel.app` as a temporary site-origin placeholder; replace that host with the final published domain before submitting the sitemap to Google Search Console.

## Verification

`pnpm check` and `pnpm build` pass. The production build reports only the existing large-chunk warning from the template's Markdown/code rendering bundle. The development preview was visually checked at desktop width after the design refinement. The model download itself is intentionally lazy and can take longer than the first paint, especially on a clean browser cache. The production server now imports Express explicitly and serves the SPA fallback through terminal middleware.
