set -e
node -v
npm -v

# Clean any partial scaffold artifacts (keep inputs/deliverables)
rm -rf src public index.html vite.config.* tsconfig*.json package.json package-lock.json node_modules .gitignore .vscode

# Use an older create-vite that supports Node 20.16
npx -y create-vite@7.0.3 . --template react-ts

# Install dependencies
npm install

# Add test tooling
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/testing-library__jest-dom

# Show resulting package.json exists
ls -la package.json
