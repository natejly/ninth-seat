set -e
ls -la
# Scaffold Vite React+TS into the current workspace root
npm create vite@latest . -- --template react-ts
npm install

# Add test tooling
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/testing-library__jest-dom
