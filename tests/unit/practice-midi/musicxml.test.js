/**
 * Unit tests for public/practice-midi/musicxml.js, xml.js and zip.js,
 * using small generated scores
 */

const { readMusicXml, splitLines } = require('../../../public/practice-midi/musicxml.js');
const { parseXml, child, children, textOf, XmlParseError } = require('../../../public/practice-midi/xml.js');
const { readZipDirectory, extractZipEntry } = require('../../../public/practice-midi/zip.js');
const { detectFormat } = require('../../../public/practice-midi/detect.js');
const { convertFile } = require('../../../public/practice-midi/convert.js');
const { extractNotes, metaText, decodeText, encodeText, META } = require('../../../public/practice-midi/smf.js');
const { tempoMap } = require('../../../public/practice-midi/audit.js');
const { zip, xmlNote, xmlScore, xmlAttributes, xmlBar } = require('./helpers.js');

function read(xml) {
  const bytes = encodeText(xml);
  return readMusicXml(bytes, detectFormat(bytes));
}

function trackNamed(song, name) {
  return song.tracks.find(t => metaText(t, META.TRACK_NAME) === name);
}

/**
 * Notes of a track as [quarter position, pitch, length in quarters, velocity]
 */
function notesOf(song, name) {
  const tpq = song.ticksPerQuarter;
  return extractNotes(trackNamed(song, name).events).map(n => [n.tick / tpq, n.note, n.duration / tpq, n.velocity]);
}

function voicePart(name, measures, options = {}) {
  return { id: options.id || 'P1', name, measures: [xmlAttributes(options.attributes) + measures[0], ...measures.slice(1)], ...options.part };
}

function codes(result) {
  return result.messages.map(m => m.code);
}

describe('parseXml()', () => {
  test('reads elements, attributes, text, entities and CDATA', () => {
    const root = parseXml('<?xml version="1.0"?><!-- c --><!DOCTYPE a [<!ENTITY x "y">]><a k="1" j=\'&amp;2\'><b>T &lt;&#233;&#x41;</b><c/><![CDATA[<raw>]]></a>');
    expect(root.name).toBe('a');
    expect(root.attrs).toEqual({ k: '1', j: '&2' });
    expect(textOf(root, 'b')).toBe('T <éA');
    expect(children(root).map(c => c.name)).toEqual(['b', 'c']);
    expect(root.children[2]).toBe('<raw>');
    expect(child(root, 'missing')).toBeNull();
    expect(textOf(root, 'missing')).toBeNull();
  });

  test.each([
    ['<a><b></a>', 'does not match'],
    ['<a>', 'not closed'],
    ['<a/><b/>', 'More than one root'],
    ['text', 'Text outside'],
    ['<a><!-- unterminated', 'Unterminated comment'],
    ['', 'No root element']
  ])('rejects %s', (xml, message) => {
    expect(() => parseXml(xml)).toThrow(XmlParseError);
    expect(() => parseXml(xml)).toThrow(message);
  });
});

describe('zip', () => {
  test('extracts stored and deflated entries', async () => {
    const data = zip([{ name: 'a.txt', data: 'stored' }, { name: 'b.txt', data: 'deflated '.repeat(100), deflate: true }]);
    const entries = readZipDirectory(data);
    expect(decodeText(await extractZipEntry(data, entries[0], 1000))).toBe('stored');
    expect(decodeText(await extractZipEntry(data, entries[1], 1000))).toBe('deflated '.repeat(100));
  });

  test('refuses an entry whose stated size is over the limit, before extracting', async () => {
    const data = zip([{ name: 'big.xml', data: 'x', size: 2000 }]);
    await expect(extractZipEntry(data, readZipDirectory(data)[0], 1000)).rejects.toMatchObject({ code: 'zip-too-large' });
  });

  test('stops inflating when the real size passes the limit, whatever the directory says', async () => {
    const data = zip([{ name: 'bomb.xml', data: 'a'.repeat(100000), deflate: true, size: 10 }]);
    await expect(extractZipEntry(data, readZipDirectory(data)[0], 5000)).rejects.toMatchObject({ code: 'zip-too-large' });
  });

  test('reports damaged data', async () => {
    const data = zip([{ name: 'a.xml', data: 'hello hello hello', deflate: true }]);
    const entry = readZipDirectory(data)[0];
    // Corrupt the compressed bytes
    data.fill(0xff, 40, 40 + entry.compressedSize);
    await expect(extractZipEntry(data, entry, 1000)).rejects.toMatchObject({ code: 'zip-broken' });
  });
});

