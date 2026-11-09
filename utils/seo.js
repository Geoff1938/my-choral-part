/**
 * Search engine metadata for the player pages.
 *
 * Every page is the same single-page app, so without this every work URL
 * (e.g. /handel/messiah) would reach search engines with the same title and
 * description. The server fills in per-work tags before sending the page.
 *
 * public/index.html marks the replaceable parts:
 *   <!-- seo:start --> ... <!-- seo:end -->  in <head> (title, description, canonical, social tags)
 *   <!-- seo:body -->                        in <body> (a <noscript> summary of the work)
 */

const SITE_URL = 'https://player.mychoralpart.com';
const SITE_NAME = 'MyChoralPart';
const OG_IMAGE = `${SITE_URL}/branding/og-image.png`;

const HEAD_BLOCK = /<!-- seo:start -->[\s\S]*?<!-- seo:end -->/;
const BODY_MARKER = '<!-- seo:body -->';

// Composer names in the index that flag works which cannot be played
const UNAVAILABLE_MARKER = /not publicly available/i;

/**
 * Escape text for use in HTML content and attribute values
 * @param {string} text - Raw text
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Tidy an index name for display: the source site pads some names with
 * leading dots, dashes and line breaks
 * @param {string} name - Name from the index
 * @returns {string} Display name
 */
function displayName(name) {
  return String(name)
    .replace(/\s+/g, ' ')
    .replace(/^[\s.\-]+/, '')
    .trim();
}

/**
 * Composer name for display: the index writes "Haydn (Joseph)", people
 * search for "Joseph Haydn". Bracketed notes such as "(with CMT)",
 * "(aka Sponga)" and "(Henry VIII)" are kept as they are.
 * @param {string} name - Composer name from the index
 * @returns {string} Display name
 */
