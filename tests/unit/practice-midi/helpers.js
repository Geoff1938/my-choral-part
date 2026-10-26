/**
 * Helpers for building small MIDI files in tests
 */

const zlib = require('zlib');
const { writeMidi, encodeText, META } = require('../../../public/practice-midi/smf.js');

const TPQ = 480;

function nameEvent(name) {
  return { tick: 0, type: 'meta', metaType: META.TRACK_NAME, data: encodeText(name) };
}

function tempoEvent(bpm, tick = 0) {
  const us = Math.round(60e6 / bpm);
  return { tick, type: 'meta', metaType: META.TEMPO, data: new Uint8Array([(us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff]) };
}

function lyricEvent(text, tick) {
  return { tick, type: 'meta', metaType: META.LYRIC, data: encodeText(text) };
}

/**
 * Note events for a list of [tick, pitch, duration, velocity?]
 */
function notes(channel, list, velocity = 80) {
  const events = [];
  for (const [tick, note, duration, v] of list) {
    events.push({ tick, type: 'noteOn', channel, note, velocity: v ?? velocity });
    events.push({ tick: tick + duration, type: 'noteOff', channel, note, velocity: 0 });
  }
  return events;
}

/**
 * A simple melodic line: `count` quarter notes stepping around `centre`
 */
function line(channel, centre, { count = 64, velocity = 80, start = 0 } = {}) {
  const steps = [0, 2, 4, 2, 0, -1, -3, -1];
  return notes(channel, Array.from({ length: count }, (_, i) => [start + i * TPQ, centre + steps[i % steps.length], TPQ, velocity]));
}

/**
 * A track: [name, ...events]
 */
function track(name, ...eventLists) {
  const events = name === null ? [] : [nameEvent(name)];
  for (const list of eventLists) {
    events.push(...(Array.isArray(list) ? list : [list]));
  }
  return { events };
}

/**
 * A type 1 file with a conductor track (tempo, optional name) and the given tracks
 */
function song(tracks, { bpm = 100, title = null, format = 1 } = {}) {
  const conductor = { events: [...(title ? [nameEvent(title)] : []), ...(bpm ? [tempoEvent(bpm)] : [])] };
  return { format, ticksPerQuarter: TPQ, tracks: [conductor, ...tracks] };
}

function midiBytes(s) {
  return writeMidi(s);
}

/**
 * A zip archive. Each entry has a name and either `data` (bytes or text,
 * stored or, with `deflate: true`, compressed) or just a claimed `size`
 * (no real contents, for directory-only tests).
 */
function zip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBytes = encodeText(entry.name);
    const raw = entry.data === undefined ? new Uint8Array(0)
      : (typeof entry.data === 'string' ? encodeText(entry.data) : entry.data);
    const body = entry.deflate ? new Uint8Array(zlib.deflateRawSync(raw)) : raw;
    const size = entry.size ?? raw.length;
    const header = new Uint8Array(30 + nameBytes.length + body.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(8, entry.deflate ? 8 : 0, true);
    view.setUint32(18, body.length, true);
    view.setUint32(22, size, true);
    view.setUint16(26, nameBytes.length, true);
    header.set(nameBytes, 30);
    header.set(body, 30 + nameBytes.length);
    local.push(header);
    const dir = new Uint8Array(46 + nameBytes.length);
    const dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(10, entry.deflate ? 8 : 0, true);
    dv.setUint32(20, body.length, true);
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

/**
 * MusicXML <note>: { step, octave, alter, duration, voice, staff, chord,
 * rest, tie ('start'|'stop'|'both'), lyric, syllabic, cue, grace }
 */
function xmlNote(n) {
  const ties = n.tie === 'both' ? ['stop', 'start'] : (n.tie ? [n.tie] : []);
  return '<note>'
    + (n.grace ? '<grace/>' : '')
    + (n.cue ? '<cue/>' : '')
    + (n.chord ? '<chord/>' : '')
    + (n.rest ? '<rest/>' : `<pitch><step>${n.step}</step>${n.alter ? `<alter>${n.alter}</alter>` : ''}<octave>${n.octave}</octave></pitch>`)
    + (n.grace ? '' : `<duration>${n.duration}</duration>`)
    + ties.map(t => `<tie type="${t}"/>`).join('')
    + `<voice>${n.voice || 1}</voice>`
    + (n.staff ? `<staff>${n.staff}</staff>` : '')
    + (n.lyric ? `<lyric number="1"><syllabic>${n.syllabic || 'single'}</syllabic><text>${n.lyric}</text></lyric>` : '')
    + '</note>';
}

/**
 * A partwise MusicXML score. parts: [{ id, name, instrument, program,
 * measures: [string of measure contents, ...] }]; the first measure of each
 * part should hold its <attributes>.
 */
function xmlScore(parts, { header = '' } = {}) {
  const partList = parts.map(p => `<score-part id="${p.id}"><part-name>${p.name}</part-name>`
    + (p.instrument ? `<score-instrument id="${p.id}-I1"><instrument-name>${p.instrument}</instrument-name></score-instrument>` : '')
    + (p.program ? `<midi-instrument id="${p.id}-I1"><midi-program>${p.program}</midi-program></midi-instrument>` : '')
    + '</score-part>').join('');
  const body = parts.map(p => `<part id="${p.id}">${p.measures.map((m, i) => `<measure number="${i + 1}">${m}</measure>`).join('')}</part>`).join('');
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n'
    + `<score-partwise version="4.0">${header}<part-list>${partList}</part-list>${body}</score-partwise>`;
}

/**
 * Attributes for a first measure
 */
function xmlAttributes({ divisions = 1, beats = 4, beatType = 4, fifths = 0, clef = '<clef><sign>G</sign><line>2</line></clef>', staves = '', extra = '' } = {}) {
  return `<attributes><divisions>${divisions}</divisions><key><fifths>${fifths}</fifths></key>`
    + `<time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time>${staves ? `<staves>${staves}</staves>` : ''}${clef}${extra}</attributes>`;
}

/**
 * Four quarter notes on one pitch in 4/4 (divisions 1)
 */
function xmlBar(step, octave, extra = {}) {
  return [0, 1, 2, 3].map(() => xmlNote({ step, octave, duration: 1, ...extra })).join('');
}

module.exports = {
  TPQ, nameEvent, tempoEvent, lyricEvent, notes, line, track, song, midiBytes,
  zip, xmlNote, xmlScore, xmlAttributes, xmlBar
};
