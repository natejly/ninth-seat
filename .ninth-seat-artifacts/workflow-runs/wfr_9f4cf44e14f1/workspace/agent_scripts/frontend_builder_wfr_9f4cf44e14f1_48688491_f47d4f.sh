set -e
ls -la

# Create a dedicated frontend directory to avoid create-vite failing in a non-empty workspace root
mkdir -p frontend

# Scaffold Vite React+TS into ./frontend
npm create vite@latest frontend -- --template react-ts

cd frontend
npm install

# Add test tooling
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/testing-library__jest-dom
