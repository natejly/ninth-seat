set -e

# Clean any partial scaffold artifacts if present
rm -rf node_modules package.json package-lock.json vite.config.* tsconfig*.json index.html src public || true

# Use a create-vite version compatible with Node 20.16.x (avoid v8.3.0 engine requirement)
# Try a known older version first; if it fails, fall back to latest.
if npx -y create-vite@8.1.0 . --template react-ts; then
  echo "Scaffolded with create-vite@8.1.0"
else
  echo "Fallback to create-vite@latest"
  npx -y create-vite@latest . --template react-ts
fi

npm install

# Testing deps
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @vitejs/plugin-react

# Ensure test script exists
node -e "const fs=require('fs'); const p='package.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); j.scripts=j.scripts||{}; j.scripts.test=j.scripts.test||'vitest'; fs.writeFileSync(p, JSON.stringify(j,null,2));"
