set -e

# Clean any partial scaffold artifacts if present
rm -f package.json package-lock.json vite.config.* tsconfig*.json index.html || true
rm -rf src public node_modules || true

# Use a create-vite version compatible with Node 20.16.x (avoid v8.3.0 which requires 20.19+)
# If this version is unavailable, the command will fail and we can fall back next turn.
npm create vite@7.5.0 . -- --template react-ts

npm install

# Add testing deps
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event

# Ensure test script exists
node -e "const fs=require('fs'); const p='package.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); j.scripts=j.scripts||{}; j.scripts.test=j.scripts.test||'vitest'; fs.writeFileSync(p, JSON.stringify(j,null,2));"
