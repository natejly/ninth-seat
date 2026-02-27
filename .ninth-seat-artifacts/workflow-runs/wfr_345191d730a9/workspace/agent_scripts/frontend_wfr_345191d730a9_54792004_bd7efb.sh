set -e
ls -la

# Find likely docs anywhere in repo
find . -maxdepth 6 -type f \( \
  -iname 'architecture.md' -o -iname 'api_contracts.md' -o -iname 'data_model.md' -o \
  -iname '*architecture*' -o -iname '*api*contract*' -o -iname '*data*model*' -o \
  -iname 'README.md' \
\) | sed 's|^\./||'
