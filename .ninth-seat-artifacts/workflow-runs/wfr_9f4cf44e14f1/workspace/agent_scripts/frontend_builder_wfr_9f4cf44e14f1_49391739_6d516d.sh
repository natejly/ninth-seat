set -e
ls -la
# Clean any partial scaffold artifacts (keep inputs/deliverables/agent_scripts)
find . -maxdepth 1 -mindepth 1 -not -name inputs -not -name deliverables -not -name agent_scripts -not -name user_uploads -exec rm -rf {} +

# Use a create-vite version compatible with Node 20.16 (older than 8.3.0)
# Pin to a known-working major (5.x) to avoid Node >=20.19 requirement.
npx -y create-vite@5.5.2 . --template react-ts

npm install

# Add test tooling
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/testing-library__jest-dom
