set -euo pipefail

# Clean any partial scaffold artifacts (keep workflow dirs)
rm -rf src public index.html vite.config.* tsconfig*.json package.json package-lock.json node_modules .gitignore .eslintrc* eslint.config.*

# Use a create-vite version that supports Node 20.16 (avoid v8 which requires 20.19+)
# v7.x is expected to be compatible with Node 20.16
npx -y create-vite@7.4.0 . --template react-ts

test -f package.json
npm install

# Add test tooling
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/testing-library__jest-dom

# Quick sanity
node -v
npm -v
npm run build --silent
