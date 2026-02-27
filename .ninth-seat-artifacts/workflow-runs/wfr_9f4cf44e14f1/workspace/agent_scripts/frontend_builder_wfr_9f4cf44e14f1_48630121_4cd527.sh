set -e
ls -la

# Scaffold into a subdir to avoid partial/failed in-place scaffolding
rm -rf frontend

# Use a create-vite version compatible with Node 20.16.x
npm create vite@7.5.0 frontend -- --template react-ts
cd frontend
npm install

# Add test tooling
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/testing-library__jest-dom
