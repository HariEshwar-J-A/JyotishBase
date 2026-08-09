/**
 * entities.mjs — Jyotish entity extraction for retrieval metadata.
 *
 * ── What was wrong before ───────────────────────────────────────────────────
 * The original tagger did `textLower.includes("sun")`. Measured against
 * Santhanam_Part1.md, that fires on:
 *
 *   sunapha, sunrise, sunset, sunstrokes, misunderstandings, sunday
 *
 * `misunderstandings` tagging a passage as being about the Sun is exactly the
 * kind of result that destroys trust in a RAG answer. Likewise `includes("1st")`
 * matched `21st`, `31st` and `41st` — 4 of the 24 `house_1` hits, a 17% false
 * rate on that tag alone.
 *
 * Worse, the tagger only knew English names. BPHS overwhelmingly uses Sanskrit:
 * a passage about Surya, Ravi or Bhaskara was never tagged as being about the
 * Sun at all. That is why 74.4% of chunks carried no planet tag — the metadata
 * could not narrow a search, so every query fell back to raw vector similarity.
 *
 * ── Approach here ───────────────────────────────────────────────────────────
 * Word-boundary matching against a curated lexicon that includes the Sanskrit
 * names actually used in the text. `sunapha` no longer matches the Sun; `Surya`
 * now does.
 *
 * Chroma metadata values must be scalars, so entities are emitted as boolean
 * flags (`planet_sun: true`) for `where` filtering, plus a comma-joined summary
 * string for display.
 */

/**
 * Planet lexicon. English name → all forms that appear in the text.
 *
 * Sunapha/Anapha/Durudhara are *yogas* named after the Moon's neighbours, not
 * the Sun, and are deliberately excluded.
 */
export const PLANETS = {
    sun:     ['sun', 'surya', 'surya', 'ravi', 'bhaskara', 'aditya', 'arka', 'saura'],
    moon:    ['moon', 'chandra', 'soma', 'sasi', 'shashi', 'indu', 'nisakara'],
    mars:    ['mars', 'mangala', 'kuja', 'angaraka', 'bhauma', 'bhumija', 'sevvai'],
    mercury: ['mercury', 'budha', 'budh', 'saumya', 'soumya'],
    jupiter: ['jupiter', 'guru', 'brihaspati', 'brhaspati', 'jiva', 'jeeva', 'devaguru'],
    venus:   ['venus', 'sukra', 'shukra', 'bhrigu', 'bhargava', 'kavi'],
    saturn:  ['saturn', 'sani', 'shani', 'manda', 'sauri', 'yama'],
    rahu:    ['rahu', 'raahu', 'dragons head'],
    ketu:    ['ketu', 'kethu', 'dragons tail'],
};

/** Rasi lexicon, English and Sanskrit. */
export const SIGNS = {
    1:  ['aries', 'mesha', 'mesa'],
    2:  ['taurus', 'vrishabha', 'vrsabha', 'rishabha'],
    3:  ['gemini', 'mithuna'],
    4:  ['cancer', 'karka', 'kataka', 'karkata'],
    5:  ['leo', 'simha'],
    6:  ['virgo', 'kanya'],
    7:  ['libra', 'tula', 'thula'],
    8:  ['scorpio', 'vrischika', 'vrscika'],
    9:  ['sagittarius', 'dhanus', 'dhanu'],
    10: ['capricorn', 'makara'],
    11: ['aquarius', 'kumbha'],
    12: ['pisces', 'meena', 'mina'],
};

