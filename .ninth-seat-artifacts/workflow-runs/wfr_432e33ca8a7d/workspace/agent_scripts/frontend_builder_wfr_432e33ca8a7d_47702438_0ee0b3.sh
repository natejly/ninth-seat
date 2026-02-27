set -e
cd calculator-app

# Ensure compatible Vite + plugin-react pairing (avoid peer resolution issues)
# Pin to a known compatible set.
npm pkg set devDependencies.vite='^7.3.1'
npm pkg set devDependencies.'@vitejs/plugin-react'='^5.1.4'

# Install with legacy peer deps to bypass strict resolution if registry metadata is inconsistent
npm install --legacy-peer-deps

# Install test deps
npm install -D --legacy-peer-deps vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
