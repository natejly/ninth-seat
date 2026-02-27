set -e

# Scaffold into a dedicated folder to avoid conflicts with existing workflow directories
rm -rf frontend
npm create vite@latest frontend -- --template react-ts

cd frontend
npm install

# Testing deps
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event

# Ensure test script exists
node -e "const fs=require('fs'); const p='package.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); j.scripts=j.scripts||{}; j.scripts.test=j.scripts.test||'vitest'; fs.writeFileSync(p, JSON.stringify(j,null,2));"
