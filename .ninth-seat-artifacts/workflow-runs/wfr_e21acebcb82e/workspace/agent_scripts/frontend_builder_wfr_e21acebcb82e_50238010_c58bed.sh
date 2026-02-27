set -euo pipefail

# Clean any partial scaffold artifacts (keep inputs/deliverables)
rm -rf node_modules package.json package-lock.json vite.config.* tsconfig*.json index.html src public || true

# Use a create-vite version that supports Node 20.16 (avoid 8.x which requires 20.19+)
npm create vite@7.0.0 . -- --template react-ts

npm install

# Testing deps
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @types/testing-library__jest-dom

# Ensure test script exists
node -e "const fs=require('fs'); const p='package.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); j.scripts=j.scripts||{}; j.scripts.test='vitest'; fs.writeFileSync(p, JSON.stringify(j,null,2));"
