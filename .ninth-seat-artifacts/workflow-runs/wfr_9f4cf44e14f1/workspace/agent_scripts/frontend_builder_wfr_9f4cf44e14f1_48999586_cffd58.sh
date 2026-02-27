set -e
pwd
ls -la
find . -maxdepth 2 -type f -name package.json -o -name index.html -o -name vite.config.* | sed 's|^./||'
find . -maxdepth 2 -type d -name src -o -name public -o -name node_modules | sed 's|^./||'
ls -la .tmp || true
