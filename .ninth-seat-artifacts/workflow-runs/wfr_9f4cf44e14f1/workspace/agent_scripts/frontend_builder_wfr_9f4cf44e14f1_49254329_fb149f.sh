set -euo pipefail
node -v
npm -v

# Clean any partial scaffold artifacts (keep workflow dirs)
rm -rf src public index.html vite.config.* tsconfig*.json package.json package-lock.json node_modules .gitignore .eslintrc* eslint.config.*

# Use a create-vite version that supports Node 20.16 (older than 8.x)
# (create-vite 7.x aligns with Vite 5.x which supports Node 18+ / 20+)
npx -y create-vite@7.0.3 . --template react-ts

npm install

# Add test tooling
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/testing-library__jest-dom
