// Test van het dagoverzicht, de planner en het versturen van meldingen (met een nep-Home Assistant).
// Gebruik: node test/meldingen-test.js

const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

process.env.TZ = 'Europe/Amsterdam';
const m = require('../dagkompas_sync/meldingen.js');

const DAG = '2026-11-23'; // maandag
const gisteren = '2026-11-22';
const items = [
    { kind: 'task', title: 'Geheime klantnaam bellen', top: DAG, done: true },
    { kind: 'task', title: 'Nog een geheime taak', top: DAG, done: false },
    { kind: 'task', title: 'Te laat taak', due: '2026-11-20', done: false },
    { kind: 'task', title: 'Oude taak klaar', due: '2026-11-01', done: true },
    { kind: 'routine', title: 'Tien minuten naar buiten', learning: true, days: [1, 2, 3, 4, 5, 6, 7], startDate: '2026-11-15', log: ['2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21'], trigger: 'Na de lunch', small: 'Jas aan en één rondje' },
    { kind: 'routine', title: 'Vaste gewoonte', learning: false, days: [1], log: [] }
];
const afspraken = { ingesteld: true, events: [
    { datum: DAG, start: '09:30', titel: 'Klant Jansen' }, { datum: DAG, start: '13:00', titel: 'Vonk' }, { datum: DAG, start: null, heleDag: true, titel: 'Studiedag' }, { datum: '2026-11-24', start: '08:00', titel: 'Morgen' }
] };

// 1. Dagoverzicht en berichten
let o = m.dagoverzicht(items, DAG, afspraken, null);
assert.deepStrictEqual(o.top, { aantal: 2, gedaan: 1 });
assert.strictEqual(o.laat, 1);
assert.strictEqual(o.leren.length, 1, 'alleen aanleergewoonten');
assert.strictEqual(o.leren[0].reeks, 0, 'zondag 22 november gemist, dus reeks 0 op maandag');
assert.strictEqual(o.leren[0].gemistGisteren, true);
assert.deepStrictEqual(o.afspraken, { aantal: 3, eerste: '09:30' });
let b = m.ochtendBericht(o);
assert.strictEqual(b.title, 'Goedemorgen');
assert.ok(b.message.includes('Vandaag 3 afspraken, de eerste om 09:30.'), b.message);
assert.ok(b.message.includes('Je Top 3 staat klaar (2 taken).'));
assert.ok(b.message.includes('1 taak is te laat.'));
assert.ok(b.message.includes('Tien minuten naar buiten (na de lunch)'));
for (const verboden of ['Geheime', 'Jansen', 'Vonk', 'geheime']) assert.ok(!b.message.includes(verboden), 'titel in melding: ' + verboden);
b = m.avondBericht(m.dagoverzicht(items, DAG, afspraken, '20:00'));
assert.ok(b.message.includes('Tien minuten naar buiten staat nog open. Kleinste versie: Jas aan en één rondje.'));
assert.ok(b.message.includes('Gisteren lukte het niet'));
assert.ok(b.message.includes('Top 3: nog 1 open.'));
assert.ok(!b.message.includes('Geheime'));
// Alles gedaan: geen avondmelding
const klaar = items.map(v => v.kind === 'routine' && v.learning ? { ...v, log: [...v.log, DAG] } : v.top === DAG ? { ...v, done: true } : v);
assert.strictEqual(m.avondBericht(m.dagoverzicht(klaar, DAG, afspraken, '20:00')), null);
// Zonder afspraken en zonder Top 3
const leeg = m.ochtendBericht(m.dagoverzicht([], DAG, null, null));
assert.strictEqual(leeg.message, 'Kies je Top 3 voor vandaag.');
assert.strictEqual(m.ochtendBericht(m.dagoverzicht([], DAG, { ingesteld: true, events: [] }, null)).message.split('\n')[0], 'Geen afspraken vandaag.');
// Namen van de dienst en tijden
assert.strictEqual(m.schoneDienst('notify.mobile_app_Bjorn'), '', 'hoofdletters niet toegestaan');
assert.strictEqual(m.schoneDienst('notify.mobile_app_bjorn'), 'mobile_app_bjorn');
assert.strictEqual(m.schoneDienst('../../x'), '');
assert.strictEqual(m.geldigeTijd('07:45'), '07:45'); assert.strictEqual(m.geldigeTijd('7:45'), ''); assert.strictEqual(m.geldigeTijd('25:00'), ''); assert.strictEqual(m.geldigeTijd(''), '');

