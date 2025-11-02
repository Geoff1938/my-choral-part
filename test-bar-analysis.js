/**
 * Test script to analyze bar structure of Scarlatti Magnificat Movement 4
 * This will list all bars with their tempo and time signature information
 */

const Midi = require('@tonejs/midi').Midi;
const fs = require('fs');
const path = require('path');
const https = require('https');

// URL to the MIDI file
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

async function analyzeMidiFile(buffer) {
    console.log('='.repeat(80));
    console.log('MIDI Bar Analysis for Scarlatti Magnificat Movement 4: Gloria Patri et Filio');
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

    console.log('TIME SIGNATURES:');
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
            console.log(`${i + 1}. ${ts.timeSignature[0]}/${ts.timeSignature[1]} at tick ${ts.ticks} (${formatTime(time)})`);
        });
    }
    console.log('');

    console.log('TEMPO CHANGES:');
    console.log('-'.repeat(80));
    if (tempos.length === 0) {
        console.log('None found - using default 120 BPM');
        tempos.push({
            ticks: 0,
            bpm: 120
        });
    } else {
        tempos.forEach((t, i) => {
            const time = ticksToSeconds(t.ticks, tempos, midi.header.ppq);
            console.log(`${i + 1}. ${t.bpm.toFixed(2)} BPM at tick ${t.ticks} (${formatTime(time)})`);
        });
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

    // Calculate bars
    const bars = [];
    let currentTime = 0;
    let barNumber = 1;
    let currentTSIndex = 0;
    let currentTempoIndex = 0;

    while (currentTime <= midi.duration) {
        // Check if we need to switch to a new time signature
        if (currentTSIndex < timeSignaturesWithTime.length - 1 &&
            currentTime >= timeSignaturesWithTime[currentTSIndex + 1].time) {
            currentTSIndex++;
        }

        // Check if we need to switch to a new tempo
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
            timeSignature: `${numerator}/${denominator}`
        });

        // Calculate seconds per bar
        const secondsPerBeat = 60 / bpm;
        const beatsPerBar = numerator * (4 / denominator);
        const secondsPerBar = secondsPerBeat * beatsPerBar;

        currentTime += secondsPerBar;
        barNumber++;
    }

    console.log('BAR BREAKDOWN:');
    console.log('-'.repeat(80));
    console.log('Bar# | Time Position | Tempo (BPM) | Time Signature');
    console.log('-'.repeat(80));

    let lastBPM = null;
    let lastTS = null;

    bars.forEach(bar => {
        const tempoChanged = bar.bpm !== lastBPM;
        const tsChanged = bar.timeSignature !== lastTS;
        const marker = (tempoChanged || tsChanged) ? ' <<<' : '';

        console.log(
            `${bar.number.toString().padStart(4)} | ${formatTime(bar.time).padEnd(13)} | ` +
            `${bar.bpm.toFixed(2).padStart(11)} | ${bar.timeSignature.padEnd(14)}${marker}`
        );

        lastBPM = bar.bpm;
        lastTS = bar.timeSignature;
    });

    console.log('-'.repeat(80));
    console.log(`\nTOTAL BARS: ${bars.length - 1}`); // Subtract 1 because last bar is past the end
    console.log('');

    // Summary
    const uniqueTempos = [...new Set(bars.map(b => b.bpm))];
    const uniqueTS = [...new Set(bars.map(b => b.timeSignature))];

    console.log('SUMMARY:');
    console.log('-'.repeat(80));
    console.log(`Unique Tempos: ${uniqueTempos.map(t => `${t.toFixed(2)} BPM`).join(', ')}`);
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
        await analyzeMidiFile(buffer);
    } catch (error) {
        console.error('ERROR analyzing MIDI file:', error.message);
        console.error(error.stack);
    }
})();
