/**
 * Unit tests for per-page search engine metadata
 */

const seo = require('../../../utils/seo');

const TEMPLATE = [
  '<html><head>',
  '<!-- seo:start --><title>Old</title><!-- seo:end -->',
  '</head><body>',
  '<!-- seo:body -->',
  '</body></html>'
].join('\n');

const handel = {
  name: 'Handel',
  works: [{
    name: 'Messiah',
    sections: [
      { name: '1: Overture', midiUrl: '/Handel/Messiah/01.mid' },
      { name: '2: Comfort ye', midiUrl: '/Handel/Messiah/02.mid' }
    ]
  }]
};
const bach = {
  name: 'Bach, JS',
  works: [{ name: 'Cantata 140', sections: [{ name: 'Wachet auf', midiUrl: '/Bach/140.mid' }] }]
};
const INDEX = [handel, bach];

describe('findWork', () => {
  test('matches slugs case-insensitively', () => {
    const found = seo.findWork(INDEX, 'HANDEL', 'messiah');
    expect(found.composer.name).toBe('Handel');
    expect(found.work.name).toBe('Messiah');
  });

  test('matches slugs containing punctuation', () => {
    const found = seo.findWork(INDEX, 'bach,-js', 'cantata-140');
    expect(found.work.name).toBe('Cantata 140');
  });

  test('ignores trailing punctuation from a pasted link', () => {
    expect(seo.findWork(INDEX, 'handel', 'messiah.')).not.toBeNull();
  });

  test('returns null for unknown composer or work', () => {
    expect(seo.findWork(INDEX, 'nobody', 'messiah')).toBeNull();
    expect(seo.findWork(INDEX, 'handel', 'nothing')).toBeNull();
  });
});

describe('workMeta', () => {
  test('names the work and composer and counts movements', () => {
    const meta = seo.workMeta(handel, handel.works[0]);
    expect(meta.title).toBe('Messiah (Handel) - Practise Your Choir Part | MyChoralPart');
    expect(meta.description).toContain('Learn your part in Messiah by Handel.');
    expect(meta.description).toContain('All 2 movements.');
    expect(meta.canonical).toBe('https://player.mychoralpart.com/handel/messiah');
    expect(meta.robots).toBeNull();
  });

  test('canonical URL uses clean slugs', () => {
    const meta = seo.workMeta(bach, bach.works[0]);
    expect(meta.canonical).toBe('https://player.mychoralpart.com/bach-js/cantata-140');
  });

  test('single-movement works do not mention movements', () => {
    expect(seo.workMeta(bach, bach.works[0]).description).not.toContain('movements');
  });

  test('tidies padded names from the index', () => {
    const work = { name: '. . . .\n. - Autumn', sections: [{ name: 'x', midiUrl: '/a.mid' }] };
    expect(seo.workMeta(handel, work).title).toMatch(/^Autumn \(Handel\)/);
  });

  test('works without playable MIDI files are marked noindex', () => {
    const work = { name: 'Secret', sections: [{ name: 'x', midiUrl: '/not-public.html' }] };
    expect(seo.workMeta(handel, work).robots).toBe('noindex');
  });
});

describe('composerDisplayName', () => {
  test('puts bracketed first names first', () => {
    expect(seo.composerDisplayName('Haydn (Joseph)')).toBe('Joseph Haydn');
    expect(seo.composerDisplayName('Chilcott (M A)')).toBe('M A Chilcott');
  });

  test('leaves other names alone', () => {
    expect(seo.composerDisplayName('Handel')).toBe('Handel');
    expect(seo.composerDisplayName('Bach, JS')).toBe('Bach, JS');
    expect(seo.composerDisplayName('Opera Choruses (with CMT)')).toBe('Opera Choruses (with CMT)');
    expect(seo.composerDisplayName('Usper (aka Sponga)')).toBe('Usper (aka Sponga)');
    expect(seo.composerDisplayName('Henry Tudor (Henry VIII)')).toBe('Henry Tudor (Henry VIII)');
  });
});

describe('renderPage', () => {
  test('replaces the head block and escapes HTML', () => {
    const composer = { name: 'Smith & <Jones>', works: [] };
    const work = { name: 'Song "One"', sections: [{ name: 'A < B', midiUrl: '/a.mid' }] };
    const html = seo.renderPage(TEMPLATE, seo.workMeta(composer, work));

    expect(html).not.toContain('<title>Old</title>');
    expect(html).toContain('<title>Song &quot;One&quot; (Smith &amp; &lt;Jones&gt;)');
    expect(html).toContain('<meta property="og:image" content="https://player.mychoralpart.com/branding/og-image.png">');
    expect(html).toContain('<noscript>');
    expect(html).toContain('<li>A &lt; B</li>');
    expect(html).not.toContain('<Jones>');
  });

  test('home page has a canonical URL and no noscript summary', () => {
    const html = seo.renderPage(TEMPLATE, seo.homeMeta());
    expect(html).toContain('<link rel="canonical" href="https://player.mychoralpart.com/">');
    expect(html).not.toContain('<noscript>');
    expect(html).not.toContain('noindex');
  });

  test('not-found page is noindex with no canonical URL', () => {
    const html = seo.renderPage(TEMPLATE, seo.notFoundMeta());
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).not.toContain('rel="canonical"');
  });
});