(async () => {
    // 2. Planner met een nepklok
    const verstuurd = [];
    const laatst = {};
    let klok = new Date('2026-11-23T06:30:00Z'); // 07:30 in Nederland
    const stil = { log() {}, warn() {} };
    const planner = m.maakPlanner({
        leesItems: () => items, haalAfspraken: async () => afspraken, stuur: async x => { verstuurd.push(x); },
        tijden: { ochtend: '07:45', avond: '20:00' }, getLaatst: s => laatst[s] || '', setLaatst: (s, d) => { laatst[s] = d; }, nu: () => klok, log: stil
    });
    await planner.controleer(); assert.strictEqual(verstuurd.length, 0, 'te vroeg');
    klok = new Date('2026-11-23T06:50:00Z'); // 07:50
    await planner.controleer(); assert.strictEqual(verstuurd.length, 1, 'ochtend verstuurd'); assert.strictEqual(verstuurd[0].title, 'Goedemorgen');
    await planner.controleer(); assert.strictEqual(verstuurd.length, 1, 'niet dubbel');
    klok = new Date('2026-11-23T19:10:00Z'); // 20:10
    await planner.controleer(); assert.strictEqual(verstuurd.length, 2, 'avond verstuurd'); assert.strictEqual(verstuurd[1].title, 'Nog even vandaag');
    klok = new Date('2026-11-24T06:50:00Z'); // volgende ochtend
    await planner.controleer(); assert.strictEqual(verstuurd.length, 3, 'volgende dag opnieuw');
    klok = new Date('2026-11-24T21:30:00Z'); // 22:30: buiten het venster van 90 minuten
    await planner.controleer(); assert.strictEqual(verstuurd.length, 3, 'te laat voor avondmelding');
    // Een mislukte melding stopt de planner niet en wordt niet opnieuw geprobeerd die dag
    const w = []; const laatst2 = {};
    const kapot = m.maakPlanner({ leesItems: () => items, haalAfspraken: async () => { throw new Error('geen internet'); }, stuur: async () => { throw new Error('HA weg'); },
        tijden: { ochtend: '07:45', avond: '' }, getLaatst: s => laatst2[s] || '', setLaatst: (s, d) => { laatst2[s] = d; }, nu: () => new Date('2026-11-23T06:50:00Z'), log: { log() {}, warn: x => w.push(x) } });
    await kapot.controleer(); await kapot.controleer();
    assert.strictEqual(w.length, 1, 'één waarschuwing, geen herhaling'); assert.ok(w[0].includes('HA weg'));

    // 3. Endpoints met een nep-Home Assistant
    const ontvangen = [];
    const nepHa = http.createServer((req, res) => {
        let body = ''; req.on('data', c => body += c);
        req.on('end', () => { ontvangen.push({ url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null }); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('[]'); });
    }).listen(18120);
    const start = (port, extra) => spawn(process.execPath, [path.join(__dirname, '../dagkompas_sync/server.js')], { env: { ...process.env, SYNC_TOKEN: 'testtoken-1234567890', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dkm-')), SYNC_PORT: String(port), AGENDA_URL: '', ...extra } });
    const vraag = (port, methode, p, token = 'testtoken-1234567890') => new Promise((ok, fout) => {
        const r = http.request({ host: '127.0.0.1', port, path: p, method: methode, headers: { Authorization: 'Bearer ' + token } }, x => { let b = ''; x.on('data', c => b += c); x.on('end', () => ok({ status: x.statusCode, json: JSON.parse(b) })); });
        r.on('error', fout); r.end();
    });
    const a = start(18121, { MELDING_SERVICE: 'notify.mobile_app_test', MELDING_OCHTEND: '07:45', MELDING_AVOND: '', HA_API_URL: 'http://127.0.0.1:18120', SUPERVISOR_TOKEN: 'sup-token', APP_ADRES: 'https://dagkompas.oodk.nl/' });
    const z = start(18122, { MELDING_SERVICE: '' });
    const k = start(18123, { MELDING_SERVICE: 'Fout Naam!', SUPERVISOR_TOKEN: 'sup-token' });
    try {
        await new Promise(r => setTimeout(r, 1200));
        let r = await vraag(18121, 'GET', '/api/melding');
        assert.deepStrictEqual(r.json, { ingesteld: true, ochtend: '07:45', avond: '' });
        assert.ok(!JSON.stringify(r.json).includes('mobile_app'), 'naam van de dienst niet tonen');
        r = await vraag(18121, 'POST', '/api/melding-test');
        assert.strictEqual(r.status, 200);
        assert.strictEqual(ontvangen.length, 1);
        assert.strictEqual(ontvangen[0].url, '/services/notify/mobile_app_test');
        assert.strictEqual(ontvangen[0].auth, 'Bearer sup-token');
        assert.strictEqual(ontvangen[0].body.title, 'Dagkompas');
        assert.strictEqual(ontvangen[0].body.data.clickAction, 'https://dagkompas.oodk.nl/#vandaag');
        assert.strictEqual((await vraag(18121, 'POST', '/api/melding-test', 'fout')).status, 401, 'testmelding vraagt een token');
        assert.deepStrictEqual((await vraag(18122, 'GET', '/api/melding')).json, { ingesteld: false, ochtend: '', avond: '' });
        assert.strictEqual((await vraag(18122, 'POST', '/api/melding-test')).status, 400, 'zonder instelling');
        assert.strictEqual((await vraag(18123, 'GET', '/api/melding')).json.ingesteld, false, 'ongeldige naam wordt genegeerd');
        // Home Assistant weigert de melding
        nepHa.close(); await new Promise(r => setTimeout(r, 200));
        r = await vraag(18121, 'POST', '/api/melding-test');
        assert.strictEqual(r.status, 502); assert.ok(!JSON.stringify(r.json).includes('sup-token'));
    } finally {
        [a, z, k].forEach(s => s.kill('SIGTERM')); nepHa.close();
    }
    console.log('Alle meldingen-tests geslaagd.');
})().catch(e => { console.error('FOUT:', e.message); process.exit(1); });
