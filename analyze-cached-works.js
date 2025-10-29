const fs = require('fs-extra');
const path = require('path');

// The 6 cached instruments
const CACHED_INSTRUMENTS = new Set([
    'acoustic_grand_piano',
    'piccolo',
    'clarinet',
    'bassoon',
    'french_horn',
    'string_ensemble_1'
]);

async function analyzeCachedWorks() {
    const csvPath = path.join(__dirname, 'midi-test-results.csv');
    const csvContent = await fs.readFile(csvPath, 'utf8');

    const lines = csvContent.split('\n');
    const header = lines[0];

    // Parse CSV - skip header
    const results = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Simple CSV parsing (handles quoted fields)
        const fields = [];
        let currentField = '';
        let inQuotes = false;

        for (let j = 0; j < line.length; j++) {
            const char = line[j];
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                fields.push(currentField);
                currentField = '';
            } else {
                currentField += char;
            }
        }
        fields.push(currentField); // Add last field

        if (fields.length >= 8) {
            results.push({
                composer: fields[0],
                work: fields[1],
                movement: fields[2],
                url: fields[3],
                status: fields[4],
                followsConvention: fields[5],
                channels: fields[6],
                instruments: fields[7]
            });
        }
    }

    console.log(`Parsed ${results.length} test results`);

    // Group by composer and work
    const works = new Map();

    for (const result of results) {
        // Skip copyright and error entries
        if (result.status !== 'VALID') continue;

        const key = `${result.composer}|||${result.work}`;
        if (!works.has(key)) {
            works.set(key, {
                composer: result.composer,
                work: result.work,
                movements: []
            });
        }

        works.get(key).movements.push(result);
    }

    console.log(`Found ${works.size} unique works\n`);

    // Find works where ALL movements use only cached instruments
    const suitableWorks = [];

    for (const [key, workData] of works) {
        let allMovementsUseCachedOnly = true;

        for (const movement of workData.movements) {
            const instrumentList = movement.instruments.split('; ');

            // Check if all instruments in this movement are cached
            for (const instrument of instrumentList) {
                if (instrument && !CACHED_INSTRUMENTS.has(instrument)) {
                    allMovementsUseCachedOnly = false;
                    break;
                }
            }

            if (!allMovementsUseCachedOnly) break;
        }

        if (allMovementsUseCachedOnly) {
            suitableWorks.push({
                composer: workData.composer,
                work: workData.work,
                movementCount: workData.movements.length,
                movements: workData.movements
            });
        }
    }

    console.log('='.repeat(80));
    console.log('WORKS USING ONLY CACHED INSTRUMENTS');
    console.log('='.repeat(80));
    console.log(`Found ${suitableWorks.length} works where ALL movements use only cached instruments\n`);

    // Sort by composer name
    suitableWorks.sort((a, b) => a.composer.localeCompare(b.composer));

    for (const work of suitableWorks) {
        console.log(`\n${work.composer} - ${work.work}`);
        console.log(`  Movements: ${work.movementCount}`);

        for (const movement of work.movements) {
            console.log(`    • ${movement.movement}`);
            console.log(`      Instruments: ${movement.instruments}`);
        }
    }

    console.log('\n' + '='.repeat(80));
    console.log('SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total suitable works: ${suitableWorks.length}`);

    // Suggest some good defaults
    console.log('\n\nRECOMMENDED DEFAULT MOVEMENTS:');
    console.log('(Single movements that use only the 4 standard instruments)\n');

    const singleMovementWorks = suitableWorks.filter(w => w.movementCount === 1);
    const standardFourOnly = singleMovementWorks.filter(w => {
        const instruments = w.movements[0].instruments.split('; ');
        const uniqueInstruments = new Set(instruments);
        return uniqueInstruments.size === 4 &&
               uniqueInstruments.has('piccolo') &&
               uniqueInstruments.has('clarinet') &&
               uniqueInstruments.has('french_horn') &&
               uniqueInstruments.has('bassoon');
    });

    console.log(`Found ${standardFourOnly.length} single movements using standard 4 instruments:\n`);
    for (const work of standardFourOnly.slice(0, 20)) {
        console.log(`  ${work.composer} - ${work.work} - ${work.movements[0].movement}`);
    }
}

analyzeCachedWorks().catch(error => {
    console.error('Error:', error);
    process.exit(1);
});
