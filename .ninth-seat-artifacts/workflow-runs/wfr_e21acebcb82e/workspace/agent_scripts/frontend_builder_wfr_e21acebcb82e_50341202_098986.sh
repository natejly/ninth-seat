set -euo pipefail

# Clean any partial scaffold (keep .npm cache)
rm -rf src public index.html vite.config.* tsconfig*.json package.json package-lock.json node_modules || true

# Use a create-vite version compatible with Node 20.16 (v7.x), then scaffold React+TS
npx -y create-vite@7.5.0 . --template react-ts

# Install deps
npm install

# Add testing deps (vitest + react testing library + jsdom)
npm install -D vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event

# Ensure test script exists
node -e "const fs=require('fs'); const p='package.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); j.scripts=j.scripts||{}; j.scripts.test=j.scripts.test||'vitest'; fs.writeFileSync(p, JSON.stringify(j,null,2));"

# Quick sanity check
node -e "const fs=require('fs'); console.log('package.json exists:', fs.existsSync('package.json'))"