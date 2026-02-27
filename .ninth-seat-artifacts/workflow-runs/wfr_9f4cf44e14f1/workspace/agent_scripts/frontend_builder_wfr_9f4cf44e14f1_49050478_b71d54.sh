set -e
ls -la

# Scaffold into a subdir to avoid issues with '.' scaffolding in this runtime
rm -rf frontend
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install

# Add test tooling
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/testing-library__jest-dom
