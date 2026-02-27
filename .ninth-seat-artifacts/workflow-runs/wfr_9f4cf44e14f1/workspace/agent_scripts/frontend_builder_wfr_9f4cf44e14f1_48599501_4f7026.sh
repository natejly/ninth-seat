set -e
ls -la

# Scaffold into a subdirectory to avoid issues with non-empty root
rm -rf frontend
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install

# Add test tooling
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/testing-library__jest-dom
