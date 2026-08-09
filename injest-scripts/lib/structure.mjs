/**
 * structure.mjs — Turn the OCR'd Santhanam BPHS markdown into retrievable units.
 *
 * ── Why the original chunking produced false positives ──────────────────────
 * Measured on Santhanam_Part1.md with the previous `split(/\n\s*\n/)` approach:
 *
 *   3320 chunks, median length 164 chars
 *   987 chunks (29.7%) are >30% Devanagari, embedded with all-MiniLM-L6-v2 —
 *        an English-only model. Those vectors are close to meaningless, so they
 *        sit at effectively random positions and can surface for ANY query.
 *        This is the single largest source of false positives.
 *   2471 chunks (74.4%) carried no planet tag at all; 136 (4.1%) carried five or
 *        more. Metadata filtering could therefore neither narrow nor widen
 *        usefully.
 *   76 chunks exceed 1000 chars and were silently truncated by MiniLM's
 *        256-token window.
 *   No chapter or verse metadata existed, so a retrieved paragraph like
 *        "he will be wealthy" had nothing to say which rule it belonged to.
 *
 * ── What this module does instead ───────────────────────────────────────────
 * BPHS is verse-structured: a Sanskrit sloka, then Santhanam's English
 * translation and commentary. The 1198 surviving `॥N॥` markers give a reliable
 * spine even though OCR mangled most chapter headings.
 *
 * Each unit is therefore a *verse group*: the sloka plus the English prose that
 * follows it, up to the next verse marker. The English is what gets embedded;
 * the Sanskrit is preserved as metadata rather than vectorised, which removes
 * the noise without discarding the source.
 */

/** Devanagari digits → Arabic. */
const DEVANAGARI_DIGITS = '०१२३४५६७८९';

export function devanagariToInt(s) {
    let out = '';
    for (const ch of s) {
        const i = DEVANAGARI_DIGITS.indexOf(ch);
        out += i >= 0 ? String(i) : (/[0-9]/.test(ch) ? ch : '');
    }
    return out.length ? parseInt(out, 10) : null;
}

/** Fraction of characters that are Devanagari. */
export function devanagariRatio(text) {
    if (!text.length) return 0;
    return (text.match(/[ऀ-ॿ]/g) || []).length / text.length;
}

/**
 * Is this line plausible English prose, or OCR wreckage?
 *
 * The scan produced lines like `sM qilTuITESrTtsrtFt: lt I ll` — Devanagari
 * misread as Latin. Embedding those adds pure noise, so they are flagged and
 * excluded from the vector store while remaining in the raw record.
 */
export function isOcrNoise(text) {
    const letters = (text.match(/[A-Za-z]/g) || []).length;
    if (letters < 12) return false;                  // too short to judge
    const words = text.split(/\s+/).filter(w => /[A-Za-z]/.test(w));
    if (!words.length) return false;

    // Real English words are mostly lowercase with vowels. OCR garbage is not.
    const vowelless = words.filter(w => w.length > 3 && !/[aeiouAEIOU]/.test(w)).length;
    const caseChaos = words.filter(w => /[a-z][A-Z]/.test(w)).length;

    return (vowelless / words.length) > 0.35 || (caseChaos / words.length) > 0.35;
}

/** Chapter heading, tolerating the OCR variants seen in the source. */
const CHAPTER_RE = /^#{1,4}\s*(?:Ch[ar]?[ap]?[tf]er)\s*([0-9]+)\s*(.*)$/i;
/** Numbered contents-style heading: `#### 16. EFFECTS OF THE 5th HOUSE`. */
const NUMBERED_RE = /^#{1,4}\s*\.?\s*([0-9]{1,2})\.\s*(.+)$/;
/** Verse marker `॥१६॥`, sometimes with a stray space or latin digits. */
const VERSE_RE = /॥\s*([०-९0-9]+)\s*॥/;

/**
 * English verse opener: `5-6. Rāśi and Horā.` or `12. NAVAMSA:`.
 *
 * Born-digital sources such as BPHS.pdf carry no Devanagari at all, so the
 * sloka spine has to come from the English numbering instead. Anchored to the
 * line start and capped at three digits so page numbers and ordinary decimals
 * in running prose do not masquerade as verses.
 */
const ENGLISH_VERSE_RE = /^(\d{1,3})(?:[-–]\d{1,3})?(?:½)?\.\s+\S/;

/**
 * Split a markdown book into verse-anchored units.
 *
 * @param {string} markdown  file contents
 * @param {string} sourceFile  file name, recorded on every unit
 * @returns {Array<object>} units with text + structural metadata
 */
