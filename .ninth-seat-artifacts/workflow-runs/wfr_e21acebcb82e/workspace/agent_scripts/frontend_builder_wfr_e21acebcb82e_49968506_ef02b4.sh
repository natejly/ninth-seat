set -e

# Clean any partial scaffold artifacts (keep inputs/deliverables/agent_scripts)
# Only remove if they exist
rm -rf index.html src public vite.config.* tsconfig*.json package.json package-lock.json node_modules || true

# Use a create-vite version compatible with Node 20.16 (avoid create-vite@8 which requires 20.19+)
# create-vite@7.x supports Node 18+/20+.
npm create vite@7.0.0 . -- --template react-ts

npm install

# Add testing deps
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @vitejs/plugin-react

# Ensure test script exists
node -e "const fs=require('fs'); const p='package.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); j.scripts=j.scripts||{}; j.scripts.test=j.scripts.test||'vitest'; fs.writeFileSync(p, JSON.stringify(j,null,2));"
