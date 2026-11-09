/**
 * Search engine support for the player.
 *
 * Work pages (/:composer/:work) are the single-page app with per-work tags
 * filled in by the server, since otherwise every work URL would reach search
 * engines with the same title and description. public/index.html marks the
 * replaceable parts:
 *   <!-- seo:start --> ... <!-- seo:end -->  in <head> (title, description,
 *                                            canonical, social tags, structured data)
 *   <!-- seo:body -->                        in <body> (a <noscript> summary of the work)
 *
 * Composer pages (/:composer) and the composer list (/composers) are plain
 * server-rendered pages with links to the work pages.
 */

const { toSlug, findAllByNameOrSlug, findWork } = require('./slug');

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
 * Serialise structured data for a <script> element: every "<" is escaped
 * so a name can never close the script early
 * @param {Object} data - JSON-LD object
 * @returns {string} HTML script element
 */
function jsonLdScript(data) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">${json}</script>`;
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
 * Path of a composer page, e.g. /haydn-joseph
 * @param {string} composer - Composer name from the index
 * @returns {string} Path
 */
function composerPath(composer) {
  return `/${toSlug(composer)}`;
}

/**
 * Path of a work page, e.g. /handel/messiah
 * @param {string} composer - Composer name from the index
 * @param {string} work - Work name from the index
 * @returns {string} Path
 */
function workPath(composer, work) {
  return `/${toSlug(composer)}/${toSlug(work)}`;
}

/**
 * Canonical URL of a work page
 * @param {string} composer - Composer name from the index
 * @param {string} work - Work name from the index
 * @returns {string} Absolute URL
 */
function workUrl(composer, work) {
  return SITE_URL + workPath(composer, work);
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
 * Tags for the player's home page
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
  const sections = (work.sections || []).map(section => displayName(section.name));
  const movements = sections.length > 1 ? ` All ${sections.length} movements.` : '';
  const canonical = workUrl(composer.name, work.name);
  const composerUrl = SITE_URL + composerPath(composer.name);

  const composition = {
    '@type': 'MusicComposition',
    name: workName,
    url: canonical,
    composer: { '@type': 'Person', name: composerName, url: composerUrl }
  };
  if (sections.length > 1) {
    composition.hasPart = sections.map(name => ({ '@type': 'MusicComposition', name }));
  }

  return {
    title: `${workName} (${composerName}) - Practise Your Choir Part | ${SITE_NAME}`,
    description: `Learn your part in ${workName} by ${composerName}.${movements} ` +
      'Free rehearsal player: emphasise your soprano, alto, tenor or bass line, ' +
      'slow the tempo and loop difficult bars.',
    canonical,
    robots: isIndexable(composer, work) ? null : 'noindex',
    heading: `${workName} - ${composerName}`,
    composerName,
    composerUrl,
    sections,
    structuredData: {
      '@context': 'https://schema.org',
      '@graph': [
        composition,
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Composers', item: `${SITE_URL}/composers` },
            { '@type': 'ListItem', position: 2, name: composerName, item: composerUrl },
            { '@type': 'ListItem', position: 3, name: workName, item: canonical }
          ]
        }
      ]
    }
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
 * Tags for a shared piece or set (/p/... or /s/...). Shared links are
 * unlisted, so never indexed; the title shows in link previews.
 * @param {string|null} title - Piece or set title, or null if the link no longer works
 * @param {'piece'|'set'} kind - What is shared
 * @returns {Object} Page metadata
 */
function sharedMeta(title, kind) {
  if (!title) {
    return {
      title: `Shared Link Not Available | ${SITE_NAME}`,
      description: 'This shared link is no longer available.',
      canonical: null,
      robots: 'noindex'
    };
  }
  return {
    title: `${displayName(title)} - Shared ${kind === 'set' ? 'Set' : 'Piece'} | ${SITE_NAME}`,
    description: kind === 'set'
      ? 'A set of pieces shared with you to practise your choir part in the free MyChoralPart player.'
      : 'A piece shared with you to practise your choir part in the free MyChoralPart player.',
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
    `<meta name="twitter:image" content="${OG_IMAGE}">`
  );
  if (meta.structuredData && !meta.robots) {
    lines.push(jsonLdScript(meta.structuredData));
  }
  lines.push('<!-- seo:end -->');
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
    `<p><a href="${escapeHtml(meta.composerUrl)}">More works by ${escapeHtml(meta.composerName)}</a></p>` +
    '<p>Please enable JavaScript to use the player.</p>' +
    '</div></noscript>';
}

/**
 * Fill the player page template with the tags for one page
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
 * Composers matching a URL segment, with their playable works. The source
 * lists some composers twice ("Gilbert & Sullivan" and "Gilbert&Sullivan"),
 * so all entries sharing the slug are combined.
 * @param {Array} index - MIDI index
 * @param {string} segment - Composer name or slug
 * @returns {{name: string, entries: Array, works: Array}|null} Composer, or null if not found
 */
