set -e
ls -la

# Clean any partial scaffold artifacts (keep workflow dirs)
rm -rf src public index.html vite.config.* tsconfig*.json package*.json node_modules .gitignore .eslintrc* eslint.config.*

# Use a create-vite version compatible with Node 20.16
npx -y create-vite@7.0.3 . --template react-ts

npm install

# Add test tooling
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/testing-library__jest-dom