/** House ordinals and their Sanskrit bhava names. */
export const HOUSES = {
    1:  ['1st', 'first house', 'lagna', 'ascendant', 'tanu bhava'],
    2:  ['2nd', 'second house', 'dhana bhava'],
    3:  ['3rd', 'third house', 'sahaja bhava'],
    4:  ['4th', 'fourth house', 'bandhu bhava', 'sukha bhava'],
    5:  ['5th', 'fifth house', 'putra bhava'],
    6:  ['6th', 'sixth house', 'ari bhava', 'shatru bhava'],
    7:  ['7th', 'seventh house', 'kalatra bhava', 'yuvati bhava'],
    8:  ['8th', 'eighth house', 'randhra bhava', 'ayur bhava'],
    9:  ['9th', 'ninth house', 'dharma bhava', 'bhagya bhava'],
    10: ['10th', 'tenth house', 'karma bhava'],
    11: ['11th', 'eleventh house', 'labha bhava'],
    12: ['12th', 'twelfth house', 'vyaya bhava'],
};

/**
 * Divisional charts, tagged by number.
 *
 * `topic_varga` alone cannot answer "what is the D2 rule", because BPHS uses
 * "Hora" for two unrelated things: the D2 chart, and the planetary hour that
 * feeds Hora Bala. Both mention Hora, both are varga-adjacent, and the wrong
 * sense outranked the right one in testing. An LLM handed that top hit answers
 * the D2 question with a strength rule, confidently.
 *
 * `exclude` lists context words that mean the *other* sense. When one is
 * present the division tag is withheld, so a strength passage never claims to
 * define a chart.
 */
export const DIVISIONS = {
    1:  { names: ['rasi', 'raasi', 'rāśi', 'd-1', 'd1'] },
    2:  { names: ['hora', 'horā'], exclude: ['bala', 'strength', 'planetary hour',
                                             'week day', 'weekday', 'sunrise to sunrise',
                                             '24 equal parts'] },
    3:  { names: ['drekkana', 'dreshkan', 'decanate', 'drekkan', 'd-3', 'd3'] },
    4:  { names: ['chaturthamsa', 'chaturthāńś', 'turyamsa', 'd-4', 'd4'] },
    7:  { names: ['saptamsa', 'saptāńś', 'sapthamamsa', 'd-7', 'd7'] },
    9:  { names: ['navamsa', 'navāńś', 'navamsha', 'd-9', 'd9'] },
    10: { names: ['dasamsa', 'dashāńś', 'dasamamsa', 'd-10', 'd10'] },
    12: { names: ['dvadasamsa', 'dwadasamsa', 'dvadashāńś', 'd-12', 'd12'] },
    16: { names: ['shodasamsa', 'shodashāńś', 'kalamsa', 'd-16', 'd16'] },
    20: { names: ['vimsamsa', 'vimshāńś', 'd-20', 'd20'] },
    24: { names: ['siddhamsa', 'chaturvimsamsa', 'chaturvimshāńś', 'd-24', 'd24'] },
    27: { names: ['bhamsa', 'nakshatramsa', 'saptavimsamsa', 'saptavimshāńś', 'd-27', 'd27'] },
    30: { names: ['trimsamsa', 'trimshāńś', 'd-30', 'd30'] },
    40: { names: ['khavedamsa', 'chatvarimsamsa', 'khavedāńś', 'd-40', 'd40'] },
    45: { names: ['akshavedamsa', 'akshavedāńś', 'd-45', 'd45'] },
    60: { names: ['shashtiamsa', 'shashtyamsa', 'shashtiāńś', 'd-60', 'd60'] },
};

