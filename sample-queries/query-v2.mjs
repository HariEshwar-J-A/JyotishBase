#!/usr/bin/env node
/**
 * query-v2.mjs — Retrieval against the structure-aware collection.
 *
 *   node sample-queries/query-v2.mjs "effects of Saturn in the 7th house"
 *   node sample-queries/query-v2.mjs --audit          # false-positive report
 *
 * ── The filtering mistake the old query script made ─────────────────────────
 * It ran the *same* substring tagger over the user's question and turned every
 * hit into a hard `where` filter. Asking "what happens on a Sunday?" therefore
 * filtered to `planet_sun`, and asking about "the 21st year" filtered to
 * `house_1`. A hard filter built from a noisy tagger removes the right answers
 * and keeps the wrong ones.
 *
 * Here, entity extraction is word-boundary and bilingual, and the tags are used
 * to *rank* rather than to exclude: the vector search runs unfiltered, then
 * results whose metadata matches the question's entities are boosted. Nothing
 * relevant can be filtered away by a tagging error.
 */

import { pipeline, env } from '@xenova/transformers';
import { ChromaClient }  from 'chromadb';
import { extractEntities } from '../injest-scripts/lib/entities.mjs';

env.backends.onnx.node = false;
env.backends.onnx.wasm.numThreads = 1;

const HOST = process.env.CHROMA_HOST || '127.0.0.1';
const PORT = Number(process.env.CHROMA_PORT || 8000);
const COLLECTION = process.env.CHROMA_COLLECTION || 'santhanam_source_of_truth';

const AUDIT = process.argv.includes('--audit');
const QUERY = process.argv.slice(2).filter(a => !a.startsWith('--')).join(' ');

/**
 * Boost per matching metadata flag. Tuned to reorder, not to dominate.
 *
 * A division match is worth far more than a topic match. `topic_varga` is broad
 * enough to cover both the D2 chart and the planetary hour behind Hora Bala,
 * which is how a strength passage once outranked the actual D2 definition.
 * `division_2` names the thing being asked about, so it earns a much larger
 * weight than the generic topic.
 */
const ENTITY_BOOST   = 0.06;
const DIVISION_BOOST = 0.25;

function cite(m) {
    const ch = m.chapter > 0 ? `ch.${m.chapter}` : '';
    const v  = m.verse   > 0 ? `v.${m.verse}`   : '';
    const s  = m.section ? ` — ${m.section}` : (m.chapter_title ? ` — ${m.chapter_title}` : '');
    return `${[ch, v].filter(Boolean).join(' ')}${s}`.trim() || '(unplaced)';
}

async function search(collection, embed, question, k = 5) {
    const q = await embed(question, { pooling: 'mean', normalize: true });
    const res = await collection.query({
        queryEmbeddings: [Array.from(q.data)],
        nResults: 25,
        include: ['documents', 'metadatas', 'distances'],
    });

    const { flags } = extractEntities(question);
    const wanted = Object.keys(flags);

    const scored = res.ids[0].map((id, i) => {
        const meta = res.metadatas[0][i];
        const matched = wanted.filter(f => meta[f] === true);
        const divisionHits = matched.filter(f => f.startsWith('division_')).length;
        const otherHits    = matched.length - divisionHits;
        // Chroma cosine distance: lower is better. Subtract the boosts.
        const score = res.distances[0][i]
                    - divisionHits * DIVISION_BOOST
                    - otherHits * ENTITY_BOOST;
        return { id, meta, doc: res.documents[0][i], dist: res.distances[0][i], matched, score };
    });

    scored.sort((a, b) => a.score - b.score);
    return { results: scored.slice(0, k), wanted };
}

// ---------------------------------------------------------------------------

const embed = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
const client = new ChromaClient({ host: HOST, port: PORT });
const collection = await client.getCollection({ name: COLLECTION });

if (AUDIT) {
    // Questions whose correct answers are unambiguous, plus two traps that the
    // old substring tagger demonstrably got wrong.
    const probes = [
        { q: 'effects of Saturn in the 7th house',        expect: ['planet_saturn'] },
        { q: 'what are the effects of the 10th house',    expect: ['house_10'] },
        { q: 'Vimshottari dasha calculation',             expect: ['topic_dasha'] },
        { q: 'how is Navamsa D9 calculated',              expect: ['topic_varga'] },
        { q: 'remedies for premature death',              expect: ['topic_remedies', 'topic_longevity'] },
        { q: 'effects of Surya in Mesha',                 expect: ['planet_sun', 'sign_1'] },
        // Traps: the old tagger tagged these planet_sun / house_1.
        { q: 'what happens on a Sunday',                  expect: [] },
        { q: 'events in the 21st year of life',           expect: [] },
    ];

    console.log('Retrieval audit — top-5 relevance\n');
    let totalMatched = 0, totalTop = 0;
    for (const p of probes) {
        const { results, wanted } = await search(collection, embed, p.q);
        const hits = results.filter(r => p.expect.length === 0 || r.matched.length > 0).length;
        totalMatched += hits; totalTop += results.length;
        console.log(`Q: "${p.q}"`);
        console.log(`   question entities: ${wanted.join(', ') || '(none — no filter applied)'}`);
        for (const r of results.slice(0, 3)) {
            console.log(`   [${cite(r.meta)}] d=${r.dist.toFixed(3)} tags=${r.matched.join(',') || '-'}`);
            console.log(`      ${r.doc.slice(0, 110).replace(/\s+/g, ' ')}...`);
        }
        console.log('');
    }
    console.log(`Entity-consistent results in top-5: ${totalMatched}/${totalTop}`);
} else {
    if (!QUERY) { console.error('usage: node sample-queries/query-v2.mjs "your question"'); process.exit(2); }
    const { results, wanted } = await search(collection, embed, QUERY);
    console.log(`Q: ${QUERY}`);
    console.log(`entities detected: ${wanted.join(', ') || '(none)'}\n`);
    results.forEach((r, i) => {
        console.log(`${i + 1}. [${cite(r.meta)}]  distance ${r.dist.toFixed(4)}  matched: ${r.matched.join(',') || '-'}`);
        console.log(`   ${r.doc.replace(/\s+/g, ' ')}`);
        if (r.meta.sanskrit) console.log(`   sloka: ${r.meta.sanskrit.split('\n')[0].slice(0, 90)}`);
        console.log('');
    });
}
