set -e

# Clean any partial scaffold artifacts (keep inputs/deliverables)
ls -la

# Use a Node-20.16 compatible create-vite version (older) to avoid engine restriction
npm create vite@7.0.0 . -- --template react-ts

# Install deps
npm install

# Add testing deps
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event

# Ensure test script exists
node -e "const fs=require('fs'); const p='package.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); j.scripts=j.scripts||{}; j.scripts.test='vitest'; fs.writeFileSync(p, JSON.stringify(j,null,2));"

# Quick sanity check
node -e "const fs=require('fs'); console.log('package.json exists:', fs.existsSync('package.json'))"