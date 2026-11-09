/**
 * SetsDialog
 * "My sets" on the Find Music tab. A set is a series of MIDI files in order,
 * for example a complete work or a concert programme. For now a set is made
 * of the user's uploaded files (November 2026: adding works and movements
 * from the catalogue was taken out until it is designed properly; sets that
 * already contain catalogue items still play). Sets can be played (the items
 * become the movement list) and shared by link. Sets others shared with the
 * user are listed too.
 */

import { escapeHtml, escapeHtmlAttribute } from '../utils/validation.js';
import { LibraryApi, shareUrl } from '../api/LibraryApi.js';
import { button, shareLinkRow, copyLink, referenceRow } from './shareConfirm.js';
import { pieceName, itemCount } from './LibraryDialog.js';

export const SETS_DESCRIPTION = 'A set is a series of MIDI files in order, for example representing a complete work or programme, so you can play or share them together.';

/**
 * How a set item is shown
 * @param {Object} item - { kind: 'upload', title, composer } | { kind: 'work', composer, work } |
 *     { kind: 'movement', composer, work, movement }
 * @returns {string} Text
 */
export function itemLabel(item) {
    if (item.kind === 'upload') return pieceName(item);
    if (item.kind === 'work') return `${item.composer} – ${item.work} (whole work)`;
    return item.movement === item.work
        ? `${item.composer} – ${item.work}`
        : `${item.composer} – ${item.work}: ${item.movement}`;
}

/**
 * The fields of an item sent to the server
 * @param {Object} item - Draft item
 * @returns {Object} Item for the API
 */
export function itemForApi(item) {
    if (item.kind === 'upload') return { kind: 'upload', pieceId: item.pieceId };
    if (item.kind === 'work') return { kind: 'work', composer: item.composer, work: item.work };
    return { kind: 'movement', composer: item.composer, work: item.work, movement: item.movement };
}

export class SetsDialog {
    /**
     * @param {Object} options
     * @param {HTMLDialogElement} options.dialog - The dialog element
     * @param {HTMLElement} options.openButton - Control that opens the dialog
     * @param {Function} options.onPlaySet - Called with { id, title, kind: 'library', items }
     * @param {Function} [options.onOpenShared] - Called with (kind, token) for a set shared with the user
     * @param {Object} [options.api] - Library API (for tests)
     * @param {string} [options.origin] - Site address for share links (for tests)
     */
    constructor({ dialog, openButton, onPlaySet, onOpenShared, api, origin }) {
        this.dialog = dialog;
        this.openButton = openButton;
        this.onPlaySet = onPlaySet;
        this.onOpenShared = onOpenShared || (() => {});
        this.api = api || LibraryApi;
        this.origin = origin;
        this.pieces = [];
        this.sets = [];
        this.references = [];
        this.attested = false;
        this.mode = null;
        // A set being created or edited: { id (null if new), title, items }
        this.draft = null;
        this.pendingShare = null;

        if (!dialog || !openButton) return;
        const find = id => dialog.querySelector(`#${id}`);
        this.setsList = find('sets-list');
        this.newSetButton = find('sets-new');
        this.refsSection = find('sets-refs-section');
        this.refsList = find('sets-refs');
        this.status = find('sets-status');
        this.attestPanel = find('sets-attest');
        this.attestCheckbox = find('sets-attest-checkbox');

        openButton.addEventListener('click', () => this.open());
        find('sets-dialog-close').addEventListener('click', () => this.dialog.close());
        dialog.addEventListener('click', event => {
            if (event.target === this.dialog) {
                this.dialog.close();
                return;
            }
            const target = event.target.closest && event.target.closest('button[data-action]');
            if (target) this.handleAction(target.dataset.action, target.dataset.id);
        });
        dialog.addEventListener('change', event => {
            if (event.target.dataset && event.target.dataset.action === 'add-upload' && event.target.value) {
                this.handleAction('add-upload', event.target.value);
            }
        });
        dialog.addEventListener('submit', event => {
            event.preventDefault();
            this.handleAction(event.target.dataset.action, event.target.dataset.id || '');
        });
    }

    async open() {
        this.mode = null;
        this.draft = null;
        this.pendingShare = null;
        this.setStatus('', '');
        this.setsList.innerHTML = '<li class="library-empty">Loading…</li>';
        this.refsList.innerHTML = '';
        this.attestPanel.hidden = true;
        this.dialog.showModal();
        await this.refresh();
    }

    async refresh() {
        try {
            const data = await this.api.list();
            this.pieces = data.pieces;
            this.sets = data.sets || [];
            this.references = (data.references || []).filter(ref => ref.kind === 'set');
            this.attested = Boolean(data.attested);
            this.render();
        } catch (error) {
            this.setsList.innerHTML = '';
            this.setStatus(error.message, 'error');
        }
    }

