/**
 * URL slugs for share links.
 *
 * KEEP IN SYNC with utils/slug.js on the server, which resolves these links;
 * tests/unit/utils/slug.test.js checks both give the same results.
 */

/**
 * Clean slug: lowercase letters and digits separated by single hyphens,
 * e.g. "Haydn (Joseph)" -> "haydn-joseph", "Bach, JS" -> "bach-js"
 * @param {string} name - Composer or work name
 * @returns {string} Slug
 */
export function toSlug(name) {
  return String(name)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
