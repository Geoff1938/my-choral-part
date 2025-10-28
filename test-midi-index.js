const fs = require('fs-extra');
const https = require('https');
const http = require('http');
const path = require('path');
const { Midi } = require('@tonejs/midi');

// Standard voice part to instrument mapping
const EXPECTED_INSTRUMENTS = {
    'soprano': 'piccolo',
    'alto': 'clarinet',
    'tenor': 'french_horn',
    'bass': 'bassoon'
};

// General MIDI program number to instrument name mapping
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

const BASE_URL = 'https://www.learnchoralmusic.co.uk';

class MidiIndexTester {
    constructor() {
        this.results = [];
        this.totalChecked = 0;
        this.totalErrors = 0;
        this.totalCopyright = 0;
        this.totalValid = 0;
        this.totalNonStandard = 0;
        this.instrumentCounts = {}; // Track instrument usage frequency
    }

    async loadIndex() {
        const indexPath = path.join(__dirname, 'data', 'midi-index-full.json');
        return await fs.readJSON(indexPath);
    }

    getInstrumentName(track) {
        if (track.instrument && track.instrument.number !== undefined) {
            const program = track.instrument.number;
            if (program >= 0 && program < GM_INSTRUMENTS.length) {
                return GM_INSTRUMENTS[program];
            }
        }
        return 'unknown';
    }

