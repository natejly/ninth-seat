set -e
cd calculator-app

# Show current deps for debugging
cat package.json

# Pin to a known-compatible pair (Vite 7 + plugin-react 5.1.x)
node - <<'NODE'
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json','utf8'));
pkg.devDependencies = pkg.devDependencies || {};
// Ensure both are explicitly set
pkg.devDependencies['vite'] = '^7.0.0';
pkg.devDependencies['@vitejs/plugin-react'] = '^5.1.4';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));
NODE

# Clean and reinstall
rm -rf node_modules package-lock.json
npm install

# Install test deps (if not already installed due to prior failure)
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event eslint prettier eslint-config-prettier eslint-plugin-react-hooks eslint-plugin-react-refresh