describe('readMusicXml(): timing and pitch', () => {
  test('reads pitches, rests, chords, backup and forward', async () => {
    const measure = xmlNote({ step: 'C', octave: 5, duration: 2 })
      + xmlNote({ step: 'E', octave: 5, duration: 2, chord: true })
      + xmlNote({ rest: true, duration: 1 })
      + xmlNote({ step: 'F', octave: 5, alter: 1, duration: 1 })
      + '<backup><duration>4</duration></backup>'
      + '<forward><duration>1</duration></forward>'
      + xmlNote({ step: 'B', octave: 4, alter: -1, duration: 3, voice: 2 });
    const { song } = await read(xmlScore([voicePart('Piano', [measure], { attributes: { divisions: 1 } })]));
    expect(notesOf(song, 'Piano').sort((a, b) => a[0] - b[0] || a[1] - b[1])).toEqual([
      [0, 72, 2, 75], [0, 76, 2, 75], [1, 70, 3, 75], [3, 78, 1, 75]
    ]);
  });

  test('joins tied notes, including across bar lines', async () => {
    const measures = [
      xmlNote({ step: 'G', octave: 4, duration: 3 }) + xmlNote({ step: 'A', octave: 4, duration: 1, tie: 'start' }),
      xmlNote({ step: 'A', octave: 4, duration: 4, tie: 'both' }),
      xmlNote({ step: 'A', octave: 4, duration: 2, tie: 'stop' }) + xmlNote({ step: 'A', octave: 4, duration: 2 })
    ];
    const { song } = await read(xmlScore([voicePart('Alto', measures)]));
    expect(notesOf(song, 'Alto').map(n => n.slice(0, 3))).toEqual([[0, 67, 3], [3, 69, 7], [10, 69, 2]]);
  });

  test('keeps a tie when another voice starts the same pitch at the same time', async () => {
    // Voice 1: D5 half tied to a quarter; voice 2: D5 eighth on the same beat
    const measure = xmlNote({ step: 'D', octave: 5, duration: 2, tie: 'start' }) + xmlNote({ step: 'D', octave: 5, duration: 1, tie: 'stop' })
      + xmlNote({ rest: true, duration: 1 })
      + '<backup><duration>4</duration></backup>'
      + xmlNote({ step: 'D', octave: 5, duration: 0.5, voice: 2 }) + xmlNote({ rest: true, duration: 3.5, voice: 2 });
    const { song } = await read(xmlScore([voicePart('Organ', [measure], { attributes: { divisions: 1 } })]));
    expect(notesOf(song, 'Organ').map(n => n.slice(0, 3)).sort((a, b) => b[2] - a[2])).toEqual([[0, 74, 3], [0, 74, 0.5]]);
  });

  test('uses one resolution for parts with different divisions, and changes of divisions', async () => {
    const soprano = voicePart('Soprano', [
      xmlNote({ step: 'C', octave: 5, duration: 3 }) + xmlNote({ step: 'D', octave: 5, duration: 1 }),
      '<attributes><divisions>8</divisions></attributes>' + xmlNote({ step: 'E', octave: 5, duration: 32 })
    ], { attributes: { divisions: 1, beats: 4 } });
    const alto = voicePart('Alto', [
      xmlNote({ step: 'A', octave: 4, duration: 12 }) + xmlNote({ step: 'B', octave: 4, duration: 3 }) + xmlNote({ step: 'C', octave: 5, duration: 1 }),
      xmlNote({ step: 'A', octave: 4, duration: 16 })
    ], { id: 'P2', attributes: { divisions: 4 } });
    const { song } = await read(xmlScore([soprano, alto]));
    expect(song.ticksPerQuarter % 8).toBe(0);
    expect(notesOf(song, 'Soprano').map(n => n.slice(0, 3))).toEqual([[0, 72, 3], [3, 74, 1], [4, 76, 4]]);
    expect(notesOf(song, 'Alto').map(n => n.slice(0, 3))).toEqual([[0, 69, 3], [3, 71, 0.75], [3.75, 72, 0.25], [4, 69, 4]]);
  });

  test('lines up parts after a short pickup measure', async () => {
    const soprano = voicePart('Soprano', [xmlNote({ step: 'G', octave: 4, duration: 1 }), xmlBar('C', 5)]);
    const alto = voicePart('Alto', [xmlNote({ step: 'E', octave: 4, duration: 1 }), xmlBar('A', 4)], { id: 'P2' });
    const { song } = await read(xmlScore([soprano, alto]));
    expect(notesOf(song, 'Soprano')[1][0]).toBe(1);
    expect(notesOf(song, 'Alto')[1][0]).toBe(1);
  });

  test('skips cue and grace notes, but cue notes still take time', async () => {
    const measure = xmlNote({ step: 'D', octave: 5, duration: 1, grace: true })
      + xmlNote({ step: 'C', octave: 5, duration: 1, cue: true })
      + xmlNote({ step: 'E', octave: 5, duration: 3 });
    const { song } = await read(xmlScore([voicePart('Organ', [measure])]));
    expect(notesOf(song, 'Organ').map(n => n.slice(0, 3))).toEqual([[1, 76, 3]]);
  });

  test('plays a tenor in a treble-8 clef at the written pitch', async () => {
    const clef = '<clef><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef>';
    const { song } = await read(xmlScore([voicePart('Tenor', [xmlBar('C', 4)], { attributes: { clef } })]));
    expect(notesOf(song, 'Tenor')[0][1]).toBe(60);
  });

  test('does not apply an octave transposition that the clef already declares (Sibelius tenor)', async () => {
    const clef = '<clef><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef>';
    const extra = '<transpose><diatonic>0</diatonic><chromatic>0</chromatic><octave-change>-1</octave-change></transpose>';
    const { song } = await read(xmlScore([voicePart('Tenor', [xmlBar('C', 4)], { attributes: { clef, extra } })]));
    expect(notesOf(song, 'Tenor')[0][1]).toBe(60);
  });

  test('applies other transpositions', async () => {
    const extra = '<transpose><diatonic>-1</diatonic><chromatic>-2</chromatic><octave-change>-1</octave-change></transpose>';
    const { song } = await read(xmlScore([voicePart('Clarinet in B flat', [xmlBar('D', 5)], { attributes: { extra } })]));
    expect(notesOf(song, 'Clarinet in B flat')[0][1]).toBe(74 - 2 - 12);
  });
});

