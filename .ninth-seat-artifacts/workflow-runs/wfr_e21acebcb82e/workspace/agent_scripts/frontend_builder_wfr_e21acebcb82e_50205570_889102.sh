set -euo pipefail

# Clean any partial scaffold artifacts (keep workflow dirs)
ls -la

# Use a create-vite version that supports Node 20.16.x (avoid 8.x engine requirement)
# If this version is unavailable, the command will fail and we can fall back next turn.
npm create vite@7.0.0 . -- --template react-ts

# Install deps
npm install

# Add testing deps
npm install -D vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event

# Ensure test script exists
node -e "const fs=require('fs'); const p='package.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); j.scripts=j.scripts||{}; j.scripts.test=j.scripts.test||'vitest'; fs.writeFileSync(p, JSON.stringify(j,null,2));"

# Sanity check
node -p "require('fs').existsSync('package.json') ? 'package.json OK' : 'package.json MISSING'"