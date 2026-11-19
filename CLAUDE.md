# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Purpose

Personal home page linking small open-source learning projects built together. Projects use only HTML, CSS and vanilla JS — no frameworks, libraries, CDNs or build step.

## Structure and deploy

- `site/` is the only folder published; everything at the repo root is tooling/docs.
- Each project: `site/projects/<slug>/` (PT page + its CSS/JS) and `site/en/projects/<slug>/index.html` (EN page reusing the PT folder's CSS/JS). Link every new project from both home pages.
- `.github/workflows/pages.yml` lints, then deploys `site/` to GitHub Pages on push to `main`.
- Served under `/home/` (repo isn't `<user>.github.io`): use relative URLs; root-absolute paths like `/css/style.css` break.
- Run `npm run lint` after editing HTML. Prettier runs automatically via a PostToolUse hook.
- When the site's structure or architecture changes, update this file and the README in the same change — keep it terse.

## Teaching comments

- The code is the lesson: add short didactic comments in Portuguese explaining the _why_ of key HTML, CSS and JS parts (techniques, properties, decisions), not line-by-line narration.
- Explanations live only in code comments — no "how it was made" section on the page.

## Bilingual content

- Portuguese in `site/`, English in `site/en/`, same relative path (`site/projects/x/` ↔ `site/en/projects/x/`).
- Every page exists in both languages with `<html lang>` (`pt-BR` / `en`), `<link rel="alternate" hreflang>` to both versions, and the language switcher.
- Change content or navigation in both languages in the same change.

## Compact instructions

When compacting, keep structure decisions, files changed and pending items; drop command output.

## Git

- Commits em português, com gitmoji (https://gitmoji.dev/) em unicode: `🎉 Estrutura inicial do site`. Assunto curto (~50 caracteres); detalhes no corpo.
- Última linha: `Co-Authored-By: 🤖 Claude <modelo> <noreply@anthropic.com>`.
