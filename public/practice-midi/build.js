/**
 * Apply the practice recipe to classified parts and assemble the output file:
 * a conductor track, then the voice parts (soprano to bass), then
 * accompaniment and solo parts in their source order.
 */

import { META, encodeText } from './smf.js';
import {
    CC, SECTIONS, ACCOMPANIMENT_CHANNELS, START_VOLUME, REVERB, CHORUS,
    ACCOMPANIMENT_PAN, DEFAULT_VELOCITY, voiceTrackName, voiceSlot
} from './recipe.js';
import { isChoralTrackName } from './voiceParts.js';

// Controllers the recipe sets on voice tracks; the source's values are dropped
const VOICE_REPLACED_CC = new Set([CC.BANK_SELECT, CC.BANK_SELECT_LSB, CC.PAN, CC.REVERB, CC.CHORUS]);

// Controllers the recipe sets on accompaniment tracks
const ACCOMPANIMENT_REPLACED_CC = new Set([CC.REVERB, CC.CHORUS]);

function nameEvent(name) {
    return { tick: 0, type: 'meta', metaType: META.TRACK_NAME, data: encodeText(name) };
}

function controller(channel, number, value) {
    return { tick: 0, type: 'controller', channel, controller: number, value };
}

function clampVelocity(velocity) {
    return Math.min(127, Math.max(1, Math.round(velocity)));
}

/**
 * Note-on and note-off events for a part's notes on a channel.
 * Zero-length notes are inaudible and cannot be written unambiguously, so
 * they are left out.
 */
function noteEvents(notes, channel, velocityOf) {
    const events = [];
    for (const note of notes) {
        if (note.duration <= 0) continue;
        events.push({ tick: note.tick, type: 'noteOn', channel, note: note.note, velocity: velocityOf(note.velocity) });
        events.push({ tick: note.tick + note.duration, type: 'noteOff', channel, note: note.note, velocity: note.offVelocity });
    }
    return events;
}

/**
 * Starting volume: the recipe's 64, unless the source sets its own volume at
 * the very start (its automation is kept either way)
 */
function startVolumeEvents(controlEvents, channel) {
    const hasStartVolume = controlEvents.some(e => e.type === 'controller' && e.controller === CC.VOLUME && e.tick === 0);
    return hasStartVolume ? [] : [controller(channel, CC.VOLUME, START_VOLUME)];
}

/**
 * Name for an accompaniment track: its source name, unless the player would
 * mistake it for a voice part (e.g. "Bass (continuo)") or it has none
 * @param {Object} part - Classified part
 * @param {number} position - 1-based position among accompaniment parts
 * @returns {string} Track name
 */
export function accompanimentName(part, position) {
    const name = (part.sourceName || '').trim();
    if (name && !isChoralTrackName(name)) {
        return name;
    }
    if (/continuo|\bb\.?\s?c\.?\b/i.test(name)) return 'Continuo';
    if (/organ|orgel|orgue/i.test(name)) return 'Organ';
    if (/piano|klavier/i.test(name)) return 'Piano';
    return `Accompaniment ${position}`;
}

/**
 * Choose channels for accompaniment parts: keep a part's source channel when
 * the recipe allows it and it is free, otherwise take the next free one. If
 * the channels run out, a part may share with another that plays the same
 * single instrument.
 * @param {Array<Object>} parts - Accompaniment and solo parts, in order
 * @returns {Map<Object, number>|null} Channel for each part, or null if they don't fit
 */
export function assignAccompanimentChannels(parts) {
    const channels = new Map();
    const used = new Set();
    const pending = [];
    for (const part of parts) {
        if (ACCOMPANIMENT_CHANNELS.includes(part.sourceChannel) && !used.has(part.sourceChannel)) {
            channels.set(part, part.sourceChannel);
            used.add(part.sourceChannel);
        } else {
            pending.push(part);
        }
    }
    const programsOf = part => [...new Set(part.controlEvents.filter(e => e.type === 'program').map(e => e.program))];
    for (const part of pending) {
        const free = ACCOMPANIMENT_CHANNELS.find(c => !used.has(c));
        if (free !== undefined) {
            channels.set(part, free);
            used.add(free);
            continue;
        }
        const programs = programsOf(part);
        const partner = programs.length === 1 && [...channels.keys()].find(other => {
            const otherPrograms = programsOf(other);
            return otherPrograms.length === 1 && otherPrograms[0] === programs[0];
        });
        if (!partner) {
            return null;
        }
        channels.set(part, channels.get(partner));
    }
    return channels;
}

