const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

// Load the full index
const indexPath = path.join(__dirname, 'data', 'midi-index-full.json');
const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));

// Build rows for Excel
const rows = [];

for (const composer of index) {
    const composerName = composer.name;

    for (const work of composer.works) {
        const workName = work.name;

        for (const section of work.sections) {
            rows.push({
                'Composer': composerName,
                'Work': workName,
                'Movement': section.name,
                'MIDI File URL': section.midiUrl
            });
        }
    }
}

console.log(`Total rows: ${rows.length}`);

// Create workbook and worksheet
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.json_to_sheet(rows);

// Set column widths
ws['!cols'] = [
    { wch: 30 },  // Composer
    { wch: 50 },  // Work
    { wch: 50 },  // Movement
    { wch: 80 }   // MIDI File URL
];

XLSX.utils.book_append_sheet(wb, ws, 'MIDI Index');

// Write to file
const outputPath = path.join(__dirname, 'output_files', 'midi-index.xlsx');
XLSX.writeFile(wb, outputPath);

console.log(`Excel file saved to: ${outputPath}`);
