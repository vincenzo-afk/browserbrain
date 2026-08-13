# Live generation smoke test — 2026-08-13

On `https://browserbrain.vercel.app/`, the browser UI reached **Local model ready — FLAN-T5 small · CPU** after the WASM fallback initialized. The page rendered without the pasted `WA is not a function` exception during startup.

Submitting the prompt `In one sentence, what is 2 + 2?` transitioned the header to **Generating locally** and rendered the assistant typing state. During the in-progress request, the composer displayed `Model unavailable — use Retry model`, so the final generated response still requires a follow-up inspection. This may be a transient composer guard or a worker request failure rather than the historical startup exception.
