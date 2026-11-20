// Sync-server voor Dagkompas (privé planner).
//
// Wat hij doet:
//   - Bewaart alle onderdelen van de app (taken, gewoontes, weken, instellingen) in een
//     SQLite-database (dagkompas.db), één regel per onderdeel.
//   - Elke wijziging krijgt een volgnummer. De app vraagt "alles na nummer X" op en is
//     dan weer bij. Zo blijven telefoon, tablet en pc gelijk.
//   - Verwijderen gebeurt met een markering, zodat andere toestellen het ook horen.
//   - Elke dag een kopie van de database in de map 'backups' (laatste 30 dagen).
//
//   - Optioneel: leest je Google Agenda (alleen lezen) via het geheime iCal-adres en geeft de afspraken
//     per dag aan de app (GET /api/agenda). Zie agenda.js.
//
// Geen extra installatie nodig: SQLite zit in Node.js 22.13 en hoger.
// Starten op een pc: SYNC_TOKEN=jouw-lange-token node server.js

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const agenda = require('./agenda');

const origEmitWarning = process.emitWarning;
process.emitWarning = function (w, ...rest) {
    if (String(w && w.message || w).includes('SQLite')) return;
    return origEmitWarning.call(process, w, ...rest);
};

let DatabaseSync;
try {
    ({ DatabaseSync } = require('node:sqlite'));
} catch (e) {
    console.error('Deze Node.js-versie heeft geen ingebouwde SQLite. Gebruik Node.js 22.13 of hoger.');
    process.exit(1);
}

process.env.TZ = process.env.TZ || 'Europe/Amsterdam';
const PORT = parseInt(process.env.SYNC_PORT, 10) || 8092;
const TOKEN = (process.env.SYNC_TOKEN || '').trim();
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'gegevens');
const DB_FILE = path.join(DATA_DIR, 'dagkompas.db');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const MAX_BACKUPS = 30;
const MAX_BODY = 512 * 1024;           // één onderdeel is nooit groot
const MAX_ITEMS = 20000;

const AGENDA_AANTAL = agenda.stelIn([process.env.AGENDA_URL, process.env.AGENDA_URL_2]);

if (!TOKEN) {
    console.error('Geen token ingesteld (SYNC_TOKEN). De server start niet zonder token.');
    process.exit(1);
}

// --- Database ---

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });
const db = new DatabaseSync(DB_FILE);
db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS items (
        id        TEXT PRIMARY KEY,
        data      TEXT,
        verwijderd INTEGER NOT NULL DEFAULT 0,
        seq       INTEGER NOT NULL,
        gewijzigd TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS items_seq ON items(seq);
    CREATE TABLE IF NOT EXISTS meta (sleutel TEXT PRIMARY KEY, waarde TEXT);
`);

const qSeq = db.prepare(`SELECT waarde FROM meta WHERE sleutel = 'seq'`);
const qZetSeq = db.prepare(`INSERT INTO meta (sleutel, waarde) VALUES ('seq', ?) ON CONFLICT(sleutel) DO UPDATE SET waarde = excluded.waarde`);
const qSince = db.prepare(`SELECT id, data, verwijderd, seq FROM items WHERE seq > ? ORDER BY seq`);
const qPut = db.prepare(`INSERT INTO items (id, data, verwijderd, seq, gewijzigd) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET data = excluded.data, verwijderd = excluded.verwijderd, seq = excluded.seq, gewijzigd = excluded.gewijzigd`);
const qGet = db.prepare(`SELECT data, verwijderd FROM items WHERE id = ?`);
const qAantal = db.prepare(`SELECT COUNT(*) AS n FROM items WHERE verwijderd = 0`);
// Markeringen van verwijderde onderdelen ouder dan een jaar mogen weg
const qOpruimen = db.prepare(`DELETE FROM items WHERE verwijderd = 1 AND gewijzigd < ?`);

function huidigeSeq() {
    const r = qSeq.get();
    return r ? parseInt(r.waarde, 10) || 0 : 0;
}

// Schrijft één onderdeel (data = object) of verwijdert het (data = null). Geeft het nieuwe volgnummer.
function schrijf(id, data) {
    const bestaand = qGet.get(id);
    const nieuweTekst = data === null ? null : JSON.stringify(data);
    // Niets veranderd: geen nieuw volgnummer, zodat andere toestellen niets hoeven op te halen
    if (bestaand && ((data === null && bestaand.verwijderd) || (!bestaand.verwijderd && bestaand.data === nieuweTekst))) {
        return huidigeSeq();
    }
    db.exec('BEGIN');
    try {
        const seq = huidigeSeq() + 1;
        qZetSeq.run(String(seq));
        qPut.run(id, nieuweTekst, data === null ? 1 : 0, seq, new Date().toISOString());
        db.exec('COMMIT');
        return seq;
    } catch (e) {
        db.exec('ROLLBACK');
        throw e;
    }
}

// --- Dagelijkse backup ---

function datumVandaag() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function maakBackup() {
    try {
        const doel = path.join(BACKUP_DIR, `dagkompas-${datumVandaag()}.db`);
        if (!fs.existsSync(doel)) {
            db.exec(`VACUUM INTO '${doel.replace(/'/g, "''")}'`);
            console.log(`${new Date().toLocaleString('nl-NL')}: backup gemaakt (${path.basename(doel)})`);
        }
        const oud = fs.readdirSync(BACKUP_DIR).filter(f => /^dagkompas-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
        while (oud.length > MAX_BACKUPS) fs.unlinkSync(path.join(BACKUP_DIR, oud.shift()));
        const jaarGeleden = new Date(Date.now() - 365 * 864e5).toISOString();
        qOpruimen.run(jaarGeleden);
    } catch (e) {
        console.error('Backup mislukt:', e.message);
    }
}
maakBackup();
setInterval(maakBackup, 60 * 60 * 1000).unref();

