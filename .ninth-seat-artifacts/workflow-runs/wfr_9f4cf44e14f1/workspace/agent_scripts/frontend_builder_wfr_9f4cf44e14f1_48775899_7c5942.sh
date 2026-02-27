set -euo pipefail

# Create Vite app in a subdir to avoid scaffolding issues into '.'
rm -rf web
npm create vite@latest web -- --template react-ts

cd web
npm install

# Add test tooling
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/testing-library__jest-dom

# Sanity check
node -p "require('./package.json').name" && ls -la
