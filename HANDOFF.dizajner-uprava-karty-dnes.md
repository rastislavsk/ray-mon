# Handoff — dizajner-uprava-karty-dnes
_Last updated: 2026-10-30T08:48:16+01:00 · Tool: claude-code · Session: dizajner-uprava-karty-dnes_

## Active Task
Redesign of the "Dnes" card (code name `mozem`) in both apps. A designer review produced three directions (A, B, C), and they are now mockups. We are waiting for the user to pick one before any code is written.

## Current State
**Done:**
- Designer subagent reviewed the Dnes card in both apps: the current app (`index.html`, `style.css`, `web/render/mozem.js`) and "Živá obloha" (`obloha/index.html`, `obloha/style.css`, `obloha/web/render/mozem.js`). Findings, with references:
  - The only actionable advice, "Okno na veľké veci 09:00 – 17:30", is hidden in the 2nd line of the first strip card (`shared/teraz.js:274`, `index.html:142`, `obloha/index.html:93`).
  - The current app shows a redundant kicker "DNES · 13:00 · MIESTO" (`web/render/mozem.js:63`). PR #396 already removed the same line from the Teraz card.
  - The second strip card "Kedy lepšie" is barely discoverable. The obloha desktop strip has no `data-dash` variant (`obloha/style.css:1078-1087`).
  - In the evening the card order is backwards: tomorrow should come first.
  - The forecast appears twice with different precision ("asi 61 kWh" vs "61,4 kWh").
  - Low contrast of small white text on the obloha sky gradient, about 3.4–4.1 : 1 (`obloha/style.css:452`).
  - The figures are plain `<div>`s, not a list (`web/render/mozem.js:26`, `obloha/web/render/mozem.js:41`).
  - Heading levels are inconsistent (`index.html:134,139,145`), and the current app has no live region (obloha has `#mz-live`).
  - Neither app has a light mode; both hardcode `color-scheme: dark`.
- Mockup written: `docs/navrhy/dnes-tri-smery.html`, untracked and Prettier-clean. It shows the current state, then:
  - **A "Upratať"**: phones at 13:00 and 20:30, plus a desktop sketch.
  - **B "Okno ako hrdina plagátu"**: 13:00 and 20:30, both apps.
  - **C "Karta podľa časti dňa"**: 05:45, 13:00 and 20:30, both apps.
  - Comparison table, quick wins, and the recommendation (B).
  - The phone header, sun arc and nav are injected by an inline script from `data-time` / `data-sun` / `data-win` / `data-labels` attributes.
- Designer screenshots of the live apps are in the session scratchpad (`dnes-snimky/`). They are not in the repo.

**In flight:**
- Nothing. Waiting for the user's choice of direction (A, B, C, or quick wins only).

**Tried and rejected:**
- None yet.
- Previously rejected in the repo: a technical appliance list on the card (`docs/navrhy/karta-mozem.html`). Direction C must stay at one number and one sentence.

## Next Steps
1. Ask the user which direction to implement. Per the memory rule "mockup before code", do not code until they approve.
2. Whatever the direction, the quick wins apply:
   - Non-breaking spaces around "–" in `terazWindowText` (`shared/messages-core.js:1305`).
   - Drop time and place from the kicker in `web/render/mozem.js:63`.
   - Render the figures as `<ul>`/`<li>` in both render files.
   - Fix the heading levels in `index.html:134-145`.
   - Add `role="status"` to the current app, mirroring `obloha/web/render/mozem.js:61-73`.
   - Stack the strip in obloha's `:root[data-dash]` column.
   - Raise the contrast of `.eq span` in `obloha/style.css:452`.
   - "CO₂eq" in `shared/messages-core.js:1082` requires regenerating the font subset (`scripts/font-subset.js`).
3. If B is chosen:
   - Add a neutral header model in `shared/` composed from `todayCard`, `laterCard` (`shared/teraz.js`) and `denFaza` (`shared/den-trieda.js:44`), covering the window, the remaining time and the evening switch to tomorrow.
   - Render it in both apps.
   - Add window edge labels in the shared `web/sun-arc.js`.
   - Remove the strip.
   - Update the e2e tests around `tz-strip` and the dots.
4. Work on branch `claude/<topic>`, commit the mockup with the implementation, run `npm run check`, `npm run test:e2e` and `npm run screenshots`, and open the PR.

## Key Decisions
- **Decision:** Mockups go in a single file, `docs/navrhy/dnes-tri-smery.html`. · **Why:** Repo convention: every design proposal lives in `docs/navrhy/`, and the user wants a mockup before code. · **Alternative considered:** a claude.ai artifact. Rejected to stay consistent with the repo's proposal docs.
- **Decision:** Recommend B. · **Why:** The core problem is that the actionable window is hidden. B surfaces it without new calculations and removes the horizontal strip. · **Alternative considered:** A is safe but leaves the main problem. C is twice the work and overlaps the Teraz card.

## Open Questions
- [ ] Which direction: A, B, C, or only the quick wins?
- [ ] B and C reverse the decision in `docs/navrhy/dnes-a-teraz.html` to show the figures large. Is the user OK with that?
- [ ] Should the obloha app also get a day-class colour (chip) as in C?

## Working Environment
- Branch: `main` · Base: `main`
- Commands to run: `npm run check`, `npm run test:e2e`, `cd worker && npx wrangler deploy --dry-run --outdir dist`, `npm run screenshots` (after visual changes), `npx prettier --write <file>`
- Preview: `.claude/launch.json` config "ray-mon" (http-server on port 8080). The mockup is at http://localhost:8080/docs/navrhy/dnes-tri-smery.html
- Known broken / skipped: nothing. Tests were not run because no app code changed.
- Changed files (`git diff --stat HEAD`):
  ```
  (no tracked changes; untracked: docs/navrhy/dnes-tri-smery.html, HANDOFF.dizajner-uprava-karty-dnes.md)
  ```

## Context for the next tool (3-5 sentences)
ray-mon is a static, build-free PV household web app with two permanent "coats": the root app and `obloha/`. Both share a pure core in `shared/` plus neutral `web/` modules, and `CLAUDE.md` lists the hard rules: no `:hover`, `.hidden` is the only `!important`, Slovak in all texts and commits, JSDoc types, logic in `shared/` without DOM or `Date.now()`. A designer review of the "Dnes" card led to three mockup directions in `docs/navrhy/dnes-tri-smery.html`, which is uncommitted on `main`. The user must pick a direction before implementation. Any computation belongs in `shared/` so that both apps give identical answers, and visible changes need e2e updates and regenerated screenshots in the same PR. Written by Claude Code; tool-agnostic for pickup.
