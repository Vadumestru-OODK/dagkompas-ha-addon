# Dagkompas Sync

De privé opslag voor Dagkompas (dagkompas.oodk.nl): je takenlijst, dagritme en
weekdoelen. Telefoon, tablet en pc blijven hiermee gelijk. Deze add-on staat
helemaal los van Opticien Sync: eigen poort, eigen token, eigen map.

## Waar staan de gegevens?

Alles staat in de map **`share\dagkompas`** van Home Assistant. Met de
Samba-add-on open je die vanaf je pc via `\\homeassistant.local\share\dagkompas`.

| Wat | Waarvoor |
|---|---|
| `dagkompas.db` | De database (plus `-wal` en `-shm`, die horen erbij) |
| `backups\` | Elke dag een kopie van de database (laatste 30 dagen) |

## Instellingen

- **Token**: hetzelfde token als in Dagkompas bij "Sync-server" (tabblad Ritme).
  Gebruik een lang, willekeurig token van minstens 16 tekens, en een ander token
  dan bij Opticien Sync.

## Bereikbaar maken van buitenaf

Maak in Nginx Proxy Manager een nieuwe proxy host, bijvoorbeeld
`dagkompas-sync.jouwdomein.nl`, die doorstuurt naar `http://<ip-van-home-assistant>:8092`.
Zet **Block Common Exploits** aan en vraag op het tabblad SSL een certificaat aan
(Force SSL aan). Open daarna `https://dagkompas-sync.jouwdomein.nl/api/status` in je
browser: je ziet dan `"ok":true`.

## Beveiliging

- Na 10 foute tokens binnen een kwartier wordt dat internetadres een uur
  geblokkeerd. Herstart de add-on om alle blokkades op te heffen.

## Backups

De map `share` gaat mee in de backups van Home Assistant. Controleer dat bij
automatische backups ook **Share** is aangevinkt.
