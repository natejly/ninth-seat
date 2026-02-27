set -e
cd calculator-app

# Clean any partial install
rm -rf node_modules package-lock.json

# Pin to a known-compatible set for Node 20.16 and plugin peer ranges
npm pkg set devDependencies.vite='^7.0.0'
npm pkg set devDependencies.'@vitejs/plugin-react'='^5.1.4'

# Install with npm; if peer resolution still complains, fall back to legacy-peer-deps
npm install || npm install --legacy-peer-deps

# Add test deps (may already be present; ensure installed)
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event || npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event --legacy-peer-deps
