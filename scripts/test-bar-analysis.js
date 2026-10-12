/**
 * Test script to analyze bar structure of Scarlatti Magnificat Movement 4
 * This will list all bars with their tempo and time signature information
 */

const Midi = require('@tonejs/midi').Midi;
const fs = require('fs');
const path = require('path');
const https = require('https');

// URL to the MIDI file - Change this to test different movements
const MIDI_URL = 'https://www.learnchoralmusic.co.uk/Scarlatti/Magnificat/4-Gloria.mid';
const MOVEMENT_NAME = 'Movement 4: Gloria Patri et Filio';

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
    // Convert MIDI ticks to seconds, accounting for tempo changes
    if (!tempos || tempos.length === 0) {
        // Default: 120 BPM
        return (ticks / ppq) * 0.5; // 60/120 = 0.5 seconds per quarter note
    }

    let time = 0;
    let lastTicks = 0;
    let lastTempo = tempos[0].bpm;

    for (let i = 0; i < tempos.length; i++) {
        const tempo = tempos[i];

        if (tempo.ticks > ticks) {
            // We've passed the target tick
            const tickDelta = ticks - lastTicks;
            const secondsPerBeat = 60 / lastTempo;
            time += (tickDelta / ppq) * secondsPerBeat;
            return time;
        }

        if (i > 0) {
            // Add time for the previous tempo segment
            const tickDelta = tempo.ticks - lastTicks;
            const secondsPerBeat = 60 / lastTempo;
            time += (tickDelta / ppq) * secondsPerBeat;
        }

        lastTicks = tempo.ticks;
        lastTempo = tempo.bpm;
    }

    // Handle remaining ticks after last tempo change
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