describe('readMusicXml(): dynamics, tempo and lyrics', () => {
  const direction = (inner, offset = '') => `<direction><direction-type>${inner}</direction-type>${offset}</direction>`;

  test('maps written dynamics to velocities, mf until the first one', async () => {
    const measures = [
      xmlNote({ step: 'C', octave: 5, duration: 2 }) + direction('<dynamics><p/></dynamics>') + xmlNote({ step: 'C', octave: 5, duration: 2 }),
      direction('<dynamics><ff/></dynamics>') + xmlBar('C', 5)
    ];
    const { song } = await read(xmlScore([voicePart('Soprano', measures)]));
    expect(notesOf(song, 'Soprano').map(n => n[3])).toEqual([75, 48, 108, 108, 108, 108]);
  });

  test('reads tempo from <sound> and from a metronome mark with no <sound>', async () => {
    const measures = [
      direction('<words>Allegro</words>') .replace('</direction>', '<sound tempo="132"/></direction>') + xmlBar('C', 5),
      direction('<metronome><beat-unit>half</beat-unit><beat-unit-dot/><per-minute>40</per-minute></metronome>') + xmlBar('C', 5)
    ];
    const { song } = await read(xmlScore([voicePart('Soprano', measures)]));
    expect(tempoMap(song).map(t => [t.tick / song.ticksPerQuarter, Math.round(60e6 / t.microsecondsPerQuarter)])).toEqual([[0, 132], [4, 120]]);
  });

  test('writes time and key signatures to the conductor track', async () => {
    const { song } = await read(xmlScore([voicePart('Soprano', [xmlBar('C', 5)], { attributes: { beats: 3, beatType: 2, fifths: -2 } })]));
    const conductor = song.tracks[0].events;
    expect(Array.from(conductor.find(e => e.metaType === META.TIME_SIGNATURE).data)).toEqual([3, 1, 24, 8]);
    expect(Array.from(conductor.find(e => e.metaType === META.KEY_SIGNATURE).data)).toEqual([254, 0]);
  });

  test('keeps verse 1 lyrics with hyphens for split words', async () => {
    const measure = xmlNote({ step: 'C', octave: 5, duration: 2, lyric: 'Glo', syllabic: 'begin' })
      + xmlNote({ step: 'D', octave: 5, duration: 2, lyric: 'ri', syllabic: 'end' });
    const { song } = await read(xmlScore([voicePart('Soprano', [measure])]));
    const lyrics = trackNamed(song, 'Soprano').events.filter(e => e.metaType === META.LYRIC).map(e => decodeText(e.data));
    expect(lyrics).toEqual(['Glo-', 'ri']);
  });
});

