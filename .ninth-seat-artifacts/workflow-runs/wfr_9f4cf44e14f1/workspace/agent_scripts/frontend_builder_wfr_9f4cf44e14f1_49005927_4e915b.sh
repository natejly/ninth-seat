set -euo pipefail

# Clean any partial scaffold artifacts if present
rm -rf frontend

# Scaffold into a subdir to avoid '.' issues
npm create vite@latest frontend -- --template react-ts

cd frontend
npm install

# Add test tooling
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/testing-library__jest-dom
