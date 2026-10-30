# Handoff — hand-off-resume-dizajner-uprava-karty-dnes

_Last updated: 2026-10-30T09:46:16+00:00 · Tool: claude-code · Session: hand-off-resume-dizajner-uprava-karty-dnes_

## Active Task

Direction C of the "Dnes" card redesign (the card changes by part of day) is implemented and merged in [rastislavsk/ray-mon#398](https://github.com/rastislavsk/ray-mon/pull/398). Only optional follow-ups remain, and each needs a new PR.

## Current State

**Done (merged to `main` via PR #398, head `de19179`):**

- New core module `shared/dnes-faza.js`. `dnesFaza(input, den, window, { voice, devices })` returns `faza`, `chip`, `kick`, `count`, `progress`, `grade`, `line`, `later` and `tomorrow`. It is built from `mozemModel` (`den`, `facts.window`) and `dnesCards` (`shared/teraz.js`).
- The card by part of day:
  - morning: "Plán na dnes" and "Veľké veci daj medzi …"
  - day: a countdown, either `go` (until the window ends) or `wait` (until it starts), plus "Nabehlo X z ~Y kWh" with a bar
  - evening (only with a measurement): a "Vysvedčenie" (report card) with the measured kWh, "Predpoveď bola …", and a tomorrow block with its class, word and window
- `shared/den-trieda.js`:
  - `denTriedaDna(input, index, devices)` gives the class of any forecast day.
  - The shared logic is in private `triedaOf`.
- `sunWindows` and `mainWindow` moved to `shared/mozem.js`. `shared/sedem-dni.js` re-exports them.
- `todayCard` in `shared/teraz.js` now also returns `forecastKwh`, `doneKwh` and `measured` (helper `dayDone`).
- `dnesDay` in `shared/mozem.js`: after sunset it uses only the measured kWh.
- New texts in `shared/messages-core.js`:
  - `DEN_WORDS.zajtra` in both voices, plus `DEN_NAZVY` and `DNES_TEXTS`
  - text functions: `dnesPlanText`, `dnesCountText`, `dnesProgressText`, `dnesGradeText`, `dnesZajtraText`
- Renders:
  - Current app `web/render/mozem.js`: the whole card is HTML written into `#mozem-body`. The tomorrow block is `.mozem-tom`, the later line is `.mozem-later`.
  - Obloha `obloha/web/render/mozem.js`: new nodes `#mz-chip`, `#mz-kick`, `#mz-count`, `#mz-grade`, `#mz-more`, `#mz-tom` and `#mz-later`, listed in `obloha/index.html` and `obloha/web/dom.js`.
- Removed:
  - the horizontal recommendation strip (`#tz-recs`, `#tz-strip`, `#tz-dots`)
  - the `terazPage` state and `stripPage` (`web/teraz-gestures.js`)
  - the strip scroll listeners
  - the kicker "Dnes · time · place" in the current app
- Figures (phones, km, CO2) stay large in every phase, at the user's request. They render as `<ul>`.
- Tests:
  - new `test/dnes-faza.test.js`
  - `test/texts-sample.js` now includes `dnesFaza`
  - golden `test/golden/texty-drzy.json` updated
  - e2e updated in `test/e2e/app.spec.js`, `test/e2e/obloha.spec.js` (`modelKarty` / `kartaVStranke` / `kartaZModelu` now compare phase fields) and `test/e2e/obloha-siroka.spec.js` (the Dnes column has no Tab stops now)
- `docs/img/mozem.png` regenerated. The previous handoff file was removed. The mockup is kept at `docs/navrhy/dnes-tri-smery.html`.

**In flight:**

- Nothing.

**Tried and rejected:**

- Shrinking the day figures into one tiny line, as in mockups B and C. The user said the info "gets lost", so the figures stay large.
- Calling `dnesFaza` inside `mozemSkyModel`. It would create an import cycle `mozem-sky` → `dnes-faza` → `teraz` → `mozem-sky`. Instead `mozemSkyModel` exposes `den` and `window`, and both renders call `dnesFaza`.
- Importing `mainWindow` from `sedem-dni.js` into the core. That would pull `messages-sedem.js` into obloha's startup bundle, so the function moved to `mozem.js` instead.

## Next Steps

1. Ask the user which follow-up they want, if any. Each one is a new PR from fresh `main`: `git fetch origin main && git checkout -B claude/<topic> origin/main`. The `claude/peaceful-edison-zslkd6` branch is already merged and must not be reused.
2. Quick win, non-breaking spaces: in `shared/messages-core.js`, make `spanText` (or only the visible window texts `dnesPlanText`, `dnesCountText`, `dnesZajtraText`, `terazWindowText`) use ` – `, so "09:00 – 17:30" never wraps. Then run `UPDATE_GOLDEN=1 npm test` and check the e2e tests.
3. Quick win, "CO₂eq": change `'CO2eq menej'` in `dnesDayText` (`shared/messages-core.js`) to "CO₂eq". Regenerate the obloha font subset with `scripts/font-subset.js`, which `test/font-subset.test.js` will demand.
4. Quick win, screen reader: add a live region (`role="status"`) to the current app's Dnes card, mirroring `renderAnnounce` in `obloha/web/render/mozem.js`.
5. Let the user rewrite the drzý texts in `DEN_WORDS.zajtra` (`shared/messages-core.js`) if they want. Claude invented them.

## Key Decisions

- **Decision:** Implement direction C, keeping the figures large. · **Why:** The user chose C and objected that the figures get lost in the mockup. · **Alternative considered:** B, the designer's recommendation, which the user rejected.
- **Decision:** The evening phase follows `denSlovo` (evening only with a measured curve; otherwise morning). · **Why:** It stays consistent with the big word, so the card never grades a day it has not measured.
- **Decision:** The obloha chip shows the day class (`DEN_NAZVY`). · **Why:** It is part of C. The user did not answer this question, so it was done as designed.
- **Decision:** The tomorrow window is `mainWindow`, the longest green window. · **Why:** It is the same as the 7-day card row.

## Open Questions

- [ ] Does the user want the obloha day-class chip kept? It was never explicitly confirmed.
- [ ] Should the invented "zajtra" words (`DEN_WORDS.zajtra`) be rewritten in the user's own tone?
- [ ] Which, if any, of the three remaining quick wins should be done next?

## Working Environment

- Branch: `claude/peaceful-edison-zslkd6` (merged via #398) · Base: `main`
- Commands to run:
  - `npm ci`
  - `npm run check`
  - `npm run test:e2e`
  - `UPDATE_GOLDEN=1 npm test` (after text changes)
  - `npm run screenshots` (after visual changes)
  - `cd worker && npx wrangler deploy --dry-run --outdir dist`
- Known broken / skipped: nothing. CI and the Cloudflare build were green on `de19179`.
- Changed files (`git diff --stat HEAD`):
  ```
  (clean; only this handoff file is new and untracked)
  ```

## Context for the next tool (3-5 sentences)

ray-mon is a build-free static PV household web app with two permanent "coats", the root app and `obloha/`. Both share a pure core in `shared/` and must give identical answers. `CLAUDE.md` holds the hard rules: Slovak texts and commits, JSDoc types, no `:hover`, `.hidden` is the only `!important`, and logic lives in `shared/` with no DOM and no `Date.now()`. The "Dnes" card (code name `mozem`) now changes by part of day through `shared/dnes-faza.js`, and both renders call it. That work is merged, so any further change starts on a fresh `claude/<topic>` branch from `main`, with its own PR, golden update and screenshots. This handoff was written by Claude Code and is tool-agnostic.
