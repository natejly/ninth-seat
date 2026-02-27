set -euo pipefail

# Clean any partial scaffold artifacts (keep workflow folders)
rm -rf src public index.html vite.config.* tsconfig*.json package.json package-lock.json node_modules .gitignore .eslintrc* eslint.config.*

# Use a create-vite version that supports Node 20.16.x (older than 8.3.0)
# (If this fails, we can fall back to manual minimal Vite config.)
npx -y create-vite@7.5.0 . --template react-ts

npm install

# Add test tooling
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/testing-library__jest-dom

# Sanity check
node -p "require('./package.json').name" && ls -ლა package.json
