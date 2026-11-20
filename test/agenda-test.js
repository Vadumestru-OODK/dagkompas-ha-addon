// Test van de agenda-module en het endpoint /api/agenda met een nep-agenda (geen internet nodig).
// Gebruik: node test/agenda-test.js

const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

process.env.TZ = 'Europe/Amsterdam';
const agenda = require('../dagkompas_sync/agenda.js');

const ICS = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//NL',
    // Gewone afspraak met tijdzone
    'BEGIN:VEVENT', 'UID:a1', 'DTSTART;TZID=Europe/Amsterdam:20261110T140000', 'DTEND;TZID=Europe/Amsterdam:20261110T150000', 'SUMMARY:Tandarts', 'LOCATION:Wijchen\\, Dorpsstraat 1', 'END:VEVENT',
    // UTC-tijd (15:00 UTC is 16:00 in de winter)
    'BEGIN:VEVENT', 'UID:a2', 'DTSTART:20261111T150000Z', 'DTEND:20261111T160000Z', 'SUMMARY:Bellen met bank', 'END:VEVENT',
    // Hele dag
    'BEGIN:VEVENT', 'UID:a3', 'DTSTART;VALUE=DATE:20261112', 'DTEND;VALUE=DATE:20261113', 'SUMMARY:Verjaardag', 'END:VEVENT',
    // Meerdere dagen (hele dagen, DTEND exclusief)
    'BEGIN:VEVENT', 'UID:a4', 'DTSTART;VALUE=DATE:20261113', 'DTEND;VALUE=DATE:20261116', 'SUMMARY:Weekendje weg', 'END:VEVENT',
    // Wekelijks op maandag en donderdag, in de zomer begonnen (zomertijd), moet in november nog 09:00 zijn
    'BEGIN:VEVENT', 'UID:a5', 'DTSTART;TZID=Europe/Amsterdam:20260601T090000', 'DTEND;TZID=Europe/Amsterdam:20260601T100000', 'RRULE:FREQ=WEEKLY;BYDAY=MO,TH', 'EXDATE;TZID=Europe/Amsterdam:20261116T090000', 'SUMMARY:Overleg team', 'END:VEVENT',
    // Verplaatste herhaling: donderdag 12 november wordt 13:00
    'BEGIN:VEVENT', 'UID:a5', 'RECURRENCE-ID;TZID=Europe/Amsterdam:20261112T090000', 'DTSTART;TZID=Europe/Amsterdam:20261112T130000', 'DTEND;TZID=Europe/Amsterdam:20261112T140000', 'SUMMARY:Overleg team (verplaatst)', 'END:VEVENT',
    // Elke 2 weken, met COUNT
    'BEGIN:VEVENT', 'UID:a6', 'DTSTART;TZID=Europe/Amsterdam:20261103T180000', 'DTEND;TZID=Europe/Amsterdam:20261103T190000', 'RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=3', 'SUMMARY:Sporten', 'END:VEVENT',
    // Maandelijks op de eerste vrijdag
    'BEGIN:VEVENT', 'UID:a7', 'DTSTART;TZID=Europe/Amsterdam:20260102T100000', 'DTEND;TZID=Europe/Amsterdam:20260102T110000', 'RRULE:FREQ=MONTHLY;BYDAY=1FR', 'SUMMARY:Maandoverleg', 'END:VEVENT',
    // Jaarlijks, hele dag
    'BEGIN:VEVENT', 'UID:a8', 'DTSTART;VALUE=DATE:20200315', 'DTEND;VALUE=DATE:20200316', 'RRULE:FREQ=YEARLY', 'SUMMARY:Trouwdag', 'END:VEVENT',
    // Geannuleerd
    'BEGIN:VEVENT', 'UID:a9', 'DTSTART;TZID=Europe/Amsterdam:20261110T200000', 'DTEND;TZID=Europe/Amsterdam:20261110T210000', 'STATUS:CANCELLED', 'SUMMARY:Niet doorgaan', 'END:VEVENT',
    // Opgevouwen regel en geen titel
    'BEGIN:VEVENT', 'UID:a10', 'DTSTART;TZID=Europe/Amsterdam:20261117T080000', 'DTEND;TZID=Europe/Amsterdam:20261117T083000', 'SUMMARY:Een hele lange titel die', '  doorloopt op de volgende regel', 'END:VEVENT',
    // Afspraak over middernacht
    'BEGIN:VEVENT', 'UID:a11', 'DTSTART;TZID=Europe/Amsterdam:20261118T230000', 'DTEND;TZID=Europe/Amsterdam:20261119T010000', 'SUMMARY:Nachtdienst', 'END:VEVENT',
    'END:VCALENDAR', ''
].join('\r\n');

