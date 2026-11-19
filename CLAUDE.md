# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Purpose

Personal home page linking small open-source learning projects built together. Everything in `site/` (home included) uses only HTML, CSS and vanilla JS — no frameworks, libraries, CDNs, web fonts or build step.

## Structure and deploy

- `site/` is the only folder published; everything at the repo root is tooling/docs.
- Each project: `site/projects/<slug>/` (one page + its CSS/JS). Link it from the home page.
- Home page: Win98/vaporwave "desktop" (windows, icons, taskbar) — CSS/JS in `site/assets/`. Each new project goes in the "projetos" window list (`.file-list`) and gets a desktop icon (`.icons`). Projects copy the Win98 look into their own CSS instead of importing `home.css`.
- Every page (home and projects) loads `site/assets/scene.css` + `scene.js` + `i18n.js` (in `<head>`, no defer) before its own CSS: the shared background scene, its animation phase sync, the cross-page view transition and translation. Never fork the scene into a page CSS, or page switches visibly jump.
- The home car is a 3D model in `home.js` projected with the floor's CSS geometry (`--floor-tilt`, `.floor` perspective): change the floor only through those, or the car drifts off the road.
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

## Compact instructions

When compacting, keep structure decisions, files changed and pending items; drop command output.

## Git

- Commits em português, com gitmoji (https://gitmoji.dev/) em unicode: `🎉 Estrutura inicial do site`. Assunto curto (~50 caracteres); detalhes no corpo.
- Última linha: `Co-Authored-By: 🤖 Claude <modelo> <noreply@anthropic.com>`.
