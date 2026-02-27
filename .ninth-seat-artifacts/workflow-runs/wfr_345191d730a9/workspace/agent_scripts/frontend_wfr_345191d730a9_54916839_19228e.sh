set -e
# Find docs that define requirements/contracts
find inputs deliverables -type f \( -iname '*contract*' -o -iname '*requirement*' -o -iname '*architecture*' -o -iname '*data*model*' -o -iname 'README.md' \) -maxdepth 6 2>/dev/null | sed 's|^\./||'

# Find any frontend project files
find . -maxdepth 4 -type f \( -iname 'package.json' -o -iname 'vite.config.*' -o -iname 'next.config.*' -o -iname 'index.html' -o -iname 'tsconfig.json' -o -iname 'src/main.*' -o -iname 'src/App.*' \) | sed 's|^\./||'

# List top-level directories (excluding node_modules noise)
find . -maxdepth 2 -type d \( -name node_modules -prune -o -print \) | sed 's|^\./||'