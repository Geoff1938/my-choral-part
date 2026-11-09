/**
 * URL slugs for composer and work names.
 *
 * KEEP IN SYNC with public/utils/slug.js (the browser copy used for share
 * links); tests/unit/utils/slug.test.js checks both give the same results.
 */

/**
 * Clean slug: lowercase letters and digits separated by single hyphens,
 * e.g. "Haydn (Joseph)" -> "haydn-joseph", "Bach, JS" -> "bach-js"
 * @param {string} name - Composer or work name
 * @returns {string} Slug
 */
function toSlug(name) {
  return String(name)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Slug used in share links before November 2026: lowercase with spaces
 * replaced by hyphens, punctuation kept. Still accepted so old links work.
 * @param {string} name - Composer or work name
 * @returns {string} Slug
 */
function toLegacySlug(name) {
  return String(name).toLowerCase().replace(/\s+/g, '-');
}

/**
 * Whether a URL segment (already percent-decoded) refers to a name, by exact
 * name, clean slug or legacy slug
 * @param {string} name - Composer or work name from the index
 * @param {string} segment - URL path segment or name supplied by the client
 * @returns {boolean} True if they match
 */
function slugMatches(name, segment) {
  const lower = String(segment).toLowerCase();
  return name === segment || toSlug(name) === lower || toLegacySlug(name) === lower;
}

// Punctuation picked up when a link is pasted at the end of a sentence,
// e.g. "https://player.mychoralpart.com/verdi/requiem." - removed one
// character at a time so names that really end in ")" still match
const TRAILING_PUNCTUATION = /[.,;:!?)]$/;

/**
 * All items matching a name or slug: exact name matches first, then slug
 * matches, retrying without trailing punctuation if nothing matches
 * @param {Array<{name: string}>} items - Composers or works
 * @param {string} segment - Name or URL path segment
 * @returns {Array} Matching items (empty if none)
 */
function findAllByNameOrSlug(items, segment) {
  let candidate = String(segment);
  while (true) {
    const exact = items.filter(item => item.name === candidate);
    const bySlug = items.filter(item => item.name !== candidate && slugMatches(item.name, candidate));
    if (exact.length || bySlug.length) {
      return [...exact, ...bySlug];
    }
    if (!TRAILING_PUNCTUATION.test(candidate)) {
      return [];
    }
    candidate = candidate.slice(0, -1);
  }
}

/**
 * First item matching a name or slug
 * @param {Array<{name: string}>} items - Composers or works
 * @param {string} segment - Name or URL path segment
 * @returns {Object|null} Matching item
 */
function findByNameOrSlug(items, segment) {
  return findAllByNameOrSlug(items, segment)[0] || null;
}

/**
 * Find a composer and work from URL segments. Where several composers share
 * a slug (the source lists "Gilbert & Sullivan" and "Gilbert&Sullivan"
 * separately) the work is looked for under each of them.
 * @param {Array} index - MIDI index
 * @param {string} composerSegment - Composer name or slug
 * @param {string} workSegment - Work name or slug
 * @returns {{composer: Object, work: Object}|null} Index entries, or null if not found
 */
function findWork(index, composerSegment, workSegment) {
  for (const composer of findAllByNameOrSlug(index, composerSegment)) {
    const work = findByNameOrSlug(composer.works || [], workSegment);
    if (work) {
      return { composer, work };
    }
  }
  return null;
}

module.exports = {
  toSlug,
  toLegacySlug,
  slugMatches,
  findAllByNameOrSlug,
  findByNameOrSlug,
  findWork
};