describe('readMusicXml(): parts and lines', () => {
  test('splits two voices on a shared stave, sharing unison bars but not rests', async () => {
    const measures = [
      // Both voices written
      xmlBar('E', 5) + '<backup><duration>4</duration></backup>' + xmlBar('C', 5, { voice: 2 }),
      // Unison: only voice 1 written
      xmlBar('D', 5),
      // Voice 2 rests
      xmlBar('F', 5) + '<backup><duration>4</duration></backup>' + xmlNote({ rest: true, duration: 4, voice: 2 })
    ];
    const { song, splitParts } = await read(xmlScore([voicePart('Soprano I & II', measures)]));
    expect(splitParts).toEqual(['Soprano I & II']);
    expect(notesOf(song, 'Soprano I & II (voice 1)').map(n => n[1])).toEqual([76, 76, 76, 76, 74, 74, 74, 74, 77, 77, 77, 77]);
    expect(notesOf(song, 'Soprano I & II (voice 2)').map(n => n[1])).toEqual([72, 72, 72, 72, 74, 74, 74, 74]);
  });

  test('keeps occasional divisi in the main line', async () => {
    const measures = [
      xmlBar('E', 5) + '<backup><duration>1</duration></backup>' + xmlNote({ step: 'C', octave: 5, duration: 1, voice: 2 }),
      xmlBar('D', 5), xmlBar('D', 5)
    ];
    const { song, splitParts } = await read(xmlScore([voicePart('Alto', measures)]));
    expect(splitParts).toEqual([]);
    expect(notesOf(song, 'Alto')).toHaveLength(13);
  });

  test('splits closed score into four lines, upper voice first on each staff', async () => {
    const staff = (s, v1, v2) => xmlBar(v1[0], v1[1], { staff: s }) + '<backup><duration>4</duration></backup>' + xmlBar(v2[0], v2[1], { staff: s, voice: 2 });
    const measure = staff(1, ['E', 5], ['C', 5]) + '<backup><duration>4</duration></backup>' + staff(2, ['G', 4], ['C', 3]).replace(/<voice>1<\/voice>/g, '<voice>3</voice>').replace(/<voice>2<\/voice>/g, '<voice>4</voice>');
    const clef = '<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef>';
    const { song } = await read(xmlScore([voicePart('Choir', [measure, measure], { attributes: { staves: 2, clef } })]));
    expect([1, 2, 3, 4].map(i => notesOf(song, `Choir (voice ${i})`)[0][1])).toEqual([76, 72, 67, 48]);
  });

  test('keeps a keyboard part on two staves as one line', async () => {
    const measure = xmlBar('E', 5, { staff: 1 }) + '<backup><duration>4</duration></backup>' + xmlBar('C', 3, { staff: 2, voice: 2 });
    const { song, splitParts } = await read(xmlScore([voicePart('Organ', [measure], { attributes: { staves: 2 } })]));
    expect(splitParts).toEqual([]);
    expect(notesOf(song, 'Organ')).toHaveLength(8);
  });

  test('uses the instrument name when the part name is a placeholder, and the MIDI program', async () => {
    const part = voicePart('MusicXML Part', [xmlBar('C', 4)], { part: { instrument: 'Grand Piano', program: 1 } });
    const { song } = await read(xmlScore([part]));
    const piano = trackNamed(song, 'Grand Piano');
    expect(piano.events.find(e => e.type === 'program').program).toBe(0);
  });

  test('guesses an organ program from the name', async () => {
    const { song } = await read(xmlScore([voicePart('Organ', [xmlBar('C', 4)])]));
    expect(trackNamed(song, 'Organ').events.find(e => e.type === 'program').program).toBe(19);
  });

  test('splitLines() leaves an instrument alone', () => {
    const notes = [{ staff: '1', voice: '1', measureIndex: 0 }, { staff: '1', voice: '2', measureIndex: 0 }];
    expect(splitLines(notes, 'Piano', new Set())).toEqual([notes]);
  });
});

