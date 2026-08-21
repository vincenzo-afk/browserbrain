# BrowserBrain

> **A browser-first research workspace with private, on-device intelligence.**

```text
          ◇
        ╱   ╲
       │  B  │   BrowserBrain
        ╲   ╱    Ask locally. Bring context.
          ◇
```

[![License](https://img.shields.io/github/license/vincenzo-afk/browserbrain)](./LICENSE)
[![Last commit](https://img.shields.io/github/last-commit/vincenzo-afk/browserbrain)](https://github.com/vincenzo-afk/browserbrain/commits/main)
[![CI](https://github.com/vincenzo-afk/browserbrain/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/vincenzo-afk/browserbrain/actions/workflows/ci.yml)
[![Version](https://img.shields.io/github/package-json/v/vincenzo-afk/browserbrain)](./package.json)
[![Repository size](https://img.shields.io/github/repo-size/vincenzo-afk/browserbrain)](https://github.com/vincenzo-afk/browserbrain)
[![Platform](https://img.shields.io/badge/platform-modern%20web%20browsers-3f2f1c)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API)

**Quick links:** [Live demo](https://browserbrain.vercel.app/) · [Repository](https://github.com/vincenzo-afk/browserbrain) · [Report a bug](https://github.com/vincenzo-afk/browserbrain/issues/new/choose) · [Request a feature](https://github.com/vincenzo-afk/browserbrain/issues/new/choose) · [Contributing](./CONTRIBUTING.md) · [Security](./SECURITY.md)

> **Live demo:** [browserbrain.vercel.app](https://browserbrain.vercel.app/) is the current production domain. Vercel is configured explicitly to publish the active Vite output from `dist/public` rather than the bundled Node server entrypoint.

## Table of contents

- [About the project](#about-the-project)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Usage](#usage)
- [Web research tools](#web-research-tools)
- [Local model runtime](#local-model-runtime)
- [Privacy and data boundaries](#privacy-and-data-boundaries)
- [Project structure](#project-structure)
- [Features and roadmap](#features-and-roadmap)
- [Testing](#testing)
- [Deployment](#deployment)
- [Contributing](#contributing)
- [Code of conduct](#code-of-conduct)
- [Security](#security)
- [License](#license)
- [Acknowledgements](#acknowledgements)
- [References](#references)

## About the project

BrowserBrain is a React and TypeScript web application designed around a simple boundary: **the language model runs in the browser, while web context is fetched only when the user enables it or asks for information that is likely to be time-sensitive**. The interface combines a calm conversation surface with a context desk for search, URL reading, same-site crawling, and private local notes.

The project is intended for research, drafting, explanation, comparison, and lightweight technical investigation. It does not require a hosted inference API or an application database. The repository link, SEO metadata, browser cache, loading progress, retry path, and explicit research-demo state are all part of the product rather than afterthoughts.

### Current capabilities

| Capability | Behavior |
| --- | --- |
| Browser inference | Tries WebGPU first and falls back to Transformers.js running in a Web Worker with WebAssembly. |
| Research context | Searches DuckDuckGo Instant Answers and Wikipedia without an API key, then attaches source snippets to the conversation. |
| URL reading | Reads a public HTTP(S) page through the free AllOrigins relay and extracts readable paragraphs in the browser. |
| Same-site crawl | Reads a root page, follows a small number of same-host links, and keeps the result bounded. |
| Private notes | Stores short notes in `localStorage` and retrieves only notes whose words overlap the current prompt. |
| Chat UX | Provides streaming-style rendering, retry, copy, stop, loading progress, status messaging, responsive drawers, and a repository button. |
| Discoverability | Includes page metadata, Open Graph tags, structured data, a manifest, robots policy, and a sitemap. |

## Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│ React client: client/src/pages/Home.tsx                     │
│                                                              │
│  Composer ──┬── optional web context ──┬── local notes       │
│             │                         │                    │
│             ▼                         ▼                    │
│      browserbrain.ts             localStorage               │
│             │                                              │
│             ▼                                              │
│  DuckDuckGo / Wikipedia / AllOrigins                       │
│                                                              │
│  WebGPU: WebLLM ────────────────┐                            │
│                                 ├── browser-only generation  │
│  Web Worker: Transformers.js ───┘                            │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
                  Static files served by Express
```

The Vite project root is `client/`. `server/index.ts` serves the built `dist/public` directory and uses terminal middleware for client-side routing. There is no application API, database schema, authentication layer, or server-side model inference in the active React application.

## Tech stack

| Area | Technology |
| --- | --- |
| UI | React 19, TypeScript, Tailwind CSS 4, Radix UI primitives, Lucide icons |
| Build | Vite 7, `@vitejs/plugin-react`, esbuild, pnpm |
| Browser inference | `@mlc-ai/web-llm` for WebGPU and `@huggingface/transformers` for WebAssembly |
| Web context | DuckDuckGo Instant Answer API, Wikipedia REST summary API, AllOrigins public CORS relay |
| Assistant rendering | Dependency-free local markdown-lite renderer with safe code-block output |
| Server | Express 4 with a static-file and SPA fallback wrapper |
| State and persistence | React state plus browser `localStorage` for sessions and notes |
| Hosting | Any static-compatible Node host or the project management platform's built-in hosting |
| License | MIT; see [`LICENSE`](./LICENSE) |

## Getting started

### Prerequisites

Install the following locally:

| Requirement | Recommended version |
| --- | --- |
| Node.js | 20 or newer |
| pnpm | 10.x, matching the `packageManager` field |
| Browser | A current Chrome, Edge, Firefox, or Safari release with WebAssembly; WebGPU is optional because a CPU/WASM path exists |

No model API key, search API key, database, or `.env` file is required for the core application.

### Installation

```bash
git clone https://github.com/vincenzo-afk/browserbrain.git
cd browserbrain
pnpm install
pnpm run dev
```

Open the local URL printed by Vite. The first local-model startup may download model files from Hugging Face and cache them in the browser. The download and initialization time depend on the device, browser storage, network, and available acceleration.

### Available scripts

| Command | Purpose |
| --- | --- |
| `pnpm run dev` | Start the Vite development server on the configured host and port. |
| `pnpm run check` | Run TypeScript's no-emit type check. |
| `pnpm run build` | Build the browser bundle and bundle the Express static server into `dist/index.js`. |
| `pnpm run start` | Serve the production build with `NODE_ENV=production`. |
| `pnpm run preview` | Preview the Vite build locally. |
| `pnpm run format` | Format project files with Prettier. |

### Optional configuration

The core app works without environment variables. The managed development environment may inject the following values for optional analytics and asset proxying:

| Variable | Use | Required for local inference? |
| --- | --- | --- |
| `VITE_ANALYTICS_ENDPOINT` | Optional analytics script endpoint injected by the hosting environment. | No |
| `VITE_ANALYTICS_WEBSITE_ID` | Optional analytics site identifier. | No |
| `BUILT_IN_FORGE_API_URL` | Development asset-storage proxy base URL. | No |
| `BUILT_IN_FORGE_API_KEY` | Development asset-storage proxy credential. | No |

Do not commit secrets. `.env`, `.env.local`, and other environment-specific files are ignored by Git.

## Usage

After the page loads, use the composer to ask a question. Enable **Web** when the answer needs current or source-backed information. Enable **Crawl** only when following a few same-site links is useful. The context desk can also be opened directly to search, read a URL, crawl a site, or save a note.

The application automatically considers web context for prompts containing signals such as “latest”, “today”, “current”, “news”, “weather”, “price”, “source”, “cite”, “compare”, or “search”. This heuristic is a convenience, not a guarantee; users can always use the context desk explicitly.

### Prompt flow

1. The user submits a prompt from the browser.
2. BrowserBrain optionally fetches public context when Web is enabled or the prompt looks time-sensitive.
3. The prompt, selected notes, and clearly labeled source snippets are assembled in the client.
4. The local WebGPU engine or CPU/WASM worker generates the response.
5. The interface renders the response and retains the conversation in browser storage.

If no local model can initialize, the app stops retrying indefinitely and shows **Research demo mode**. Search, URL reading, crawling, and notes remain available, while the app clearly avoids pretending that a server-side model is answering.

## Web research tools

The web tools are deliberately small and free. Search uses DuckDuckGo Instant Answers and Wikipedia summaries. URL reading and crawling use the public AllOrigins CORS relay because browsers cannot directly read many third-party pages due to cross-origin policy.

| Tool | Input | Boundary and limitation |
| --- | --- | --- |
| Search | Natural-language query | Returns up to a small bounded set of DuckDuckGo and Wikipedia sources; results can be incomplete. |
| Read URL | Public HTTP(S) URL | Sends the URL to AllOrigins; pages that block relays or expose little readable text may fail. |
| Crawl site | Public root URL | Follows only same-host links and a bounded number of pages; it is not a general crawler. |
| Notes | User-provided text | Remains in browser `localStorage`; relevant notes are selected by simple word overlap. |

External services may apply their own rate limits, availability rules, or content policies. Web context is evidence supplied to the local prompt, not a guarantee of correctness.

## Local model runtime

The runtime is intentionally browser-first:

| Stage | Runtime | Current model path |
| --- | --- | --- |
| Primary | WebGPU through WebLLM | Qwen2.5 1.5B instruct, with the smaller Qwen2.5 0.5B rescue model |
| CPU fallback | Transformers.js v4 in a dedicated Web Worker using WebAssembly | `Xenova/flan-t5-small` with plain `int8`, then `fp32` rescue |
| Failure recovery | Explicit UI state | Retry controls and research-demo mode after bounded attempts |

Model files are fetched at runtime and cached by the browser. The exact first-load time and storage footprint vary by model artifact and device. A user should expect the first run to be slower than subsequent runs.

The CPU worker warms the decoder with a short prompt before declaring itself ready. Generation requests are serialized through the worker adapter, and the UI can interrupt an in-progress generation. The browser preview used during development may be slower than an ordinary desktop browser because it can lack a WebGPU adapter and have constrained network or memory resources.

For short deterministic arithmetic requests, the worker first checks a narrow, safe expression parser and returns the result locally when the input matches a simple two-number operation. Other prompts continue through FLAN-T5. Text-to-text generation is bounded to 128 new tokens and uses deterministic decoding to reduce slow runaway responses from small CPU models.

## Privacy and data boundaries

BrowserBrain does not send prompts to a BrowserBrain inference server. Local-model prompts and local notes stay in the browser unless the user enables an external web operation or the deployment explicitly injects optional analytics.

The following boundaries matter:

| Data | Where it goes |
| --- | --- |
| Local model prompt | The local WebGPU engine or local Web Worker. |
| Notes and saved sessions | The browser's `localStorage`. |
| Search query | DuckDuckGo and Wikipedia when Web context is requested. |
| URL read or crawl | AllOrigins receives the requested public URL so it can retrieve the page. |
| Optional analytics | The configured analytics endpoint, only when the deployment injects the analytics variables and script. |

Do not use the public web tools for sensitive URLs or confidential material. A private note can remain local, but it may be included in the local prompt when its words match the user's question.

## Project structure

```text
browserbrain/
├── client/
│   ├── index.html                 SEO metadata, Open Graph, manifest, structured data
│   ├── public/
│   │   ├── manifest.webmanifest   Install metadata
│   │   ├── robots.txt              Crawler policy
│   │   └── sitemap.xml             Canonical route sitemap
│   └── src/
│       ├── pages/Home.tsx          Main workspace, model orchestration, and UI
│       ├── workers/model.worker.ts CPU/WASM model loader and generation adapter
│       ├── lib/browserbrain.ts     Search, scrape, crawl, and local-note helpers
│       ├── index.css                Design system and global styles
│       ├── repair.css               Loading, message, and model-state refinements
│       ├── App.tsx                  Error boundary and top-level composition
│       └── components/ui/           Reusable Radix/shadcn-style primitives
├── server/index.ts                 Production static server and SPA fallback
├── shared/                          Template compatibility types
├── patches/                         Package patches used by pnpm
├── package.json                     Scripts and dependencies
├── vite.config.ts                  Vite root, aliases, debug collector, and storage proxy
├── tsconfig*.json                   TypeScript configuration
├── DEBUG_FINDINGS.md                Runtime investigation history
├── MODEL_RUNTIME_NOTES.md           Model-loading notes and compatibility findings
└── LICENSE                          MIT license text
```

The root-level `app.js`, `style.css`, and `index.html` are retained legacy Vanta prototype files from the original project. They are not the active Vite entrypoint; the deployed application is built from `client/`.

## Features and roadmap

### Implemented

- Browser-only local model path with WebGPU and WebAssembly fallback.
- Loading animation, progress messages, decoder warmup, retry, interruption, and bounded demo mode.
- Claude-inspired calm editorial chat layout with responsive mobile drawers.
- Free search, URL reading, same-site crawl, source cards, and private notes.
- Repository link, placeholder-safe assistant mark, PWA manifest, and SEO metadata.
- Safe dependency-free assistant message rendering and a deterministic arithmetic fast path for simple calculations.
- TypeScript checks and production build scripts.

### Planned

- Add an automated CI workflow for type-checking and production builds.
- Add a small browser smoke-test suite covering model status, context tools, and mobile navigation.
- Allow the user to supply the final logo asset through one documented asset constant.
- Evaluate a smaller or more broadly compatible model artifact as browser runtimes evolve.

### Known limitations

- WebGPU support and performance vary considerably between browsers and devices.
- CPU/WASM model downloads can be slow on constrained environments.
- Public CORS relays and free search endpoints are best-effort and may fail or rate-limit.
- Local notes use `localStorage`; they are not encrypted and should not contain secrets.
- There is no server-side persistence, multi-user account system, or hosted inference API.

## Testing

Run the deterministic checks before opening a pull request:

```bash
pnpm run check
pnpm run build
```

For a manual browser check, start the dev server and verify the following sequence: the page renders without a console error, the model status transitions from loading to ready or demo mode, Web search returns source cards, URL reading shows a readable excerpt or a clear failure message, notes persist after refresh, the repository link opens GitHub, and the mobile sidebar/context drawer remains reachable at a narrow viewport.

There is currently no committed unit-test or coverage suite, so the repository does not claim a coverage percentage. The [CI workflow](./.github/workflows/ci.yml) runs `pnpm run check` and `pnpm run build` for pushes and pull requests targeting the default branch.

## Deployment

### Built-in project hosting

The project can be published through the hosting controls associated with the project. Create a checkpoint after validating changes, then publish from the project UI. Configure the final public URL before updating the canonical metadata and sitemap host.

### Generic Node host

```bash
pnpm install --frozen-lockfile
pnpm run build
NODE_ENV=production PORT=3000 pnpm run start
```

The production command serves `dist/public` and falls back to `index.html` for client-side routes. The app itself does not require a database or server inference process. If a host only supports static files, serve `dist/public` and configure its rewrite rule so unknown routes resolve to `index.html`.

### Vercel

The repository includes [`vercel.json`](./vercel.json), which runs `pnpm run build` and sets `dist/public` as the deployment output. This is important because the build also emits `dist/index.js` for the generic Node host; Vercel must publish the frontend directory rather than expose that server bundle at the root URL. Git pushes to `main` trigger the linked production deployment when the Vercel project integration is active.

### Deployment checklist

| Check | Action |
| --- | --- |
| Canonical URL | Keep `browserbrain.vercel.app` aligned across the live domain, robots policy, sitemap, and runtime metadata. |
| HTTPS | Serve the app over HTTPS so browser storage, workers, and WebGPU behave consistently. |
| Headers | Keep `Content-Type` correct for JavaScript modules, the manifest, robots, and sitemap. |
| Model cache | Tell users that the first local-model load downloads and caches model artifacts. |
| External tools | Expect public search and CORS relay failures; keep the UI's best-effort messaging. |

## Contributing

Read the complete [contribution guide](./CONTRIBUTING.md) before opening a pull request. Start from a feature branch named with a short scope, for example `fix/model-loading` or `docs/readme`. Keep changes narrow, preserve the browser-only inference requirement, and update the relevant notes when model artifacts or browser compatibility change.

Before submitting a pull request:

```bash
pnpm install
pnpm run check
pnpm run build
```

Use concise conventional commit messages such as `fix: handle wasm model timeout` or `docs: clarify privacy boundaries`. Pull requests should explain the user-facing change, list validation performed, and call out any browser-specific behavior. Do not commit model binaries, credentials, browser logs, build output, or private notes.

## Code of conduct

BrowserBrain follows the [Contributor Covenant Code of Conduct](./CODE_OF_CONDUCT.md). Report unacceptable behavior through the repository owner's [GitHub profile](https://github.com/vincenzo-afk), rather than in a public issue.

## Security

Please do not report sensitive vulnerabilities in a public issue. Follow the private reporting guidance in [SECURITY.md](./SECURITY.md).

Security practices currently include client-side URL scheme validation, bounded fetch timeouts, same-host filtering for crawl links, no committed environment files, and explicit separation between local notes and optional web context. The public relay and external search services are third-party dependencies; treat all retrieved web content as untrusted text.

## License

BrowserBrain is released under the [MIT License](./LICENSE). The repository license currently carries the copyright notice for **BHARANI KUMAR S**. Preserve that notice when redistributing substantial portions of the software.

## Acknowledgements

BrowserBrain builds on React, Vite, Tailwind CSS, Radix UI, Lucide, WebLLM, Transformers.js, Hugging Face model hosting, DuckDuckGo Instant Answers, Wikipedia, and the AllOrigins public CORS relay. See the references below for the primary project pages.

## References

1. [WebLLM documentation and repository](https://github.com/mlc-ai/web-llm)
2. [Transformers.js documentation and repository](https://github.com/huggingface/transformers.js)
3. [Hugging Face Transformers.js documentation](https://huggingface.co/docs/transformers.js)
4. [DuckDuckGo Instant Answer API](https://duckduckgo.com/api)
5. [Wikipedia REST API](https://en.wikipedia.org/api/rest_v1/)
6. [AllOrigins public CORS proxy](https://github.com/gnuns/allorigins)
7. [Vite documentation](https://vite.dev/guide/)
8. [React documentation](https://react.dev/)
9. [Web Workers API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API)

<p align="center"><a href="#browserbrain">Back to top</a></p>

Built by **vincenzo-afk** for private, browser-first research workflows.