function findComposer(index, segment) {
  const entries = findAllByNameOrSlug(index, segment);
  if (entries.length === 0) {
    return null;
  }
  const slug = toSlug(entries[0].name);
  const sameSlug = entries.filter(entry => toSlug(entry.name) === slug);
  const seen = new Set();
  const works = [];
  for (const entry of sameSlug) {
    for (const work of entry.works || []) {
      const path = workPath(entry.name, work.name);
      if (isIndexable(entry, work) && !seen.has(path)) {
        seen.add(path);
        works.push({ composer: entry, work, path });
      }
    }
  }
  // Natural order, so "2. Missa brevis" comes before "10. Paukenmesse"
  works.sort((a, b) => displayName(a.work.name).localeCompare(
    displayName(b.work.name), 'en', { numeric: true, sensitivity: 'base' }));
  return { name: entries[0].name, entries: sameSlug, works };
}

/**
 * Shared page shell for the composer pages
 * @param {Object} options - Page parts
 * @param {string} options.title - Page title
 * @param {string} options.description - Meta description
 * @param {string|null} options.canonical - Canonical URL, or null for noindex pages
 * @param {string} options.body - Inner HTML of <main>
 * @param {Object} [options.structuredData] - JSON-LD
 * @returns {string} HTML document
 */
