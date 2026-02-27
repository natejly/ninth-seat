set -e

# Use a create-vite version compatible with Node 20.16 (avoid v8 which requires >=20.19)
# If this fails, we can fall back to an older Vite template or manual scaffold.
npm create vite@7 . -- --template react-ts

# Verify scaffold
test -f package.json

# Install deps
npm install

# Add testing deps
npm install -D vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event

# Ensure test script exists
node -e "const fs=require('fs'); const p='package.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); j.scripts=j.scripts||{}; j.scripts.test=j.scripts.test||'vitest'; fs.writeFileSync(p, JSON.stringify(j,null,2));"
