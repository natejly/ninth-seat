set -e

# Show top-level structure (excluding huge node_modules)
find . -maxdepth 3 -type f \( -iname 'package.json' -o -iname 'vite.config.*' -o -iname 'next.config.*' -o -iname 'index.html' -o -iname 'tsconfig.json' -o -iname 'README.md' -o -iname '*contract*' -o -iname '*architecture*' -o -iname '*requirements*' -o -iname '*data*model*' \) \
  -not -path './backend/node_modules/*' \
  | sed 's|^\./||' | sort

echo '---'

# Deep list of inputs/ and deliverables/
find inputs deliverables -type f -maxdepth 10 2>/dev/null | sed 's|^\./||' | sort
