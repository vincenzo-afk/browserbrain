# Live deployment check — 2026-08-13

## Verified production response

`https://browserbrain.vercel.app/` returns **HTTP 200** with `Content-Type: text/html` and renders the BrowserBrain React workspace. The current production deployment is linked to commit `db6476526bbafb347e606f1608c6b46c85b388ee` and publishes the Vite output from `dist/public` through `vercel.json`.

## Browser observations

The fresh production page renders the logo, workspace, context desk, composer, and loading panel. A fresh browser-console inspection produced no application exception output. The sandbox browser reports `No available adapters` while the WebGPU path probes for hardware; this is an environment capability warning, not a deployment crash. The CPU/WASM fallback remains visible while it downloads and initializes.

The pasted `chrome-extension://` failures and affiliate-widget messages are injected by browser extensions and are outside BrowserBrain. The `unload is not allowed` permissions-policy warning is emitted by the hosting/runtime wrapper, not by the application source.

The exact predeploy URL from the pasted log could not be fetched from the current sandbox (`ERR_HTTP_RESPONSE_CODE_FAILURE`), so the historical `WA is not a function` stack cannot be replayed at that obsolete deployment URL. The current production build does not reproduce that exception during initial page load.
