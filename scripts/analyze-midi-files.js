/**
 * MIDI File Analyzer
 *
 * Retrieves all MIDI files from the index and extracts:
 * - List of instruments in each movement
 * - Total number of bars in each movement
 * - Exception report for unrecognized file formats
 *
 * Output: data/midi-analysis.json
 *
 * Usage: node scripts/analyze-midi-files.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { Midi } = require('@tonejs/midi');

// Configuration
const BASE_URL = 'https://www.learnchoralmusic.co.uk';
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'midi-analysis.json');
const INDEX_FILE = path.join(__dirname, '..', 'data', 'midi-index.json');
const REQUEST_DELAY = 500; // ms between requests to avoid rate limiting
const REQUEST_TIMEOUT = 30000; // 30 seconds

// General MIDI instrument names (program 0-127)
const GM_INSTRUMENTS = [
  'acoustic_grand_piano', 'bright_acoustic_piano', 'electric_grand_piano', 'honkytonk_piano',
  'electric_piano_1', 'electric_piano_2', 'harpsichord', 'clavinet',
  'celesta', 'glockenspiel', 'music_box', 'vibraphone',
  'marimba', 'xylophone', 'tubular_bells', 'dulcimer',
  'drawbar_organ', 'percussive_organ', 'rock_organ', 'church_organ',
  'reed_organ', 'accordion', 'harmonica', 'tango_accordion',
  'acoustic_guitar_nylon', 'acoustic_guitar_steel', 'electric_guitar_jazz', 'electric_guitar_clean',
  'electric_guitar_muted', 'overdriven_guitar', 'distortion_guitar', 'guitar_harmonics',
  'acoustic_bass', 'electric_bass_finger', 'electric_bass_pick', 'fretless_bass',
  'slap_bass_1', 'slap_bass_2', 'synth_bass_1', 'synth_bass_2',
  'violin', 'viola', 'cello', 'contrabass',
  'tremolo_strings', 'pizzicato_strings', 'orchestral_harp', 'timpani',
  'string_ensemble_1', 'string_ensemble_2', 'synth_strings_1', 'synth_strings_2',
  'choir_aahs', 'voice_oohs', 'synth_choir', 'orchestra_hit',
  'trumpet', 'trombone', 'tuba', 'muted_trumpet',
  'french_horn', 'brass_section', 'synth_brass_1', 'synth_brass_2',
  'soprano_sax', 'alto_sax', 'tenor_sax', 'baritone_sax',
  'oboe', 'english_horn', 'bassoon', 'clarinet',
  'piccolo', 'flute', 'recorder', 'pan_flute',
  'blown_bottle', 'shakuhachi', 'whistle', 'ocarina',
  'lead_1_square', 'lead_2_sawtooth', 'lead_3_calliope', 'lead_4_chiff',
  'lead_5_charang', 'lead_6_voice', 'lead_7_fifths', 'lead_8_bass_lead',
  'pad_1_new_age', 'pad_2_warm', 'pad_3_polysynth', 'pad_4_choir',
  'pad_5_bowed', 'pad_6_metallic', 'pad_7_halo', 'pad_8_sweep',
  'fx_1_rain', 'fx_2_soundtrack', 'fx_3_crystal', 'fx_4_atmosphere',
  'fx_5_brightness', 'fx_6_goblins', 'fx_7_echoes', 'fx_8_scifi',
  'sitar', 'banjo', 'shamisen', 'koto',
  'kalimba', 'bagpipe', 'fiddle', 'shanai',
  'tinkle_bell', 'agogo', 'steel_drums', 'woodblock',
  'taiko_drum', 'melodic_tom', 'synth_drum', 'reverse_cymbal',
  'guitar_fret_noise', 'breath_noise', 'seashore', 'bird_tweet',
  'telephone_ring', 'helicopter', 'applause', 'gunshot'
];

/**
 * Convert MIDI program number to instrument name
 */
function programToInstrument(program) {
  if (program >= 0 && program < GM_INSTRUMENTS.length) {
    return GM_INSTRUMENTS[program];
  }
  return 'acoustic_grand_piano';
}

