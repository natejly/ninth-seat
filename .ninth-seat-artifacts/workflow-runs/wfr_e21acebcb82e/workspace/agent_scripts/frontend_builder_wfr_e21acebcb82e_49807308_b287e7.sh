set -e

# Clean any partial scaffold (keep workflow folders)
rm -rf node_modules package.json package-lock.json vite.config.* tsconfig*.json index.html src public

# Use a Node-20.16 compatible create-vite version (older than 8.3.0)
# If this fails, we can fall back to manual scaffold in a later step.
npm create vite@7.5.0 . -- --template react-ts

npm install

# Testing deps
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @vitest/ui

# Ensure test script exists
node -e "const fs=require('fs'); const p='package.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); j.scripts=j.scripts||{}; j.scripts.test=j.scripts.test||'vitest'; fs.writeFileSync(p, JSON.stringify(j,null,2));"

# Sanity check
test -f package.json && node -p "require('./package.json').name"