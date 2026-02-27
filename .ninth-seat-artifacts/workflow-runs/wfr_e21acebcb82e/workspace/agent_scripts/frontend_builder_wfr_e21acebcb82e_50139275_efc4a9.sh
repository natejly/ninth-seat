set -e

# Clean any partial scaffold artifacts if present
rm -rf node_modules package.json package-lock.json vite.config.* tsconfig*.json index.html src public || true

# Use a create-vite version compatible with Node 20.16 (avoid latest which requires 20.19+)
# Pin to a known older major.
npm create vite@7.0.0 . -- --template react-ts

npm install