function composerDisplayName(name) {
  const tidy = displayName(name);
  const match = tidy.match(/^([^()]+?)\s*\(([A-Za-z][A-Za-z.' -]*)\)$/);
  if (match && !/\b(with|aka)\b/i.test(match[2]) && !/\b[IVXL]{2,}\b/.test(match[2])) {
    return `${match[2].trim()} ${match[1].trim()}`;
  }
  return tidy;
}

/**
 * Slug used in share links; must match the player's share URL in app.js
 * and scraper.nameToSlug
 * @param {string} name - Composer or work name
 * @returns {string} Slug
 */
function toSlug(name) {
  return name.toLowerCase().replace(/\s+/g, '-');
}

/**
 * Canonical URL of a work page
 * @param {string} composer - Composer name from the index
 * @param {string} work - Work name from the index
 * @returns {string} Absolute URL
 */
function workUrl(composer, work) {
  return `${SITE_URL}/${encodeURIComponent(toSlug(composer))}/${encodeURIComponent(toSlug(work))}`;
}

/**
 * Whether a work should be offered to search engines
 * @param {Object} composer - Composer entry from the index
 * @param {Object} work - Work entry from the index
 * @returns {boolean} True if the work can be played
 */
function isIndexable(composer, work) {
  if (UNAVAILABLE_MARKER.test(composer.name) || UNAVAILABLE_MARKER.test(work.name)) {
    return false;
  }
  const sections = work.sections || [];
  return sections.length > 0 &&
    sections.every(section => /\.midi?$/i.test(section.midiUrl || ''));
}

/**
 * Tags for the player's home page (the defaults in index.html)
 * @returns {Object} Page metadata
 */
function homeMeta() {
  return {
    title: 'MyChoralPart Player - Find and Rehearse Your Choir Part',
    description: 'Free online choir rehearsal player. Search nearly 1,500 choral works, ' +
      'emphasise your soprano, alto, tenor or bass part, slow the tempo and loop difficult bars.',
    canonical: `${SITE_URL}/`,
    robots: null
  };
}

/**
 * Tags for a work page
 * @param {Object} composer - Composer entry from the index
 * @param {Object} work - Work entry from the index
 * @returns {Object} Page metadata
 */
function workMeta(composer, work) {
  const composerName = composerDisplayName(composer.name);
  const workName = displayName(work.name);
  const count = (work.sections || []).length;
  const movements = count > 1 ? ` All ${count} movements.` : '';

  return {
    title: `${workName} (${composerName}) - Practise Your Choir Part | ${SITE_NAME}`,
    description: `Learn your part in ${workName} by ${composerName}.${movements} ` +
      'Free rehearsal player: emphasise your soprano, alto, tenor or bass line, ' +
      'slow the tempo and loop difficult bars.',
    canonical: workUrl(composer.name, work.name),
    robots: isIndexable(composer, work) ? null : 'noindex',
    heading: `${workName} - ${composerName}`,
    sections: (work.sections || []).map(section => displayName(section.name))
  };
}

/**
 * Tags for a work URL that does not match anything in the index
 * @returns {Object} Page metadata
 */
function notFoundMeta() {
  return {
    title: `Work Not Found | ${SITE_NAME}`,
    description: 'This work could not be found. Search the library of choral works in the MyChoralPart player.',
    canonical: null,
    robots: 'noindex'
  };
}

/**
 * Build the <head> tags for a page
 * @param {Object} meta - Page metadata
 * @returns {string} HTML
 */
function headTags(meta) {
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  const lines = [
    '<!-- seo:start -->',
    `<title>${title}</title>`,
    `<meta name="description" content="${description}">`
  ];
  if (meta.robots) {
    lines.push(`<meta name="robots" content="${meta.robots}">`);
  }
  if (meta.canonical) {
    const url = escapeHtml(meta.canonical);
    lines.push(
      `<link rel="canonical" href="${url}">`,
      `<meta property="og:url" content="${url}">`
    );
  }
  lines.push(
    `<meta property="og:site_name" content="${SITE_NAME}">`,
    '<meta property="og:type" content="website">',
    '<meta property="og:locale" content="en_GB">',
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${description}">`,
    `<meta property="og:image" content="${OG_IMAGE}">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${description}">`,
    `<meta name="twitter:image" content="${OG_IMAGE}">`,
    '<!-- seo:end -->'
  );
  return lines.join('\n    ');
}

/**
 * Build the <noscript> summary of a work, shown to visitors and crawlers
 * that do not run JavaScript
 * @param {Object} meta - Work page metadata
 * @returns {string} HTML
 */
function bodySummary(meta) {
  if (!meta.heading) {
    return '';
  }
  const items = meta.sections
    .map(name => `<li>${escapeHtml(name)}</li>`)
    .join('');
  return '<noscript><div class="seo-summary">' +
    `<h2>${escapeHtml(meta.heading)}</h2>` +
    `<p>${escapeHtml(meta.description)}</p>` +
    (items ? `<ul>${items}</ul>` : '') +
    '<p>Please enable JavaScript to use the player.</p>' +
    '</div></noscript>';
}

/**
 * Fill a page template with the tags for one page
 * @param {string} template - index.html with the version already substituted
 * @param {Object} meta - Page metadata
 * @returns {string} HTML
 */
function renderPage(template, meta) {
  return template
    .replace(HEAD_BLOCK, () => headTags(meta))
    .replace(BODY_MARKER, () => bodySummary(meta));
}

/**
 * Find a composer and work in the index from the slugs in a URL.
 * Trailing punctuation picked up when a link is pasted into a sentence
 * is ignored, as in scraper.resolveSlug.
 * @param {Array} index - MIDI index
 * @param {string} composerSlug - First path segment
 * @param {string} workSlug - Second path segment
 * @returns {{composer: Object, work: Object}|null} Index entries, or null if not found
 */
function findWork(index, composerSlug, workSlug) {
  const find = (items, slug) => {
    let candidate = slug;
    while (true) {
      const match = items.find(item =>
        item.name === candidate || toSlug(item.name) === candidate.toLowerCase()
      );
      if (match) return match;
      if (!/[.,;:!?)]$/.test(candidate)) return null;
      candidate = candidate.slice(0, -1);
    }
  };

  const composer = find(index, composerSlug);
  if (!composer) return null;
  const work = find(composer.works || [], workSlug);
  return work ? { composer, work } : null;
}

/**
 * Build sitemap.xml listing the home page and every playable work
 * @param {Array} index - MIDI index
 * @returns {string} XML
 */
function buildSitemap(index) {
  const urls = new Set([`${SITE_URL}/`]);
  for (const composer of index) {
    for (const work of composer.works || []) {
      if (isIndexable(composer, work)) {
        urls.add(workUrl(composer.name, work.name));
      }
    }
  }
  const entries = [...urls]
    .map(url => `  <url><loc>${escapeHtml(url)}</loc></url>`)
    .join('\n');
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    `${entries}\n` +
    '</urlset>\n';
}

module.exports = {
  SITE_URL,
  escapeHtml,
  displayName,
  composerDisplayName,
  toSlug,
  workUrl,
  isIndexable,
  homeMeta,
  workMeta,
  notFoundMeta,
  renderPage,
  findWork,
  buildSitemap
};
