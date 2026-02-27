set -euo pipefail
ls -la

# Clean any partial scaffold artifacts (keep workflow dirs)
rm -rf src public index.html vite.config.* tsconfig.* package.json package-lock.json node_modules .gitignore .eslintrc* .prettierrc* || true

# Use a create-vite version that supports Node 20.16 (avoid 8.x engine requirement)
# Pin to a known older major.
npx -y create-vite@5.2.3 . --template react-ts

# Verify scaffold
test -f package.json
node -v

npm install

# Add test tooling
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/testing-library__jest-dom