    setStatus(text, type) {
        this.status.textContent = text;
        this.status.className = `import-save-status${type ? ` import-save-status-${type}` : ''}`;
        this.status.hidden = !text;
    }

    isMode(type, id) {
        return Boolean(this.mode && this.mode.type === type && this.mode.id === id);
    }

    render() {
        this.newSetButton.hidden = Boolean(this.draft);
        const draftRow = this.draft && !this.draft.id ? this.renderForm() : '';
        const rows = this.sets.map(set => (this.draft && this.draft.id === set.id ? this.renderForm() : this.renderSet(set))).join('');
        this.setsList.innerHTML = draftRow + (rows || (draftRow ? '' :
            '<li class="library-empty">You haven\'t made any sets yet. Choose New set to start one.</li>'));
        this.refsSection.hidden = this.references.length === 0;
        this.refsList.innerHTML = this.references.map(ref => referenceRow(ref, r => itemCount(r.itemCount))).join('');
    }

    renderSet(set) {
        const id = set.id;
        const buttons = this.isMode('delete', id)
            ? `<span class="library-confirm">Delete this set?</span>
               ${button('delete-confirm', id, 'Delete', 'Delete the set. Your uploaded files stay in My uploaded files. Anyone you shared the set with can no longer open it.', 'btn-danger')}
               ${button('cancel', id, 'Cancel', 'Keep this set')}`
            : `${button('play', id, 'Play', 'Play the items in order on the Play Music tab', 'btn-primary')}
               ${set.shareToken ? '' : button('share', id, 'Share', 'Get one link so others (for example your choir) can play every item in this set')}
               ${button('edit', id, 'Edit', 'Rename the set or change its items and their order')}
               ${button('delete', id, 'Delete', 'Delete this set')}`;
        return `<li class="library-item">
            <div class="library-piece">
                <span class="library-title">${escapeHtml(set.title)}${set.shareToken ? ' <span class="library-badge">Shared</span>' : ''}</span>
                <span class="library-details">${itemCount(set.items.length)}</span>
            </div>
            <div class="library-buttons">${buttons}</div>
            ${shareLinkRow('set', set, this.origin)}
        </li>`;
    }

    renderForm() {
        const draft = this.draft;
        const items = draft.items.map((item, index) => `<li class="library-set-piece">
                <span>${index + 1}. ${escapeHtml(itemLabel(item))}</span>
                <span class="library-buttons">
                    ${index > 0 ? button('up', String(index), '↑', 'Move earlier in the set') : ''}
                    ${index < draft.items.length - 1 ? button('down', String(index), '↓', 'Move later in the set') : ''}
                    ${button('remove-item', String(index), '✕', 'Take out of the set')}
                </span>
            </li>`).join('');
        // Every uploaded file is offered (a piece can appear twice, e.g. a reprise);
        // those already in the set are marked
        const inSet = id => draft.items.some(item => item.kind === 'upload' && item.pieceId === id);
        const uploads = this.pieces
            .map(p => `<option value="${escapeHtmlAttribute(p.id)}">${escapeHtml(pieceName(p))}${inSet(p.id) ? ' (already in this set)' : ''}</option>`)
            .join('');
        const addUploads = uploads
            ? `<select data-action="add-upload" aria-label="Add one of your uploaded files" title="Add one of your uploaded files to the end of the set">
                   <option value="">Choose a file…</option>${uploads}</select>`
            : '<p class="library-empty">You haven\'t uploaded any files yet. Use "Or load your own MIDI or MusicXML file…" on the Find Music tab, then Play now: the file is kept in My uploaded files and can be added here.</p>';
        return `<li class="library-item">
            <form class="library-rename library-set-form" data-action="save" data-id="${escapeHtmlAttribute(draft.id || '')}">
                <label>Set name <input name="title" required maxlength="200" value="${escapeHtmlAttribute(draft.title)}"
                    placeholder="e.g. Spring concert 2027" title="The name shown in your sets, the player and the shared link"></label>
                <ol class="library-set-pieces">${items || '<li class="library-empty">Nothing in this set yet: add files below.</li>'}</ol>
                <div class="library-add">
                    <span class="library-add-label">Add one of your uploaded files</span>
                    ${addUploads}
                </div>
                <div class="library-buttons">
                    <button type="submit" class="btn btn-primary" title="Save this set">Save set</button>
                    ${button('cancel-edit', '', 'Cancel', 'Discard these changes')}
                </div>
            </form>
        </li>`;
    }

    // Keep what the user has typed when the form is redrawn
    readForm() {
        const form = this.setsList.querySelector && this.setsList.querySelector('.library-set-form');
        if (!form || !this.draft) return null;
        this.draft.title = form.elements.title.value;
        return form;
    }

    changeItems(change) {
        if (!this.draft) return;
        this.readForm();
        this.draft.items = change([...this.draft.items]);
        this.render();
    }

