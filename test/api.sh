#!/bin/bash
# Start de server tijdelijk en controleert de belangrijkste functies.
set -e
cd "$(dirname "$0")/.."
TMP=$(mktemp -d)
export SYNC_TOKEN="testtoken-1234567890" DATA_DIR="$TMP" SYNC_PORT=18092
node dagkompas_sync/server.js > "$TMP/log" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null; rm -rf "$TMP"' EXIT
sleep 1
U=http://127.0.0.1:18092
A="Authorization: Bearer $SYNC_TOKEN"
fout() { echo "FOUT: $1"; cat "$TMP/log"; exit 1; }
curl -sf $U/api/status | grep -q '"ok":true' || fout status
[ "$(curl -s -o /dev/null -w '%{http_code}' $U/api/items)" = 401 ] || fout "zonder token moet 401 zijn"
curl -sf -X PUT -H "$A" -H 'Content-Type: application/json' -d '{"data":{"kind":"task","title":"Test"}}' $U/api/items/t_1 | grep -q '"seq":1' || fout put
curl -sf -X PUT -H "$A" -d '{"data":{"kind":"task","title":"Test"}}' $U/api/items/t_1 | grep -q '"seq":1' || fout "zelfde inhoud mag geen nieuw volgnummer geven"
curl -sf -X PUT -H "$A" -d '{"data":{"kind":"task","title":"Twee"}}' $U/api/items/t_2 | grep -q '"seq":2' || fout put2
curl -sf -H "$A" "$U/api/items?since=1" | grep -q '"id":"t_2"' || fout since
curl -sf -H "$A" "$U/api/items?since=1" | grep -q '"t_1"' && fout "since gaf te veel"
curl -sf -X DELETE -H "$A" $U/api/items/t_1 | grep -q '"seq":3' || fout delete
curl -sf -H "$A" "$U/api/items?since=2" | grep -q '"id":"t_1","seq":3,"data":null' || fout "verwijdering niet doorgegeven"
[ "$(curl -s -o /dev/null -w '%{http_code}' -X PUT -H "$A" -d '[1]' $U/api/items/t_3)" = 400 ] || fout "array moet 400 zijn"
[ "$(curl -s -o /dev/null -w '%{http_code}' -X PUT -H "$A" -d '{"data":{}}' "$U/api/items/a%2Fb")" = 400 ] || fout "ongeldige id"
ls "$TMP/backups" | grep -q dagkompas- || fout backup
echo "Alle API-tests geslaagd."
