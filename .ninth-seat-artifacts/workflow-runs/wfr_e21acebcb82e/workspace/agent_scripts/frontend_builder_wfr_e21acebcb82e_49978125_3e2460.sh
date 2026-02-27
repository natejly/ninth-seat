set -e

# Clean any partial scaffold artifacts (keep inputs/deliverables/agent_scripts)
ls -la

# Use a create-vite version compatible with Node 20.16 (avoid v8.3.0 which requires >=20.19)
# Try v8.2.x first; if unavailable, fall back to v7.x.
if npx -y create-vite@8.2.0 --version >/dev/null 2>&1; then
  npx -y create-vite@8.2.0 . --template react-ts
else
  npx -y create-vite@7.0.0 . --template react-ts
fi

npm install

# Add testing deps
npm install -D vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event

# Ensure test script exists
node -e "const fs=require('fs'); const p='package.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); j.scripts=j.scripts||{}; j.scripts.test=j.scripts.test||'vitest'; fs.writeFileSync(p, JSON.stringify(j,null,2));"
