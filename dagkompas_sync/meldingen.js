// Meldingen voor Dagkompas: stuurt via Home Assistant een melding naar je telefoon.
//   - 's ochtends een kort dagoverzicht (afspraken, Top 3, wat te laat is, je aanleergewoonte)
//   - 's avonds een herinnering, alleen als er nog iets openstaat (gewoonte of Top 3)
//
// De add-on gebruikt de eigen verbinding met Home Assistant (geen wachtwoord of token nodig van jou).
// Op het toestel verschijnen alleen aantallen, tijden en namen van gewoontes. Titels van taken en
// afspraken staan bewust niet in een melding, want die zijn te lezen op een vergrendeld scherm.

const agenda = require('./agenda');

const TZ = process.env.AGENDA_TZ || process.env.TZ || 'Europe/Amsterdam';
const TIJD = /^([01]\d|2[0-3]):[0-5]\d$/;
const VENSTER_MIN = 90; // een melding gaat nog weg tot 90 minuten na de ingestelde tijd

const nr = agenda.datumNaarNr, nrNaarDatum = agenda.nrNaarDatum;
const plusDagen = (datum, n) => nrNaarDatum(nr(datum) + n);
const weekdag = datum => (new Date(nr(datum) * 864e5).getUTCDay() + 6) % 7 + 1; // 1 = maandag
const minuten = t => parseInt(t.slice(0, 2), 10) * 60 + parseInt(t.slice(3, 5), 10);

function lokaal(nu) {
    return agenda.epochNaarLokaal(nu.getTime(), TZ);
}

// ---------- overzicht van een dag ----------

const gepland = (r, datum) => (r.days || [1, 2, 3, 4, 5, 6, 7]).includes(weekdag(datum));

function reeksVan(r, dag) {
    const log = new Set(r.log || []);
    const start = r.startDate || plusDagen(dag, -400);
    let s = dag;
    if (gepland(r, s) && !log.has(s)) s = plusDagen(s, -1);
    let n = 0;
    for (let i = 0; i < 400 && s >= start; i++, s = plusDagen(s, -1)) {
        if (!gepland(r, s)) continue;
        if (log.has(s)) n++; else break;
    }
    return n;
}

// items: lijst met de gegevens van alle onderdelen (taken, gewoontes, ...). afspraken: resultaat van agenda.afspraken of null.
function dagoverzicht(items, datum, afspraken, tijdNu) {
    const taken = items.filter(v => v && v.kind === 'task');
    const top = taken.filter(v => v.top === datum);
    const o = {
        datum,
        top: { aantal: top.length, gedaan: top.filter(v => v.done).length },
        laat: taken.filter(v => !v.done && v.due && v.due < datum).length,
        leren: [],
        afspraken: null
    };
    for (const r of items.filter(v => v && v.kind === 'routine' && v.learning)) {
        if (!gepland(r, datum)) continue;
        const log = new Set(r.log || []);
        const gisteren = plusDagen(datum, -1);
        const start = r.startDate || plusDagen(datum, -400);
        o.leren.push({
            titel: r.title || 'Gewoonte', trigger: r.trigger || '', klein: r.small || '',
            gedaan: log.has(datum), reeks: reeksVan(r, datum),
            gemistGisteren: gisteren >= start && gepland(r, gisteren) && !log.has(gisteren) && !log.has(datum)
        });
    }
    if (afspraken && afspraken.ingesteld) {
        const ev = afspraken.events.filter(e => e.datum === datum);
        const komend = ev.filter(e => e.start && (!tijdNu || e.start >= tijdNu)).map(e => e.start).sort();
        o.afspraken = { aantal: ev.length, eerste: komend[0] || '' };
    }
    return o;
}

const meervoud = (n, een, veel) => `${n} ${n === 1 ? een : veel}`;

