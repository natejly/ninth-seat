set -e

# Show top-level structure (excluding huge node_modules)
find . -maxdepth 3 -type d \( -name node_modules -o -name .npm \) -prune -o -maxdepth 3 -type d -print | sed 's|^\./||' | sort

echo "\n--- candidate frontend files ---"
find . -maxdepth 4 -type f \( -iname 'package.json' -o -iname 'vite.config.*' -o -iname 'next.config.*' -o -iname 'index.html' -o -iname 'src/main.*' -o -iname 'src/App.*' -o -iname 'tsconfig.json' \) \
  -not -path './backend/*' -not -path './.npm/*' | sed 's|^\./||' | sort

echo "\n--- docs in inputs/ and deliverables/ ---"
find inputs deliverables -maxdepth 6 -type f \( -iname '*.md' -o -iname '*.json' -o -iname '*.txt' \) 2>/dev/null | sed 's|^\./||' | sort
