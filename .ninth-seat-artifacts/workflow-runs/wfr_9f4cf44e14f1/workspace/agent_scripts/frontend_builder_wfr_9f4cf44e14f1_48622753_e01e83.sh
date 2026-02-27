set -e
ls -la
# Clean any partial scaffold artifacts if present
rm -rf node_modules package.json package-lock.json vite.config.* tsconfig*.json index.html src public

# Use an older create-vite that supports Node 20.16
npx -y create-vite@7.0.3 . --template react-ts
npm install

# Add test tooling
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/testing-library__jest-dom
