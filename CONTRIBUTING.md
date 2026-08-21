# Contributing to BrowserBrain

Thank you for improving **BrowserBrain**, a browser-first research workspace that keeps model inference in the user's browser. Contributions should preserve that boundary: do not introduce hosted inference, credentials, server-side prompt handling, or unreviewed telemetry.

## Development workflow

Use Node.js 20 or later and the pnpm version declared in `package.json`.

```bash
git clone https://github.com/vincenzo-afk/browserbrain.git
cd browserbrain
pnpm install
pnpm run dev
```

Before opening a pull request, run the repository's actual validation commands:

```bash
pnpm run check
pnpm run build
```

## Scope and quality expectations

Create a focused branch such as `fix/model-loader`, `feat/web-context`, or `docs/runtime-notes`. Use concise Conventional Commit-style messages, for example `fix: bound wasm generation` or `docs: explain local model cache`.

Changes to model loading, WebGPU, WebAssembly, model artifacts, scraping, crawling, or browser storage must describe the user-facing impact and include a manual browser verification. Do not add model binaries, credentials, browser logs, build artifacts, saved chats, local notes, or `.env` files to commits.

## Pull requests

Use the pull-request template and explain the intent, validation performed, browser/device considerations, documentation impact, and any privacy or security implications. Keep pull requests narrow enough to review independently. If a change updates a runtime artifact or external public service, update the relevant README or runtime notes in the same pull request.

## Reporting bugs and requesting features

Use the repository's issue forms for reproducible defects and focused feature requests. Security-sensitive reports must follow [SECURITY.md](./SECURITY.md) and should not be posted publicly.

## Conduct

All participants are expected to follow the [Code of Conduct](./CODE_OF_CONDUCT.md).
