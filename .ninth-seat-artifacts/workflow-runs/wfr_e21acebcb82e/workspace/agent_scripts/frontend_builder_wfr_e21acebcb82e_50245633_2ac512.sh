set -e
ls -la

# show key files if present
[ -f package.json ] && echo "\n--- package.json ---" && cat package.json || echo "\nNO package.json"

[ -d src ] && echo "\n--- src tree ---" && find src -maxdepth 2 -type f -print || echo "\nNO src/"

[ -f vite.config.ts ] && echo "\n--- vite.config.ts ---" && cat vite.config.ts || true