async function analyzeMidiFile(buffer, movementName) {
    console.log('='.repeat(80));
    console.log(`MIDI Bar Analysis for Scarlatti Magnificat ${movementName}`);
    console.log('='.repeat(80));
    console.log('');

    const midi = new Midi(buffer);

    console.log('FILE INFORMATION:');
    console.log('-'.repeat(80));
    console.log(`Duration: ${formatTime(midi.duration)} (${midi.duration.toFixed(3)} seconds)`);
    console.log(`Tracks: ${midi.tracks.length}`);
    console.log(`PPQ (Pulses per Quarter): ${midi.header.ppq}`);
    console.log('');

    // Get time signatures and tempos
    const timeSignatures = midi.header.timeSignatures || [];
    const tempos = midi.header.tempos || [];

    console.log('TIME SIGNATURES (RAW DATA):');
    console.log('-'.repeat(80));
    if (timeSignatures.length === 0) {
        console.log('None found - using default 4/4');
        timeSignatures.push({
            ticks: 0,
            timeSignature: [4, 4],
            measures: 0
        });
    } else {
        timeSignatures.forEach((ts, i) => {
            const time = ticksToSeconds(ts.ticks, tempos, midi.header.ppq);
            console.log(`${i + 1}. Time Signature Change at tick ${ts.ticks} (${formatTime(time)})`);
            console.log(`    Raw timeSignature array: [${ts.timeSignature.join(', ')}]`);
            console.log(`    Interpretation: ${ts.timeSignature[0]}/${ts.timeSignature[1]}`);
            if (ts.timeSignature.length > 2) {
                console.log(`    MIDI clocks per metronome click: ${ts.timeSignature[2]}`);
                console.log(`    32nd notes per quarter note: ${ts.timeSignature[3]}`);
            }
            console.log(`    Measures field: ${ts.measures}`);
            console.log('');
        });
    }
    console.log('');

    console.log('TEMPO CHANGES (showing first 20 and last 5):');
    console.log('-'.repeat(80));
    if (tempos.length === 0) {
        console.log('None found - using default 120 BPM');
        tempos.push({
            ticks: 0,
            bpm: 120
        });
    } else {
        console.log(`Total tempo changes: ${tempos.length}\n`);

        // Show first 20
        const showFirst = Math.min(20, tempos.length);
        for (let i = 0; i < showFirst; i++) {
            const t = tempos[i];
            const time = ticksToSeconds(t.ticks, tempos, midi.header.ppq);
            console.log(`${(i + 1).toString().padStart(3)}. ${t.bpm.toFixed(2).padStart(6)} BPM at tick ${t.ticks.toString().padStart(6)} (${formatTime(time)})`);
        }

        if (tempos.length > 25) {
            console.log('    ... [showing last 5] ...');
            for (let i = tempos.length - 5; i < tempos.length; i++) {
                const t = tempos[i];
                const time = ticksToSeconds(t.ticks, tempos, midi.header.ppq);
                console.log(`${(i + 1).toString().padStart(3)}. ${t.bpm.toFixed(2).padStart(6)} BPM at tick ${t.ticks.toString().padStart(6)} (${formatTime(time)})`);
            }
        }
    }
    console.log('');

    // Get PPQ
    const ppq = midi.header.ppq || 480;

    // Convert ticks to seconds for all events
    const timeSignaturesWithTime = timeSignatures.map(ts => ({
        ...ts,
        time: ticksToSeconds(ts.ticks, tempos, ppq)
    }));

    const temposWithTime = tempos.map(t => ({
        ...t,
        time: ticksToSeconds(t.ticks, tempos, ppq)
    }));

    // Calculate bars based on time signature CHANGES, not arbitrary MIDI bars
    const bars = [];
    let barNumber = 1;

    // Process each time signature section
    for (let tsIndex = 0; tsIndex < timeSignaturesWithTime.length; tsIndex++) {
        const currentTS = timeSignaturesWithTime[tsIndex];
        const nextTS = timeSignaturesWithTime[tsIndex + 1];

        const sectionStart = currentTS.time;
        const sectionEnd = nextTS ? nextTS.time : midi.duration;

        let numerator = currentTS.timeSignature[0] || 4;
        let denominator = currentTS.timeSignature[1] || 4;

        // Calculate beats per bar (in quarter notes)
        // For 8/4 time: 8 * (4/4) = 8 quarter notes per bar
        // This represents Alla Breve (2/2) in the score but with 8 quarter notes duration
        let beatsPerBar = numerator * (4 / denominator);

        // Determine how many bars to calculate in this section
        // The measures field indicates where the NEXT time signature starts (in bar numbers)
        let maxBarsInSection = Infinity;
        if (nextTS && nextTS.measures !== undefined && nextTS.measures > 0) {
            // nextTS.measures tells us the bar number where it starts
            // So this section should have (nextTS.measures - current barNumber + 1) bars
            maxBarsInSection = nextTS.measures - barNumber + 1;
        }

        // Calculate bars within this time signature section
        let currentTime = sectionStart;
        let currentTempoIndex = 0;
        let barsCreatedInSection = 0;

        // Find the tempo index at the start of this section
        for (let i = 0; i < temposWithTime.length; i++) {
            if (temposWithTime[i].time <= currentTime) {
                currentTempoIndex = i;
            }
        }

        while (currentTime < sectionEnd &&
               currentTime <= midi.duration &&
               barsCreatedInSection < maxBarsInSection) {
            // Update tempo if we've crossed a tempo change
            while (currentTempoIndex < temposWithTime.length - 1 &&
                   currentTime >= temposWithTime[currentTempoIndex + 1].time) {
                currentTempoIndex++;
            }

            const currentTempo = temposWithTime[currentTempoIndex];
            const bpm = currentTempo.bpm;

            bars.push({
                number: barNumber,
                time: currentTime,
                bpm: bpm,
                timeSignature: `${numerator}/${denominator}`
            });

            // Calculate seconds for this bar
            const secondsPerBeat = 60 / bpm;
            const secondsPerBar = secondsPerBeat * beatsPerBar;

            currentTime += secondsPerBar;
            barNumber++;
            barsCreatedInSection++;
        }
    }

    console.log('BAR BREAKDOWN (showing first 15 and bars around time sig change):');
    console.log('-'.repeat(80));
    console.log('Bar# | Time Position | Tempo (BPM) | Time Signature | Seconds/Bar');
    console.log('-'.repeat(80));

    let lastBPM = null;
    let lastTS = null;

    // Show first 15 bars
    for (let i = 0; i < Math.min(15, bars.length); i++) {
        const bar = bars[i];
        const nextBar = bars[i + 1];
        const secondsPerBar = nextBar ? (nextBar.time - bar.time).toFixed(3) : 'N/A';

        const tempoChanged = bar.bpm !== lastBPM;
        const tsChanged = bar.timeSignature !== lastTS;
        const marker = (tempoChanged || tsChanged) ? ' <<<' : '';

        console.log(
            `${bar.number.toString().padStart(4)} | ${formatTime(bar.time).padEnd(13)} | ` +
            `${bar.bpm.toFixed(2).padStart(11)} | ${bar.timeSignature.padEnd(14)} | ${secondsPerBar.padStart(11)}${marker}`
        );

        lastBPM = bar.bpm;
        lastTS = bar.timeSignature;
    }

    if (bars.length > 15) {
        console.log('     ... [' + (bars.length - 15) + ' more bars] ...');
    }

    console.log('-'.repeat(80));
    console.log(`\nTOTAL BARS CALCULATED: ${bars.length - 1}`); // Subtract 1 because last bar is past the end
    console.log(`\nPlease provide the actual bar count from the printed score.`);
    console.log('');

    // Analysis of the discrepancy
    console.log('DIAGNOSIS:');
    console.log('-'.repeat(80));
    console.log('Looking at the 8/4 time signature...');

    const bar11Index = bars.findIndex(b => b.timeSignature === '8/4');
    if (bar11Index >= 0) {
        const bar11 = bars[bar11Index];
        const bar12 = bars[bar11Index + 1];
        const secondsPerBar = bar12 ? (bar12.time - bar11.time) : 0;

        console.log(`\nFirst 8/4 bar is Bar ${bar11.number} at ${formatTime(bar11.time)}`);
        console.log(`Tempo at this bar: ${bar11.bpm.toFixed(2)} BPM`);
        console.log(`Calculated seconds per bar: ${secondsPerBar.toFixed(3)}`);

        const quarterNotesPerBar = 8 * (4/4); // 8 quarter notes
        const secondsPerQuarter = 60 / bar11.bpm;
        const expectedSeconds = quarterNotesPerBar * secondsPerQuarter;

        console.log(`\nExpected calculation for 8/4:`);
        console.log(`  - Quarter notes per bar: 8 * (4/4) = ${quarterNotesPerBar}`);
        console.log(`  - Seconds per quarter: 60 / ${bar11.bpm} = ${secondsPerQuarter.toFixed(3)}`);
        console.log(`  - Expected seconds per bar: ${expectedSeconds.toFixed(3)}`);

        console.log(`\nPOSSIBLE INTERPRETATION OPTIONS:`);
        console.log(`  Option 1: MIDI bars = Score bars (1:1 mapping)`);
        console.log(`    Total bars: ${bars.length - 1}`);

        const numFourFourBars = bar11Index;
        const numEightFourBars = bars.length - 1 - bar11Index;

        console.log(`\n  Option 2: Each 8/4 MIDI bar = 2 bars of 4/4 in score (2:1 mapping)`);
        console.log(`    ${numFourFourBars} bars of 4/4 + (${numEightFourBars} × 2) bars from 8/4 = ${numFourFourBars + numEightFourBars * 2} bars`);
    }

    // Summary
    const uniqueTempos = [...new Set(bars.map(b => b.bpm))];
    const uniqueTS = [...new Set(bars.map(b => b.timeSignature))];

    console.log('\n');
    console.log('SUMMARY:');
    console.log('-'.repeat(80));
    console.log(`Unique Tempos: ${uniqueTempos.length} different tempos`);
    console.log(`Unique Time Signatures: ${uniqueTS.join(', ')}`);
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
        await analyzeMidiFile(buffer, MOVEMENT_NAME);
    } catch (error) {
        console.error('ERROR analyzing MIDI file:', error.message);
        console.error(error.stack);
    }
})();
