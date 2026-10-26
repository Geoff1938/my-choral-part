/**
 * How the player recognises voice parts from track names
 * Shared by the player (My Part dropdown) and the practice MIDI converter, so
 * that converted files name their tracks in a way the player understands.
 */

/**
 * Normalize voice part synonyms in a track name
 * @param {string} name - Track name
 * @returns {string} Name with Treble -> Soprano and Countertenor -> Alto
 */
export function normalizeChannelName(name) {
    if (!name) return name;

    // Case-insensitive replacements
    let normalized = name;

    // Treble -> Soprano
    normalized = normalized.replace(/\bTreble\b/gi, 'Soprano');

    // Counter-tenor / Countertenor / Counter tenor -> Alto
    normalized = normalized.replace(/\bCounter[-\s]?tenor\b/gi, 'Alto');

    return normalized;
}

/**
 * Detect voice part category from a track name
 * @param {string} name - Track name
 * @returns {string|null} 'soprano', 'alto', 'tenor', 'bass', or null if not a vocal part
 */
export function detectVoicePartFromName(name) {
    if (!name) return null;
    const lower = name.toLowerCase();

    // Exclude non-vocal uses of "bass" (D'Bass = double bass, bass guitar, bass drum, etc.)
    if (/\bd['']\s*bass\b/.test(lower)) return null;
    if (/\bbass\s*(guitar|drum|trombone|clarinet|flute|sax)\b/.test(lower)) return null;

    // Order matters: check more specific patterns before general ones
    if (/\bmezzo[-\s]?soprano\b/.test(lower)) return 'alto';
    if (/\bsoprano\b/.test(lower)) return 'soprano';
    if (/\btreble\b/.test(lower)) return 'soprano';
    if (/\bcounter[-\s]?tenor\b/.test(lower)) return 'alto';
    if (/\balto\b/.test(lower)) return 'alto';
    if (/\btenor\b/.test(lower)) return 'tenor';
    if (/\bbaritone\b/.test(lower)) return 'bass';
    if (/\bbass\b/.test(lower)) return 'bass';

    return null;
}

/**
 * Whether the player would treat a track name as a choral voice part
 * (it skips solo parts)
 * @param {string} name - Track name
 * @returns {boolean} True if the track would appear as a choral part
 */
export function isChoralTrackName(name) {
    const normalized = normalizeChannelName(name);
    return detectVoicePartFromName(normalized) !== null && !/\bsolo\b/i.test(normalized);
}
