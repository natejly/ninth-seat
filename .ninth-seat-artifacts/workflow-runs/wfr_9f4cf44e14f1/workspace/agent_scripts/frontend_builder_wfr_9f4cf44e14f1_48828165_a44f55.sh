set -e
rm -rf frontend
# Use a create-vite version compatible with Node 20.16.x to avoid engine mismatch issues
npm create vite@7.5.0 frontend -- --template react-ts
cd frontend
npm install
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/testing-library__jest-dom
