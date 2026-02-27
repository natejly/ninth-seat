set -euo pipefail

# Clean any partial scaffold artifacts (keep workflow folders)
rm -rf node_modules package.json package-lock.json vite.config.* tsconfig*.json index.html src public || true

# Use a create-vite version that predates the Node 20.19+ engine requirement
npm create vite@7.5.0 . -- --template react-ts

# Install deps
npm install

# Add testing deps
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event

# Ensure test script exists
node -e "const fs=require('fs'); const p='package.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); j.scripts=j.scripts||{}; j.scripts.test=j.scripts.test||'vitest'; fs.writeFileSync(p, JSON.stringify(j,null,2));"

# Sanity check
test -f package.json && node -p "require('./package.json').name"