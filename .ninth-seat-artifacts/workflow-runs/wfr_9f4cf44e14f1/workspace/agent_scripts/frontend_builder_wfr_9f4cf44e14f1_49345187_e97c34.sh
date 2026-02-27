set -euo pipefail

# Clean any partial scaffold artifacts (keep workflow dirs)
mkdir -p frontend

# Use a create-vite version that works with Node 20.16 (avoid 8.x engine requirement)
cd frontend
npm create vite@7.5.0 . -- --template react-ts
npm install

# Add test tooling
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/testing-library__jest-dom
