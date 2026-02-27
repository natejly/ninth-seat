set -euo pipefail
ls -la
# Clean any partial scaffold artifacts (keep inputs/deliverables/agent_scripts)
rm -rf src public index.html vite.config.* tsconfig*.json package.json package-lock.json node_modules .gitignore .eslintrc* .prettierrc* || true

# Use a create-vite version compatible with Node 20.16 (avoid v8 which requires 20.19+)
# create-vite@7.x should be compatible with Node 18+/20+
npx -y create-vite@7.0.3 . --template react-ts

# Install deps
npm install

# Add test tooling
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/testing-library__jest-dom

# Sanity check
node -v
npm -v
test -f package.json && echo "OK: package.json present"