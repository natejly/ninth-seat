set -euo pipefail

# Clean any partial scaffold artifacts (keep inputs/deliverables/agent_scripts)
find . -maxdepth 1 -mindepth 1 -not -name inputs -not -name deliverables -not -name agent_scripts -not -name user_uploads -exec rm -rf {} +

# Use a create-vite version that supports Node 20.16.x (avoid 8.x which requires 20.19+)
# Vite 5.x era create-vite should be compatible.
npx -y create-vite@5.2.3 . --template react-ts

# Install runtime deps
npm install

# Add test tooling
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/testing-library__jest-dom

# Sanity check
node -v
npm -v
test -f package.json && echo "package.json present" && cat package.json | head -n 20