    /**
     * Respond to a button or form in the dialog
     * @param {string} action - data-action of the control
     * @param {string} id - Set, item position, uploaded file or "kind:token"
     */
    async handleAction(action, id) {
        this.setStatus('', '');
        const set = this.sets.find(s => s.id === id);
        const index = Number(id);
        switch (action) {
            case 'new':
                this.draft = { id: null, title: '', items: [] };
                return this.render();
            case 'edit':
                if (set) this.draft = { id: set.id, title: set.title, items: set.items.map(item => ({ ...item })) };
                return this.render();
            case 'cancel-edit':
                this.draft = null;
                return this.render();
            case 'add-upload': {
                const piece = this.pieces.find(p => p.id === id);
                return piece && this.changeItems(items => [...items, { kind: 'upload', pieceId: piece.id, title: piece.title, composer: piece.composer }]);
            }
            case 'up': return this.changeItems(items => this.swap(items, index, index - 1));
            case 'down': return this.changeItems(items => this.swap(items, index, index + 1));
            case 'remove-item': return this.changeItems(items => items.filter((_, i) => i !== index));
            case 'save': return this.save();
            case 'play': return set && this.play(set);
            case 'share': return set && this.share(set);
            case 'copy': return set && copyLink(shareUrl('set', set.shareToken, this.origin), (t, k) => this.setStatus(t, k));
            case 'unshare': return set && this.unshare(set);
            case 'delete': this.mode = { type: 'delete', id }; return this.render();
            case 'delete-confirm': return set && this.remove(set);
            case 'cancel': this.mode = null; return this.render();
            case 'attest-confirm': return this.confirmAttestation();
            case 'attest-cancel':
                this.pendingShare = null;
                this.attestPanel.hidden = true;
                return undefined;
            case 'open-shared': {
                const [kind, token] = id.split(':');
                this.dialog.close();
                return this.onOpenShared(kind, token);
            }
            case 'remove-ref': return this.removeReference(id);
            default: return undefined;
        }
    }

    swap(items, from, to) {
        if (to < 0 || to >= items.length) return items;
        [items[from], items[to]] = [items[to], items[from]];
        return items;
    }

    async save() {
        this.readForm();
        const draft = this.draft;
        if (!draft) return;
        const body = { title: draft.title, items: draft.items.map(itemForApi) };
        try {
            const saved = draft.id ? await this.api.updateSet(draft.id, body) : await this.api.createSet(body);
            this.sets = draft.id ? this.sets.map(s => (s.id === saved.id ? saved : s)) : [saved, ...this.sets];
            this.draft = null;
            this.render();
            this.setStatus(`Saved the set "${saved.title}".`, 'success');
        } catch (error) {
            this.setStatus(error.message, 'error');
        }
    }

    play(set) {
        if (!set.items.length) {
            this.setStatus('This set is empty. Choose Edit to add items.', 'error');
            return;
        }
        this.dialog.close();
        this.onPlaySet({ id: set.id, title: set.title, kind: 'library', items: set.items });
    }

    async share(set) {
        if (!this.attested) {
            this.pendingShare = set.id;
            this.attestCheckbox.checked = false;
            this.attestPanel.hidden = false;
            return;
        }
        try {
            set.shareToken = await this.api.share('set', set.id);
            this.pendingShare = null;
            this.render();
            this.setStatus('Sharing on. Copy the link and send it to anyone who should be able to play this set.', 'success');
        } catch (error) {
            this.setStatus(error.message, 'error');
        }
    }

    async confirmAttestation() {
        if (!this.attestCheckbox.checked) {
            this.setStatus('Please tick the box to confirm.', 'error');
            return;
        }
        try {
            await this.api.attest();
            this.attested = true;
            this.attestPanel.hidden = true;
            const set = this.sets.find(s => s.id === this.pendingShare);
            if (set) await this.share(set);
        } catch (error) {
            this.setStatus(error.message, 'error');
        }
    }

    async unshare(set) {
        try {
            await this.api.unshare('set', set.id);
            set.shareToken = null;
            this.render();
            this.setStatus('Sharing turned off. The old link no longer works.', 'success');
        } catch (error) {
            this.setStatus(error.message, 'error');
        }
    }

    async remove(set) {
        try {
            await this.api.deleteSet(set.id);
            this.sets = this.sets.filter(s => s.id !== set.id);
            this.mode = null;
            this.render();
            this.setStatus(`Deleted the set "${set.title}".`, 'success');
        } catch (error) {
            this.setStatus(error.message, 'error');
        }
    }

    async removeReference(id) {
        const [kind, token] = id.split(':');
        try {
            await this.api.removeReference(kind, token);
            this.references = this.references.filter(r => !(r.kind === kind && r.token === token));
            this.render();
            this.setStatus('Removed from your list.', 'success');
        } catch (error) {
            this.setStatus(error.message, 'error');
        }
    }
}
