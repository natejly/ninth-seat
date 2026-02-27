set -e

# Use a Node-20.16 compatible create-vite (v7.x) to scaffold in-place
npm create vite@7.5.0 . -- --template react-ts

# Install deps
npm install

# Add testing deps (vitest + react testing library + jsdom)
npm install -D vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event

# Ensure test script exists
node -e "const fs=require('fs'); const p='package.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); j.scripts=j.scripts||{}; j.scripts.test=j.scripts.test||'vitest'; fs.writeFileSync(p, JSON.stringify(j,null,2));"
