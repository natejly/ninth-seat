set -e

# Clean any partial scaffold artifacts if present
rm -rf node_modules package.json package-lock.json vite.config.* tsconfig*.json src public index.html || true

# Use a create-vite version that does not require Node 20.19+
# (Pin to a known older major; if this fails, we can adjust in a follow-up)
npm create vite@7.0.0 . -- --template react-ts

# Install deps
npm install

# Add testing deps
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event

# Ensure test script exists
node -e "const fs=require('fs'); const p='package.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); j.scripts=j.scripts||{}; j.scripts.test=j.scripts.test||'vitest'; fs.writeFileSync(p, JSON.stringify(j,null,2));"
