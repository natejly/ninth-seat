set -e

# Clean any partial scaffold artifacts (keep inputs/deliverables)
# (No package.json exists yet per prior error)

# Use a create-vite version that supports Node 20.16 (older than 8.3.0)
# Pin to a known compatible major (5.x/6.x era) to avoid engine restriction.
npm create vite@6.0.0 . -- --template react-ts

npm install

# Add testing deps
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event

# Ensure test script exists
node -e "const fs=require('fs'); const p='package.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); j.scripts=j.scripts||{}; j.scripts.test=j.scripts.test||'vitest'; fs.writeFileSync(p, JSON.stringify(j,null,2));"
