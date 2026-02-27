set -e

# List candidate docs in inputs/ and deliverables/
find inputs deliverables -maxdepth 6 -type f \( -iname '*.md' -o -iname '*.json' -o -iname '*.txt' \) 2>/dev/null | sed 's|^\./||' | sort

echo '---'

# Detect any frontend scaffold (React/Vite/Next/etc.)
find . -maxdepth 4 -type f \( \
  -iname 'package.json' -o -iname 'pnpm-lock.yaml' -o -iname 'yarn.lock' -o \
  -iname 'vite.config.*' -o -iname 'next.config.*' -o -iname 'index.html' -o \
  -path '*/src/main.*' -o -path '*/src/App.*' -o -path '*/public/index.html' \
\) | sed 's|^\./||' | sort

echo '---'

# Top-level directories
find . -maxdepth 2 -type d | sed 's|^\./||' | sort