export function buildUnits(markdown, sourceFile) {
    const lines = markdown.split('\n');

    let chapterNum = null;
    let chapterTitle = null;
    let sectionTitle = null;
    // Set when a `Chapter N` heading is read, consumed by the next unit created.
    // Without this, every unit inherits the running chapter and looks equally
    // authoritative, which is what made the first attempt report 89.9%
    // "explicit" chapters when only 24 headings survive in the whole book.
    let pendingChapterHeading = false;

    const units = [];
    let cur = null;

    const flush = () => {
        if (!cur) return;
        const sanskrit = cur.sanskrit.join('\n').trim();
        const english  = cur.english.join('\n').trim();
        if (sanskrit || english) units.push({ ...cur, sanskrit, english });
        cur = null;
    };

    const start = () => {
        const u = {
            sourceFile,
            chapterNum, chapterTitle, sectionTitle,
            headingSeen: pendingChapterHeading,
            verseNum: null,
            sanskrit: [], english: [],
        };
        pendingChapterHeading = false;
        return u;
    };

    for (const raw of lines) {
        const line = raw.trimEnd();
        if (!line.trim()) continue;

        // ── Structural headings update the running context ──────────────────
        const chap = line.match(CHAPTER_RE);
        if (chap) {
            flush();
            chapterNum = parseInt(chap[1], 10);
            chapterTitle = (chap[2] || '').trim() || null;
            sectionTitle = null;
            pendingChapterHeading = true;
            continue;
        }
        const numbered = line.match(NUMBERED_RE);
        if (numbered && /^#/.test(line) && devanagariRatio(line) < 0.2) {
            flush();
            sectionTitle = numbered[2].trim();
            continue;
        }
        // A title-only heading right after `Chapter N` names that chapter.
        if (/^#{1,3}\s/.test(line) && devanagariRatio(line) < 0.2 && chapterNum && !chapterTitle) {
            const t = line.replace(/^#+\s*/, '').trim();
            if (t.length > 3 && !isOcrNoise(t)) { chapterTitle = t; continue; }
        }

        if (!cur) cur = start();

        // ── Verse marker closes the current unit ────────────────────────────
        const verse = line.match(VERSE_RE);
        const devHeavy = devanagariRatio(line) > 0.25;

        // English-numbered sources: a new verse number starts a new unit.
        const engVerse = !devHeavy && line.match(ENGLISH_VERSE_RE);
        if (engVerse) {
            if (cur.english.length || cur.sanskrit.length) {
                flush();
                cur = start();
            }
            cur.verseNum = parseInt(engVerse[1], 10);
            cur.english.push(line);
            continue;
        }

        if (devHeavy) {
            // A fresh sloka arriving after we already have a numbered verse and
            // its commentary means the previous unit is complete. Flushing here
            // is what keeps units verse-sized; without it the whole book
            // collapses into a handful of enormous blocks.
            if (cur.verseNum !== null && cur.english.length) {
                flush();
                cur = start();
            }
            cur.sanskrit.push(line.replace(/^#+\s*/, ''));
            if (verse) cur.verseNum = devanagariToInt(verse[1]);
            continue;
        }

        cur.english.push(line.replace(/^#+\s*/, ''));
    }
    flush();

    // Merge units that ended up with no English at all into the next one, so a
    // bare sloka is never stored alone with nothing to retrieve on.
    const merged = [];
    for (const u of units) {
        if (!u.english && merged.length === 0) { merged.push(u); continue; }
        if (!u.english && merged.length) {
            const prev = merged[merged.length - 1];
            prev.sanskrit = [prev.sanskrit, u.sanskrit].filter(Boolean).join('\n');
            continue;
        }
        merged.push(u);
    }

    return assignChapters(merged);
}

/**
 * Reconstruct chapter numbers, and say honestly how confident each one is.
 *
 * OCR destroyed most chapter headings: only 24 of the roughly 97 chapters in
 * BPHS survive as a parseable `Chapter N`. Carrying the last seen number forward
 * produced citations like "ch.9" covering 767 units spanning verses 1–144 — a
 * confident number that is wrong for most of what it labels. A wrong citation is
 * worse than no citation, because it is checkable and will be checked.
 *
 * Verse numbering restarts at 1 in each chapter, so a drop in verse number is an
 * independent boundary signal. Combining the two:
 *
 *   'explicit' — an actual `Chapter N` heading was seen; the number is real.
 *   'inferred' — a verse-number reset implied a boundary; the *boundary* is
 *                sound but the number is a running count, so it is not emitted
 *                as a citable chapter.
 *   'unknown'  — neither signal available.
 *
 * Only `explicit` chapters are surfaced for citation. The rest carry a stable
 * `segment` id so passages from the same run still group together.
 */
function assignChapters(units) {
    let explicitChapter = null;
    let segment = 0;
    let prevVerse = null;
    let sinceExplicit = 0;

    for (const u of units) {
        if (u.headingSeen && u.chapterNum != null) {
            explicitChapter = u.chapterNum;
            segment++;
            sinceExplicit = 0;
            prevVerse = null;
        } else if (u.verseNum != null && prevVerse != null && u.verseNum < prevVerse) {
            // Verse counter went backwards — a new chapter began, but we do not
            // know its number, so the explicit one is no longer trustworthy.
            segment++;
            sinceExplicit++;
            explicitChapter = null;
        }

        if (u.verseNum != null) prevVerse = u.verseNum;

        u.segment = segment;
        u.chapterConfidence = explicitChapter != null
            ? (sinceExplicit === 0 ? 'explicit' : 'inferred')
            : (u.verseNum != null ? 'inferred' : 'unknown');
        u.chapterNum = u.chapterConfidence === 'explicit' ? explicitChapter : null;
    }
    return units;
}
