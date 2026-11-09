/**
 * Unit tests for the "My sets" dialog (public/ui/SetsDialog.js)
 */

const { SetsDialog, itemLabel, itemForApi, SETS_DESCRIPTION } = require('../../../public/ui/SetsDialog.js');

describe('helpers', () => {
  test('itemLabel describes each kind of item', () => {
    expect(itemLabel({ kind: 'upload', title: 'Gloria', composer: 'Vivaldi' })).toBe('Vivaldi – Gloria');
    expect(itemLabel({ kind: 'work', composer: 'Faure', work: 'Requiem' })).toBe('Faure – Requiem (whole work)');
    expect(itemLabel({ kind: 'movement', composer: 'Handel', work: 'Messiah', movement: '3: And the glory' }))
      .toBe('Handel – Messiah: 3: And the glory');
    expect(itemLabel({ kind: 'movement', composer: 'Tallis', work: 'If ye love me', movement: 'If ye love me' }))
      .toBe('Tallis – If ye love me');
  });

  test('itemForApi sends only what the server needs', () => {
    expect(itemForApi({ kind: 'upload', pieceId: 'aaaaaaaaaaaa', title: 'x', composer: 'y' })).toEqual({ kind: 'upload', pieceId: 'aaaaaaaaaaaa' });
    expect(itemForApi({ kind: 'movement', composer: 'Handel', work: 'Messiah', movement: 'm', midiUrl: '/x.mid' }))
      .toEqual({ kind: 'movement', composer: 'Handel', work: 'Messiah', movement: 'm' });
  });

  test('the description uses the agreed wording', () => {
    expect(SETS_DESCRIPTION).toBe('A set is a series of MIDI files in order, for example representing a complete work or programme, so you can play or share them together.');
  });
});

describe('SetsDialog', () => {
  function fakeElement() {
    const listeners = {};
    return {
      hidden: false, innerHTML: '', textContent: '', className: '', checked: false,
      addEventListener: (type, fn) => { listeners[type] = fn; },
      querySelector: () => null
    };
  }

  const pieces = [{ id: 'aaaaaaaaaaaa', title: 'Gloria', composer: 'Vivaldi', createdAt: '2026-11-09T10:00:00Z' }];

  function setup(apiOverrides = {}, data = {}) {
    const ids = ['sets-list', 'sets-new', 'sets-refs-section', 'sets-refs', 'sets-status', 'sets-attest',
      'sets-attest-checkbox', 'sets-dialog-close'];
    const elements = Object.fromEntries(ids.map(id => [id, fakeElement()]));
    const dialog = fakeElement();
    dialog.querySelector = selector => elements[selector.slice(1)];
    dialog.showModal = jest.fn();
    dialog.close = jest.fn();
    const api = {
      list: jest.fn(async () => ({ pieces, sets: [], references: [], attested: true, ...data })),
      createSet: jest.fn(async set => ({ id: 'ssssssssssss', shareToken: null, title: set.title,
        items: set.items.map(item => (item.kind === 'upload' ? { ...item, title: 'Gloria', composer: 'Vivaldi' } : item)) })),
      updateSet: jest.fn(),
      deleteSet: jest.fn(async () => {}),
      share: jest.fn(async () => 'spring-concert-k7q2'),
      unshare: jest.fn(async () => {}),
      attest: jest.fn(async () => {}),
      removeReference: jest.fn(async () => {}),
      ...apiOverrides
    };
    const search = jest.fn(async () => ({
      works: [{ composer: 'Faure', work: 'Requiem' }],
      movements: [{ composer: 'Handel', work: 'Messiah', movement: '3: And the glory', midiUrl: '/Handel/Messiah/03.mid' }]
    }));
    const onPlaySet = jest.fn();
    const onOpenShared = jest.fn();
    const setsDialog = new SetsDialog({ dialog, openButton: fakeElement(), api, search, onPlaySet, onOpenShared, origin: 'https://player.test' });
    return { setsDialog, elements, dialog, api, search, onPlaySet, onOpenShared };
  }

  test('an empty list explains how to start', async () => {
    const { setsDialog, elements } = setup();
    await setsDialog.open();
    expect(elements['sets-list'].innerHTML).toContain('You haven\'t made any sets yet');
  });

  test('a set can mix a whole work, a movement and an uploaded file, then be played', async () => {
    const { setsDialog, elements, api, search, onPlaySet } = setup();
    await setsDialog.open();
    await setsDialog.handleAction('new', '');
    expect(elements['sets-new'].hidden).toBe(true);

    // Searching (the search text is read from the form, so set the results directly)
    setsDialog.searchResults = await search('requiem');
    setsDialog.render();
    expect(elements['sets-list'].innerHTML).toContain('Add whole work');

    await setsDialog.handleAction('add-work', '0');
    await setsDialog.handleAction('add-movement', '0');
    await setsDialog.handleAction('add-upload', 'aaaaaaaaaaaa');
    await setsDialog.handleAction('up', '2');
    setsDialog.draft.title = 'Spring concert';
    await setsDialog.handleAction('save', '');

    expect(api.createSet).toHaveBeenCalledWith({
      title: 'Spring concert',
      items: [
        { kind: 'work', composer: 'Faure', work: 'Requiem' },
        { kind: 'upload', pieceId: 'aaaaaaaaaaaa' },
        { kind: 'movement', composer: 'Handel', work: 'Messiah', movement: '3: And the glory' }
      ]
    });
    expect(elements['sets-list'].innerHTML).toContain('Spring concert');
    expect(elements['sets-list'].innerHTML).toContain('3 items');

    await setsDialog.handleAction('play', 'ssssssssssss');
    expect(onPlaySet).toHaveBeenCalledWith(expect.objectContaining({ id: 'ssssssssssss', title: 'Spring concert', kind: 'library' }));
    expect(onPlaySet.mock.calls[0][0].items).toHaveLength(3);
  });

  test('sharing a set asks once for confirmation', async () => {
    const set = { id: 'ssssssssssss', title: 'Spring concert', items: [{ kind: 'work', composer: 'Faure', work: 'Requiem' }], shareToken: null };
    const { setsDialog, elements, api } = setup({}, { sets: [set], attested: false });
    await setsDialog.open();

    await setsDialog.handleAction('share', 'ssssssssssss');
    expect(elements['sets-attest'].hidden).toBe(false);
    elements['sets-attest-checkbox'].checked = true;
    await setsDialog.handleAction('attest-confirm', '');

    expect(api.share).toHaveBeenCalledWith('set', 'ssssssssssss');
    expect(elements['sets-list'].innerHTML).toContain('https://player.test/s/spring-concert-k7q2');
  });

  test('sets shared with the user are listed and can be opened', async () => {
    const references = [{ kind: 'set', token: 'motets-abcd', available: true, title: 'Motets', itemCount: 4 }];
    const { setsDialog, elements, onOpenShared } = setup({}, { references });
    await setsDialog.open();

    expect(elements['sets-refs-section'].hidden).toBe(false);
    expect(elements['sets-refs'].innerHTML).toContain('Motets');
    expect(elements['sets-refs'].innerHTML).toContain('4 items');
    await setsDialog.handleAction('open-shared', 'set:motets-abcd');
    expect(onOpenShared).toHaveBeenCalledWith('set', 'motets-abcd');
  });
});
