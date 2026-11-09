/**
 * Unit tests for the "load your own file" dialog (public/ui/ImportDialog.js)
 */

const { ImportDialog, buildReport, failureReport } = require('../../../public/ui/ImportDialog.js');
const { convertFile } = require('../../../public/practice-midi/convert.js');
const { TPQ, track, song, line, notes, midiBytes } = require('../practice-midi/helpers.js');

function satb() {
  return song([
    track('Soprano', line(0, 72), notes(0, [[64 * TPQ, 72, TPQ, 100]])),
    track('Alto', line(1, 65)),
    track('Tenor', line(2, 59)),
    track('Bass', line(3, 50))
  ]);
}

describe('buildReport', () => {
  test('a converted file can be played, with problems listed first', () => {
    const report = buildReport({
      status: 'warning',
      messages: [
        { level: 'info', text: 'Voice parts: Soprano.' },
        { level: 'warning', text: 'Check this.' }
      ],
      suggested: { title: 'Gloria', composer: 'Vivaldi' },
      midi: new Uint8Array([1])
    }, 'gloria.mid');

    expect(report).toEqual({
      heading: 'Gloria',
      subheading: 'Vivaldi',
      status: 'warning',
      statusText: 'Ready to play. Please check the notes below.',
      messages: [
        { level: 'warning', text: 'Check this.' },
        { level: 'info', text: 'Voice parts: Soprano.' }
      ],
      canPlay: true
    });
  });

  test('a rejected file cannot be played and falls back to the file name', () => {
    const report = buildReport({ status: 'rejected', messages: [{ level: 'reject', text: 'No.' }], suggested: null, midi: null }, 'score.pdf');
    expect(report.heading).toBe('score.pdf');
    expect(report.canPlay).toBe(false);
    expect(report.statusText).toBe('This file can\'t be used.');
  });

  test('failure report explains the file could not be read', () => {
    const report = failureReport('odd.mid');
    expect(report.canPlay).toBe(false);
    expect(report.messages[0].text).toMatch(/Something went wrong/);
  });

  test('works with a real conversion', async () => {
    const result = await convertFile(midiBytes(satb()), 'My Anthem.mid');
    const report = buildReport(result, 'My Anthem.mid');
    expect(report.canPlay).toBe(true);
    expect(report.heading).toBe('My Anthem');
    expect(report.messages.some(m => m.text.startsWith('Voice parts:'))).toBe(true);
  });
});