describe('readMusicXml(): metadata and formats', () => {
  test('title from work and movement, composer and rights', async () => {
    const header = '<work><work-title>Mass in B minor</work-title></work><movement-title>Gratias</movement-title>'
      + '<identification><creator type="composer">J. S. Bach</creator><rights>CPDL licence</rights></identification>';
    const result = await read(xmlScore([voicePart('Soprano', [xmlBar('C', 5)])], { header }));
    expect(result.title).toBe('Mass in B minor: Gratias');
    expect(result.composer).toBe('J. S. Bach');
    expect(metaText(result.song.tracks[0], META.COPYRIGHT)).toBe('CPDL licence');
  });

  test('movement from a centred credit when there is no movement title', async () => {
    const header = '<work><work-title>Messe in h-Moll</work-title></work>'
      + '<identification><creator type="composer">J.S. Bach</creator></identification>'
      + '<credit page="1"><credit-words justify="center">Messe in h-Moll</credit-words></credit>'
      + '<credit page="1"><credit-words justify="center">CRUCIFIXUS</credit-words></credit>'
      + '<credit page="1"><credit-words justify="center">Copyright © CPDL</credit-words></credit>';
    const result = await read(xmlScore([voicePart('Soprano', [xmlBar('C', 5)])], { header }));
    expect(result.title).toBe('Messe in h-Moll: Crucifixus');
  });

  test('reads a timewise score', async () => {
    const xml = '<?xml version="1.0"?><score-timewise><part-list><score-part id="P1"><part-name>Bass</part-name></score-part></part-list>'
      + `<measure number="1"><part id="P1">${xmlAttributes()}${xmlBar('C', 3)}</part></measure>`
      + `<measure number="2"><part id="P1">${xmlBar('D', 3)}</part></measure></score-timewise>`;
    const { song } = await read(xml);
    expect(notesOf(song, 'Bass').map(n => n[1])).toEqual([48, 48, 48, 48, 50, 50, 50, 50]);
  });
});

