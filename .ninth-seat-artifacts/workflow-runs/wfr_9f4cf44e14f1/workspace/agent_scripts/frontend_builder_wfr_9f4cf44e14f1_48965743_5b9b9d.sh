set -euo pipefail

# Clean any partial scaffold artifacts (keep workflow folders)
find . -maxdepth 1 -mindepth 1 \
  ! -name 'agent_scripts' \
  ! -name 'deliverables' \
  ! -name 'inputs' \
  ! -name 'user_uploads' \
  -exec rm -rf {} +

# Use a create-vite version that supports Node 20.16.x (avoid 8.x engine requirement)
# Vite 5.x era create-vite should be compatible with Node 18+/20+
npx -y create-vite@5.5.2 . --template react-ts

npm install

# Add test tooling
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/testing-library__jest-dom

# Sanity check
node -v
npm -v
ls -ლა
cat package.json | head
