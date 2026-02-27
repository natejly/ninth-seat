set -e

# Clean any partial scaffold artifacts (keep inputs/deliverables/agent_scripts)
find . -maxdepth 1 -mindepth 1 \
  ! -name inputs \
  ! -name deliverables \
  ! -name agent_scripts \
  ! -name user_uploads \
  -exec rm -rf {} +

# Use a Node-20.16 compatible create-vite version
npm create vite@7.0.0 . -- --template react-ts

npm install

# Add testing deps
npm install -D vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event

# Ensure test script exists
node -e "const fs=require('fs'); const p='package.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); j.scripts=j.scripts||{}; j.scripts.test=j.scripts.test||'vitest'; fs.writeFileSync(p, JSON.stringify(j,null,2));"
