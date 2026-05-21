const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const VENDOR_DIR = path.join(ROOT, 'public', 'vendor');
const NODE_MODULES = path.join(ROOT, 'node_modules');

const COPIES = [
  { from: 'tone/build/Tone.js',                              to: 'tone.js' },
  { from: '@tonejs/midi/build/Midi.js',                      to: 'midi.js' },
  { from: 'soundfont-player/dist/soundfont-player.min.js',   to: 'soundfont-player.min.js' },
  { from: 'spessasynth_lib/dist/index.js',                   to: 'spessasynth_lib.js' },
  { from: 'spessasynth_core/dist/index.js',                  to: 'spessasynth_core.js' },
  { from: 'spessasynth_lib/dist/spessasynth_processor.min.js', to: 'spessasynth_processor.min.js' }
];

function copyOne({ from, to }) {
  const src = path.join(NODE_MODULES, from);
  const dst = path.join(VENDOR_DIR, to);
  if (!fs.existsSync(src)) {
    throw new Error(`Source not found: ${src}. Did npm install run?`);
  }
  let contents = fs.readFileSync(src);
  if (to === 'spessasynth_lib.js') {
    contents = Buffer.from(
      contents.toString('utf8').replace(
        /from\s*(['"])spessasynth_core\1/g,
        'from $1./spessasynth_core.js$1'
      ),
      'utf8'
    );
  }
  fs.writeFileSync(dst, contents);
  console.log(`  ${from}  ->  public/vendor/${to}`);
}

fs.mkdirSync(VENDOR_DIR, { recursive: true });
console.log('Copying vendored libraries into public/vendor/ ...');
COPIES.forEach(copyOne);
console.log('Done.');
