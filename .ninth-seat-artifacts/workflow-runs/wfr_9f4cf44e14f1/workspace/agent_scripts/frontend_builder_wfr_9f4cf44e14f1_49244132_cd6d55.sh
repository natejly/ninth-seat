set -e
ls -la

# Create app in a subdir to avoid create-vite refusing a non-empty directory
rm -rf frontend
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install

# Add test tooling
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/testing-library__jest-dom

# Quick sanity check
node -v
npm -v
npm run build --silent
