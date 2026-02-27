set -euo pipefail
ls -la

# Clean any partial scaffold artifacts (keep workflow folders)
rm -rf src public index.html vite.config.* tsconfig*.json package.json package-lock.json node_modules

# Use a create-vite version that supports Node 20.16.x
npx -y create-vite@7.0.3 . --template react-ts

npm install

# Add test tooling
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/testing-library__jest-dom

# Show key files
ls -la package.json src vite.config.* || true