describe('ImportDialog', () => {
  // Minimal stand-ins for the DOM elements the dialog uses
  function fakeElement() {
    const listeners = {};
    return {
      hidden: false, innerHTML: '', value: '', textContent: '', disabled: false, files: null,
      classList: { add: jest.fn(), remove: jest.fn() },
      addEventListener: (type, fn) => { listeners[type] = fn; },
      fire: (type, event = {}) => listeners[type]({ preventDefault: () => {}, ...event }),
      focus: jest.fn(),
      click: jest.fn(),
      querySelector: jest.fn()
    };
  }

  function setup(loadConverter, api) {
    const ids = ['import-file-input', 'import-choose-btn', 'import-drop-zone', 'import-working', 'import-report',
      'import-play-btn', 'import-again-btn', 'import-cancel-btn', 'import-dialog-close', 'import-saved-hint'];
    const elements = Object.fromEntries(ids.map(id => [id, fakeElement()]));
    const reportBody = fakeElement();
    elements['import-report'].querySelector = () => reportBody;
    const dialog = fakeElement();
    dialog.querySelector = selector => elements[selector.slice(1)];
    dialog.showModal = jest.fn();
    dialog.close = jest.fn();
    const openButton = fakeElement();
    const onPlay = jest.fn();
    const importDialog = new ImportDialog({ dialog, openButton, onPlay, loadConverter, api });
    return { importDialog, elements, reportBody, dialog, openButton, onPlay };
  }

  const file = (name, bytes) => ({ name, arrayBuffer: async () => bytes.buffer.slice(0) });
  const converter = async () => ({ convertFile });

  test('opening shows the file chooser', () => {
    const { elements, dialog, openButton } = setup();
    openButton.fire('click');

    expect(dialog.showModal).toHaveBeenCalled();
    expect(elements['import-drop-zone'].hidden).toBe(false);
    expect(elements['import-report'].hidden).toBe(true);
  });

  test('a converted file offers Play now and Cancel, composer above title', async () => {
    const { importDialog, elements, reportBody } = setup(converter);
    await importDialog.handleFile(file('Anthem.mid', midiBytes(satb())));

    expect(elements['import-report'].hidden).toBe(false);
    expect(elements['import-play-btn'].hidden).toBe(false);
    expect(elements['import-again-btn'].hidden).toBe(true);
    expect(elements['import-cancel-btn'].hidden).toBe(false);
    expect(reportBody.innerHTML).toContain('<h4 class="import-title">Anthem</h4>');
    expect(reportBody.innerHTML).toContain('Ready to play');
  });

  test('Play now saves to the uploaded files, then plays the saved piece', async () => {
    const api = { save: jest.fn(async piece => ({ id: 'abcdefghijkl', title: piece.title, composer: 'Smith' })) };
    const { importDialog, dialog, onPlay } = setup(converter, api);
    await importDialog.handleFile(file('Anthem.mid', midiBytes(satb())));
    await importDialog.play();

    expect(api.save).toHaveBeenCalledWith({ title: 'Anthem', composer: '', midi: expect.any(Uint8Array) });
    expect(dialog.close).toHaveBeenCalled();
    expect(onPlay).toHaveBeenCalledWith(expect.any(Uint8Array), 'Anthem', { pieceId: 'abcdefghijkl', composer: 'Smith', kind: 'library' });
  });

  test('if saving fails the piece still plays, with the reason', async () => {
    const api = { save: jest.fn(async () => { throw new Error('Your library is full (100 pieces).'); }) };
    const { importDialog, onPlay } = setup(converter, api);
    await importDialog.handleFile(file('Anthem.mid', midiBytes(satb())));
    await importDialog.play();

    expect(onPlay).toHaveBeenCalledWith(expect.any(Uint8Array), 'Anthem',
      { pieceId: null, composer: '', kind: 'file', saveError: 'Your library is full (100 pieces).' });
  });

  test('Cancel closes the dialog without playing', () => {
    const { elements, dialog, onPlay } = setup();
    elements['import-cancel-btn'].fire('click');
    expect(dialog.close).toHaveBeenCalled();
    expect(onPlay).not.toHaveBeenCalled();
  });

  test('a rejected file offers another choice, with names escaped', async () => {
    const api = { save: jest.fn() };
    const { importDialog, elements, reportBody, onPlay } = setup(converter, api);
    await importDialog.handleFile(file('<b>score</b>.pdf', new TextEncoder().encode('%PDF-1.4 not music')));

    expect(elements['import-play-btn'].hidden).toBe(true);
    expect(elements['import-again-btn'].hidden).toBe(false);
    expect(elements['import-saved-hint'].hidden).toBe(true);
    expect(elements['import-again-btn'].focus).toHaveBeenCalled();
    expect(reportBody.innerHTML).toContain('&lt;b&gt;score&lt;/b&gt;.pdf');
    expect(reportBody.innerHTML).not.toContain('<b>score');

    await importDialog.play();
    expect(api.save).not.toHaveBeenCalled();
    expect(onPlay).not.toHaveBeenCalled();
  });

  test('an unexpected error shows the failure report', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const { importDialog, reportBody } = setup(async () => ({ convertFile: async () => { throw new Error('boom'); } }));
    await importDialog.handleFile(file('x.mid', new Uint8Array([1, 2, 3])));

    expect(reportBody.innerHTML).toContain('Something went wrong');
    console.error.mockRestore();
  });
});
