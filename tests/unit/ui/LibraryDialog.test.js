/**
 * Unit tests for the "My uploaded files" dialog (public/ui/LibraryDialog.js)
 */

const { LibraryDialog, pieceName, pieceDetails, librarySummary, itemCount } = require('../../../public/ui/LibraryDialog.js');
const { toBase64, shareUrl } = require('../../../public/api/LibraryApi.js');

describe('text helpers', () => {
  test('pieceName puts the composer first', () => {
    expect(pieceName({ composer: 'Vivaldi', title: 'Gloria' })).toBe('Vivaldi – Gloria');
    expect(pieceName({ composer: '', title: 'Gloria' })).toBe('Gloria');
  });

  test('pieceDetails shows the date saved', () => {
    expect(pieceDetails({ createdAt: '2026-11-09T10:00:00Z' })).toBe('saved 9 Nov 2026');
    expect(pieceDetails({ createdAt: 'nonsense' })).toBe('');
  });

  test('librarySummary explains how to add files when empty, otherwise counts them', () => {
    expect(librarySummary(0, 100)).toMatch(/^You haven't uploaded any files yet/);
    expect(librarySummary(3, 100)).toBe('3 of 100 files');
  });

  test('itemCount', () => {
    expect(itemCount(1)).toBe('1 item');
    expect(itemCount(3)).toBe('3 items');
  });

  test('shareUrl builds piece and set links', () => {
    expect(shareUrl('piece', 'vivaldi-gloria-k7q2', 'https://player.test')).toBe('https://player.test/p/vivaldi-gloria-k7q2');
    expect(shareUrl('set', 'spring-concert-k7q2', 'https://player.test')).toBe('https://player.test/s/spring-concert-k7q2');
  });

  test('toBase64 matches Node\'s encoding, including large inputs', () => {
    const bytes = new Uint8Array(100000).map((_, i) => (i * 7) % 256);
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });
});

describe('LibraryDialog', () => {
  function fakeElement() {
    const listeners = {};
    return {
      hidden: false, innerHTML: '', textContent: '', className: '', checked: false,
      addEventListener: (type, fn) => { listeners[type] = fn; },
      querySelector: () => null
    };
  }

  const piecesData = () => [
    { id: 'aaaaaaaaaaaa', title: 'Gloria', composer: 'Vivaldi', createdAt: '2026-11-09T10:00:00Z', shareToken: null },
    { id: 'bbbbbbbbbbbb', title: '<Anthem>', composer: '', createdAt: '2026-11-08T10:00:00Z', shareToken: null }
  ];

  function setup(apiOverrides = {}, data = {}) {
    const ids = ['library-list', 'library-summary', 'library-status', 'library-dialog-close',
      'library-refs-section', 'library-refs', 'library-attest', 'library-attest-checkbox'];
    const elements = Object.fromEntries(ids.map(id => [id, fakeElement()]));
    const dialog = fakeElement();
    dialog.querySelector = selector => elements[selector.slice(1)];
    dialog.showModal = jest.fn();
    dialog.close = jest.fn();
    const api = {
      list: jest.fn(async () => ({ pieces: piecesData(), sets: [], references: [], attested: false, limit: 100, ...data })),
      fetchMidi: jest.fn(async () => new Uint8Array([1, 2, 3])),
      remove: jest.fn(async () => {}),
      attest: jest.fn(async () => {}),
      share: jest.fn(async () => 'vivaldi-gloria-k7q2'),
      unshare: jest.fn(async () => {}),
      removeReference: jest.fn(async () => {}),
      ...apiOverrides
    };
    const callbacks = { onPlay: jest.fn(), onOpenShared: jest.fn() };
    const libraryDialog = new LibraryDialog({ dialog, openButton: fakeElement(), api, origin: 'https://player.test', ...callbacks });
    return { libraryDialog, elements, dialog, api, ...callbacks };
  }

  test('opening lists the files composer first, with names escaped', async () => {
    const { libraryDialog, elements, dialog } = setup();
    await libraryDialog.open();

    expect(dialog.showModal).toHaveBeenCalled();
    expect(elements['library-summary'].textContent).toBe('2 of 100 files');
    expect(elements['library-list'].innerHTML).toContain('Vivaldi – Gloria');
    expect(elements['library-list'].innerHTML).toContain('&lt;Anthem&gt;');
    expect(elements['library-list'].innerHTML).not.toContain('<Anthem>');
    expect(elements['library-refs-section'].hidden).toBe(true);
  });

  test('Play fetches the piece and hands it to the player', async () => {
    const { libraryDialog, dialog, onPlay, api } = setup();
    await libraryDialog.open();
    await libraryDialog.handleAction('play', 'aaaaaaaaaaaa');

    expect(api.fetchMidi).toHaveBeenCalledWith('aaaaaaaaaaaa');
    expect(dialog.close).toHaveBeenCalled();
    expect(onPlay).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), 'Gloria', { pieceId: 'aaaaaaaaaaaa', composer: 'Vivaldi', kind: 'library' });
  });

  test('the rename form asks for the composer first', async () => {
    const { libraryDialog, elements } = setup();
    await libraryDialog.open();
    await libraryDialog.handleAction('rename', 'aaaaaaaaaaaa');
    const html = elements['library-list'].innerHTML;
    expect(html.indexOf('Composer')).toBeLessThan(html.indexOf('Title'));
  });

  test('Delete asks first, then removes the piece', async () => {
    const { libraryDialog, elements, api } = setup();
    await libraryDialog.open();

    await libraryDialog.handleAction('delete', 'aaaaaaaaaaaa');
    expect(api.remove).not.toHaveBeenCalled();
    expect(elements['library-list'].innerHTML).toContain('Delete this file?');

    await libraryDialog.handleAction('delete-confirm', 'aaaaaaaaaaaa');
    expect(api.remove).toHaveBeenCalledWith('aaaaaaaaaaaa');
    expect(elements['library-list'].innerHTML).not.toContain('Gloria');
    expect(elements['library-status'].textContent).toBe('Deleted "Vivaldi – Gloria".');
  });

  test('sharing needs a composer: without one, the rename form opens instead', async () => {
    const { libraryDialog, elements, api } = setup();
    await libraryDialog.open();
    await libraryDialog.handleAction('share', 'bbbbbbbbbbbb');

    expect(api.share).not.toHaveBeenCalled();
    expect(elements['library-attest'].hidden).toBe(true);
    expect(elements['library-list'].innerHTML).toContain('name="composer"');
    expect(elements['library-status'].textContent).toMatch(/add the composer/);
  });

  test('the first share asks for confirmation, then shares and shows the link', async () => {
    const { libraryDialog, elements, api } = setup();
    await libraryDialog.open();

    await libraryDialog.handleAction('share', 'aaaaaaaaaaaa');
    expect(api.share).not.toHaveBeenCalled();
    expect(elements['library-attest'].hidden).toBe(false);

    await libraryDialog.handleAction('attest-confirm', '');
    expect(api.attest).not.toHaveBeenCalled();

    elements['library-attest-checkbox'].checked = true;
    await libraryDialog.handleAction('attest-confirm', '');
    expect(api.attest).toHaveBeenCalled();
    expect(api.share).toHaveBeenCalledWith('piece', 'aaaaaaaaaaaa');
    expect(elements['library-attest'].hidden).toBe(true);
    expect(elements['library-list'].innerHTML).toContain('https://player.test/p/vivaldi-gloria-k7q2');
    expect(elements['library-list'].innerHTML).toContain('Stop sharing');
  });

  test('pieces shared with the user can be played or removed; unavailable ones only removed', async () => {
    const references = [
      { kind: 'piece', token: 'handel-messiah-abcd', available: true, title: 'Messiah', composer: 'Handel' },
      { kind: 'piece', token: 'gone-wxyz', available: false },
      { kind: 'set', token: 'a-set-abcd', available: true, title: 'Not shown here', itemCount: 2 }
    ];
    const { libraryDialog, elements, api, onOpenShared } = setup({}, { references });
    await libraryDialog.open();

    expect(elements['library-refs-section'].hidden).toBe(false);
    expect(elements['library-refs'].innerHTML).toContain('Handel – Messiah');
    expect(elements['library-refs'].innerHTML).toContain('No longer available');
    expect(elements['library-refs'].innerHTML).not.toContain('Not shown here');

    await libraryDialog.handleAction('open-shared', 'piece:handel-messiah-abcd');
    expect(onOpenShared).toHaveBeenCalledWith('piece', 'handel-messiah-abcd');

    await libraryDialog.handleAction('remove-ref', 'piece:gone-wxyz');
    expect(api.removeReference).toHaveBeenCalledWith('piece', 'gone-wxyz');
  });

  test('a server error is shown', async () => {
    const { libraryDialog, elements } = setup({ list: jest.fn(async () => { throw new Error('Couldn\'t reach the server.'); }) });
    await libraryDialog.open();
    expect(elements['library-status'].hidden).toBe(false);
    expect(elements['library-status'].textContent).toMatch(/Couldn't reach/);
  });
});
