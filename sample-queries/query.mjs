/**
 * DEPRECATED — use `query-v2.mjs`.
 *
 * Kept only so existing references fail loudly rather than silently. It does
 * not run.
 *
 * -- Why it was retired ------------------------------------------------------
 * It ran a substring entity tagger over the user's question and passed every
 * hit into ChromaDB as a hard `where` filter -- it even logged "Applying strict
 * metadata filter". Two measured consequences:
 *
 *   * "what happens on a Sunday" filtered the whole collection to planet_sun,
 *     because includes("sun") matches Sunday. Same for misunderstandings,
 *     sunrise, sunset, sunstrokes.
 *   * "the 21st year" filtered to house_1, because includes("1st") matches
 *     21st. That was 4 of 24 house_1 hits -- a 17% false rate on that tag.
 *
 * A hard filter built from a noisy tagger is worse than no filter: it deletes
 * the correct answers and keeps the wrong ones. That is the mechanism behind
 * the false positives originally reported.
 *
 * It also hardcoded a VM IP, so it worked on exactly one machine.
 *
 * query-v2.mjs uses word-boundary, bilingual entity extraction and lets
 * metadata *rank* rather than exclude, so a tagging error can no longer remove
 * a relevant passage.
 */

console.error(`
query.mjs has been retired.

  Use:  node sample-queries/query-v2.mjs "your question"
        node sample-queries/query-v2.mjs --audit

  Configure with CHROMA_HOST / CHROMA_PORT rather than editing the file.
  See this file's header for why the old filtering produced false positives.
`);
process.exit(1);
