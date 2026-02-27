set -e
ls -la
# Clean any partial scaffold artifacts (keep inputs/deliverables/agent_scripts)
find . -maxdepth 1 -mindepth 1 -not -name inputs -not -name deliverables -not -name agent_scripts -not -name user_uploads -exec rm -rf {} +

# Use a Node-20.16 compatible create-vite version
npm create vite@7.0.0 . -- --template react-ts

npm install

# Add test tooling
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/testing-library__jest-dom
