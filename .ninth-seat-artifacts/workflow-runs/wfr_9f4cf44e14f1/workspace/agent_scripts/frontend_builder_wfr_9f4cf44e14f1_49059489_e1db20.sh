set -e
ls -la

# Create a dedicated frontend directory to avoid scaffolding into a non-empty workflow workspace root
mkdir -p frontend
cd frontend

# Use a Vite/create-vite version compatible with Node 20.16.x
npm create vite@6 . -- --template react-ts

npm install

# Add test tooling
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/testing-library__jest-dom
