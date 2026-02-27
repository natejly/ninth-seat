set -e

# Clean any partial scaffold artifacts (keep inputs/deliverables)
rm -rf node_modules package.json package-lock.json vite.config.* tsconfig*.json index.html src public

# Use an older create-vite that supports Node 20.16 (avoid 8.x engine requirement)
# 7.5.0 is typically compatible with Node 18+/20.
npm create vite@7.5.0 . -- --template react-ts

npm install

# Add testing deps
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event

# Ensure test script exists
node -e "const fs=require('fs'); const p='package.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); j.scripts=j.scripts||{}; j.scripts.test=j.scripts.test||'vitest'; fs.writeFileSync(p, JSON.stringify(j,null,2));"
