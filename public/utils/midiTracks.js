/**
 * Tidying of tracks as @tonejs/midi reads them
 */

import { isChoralTrackName } from '../practice-midi/voiceParts.js';

/**
 * @tonejs/midi starts a new, unnamed track whenever a track changes
 * instrument part-way through (common in accompaniment, e.g. strings
 * switching to organ). Name each such track after the named accompaniment
 * track on the same channel, e.g. "Violins, etc (2)", so the channel list
 * doesn't show anonymous "Channel N" entries. Voice tracks are left alone so
 * a voice can never appear twice in the My Part list.
 * @param {Array<{name: string, channel: number, notes: Array}>} tracks - Midi.tracks (changed in place)
 * @returns {number} How many tracks were named
 */
export function nameSplitTracks(tracks) {
    const counts = new Map();
    let named = 0;
    for (const track of tracks) {
        if (track.name || !track.notes || track.notes.length === 0) continue;
        const parent = tracks.find(other => other !== track && other.name && other.channel === track.channel &&
            !isChoralTrackName(other.name));
        if (!parent) continue;
        const count = (counts.get(parent) || 1) + 1;
        counts.set(parent, count);
        track.name = `${parent.name} (${count})`;
        named++;
    }
    return named;
}