    async fetchMidiFile(url) {
        return new Promise((resolve, reject) => {
            const protocol = url.startsWith('https:') ? https : http;

            const options = {
                timeout: 10000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'audio/midi,audio/*,*/*',
                    'Referer': 'https://www.learnchoralmusic.co.uk/'
                }
            };

            const request = protocol.get(url, options, (response) => {
                if (response.statusCode !== 200) {
                    reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                    return;
                }

                const chunks = [];
                response.on('data', chunk => chunks.push(chunk));
                response.on('end', () => {
                    const buffer = Buffer.concat(chunks);
                    resolve(buffer);
                });
            });

            request.on('error', reject);
            request.on('timeout', () => {
                request.destroy();
                reject(new Error('Request timeout'));
            });
        });
    }

    async testMidiLink(composer, work, movement, midiUrl) {
        const result = {
            composer,
            work,
            movement,
            url: midiUrl,
            status: '',
            error: '',
            channels: '',
            instruments: '',
            followsConvention: '',
            issues: ''
        };

        this.totalChecked++;

        // Check if it's a copyright-protected work (HTML file)
        if (midiUrl.endsWith('.html') || midiUrl.endsWith('.htm')) {
            result.status = 'COPYRIGHT';
            result.followsConvention = 'N/A';
            this.totalCopyright++;
            return result;
        }

        // Build full URL
        const fullUrl = midiUrl.startsWith('http') ? midiUrl : `${BASE_URL}${midiUrl}`;

        try {
            // Fetch and parse MIDI file
            const buffer = await this.fetchMidiFile(fullUrl);
            const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
            const midi = new Midi(arrayBuffer);

            if (!midi || !midi.tracks || midi.tracks.length === 0) {
                result.status = 'ERROR';
                result.error = 'No tracks found in MIDI file';
                this.totalErrors++;
                return result;
            }

            // Analyze tracks
            const trackInfo = [];
            const instrumentsFound = [];
            const channelNames = [];

            for (let i = 0; i < midi.tracks.length; i++) {
                const track = midi.tracks[i];
                if (track.notes && track.notes.length > 0) {
                    const instrumentName = this.getInstrumentName(track);
                    const trackName = track.name || `Track ${i + 1}`;

                    trackInfo.push({
                        index: i,
                        name: trackName,
                        instrument: instrumentName,
                        noteCount: track.notes.length
                    });

                    instrumentsFound.push(instrumentName);
                    channelNames.push(trackName);

                    // Track instrument usage frequency
                    if (!this.instrumentCounts[instrumentName]) {
                        this.instrumentCounts[instrumentName] = 0;
                    }
                    this.instrumentCounts[instrumentName]++;
                }
            }

            result.status = 'VALID';
            result.channels = channelNames.join('; ');
            result.instruments = instrumentsFound.join('; ');

            // Check if it follows the standard convention
            const expectedInstruments = Object.values(EXPECTED_INSTRUMENTS);
            const hasStandardInstruments = expectedInstruments.every(expected =>
                instrumentsFound.includes(expected)
            );

            if (hasStandardInstruments && instrumentsFound.length === 4) {
                result.followsConvention = 'YES';
            } else {
                result.followsConvention = 'NO';
                this.totalNonStandard++;

                // Identify what's different
                const issues = [];
                const missing = expectedInstruments.filter(exp => !instrumentsFound.includes(exp));
                const extra = instrumentsFound.filter(inst => !expectedInstruments.includes(inst));

                if (missing.length > 0) {
                    issues.push(`Missing: ${missing.join(', ')}`);
                }
                if (extra.length > 0) {
                    issues.push(`Extra/Different: ${extra.join(', ')}`);
                }
                if (instrumentsFound.length !== 4) {
                    issues.push(`Has ${instrumentsFound.length} instruments instead of 4`);
                }

                result.issues = issues.join(' | ');
            }

            this.totalValid++;

        } catch (error) {
            result.status = 'ERROR';
            result.error = error.message;
            result.followsConvention = 'N/A';
            this.totalErrors++;
        }

        return result;
    }

    escapeCSV(value) {
        if (value === null || value === undefined) return '';
        const str = String(value);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    }

    async runTests(filterLetter = null) {
        console.log('Loading MIDI index...');
        const index = await this.loadIndex();

        // Filter composers if specified
        let composers = index;
        if (filterLetter) {
            composers = index.filter(c => c.name.toUpperCase().startsWith(filterLetter.toUpperCase()));
            console.log(`Filtered to ${composers.length} composers starting with "${filterLetter}"`);
        }

        console.log(`Testing ${composers.length} composers...`);

        for (const composer of composers) {
            console.log(`\nProcessing: ${composer.name}`);

            for (const work of composer.works) {
                if (work.sections && work.sections.length > 0) {
                    for (const section of work.sections) {
                        console.log(`  Testing: ${work.name} - ${section.name}`);

                        const result = await this.testMidiLink(
                            composer.name,
                            work.name,
                            section.name,
                            section.midiUrl
                        );

                        this.results.push(result);
                        console.log(`    Status: ${result.status}${result.followsConvention ? ` | Convention: ${result.followsConvention}` : ''}`);

                        // Add a small delay to avoid overwhelming the server
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                }
            }
        }
    }

    async writeCSV(filename) {
        const headers = [
            'Composer',
            'Work',
            'Movement',
            'URL',
            'Status',
            'Follows Convention',
            'Channels',
            'Instruments',
            'Issues',
            'Error'
        ];

        const rows = [headers.map(h => this.escapeCSV(h)).join(',')];

        for (const result of this.results) {
            const row = [
                result.composer,
                result.work,
                result.movement,
                result.url,
                result.status,
                result.followsConvention,
                result.channels,
                result.instruments,
                result.issues,
                result.error
            ];
            rows.push(row.map(v => this.escapeCSV(v)).join(','));
        }

        await fs.writeFile(filename, rows.join('\n'), 'utf8');
        console.log(`\nResults written to: ${filename}`);
    }

    async writeInstrumentStatsCSV(filename) {
        const headers = ['Instrument', 'Usage Count'];
        const rows = [headers.map(h => this.escapeCSV(h)).join(',')];

        // Sort instruments by frequency (most common first)
        const sortedInstruments = Object.entries(this.instrumentCounts)
            .sort((a, b) => b[1] - a[1]);

        for (const [instrument, count] of sortedInstruments) {
            const displayName = instrument.replace(/_/g, ' ');
            const row = [displayName, count];
            rows.push(row.map(v => this.escapeCSV(v)).join(','));
        }

        await fs.writeFile(filename, rows.join('\n'), 'utf8');
        console.log(`Instrument statistics written to: ${filename}`);
    }

    printSummary() {
        console.log('\n' + '='.repeat(60));
        console.log('TEST SUMMARY');
        console.log('='.repeat(60));
        console.log(`Total links checked: ${this.totalChecked}`);
        console.log(`Valid MIDI files: ${this.totalValid}`);
        console.log(`Copyright-protected: ${this.totalCopyright}`);
        console.log(`Errors: ${this.totalErrors}`);
        console.log(`Non-standard instruments: ${this.totalNonStandard}`);
        console.log('='.repeat(60));

        // Print instrument usage statistics
        console.log('\n' + '='.repeat(60));
        console.log('INSTRUMENT USAGE FREQUENCY');
        console.log('='.repeat(60));

        // Sort instruments by frequency (most common first)
        const sortedInstruments = Object.entries(this.instrumentCounts)
            .sort((a, b) => b[1] - a[1]);

        if (sortedInstruments.length === 0) {
            console.log('No instruments found');
        } else {
            console.log(`Total unique instruments: ${sortedInstruments.length}`);
            console.log('\nInstrument usage counts (sorted by frequency):');
            sortedInstruments.forEach(([instrument, count]) => {
                const displayName = instrument.replace(/_/g, ' ');
                console.log(`  ${displayName.padEnd(30)} : ${count}`);
            });
        }
        console.log('='.repeat(60));
    }
}

// Run the test
async function main() {
    const tester = new MidiIndexTester();

    // Test only composers starting with "A" for now
    await tester.runTests('A');

    // Write results to CSV
    const outputFile = path.join(__dirname, 'midi-test-results.csv');
    await tester.writeCSV(outputFile);

    // Write instrument statistics to CSV
    const instrumentStatsFile = path.join(__dirname, 'instrument-statistics.csv');
    await tester.writeInstrumentStatsCSV(instrumentStatsFile);

    // Print summary
    tester.printSummary();

    console.log(`\nDone! Check ${outputFile} for detailed results.`);
    console.log(`Check ${instrumentStatsFile} for instrument usage statistics.`);
}

main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
