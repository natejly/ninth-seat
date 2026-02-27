set -e
pwd
ls -la
find . -maxdepth 4 -type f \( -iname 'API_CONTRACTS.md' -o -iname 'ARCHITECTURE.md' -o -iname 'DATA_MODEL.md' \) -print
