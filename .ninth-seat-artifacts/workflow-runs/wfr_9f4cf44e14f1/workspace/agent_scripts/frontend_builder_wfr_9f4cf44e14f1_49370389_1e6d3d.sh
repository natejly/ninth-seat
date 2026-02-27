set -euo pipefail

# Create Vite app in a subdir to avoid non-empty '.' issues
rm -rf frontend
npm create vite@latest frontend -- --template react-ts

cd frontend
npm install

# Test tooling
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/testing-library__jest-dom

# Sanity: show package.json exists
node -p "require('./package.json').name"