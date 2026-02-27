set -e
# Work around create-vite engine requirement by pinning to a compatible version and scaffolding into a subdir
rm -rf web
npx create-vite@5.5.2 web -- --template react-ts
cd web
npm install
# Add test tooling
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/testing-library__jest-dom
