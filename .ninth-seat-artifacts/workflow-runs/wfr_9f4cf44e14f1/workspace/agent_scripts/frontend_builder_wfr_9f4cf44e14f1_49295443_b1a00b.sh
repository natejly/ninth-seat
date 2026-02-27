set -e
ls -la
# Use a create-vite version compatible with Node 20.16 (pre-8.x)
rm -rf .tmp node_modules package-lock.json pnpm-lock.yaml yarn.lock 2>/dev/null || true
npx create-vite@7.0.3 . -- --template react-ts
npm install

# Add test tooling
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/testing-library__jest-dom
