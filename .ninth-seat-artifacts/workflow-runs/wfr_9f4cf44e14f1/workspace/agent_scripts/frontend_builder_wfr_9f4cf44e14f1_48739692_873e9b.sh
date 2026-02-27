set -e
node -v
npm -v

# Clean any partial scaffold artifacts (keep inputs/deliverables/agent_scripts)
find . -maxdepth 1 -mindepth 1 -not -name inputs -not -name deliverables -not -name agent_scripts -not -name user_uploads -exec rm -rf {} +

# Use a create-vite version that supports Node 20.16 (pin to an earlier release)
# If this version is unavailable, the command will fail and we can try another pin.
npm create vite@7.0.0 . -- --template react-ts

# Install runtime deps
npm install

# Add test tooling
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/testing-library__jest-dom

# Show key files
ls -la
cat package.json
