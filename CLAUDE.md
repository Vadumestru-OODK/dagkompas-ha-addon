# Home Assistant-add-on Dagkompas Sync

Privé project van Bjorn Luijten, los van Opticien op de Koffie. Deze repository is openbaar:
Home Assistant haalt de add-on hier vandaan. Zet er nooit tokens, wachtwoorden of persoonlijke gegevens in.

- `dagkompas_sync/server.js` is de sync-server (Node.js, ingebouwde SQLite, geen npm-pakketten).
- Na elke wijziging `version` in `dagkompas_sync/config.yaml` ophogen; dan ziet de gebruiker "Update" in Home Assistant.
- Nieuwe instelling: toevoegen in config.yaml (options en schema), run.sh, translations/nl.yaml en en.yaml, en DOCS.md.
- Testen: `bash test/api.sh` (start de server tijdelijk en controleert de API).
- Schrijf Nederlands, in gewone taal, en gebruik geen liggend streepje (—) als leesteken.
