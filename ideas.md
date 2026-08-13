# BrowserBrain design direction

## Three possible directions

### Theme Name: Warm editorial workspace
Very Brief Intro: A calm, paper-toned research desk for local AI. It feels trustworthy and considered, using ink-like typography, generous whitespace, and a single amber signal color.
Probability: 0.07

### Theme Name: Quiet instrument panel
Very Brief Intro: A restrained monochrome utility interface with fine rules, compact telemetry, and a more technical operator feel. It prioritizes density and scanability over warmth.
Probability: 0.04

### Theme Name: Midnight field notes
Very Brief Intro: A dark, cinematic research console with cobalt accents and subtle phosphor glow. It makes the local model feel like a powerful tool, but deliberately avoids cyberpunk excess.
Probability: 0.03

## Chosen approach: Warm editorial workspace

### Design Movement
Contemporary editorial design blended with Swiss information design and the tactile restraint of a well-made field notebook.

### Core Principles
1. **Calm hierarchy:** The interface should make the next useful action obvious without shouting for attention.
2. **Evidence before spectacle:** Sources, model state, and tool activity are visible but quiet; the product earns trust through legibility.
3. **Tactile precision:** Paper grain, ink-like dividers, and small signal marks make the interface feel crafted rather than assembled.
4. **Progressive disclosure:** Advanced controls stay available in a side rail or drawer while the chat remains uncluttered.

### Color Philosophy
The base is warm ivory rather than pure white to lower glare and make long reading sessions feel less clinical. Graphite ink provides a strong editorial contrast. **Signal amber** is reserved for actions, active state, and the small moments where the system is doing work; it should feel like a pencil mark in the margin, not an alarm. Sage is used only for verified local-ready or source-found states.

### Layout Paradigm
An asymmetric research desk: a narrow left library rail, a wide reading column, and a right context rail that becomes a drawer on small screens. The composer stays anchored to the reading column instead of centering the whole app into a generic dashboard.

### Signature Elements
1. A compact amber **signal dot** that changes from idle to loading to ready.
2. **Margin cards** for sources and context, using small editorial labels instead of loud badges.
3. A **browser-window intelligence mark**: the logo slot is a simple symbol that can be replaced by the user's own logo later.

### Interaction Philosophy
Interactions should feel like handling a good tool: immediate, reversible, and quietly acknowledged. Buttons use small translations and ink-darkening instead of bouncing. Tool activity appears as a short-lived status line. Sources expand in place, keeping the user anchored to the answer.

### Animation
Use 160–240ms ease-out transitions for drawers, controls, and source expansion. New assistant messages rise 6px and fade in. The model signal dot uses a restrained pulse only while loading. Avoid perpetual motion in the reading column, and honor `prefers-reduced-motion` by removing entrance and pulse effects.

### Typography System
Use **DM Serif Display** for the product wordmark and sparse editorial headings; use **Manrope** for UI labels, body text, and controls. Headlines are compact and sentence-cased. Body copy uses a 1.6 line-height with a comfortable 15–16px base. Metadata is uppercase with increased letter spacing and a smaller size.

### Brand Essence
BrowserBrain is a private, browser-first research companion for people who want useful AI without handing every thought to a server; it combines a local model with optional web context and keeps the user in control. Personality: **grounded, curious, capable**.

### Brand Voice
Headlines are direct and quietly confident. CTAs describe the next action rather than promising magic. Microcopy explains state in plain language and avoids hype.

Example lines:

> Ask a local model. Bring your own context.

> Search the open web when the answer needs a fresh source.

### Wordmark & Logo
The wordmark is set in DM Serif Display with a small amber signal mark replacing the dot in the “i” rhythm. The symbol is an abstract browser frame holding an intelligence spark and orbit arcs. The current symbol is a generated stand-in with a single constant in `Home.tsx` so the user's logo can replace it later without changing layout.

### Signature Brand Color
**Signal Amber — `#D99128`**. It is warm enough to feel human and distinct enough to own the active state without turning the whole interface orange.

## Style Decisions

- The app is a warm ivory reading surface, not a dark neon console.
- The local-first promise is expressed through visible status and context controls, not oversized claims.
- The user-provided logo should replace the generated mark through one asset constant and the favicon link.
- Generated imagery is used sparingly: one quiet empty-state illustration and one research-context illustration.
