set -euo pipefail

# Clean any partial scaffold artifacts (keep workflow dirs)
rm -rf src public index.html vite.config.* tsconfig*.json package.json package-lock.json node_modules .gitignore .eslintrc* eslint.config.*

# Use a create-vite version that supports Node 20.16 (older than 8.3.0)
# (If this version is unavailable, the command will fail and we can try another.)
npx -y create-vite@7.5.0 . --template react-ts

# Verify scaffold
test -f package.json

npm install

# Add test tooling
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/testing-library__jest-dom
