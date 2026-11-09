/**
 * LibraryDialog
 * "My library" on the Find Music tab:
 *  - Your pieces: saved from your own files - Play, Share, Rename, Delete
 *  - Sets: ordered groups of your pieces (e.g. a concert programme) - Play,
 *    Edit, Share, Delete
 *  - Shared with you: pieces and sets other people shared that you added
 * Sharing asks once for confirmation that the user has the right to share.
 */

import { escapeHtml, escapeHtmlAttribute } from '../utils/validation.js';
import { LibraryApi, shareUrl } from '../api/LibraryApi.js';

/**
 * Second line of a piece in the list, e.g. "Vivaldi · saved 9 Nov 2026"
 * @param {{composer: string, createdAt: string}} piece - Saved piece
 * @returns {string} Text
 */
export function pieceDetails(piece) {
    const saved = new Date(piece.createdAt);
    const date = isNaN(saved) ? '' : `saved ${saved.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
    return [piece.composer, date].filter(Boolean).join(' · ');
}

/**
 * Line above the list, e.g. "3 of 100 pieces"
 * @param {number} count - Pieces saved
 * @param {number} limit - Most allowed
 * @returns {string} Text
 */
export function librarySummary(count, limit) {
    if (count === 0) {
        return 'You haven\'t saved any pieces yet. To add one, choose "Or load your own MIDI or MusicXML file…", then Save to my library.';
    }
    return `${count} of ${limit} piece${limit === 1 ? '' : 's'}`;
}

/**
 * "3 pieces", "1 piece"
 * @param {number} count
 * @returns {string}
 */
export function pieceCount(count) {
    return `${count} piece${count === 1 ? '' : 's'}`;
}

const button = (action, id, label, title, style = '') =>
    `<button type="button" class="btn${style ? ` ${style}` : ''}" data-action="${action}" data-id="${escapeHtmlAttribute(id)}" title="${escapeHtmlAttribute(title)}">${label}</button>`;

export class LibraryDialog {
    /**
     * @param {Object} options
     * @param {HTMLDialogElement} options.dialog - The dialog element
     * @param {HTMLElement} options.openButton - Control that opens the dialog
     * @param {Function} options.onPlay - Called with (midiBytes, title, { pieceId, composer }) for a piece
     * @param {Function} [options.onPlaySet] - Called with { title, kind, pieces } for a set
     * @param {Function} [options.onOpenShared] - Called with (kind, token) for something shared with the user
     * @param {Object} [options.api] - Library API (for tests)
     * @param {string} [options.origin] - Site address for share links (for tests)
     */
    constructor({ dialog, openButton, onPlay, onPlaySet, onOpenShared, api, origin }) {
        this.dialog = dialog;
        this.openButton = openButton;
        this.onPlay = onPlay;
        this.onPlaySet = onPlaySet || (() => {});
        this.onOpenShared = onOpenShared || (() => {});
        this.api = api || LibraryApi;
        this.origin = origin;
        this.pieces = [];
        this.sets = [];
        this.references = [];
        this.attested = false;
        this.limit = 0;
        // What is being edited or confirmed: e.g. { type: 'rename', id } or
        // { type: 'delete-set', id }; null when nothing is
        this.mode = null;
        // A set being created or edited: { id (null if new), title, pieceIds }
        this.setDraft = null;
        // The share waiting for the user to confirm they have the right to share
        this.pendingShare = null;

        if (!dialog || !openButton) return;
        const find = id => dialog.querySelector(`#${id}`);
        this.summary = find('library-summary');
        this.list = find('library-list');
        this.setsList = find('library-sets');
        this.refsSection = find('library-refs-section');
        this.refsList = find('library-refs');
        this.status = find('library-status');
        this.attestPanel = find('library-attest');
        this.attestCheckbox = find('library-attest-checkbox');
        this.newSetButton = find('library-new-set');

        openButton.addEventListener('click', () => this.open());
        find('library-dialog-close').addEventListener('click', () => this.dialog.close());
        dialog.addEventListener('click', event => {
            if (event.target === this.dialog) this.dialog.close();
        });
        // One handler for every button inside the dialog
        dialog.addEventListener('click', event => {
            const target = event.target.closest && event.target.closest('button[data-action]');
            if (target) this.handleAction(target.dataset.action, target.dataset.id);
        });
        dialog.addEventListener('change', event => {
            if (event.target.dataset && event.target.dataset.action === 'set-add-piece' && event.target.value) {
                this.handleAction('set-add-piece', event.target.value);
            }
        });
        dialog.addEventListener('submit', event => {
            event.preventDefault();
            const form = event.target;
            this.handleAction(form.dataset.action, form.dataset.id || '');
        });
    }

    async open() {
        this.mode = null;
        this.setDraft = null;
        this.pendingShare = null;
        this.setStatus('', '');
        this.summary.textContent = 'Loading your library…';
        this.list.innerHTML = '';
        this.setsList.innerHTML = '';
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
            this.references = data.references || [];
            this.attested = Boolean(data.attested);
            this.limit = data.limit;
            this.render();
        } catch (error) {
            this.summary.textContent = '';
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
        this.summary.textContent = librarySummary(this.pieces.length, this.limit);
        this.list.innerHTML = this.pieces.map(piece => this.renderPiece(piece)).join('');
        this.newSetButton.hidden = Boolean(this.setDraft && !this.setDraft.id) || this.pieces.length === 0;
        const draftRow = this.setDraft && !this.setDraft.id ? this.renderSetForm() : '';
        const setRows = this.sets.map(set => this.renderSet(set)).join('');
        this.setsList.innerHTML = draftRow + (setRows ||
            (draftRow ? '' : '<li class="library-empty">No sets yet. A set groups pieces in order, for example a concert programme, so you can play or share them together.</li>'));
        this.refsSection.hidden = this.references.length === 0;
        this.refsList.innerHTML = this.references.map(ref => this.renderReference(ref)).join('');
    }

    renderShareLink(kind, item) {
        if (!item.shareToken) return '';
        const url = shareUrl(kind, item.shareToken, this.origin);
        return `<div class="library-share">
            <input type="text" readonly value="${escapeHtmlAttribute(url)}" aria-label="Share link"
                title="Anyone with this link can play the ${kind} and add it to their own library">
            ${button(`copy-${kind}`, item.id, 'Copy link', 'Copy the link so you can paste it into an email or message')}
            ${button(`unshare-${kind}`, item.id, 'Stop sharing', 'Turn the link off: people who have it can no longer play this. Sharing again gives a new link.')}
        </div>`;
    }

    renderPiece(piece) {
        const id = piece.id;
        if (this.isMode('rename', id)) {
            return `<li class="library-item">
                <form class="library-rename" data-action="rename-save" data-id="${escapeHtmlAttribute(id)}">
                    <label>Title <input name="title" required maxlength="200" value="${escapeHtmlAttribute(piece.title)}"
                        title="The name shown in your library and the player"></label>
                    <label>Composer <input name="composer" maxlength="200" value="${escapeHtmlAttribute(piece.composer)}"
                        title="Optional"></label>
                    <div class="library-buttons">
                        <button type="submit" class="btn btn-primary" title="Save the new title and composer">Save</button>
                        ${button('cancel', id, 'Cancel', 'Keep the current title and composer')}
                    </div>
                </form>
            </li>`;
        }
        const buttons = this.isMode('delete', id)
            ? `<span class="library-confirm">Delete this piece?</span>
               ${button('delete-confirm', id, 'Delete', 'Delete this piece from your library and any sets. Anyone you shared it with can no longer play it. This can\'t be undone.', 'btn-danger')}
               ${button('cancel', id, 'Cancel', 'Keep this piece')}`
            : `${button('play', id, 'Play', 'Open this piece in the player on the Play Music tab', 'btn-primary')}
               ${piece.shareToken ? '' : button('share-piece', id, 'Share', 'Get a link so others (for example your choir) can play this piece')}
               ${button('rename', id, 'Rename', 'Change the title or composer')}
               ${button('delete', id, 'Delete', 'Remove this piece from your library')}`;
        return `<li class="library-item">
            <div class="library-piece">
                <span class="library-title">${escapeHtml(piece.title)}${piece.shareToken ? ' <span class="library-badge">Shared</span>' : ''}</span>
                <span class="library-details">${escapeHtml(pieceDetails(piece))}</span>
            </div>
            <div class="library-buttons">${buttons}</div>
            ${this.renderShareLink('piece', piece)}
        </li>`;
    }

    renderSet(set) {
        const id = set.id;
        if (this.setDraft && this.setDraft.id === id) {
            return this.renderSetForm();
        }
        const buttons = this.isMode('delete-set', id)
            ? `<span class="library-confirm">Delete this set?</span>
               ${button('delete-set-confirm', id, 'Delete', 'Delete the set. Its pieces stay in your library. Anyone you shared the set with can no longer open it.', 'btn-danger')}
               ${button('cancel', id, 'Cancel', 'Keep this set')}`
            : `${button('play-set', id, 'Play', 'Play the pieces in order on the Play Music tab', 'btn-primary')}
               ${set.shareToken ? '' : button('share-set', id, 'Share', 'Get one link so others (for example your choir) can play every piece in this set')}
               ${button('edit-set', id, 'Edit', 'Rename the set or change its pieces and their order')}
               ${button('delete-set', id, 'Delete', 'Delete this set (its pieces stay in your library)')}`;
        return `<li class="library-item">
            <div class="library-piece">
                <span class="library-title">${escapeHtml(set.title)}${set.shareToken ? ' <span class="library-badge">Shared</span>' : ''}</span>
                <span class="library-details">${pieceCount(set.pieceIds.length)}</span>
            </div>
            <div class="library-buttons">${buttons}</div>
            ${this.renderShareLink('set', set)}
        </li>`;
    }

    renderSetForm() {
        const draft = this.setDraft;
        const byId = new Map(this.pieces.map(p => [p.id, p]));
        const chosen = draft.pieceIds.map((pieceId, index) => {
            const piece = byId.get(pieceId);
            if (!piece) return '';
            return `<li class="library-set-piece">
                <span>${index + 1}. ${escapeHtml(piece.title)}</span>
                <span class="library-buttons">
                    ${index > 0 ? button('set-up', pieceId, '↑', 'Move earlier in the set') : ''}
                    ${index < draft.pieceIds.length - 1 ? button('set-down', pieceId, '↓', 'Move later in the set') : ''}
                    ${button('set-remove', pieceId, '✕', 'Take out of the set (the piece stays in your library)')}
                </span>
            </li>`;
        }).join('');
        const available = this.pieces.filter(p => !draft.pieceIds.includes(p.id));
        const options = available.map(p => `<option value="${escapeHtmlAttribute(p.id)}">${escapeHtml(p.title)}</option>`).join('');
        return `<li class="library-item">
            <form class="library-rename library-set-form" data-action="set-save" data-id="${escapeHtmlAttribute(draft.id || '')}">
                <label>Set name <input name="title" required maxlength="200" value="${escapeHtmlAttribute(draft.title)}"
                    placeholder="e.g. Spring concert 2027" title="The name shown in your library, the player and the shared link"></label>
                <ol class="library-set-pieces">${chosen || '<li class="library-empty">No pieces yet: add some below.</li>'}</ol>
                ${available.length ? `<select data-action="set-add-piece" aria-label="Add a piece to the set" title="Add one of your pieces to the end of the set">
                    <option value="">Add a piece…</option>${options}</select>` : ''}
                <div class="library-buttons">
                    <button type="submit" class="btn btn-primary" title="Save this set">Save set</button>
                    ${button('set-cancel', draft.id || '', 'Cancel', 'Discard these changes')}
                </div>
            </form>
        </li>`;
    }

    renderReference(ref) {
        const id = `${ref.kind}:${ref.token}`;
        const name = ref.kind === 'set' ? `Set: ${ref.title}` : ref.title;
        const details = !ref.available ? 'No longer available'
            : ref.kind === 'set' ? pieceCount(ref.pieceCount) : (ref.composer || '');
        const buttons = (ref.available
            ? button('open-shared', id, 'Play', ref.kind === 'set' ? 'Play the pieces in this set in order' : 'Open this piece in the player')
            : '') +
            button('remove-ref', id, 'Remove', 'Take this out of your library (it stays available to others)');
        return `<li class="library-item">
            <div class="library-piece">
                <span class="library-title">${escapeHtml(ref.available ? name : (ref.kind === 'set' ? 'A shared set' : 'A shared piece'))}</span>
                <span class="library-details">${escapeHtml(details)}</span>
            </div>
            <div class="library-buttons">${buttons}</div>
        </li>`;
    }

    /**
     * Respond to a button or form in the dialog
     * @param {string} action - data-action of the control
     * @param {string} id - Piece, set or reference it applies to
     */
    async handleAction(action, id) {
        this.setStatus('', '');
        const piece = this.pieces.find(p => p.id === id);
        const set = this.sets.find(s => s.id === id);
        switch (action) {
            case 'play': return piece && this.play(piece);
            case 'rename': this.mode = { type: 'rename', id }; return this.render();
            case 'rename-save': return piece && this.rename(piece);
            case 'delete': this.mode = { type: 'delete', id }; return this.render();
            case 'delete-confirm': return piece && this.remove(piece);
            case 'cancel': this.mode = null; return this.render();
            case 'share-piece': return this.share('piece', id);
            case 'share-set': return this.share('set', id);
            case 'copy-piece': return piece && this.copyLink('piece', piece);
            case 'copy-set': return set && this.copyLink('set', set);
            case 'unshare-piece': return this.unshare('piece', id);
            case 'unshare-set': return this.unshare('set', id);
            case 'attest-confirm': return this.confirmAttestation();
            case 'attest-cancel':
                this.pendingShare = null;
                this.attestPanel.hidden = true;
                return undefined;
            case 'new-set':
                this.setDraft = { id: null, title: '', pieceIds: [] };
                return this.render();
            case 'edit-set':
                if (set) this.setDraft = { id: set.id, title: set.title, pieceIds: [...set.pieceIds] };
                return this.render();
            case 'set-add-piece': return this.updateDraft(ids => [...ids, id]);
            case 'set-remove': return this.updateDraft(ids => ids.filter(p => p !== id));
            case 'set-up': return this.updateDraft(ids => this.move(ids, id, -1));
            case 'set-down': return this.updateDraft(ids => this.move(ids, id, 1));
            case 'set-cancel': this.setDraft = null; return this.render();
            case 'set-save': return this.saveSet();
            case 'play-set': return set && this.playSet(set);
            case 'delete-set': this.mode = { type: 'delete-set', id }; return this.render();
            case 'delete-set-confirm': return set && this.removeSet(set);
            case 'open-shared': {
                const [kind, token] = id.split(':');
                this.dialog.close();
                return this.onOpenShared(kind, token);
            }
            case 'remove-ref': return this.removeReference(id);
            default: return undefined;
        }
    }

    // Keep the set name the user has typed when the form is redrawn
    readDraftTitle() {
        const input = this.setsList.querySelector && this.setsList.querySelector('.library-set-form input[name="title"]');
        if (input && this.setDraft) this.setDraft.title = input.value;
    }

    updateDraft(change) {
        if (!this.setDraft) return;
        this.readDraftTitle();
        this.setDraft.pieceIds = change(this.setDraft.pieceIds);
        this.render();
    }

    move(ids, id, step) {
        const result = [...ids];
        const from = result.indexOf(id);
        const to = from + step;
        if (from < 0 || to < 0 || to >= result.length) return result;
        [result[from], result[to]] = [result[to], result[from]];
        return result;
    }

    async play(piece) {
        this.setStatus('Opening…', 'info');
        try {
            const midi = await this.api.fetchMidi(piece.id);
            this.dialog.close();
            this.onPlay(midi, piece.title, { pieceId: piece.id, composer: piece.composer, kind: 'library' });
        } catch (error) {
            this.setStatus(error.message, 'error');
        }
    }

    playSet(set) {
        const byId = new Map(this.pieces.map(p => [p.id, p]));
        const pieces = set.pieceIds.map(id => byId.get(id)).filter(Boolean)
            .map(p => ({ id: p.id, title: p.title, composer: p.composer }));
        if (!pieces.length) {
            this.setStatus('This set has no pieces yet. Choose Edit to add some.', 'error');
            return;
        }
        this.dialog.close();
        this.onPlaySet({ title: set.title, kind: 'library', pieces });
    }

    async rename(piece) {
        const form = this.list.querySelector(`form[data-id="${CSS.escape(piece.id)}"]`);
        try {
            const updated = await this.api.rename(piece.id, {
                title: form.elements.title.value,
                composer: form.elements.composer.value
            });
            Object.assign(piece, updated);
            this.mode = null;
            this.render();
            this.setStatus('Renamed.', 'success');
        } catch (error) {
            this.setStatus(error.message, 'error');
        }
    }

    async remove(piece) {
        try {
            await this.api.remove(piece.id);
            this.pieces = this.pieces.filter(p => p.id !== piece.id);
            this.sets.forEach(s => { s.pieceIds = s.pieceIds.filter(id => id !== piece.id); });
            this.mode = null;
            this.render();
            this.setStatus(`Deleted "${piece.title}".`, 'success');
        } catch (error) {
            this.setStatus(error.message, 'error');
        }
    }

    /**
     * Share a piece or set, asking first (once) for confirmation that the
     * user has the right to share
     */
    async share(kind, id) {
        if (!this.attested) {
            this.pendingShare = { kind, id };
            this.attestCheckbox.checked = false;
            this.attestPanel.hidden = false;
            return;
        }
        try {
            const token = await this.api.share(kind, id);
            const item = (kind === 'set' ? this.sets : this.pieces).find(x => x.id === id);
            if (item) item.shareToken = token;
            this.render();
            this.setStatus(`Sharing on. Copy the link and send it to anyone who should be able to play this ${kind}.`, 'success');
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
            const pending = this.pendingShare;
            this.pendingShare = null;
            if (pending) await this.share(pending.kind, pending.id);
        } catch (error) {
            this.setStatus(error.message, 'error');
        }
    }

    async unshare(kind, id) {
        try {
            await this.api.unshare(kind, id);
            const item = (kind === 'set' ? this.sets : this.pieces).find(x => x.id === id);
            if (item) item.shareToken = null;
            this.render();
            this.setStatus('Sharing turned off. The old link no longer works.', 'success');
        } catch (error) {
            this.setStatus(error.message, 'error');
        }
    }

    async copyLink(kind, item) {
        const url = shareUrl(kind, item.shareToken, this.origin);
        try {
            await navigator.clipboard.writeText(url);
            this.setStatus('Link copied.', 'success');
        } catch (error) {
            this.setStatus(`Copy this link: ${url}`, 'info');
        }
    }

    async saveSet() {
        this.readDraftTitle();
        const draft = this.setDraft;
        if (!draft) return;
        try {
            const saved = draft.id
                ? await this.api.updateSet(draft.id, { title: draft.title, pieceIds: draft.pieceIds })
                : await this.api.createSet({ title: draft.title, pieceIds: draft.pieceIds });
            this.sets = draft.id ? this.sets.map(s => (s.id === saved.id ? saved : s)) : [saved, ...this.sets];
            this.setDraft = null;
            this.render();
            this.setStatus(`Saved the set "${saved.title}".`, 'success');
        } catch (error) {
            this.setStatus(error.message, 'error');
        }
    }

    async removeSet(set) {
        try {
            await this.api.deleteSet(set.id);
            this.sets = this.sets.filter(s => s.id !== set.id);
            this.mode = null;
            this.render();
            this.setStatus(`Deleted the set "${set.title}". Its pieces are still in your library.`, 'success');
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
            this.setStatus('Removed from your library.', 'success');
        } catch (error) {
            this.setStatus(error.message, 'error');
        }
    }
}
