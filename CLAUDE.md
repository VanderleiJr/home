# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Purpose

Personal home page linking small open-source learning projects built together. Everything in `site/` (home included) uses only HTML, CSS and vanilla JS — no frameworks, libraries, CDNs, web fonts or build step.

## Structure and deploy

- `site/` is the only folder published; everything at the repo root is tooling/docs.
- Each project: `site/projects/<slug>/` (one page + its CSS/JS). Link it from the home page.
- Home page: Win98/vaporwave "desktop" (windows, icons, taskbar) — `home.css`/`home.js` in `site/assets/`. Each new project goes in the "projetos" window list (`.file-list`) and gets a desktop icon (`.icons`).
- Win98 look and window behavior are shared: every page loads `assets/win98.css` (before its own CSS) and `assets/desktop.js` (defer, before its own JS). desktop.js wires everything by markup: `.window` drags by `.titlebar` (offset via `--drag-x/--drag-y`, not saved), `[data-action=minimize|close]`, `[data-open=id]`, `.tasks` (one button per minimizable window), `<time class="clock">`; API `desktop.open/close/minimize`. Project pages use `<main class="desktop desktop-flow">`; page CSS only sets window widths and its own content.
- Every page (home and projects) loads `site/assets/scene.css` + `scene.js` + `i18n.js` (in `<head>`, no defer) before the other CSS: the shared background scene (sky follows local time: sun by day, moon by night, both fixed at the horizon center; `--daylight` 0–1 and `.is-night` on `<html>`, `?hora=HH:MM` to preview), its animation phase sync, the cross-page view transition and translation. Never fork the scene into a page CSS, or page switches visibly jump.
- The home car is a 3D model in `home.js` projected with the floor's CSS geometry (`--floor-tilt`, `.floor` perspective): change the floor only through those, or the car drifts off the road.
  Its headlight beams and tail-light glow fade in with `--daylight`.
- `tools/vlibras/` (outside `site/`, Node only, never shipped): `npm run vlibras` downloads the VLibras dictionary bundles, reads the Unity AnimationClips and regenerates the `SIGN_TABLE` block of `site/projects/libras/signs.js`. Edit the generator, not the generated rows; keep the VLibras credit on the libras page.
- `tools/kanjivg/` (same idea): `npm run kanjivg` downloads the KanjiVG SVGs (CC BY-SA 3.0) and regenerates the `STROKES` block of `site/projects/kana/strokes.js` (stroke paths in writing order, for kana.exe's drawing mode). Keep the KanjiVG credit on the kana page.
- kana.exe drawing mode (`✍ Desenho`, free mode, easy = per stroke / hard = whole kana at the end): `draw.js` = pure stroke checker (browser + Node: resample, point-by-point + shape match, hand calibration from accepted strokes, verdicts ok/order/direction/shape); tune its constants only with `npm run kana:check` passing. Strokes are kept in KanjiVG units (109 per cell; yōon = 2 cells).
- `site/projects/dnd/` (d&d.exe): no book content ever goes into the repo — the page reads the user's own PDF in the browser. `pdf.js` = own PDF text reader (browser + Node), `extract.js` = generic helpers (reading order, outline by font style, paragraphs, tables), `sources/<id>.js` = one per book (SHA-256 + book-specific rules + extractor `version`, registered with `DND.registerSource`), `store.js` = IndexedDB cache of extracted data per source (bump the source `version` when extraction changes), `DND.merge` joins several books, `rules.js` = pure D&D math over that data (no book numbers; tested in `dnd:check`). `wizard.js` = the character wizard (state → `derive()` → redraw; characters in localStorage `dnd-exe:characters`, exported/imported as JSON with ids only — never book text): book data only feeds choices, limits and numbers, never shown as raw tables; rule text only on demand (ⓘ button → `.win-info` window). The local PDF lives in gitignored `tools/dnd/livros/`; `npm run dnd:check` validates extraction, `tools/dnd/inspect.js --texto N` dumps pages.
- `.github/workflows/pages.yml` lints, then deploys `site/` to GitHub Pages on push to `main`.
- Served under `/home/` (repo isn't `<user>.github.io`): use relative URLs; root-absolute paths like `/css/style.css` break.
- Run `npm run lint` after editing HTML. Prettier runs automatically via a PostToolUse hook.
- When the site's structure or architecture changes, update this file and the README in the same change — keep it terse.

## Teaching comments

- The code is the lesson: add short didactic comments in Portuguese explaining the _why_ of key HTML, CSS and JS parts (techniques, properties, decisions), not line-by-line narration.
- Explanations live only in code comments — no "how it was made" section on the page.

## Translation (i18n)

- One page per screen, no per-language copies. Visible text gets a key: `data-i18n` (text), `data-i18n-html` (markup), `data-i18n-attr="attr:key, …"` (attributes); page JS uses `i18n.t(key, vars)` after `await i18n.ready`.
- Strings live in `site/i18n/<lang>.json` (namespaced `common.*`, `home.*`, `<project>.*`); `languages.json` lists the languages. Adding a language = new JSON + list entry, no code.
- The HTML keeps the Portuguese text as fallback, and it must match `pt-BR.json`. Every language JSON has the same keys.
- Language: `?lang=` > saved choice > browser languages > `pt-BR`. The `<select data-lang-select>` switcher is built from `languages.json`.
- A page can lock its language with `data-lang` on the `i18n.js` script (no switcher; ignores `?lang=`). d&d.exe is locked to `pt-BR` (the book is Portuguese): its `dnd.*` keys live only in `pt-BR.json`.

## Compact instructions

When compacting, keep structure decisions, files changed and pending items; drop command output.

## Versions

- SemVer adapted to a site: patch = fixes; minor = new project or big feature; major = breaking (URLs, saved browser data). 0.x = in development, not publicized; 1.0.0 = when the user publicizes the site.
- Releasing: squash-merge the feature branch into `main`, then a `🔖 Versão X.Y.Z` commit updating `CHANGELOG.md` (Portuguese, user-facing changes only) and `package.json` `version`; annotated tag `vX.Y.Z`; push with tags; `gh release create` (pre-release while 0.x). Only with the user's ok.

## Git

- Commits em português, com gitmoji (https://gitmoji.dev/) em unicode: `🎉 Estrutura inicial do site`. Assunto curto (~50 caracteres); detalhes no corpo.
- Cada página nova é feita numa branch `feature/<slug>` (ex.: `feature/dnd`); cada feature nova numa página existente, em `feature/<slug>NNN` numerada por página (ex.: `feature/kana001`). Só entra na `main` (que publica) quando estiver pronta; a branch vai para o GitHub a cada etapa aprovada.
- Última linha: `Co-Authored-By: 🤖 Claude <modelo> <noreply@anthropic.com>`.
