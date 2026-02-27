set -euo pipefail
ls -la

# Clean any partial scaffold artifacts (keep workflow dirs)
rm -rf src public index.html vite.config.* tsconfig*.json package.json package-lock.json node_modules .gitignore .eslintrc* .prettierrc* || true

# Use a create-vite version that supports Node 20.16 (older than 8.3.0)
# (If this fails, we can fall back to a manual minimal Vite template.)
npm create vite@7.0.0 . -- --template react-ts

# Install deps
npm install

# Add test tooling
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/testing-library__jest-dom

# Verify scaffold
node -v
npm -v
test -f package.json && echo "package.json present" && cat package.json | head
