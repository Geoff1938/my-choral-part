/**
 * Detailed analysis of tenor line (french horn) for Movement 4
 * Focusing on bars 9-10 transition
 */

const Midi = require('@tonejs/midi').Midi;
const https = require('https');

const MIDI_URL = 'https://www.learnchoralmusic.co.uk/Scarlatti/Magnificat/4-Gloria.mid';

async function fetchMidiFile(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                return;
            }

            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => resolve(Buffer.concat(chunks)));
            response.on('error', reject);
        }).on('error', reject);
    });
}

function ticksToSeconds(ticks, tempos, ppq) {
    if (!tempos || tempos.length === 0) {
        return (ticks / ppq) * 0.5;
    }

    let time = 0;
    let lastTicks = 0;
    let lastTempo = tempos[0].bpm;

    for (let i = 0; i < tempos.length; i++) {
        const tempo = tempos[i];

        if (tempo.ticks > ticks) {
            const tickDelta = ticks - lastTicks;
            const secondsPerBeat = 60 / lastTempo;
            time += (tickDelta / ppq) * secondsPerBeat;
            return time;
        }

        if (i > 0) {
            const tickDelta = tempo.ticks - lastTicks;
            const secondsPerBeat = 60 / lastTempo;
            time += (tickDelta / ppq) * secondsPerBeat;
        }

        lastTicks = tempo.ticks;
        lastTempo = tempo.bpm;
    }

    const tickDelta = ticks - lastTicks;
    const secondsPerBeat = 60 / lastTempo;
    time += (tickDelta / ppq) * secondsPerBeat;

    return time;
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

async function analyzeTenorLine(buffer) {
    console.log('='.repeat(80));
    console.log('Detailed Tenor Line (French Horn) Analysis - Bars 7-10');
    console.log('Scarlatti Magnificat Movement 4: Gloria Patri et Filio');
    console.log('='.repeat(80));
    console.log('');

    const midi = new Midi(buffer);
    const ppq = midi.header.ppq;
    const timeSignatures = midi.header.timeSignatures || [];
    const tempos = midi.header.tempos || [];

    console.log('FILE INFO:');
    console.log(`PPQ: ${ppq}`);
    console.log(`Tracks: ${midi.tracks.length}`);
    console.log('');

    // Find the tenor/french horn track
    console.log('TRACKS:');
    midi.tracks.forEach((track, idx) => {
        console.log(`  ${idx}: ${track.name} (${track.notes.length} notes, instrument: ${track.instrument?.name || 'N/A'})`);
    });
    console.log('');

    // Look for french horn or tenor (exact match to avoid "Countertenor")
    let tenorTrack = null;
    let tenorTrackIndex = -1;

    for (let i = 0; i < midi.tracks.length; i++) {
        const track = midi.tracks[i];
        const name = track.name.toLowerCase();
        // Match "Tenor" exactly or "horn" (but not "countertenor")
        if ((name === 'tenor' || name.includes('horn')) && !name.includes('counter')) {
            tenorTrack = track;
            tenorTrackIndex = i;
            break;
        }
    }

    if (!tenorTrack) {
        console.log('Could not find tenor/french horn track. Available tracks:');
        midi.tracks.forEach((track, idx) => {
            console.log(`  ${idx}: "${track.name}"`);
        });
        return;
    }

    console.log(`ANALYZING TRACK ${tenorTrackIndex}: "${tenorTrack.name}"`);
    console.log('='.repeat(80));
    console.log('');

    // Calculate bar boundaries
    const bars = [];
    let currentTime = 0;
    let barNumber = 1;
    let currentTSIndex = 0;
    let currentTempoIndex = 0;

    const timeSignaturesWithTime = timeSignatures.map(ts => ({
        ...ts,
        time: ticksToSeconds(ts.ticks, tempos, ppq)
    }));

    const temposWithTime = tempos.map(t => ({
        ...t,
        time: ticksToSeconds(t.ticks, tempos, ppq)
    }));

    // Calculate bars
    while (currentTime <= midi.duration && barNumber <= 15) {
        if (currentTSIndex < timeSignaturesWithTime.length - 1 &&
            currentTime >= timeSignaturesWithTime[currentTSIndex + 1].time) {
            currentTSIndex++;
        }

        if (currentTempoIndex < temposWithTime.length - 1 &&
            currentTime >= temposWithTime[currentTempoIndex + 1].time) {
            currentTempoIndex++;
        }

        const currentTS = timeSignaturesWithTime[currentTSIndex];
        const currentTempo = temposWithTime[currentTempoIndex];

        const numerator = currentTS.timeSignature[0] || 4;
        const denominator = currentTS.timeSignature[1] || 4;
        const bpm = currentTempo.bpm;

        bars.push({
            number: barNumber,
            time: currentTime,
            bpm: bpm,
            timeSignature: `${numerator}/${denominator}`,
            ticks: currentTime * ppq * bpm / 60 // Approximate
        });

        const secondsPerBeat = 60 / bpm;
        const beatsPerBar = numerator * (4 / denominator);
        const secondsPerBar = secondsPerBeat * beatsPerBar;

        currentTime += secondsPerBar;
        barNumber++;
    }

    console.log('BAR BOUNDARIES (Bars 1-12):');
    console.log('-'.repeat(80));
    for (let i = 0; i < Math.min(12, bars.length); i++) {
        const bar = bars[i];
        const nextBar = bars[i + 1];
        const duration = nextBar ? (nextBar.time - bar.time).toFixed(3) : 'N/A';
        console.log(`Bar ${bar.number.toString().padStart(2)}: ${formatTime(bar.time)} - ${nextBar ? formatTime(nextBar.time) : 'end'} (${duration}s, ${bar.timeSignature}, ${bar.bpm} BPM)`);
    }
    console.log('');

    // Get time range for bars 7-10
    const bar7 = bars.find(b => b.number === 7);
    const bar11 = bars.find(b => b.number === 11);

    if (!bar7 || !bar11) {
        console.log('ERROR: Could not find bars 7-11');
        return;
    }

    const startTime = bar7.time;
    const endTime = bar11.time;

    console.log('TIME SIGNATURE CHANGES:');
    console.log('-'.repeat(80));
    timeSignaturesWithTime.forEach((ts, i) => {
        if (ts.time >= startTime - 5 && ts.time <= endTime + 5) {
            console.log(`At ${formatTime(ts.time)} (tick ${ts.ticks}): ${ts.timeSignature[0]}/${ts.timeSignature[1]} (measures field: ${ts.measures})`);
        }
    });
    console.log('');

    console.log('TEMPO CHANGES IN THIS REGION:');
    console.log('-'.repeat(80));
    temposWithTime.forEach((t, i) => {
        if (t.time >= startTime - 5 && t.time <= endTime + 5) {
            console.log(`At ${formatTime(t.time)} (tick ${t.ticks}): ${t.bpm.toFixed(2)} BPM`);
        }
    });
    console.log('');

    // Filter notes that are SOUNDING during this range (not just starting)
    const notesInRange = tenorTrack.notes.filter(note => {
        const noteEnd = note.time + note.duration;
        // Include if note overlaps with the time range at all
        return (note.time < endTime && noteEnd > startTime);
    });

    console.log('TENOR LINE NOTES (Bars 7-10):');
    console.log('-'.repeat(80));
    console.log(`Total notes sounding in range: ${notesInRange.length}`);
    console.log('');
    console.log('Note: Duration shows when each note is sounding, which bar it starts in');
    console.log('');
    console.log('Start Time | End Time  | Tick  | Start | Note | Duration | Velocity | Across Bars?');
    console.log('-'.repeat(80));

    notesInRange.forEach(note => {
        const noteEnd = note.time + note.duration;

        // Determine which bar this note STARTS in
        let startBar = 'N/A';
        for (let i = 0; i < bars.length - 1; i++) {
            if (note.time >= bars[i].time && note.time < bars[i + 1].time) {
                startBar = bars[i].number;
                break;
            }
        }

        // Check if note spans multiple bars
        let spansBars = '';
        for (let i = 0; i < bars.length - 1; i++) {
            if (note.time < bars[i + 1].time && noteEnd > bars[i + 1].time) {
                spansBars = ` → Bar ${bars[i + 1].number}`;
            }
        }

        console.log(
            `${formatTime(note.time)} | ${formatTime(noteEnd)} | ${note.ticks.toString().padStart(5)} | Bar ${startBar.toString().padStart(2)} | ` +
            `${note.name.padEnd(4)} | ${note.duration.toFixed(3).padStart(8)} | ${note.velocity.toFixed(2).padStart(8)} | ${spansBars}`
        );
    });

    console.log('');
    console.log('INTERPRETATION:');
    console.log('-'.repeat(80));
    console.log('Look at the pattern of notes and their timing to understand:');
    console.log('1. Are there rests/silences at the start of bar 10?');
    console.log('2. How do the notes align with the time signature change?');
    console.log('3. What is the actual rhythmic structure?');
    console.log('');
    console.log('='.repeat(80));
}

// Run the analysis
(async () => {
    try {
        console.log(`Fetching MIDI file from: ${MIDI_URL}`);
        console.log('');
        const buffer = await fetchMidiFile(MIDI_URL);
        console.log(`Downloaded ${buffer.length} bytes`);
        console.log('');
        await analyzeTenorLine(buffer);
    } catch (error) {
        console.error('ERROR analyzing MIDI file:', error.message);
        console.error(error.stack);
    }
})();
