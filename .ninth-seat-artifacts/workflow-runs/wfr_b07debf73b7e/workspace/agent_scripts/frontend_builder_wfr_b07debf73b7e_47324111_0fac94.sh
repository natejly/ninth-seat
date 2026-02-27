set -euo pipefail

# Scaffold Vite React+TS project in ./calculator (idempotent-ish)
if [ ! -d "calculator" ]; then
  npm create vite@latest calculator -- --template react-ts
fi

cd calculator

# Install deps if needed
if [ ! -d "node_modules" ]; then
  npm install
fi

# Add testing deps
npm install -D vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event

# Ensure a basic test script exists
node -e "const fs=require('fs'); const p='package.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); j.scripts=j.scripts||{}; j.scripts.test=j.scripts.test||'vitest'; fs.writeFileSync(p, JSON.stringify(j,null,2));"

node -p "'node '+process.version"
./node_modules/.bin/vite --version
./node_modules/.bin/vitest --version
