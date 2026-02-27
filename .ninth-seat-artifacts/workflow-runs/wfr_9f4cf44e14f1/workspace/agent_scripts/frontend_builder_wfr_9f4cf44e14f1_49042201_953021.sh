set -e
ls -la
# Clean any partial scaffold artifacts (keep inputs/deliverables/agent_scripts)
rm -rf src public index.html vite.config.* tsconfig*.json package*.json node_modules .gitignore .eslintrc* .prettierrc* .vscode

# Use a create-vite version that supports Node 20.16 (older than 8.x)
npx -y create-vite@7.0.3 . --template react-ts

npm install
