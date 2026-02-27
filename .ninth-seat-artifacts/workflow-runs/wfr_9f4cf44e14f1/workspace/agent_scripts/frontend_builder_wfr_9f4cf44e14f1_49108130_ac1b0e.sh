set -e
ls -la
# Use a create-vite version that doesn't require Node 20.19+
rm -rf .tmp || true
npx -y create-vite@7.0.0 . --template react-ts
npm install
# Add test tooling
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/testing-library__jest-dom