function ochtendBericht(o) {
    const regels = [];
    if (o.afspraken) {
        regels.push(o.afspraken.aantal === 0
            ? 'Geen afspraken vandaag.'
            : `Vandaag ${meervoud(o.afspraken.aantal, 'afspraak', 'afspraken')}${o.afspraken.eerste ? `, de eerste om ${o.afspraken.eerste}` : ''}.`);
    }
    regels.push(o.top.aantal === 0
        ? 'Kies je Top 3 voor vandaag.'
        : `Je Top 3 staat klaar (${meervoud(o.top.aantal, 'taak', 'taken')}).`);
    if (o.laat > 0) regels.push(`${meervoud(o.laat, 'taak is', 'taken zijn')} te laat.`);
    const open = o.leren.filter(l => !l.gedaan);
    if (open.length) {
        regels.push('Aan het aanleren: ' + open.map(l => l.titel + (l.trigger ? ` (${l.trigger.toLowerCase()})` : '')).join(', ') + '.');
    }
    return { title: 'Goedemorgen', message: regels.join('\n') };
}

function avondBericht(o) {
    const regels = [];
    for (const l of o.leren.filter(x => !x.gedaan)) {
        let r = `${l.titel} staat nog open.`;
        if (l.klein) r += ` Kleinste versie: ${l.klein}.`;
        if (l.gemistGisteren) r += ' Gisteren lukte het niet, dus vandaag telt extra.';
        regels.push(r);
    }
    if (o.top.aantal > 0 && o.top.gedaan < o.top.aantal) {
        regels.push(`Top 3: nog ${o.top.aantal - o.top.gedaan} open.`);
    }
    if (!regels.length) return null; // alles gedaan: geen melding
    return { title: 'Nog even vandaag', message: regels.join('\n') };
}

// ---------- versturen via Home Assistant ----------

function maakVersturen({ apiUrl, token, dienst, appAdres }) {
    return async function stuur(bericht) {
        const ctl = new AbortController();
        const to = setTimeout(() => ctl.abort(), 10000);
        try {
            const doel = (appAdres || '').replace(/\/+$/, '');
            const data = { tag: 'dagkompas', group: 'dagkompas' };
            if (/^https?:\/\//.test(doel)) { data.url = doel + '/#vandaag'; data.clickAction = doel + '/#vandaag'; }
            const r = await fetch(`${apiUrl.replace(/\/+$/, '')}/services/notify/${dienst}`, {
                method: 'POST', signal: ctl.signal,
                headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: bericht.title, message: bericht.message, data })
            });
            if (!r.ok) throw new Error('Home Assistant gaf status ' + r.status);
        } catch (e) {
            if (e.name === 'AbortError') throw new Error('Home Assistant reageert niet');
            throw e;
        } finally {
            clearTimeout(to);
        }
    };
}

// Geldige naam van een meldingsdienst, bijvoorbeeld mobile_app_bjorn_telefoon (met of zonder "notify.")
function schoneDienst(naam) {
    const n = String(naam || '').trim().replace(/^notify\./i, '');
    return /^[a-z0-9_]{1,80}$/.test(n) ? n : '';
}

// ---------- planner ----------

function maakPlanner({ leesItems, haalAfspraken, stuur, tijden, getLaatst, setLaatst, nu = () => new Date(), log = console }) {
    async function controleer() {
        const { datum, tijd } = lokaal(nu());
        for (const soort of ['ochtend', 'avond']) {
            const t = tijden[soort];
            if (!t) continue;
            const verschil = minuten(tijd) - minuten(t);
            if (verschil < 0 || verschil > VENSTER_MIN) continue;
            if (getLaatst(soort) === datum) continue;
            setLaatst(soort, datum); // eerst bewaren, zodat een herstart niet dubbel meldt
            try {
                let afspraken = null;
                try { afspraken = await haalAfspraken(datum, datum); } catch (e) { afspraken = null; }
                const o = dagoverzicht(leesItems(), datum, afspraken, soort === 'ochtend' ? null : tijd);
                const bericht = soort === 'ochtend' ? ochtendBericht(o) : avondBericht(o);
                if (!bericht) continue;
                await stuur(bericht);
                log.log(`${new Date().toLocaleString('nl-NL')}: melding (${soort}) verstuurd.`);
            } catch (e) {
                log.warn(`${new Date().toLocaleString('nl-NL')}: melding (${soort}) mislukt: ${e.message}`);
            }
        }
    }
    return { controleer };
}

function geldigeTijd(t) {
    t = String(t || '').trim();
    return TIJD.test(t) ? t : '';
}

module.exports = { dagoverzicht, ochtendBericht, avondBericht, maakVersturen, maakPlanner, schoneDienst, geldigeTijd };
