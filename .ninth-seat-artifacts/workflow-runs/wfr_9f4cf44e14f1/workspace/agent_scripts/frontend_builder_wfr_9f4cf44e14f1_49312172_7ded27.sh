set -euo pipefail

# Create app in a subdir to avoid conflicts with existing workflow folders
rm -rf frontend
npm create vite@latest frontend -- --template react-ts

cd frontend
npm install

# Test tooling
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/testing-library__jest-dom

# Sanity check
npm run build