// --- HTTP ---

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
    'Access-Control-Max-Age': '600'
};

function send(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
    res.end(body);
}

// --- Slot op foute pogingen ---
// Na 10 foute tokens binnen een kwartier wordt dat adres een uur geblokkeerd.
// Alleen in het geheugen: een herstart van de add-on heft alle blokkades op.
const MAX_FOUT = 10;
const FOUT_VENSTER = 15 * 60 * 1000;
const BLOKKADE_DUUR = 60 * 60 * 1000;
const pogingen = new Map();

function isPriveAdres(a) {
    a = String(a || '').replace(/^::ffff:/, '');
    return a === '::1' || /^127\./.test(a) || /^10\./.test(a) || /^192\.168\./.test(a)
        || /^172\.(1[6-9]|2\d|3[01])\./.test(a) || /^f[cd]/i.test(a) || /^fe80:/i.test(a);
}

function bezoekerAdres(req) {
    const direct = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    if (!isPriveAdres(direct)) return direct;
    const echt = req.headers['x-real-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0];
    return String(echt || direct).trim().replace(/^::ffff:/, '');
}

function isGeblokkeerd(adres) {
    const p = pogingen.get(adres);
    return p && p.geblokkeerdTot > Date.now() ? p.geblokkeerdTot : 0;
}

function registreerFout(adres) {
    const nu = Date.now();
    const p = pogingen.get(adres) || { fouten: [], geblokkeerdTot: 0 };
    p.fouten = p.fouten.filter(t => nu - t < FOUT_VENSTER);
    p.fouten.push(nu);
    if (p.fouten.length >= MAX_FOUT) {
        p.geblokkeerdTot = nu + BLOKKADE_DUUR;
        p.fouten = [];
        console.warn(`${new Date().toLocaleString('nl-NL')}: adres ${adres} een uur geblokkeerd na ${MAX_FOUT} foute pogingen.`);
    }
    pogingen.set(adres, p);
}

setInterval(() => {
    const nu = Date.now();
    for (const [a, p] of pogingen) {
        if (p.geblokkeerdTot < nu && !p.fouten.some(t => nu - t < FOUT_VENSTER)) pogingen.delete(a);
    }
}, 10 * 60 * 1000).unref();

function checkAuth(req) {
    const auth = Buffer.from(req.headers['authorization'] || '');
    const verwacht = Buffer.from(`Bearer ${TOKEN}`);
    return auth.length === verwacht.length && crypto.timingSafeEqual(auth, verwacht);
}

function leesBody(req, max) {
    return new Promise((resolve, reject) => {
        const delen = [];
        let lengte = 0;
        req.on('data', chunk => {
            lengte += chunk.length;
            if (lengte > max) { reject(new Error('te groot')); req.destroy(); return; }
            delen.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(delen)));
        req.on('error', reject);
    });
}

// Toegestane ids: letters, cijfers, _ - . : (zoals de app ze maakt)
const ID_PATROON = /^[A-Za-z0-9_.:-]{1,80}$/;

const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }
    const url = new URL(req.url, 'http://localhost');
    const pad = url.pathname.replace(/\/+$/, '') || '/';

    // Zonder token: alleen een teken van leven, zodat je in de browser kunt zien dat hij draait
    if (req.method === 'GET' && (pad === '/' || pad === '/api/status')) {
        send(res, 200, { app: 'dagkompas-sync', ok: true });
        return;
    }

    const adres = bezoekerAdres(req);
    const tot = isGeblokkeerd(adres);
    if (tot) {
        const minuten = Math.ceil((tot - Date.now()) / 60000);
        res.setHeader('Retry-After', String(minuten * 60));
        send(res, 429, { error: `Te veel foute pogingen. Probeer het over ${minuten} minuten opnieuw.` });
        return;
    }
    if (!checkAuth(req)) {
        registreerFout(adres);
        send(res, 401, { error: 'Token klopt niet' });
        return;
    }
    pogingen.delete(adres);

    try {
        // Alles ophalen wat na volgnummer X is veranderd
        if (req.method === 'GET' && pad === '/api/items') {
            const since = Math.max(0, parseInt(url.searchParams.get('since'), 10) || 0);
            const rijen = qSince.all(since);
            const items = rijen.map(r => ({ id: r.id, seq: r.seq, data: r.verwijderd ? null : JSON.parse(r.data) }));
            send(res, 200, { seq: huidigeSeq(), items });
            return;
        }

        // Afspraken uit Google Agenda (alleen lezen)
        if (req.method === 'GET' && pad === '/api/agenda') {
            const datum = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
            const nu = new Date();
            const vandaag = `${nu.getFullYear()}-${String(nu.getMonth() + 1).padStart(2, '0')}-${String(nu.getDate()).padStart(2, '0')}`;
            const van = url.searchParams.get('from') || vandaag;
            const tot = url.searchParams.get('to') || agenda.nrNaarDatum(agenda.datumNaarNr(van) + 13);
            if (!datum(van) || !datum(tot)) { send(res, 400, { error: 'from en to moeten JJJJ-MM-DD zijn' }); return; }
            const dagen = agenda.datumNaarNr(tot) - agenda.datumNaarNr(van);
            if (dagen < 0 || dagen > 62) { send(res, 400, { error: 'Kies een bereik van 0 tot 62 dagen' }); return; }
            send(res, 200, await agenda.afspraken(van, tot));
            return;
        }

        const m = pad.match(/^\/api\/items\/([^/]+)$/);
        if (m) {
            const id = decodeURIComponent(m[1]);
            if (!ID_PATROON.test(id)) { send(res, 400, { error: 'Ongeldige id' }); return; }

            if (req.method === 'PUT') {
                let body;
                try { body = JSON.parse((await leesBody(req, MAX_BODY)).toString('utf8')); }
                catch (e) { send(res, e.message === 'te groot' ? 413 : 400, { error: e.message === 'te groot' ? 'Te groot' : 'Geen geldige JSON' }); return; }
                const data = body && body.data;
                if (!data || typeof data !== 'object' || Array.isArray(data)) { send(res, 400, { error: 'data moet een object zijn' }); return; }
                const bestaat = qGet.get(id);
                if ((!bestaat || bestaat.verwijderd) && qAantal.get().n >= MAX_ITEMS) {
                    send(res, 507, { error: 'De opslag is vol. Wis afgeronde taken.' });
                    return;
                }
                send(res, 200, { seq: schrijf(id, data) });
                return;
            }
            if (req.method === 'DELETE') {
                send(res, 200, { seq: schrijf(id, null) });
                return;
            }
        }

        send(res, 404, { error: 'Onbekend adres' });
    } catch (e) {
        console.error(`${new Date().toLocaleString('nl-NL')}: fout bij ${req.method} ${pad}:`, e.message);
        send(res, 500, { error: 'Er ging iets mis op de server' });
    }
});

server.listen(PORT, () => {
    console.log(`Dagkompas Sync draait op poort ${PORT}. Gegevens in ${DATA_DIR}.`);
    console.log(AGENDA_AANTAL ? `Agenda: ${AGENDA_AANTAL} ${AGENDA_AANTAL === 1 ? 'agenda' : 'agenda\'s'} ingesteld (alleen lezen).` : 'Agenda: niet ingesteld.');
});

function stop() {
    server.close();
    try { db.close(); } catch (e) {}
    process.exit(0);
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
