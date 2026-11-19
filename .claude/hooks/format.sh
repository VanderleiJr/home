#!/usr/bin/env bash
# PostToolUse(Write|Edit): format the edited file with the project's Prettier.
f=$(node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);process.stdout.write((j.tool_response&&j.tool_response.filePath)||(j.tool_input&&j.tool_input.file_path)||"")})')
[ -n "$f" ] && [ -f "$f" ] || exit 0
case "$f" in "$CLAUDE_PROJECT_DIR"/*) ;; *) exit 0 ;; esac
cd "$CLAUDE_PROJECT_DIR" || exit 0
exec ./node_modules/.bin/prettier --write --ignore-unknown --log-level warn "$f"
