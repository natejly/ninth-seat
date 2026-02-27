set -e

# Clean any partial scaffold artifacts (keep inputs/deliverables)
rm -rf src public index.html vite.config.* tsconfig*.json package.json package-lock.json node_modules

# Use a Node-20.16 compatible create-vite version (avoid 8.3.0 which requires Node 20.19+)
# 7.x works with Node 18+/20 generally.
npm create vite@7.4.0 . -- --template react-ts

npm install

# Testing deps
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @types/testing-library__jest-dom

# Ensure test script exists
node -e "const fs=require('fs'); const p='package.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); j.scripts=j.scripts||{}; j.scripts.test=j.scripts.test||'vitest'; fs.writeFileSync(p, JSON.stringify(j,null,2));"