/**
 * Build the practice MIDI file
 * @param {{ticksPerQuarter: number, tracks: Array<Object>}} song - Parsed source file (for its resolution and length)
 * @param {{parts: Array<Object>, conductorEvents: Array<Object>, conductorName: string|null}} classified - Result of classifyParts
 * @param {Object<string, Array<Object>>} voices - Result of groupVoices
 * @param {Map<Object, number>} accompanimentChannels - Result of assignAccompanimentChannels
 * @returns {{song: Object, velocityScale: number|null, outputParts: Array<Object>}}
 *     The output file, the factor applied to velocities when the source had no
 *     dynamics (null otherwise), and each part's output name and channel
 */
export function buildPracticeSong(song, classified, voices, accompanimentChannels) {
    // Constant velocity across the voices means the source has no dynamics:
    // voices move to the default level, accompaniment by the same factor
    const voiceVelocities = new Set();
    for (const group of Object.values(voices)) {
        for (const part of group) {
            part.notes.forEach(n => voiceVelocities.add(n.velocity));
        }
    }
    const velocityScale = voiceVelocities.size === 1 ? DEFAULT_VELOCITY / [...voiceVelocities][0] : null;
    const velocityOf = velocityScale === null ? v => v : v => clampVelocity(v * velocityScale);

    // Conductor track: tempo map, time signatures, copyright and text, without duplicates
    const seen = new Set();
    const conductor = [];
    if (classified.conductorName) {
        conductor.push(nameEvent(classified.conductorName));
    }
    for (const event of classified.conductorEvents) {
        const key = `${event.tick}:${event.type}:${event.metaType ?? event.status}:${Array.from(event.data).join(',')}`;
        if (!seen.has(key)) {
            seen.add(key);
            conductor.push(event);
        }
    }
    // Keep any silence after the last note: the conductor track ends where the source did
    const endTick = Math.max(0, ...song.tracks.map(t => (t.events.length ? t.events[t.events.length - 1].tick : 0)));
    conductor.push({ tick: endTick, type: 'meta', metaType: META.END_OF_TRACK, data: new Uint8Array(0) });
    const tracks = [{ events: conductor }];
    const outputParts = [];

    for (const section of SECTIONS) {
        const group = voices[section] || [];
        group.forEach((part, i) => {
            const slot = voiceSlot(section, i + 1);
            const name = voiceTrackName(section, i + 1, group.length);
            const kept = part.controlEvents
                .filter(e => e.type !== 'program' && !(e.type === 'controller' && VOICE_REPLACED_CC.has(e.controller)))
                .map(e => ({ ...e, channel: slot.channel }));
            tracks.push({
                events: [
                    nameEvent(name),
                    { tick: 0, type: 'program', channel: slot.channel, program: slot.program },
                    ...startVolumeEvents(part.controlEvents, slot.channel),
                    controller(slot.channel, CC.PAN, slot.pan),
                    controller(slot.channel, CC.REVERB, REVERB),
                    controller(slot.channel, CC.CHORUS, CHORUS),
                    ...kept,
                    ...part.otherEvents,
                    ...noteEvents(part.notes, slot.channel, v => (velocityScale === null ? v : DEFAULT_VELOCITY))
                ]
            });
            outputParts.push({ part, name, channel: slot.channel });
        });
    }

    let position = 0;
    for (const part of classified.parts.filter(p => p.role !== 'voice')) {
        const channel = part.role === 'percussion' ? 9 : accompanimentChannels.get(part);
        const name = part.role === 'accompaniment' ? accompanimentName(part, ++position) : (part.sourceName || 'Percussion');
        const hasPan = part.controlEvents.some(e => e.type === 'controller' && e.controller === CC.PAN);
        const kept = part.controlEvents
            .filter(e => !(e.type === 'controller' && ACCOMPANIMENT_REPLACED_CC.has(e.controller)))
            .map(e => ({ ...e, channel }));
        tracks.push({
            events: [
                nameEvent(name),
                ...startVolumeEvents(part.controlEvents, channel),
                ...(hasPan ? [] : [controller(channel, CC.PAN, ACCOMPANIMENT_PAN)]),
                controller(channel, CC.REVERB, REVERB),
                controller(channel, CC.CHORUS, CHORUS),
                ...kept,
                ...part.otherEvents,
                ...noteEvents(part.notes, channel, velocityOf)
            ]
        });
        outputParts.push({ part, name, channel });
    }

    return {
        song: { format: 1, ticksPerQuarter: song.ticksPerQuarter, tracks },
        velocityScale,
        outputParts
    };
}
