set -euo pipefail

# Clean any partial scaffold artifacts (keep workflow folders)
shopt -s dotglob
for p in * .*; do
  case "$p" in
    .|..|inputs|deliverables|agent_scripts|user_uploads|.npm|.npmrc) ;;
    *) rm -rf "$p" ;;
  esac
done

# Use a create-vite version that works with Node 20.16 (pin older)
# (create-vite@7.x supports Node 18+/20 without the 20.19+ requirement)
npm create vite@7.0.0 . -- --template react-ts

test -f package.json

npm install

npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @vitest/ui

node -e "const fs=require('fs'); const p='package.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); j.scripts=j.scripts||{}; j.scripts.test=j.scripts.test||'vitest'; fs.writeFileSync(p, JSON.stringify(j,null,2));"
