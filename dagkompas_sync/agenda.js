// Agenda-module voor Dagkompas: leest een geheim iCal-adres (Google Agenda) en geeft de afspraken
// per dag terug. Alleen lezen. Geen npm-pakketten nodig.
//
// Ondersteund: afspraken met tijd, hele dagen, afspraken over meerdere dagen, tijdzones (TZID of UTC),
// herhalende afspraken (RRULE: dagelijks, wekelijks, maandelijks, jaarlijks, met INTERVAL, COUNT, UNTIL,
// BYDAY, BYMONTHDAY, BYMONTH), uitzonderingen (EXDATE), verplaatste afspraken (RECURRENCE-ID) en
// geannuleerde afspraken.
//
// Het adres zelf komt nooit in een antwoord of in het logboek terecht.

const AGENDA_TZ = process.env.AGENDA_TZ || process.env.TZ || 'Europe/Amsterdam';
const CACHE_MS = 10 * 60 * 1000;
const MAX_ICS_BYTES = 20 * 1024 * 1024;
const MAX_ITER = 20000;

// ---------- tijdzones ----------

const formatters = new Map();
function formatter(tz) {
    let f = formatters.get(tz);
    if (!f) {
        f = new Intl.DateTimeFormat('en-CA', {
            timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
        formatters.set(tz, f);
    }
    return f;
}

function geldigeTz(tz) {
    if (!tz) return AGENDA_TZ;
    try { formatter(tz); return tz; } catch (e) { return AGENDA_TZ; }
}

// Verschil in ms tussen de wandkloktijd in tz en UTC, op moment epoch
function tzOffset(epoch, tz) {
    const delen = {};
    for (const p of formatter(tz).formatToParts(new Date(Math.floor(epoch / 1000) * 1000))) delen[p.type] = p.value;
    const alsUtc = Date.UTC(+delen.year, +delen.month - 1, +delen.day, +delen.hour, +delen.minute, +delen.second);
    return alsUtc - Math.floor(epoch / 1000) * 1000;
}

// Wandkloktijd in tz naar epoch (ms)
function lokaalNaarEpoch(y, m, d, h, mi, s, tz) {
    const gok = Date.UTC(y, m - 1, d, h, mi, s);
    let epoch = gok - tzOffset(gok, tz);
    const tweede = gok - tzOffset(epoch, tz);
    if (tweede !== epoch) epoch = tweede;
    return epoch;
}

function epochNaarLokaal(epoch, tz) {
    const delen = {};
    for (const p of formatter(tz).formatToParts(new Date(epoch))) delen[p.type] = p.value;
    return { datum: `${delen.year}-${delen.month}-${delen.day}`, tijd: `${delen.hour}:${delen.minute}` };
}

// ---------- dagen als getal ----------

const dagNr = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / 864e5);
function nrNaarDatum(n) {
    const d = new Date(n * 864e5);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
const datumNaarNr = s => dagNr(+s.slice(0, 4), +s.slice(5, 7), +s.slice(8, 10));
const weekdagVanNr = n => (new Date(n * 864e5).getUTCDay() + 6) % 7; // 0 = maandag
const dagenInMaand = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// ---------- iCal lezen ----------

function ontvouw(tekst) {
    return tekst.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
}

function ontsnap(w) {
    return String(w || '').replace(/\\([nN,;\\])/g, (_, c) => (c === 'n' || c === 'N') ? '\n' : c);
}

function leesRegel(regel) {
    // NAAM;PARAM=WAARDE;PARAM2="..":waarde
    let i = 0, inAanhalingstekens = false;
    for (; i < regel.length; i++) {
        const c = regel[i];
        if (c === '"') inAanhalingstekens = !inAanhalingstekens;
        else if (c === ':' && !inAanhalingstekens) break;
    }
    if (i >= regel.length) return null;
    const kop = regel.slice(0, i);
    const waarde = regel.slice(i + 1);
    const delen = kop.split(';');
    const naam = delen.shift().toUpperCase();
    const params = {};
    for (const d of delen) {
        const k = d.indexOf('=');
        if (k > 0) params[d.slice(0, k).toUpperCase()] = d.slice(k + 1).replace(/^"|"$/g, '');
    }
    return { naam, params, waarde };
}

// Datum of datum-tijd lezen. Geeft { heleDag, y, m, d, h, mi, s, utc, tz }
function leesMoment(waarde, params) {
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(String(waarde).trim());
    if (!m) return null;
    const heleDag = params.VALUE === 'DATE' || m[4] === undefined;
    return {
        heleDag, y: +m[1], m: +m[2], d: +m[3], h: +(m[4] || 0), mi: +(m[5] || 0), s: +(m[6] || 0),
        utc: m[7] === 'Z', tz: geldigeTz(params.TZID)
    };
}

function momentNaarEpoch(mo) {
    if (mo.utc) return Date.UTC(mo.y, mo.m - 1, mo.d, mo.h, mo.mi, mo.s);
    return lokaalNaarEpoch(mo.y, mo.m, mo.d, mo.h, mo.mi, mo.s, mo.tz);
}

function leesDuur(w) {
    const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(w).trim());
    if (!m) return null;
    const ms = ((+m[2] || 0) * 7 * 864e5) + ((+m[3] || 0) * 864e5) + ((+m[4] || 0) * 36e5) + ((+m[5] || 0) * 6e4) + ((+m[6] || 0) * 1e3);
    return m[1] === '-' ? -ms : ms;
}

function leesRrule(w) {
    const r = {};
    for (const stuk of String(w).split(';')) {
        const k = stuk.indexOf('=');
        if (k > 0) r[stuk.slice(0, k).toUpperCase()] = stuk.slice(k + 1);
    }
    const DAGEN = { MO: 0, TU: 1, WE: 2, TH: 3, FR: 4, SA: 5, SU: 6 };
    const byday = (r.BYDAY || '').split(',').filter(Boolean).map(x => {
        const m = /^([+-]?\d+)?(MO|TU|WE|TH|FR|SA|SU)$/.exec(x.trim());
        return m ? { n: m[1] ? parseInt(m[1], 10) : 0, dag: DAGEN[m[2]] } : null;
    }).filter(Boolean);
    return {
        freq: r.FREQ, interval: Math.max(1, parseInt(r.INTERVAL, 10) || 1),
        count: r.COUNT ? parseInt(r.COUNT, 10) : 0, until: r.UNTIL || '',
        byday, bymonthday: (r.BYMONTHDAY || '').split(',').filter(Boolean).map(Number),
        bymonth: (r.BYMONTH || '').split(',').filter(Boolean).map(Number),
        wkst: DAGEN[r.WKST] !== undefined ? DAGEN[r.WKST] : 0
    };
}

function parseIcs(tekst) {
    const regels = ontvouw(tekst);
    const events = [];
    let huidig = null;
    for (const regel of regels) {
        if (regel === 'BEGIN:VEVENT') { huidig = { exdates: [] }; continue; }
        if (regel === 'END:VEVENT') { if (huidig) events.push(huidig); huidig = null; continue; }
        if (!huidig) continue;
        const r = leesRegel(regel);
        if (!r) continue;
        switch (r.naam) {
            case 'UID': huidig.uid = r.waarde; break;
            case 'SUMMARY': huidig.titel = ontsnap(r.waarde); break;
            case 'LOCATION': huidig.locatie = ontsnap(r.waarde); break;
            case 'STATUS': huidig.status = r.waarde.toUpperCase(); break;
            case 'DTSTART': huidig.start = leesMoment(r.waarde, r.params); break;
            case 'DTEND': huidig.einde = leesMoment(r.waarde, r.params); break;
            case 'DURATION': huidig.duur = leesDuur(r.waarde); break;
            case 'RRULE': huidig.rrule = leesRrule(r.waarde); break;
            case 'RECURRENCE-ID': huidig.recId = leesMoment(r.waarde, r.params); break;
            case 'EXDATE':
                for (const w of r.waarde.split(',')) { const mo = leesMoment(w, r.params); if (mo) huidig.exdates.push(mo); }
                break;
        }
    }
    return events.filter(e => e.start);
}

// ---------- herhalingen uitbreiden ----------

// Geeft de dagnummers waarop een herhaling valt, oplopend, tot en met totNr
function* herhalingsdagen(startNr, regel, totNr) {
    const sd = new Date(startNr * 864e5);
    const sy = sd.getUTCFullYear(), sm = sd.getUTCMonth() + 1, sdag = sd.getUTCDate();
    const startWeekdag = weekdagVanNr(startNr);
    let teller = 0;
    const naarDagen = (y, m, regelDagen) => {
        const uit = new Set();
        const n = dagenInMaand(y, m);
        for (const dag of regelDagen.bymonthday) { const dd = dag > 0 ? dag : n + dag + 1; if (dd >= 1 && dd <= n) uit.add(dagNr(y, m, dd)); }
        if (regelDagen.byday.length) {
            for (const bd of regelDagen.byday) {
                const lijst = [];
                for (let dd = 1; dd <= n; dd++) if (weekdagVanNr(dagNr(y, m, dd)) === bd.dag) lijst.push(dagNr(y, m, dd));
                if (bd.n === 0) lijst.forEach(x => uit.add(x));
                else { const x = bd.n > 0 ? lijst[bd.n - 1] : lijst[lijst.length + bd.n]; if (x !== undefined) uit.add(x); }
            }
        }
        return [...uit].sort((a, b) => a - b);
    };
    for (let k = 0; k < MAX_ITER; k++) {
        let kandidaten = [];
        let voorbij;
        if (regel.freq === 'DAILY') {
            const n = startNr + k * regel.interval;
            kandidaten = [n]; voorbij = n > totNr;
        } else if (regel.freq === 'WEEKLY') {
            const wkBegin = startNr - ((startWeekdag - regel.wkst + 7) % 7) + k * 7 * regel.interval;
            const dagen = regel.byday.length ? regel.byday.map(b => b.dag) : [startWeekdag];
            kandidaten = dagen.map(d => wkBegin + ((d - regel.wkst + 7) % 7)).sort((a, b) => a - b);
            voorbij = wkBegin > totNr;
        } else if (regel.freq === 'MONTHLY') {
            const mIdx = (sm - 1) + k * regel.interval;
            const y = sy + Math.floor(mIdx / 12), m = (mIdx % 12) + 1;
            const eigen = { bymonthday: regel.bymonthday, byday: regel.byday };
            if (!eigen.bymonthday.length && !eigen.byday.length) eigen.bymonthday = [sdag];
            kandidaten = naarDagen(y, m, eigen);
            voorbij = dagNr(y, m, 1) > totNr;
        } else if (regel.freq === 'YEARLY') {
            const y = sy + k * regel.interval;
            const maanden = regel.bymonth.length ? regel.bymonth : [sm];
            for (const m of maanden.slice().sort((a, b) => a - b)) {
                const eigen = { bymonthday: regel.bymonthday, byday: regel.byday };
                if (!eigen.bymonthday.length && !eigen.byday.length) eigen.bymonthday = [sdag];
                kandidaten.push(...naarDagen(y, m, eigen));
            }
            voorbij = dagNr(y, 1, 1) > totNr;
        } else return;
        for (const n of kandidaten) {
            if (n < startNr) continue;
            if (regel.count && teller >= regel.count) return;
            teller++;
            if (n > totNr) return;
            yield n;
        }
        if (voorbij) return;
        if (regel.count && teller >= regel.count) return;
    }
}

// ---------- afspraken per dag ----------

function sleutel(mo) {
    return mo.heleDag ? `d${mo.y}-${mo.m}-${mo.d}` : `t${momentNaarEpoch(mo)}`;
}

function maakInstanties(events, vanNr, totNr) {
    const overschreven = new Set();
    for (const e of events) if (e.recId && e.uid) overschreven.add(e.uid + '|' + sleutel(e.recId));
    const uit = [];

    const voegToe = (e, startEpoch, eindEpoch, startMo) => {
        const heleDag = startMo.heleDag;
        if (heleDag) {
            const eersteNr = dagNr(startMo.y, startMo.m, startMo.d);
            let laatsteNr = eersteNr;
            if (eindEpoch !== null) laatsteNr = Math.max(eersteNr, eersteNr + Math.round((eindEpoch - startEpoch) / 864e5) - 1);
            for (let n = Math.max(eersteNr, vanNr); n <= Math.min(laatsteNr, totNr); n++) {
                uit.push({ id: `${e.uid || e.titel}|${nrNaarDatum(n)}`, datum: nrNaarDatum(n), titel: e.titel, locatie: e.locatie, start: null, einde: null, heleDag: true });
            }
            return;
        }
        const b = epochNaarLokaal(startEpoch, AGENDA_TZ);
        const eind = eindEpoch !== null && eindEpoch > startEpoch ? epochNaarLokaal(eindEpoch - 1, AGENDA_TZ) : b;
        const eindTijd = eindEpoch !== null && eindEpoch > startEpoch ? epochNaarLokaal(eindEpoch, AGENDA_TZ).tijd : null;
        const eersteNr = datumNaarNr(b.datum), laatsteNr = datumNaarNr(eind.datum);
        for (let n = Math.max(eersteNr, vanNr); n <= Math.min(laatsteNr, totNr); n++) {
            const eerste = n === eersteNr, laatste = n === laatsteNr;
            uit.push({
                id: `${e.uid || e.titel}|${nrNaarDatum(n)}|${b.tijd}`, datum: nrNaarDatum(n), titel: e.titel, locatie: e.locatie,
                start: eerste ? b.tijd : null, einde: laatste ? eindTijd : null, heleDag: !eerste && !laatste
            });
        }
    };

    for (const e of events) {
        if (e.status === 'CANCELLED') continue;
        e.titel = (e.titel || '').trim() || '(geen titel)';
        const s = e.start;
        const startEpoch = s.heleDag ? Date.UTC(s.y, s.m - 1, s.d) : momentNaarEpoch(s);
        let eindEpoch = null;
        if (e.einde) eindEpoch = e.einde.heleDag ? Date.UTC(e.einde.y, e.einde.m - 1, e.einde.d) : momentNaarEpoch(e.einde);
        else if (e.duur != null) eindEpoch = startEpoch + e.duur;
        else if (s.heleDag) eindEpoch = startEpoch + 864e5;
        const duurMs = eindEpoch === null ? null : eindEpoch - startEpoch;

        if (!e.rrule || e.recId) {
            voegToe(e, startEpoch, eindEpoch, s);
            continue;
        }
        const uitgezonderd = new Set(e.exdates.map(sleutel));
        const startNr = dagNr(s.y, s.m, s.d);
        let tot = totNr + 1;
        // Een afspraak kan over meerdere dagen lopen: begin iets eerder met kijken
        const vanafNr = vanNr - (duurMs ? Math.ceil(duurMs / 864e5) + 1 : 1);
        let untilEpoch = null;
        if (e.rrule.until) {
            const u = leesMoment(e.rrule.until, {});
            if (u) { untilEpoch = u.heleDag ? Date.UTC(u.y, u.m - 1, u.d, 23, 59, 59) : momentNaarEpoch(Object.assign({}, u, { tz: s.tz })); }
        }
        for (const n of herhalingsdagen(startNr, e.rrule, tot)) {
            const dd = new Date(n * 864e5);
            const mo = s.heleDag
                ? { heleDag: true, y: dd.getUTCFullYear(), m: dd.getUTCMonth() + 1, d: dd.getUTCDate() }
                : { heleDag: false, y: dd.getUTCFullYear(), m: dd.getUTCMonth() + 1, d: dd.getUTCDate(), h: s.h, mi: s.mi, s: s.s, utc: false, tz: s.utc ? AGENDA_TZ : s.tz };
            let occStart;
            if (s.heleDag) occStart = Date.UTC(mo.y, mo.m - 1, mo.d);
            else if (s.utc) {
                // UTC-afspraken blijven op dezelfde UTC-tijd, tenzij de afspraak in lokale tijd is bedoeld: houd de UTC-tijd aan
                occStart = Date.UTC(mo.y, mo.m - 1, mo.d, s.h, s.mi, s.s);
                mo.utc = true;
            } else occStart = momentNaarEpoch(mo);
            if (untilEpoch !== null && occStart > untilEpoch) break;
            if (n < vanafNr) continue;
            if (uitgezonderd.has(sleutel(mo))) continue;
            if (e.uid && overschreven.has(e.uid + '|' + sleutel(mo))) continue;
            voegToe(e, occStart, duurMs === null ? null : occStart + duurMs, mo);
        }
    }
    uit.sort((a, b) => a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : (b.heleDag - a.heleDag) || String(a.start || '').localeCompare(String(b.start || '')) || a.titel.localeCompare(b.titel));
    return uit;
}

// ---------- ophalen en bewaren ----------

const bronnen = []; // { url, tekst, events, opgehaald, fout }

function stelIn(urls) {
    bronnen.length = 0;
    for (const u of urls) {
        let url = String(u || '').trim();
        if (!url) continue;
        url = url.replace(/^webcal:\/\//i, 'https://');
        if (!/^https?:\/\//i.test(url)) { console.warn('Agenda-adres overgeslagen: het begint niet met https://'); continue; }
        bronnen.push({ url, events: null, opgehaald: 0, fout: '', bezig: null });
    }
    return bronnen.length;
}

async function haalOp(bron) {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 20000);
    try {
        const r = await fetch(bron.url, { signal: ctl.signal, headers: { 'Accept': 'text/calendar, */*' } });
        if (!r.ok) throw new Error('status ' + r.status);
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > MAX_ICS_BYTES) throw new Error('bestand te groot');
        const tekst = buf.toString('utf8');
        if (!/BEGIN:VCALENDAR/i.test(tekst)) throw new Error('geen agenda-bestand');
        bron.events = parseIcs(tekst);
        bron.opgehaald = Date.now();
        bron.fout = '';
    } catch (e) {
        // Nooit het adres of de oorzaak met adres tonen
        bron.fout = e.name === 'AbortError' ? 'time-out bij Google' : (/^(status \d+|bestand te groot|geen agenda-bestand)$/.test(e.message) ? e.message : 'niet bereikbaar');
        console.warn(`${new Date().toLocaleString('nl-NL')}: agenda ophalen mislukt (${bron.fout})`);
    } finally {
        clearTimeout(to);
    }
}

async function ververs(bron) {
    if (bron.events && Date.now() - bron.opgehaald < CACHE_MS) return;
    if (!bron.bezig) bron.bezig = haalOp(bron).finally(() => { bron.bezig = null; });
    await bron.bezig;
}

// Afspraken van alle agenda's voor het bereik van/tot (YYYY-MM-DD, inclusief)
async function afspraken(van, tot) {
    if (!bronnen.length) return { ingesteld: false, agendas: [], events: [] };
    await Promise.all(bronnen.map(ververs));
    const vanNr = datumNaarNr(van), totNr = datumNaarNr(tot);
    let events = [];
    const agendas = [];
    bronnen.forEach((b, i) => {
        agendas.push({ nr: i + 1, ok: !!b.events && !b.fout, verouderd: !!b.events && !!b.fout, fout: b.fout || '', opgehaald: b.opgehaald ? new Date(b.opgehaald).toISOString() : '' });
        if (b.events) events = events.concat(maakInstanties(b.events, vanNr, totNr).map(x => Object.assign({ agenda: i + 1 }, x)));
    });
    events.sort((a, b) => a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : (b.heleDag - a.heleDag) || String(a.start || '').localeCompare(String(b.start || '')) || a.titel.localeCompare(b.titel));
    return { ingesteld: true, agendas, events };
}

module.exports = { stelIn, afspraken, parseIcs, maakInstanties, datumNaarNr, nrNaarDatum, epochNaarLokaal };