describe('buildSitemap', () => {
  test('lists the home page, composers and each playable work once', () => {
    const blocked = {
      name: 'Bennett - not publicly available',
      works: [{ name: 'Song', sections: [{ name: 'x', midiUrl: '/a.mid' }] }]
    };
    const xml = seo.buildSitemap([...INDEX, blocked]);

    expect(xml).toContain('<loc>https://player.mychoralpart.com/</loc>');
    expect(xml).toContain('<loc>https://player.mychoralpart.com/handel/messiah</loc>');
    expect(xml).toContain('<loc>https://player.mychoralpart.com/bach-js/cantata-140</loc>');
    expect(xml).not.toContain('bennett');
    expect(xml).toContain('<loc>https://player.mychoralpart.com/composers</loc>');
    expect(xml).toContain('<loc>https://player.mychoralpart.com/bach-js</loc>');
    expect(xml.match(/<url>/g)).toHaveLength(6);
  });
});

describe('work structured data', () => {
  const scriptJson = html => JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1]);

  test('describes the work, its composer and movements', () => {
    const html = seo.renderPage(TEMPLATE, seo.workMeta(handel, handel.works[0]));
    const graph = scriptJson(html)['@graph'];
    const composition = graph.find(node => node['@type'] === 'MusicComposition');

    expect(composition.name).toBe('Messiah');
    expect(composition.composer).toEqual({
      '@type': 'Person', name: 'Handel', url: 'https://player.mychoralpart.com/handel'
    });
    expect(composition.hasPart.map(part => part.name)).toEqual(['1: Overture', '2: Comfort ye']);
    expect(graph.find(node => node['@type'] === 'BreadcrumbList').itemListElement).toHaveLength(3);
  });

  test('a name cannot close the script element early', () => {
    const work = { name: '</script><b>x', sections: [{ name: 'a', midiUrl: '/a.mid' }] };
    const html = seo.renderPage(TEMPLATE, seo.workMeta(handel, work));
    expect(html).not.toContain('</script><b>');
    expect(scriptJson(html)['@graph'][0].name).toBe('</script><b>x');
  });

  test('noindex pages carry no structured data', () => {
    const work = { name: 'Secret', sections: [{ name: 'x', midiUrl: '/not-public.html' }] };
    expect(seo.renderPage(TEMPLATE, seo.workMeta(handel, work))).not.toContain('application/ld+json');
  });
});

describe('composer pages', () => {
  const split = [
    { name: 'Gilbert & Sullivan', works: [{ name: 'Trial by Jury', sections: [{ name: 'a', midiUrl: '/a.mid' }, { name: 'b', midiUrl: '/b.mid' }] }] },
    { name: 'Gilbert&Sullivan', works: [{ name: 'Merry Madrigal', sections: [{ name: 'a', midiUrl: '/c.mid' }] }] },
    { name: 'Haydn (Joseph)', works: [{ name: 'Creation', sections: [{ name: 'a', midiUrl: '/d.mid' }] }] }
  ];

  test('combines composers listed twice under the same slug', () => {
    const composer = seo.findComposer(split, 'gilbert-and-sullivan');
    expect(composer.works.map(item => item.path)).toEqual([
      '/gilbert-and-sullivan/merry-madrigal',
      '/gilbert-and-sullivan/trial-by-jury'
    ]);
  });

  test('page links to each work with its movement count', () => {
    const html = seo.renderComposerPage(seo.findComposer(split, 'haydn-joseph'));
    expect(html).toContain('<title>Joseph Haydn - Choral Works to Rehearse | MyChoralPart</title>');
    expect(html).toContain('<link rel="canonical" href="https://player.mychoralpart.com/haydn-joseph">');
    expect(html).toContain('<a href="/haydn-joseph/creation">Creation</a>');

    const gilbert = seo.renderComposerPage(seo.findComposer(split, 'gilbert-and-sullivan'));
    expect(gilbert).toContain('Trial by Jury<span>2 movements</span>');
  });

  test('composer list counts works and links each composer once', () => {
    expect(seo.listComposers(split)).toEqual([
      { name: 'Gilbert & Sullivan', path: '/gilbert-and-sullivan', count: 2 },
      { name: 'Haydn (Joseph)', path: '/haydn-joseph', count: 1 }
    ]);
    const html = seo.renderComposersPage(split);
    expect(html).toContain('3 choral works by 2 composers');
    expect(html.match(/href="\/gilbert-and-sullivan"/g)).toHaveLength(1);
  });

  test('lists numbered works in natural order', () => {
    const numbered = [{ name: 'Haydn', works: ['10. Paukenmesse', '2. Missa brevis', '1. Missa'].map(name => ({
      name, sections: [{ name: 'a', midiUrl: '/a.mid' }]
    })) }];
    expect(seo.findComposer(numbered, 'haydn').works.map(item => item.work.name))
      .toEqual(['1. Missa', '2. Missa brevis', '10. Paukenmesse']);
  });

  test('unknown composer returns null', () => {
    expect(seo.findComposer(split, 'nobody')).toBeNull();
  });
});