function staticPage({ title, description, canonical, body, structuredData }) {
  const head = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}">`,
    canonical
      ? `<link rel="canonical" href="${escapeHtml(canonical)}">\n    <meta property="og:url" content="${escapeHtml(canonical)}">`
      : '<meta name="robots" content="noindex">',
    `<meta property="og:site_name" content="${SITE_NAME}">`,
    '<meta property="og:type" content="website">',
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:image" content="${OG_IMAGE}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    structuredData ? jsonLdScript(structuredData) : ''
  ].filter(Boolean).join('\n    ');

  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    ${head}
    <link rel="icon" type="image/png" sizes="32x32" href="/branding/logo-icon-32.png">
    <link rel="apple-touch-icon" sizes="180x180" href="/branding/logo-icon-256.png">
    <style>
        :root { --text: #2C3E50; --muted: #4A5A6A; --link: #1F6FB2; --bg: #f5f7fa; --card: #ffffff; --accent: #2ECC71; }
        * { box-sizing: border-box; }
        body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.6; color: var(--text); background: var(--bg); }
        header, main, footer { max-width: 900px; margin: 0 auto; padding: 0 16px; }
        header { display: flex; align-items: center; gap: 12px; padding-top: 20px; }
        header img { width: 44px; height: 44px; }
        header a { color: var(--text); font-weight: 700; font-size: 20px; text-decoration: none; }
        nav.breadcrumbs { font-size: 14px; color: var(--muted); margin: 16px 0 0; }
        h1 { font-size: 30px; line-height: 1.25; margin: 8px 0 8px; }
        p.lead { color: var(--muted); margin: 0 0 20px; }
        a { color: var(--link); }
        .cta { display: inline-block; background: var(--accent); color: #fff; font-weight: 600; padding: 12px 24px; border-radius: 10px; text-decoration: none; margin-bottom: 24px; }
        ul.works { list-style: none; padding: 0; margin: 0 0 32px; background: var(--card); border-radius: 12px; }
        ul.works li { border-bottom: 1px solid #e6e9ee; }
        ul.works li:last-child { border-bottom: 0; }
        ul.works a { display: flex; justify-content: space-between; gap: 12px; padding: 12px 16px; text-decoration: none; }
        ul.works span { color: var(--muted); font-size: 14px; white-space: nowrap; }
        .letters { columns: 3 220px; column-gap: 24px; margin-bottom: 32px; }
        .letters section { break-inside: avoid; margin-bottom: 16px; }
        .letters h2 { font-size: 18px; margin: 0 0 4px; }
        .letters ul { list-style: none; padding: 0; margin: 0; }
        footer { color: var(--muted); font-size: 14px; padding-bottom: 32px; }
    </style>
</head>
<body>
    <header>
        <img src="/branding/logo-icon-only.svg" alt="" width="44" height="44">
        <a href="/">MyChoralPart</a>
    </header>
    <main>
${body}
    </main>
    <footer>
        <p><a href="/">Open the player</a> &middot; <a href="/composers">All composers</a> &middot; <a href="https://mychoralpart.com/">About MyChoralPart</a></p>
        <p>Music files by John Hooper: <a href="https://www.learnchoralmusic.co.uk/">learnchoralmusic.co.uk</a></p>
    </footer>
</body>
</html>
`;
}

/**
 * Composer page: the composer's playable works, each linking to its page
 * @param {Object} composer - Result of findComposer
 * @returns {string} HTML document
 */
function renderComposerPage(composer) {
  const name = composerDisplayName(composer.name);
  const canonical = SITE_URL + composerPath(composer.name);
  const count = composer.works.length;
  const examples = composer.works.slice(0, 3).map(item => displayName(item.work.name)).join(', ');
  const description = `Rehearse your choir part in ${count} choral work${count === 1 ? '' : 's'} by ${name}` +
    (examples ? `, including ${examples}` : '') +
    '. Free online player: emphasise your voice part, slow the tempo and loop difficult bars.';

  const items = composer.works.map(item => {
    const movements = (item.work.sections || []).length;
    const note = movements > 1 ? `<span>${movements} movements</span>` : '';
    return `            <li><a href="${escapeHtml(item.path)}">${escapeHtml(displayName(item.work.name))}${note}</a></li>`;
  }).join('\n');

  const body = `        <nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/composers">Composers</a> &rsaquo; ${escapeHtml(name)}</nav>
        <h1>${escapeHtml(name)}: choral works to rehearse</h1>
        <p class="lead">Choose a work to practise your part. Each one opens in the free MyChoralPart player, where you can emphasise your soprano, alto, tenor or bass line, slow the tempo and loop difficult bars.</p>
        <ul class="works">
${items}
        </ul>`;

  return staticPage({
    title: `${name} - Choral Works to Rehearse | ${SITE_NAME}`,
    description,
    canonical,
    body,
    structuredData: {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'CollectionPage',
          name: `${name}: choral works to rehearse`,
          url: canonical,
          about: { '@type': 'Person', name },
          hasPart: composer.works.map(item => ({
            '@type': 'MusicComposition',
            name: displayName(item.work.name),
            url: SITE_URL + item.path
          }))
        },
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Composers', item: `${SITE_URL}/composers` },
            { '@type': 'ListItem', position: 2, name, item: canonical }
          ]
        }
      ]
    }
  });
}

/**
 * Composers that have at least one playable work, one entry per slug
 * @param {Array} index - MIDI index
 * @returns {Array<{name: string, path: string, count: number}>} Composers sorted by display name
 */
function listComposers(index) {
  const bySlug = new Map();
  for (const entry of index) {
    const slug = toSlug(entry.name);
    if (!bySlug.has(slug)) {
      const composer = findComposer(index, slug);
      if (composer && composer.works.length > 0) {
        bySlug.set(slug, {
          name: displayName(composer.name),
          path: composerPath(composer.name),
          count: composer.works.length
        });
      }
    }
  }
  return [...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Page listing every composer, grouped by initial letter
 * @param {Array} index - MIDI index
 * @returns {string} HTML document
 */
function renderComposersPage(index) {
  const composers = listComposers(index);
  const groups = new Map();
  for (const composer of composers) {
    const letter = composer.name.charAt(0).toUpperCase();
    const key = /[A-Z]/.test(letter) ? letter : '#';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(composer);
  }
  const sections = [...groups.entries()].map(([letter, list]) => {
    const items = list
      .map(c => `<li><a href="${escapeHtml(c.path)}">${escapeHtml(c.name)}</a> (${c.count})</li>`)
      .join('');
    return `            <section><h2>${letter}</h2><ul>${items}</ul></section>`;
  }).join('\n');

  const works = composers.reduce((total, c) => total + c.count, 0);
  const body = `        <h1>Composers</h1>
        <p class="lead">Rehearse your choir part in ${works.toLocaleString('en-GB')} choral works by ${composers.length} composers. Choose a composer to see their works.</p>
        <a class="cta" href="/">Open the player</a>
        <div class="letters">
${sections}
        </div>`;

  return staticPage({
    title: `Composers - Choral Works to Rehearse | ${SITE_NAME}`,
    description: `Browse ${composers.length} composers and ${works.toLocaleString('en-GB')} choral works ` +
      'you can rehearse free in the MyChoralPart player, from Bach and Handel to Faure and Elgar.',
    canonical: `${SITE_URL}/composers`,
    body
  });
}

/**
 * Page for a composer URL that does not match anything in the index
 * @returns {string} HTML document
 */
function renderComposerNotFoundPage() {
  return staticPage({
    title: `Composer Not Found | ${SITE_NAME}`,
    description: 'This composer could not be found.',
    canonical: null,
    body: '        <h1>Composer not found</h1>\n        <p class="lead">Try the <a href="/composers">list of composers</a> or search in the <a href="/">player</a>.</p>'
  });
}

/**
 * Build sitemap.xml: the home page, the composer list, each composer page
 * and every playable work
 * @param {Array} index - MIDI index
 * @returns {string} XML
 */
function buildSitemap(index) {
  const urls = new Set([`${SITE_URL}/`, `${SITE_URL}/composers`]);
  for (const composer of listComposers(index)) {
    urls.add(SITE_URL + composer.path);
  }
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
  composerPath,
  workPath,
  workUrl,
  isIndexable,
  homeMeta,
  workMeta,
  notFoundMeta,
  sharedMeta,
  renderPage,
  findWork,
  findComposer,
  listComposers,
  renderComposerPage,
  renderComposersPage,
  renderComposerNotFoundPage,
  buildSitemap
};
