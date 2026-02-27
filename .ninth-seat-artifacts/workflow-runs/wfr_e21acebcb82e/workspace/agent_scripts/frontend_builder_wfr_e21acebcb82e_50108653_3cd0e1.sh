set -e

# Clean any partial scaffold artifacts (keep inputs/deliverables/agent_scripts)
ls -la

# Use a create-vite version compatible with Node 20.16.x
npm create vite@7.0.0 . -- --template react-ts

npm install

# Add testing deps (vitest + RTL + jsdom)
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event

# Ensure test script exists
node -e "const fs=require('fs'); const p='package.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); j.scripts=j.scripts||{}; j.scripts.test=j.scripts.test||'vitest'; fs.writeFileSync(p, JSON.stringify(j,null,2));"
