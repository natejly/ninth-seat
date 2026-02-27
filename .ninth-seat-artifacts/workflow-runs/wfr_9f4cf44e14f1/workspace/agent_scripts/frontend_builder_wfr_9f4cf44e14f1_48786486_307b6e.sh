set -e
ls -la

# Create in subdir to avoid partial state in workspace root
rm -rf frontend

# Use a create-vite version that supports Node 20.16 (avoid 8.x engine requirement)
npx create-vite@7.0.3 frontend -- --template react-ts

cd frontend
npm install

# Add test tooling
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/testing-library__jest-dom

# Show resulting structure
ls -la
