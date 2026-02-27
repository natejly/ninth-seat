set -e

# Scaffold into a dedicated folder to avoid conflicts with workflow directories
rm -rf frontend

# Use create-vite v7.x for Node 20.16 compatibility
npm create vite@7 frontend -- --template react-ts

cd frontend
npm install

# Add testing deps (vitest + RTL + jsdom)
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @types/testing-library__jest-dom

# Ensure test script exists
node -e "const fs=require('fs'); const p='package.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); j.scripts=j.scripts||{}; j.scripts.test=j.scripts.test||'vitest'; fs.writeFileSync(p, JSON.stringify(j,null,2));"
