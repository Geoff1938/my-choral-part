/**
 * The choral parts in a MIDI file as the My Part dropdown lists them, and
 * which of them to pick for a singer.
 *
 * A section with one line is listed as "Tenor"; a section that divides is
 * listed as "Tenor 1", "Tenor 2". The singer's choice is remembered as a
 * section and a number (e.g. tenor 2): a movement with a single tenor line
 * uses that line, and the next movement that divides uses Tenor 2 again.
 */

import { parseName } from '../practice-midi/classify.js';
import { detectVoicePartFromName, normalizeChannelName } from '../practice-midi/voiceParts.js';

const SECTION_TITLES = { soprano: 'Soprano', alto: 'Alto', tenor: 'Tenor', bass: 'Bass' };

/**
 * Work out the section and line number a track name gives
 * @param {string} name - Track name
 * @returns {{voicePart: string, number: number|null}|null} Null if the track is not a choral part
 */
function parsePart(name) {
    const parsed = parseName(name);
    if (parsed.kind === 'voice') {
        return { voicePart: parsed.section, number: parsed.number };
    }
    if (parsed.kind === 'mixed' || parsed.kind === 'unknown') {
        // Fall back to the simpler matching, e.g. "Soprano/Alto" counts as soprano
        const normalized = normalizeChannelName(name);
        const voicePart = detectVoicePartFromName(normalized);
        if (voicePart && !/\bsolo\b/i.test(normalized)) {
            return { voicePart, number: null };
        }
    }
    return null;
}

/**
 * List the choral parts among a file's tracks, numbered and labelled
 * @param {Array<{name: string}>} tracks - Tracks in dropdown order; any other properties are kept
 * @returns {Array<Object>} The choral tracks, each with voicePart, number (null when the
 *     section has a single line) and label ("Tenor", "Tenor 2") added
 */
export function listChoralParts(tracks) {
    const parts = [];
    for (const track of tracks) {
        const part = parsePart(track.name);
        if (part) {
            parts.push({ ...track, ...part });
        }
    }

    const sections = new Map();
    for (const part of parts) {
        if (!sections.has(part.voicePart)) sections.set(part.voicePart, []);
        sections.get(part.voicePart).push(part);
    }

    for (const lines of sections.values()) {
        if (lines.length === 1) {
            lines[0].number = null;
        } else {
            const numbers = lines.map(line => line.number).filter(n => n !== null);
            if (new Set(numbers).size !== numbers.length) {
                // The same number twice (e.g. Soprano 1 in each of two choirs): number in order
                lines.forEach((line, i) => { line.number = i + 1; });
            } else {
                // Give unnumbered lines the lowest numbers not already used
                const used = new Set(numbers);
                let next = 1;
                for (const line of lines) {
                    if (line.number !== null) continue;
                    while (used.has(next)) next++;
                    line.number = next;
                    used.add(next);
                }
            }
        }
        for (const line of lines) {
            const title = SECTION_TITLES[line.voicePart];
            line.label = line.number === null ? title : `${title} ${line.number}`;
        }
    }
    return parts;
}

/**
 * Pick the part a singer sings from the listed parts
 * @param {Array<{voicePart: string, number: number|null}>} parts - From listChoralParts
 * @param {{voicePart: string, number: number|null}} preference - The singer's remembered part
 * @returns {Object|null} The part to select, or null if the file has no line for the section
 */
export function choosePart(parts, preference) {
    const lines = parts.filter(part => part.voicePart === preference.voicePart);
    if (lines.length <= 1 || preference.number === null || preference.number === undefined) {
        return lines[0] || null;
    }
    const exact = lines.find(line => line.number === preference.number);
    if (exact) return exact;
    // E.g. a third soprano when the sopranos only divide in two: the highest number below
    const lower = lines.filter(line => line.number < preference.number);
    if (lower.length) {
        return lower.reduce((best, line) => (line.number > best.number ? line : best));
    }
    return lines[0];
}

/**
 * The remembered part after the singer picks a part
 * @param {{voicePart: string, number: number|null}} preference - The part remembered before
 * @param {{voicePart: string, number: number|null}} chosen - The part picked
 * @returns {{voicePart: string, number: number|null}} Picking the single line of a section keeps
 *     the number remembered for that section, so a tenor 2 stays tenor 2
 */
export function rememberPart(preference, chosen) {
    if (chosen.number !== null && chosen.number !== undefined) {
        return { voicePart: chosen.voicePart, number: chosen.number };
    }
    return {
        voicePart: chosen.voicePart,
        number: chosen.voicePart === preference.voicePart ? preference.number : null
    };
}
