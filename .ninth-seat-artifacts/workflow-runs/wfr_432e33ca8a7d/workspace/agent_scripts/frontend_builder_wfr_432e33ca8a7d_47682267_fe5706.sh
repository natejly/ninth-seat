set -e
cd calculator-app
# Pin compatible Vite + React plugin versions, then reinstall cleanly
npm pkg set devDependencies.vite='^7.0.0'
npm pkg set devDependencies.'@vitejs/plugin-react'='^5.1.4'
rm -rf node_modules package-lock.json
npm install
