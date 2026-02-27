set -e
ls -la
# Use an older create-vite that supports Node 20.16
npm create vite@7.0.0 . -- --template react-ts

npm install

# Add test tooling
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/testing-library__jest-dom
