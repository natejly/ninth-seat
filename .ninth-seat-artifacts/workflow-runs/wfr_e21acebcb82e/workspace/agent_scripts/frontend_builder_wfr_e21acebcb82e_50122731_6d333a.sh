set -euo pipefail

# Clean any partial scaffold artifacts if present
rm -rf node_modules package.json package-lock.json vite.config.* tsconfig*.json index.html src public || true

# Use a create-vite version compatible with Node 20.16 (v7.x), then scaffold react-ts into current dir
npm create vite@7.0.0 . -- --template react-ts

# Install deps
npm install

# Add testing deps (vitest + react testing library + jsdom)
npm install -D vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event

# Ensure test script exists
node -e "const fs=require('fs'); const p='package.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); j.scripts=j.scripts||{}; j.scripts.test=j.scripts.test||'vitest'; fs.writeFileSync(p, JSON.stringify(j,null,2));"
