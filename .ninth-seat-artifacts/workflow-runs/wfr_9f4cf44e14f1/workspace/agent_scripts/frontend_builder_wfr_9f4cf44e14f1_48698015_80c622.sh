set -e
ls -la
# Clean any partial scaffold artifacts (keep inputs/deliverables/agent_scripts)
rm -rf src public index.html vite.config.* tsconfig*.json package.json package-lock.json node_modules

# Use a create-vite version compatible with Node 20.16 (avoid 8.x engine requirement)
# Pin to create-vite@7 (Vite 5 era) which supports Node 18/20.
npx -y create-vite@7.0.3 . --template react-ts

npm install

# Add test tooling
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/testing-library__jest-dom

# Show key files
ls -la package.json src || true