/** Topic lexicon — what a passage is *about*, which is what users query. */
export const TOPICS = {
    dasha:      ['dasa', 'dasha', 'antardasa', 'bhukti', 'vimsottari', 'vimshottari', 'mahadasa'],
    varga:      ['varga', 'navamsa', 'drekkana', 'hora', 'dasamsa', 'shashtiamsa', 'divisional'],
    yoga:       ['yoga', 'raja yoga', 'dhana yoga', 'combination'],
    aspect:     ['aspect', 'drishti', 'drsti'],
    strength:   ['bala', 'shadbala', 'sthana bala', 'dig bala', 'kaala bala',
                 'chesta bala', 'drik bala', 'naisargika', 'strength', 'rupas'],
    muhurta:    ['planetary hour', 'week day', 'weekday', 'sunrise to sunrise',
                 'hora lord', 'ghatika', 'muhurta'],
    longevity:  ['longevity', 'ayur', 'ayush', 'maraka', 'marana'],
    marriage:   ['marriage', 'wife', 'husband', 'spouse', 'kalatra'],
    children:   ['children', 'progeny', 'putra', 'santana'],
    wealth:     ['wealth', 'dhana', 'riches', 'poverty', 'penury'],
    profession: ['profession', 'career', 'occupation', 'livelihood'],
    remedies:   ['remedy', 'remedial', 'santi', 'shanti', 'propitiation'],
    nakshatra:  ['nakshatra', 'naksatra', 'constellation', 'asterism'],
    arudha:     ['arudha', 'pada', 'upapada'],
    karaka:     ['karaka', 'karakatwa', 'atmakaraka', 'significator'],
};

/** Escape a term and wrap it in word boundaries. */
function termRegex(term) {
    const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // \b does not behave for multi-word terms with spaces, so anchor on
    // non-word characters instead.
    // A trailing plural "s" is allowed: the text pluralises freely
    // ("the Dasamamsas are counted from..."), and those passages went untagged.
    return new RegExp(`(?:^|[^a-z0-9])${esc}s?(?:[^a-z0-9]|$)`, 'i');
}

const compile = (lexicon) => {
    const out = {};
    for (const [key, terms] of Object.entries(lexicon)) {
        out[key] = terms.map(termRegex);
    }
    return out;
};

/** Divisions compile to {re[], excludeRe[]} rather than a flat regex list. */
const DIVISION_RE = Object.fromEntries(
    Object.entries(DIVISIONS).map(([n, d]) => [n, {
        names:   d.names.map(termRegex),
        exclude: (d.exclude || []).map(termRegex),
    }]),
);

/**
 * Divisions present in a passage.
 *
 * A name match is withheld when an exclusion term is also present, which is how
 * "Hora Bala ... 24 equal parts ... ruled by the Lord of the week day" avoids
 * claiming to define the D2 chart.
 */
function matchDivisions(text) {
    const hits = [];
    for (const [n, { names, exclude }] of Object.entries(DIVISION_RE)) {
        if (!names.some(re => re.test(text))) continue;
        if (exclude.length && exclude.some(re => re.test(text))) continue;
        hits.push(Number(n));
    }
    return hits;
}

const PLANET_RE = compile(PLANETS);
const SIGN_RE   = compile(SIGNS);
const HOUSE_RE  = compile(HOUSES);
const TOPIC_RE  = compile(TOPICS);

function matchAll(text, compiled) {
    const hits = [];
    for (const [key, regexes] of Object.entries(compiled)) {
        if (regexes.some(re => re.test(text))) hits.push(key);
    }
    return hits;
}

/**
 * Extract entities from a passage.
 *
 * @returns {{flags: object, summary: object}} `flags` is Chroma-filterable
 *          booleans; `summary` holds joined strings for display and debugging.
 */
export function extractEntities(text) {
    const planets = matchAll(text, PLANET_RE);
    const signs   = matchAll(text, SIGN_RE);
    const houses  = matchAll(text, HOUSE_RE);
    const topics  = matchAll(text, TOPIC_RE);
    const divisions = matchDivisions(text);

    const flags = {};
    for (const d of divisions) flags[`division_${d}`] = true;
    for (const p of planets) flags[`planet_${p}`] = true;
    for (const s of signs)   flags[`sign_${s}`]   = true;
    for (const h of houses)  flags[`house_${h}`]  = true;
    for (const t of topics)  flags[`topic_${t}`]  = true;

    return {
        flags,
        summary: {
            planets: planets.join(',') || '',
            signs:   signs.join(',')   || '',
            houses:  houses.join(',')  || '',
            topics:  topics.join(',')  || '',
            divisions: divisions.join(',') || '',
            entity_count: planets.length + signs.length + houses.length
                        + topics.length + divisions.length,
        },
    };
}
