set -e
# Scaffold into a subdir to avoid '.' edge cases
rm -rf frontend
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
# Test tooling
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/testing-library__jest-dom
