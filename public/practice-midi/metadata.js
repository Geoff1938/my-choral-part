/**
 * Suggest a title and composer for a converted file, for the user to edit
 * before saving
 */

import { META, decodeText } from './smf.js';

// Track names that notation programs write in place of a title
const PLACEHOLDER_TITLE = /^(control track|tempo( control| track| map)?|conductor( track)?|track \d+|untitled.*|new song|sequence|midi|staff \d*|title)$/i;

// Text events that state the composer, e.g. "By J S Bach", "Composer: Schütz"
const COMPOSER_TEXT = /^\s*(?:music\s+by|composed\s+by|composer\s*:|by)\s+(.+?)\s*$/i;

/**
 * Make a title from a file name: no extension, underscores and dashes as spaces
 * @param {string} filename - File name
 * @returns {string} Title
 */
export function titleFromFilename(filename) {
    return (filename || '')
        .replace(/^.*[\\/]/, '')
        .replace(/\.[^.]*$/, '')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Suggest a title and composer from a MIDI file's first track
 * @param {{tracks: Array<{events: Array<Object>}>}} song - Parsed MIDI file
 * @param {string} [filename] - Original file name, the fallback title
 * @returns {{title: string, composer: string}} Suggestions (composer may be empty)
 */
export function suggestMetadata(song, filename = '') {
    const first = song.tracks[0];
    const hasNotes = first.events.some(e => e.type === 'noteOn');
    let title = '';
    let composer = '';

    if (!hasNotes) {
        const name = first.events.find(e => e.type === 'meta' && e.metaType === META.TRACK_NAME);
        const text = name ? decodeText(name.data).trim() : '';
        if (text && !PLACEHOLDER_TITLE.test(text)) {
            title = text;
        }
    }
    for (const event of first.events) {
        if (event.type === 'meta' && event.metaType === META.TEXT) {
            const match = decodeText(event.data).match(COMPOSER_TEXT);
            if (match) {
                composer = match[1];
                break;
            }
        }
    }

    return { title: title || titleFromFilename(filename), composer };
}
