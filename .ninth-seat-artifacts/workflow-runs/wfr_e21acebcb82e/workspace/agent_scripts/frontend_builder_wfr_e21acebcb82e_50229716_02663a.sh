set -e

# Clean any partial scaffold artifacts (keep workflow dirs)
# Only remove if they exist
rm -rf index.html src public vite.config.* tsconfig*.json package.json package-lock.json node_modules

# Use a Node-20.16 compatible create-vite version
npm create vite@7.5.0 . -- --template react-ts

# Install deps
npm install

# Add testing deps
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event

# Ensure test script exists
node -e "const fs=require('fs'); const p='package.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); j.scripts=j.scripts||{}; j.scripts.test=j.scripts.test||'vitest'; fs.writeFileSync(p, JSON.stringify(j,null,2));"
