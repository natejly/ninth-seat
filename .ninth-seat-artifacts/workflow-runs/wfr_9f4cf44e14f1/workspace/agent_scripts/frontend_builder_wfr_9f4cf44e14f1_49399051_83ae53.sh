set -e
ls -la
# Use a create-vite version that supports Node 20.16.x
npm create vite@7.5.0 . -- --template react-ts
npm install
# Add test tooling
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/testing-library__jest-dom
