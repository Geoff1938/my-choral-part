/**
 * Unit tests for public/practice-midi/detect.js and metadata.js
 */

const { detectFormat, readZipDirectory, xmlRootElement, unwrapRiffMidi } = require('../../../public/practice-midi/detect.js');
const { suggestMetadata, titleFromFilename } = require('../../../public/practice-midi/metadata.js');
const { encodeText, META } = require('../../../public/practice-midi/smf.js');
const { track, song, line } = require('./helpers.js');

/**
 * A zip archive with stored (uncompressed) entries, enough for directory reading
 */
function zip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const { name, size } of entries) {
    const nameBytes = encodeText(name);
    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    header.set(nameBytes, 30);
    local.push(header);
    const dir = new Uint8Array(46 + nameBytes.length);
    const dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint32(20, size, true);
    dv.setUint32(24, size, true);
    dv.setUint16(28, nameBytes.length, true);
    dv.setUint32(42, offset, true);
    dir.set(nameBytes, 46);
    central.push(dir);
    offset += header.length;
  }
  const centralSize = central.reduce((n, d) => n + d.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const parts = [...local, ...central, eocd];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

describe('detectFormat()', () => {
  test('MIDI by content, whatever the name', () => {
    expect(detectFormat(encodeText('MThd\u0000\u0000\u0000\u0006'), 'photo.jpg').format).toBe('midi');
  });

  test('MusicXML, partwise and timewise, with declaration, comments and doctype', () => {
    const xml = '\uFEFF<?xml version="1.0" encoding="UTF-8"?>\n<!-- exported -->\n'
      + '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n'
      + '<score-partwise version="4.0"></score-partwise>';
    expect(detectFormat(encodeText(xml)).format).toBe('musicxml');
    expect(detectFormat(encodeText('<score-timewise/>')).format).toBe('musicxml');
  });

  test('compressed MusicXML (.mxl) with its directory listed', () => {
    const data = zip([{ name: 'META-INF/container.xml', size: 200 }, { name: 'score.xml', size: 90000 }]);
    const result = detectFormat(data, 'score.mxl');
    expect(result.format).toBe('mxl');
    expect(result.zipEntries.map(e => [e.name, e.uncompressedSize])).toEqual([['META-INF/container.xml', 200], ['score.xml', 90000]]);
  });

  test('MuseScore files, zipped or not', () => {
    expect(detectFormat(zip([{ name: 'score.mscx', size: 10 }]), 'score.mscz').format).toBe('musescore');
    expect(detectFormat(encodeText('<museScore version="3.02"/>')).format).toBe('musescore');
  });

  test('PDF, notation files and anything else', () => {
    expect(detectFormat(encodeText('%PDF-1.4')).format).toBe('pdf');
    expect(detectFormat(encodeText('xyz'), 'Messiah.musx').format).toBe('notation');
    expect(detectFormat(encodeText('xyz'), 'readme.txt').format).toBe('unknown');
    expect(detectFormat(new Uint8Array(0)).format).toBe('unknown');
  });

  test('RIFF-wrapped MIDI is unwrapped', () => {
    const midi = encodeText('MThd123456');
    const riff = new Uint8Array(20 + midi.length);
    riff.set(encodeText('RIFF'), 0);
    riff.set(encodeText('RMID'), 8);
    riff.set(encodeText('data'), 12);
    new DataView(riff.buffer).setUint32(16, midi.length, true);
    riff.set(midi, 20);
    expect(detectFormat(riff).format).toBe('midi');
    expect(Array.from(unwrapRiffMidi(riff))).toEqual(Array.from(midi));
  });
});

describe('readZipDirectory()', () => {
  test('returns null for something that is not a zip', () => {
    expect(readZipDirectory(encodeText('PK but not really a zip file at all'))).toBeNull();
  });
});

describe('xmlRootElement()', () => {
  test('reads UTF-16 documents', () => {
    const text = '<?xml version="1.0" encoding="UTF-16"?><score-partwise/>';
    const bytes = new Uint8Array(2 + text.length * 2);
    bytes[0] = 0xff;
    bytes[1] = 0xfe;
    for (let i = 0; i < text.length; i++) bytes[2 + i * 2] = text.charCodeAt(i);
    expect(xmlRootElement(bytes)).toBe('score-partwise');
  });
});

describe('suggestMetadata()', () => {
  test('uses the first track\'s name and a "By" text event', () => {
    const s = song([track('Soprano', line(0, 72))], { title: 'Messiah: And the glory' });
    s.tracks[0].events.push({ tick: 0, type: 'meta', metaType: META.TEXT, data: encodeText('Music by G F Handel') });
    expect(suggestMetadata(s, 'x.mid')).toEqual({ title: 'Messiah: And the glory', composer: 'G F Handel' });
  });

  test('ignores placeholder names and falls back to the file name', () => {
    const s = song([track('Soprano', line(0, 72))], { title: 'Tempo Track' });
    expect(suggestMetadata(s, 'C:\\music\\Ave_verum-corpus.mid')).toEqual({ title: 'Ave verum corpus', composer: '' });
  });

  test('does not take a title from a first track that has notes', () => {
    const s = { format: 0, ticksPerQuarter: 480, tracks: [track('Soprano', line(0, 72))] };
    expect(suggestMetadata(s, 'piece.mid').title).toBe('piece');
  });
});

describe('titleFromFilename()', () => {
  test('strips the path and extension', () => {
    expect(titleFromFilename('/tmp/137_Beschluss.midi')).toBe('137 Beschluss');
    expect(titleFromFilename('')).toBe('');
  });
});