/**
 * Get instrument name from a track
 */
function getTrackInstrument(track) {
  if (track.instrument && track.instrument.name) {
    return track.instrument.name.toLowerCase().replace(/\s+/g, '_');
  }
  if (track.instrument && typeof track.instrument.number === 'number') {
    return programToInstrument(track.instrument.number);
  }
  return 'acoustic_grand_piano';
}

/**
 * Calculate the number of bars in a MIDI file
 */
function calculateBars(midi) {
  if (!midi || !midi.header) return 0;

  const duration = midi.duration;
  if (!duration || duration <= 0) return 0;

  // Get time signatures
  const timeSignatures = midi.header.timeSignatures || [];

  if (timeSignatures.length === 0) {
    // Default to 4/4 time
    const bpm = midi.header.tempos && midi.header.tempos.length > 0
      ? midi.header.tempos[0].bpm
      : 120;
    const secondsPerBeat = 60 / bpm;
    const secondsPerBar = secondsPerBeat * 4;
    return Math.ceil(duration / secondsPerBar);
  }

  // Calculate bars considering time signature changes
  let totalBars = 0;
  let currentTime = 0;

  for (let i = 0; i < timeSignatures.length; i++) {
    const ts = timeSignatures[i];
    const nextTs = timeSignatures[i + 1];
    const endTime = nextTs ? nextTs.ticks / midi.header.ppq * (60 / (midi.header.tempos[0]?.bpm || 120)) : duration;

    const beatsPerBar = ts.timeSignature[0];
    const beatUnit = ts.timeSignature[1];

    // Get tempo at this point
    const bpm = midi.header.tempos && midi.header.tempos.length > 0
      ? midi.header.tempos[0].bpm
      : 120;

    const secondsPerBeat = 60 / bpm * (4 / beatUnit);
    const secondsPerBar = secondsPerBeat * beatsPerBar;

    const sectionDuration = endTime - currentTime;
    totalBars += Math.ceil(sectionDuration / secondsPerBar);
    currentTime = endTime;
  }

  return totalBars || Math.ceil(duration / 2); // Fallback estimate
}

/**
 * Fetch a MIDI file from URL
 */
function fetchMidiFile(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;

    const options = {
      timeout: REQUEST_TIMEOUT,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'audio/midi,audio/*,*/*'
      }
    };

    const request = protocol.get(url, options, (response) => {
      // Handle redirects
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          const absoluteUrl = redirectUrl.startsWith('http')
            ? redirectUrl
            : new URL(redirectUrl, url).href;
          return fetchMidiFile(absoluteUrl).then(resolve).catch(reject);
        }
      }

      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
        return;
      }

      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });

    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

/**
 * Analyze a single MIDI file
 */