const dag = (events, d) => events.filter(e => e.datum === d);
const titels = (events, d) => dag(events, d).map(e => (e.start || (e.heleDag ? 'hele dag' : '')) + ' ' + e.titel);

(async () => {
    // 1. Parser en uitbreiden, direct
    const events = agenda.parseIcs(ICS);
    const nr = agenda.datumNaarNr;
    const lijst = agenda.maakInstanties(events, nr('2026-11-01'), nr('2026-11-30'));

    assert.deepStrictEqual(titels(lijst, '2026-11-10'), ['14:00 Tandarts'], 'tijdzone en geannuleerd');
    assert.strictEqual(dag(lijst, '2026-11-10')[0].locatie, 'Wijchen, Dorpsstraat 1', 'komma in locatie');
    assert.strictEqual(dag(lijst, '2026-11-10')[0].einde, '15:00');
    assert.deepStrictEqual(titels(lijst, '2026-11-11'), ['16:00 Bellen met bank'], 'UTC naar lokale tijd (16:00)');
    assert.deepStrictEqual(titels(lijst, '2026-11-12'), ['hele dag Verjaardag', '13:00 Overleg team (verplaatst)'], 'hele dag en verplaatste herhaling');
    assert.deepStrictEqual(titels(lijst, '2026-11-13').filter(t => t.includes('Weekendje')), ['hele dag Weekendje weg']);
    assert.ok(dag(lijst, '2026-11-14').some(e => e.titel === 'Weekendje weg'), 'meerdere dagen, dag 2');
    assert.ok(dag(lijst, '2026-11-15').some(e => e.titel === 'Weekendje weg'), 'meerdere dagen, dag 3');
    assert.ok(!dag(lijst, '2026-11-16').some(e => e.titel === 'Weekendje weg'), 'DTEND is exclusief');
    assert.deepStrictEqual(titels(lijst, '2026-11-02'), ['09:00 Overleg team'], 'wekelijks maandag, zomertijd blijft 09:00 in de winter');
    assert.ok(!dag(lijst, '2026-11-16').some(e => e.titel === 'Overleg team'), 'EXDATE');
    assert.ok(dag(lijst, '2026-11-19').some(e => e.titel === 'Overleg team' && e.start === '09:00'), 'donderdag');
    assert.ok(!dag(lijst, '2026-11-12').some(e => e.titel === 'Overleg team'), 'verplaatste afspraak vervangt de oorspronkelijke');
    assert.deepStrictEqual(lijst.filter(e => e.titel === 'Sporten').map(e => e.datum), ['2026-11-03', '2026-11-17'], 'interval 2 weken, COUNT 3 (de derde valt in december)');
    assert.deepStrictEqual(lijst.filter(e => e.titel === 'Maandoverleg').map(e => e.datum), ['2026-11-06'], 'eerste vrijdag van de maand');
    assert.deepStrictEqual(lijst.filter(e => e.titel === 'Trouwdag').map(e => e.datum), [], 'jaarlijks buiten bereik');
    const maart = agenda.maakInstanties(events, nr('2026-03-10'), nr('2026-03-20'));
    assert.deepStrictEqual(maart.filter(e => e.titel === 'Trouwdag').map(e => e.datum), ['2026-03-15'], 'jaarlijks hele dag');
    assert.ok(!lijst.some(e => e.titel === 'Niet doorgaan'), 'geannuleerd');
    assert.ok(lijst.some(e => e.titel === 'Een hele lange titel die doorloopt op de volgende regel'), 'opgevouwen regels');
    const nacht = lijst.filter(e => e.titel === 'Nachtdienst');
    assert.deepStrictEqual(nacht.map(e => [e.datum, e.start, e.einde]), [['2026-11-18', '23:00', null], ['2026-11-19', null, '01:00']], 'afspraak over middernacht');
    // Zomertijd: dezelfde herhaling in juli moet ook 09:00 zijn
    const juli = agenda.maakInstanties(events, nr('2026-07-06'), nr('2026-07-06'));
    assert.deepStrictEqual(titels(juli, '2026-07-06'), ['09:00 Overleg team']);

    // 2. Endpoint met een lokale nep-Google
    let teller = 0;
    const nepGoogle = http.createServer((req, res) => { teller++; res.writeHead(200, { 'Content-Type': 'text/calendar' }); res.end(ICS); }).listen(18097);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dkag-'));
    const env = { ...process.env, SYNC_TOKEN: 'testtoken-1234567890', DATA_DIR: tmp, SYNC_PORT: '18098', AGENDA_URL: 'http://127.0.0.1:18097/geheim-pad-123/basic.ics' };
    let log = '';
    const srv = spawn(process.execPath, [path.join(__dirname, '../dagkompas_sync/server.js')], { env });
    srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
    const vraag = (p, token = 'testtoken-1234567890') => new Promise((ok, fout) => {
        http.get('http://127.0.0.1:18098' + p, { headers: { Authorization: 'Bearer ' + token } }, r => {
            let b = ''; r.on('data', c => b += c); r.on('end', () => ok({ status: r.statusCode, json: JSON.parse(b) }));
        }).on('error', fout);
    });
    try {
        await new Promise(r => setTimeout(r, 1000));
        let r = await vraag('/api/agenda');
        assert.strictEqual(r.status, 200); assert.strictEqual(r.json.ingesteld, true);
        r = await vraag('/api/agenda?from=2026-11-10&to=2026-11-12');
        assert.strictEqual(r.status, 200);
        assert.ok(r.json.events.some(e => e.titel === 'Tandarts' && e.start === '14:00'), 'endpoint geeft Tandarts');
        assert.ok(r.json.events.every(e => e.datum >= '2026-11-10' && e.datum <= '2026-11-12'), 'bereik klopt');
        assert.strictEqual(r.json.agendas[0].ok, true);
        assert.ok(!JSON.stringify(r.json).includes('geheim-pad'), 'adres mag niet in antwoord');
        await vraag('/api/agenda?from=2026-11-10&to=2026-11-12');
        assert.strictEqual(teller, 1, 'tweede vraag komt uit de cache');
        assert.strictEqual((await vraag('/api/agenda?from=2026-11-10&to=2027-12-12')).status, 400, 'bereik te groot');
        assert.strictEqual((await vraag('/api/agenda?from=morgen&to=2026-11-12')).status, 400, 'ongeldige datum');
        assert.strictEqual((await vraag('/api/agenda', 'fout-token')).status, 401, 'zonder juist token');
        assert.ok(!log.includes('geheim-pad'), 'adres mag niet in het logboek');
        // Google valt weg: oude gegevens blijven zichtbaar
        nepGoogle.close();
    } finally {
        srv.kill('SIGTERM'); nepGoogle.close(); fs.rmSync(tmp, { recursive: true, force: true });
    }

    // 3. Zonder agenda ingesteld
    const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'dkag-'));
    const srv2 = spawn(process.execPath, [path.join(__dirname, '../dagkompas_sync/server.js')], { env: { ...process.env, SYNC_TOKEN: 'testtoken-1234567890', DATA_DIR: tmp2, SYNC_PORT: '18099', AGENDA_URL: '', AGENDA_URL_2: '' } });
    try {
        await new Promise(r => setTimeout(r, 1000));
        const r = await new Promise(ok => http.get('http://127.0.0.1:18099/api/agenda', { headers: { Authorization: 'Bearer testtoken-1234567890' } }, x => { let b = ''; x.on('data', c => b += c); x.on('end', () => ok(JSON.parse(b))); }));
        assert.deepStrictEqual(r, { ingesteld: false, agendas: [], events: [] });
    } finally { srv2.kill('SIGTERM'); fs.rmSync(tmp2, { recursive: true, force: true }); }

    console.log('Alle agenda-tests geslaagd.');
})().catch(e => { console.error('FOUT:', e.message); process.exit(1); });
