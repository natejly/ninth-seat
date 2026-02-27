set -euo pipefail
ls -la

# Clean any partial scaffold artifacts (keep inputs/deliverables/agent_scripts)
rm -rf src public index.html vite.config.* tsconfig*.json package.json package-lock.json node_modules .gitignore .eslint* .prettier* || true

# Use a create-vite version compatible with Node 20.16
npx -y create-vite@7.0.3 . --template react-ts

# Install runtime deps
npm install

# Add test tooling
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/testing-library__jest-dom

# Show key files
ls -la
cat package.json
