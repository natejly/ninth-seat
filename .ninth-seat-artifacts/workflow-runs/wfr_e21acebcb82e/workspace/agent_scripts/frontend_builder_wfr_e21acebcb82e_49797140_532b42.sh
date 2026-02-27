set -e

# Clean any partial scaffold artifacts in root (keep inputs/deliverables)
# We'll create the app in ./frontend to avoid clobbering workflow folders.
mkdir -p frontend

# Use a create-vite version compatible with Node 20.16
npm create vite@7.0.0 frontend -- --template react-ts

cd frontend
npm install

# Add testing deps
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @types/testing-library__jest-dom

# Ensure test script exists
node -e "const fs=require('fs'); const p='package.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); j.scripts=j.scripts||{}; j.scripts.test=j.scripts.test||'vitest'; fs.writeFileSync(p, JSON.stringify(j,null,2));"
