set -e
node -v
npm -v
ls -la
find . -maxdepth 2 -type f -name package.json -print
find . -maxdepth 2 -type f -name vite.config.* -print
