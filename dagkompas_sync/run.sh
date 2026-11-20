#!/bin/sh
# Start de sync-server met het token uit de add-on-instellingen.
# Alle gegevens staan in /share/dagkompas (via Samba te zien als \\homeassistant\share\dagkompas).

OPTIES="${OPTIES:-/data/options.json}"
export DATA_DIR="${DATA_DIR:-/share/dagkompas}"
export SYNC_PORT="${SYNC_PORT:-8092}"

if ! command -v node >/dev/null 2>&1; then
    echo "FOUT: Node.js ontbreekt in deze add-on. Bouw de add-on opnieuw (Opnieuw opbouwen)."
    exit 1
fi
echo "Node.js $(node --version)"

SYNC_TOKEN="$(node -e "try { process.stdout.write(String(require('$OPTIES').token || '')) } catch (e) {}")"
export SYNC_TOKEN
AGENDA_URL="$(node -e "try { process.stdout.write(String(require('$OPTIES').agenda_url || '')) } catch (e) {}")"
export AGENDA_URL
AGENDA_URL_2="$(node -e "try { process.stdout.write(String(require('$OPTIES').agenda_url_2 || '')) } catch (e) {}")"
export AGENDA_URL_2

if [ -z "$SYNC_TOKEN" ]; then
    echo "Geen token ingesteld. Vul op het tabblad 'Configuratie' een lang, willekeurig token in, en start de add-on opnieuw."
    exit 1
fi
if [ "${#SYNC_TOKEN}" -lt 16 ]; then
    echo "Let op: het token is korter dan 16 tekens. Gebruik liever een lang, willekeurig token."
fi

mkdir -p "$DATA_DIR"
echo "Gegevensmap: $DATA_DIR"
exec node /app/server.js
