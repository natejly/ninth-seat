set -e
ls -la

# Look for likely upstream handoff docs
find inputs deliverables -maxdepth 4 -type f \( -iname '*.md' -o -iname '*.json' -o -iname '*.txt' \) 2>/dev/null | sed 's|^\./||'

# Check for any frontend scaffold
find . -maxdepth 3 -type f \( -iname 'package.json' -o -iname 'vite.config.*' -o -iname 'index.html' -o -iname 'next.config.*' -o -iname 'src/main.*' -o -iname 'src/App.*' \) | sed 's|^\./||'

# Quick peek at top-level dirs
find . -maxdepth 2 -type d | sed 's|^\./||'
