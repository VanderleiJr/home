#!/usr/bin/env bash
# PreToolUse(Bash): quiet npm and keep only the tail of lint/format checks.
# pipefail preserves the check's exit code through the pipe.
exec node -e '
let d = "";
process.stdin.on("data", (c) => (d += c)).on("end", () => {
  const j = JSON.parse(d);
  const cmd = (j.tool_input && j.tool_input.command) || "";
  if (!/^npm run (lint|format:check)( [\w.\/:-]+)*$/.test(cmd)) return process.stdout.write("{}");
  const command = `set -o pipefail; ${cmd.replace(/^npm run /, "npm run --silent ")} 2>&1 | tail -n 40`;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: { ...j.tool_input, command } },
  }));
});'
