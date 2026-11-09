/**
 * Unit tests for the "My library" dialog (public/ui/LibraryDialog.js)
 */

const { LibraryDialog, pieceDetails, librarySummary } = require('../../../public/ui/LibraryDialog.js');
const { toBase64 } = require('../../../public/api/LibraryApi.js');

describe('pieceDetails', () => {
  test('shows the composer and the date saved', () => {
    expect(pieceDetails({ composer: 'Vivaldi', createdAt: '2026-11-09T10:00:00Z' })).toBe('Vivaldi · saved 9 Nov 2026');
    expect(pieceDetails({ composer: '', createdAt: '2026-11-09T10:00:00Z' })).toBe('saved 9 Nov 2026');
    expect(pieceDetails({ composer: 'Vivaldi', createdAt: 'nonsense' })).toBe('Vivaldi');
  });
});

describe('librarySummary', () => {
  test('explains how to add pieces when empty, otherwise counts them', () => {
    expect(librarySummary(0, 100)).toMatch(/^Your library is empty/);
    expect(librarySummary(3, 100)).toBe('3 of 100 pieces');
  });
});

describe('toBase64', () => {
  test('matches Node\'s encoding, including large inputs', () => {
    const bytes = new Uint8Array(100000).map((_, i) => (i * 7) % 256);
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });
});

describe('LibraryDialog', () => {
  function fakeElement() {
    const listeners = {};
    return {
      hidden: false, innerHTML: '', textContent: '', className: '',
      addEventListener: (type, fn) => { listeners[type] = fn; },
      fire: (type, event = {}) => listeners[type]({ preventDefault: () => {}, ...event }),
      querySelector: jest.fn()
    };
  }

  const pieces = [
    { id: 'aaaaaaaaaaaa', title: 'Gloria', composer: 'Vivaldi', createdAt: '2026-11-09T10:00:00Z' },
    { id: 'bbbbbbbbbbbb', title: '<Anthem>', composer: '', createdAt: '2026-11-08T10:00:00Z' }
  ];

  function setup(api) {
    const elements = Object.fromEntries(['library-list', 'library-summary', 'library-status', 'library-dialog-close']
      .map(id => [id, fakeElement()]));
    const dialog = fakeElement();
    dialog.querySelector = selector => elements[selector.slice(1)];
    dialog.showModal = jest.fn();
    dialog.close = jest.fn();
    const onPlay = jest.fn();
    const libraryDialog = new LibraryDialog({ dialog, openButton: fakeElement(), onPlay, api });
    return { libraryDialog, elements, dialog, onPlay };
  }

  const fakeApi = () => ({
    list: jest.fn(async () => ({ pieces: pieces.map(p => ({ ...p })), limit: 100 })),
    fetchMidi: jest.fn(async () => new Uint8Array([1, 2, 3])),
    remove: jest.fn(async () => {})
  });

  test('opening lists the pieces, with names escaped', async () => {
    const { libraryDialog, elements, dialog } = setup(fakeApi());
    await libraryDialog.open();

    expect(dialog.showModal).toHaveBeenCalled();
    expect(elements['library-summary'].textContent).toBe('2 of 100 pieces');
    expect(elements['library-list'].innerHTML).toContain('Gloria');
    expect(elements['library-list'].innerHTML).toContain('&lt;Anthem&gt;');
    expect(elements['library-list'].innerHTML).not.toContain('<Anthem>');
  });

  test('Play fetches the piece and hands it to the player', async () => {
    const api = fakeApi();
    const { libraryDialog, dialog, onPlay } = setup(api);
    await libraryDialog.open();
    await libraryDialog.handleAction('play', 'aaaaaaaaaaaa');

    expect(api.fetchMidi).toHaveBeenCalledWith('aaaaaaaaaaaa');
    expect(dialog.close).toHaveBeenCalled();
    expect(onPlay).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), 'Gloria', { pieceId: 'aaaaaaaaaaaa', composer: 'Vivaldi' });
  });

  test('Delete asks first, then removes the piece', async () => {
    const api = fakeApi();
    const { libraryDialog, elements } = setup(api);
    await libraryDialog.open();

    await libraryDialog.handleAction('delete', 'aaaaaaaaaaaa');
    expect(api.remove).not.toHaveBeenCalled();
    expect(elements['library-list'].innerHTML).toContain('Delete this piece?');

    await libraryDialog.handleAction('delete-confirm', 'aaaaaaaaaaaa');
    expect(api.remove).toHaveBeenCalledWith('aaaaaaaaaaaa');
    expect(elements['library-list'].innerHTML).not.toContain('Gloria');
    expect(elements['library-summary'].textContent).toBe('1 of 100 pieces');
    expect(elements['library-status'].textContent).toBe('Deleted "Gloria".');
  });

  test('a server error is shown', async () => {
    const api = fakeApi();
    api.list = jest.fn(async () => { throw new Error('Couldn\'t reach the server.'); });
    const { libraryDialog, elements } = setup(api);
    await libraryDialog.open();

    expect(elements['library-status'].hidden).toBe(false);
    expect(elements['library-status'].textContent).toMatch(/Couldn't reach/);
  });
});
