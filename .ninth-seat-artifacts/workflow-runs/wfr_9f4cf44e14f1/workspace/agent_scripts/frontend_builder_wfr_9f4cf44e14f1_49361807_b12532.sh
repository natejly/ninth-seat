set -euo pipefail

# Use a create-vite version compatible with Node 20.16 (avoid v8 engine requirement)
# Scaffold into a subdir to avoid clobbering workspace root
rm -rf frontend
npm create vite@7.0.0 frontend -- --template react-ts

cd frontend
npm install

# Add test tooling
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/testing-library__jest-dom

# Quick sanity check
node -v
npm -v
ls -la
