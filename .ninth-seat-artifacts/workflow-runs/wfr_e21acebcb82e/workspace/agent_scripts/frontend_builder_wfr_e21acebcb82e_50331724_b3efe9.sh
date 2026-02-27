set -e

# Clean any partial scaffold artifacts if present
rm -f package.json package-lock.json vite.config.* tsconfig*.json index.html || true
rm -rf src public node_modules || true

# Use a create-vite version that supports Node 20.16 (older than 8.3.0)
# If this version is unavailable, the command will fail and we can fall back to manual scaffold.
npm create vite@7.0.0 . -- --template react-ts

npm install

npm install -D vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event

node -e "const fs=require('fs'); const p='package.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); j.scripts=j.scripts||{}; j.scripts.test='vitest'; fs.writeFileSync(p, JSON.stringify(j,null,2));"
