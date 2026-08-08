/**
 * DEPRECATED -- use `injest-santhanam-v2.mjs`.
 *
 * Kept only so existing references fail loudly rather than silently. It does
 * not run.
 *
 * -- Why it was retired ------------------------------------------------------
 * Measured on Santhanam_Part1.md, this pipeline had four compounding defects:
 *
 *   1. 987 of 3320 chunks (29.7%) were mostly Devanagari yet were embedded with
 *      all-MiniLM-L6-v2, an English-only model. Those vectors are meaningless
 *      and could surface for any query. Largest single cause of false hits.
 *   2. Entity tags used substring matching, so `misunderstandings` tagged a
 *      passage as being about the Sun and `21st` as the 1st house.
 *   3. The lexicon knew no Sanskrit, so Surya/Ravi/Bhaskara went untagged --
 *      74.4% of chunks carried no planet tag at all.
 *   4. Chunks were paragraph fragments (median 164 chars) with no chapter or
 *      verse metadata, and 76 exceeded MiniLM's token window and were silently
 *      truncated.
 *
 * It also omitted the project-wide WASM rule (env.backends.onnx.node = false),
 * which segfaults on hosts without AVX, and hardcoded a VM IP address.
 */

console.error(`
injest-santhanam.mjs has been retired.

  Use:  node injest-scripts/injest-santhanam-v2.mjs --dry-run   # inspect first
        node injest-scripts/injest-santhanam-v2.mjs             # ingest

  Configure with CHROMA_HOST / CHROMA_PORT / CHROMA_COLLECTION.
  See this file's header for what was wrong with the old pipeline.
`);
process.exit(1);
