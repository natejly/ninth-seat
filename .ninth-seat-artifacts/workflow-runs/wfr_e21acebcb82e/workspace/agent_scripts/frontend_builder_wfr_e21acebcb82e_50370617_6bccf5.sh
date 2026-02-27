set -e

# Clean any partial scaffold artifacts (keep inputs/deliverables)
rm -rf node_modules package.json package-lock.json vite.config.* tsconfig*.json index.html src public

# Use a Node-20.16 compatible create-vite version (older than 8.3.0)
# 7.x supports Node 18+/20 without the 20.19+ constraint.
npm create vite@7.4.2 . -- --template react-ts

# Install deps
npm install

# Add testing deps (vitest + RTL + jsdom)
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event

# Ensure test script exists
node -e "const fs=require('fs'); const p='package.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); j.scripts=j.scripts||{}; j.scripts.test=j.scripts.test||'vitest'; fs.writeFileSync(p, JSON.stringify(j,null,2));"
