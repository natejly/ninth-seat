set -e

# Clean any partial scaffold artifacts if present
rm -rf node_modules package.json package-lock.json vite.config.* tsconfig*.json src public index.html || true

# Use a Node-20.16 compatible create-vite version (avoid v8.3.0 engine requirement)
# If this version is unavailable, adjust to another 7.x version.
npm create vite@7.5.0 . -- --template react-ts

# Install deps
npm install

# Add testing deps (vitest + react testing library + jsdom)
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event

# Ensure test script exists
node -e "const fs=require('fs'); const p='package.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); j.scripts=j.scripts||{}; j.scripts.test=j.scripts.test||'vitest'; fs.writeFileSync(p, JSON.stringify(j,null,2));"
