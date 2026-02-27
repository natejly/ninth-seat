set -e

# Clean any partial scaffold artifacts if present
rm -rf node_modules package-lock.json pnpm-lock.yaml yarn.lock dist build .vite

# Use a create-vite version compatible with Node 20.16 (Vite 5 era)
npm create vite@5 . -- --template react-ts

npm install

# Add testing deps
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event

# Ensure test script exists
node -e "const fs=require('fs'); const p='package.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); j.scripts=j.scripts||{}; j.scripts.test=j.scripts.test||'vitest'; fs.writeFileSync(p, JSON.stringify(j,null,2));"
