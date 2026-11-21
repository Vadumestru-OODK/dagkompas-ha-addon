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

## Google Agenda (alleen lezen)

Met de instelling **Agenda-adres** laat Dagkompas je afspraken zien op Vandaag en bij Week.
De add-on haalt je agenda op via het geheime adres in iCal-indeling en geeft de afspraken door aan de app.
Er wordt niets in je agenda gezet of gewijzigd.

Het adres vind je zo:

1. Open Google Agenda op een computer (in de app van je telefoon kan dit niet).
2. Klik op het tandwiel en kies Instellingen.
3. Kies links, onder "Instellingen voor mijn agenda's", de agenda die je wilt laten zien.
4. Scroll naar "Geheim adres in iCal-indeling" en kopieer het adres.
5. Plak het in deze add-on bij Configuratie, bij "Agenda-adres", sla op en start de add-on opnieuw.

Let op: iedereen die dat adres heeft, kan je hele agenda lezen. Deel het dus niet en zet het nergens anders neer.
Is het adres toch uitgelekt? Klik in Google Agenda bij hetzelfde scherm op "Geheim adres resetten" en plak het nieuwe adres in de add-on.
De afspraken worden elke 10 minuten ververst. Het adres staat nooit in het logboek.

## Meldingen op je telefoon

De add-on kan je via de Home Assistant-app op je telefoon een melding sturen:

- **'s Ochtends** een kort overzicht: hoeveel afspraken je hebt en wanneer de eerste is, of je Top 3 klaarstaat,
  hoeveel taken te laat zijn en welke gewoonte je aan het aanleren bent.
- **'s Avonds** een herinnering, maar alleen als er nog iets openstaat: een gewoonte die je aan het aanleren bent
  (met je kleinste versie) of een Top 3 die nog niet af is. Is alles gedaan, dan krijg je niets.

In een melding staan alleen aantallen, tijden en de namen van je gewoontes. Namen van taken en afspraken staan er
bewust niet in, omdat je ze anders op een vergrendeld scherm zou kunnen lezen.

Instellen:

1. Zorg dat de Home Assistant-app op je telefoon staat en dat je erin bent ingelogd.
2. Open in Home Assistant **Ontwikkelaarstools**, dan het tabblad **Acties**.
3. Typ in het zoekveld `notify.mobile_app`. Je ziet nu je telefoon staan, bijvoorbeeld `notify.mobile_app_mijn_telefoon`.
4. Vul bij Configuratie van deze add-on bij **Melding-dienst** de naam in, zonder `notify.` ervoor
   (dus `mobile_app_mijn_telefoon`). De tijden staan standaard op 07:45 en 20:00. Wis een tijd om die melding uit te zetten.
5. Sla op en start de add-on opnieuw. Open daarna Dagkompas, ga naar Ritme en tik bij Meldingen op **Stuur testmelding**.

Meldingen worden maximaal 90 minuten na de ingestelde tijd nog verstuurd, bijvoorbeeld als de add-on net herstart.
Elke melding gaat per dag maar één keer.

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
