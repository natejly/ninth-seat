set -euo pipefail
ls -la

# Clean any partial scaffold artifacts if present
rm -rf node_modules package.json package-lock.json vite.config.* tsconfig*.json index.html src public || true

# Use a create-vite version that supports Node 20.16 (avoid 8.3.0 which requires 20.19+)
npx create-vite@8.2.0 . -- --template react-ts

# Verify scaffold
test -f package.json

npm install

# Add test tooling
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/testing-library__jest-dom
