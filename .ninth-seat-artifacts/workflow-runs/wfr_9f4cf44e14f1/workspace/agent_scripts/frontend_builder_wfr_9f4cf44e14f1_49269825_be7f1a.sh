set -euo pipefail
ls -la

# Create app in subdir to avoid issues scaffolding into '.'
rm -rf web

# Use a create-vite version that doesn't require Node 20.19+
npm create vite@7.0.0 web -- --template react-ts
cd web
npm install

# Add test tooling
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/testing-library__jest-dom

# Show key files
ls -la
cat package.json
