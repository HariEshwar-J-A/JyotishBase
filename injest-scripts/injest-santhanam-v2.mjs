#!/usr/bin/env node
/**
 * injest-santhanam-v2.mjs — Structure-aware ingestion of the Santhanam BPHS.
 *
 *   node injest-scripts/injest-santhanam-v2.mjs --dry-run     # inspect, no DB
 *   node injest-scripts/injest-santhanam-v2.mjs               # ingest
 *
 * Environment:
 *   CHROMA_HOST   default 127.0.0.1     (was a hardcoded VM IP)
 *   CHROMA_PORT   default 8000
 *   CHROMA_COLLECTION  default santhanam_source_of_truth
 *
 * ── Why a rewrite rather than a patch ───────────────────────────────────────
 * The reported symptom was "false positives — no proper metadata attached".
 * Measuring the old pipeline on Santhanam_Part1.md showed four compounding
 * causes, and the metadata was only one of them:
 *
 *   1. 29.7% of chunks were mostly Devanagari, embedded with all-MiniLM-L6-v2,
 *      an English-only model. Those vectors are meaningless and can surface for
 *      any query. Largest single cause.
 *   2. Entity tags used substring matching, so `misunderstandings` tagged a
 *      passage as being about the Sun, and `21st` tagged it as the 1st house.
 *   3. Tags knew no Sanskrit, so Surya/Ravi passages went untagged — 74.4% of
 *      chunks had no planet tag, leaving nothing to filter on.
 *   4. Chunks were paragraph fragments (median 164 chars) with no chapter or
 *      verse context, so a retrieved line could not be placed.
 *
 * ── What changed ────────────────────────────────────────────────────────────
 * Units are verse-anchored (sloka + its English commentary), the English is what
 * gets embedded, the Sanskrit is preserved as metadata rather than vectorised,
 * entity tags are word-boundary and bilingual, and every unit carries chapter,
 * verse, language and topic metadata.
 */

import { pipeline, env } from '@xenova/transformers';
import { ChromaClient }  from 'chromadb';
import fs                from 'fs';
import path              from 'path';
import { fileURLToPath } from 'url';

import { buildUnits, devanagariRatio, isOcrNoise } from './lib/structure.mjs';
import { extractEntities }                          from './lib/entities.mjs';

// ---------------------------------------------------------------------------
// MANDATORY: force the WASM backend.
// The host VM lacks AVX instructions; the native onnx backend segfaults there.
// This is a project-wide rule, and the previous script did not honour it.
// ---------------------------------------------------------------------------
env.backends.onnx.node = false;
env.backends.onnx.wasm.numThreads = 1;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');

const DRY_RUN    = process.argv.includes('--dry-run');
const HOST       = process.env.CHROMA_HOST || '127.0.0.1';
const PORT       = Number(process.env.CHROMA_PORT || 8000);
const COLLECTION = process.env.CHROMA_COLLECTION || 'santhanam_source_of_truth';

/** Below this many English characters there is nothing worth retrieving. */
const MIN_ENGLISH_CHARS = 80;
/** MiniLM truncates past ~256 tokens; split longer units on sentence bounds. */
const MAX_CHARS = 900;

// ---------------------------------------------------------------------------

function splitLong(text, max = MAX_CHARS) {
    if (text.length <= max) return [text];
    const sentences = text.split(/(?<=[.!?])\s+/);
    const out = [];
    let buf = '';
    for (const s of sentences) {
        if ((buf + ' ' + s).trim().length > max && buf) { out.push(buf.trim()); buf = s; }
        else buf = (buf + ' ' + s).trim();
    }
    if (buf.trim()) out.push(buf.trim());

    // A single unbroken "sentence" can still exceed the limit — OCR frequently
    // drops terminal punctuation. Hard-cap on whitespace so nothing reaches the
    // embedder above its token window and gets silently truncated.
    const capped = [];
    for (const piece of out) {
        if (piece.length <= max) { capped.push(piece); continue; }
        let rest = piece;
        while (rest.length > max) {
            let cut = rest.lastIndexOf(' ', max);
            if (cut < max * 0.5) cut = max;
            capped.push(rest.slice(0, cut).trim());
            rest = rest.slice(cut).trim();
        }
        if (rest) capped.push(rest);
    }
    return capped;
}

function collectBooks() {
    const base = path.join(ROOT, 'kb-text');
    const dirs = fs.readdirSync(base).filter(f => fs.lstatSync(path.join(base, f)).isDirectory());
    const files = [];
    for (const d of dirs) {
        for (const f of fs.readdirSync(path.join(base, d))) {
            if (f.endsWith('.md')) files.push({ dir: d, file: f, full: path.join(base, d, f) });
        }
    }
    return files;
}

// ---------------------------------------------------------------------------

