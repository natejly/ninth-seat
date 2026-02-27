set -e

# List candidate handoff docs
find inputs deliverables -type f \( -iname '*.md' -o -iname '*.json' -o -iname '*.txt' \) 2>/dev/null | sed 's|^\./||' | sort

echo '---'

# Preview first ~80 lines of each markdown doc (if any)
for f in $(find inputs deliverables -type f -iname '*.md' 2>/dev/null | sort); do
  echo "### $f"
  sed -n '1,80p' "$f" || true
  echo
done