describe('convertFile() with MusicXML', () => {
  function satbScore({ dynamics = true } = {}) {
    const dyn = dynamics ? '<direction><direction-type><dynamics><f/></dynamics></direction-type></direction>' : '';
    const bars = (step, octave) => Array.from({ length: 12 }, (_, i) => (i === 6 ? dyn : '') + xmlBar(step, octave));
    return xmlScore([
      voicePart('Soprano', bars('C', 5)),
      voicePart('Alto', bars('A', 4), { id: 'P2' }),
      voicePart('Tenor', bars('E', 4), { id: 'P3' }),
      voicePart('Bass', bars('A', 3), { id: 'P4' }),
      voicePart('Organ', bars('C', 3), { id: 'P5' })
    ], { header: '<movement-title>Test</movement-title>' }).replace('<attributes>', '<sound tempo="60"/><attributes>');
  }

  test('converts an uncompressed score', async () => {
    const result = await convertFile(encodeText(satbScore()), 'test.musicxml');
    expect(result.status).toBe('ok');
    expect(result.format).toBe('musicxml');
    expect(result.summary.parts.map(p => p.name)).toEqual(['Soprano', 'Alto', 'Tenor', 'Bass', 'Organ']);
    expect(result.suggested.title).toBe('Test');
  });

  test('converts a compressed score (.mxl)', async () => {
    const container = '<?xml version="1.0"?><container><rootfiles><rootfile full-path="score/test.xml"/></rootfiles></container>';
    const data = zip([
      { name: 'mimetype', data: 'application/vnd.recordare.musicxml' },
      { name: 'META-INF/container.xml', data: container, deflate: true },
      { name: 'score/test.xml', data: satbScore(), deflate: true }
    ]);
    const result = await convertFile(data, 'test.mxl');
    expect(result.status).toBe('ok');
    expect(result.format).toBe('mxl');
  });

  test('warns when there are no dynamics', async () => {
    const result = await convertFile(encodeText(satbScore({ dynamics: false })));
    expect(codes(result)).toContain('no-dynamics');
  });

  test('warns when a stave was split', async () => {
    const measure = xmlBar('E', 5) + '<backup><duration>4</duration></backup>' + xmlBar('C', 5, { voice: 2 });
    const xml = xmlScore([voicePart('Sopran I & II', Array(10).fill(measure)), voicePart('Alt', Array(10).fill(xmlBar('A', 4)), { id: 'P2' })]);
    const result = await convertFile(encodeText(xml.replace('<attributes>', '<sound tempo="60"/><attributes>')));
    expect(codes(result)).toContain('voices-split');
    expect(result.summary.parts.map(p => p.name)).toEqual(['Soprano 1', 'Soprano 2', 'Alto']);
  });

  test('rejects malformed MusicXML', async () => {
    const result = await convertFile(encodeText('<?xml version="1.0"?><score-partwise><part-list></score-partwise>'));
    expect(result.status).toBe('rejected');
    expect(codes(result)).toEqual(['musicxml-unreadable']);
  });

  test('rejects an .mxl whose contents are over 50 MB, without extracting', async () => {
    const data = zip([
      { name: 'META-INF/container.xml', data: '<container/>' },
      { name: 'score.xml', data: '<score-partwise/>', size: 60 * 1024 * 1024 }
    ]);
    const result = await convertFile(data, 'big.mxl');
    expect(codes(result)).toEqual(['mxl-too-large']);
  });

  test('rejects an .mxl with no score in it', async () => {
    const data = zip([{ name: 'META-INF/container.xml', data: '<container><rootfiles/></container>' }, { name: 'readme.txt', data: 'hi' }]);
    expect(codes(await convertFile(data, 'empty.mxl'))).toEqual(['mxl-broken']);
  });
});
