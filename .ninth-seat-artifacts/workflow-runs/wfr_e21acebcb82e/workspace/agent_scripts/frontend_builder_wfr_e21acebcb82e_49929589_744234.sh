set -e

# Clean any partial scaffold artifacts (keep workflow folders)
rm -rf index.html src public vite.config.* tsconfig*.json package.json package-lock.json node_modules

# Use a create-vite version compatible with Node 20.16
npm create vite@7.0.0 . -- --template react-ts

npm install

# Testing deps
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @types/testing-library__jest-dom

# Ensure test script exists
node -e "const fs=require('fs'); const p='package.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); j.scripts=j.scripts||{}; j.scripts.test=j.scripts.test||'vitest'; fs.writeFileSync(p, JSON.stringify(j,null,2));"