async function main() {
    const books = collectBooks();
    console.log(`Found ${books.length} markdown source(s) under kb-text/\n`);

    const records = [];
    const stats = { units: 0, kept: 0, ocrNoise: 0, tooShort: 0, split: 0, withVerse: 0, withChapter: 0 };

    for (const b of books) {
        const md = fs.readFileSync(b.full, 'utf-8');
        const units = buildUnits(md, b.file);
        stats.units += units.length;

        for (const u of units) {
            if (!u.english || u.english.length < MIN_ENGLISH_CHARS) { stats.tooShort++; continue; }
            if (isOcrNoise(u.english)) { stats.ocrNoise++; continue; }

            const pieces = splitLong(u.english);
            if (pieces.length > 1) stats.split += pieces.length - 1;

            pieces.forEach((piece, partIdx) => {
                const { flags, summary } = extractEntities(`${piece} ${u.sectionTitle || ''} ${u.chapterTitle || ''}`);
                if (u.verseNum != null) stats.withVerse++;
                if (u.chapterNum != null) stats.withChapter++;

                records.push({
                    id: `${b.file}::ch${u.chapterNum ?? 'x'}::v${u.verseNum ?? 'x'}::${records.length}`,
                    document: piece,
                    metadata: {
                        source: 'Santhanam BPHS',
                        book: b.dir,
                        file: b.file,
                        // Only explicitly-headed chapters are citable; see
                        // assignChapters() in lib/structure.mjs.
                        chapter: u.chapterNum ?? -1,
                        chapter_confidence: u.chapterConfidence || 'unknown',
                        segment: u.segment ?? -1,
                        chapter_title: u.chapterNum != null ? (u.chapterTitle || '') : '',
                        section: u.sectionTitle || '',
                        verse: u.verseNum ?? -1,
                        part: partIdx,
                        // Sanskrit is preserved but never embedded — it is the
                        // citation, not the retrieval surface.
                        sanskrit: u.sanskrit ? u.sanskrit.slice(0, 1500) : '',
                        has_sanskrit: Boolean(u.sanskrit),
                        lang: 'en',
                        char_count: piece.length,
                        ...summary,
                        ...flags,
                    },
                });
            });
            stats.kept++;
        }
    }

    // ── Report ──────────────────────────────────────────────────────────────
    console.log('── Ingestion units ─────────────────────────────');
    console.log(`  verse units found      : ${stats.units}`);
    console.log(`  kept                   : ${stats.kept}`);
    console.log(`  dropped, too short     : ${stats.tooShort}`);
    console.log(`  dropped, OCR noise     : ${stats.ocrNoise}`);
    console.log(`  extra pieces from split: ${stats.split}`);
    console.log(`  final records          : ${records.length}`);

    const withCh = records.filter(r => r.metadata.chapter > 0).length;
    const conf = {};
    for (const r of records) conf[r.metadata.chapter_confidence] = (conf[r.metadata.chapter_confidence] || 0) + 1;
    const withV  = records.filter(r => r.metadata.verse > 0).length;
    const withE  = records.filter(r => r.metadata.entity_count > 0).length;
    const devLeft = records.filter(r => devanagariRatio(r.document) > 0.25).length;
    console.log('\n── Metadata coverage ───────────────────────────');
    console.log(`  citable chapter : ${withCh} (${(100*withCh/records.length).toFixed(1)}%)  [only explicit headings]`);
    console.log(`  chapter confidence: ${JSON.stringify(conf)}`);
    console.log(`  with verse   : ${withV} (${(100*withV/records.length).toFixed(1)}%)`);
    console.log(`  with entities: ${withE} (${(100*withE/records.length).toFixed(1)}%)   <- was 25.6% before`);
    console.log(`  Devanagari-heavy documents still being embedded: ${devLeft}   <- was 987`);

    const lens = records.map(r => r.document.length).sort((a,b)=>a-b);
    console.log(`  doc length p50=${lens[Math.floor(lens.length/2)]} p90=${lens[Math.floor(lens.length*0.9)]} max=${lens[lens.length-1]}`);

    if (DRY_RUN) {
        const out = path.join(ROOT, 'structured_data');
        fs.mkdirSync(out, { recursive: true });
        const f = path.join(out, 'bphs_units.preview.json');
        fs.writeFileSync(f, JSON.stringify(records.slice(0, 40), null, 2));
        fs.writeFileSync(path.join(out, 'bphs_units.json'), JSON.stringify(records, null, 2));
        console.log(`\nDry run — wrote ${records.length} records to structured_data/bphs_units.json`);
        console.log(`Sample of 40 in bphs_units.preview.json for eyeballing.`);
        return;
    }

    // ── Embed + store ───────────────────────────────────────────────────────
    console.log('\nLoading embedding model (WASM backend)...');
    const embed = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

    const client = new ChromaClient({ host: HOST, port: PORT });
    try { await client.deleteCollection({ name: COLLECTION }); } catch { /* first run */ }
    const collection = await client.getOrCreateCollection({
        name: COLLECTION,
        metadata: { 'hnsw:space': 'cosine' },
    });

    const BATCH = 64;
    for (let i = 0; i < records.length; i += BATCH) {
        const batch = records.slice(i, i + BATCH);
        const embeddings = [];
        for (const r of batch) {
            const o = await embed(r.document, { pooling: 'mean', normalize: true });
            embeddings.push(Array.from(o.data));
        }
        await collection.add({
            ids:        batch.map(r => r.id),
            embeddings,
            metadatas:  batch.map(r => r.metadata),
            documents:  batch.map(r => r.document),
        });
        process.stdout.write(`\r  ingested ${Math.min(i + BATCH, records.length)}/${records.length}`);
    }
    console.log(`\n\nDone. Collection "${COLLECTION}" on ${HOST}:${PORT}.`);
}

main().catch(e => { console.error(e); process.exit(1); });
