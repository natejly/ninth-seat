set -e

# Find docs that likely contain requirements/contracts
find inputs deliverables -type f \( -iname '*.md' -o -iname '*.json' -o -iname '*.txt' \) -maxdepth 6 2>/dev/null | sed 's|^\./||'

echo '---'

# Find any frontend scaffold (package.json, vite/next configs, src entrypoints)
find . -maxdepth 4 -type f \( \
  -iname 'package.json' -o -iname 'pnpm-lock.yaml' -o -iname 'yarn.lock' -o -iname 'vite.config.*' -o -iname 'next.config.*' -o -iname 'index.html' -o \
  -iname 'src/main.*' -o -iname 'src/App.*' -o -iname 'src/index.*' \
\) | sed 's|^\./||'

echo '---'

# List top-level directories for orientation
find . -maxdepth 2 -type d | sed 's|^\./||'