async function analyzeMidiFile(url, composer, work, movementName) {
  try {
    const buffer = await fetchMidiFile(url);

    // Try to parse as MIDI
    let midi;
    try {
      midi = new Midi(buffer);
    } catch (parseError) {
      return {
        success: false,
        error: `Invalid MIDI format: ${parseError.message}`,
        url
      };
    }

    // Extract instruments from tracks with notes
    const instruments = [];
    const trackDetails = [];

    for (const track of midi.tracks) {
      if (track.notes && track.notes.length > 0) {
        const instrument = getTrackInstrument(track);
        const trackName = track.name || 'Unnamed';

        if (!instruments.includes(instrument)) {
          instruments.push(instrument);
        }

        trackDetails.push({
          name: trackName,
          instrument: instrument,
          noteCount: track.notes.length
        });
      }
    }

    // Calculate bars
    const bars = calculateBars(midi);

    // Get tempo and time signature info
    const tempos = midi.header.tempos || [];
    const timeSignatures = midi.header.timeSignatures || [];

    return {
      success: true,
      composer,
      work,
      movement: movementName,
      url,
      duration: midi.duration,
      bars,
      instruments,
      trackCount: trackDetails.length,
      tracks: trackDetails,
      tempo: tempos.length > 0 ? tempos[0].bpm : null,
      timeSignature: timeSignatures.length > 0
        ? `${timeSignatures[0].timeSignature[0]}/${timeSignatures[0].timeSignature[1]}`
        : '4/4'
    };

  } catch (error) {
    return {
      success: false,
      error: error.message,
      composer,
      work,
      movement: movementName,
      url
    };
  }
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Main analysis function
 */
async function analyzeAllMidiFiles() {
  console.log('MIDI File Analyzer');
  console.log('==================\n');

  // Load the index
  console.log('Loading MIDI index...');
  let index;
  try {
    const indexData = fs.readFileSync(INDEX_FILE, 'utf8');
    index = JSON.parse(indexData);
  } catch (error) {
    console.error(`Error loading index: ${error.message}`);
    process.exit(1);
  }

  console.log(`Found ${index.length} composers in index\n`);

  // Collect all MIDI URLs
  const midiFiles = [];
  for (const composer of index) {
    for (const work of composer.works) {
      for (const movement of work.movements) {
        // Skip copyright-protected files
        if (movement.midiUrl.endsWith('.html') || movement.midiUrl.endsWith('.htm')) {
          continue;
        }

        const absoluteUrl = movement.midiUrl.startsWith('http')
          ? movement.midiUrl
          : BASE_URL + movement.midiUrl;

        midiFiles.push({
          composer: composer.name,
          work: work.name,
          movement: movement.name,
          url: absoluteUrl
        });
      }
    }
  }

  console.log(`Found ${midiFiles.length} MIDI files to analyze\n`);

  // Results
  const results = {
    analyzedAt: new Date().toISOString(),
    totalFiles: midiFiles.length,
    successful: 0,
    failed: 0,
    movements: [],
    exceptions: []
  };

  // Analyze each file
  let processed = 0;
  for (const file of midiFiles) {
    processed++;
    const progress = Math.round((processed / midiFiles.length) * 100);
    process.stdout.write(`\rAnalyzing: ${processed}/${midiFiles.length} (${progress}%) - ${file.composer}, ${file.work}`);
    process.stdout.write(' '.repeat(50)); // Clear rest of line

    const analysis = await analyzeMidiFile(file.url, file.composer, file.work, file.movement);

    if (analysis.success) {
      results.successful++;
      results.movements.push({
        composer: analysis.composer,
        work: analysis.work,
        movement: analysis.movement,
        instruments: analysis.instruments,
        bars: analysis.bars,
        duration: Math.round(analysis.duration),
        tempo: analysis.tempo,
        timeSignature: analysis.timeSignature,
        trackCount: analysis.trackCount
      });
    } else {
      results.failed++;
      results.exceptions.push({
        composer: file.composer,
        work: file.work,
        movement: file.movement,
        url: file.url,
        error: analysis.error
      });
    }

    // Delay between requests
    await sleep(REQUEST_DELAY);
  }

  console.log('\n\n');

  // Summary
  console.log('Analysis Complete');
  console.log('=================');
  console.log(`Total files: ${results.totalFiles}`);
  console.log(`Successful: ${results.successful}`);
  console.log(`Failed: ${results.failed}`);

  if (results.exceptions.length > 0) {
    console.log(`\nException Report (${results.exceptions.length} files):`);
    console.log('-'.repeat(50));
    for (const ex of results.exceptions) {
      console.log(`  ${ex.composer}, ${ex.work} - ${ex.movement}`);
      console.log(`    Error: ${ex.error}`);
    }
  }

  // Generate instrument summary
  const instrumentCounts = {};
  for (const m of results.movements) {
    for (const inst of m.instruments) {
      instrumentCounts[inst] = (instrumentCounts[inst] || 0) + 1;
    }
  }

  console.log('\nInstrument Usage Summary:');
  console.log('-'.repeat(50));
  const sortedInstruments = Object.entries(instrumentCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);
  for (const [inst, count] of sortedInstruments) {
    console.log(`  ${inst}: ${count} movements`);
  }

  // Save results
  console.log(`\nSaving results to ${OUTPUT_FILE}...`);
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
  console.log('Done!');

  return results;
}

// Run the analyzer
analyzeAllMidiFiles().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
