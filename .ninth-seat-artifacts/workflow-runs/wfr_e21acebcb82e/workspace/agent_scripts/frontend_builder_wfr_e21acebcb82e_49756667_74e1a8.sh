set -e

# Scaffold into a dedicated folder to avoid clobbering workflow directories
rm -rf frontend

# Use a Node 20.16-compatible create-vite version (v7.x) instead of v8.x
npm create vite@7.5.0 frontend -- --template react-ts

cd frontend
npm install

# Add testing deps (vitest + react testing library + jsdom)
npm install -D vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event

# Ensure test script exists
node -e "const fs=require('fs'); const p='package.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); j.scripts=j.scripts||{}; j.scripts.test=j.scripts.test||'vitest'; fs.writeFileSync(p, JSON.stringify(j,null,2));"
