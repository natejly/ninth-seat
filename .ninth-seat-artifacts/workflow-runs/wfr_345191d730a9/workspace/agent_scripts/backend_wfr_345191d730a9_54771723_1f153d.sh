set -e
cd backend
npm install
node src/server.js &
SERVER_PID=$!
# wait for server
for i in {1..20}; do
  if curl -sSf http://localhost:3001/healthz >/dev/null; then break; fi
  sleep 0.2
done
curl -sSf http://localhost:3001/healthz
curl -sSf http://localhost:3001/api/history
curl -sSf -X POST http://localhost:3001/api/history -H 'Content-Type: application/json' -d '{"expression":"1+2","result":"3"}'
curl -sSf http://localhost:3001/api/history
kill $SERVER_PID
wait $SERVER_PID 2>/dev/null || true
