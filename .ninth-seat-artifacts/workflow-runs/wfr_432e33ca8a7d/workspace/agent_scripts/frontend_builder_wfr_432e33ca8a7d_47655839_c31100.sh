set -e
# Scaffold Vite + React + TS in workspace root (calculator-app)
if [ ! -d calculator-app ]; then
  npm create vite@latest calculator-app -- --template react-ts
fi
cd calculator-app
npm install

# Testing + linting deps
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event eslint prettier eslint-config-prettier eslint-plugin-react-hooks eslint-plugin-react-refresh
