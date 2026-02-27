set -e

# Create frontend app in subdir to avoid clobbering existing workflow folders
mkdir -p frontend

# Use a create-vite version that supports Node 20.16 (avoid 8.x which requires 20.19+)
cd frontend
npm create vite@7.0.0 . -- --template react-ts

npm install

# Testing deps
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event

# Add test script if missing
node -e "const fs=require('fs'); const p='package.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); j.scripts=j.scripts||{}; j.scripts.test=j.scripts.test||'vitest'; fs.writeFileSync(p, JSON.stringify(j,null,2));"
