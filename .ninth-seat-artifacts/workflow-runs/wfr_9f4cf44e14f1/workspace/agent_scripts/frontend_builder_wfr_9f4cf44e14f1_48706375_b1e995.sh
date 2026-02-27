set -e
ls -la

# Create a dedicated frontend directory to avoid create-vite issues in non-empty workspace
mkdir -p frontend
cd frontend

# Use a create-vite version compatible with Node 20.16 (avoid engine mismatch)
# create-vite@7 supports Node 18+/20 without requiring 20.19+
npm create vite@7 . -- --template react-ts

npm install

# Add test tooling
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/testing-library__jest-dom
