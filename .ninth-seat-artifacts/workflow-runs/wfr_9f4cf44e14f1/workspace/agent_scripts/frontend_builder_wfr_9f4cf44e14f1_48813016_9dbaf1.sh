set -euo pipefail

# Clean any partial scaffold artifacts (keep inputs/deliverables/agent_scripts)
find . -maxdepth 1 -mindepth 1 -not -name inputs -not -name deliverables -not -name agent_scripts -not -name user_uploads -exec rm -rf {} +

# Use a create-vite version compatible with Node 20.16 (avoid 8.x which requires 20.19+)
# create-vite@7.x should work with Node 18+/20.x
npm create vite@7.0.0 . -- --template react-ts

# Verify scaffold
test -f package.json

npm install

# Add test tooling
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/testing-library__jest-dom
