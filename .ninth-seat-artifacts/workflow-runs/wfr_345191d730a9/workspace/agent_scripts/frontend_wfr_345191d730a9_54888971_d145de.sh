set -e

# Find frontend/package manifests (exclude heavy dirs)
find . -maxdepth 5 -type f \( -name 'package.json' -o -name 'pnpm-lock.yaml' -o -name 'yarn.lock' -o -name 'vite.config.*' -o -name 'next.config.*' -o -name 'index.html' \) \
  -not -path './backend/node_modules/*' -not -path './.npm/*' -not -path './**/node_modules/*' | sed 's|^\./||'

echo '---'

# Find likely contract/requirements docs
find . -maxdepth 6 -type f \( -iname '*requirements*' -o -iname '*acceptance*' -o -iname '*api*contract*' -o -iname '*openapi*' -o -iname '*architecture*' -o -iname '*data*model*' -o -iname 'README.md' \) \
  -not -path './backend/node_modules/*' -not -path './.npm/*' -not -path './**/node_modules/*' | sed 's|^\./||'
