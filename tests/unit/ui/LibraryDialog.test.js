/**
 * Unit tests for the "My library" dialog (public/ui/LibraryDialog.js)
 */

const { LibraryDialog, pieceDetails, librarySummary, pieceCount } = require('../../../public/ui/LibraryDialog.js');
const { toBase64, shareUrl } = require('../../../public/api/LibraryApi.js');

describe('text helpers', () => {
  test('pieceDetails shows the composer and the date saved', () => {
    expect(pieceDetails({ composer: 'Vivaldi', createdAt: '2026-11-09T10:00:00Z' })).toBe('Vivaldi · saved 9 Nov 2026');
    expect(pieceDetails({ composer: '', createdAt: '2026-11-09T10:00:00Z' })).toBe('saved 9 Nov 2026');
    expect(pieceDetails({ composer: 'Vivaldi', createdAt: 'nonsense' })).toBe('Vivaldi');
  });

  test('librarySummary explains how to add pieces when empty, otherwise counts them', () => {
    expect(librarySummary(0, 100)).toMatch(/^You haven't saved any pieces yet/);
    expect(librarySummary(3, 100)).toBe('3 of 100 pieces');
  });

  test('pieceCount', () => {
    expect(pieceCount(1)).toBe('1 piece');
    expect(pieceCount(3)).toBe('3 pieces');
  });

  test('shareUrl builds piece and set links', () => {
    expect(shareUrl('piece', 'AbCdEfGhIjKlMnOp', 'https://player.test')).toBe('https://player.test/p/AbCdEfGhIjKlMnOp');
    expect(shareUrl('set', 'AbCdEfGhIjKlMnOp', 'https://player.test')).toBe('https://player.test/s/AbCdEfGhIjKlMnOp');
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
    const ids = ['library-list', 'library-summary', 'library-status', 'library-dialog-close', 'library-sets',
      'library-refs-section', 'library-refs', 'library-attest', 'library-attest-checkbox', 'library-new-set'];
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
      share: jest.fn(async () => 'TokenTokenToken1'),
      unshare: jest.fn(async () => {}),
      createSet: jest.fn(async set => ({ id: 'ssssssssssss', shareToken: null, ...set })),
      updateSet: jest.fn(async (id, set) => ({ id, shareToken: null, ...set })),
      deleteSet: jest.fn(async () => {}),
      removeReference: jest.fn(async () => {}),
      ...apiOverrides
    };
    const callbacks = { onPlay: jest.fn(), onPlaySet: jest.fn(), onOpenShared: jest.fn() };
    const libraryDialog = new LibraryDialog({ dialog, openButton: fakeElement(), api, origin: 'https://player.test', ...callbacks });
    return { libraryDialog, elements, dialog, api, ...callbacks };
  }

  test('opening lists the pieces, with names escaped', async () => {
    const { libraryDialog, elements, dialog } = setup();
    await libraryDialog.open();

    expect(dialog.showModal).toHaveBeenCalled();
    expect(elements['library-summary'].textContent).toBe('2 of 100 pieces');
    expect(elements['library-list'].innerHTML).toContain('Gloria');
    expect(elements['library-list'].innerHTML).toContain('&lt;Anthem&gt;');
    expect(elements['library-list'].innerHTML).not.toContain('<Anthem>');
    expect(elements['library-sets'].innerHTML).toContain('No sets yet');
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

  test('Delete asks first, then removes the piece', async () => {
    const { libraryDialog, elements, api } = setup();
    await libraryDialog.open();

    await libraryDialog.handleAction('delete', 'aaaaaaaaaaaa');
    expect(api.remove).not.toHaveBeenCalled();
    expect(elements['library-list'].innerHTML).toContain('Delete this piece?');

    await libraryDialog.handleAction('delete-confirm', 'aaaaaaaaaaaa');
    expect(api.remove).toHaveBeenCalledWith('aaaaaaaaaaaa');
    expect(elements['library-list'].innerHTML).not.toContain('Gloria');
    expect(elements['library-status'].textContent).toBe('Deleted "Gloria".');
  });

  test('the first share asks for confirmation, then shares and shows the link', async () => {
    const { libraryDialog, elements, api } = setup();
    await libraryDialog.open();

    await libraryDialog.handleAction('share-piece', 'aaaaaaaaaaaa');
    expect(api.share).not.toHaveBeenCalled();
    expect(elements['library-attest'].hidden).toBe(false);

    // Not ticked: refused
    await libraryDialog.handleAction('attest-confirm', '');
    expect(api.attest).not.toHaveBeenCalled();

    elements['library-attest-checkbox'].checked = true;
    await libraryDialog.handleAction('attest-confirm', '');
    expect(api.attest).toHaveBeenCalled();
    expect(api.share).toHaveBeenCalledWith('piece', 'aaaaaaaaaaaa');
    expect(elements['library-attest'].hidden).toBe(true);
    expect(elements['library-list'].innerHTML).toContain('https://player.test/p/TokenTokenToken1');
    expect(elements['library-list'].innerHTML).toContain('Stop sharing');

    // Later shares don't ask again
    await libraryDialog.handleAction('share-piece', 'bbbbbbbbbbbb');
    expect(api.attest).toHaveBeenCalledTimes(1);
    expect(api.share).toHaveBeenCalledWith('piece', 'bbbbbbbbbbbb');
  });

  test('a set can be built, reordered, saved and played', async () => {
    const { libraryDialog, elements, api, onPlaySet } = setup({}, { attested: true });
    await libraryDialog.open();

    await libraryDialog.handleAction('new-set', '');
    expect(elements['library-sets'].innerHTML).toContain('Set name');
    await libraryDialog.handleAction('set-add-piece', 'aaaaaaaaaaaa');
    await libraryDialog.handleAction('set-add-piece', 'bbbbbbbbbbbb');
    await libraryDialog.handleAction('set-up', 'bbbbbbbbbbbb');
    libraryDialog.setDraft.title = 'Spring concert';
    await libraryDialog.handleAction('set-save', '');

    expect(api.createSet).toHaveBeenCalledWith({ title: 'Spring concert', pieceIds: ['bbbbbbbbbbbb', 'aaaaaaaaaaaa'] });
    expect(elements['library-sets'].innerHTML).toContain('Spring concert');
    expect(elements['library-sets'].innerHTML).toContain('2 pieces');

    await libraryDialog.handleAction('play-set', 'ssssssssssss');
    expect(onPlaySet).toHaveBeenCalledWith({
      title: 'Spring concert',
      kind: 'library',
      pieces: [
        { id: 'bbbbbbbbbbbb', title: '<Anthem>', composer: '' },
        { id: 'aaaaaaaaaaaa', title: 'Gloria', composer: 'Vivaldi' }
      ]
    });
  });

  test('items shared with the user can be played or removed; unavailable ones only removed', async () => {
    const references = [
      { kind: 'set', token: 'SetTokenSetToken', available: true, title: 'Motets', pieceCount: 3 },
      { kind: 'piece', token: 'GoneTokenGoneTok', available: false }
    ];
    const { libraryDialog, elements, api, onOpenShared } = setup({}, { references });
    await libraryDialog.open();

    expect(elements['library-refs-section'].hidden).toBe(false);
    expect(elements['library-refs'].innerHTML).toContain('Set: Motets');
    expect(elements['library-refs'].innerHTML).toContain('No longer available');

    await libraryDialog.handleAction('open-shared', 'set:SetTokenSetToken');
    expect(onOpenShared).toHaveBeenCalledWith('set', 'SetTokenSetToken');

    await libraryDialog.handleAction('remove-ref', 'piece:GoneTokenGoneTok');
    expect(api.removeReference).toHaveBeenCalledWith('piece', 'GoneTokenGoneTok');
    expect(elements['library-refs'].innerHTML).not.toContain('No longer available');
  });

  test('a server error is shown', async () => {
    const { libraryDialog, elements } = setup({ list: jest.fn(async () => { throw new Error('Couldn\'t reach the server.'); }) });
    await libraryDialog.open();

    expect(elements['library-status'].hidden).toBe(false);
    expect(elements['library-status'].textContent).toMatch(/Couldn't reach/);
  });
});
