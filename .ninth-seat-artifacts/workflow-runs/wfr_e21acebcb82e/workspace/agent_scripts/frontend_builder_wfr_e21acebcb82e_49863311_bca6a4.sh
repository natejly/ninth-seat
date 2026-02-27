set -e

# Clean any partial scaffold artifacts (keep workflow folders)
rm -rf node_modules package.json package-lock.json vite.config.* tsconfig*.json index.html src public .gitignore

# Use a create-vite version compatible with Node 20.16 (avoid v8 which requires >=20.19)
# v7.x supports Node 18+/20 without the 20.19 floor.
npm create vite@7.5.0 . -- --template react-ts

npm install

# Testing deps
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event

# Ensure test script exists
node -e "const fs=require('fs'); const p='package.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); j.scripts=j.scripts||{}; j.scripts.test=j.scripts.test||'vitest'; fs.writeFileSync(p, JSON.stringify(j,null,2));"
