set -e
ls -la
# Clean any partial temp artifacts (keep inputs/deliverables)
rm -rf .tmp node_modules package-lock.json pnpm-lock.yaml yarn.lock || true

# Use an older create-vite that supports Node 20.16
npm create vite@latest . -- --template react-ts --packageManager npm --yes || true

# If latest still fails due to engine, pin create-vite explicitly
if [ ! -f package.json ]; then
  npx -y create-vite@7.0.0 . --template react-ts
fi

npm install

# Add test tooling
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/testing-library__jest-dom
