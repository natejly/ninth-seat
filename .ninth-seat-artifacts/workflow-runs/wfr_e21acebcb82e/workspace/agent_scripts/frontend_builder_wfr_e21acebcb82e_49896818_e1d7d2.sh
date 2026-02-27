set -e

# Clean any partial scaffold artifacts (keep inputs/deliverables)
rm -rf node_modules package.json package-lock.json vite.config.* tsconfig*.json index.html src public .gitignore .eslint* .prettier* || true

# Use a Node-20.16 compatible create-vite version
npm create vite@7.0.0 . -- --template react-ts

npm install

npm install -D vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event

node -e "const fs=require('fs'); const p='package.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); j.scripts=j.scripts||{}; j.scripts.test='vitest'; fs.writeFileSync(p, JSON.stringify(j,null,2));"
