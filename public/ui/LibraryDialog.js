/**
 * LibraryDialog
 * "My uploaded files" on the Find Music tab: pieces saved from the user's own
 * files (Play, Share, Rename, Delete), and pieces others shared with them.
 * Sharing asks once for confirmation that the user has the right to share,
 * and needs both a composer and a title.
 */

import { escapeHtml, escapeHtmlAttribute } from '../utils/validation.js';
import { LibraryApi, shareUrl } from '../api/LibraryApi.js';
import { button, shareLinkRow, copyLink, referenceRow } from './shareConfirm.js';

/**
 * Name of a piece as shown in lists: composer first, e.g. "Vivaldi – Gloria"
 * @param {{title: string, composer: string}} piece
 * @returns {string} Text
 */
export function pieceName(piece) {
    return piece.composer ? `${piece.composer} – ${piece.title}` : piece.title;
}

/**
 * Second line of a piece in the list, e.g. "saved 9 Nov 2026"
 * @param {{createdAt: string}} piece - Saved piece
 * @returns {string} Text
 */
export function pieceDetails(piece) {
    const saved = new Date(piece.createdAt);
    return isNaN(saved) ? '' : `saved ${saved.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

/**
 * Line above the list, e.g. "3 of 100 files"
 * @param {number} count - Pieces saved
 * @param {number} limit - Most allowed
 * @returns {string} Text
 */
export function librarySummary(count, limit) {
    if (count === 0) {
        return 'You haven\'t uploaded any files yet. Choose "Or load your own MIDI or MusicXML file…", then Play now: the piece is kept here so you can play it again.';
    }
    return `${count} of ${limit} file${limit === 1 ? '' : 's'}`;
}

/**
 * "3 items", "1 item"
 * @param {number} count
 * @returns {string}
 */
export function itemCount(count) {
    return `${count} item${count === 1 ? '' : 's'}`;
}

export class LibraryDialog {
    /**
     * @param {Object} options
     * @param {HTMLDialogElement} options.dialog - The dialog element
     * @param {HTMLElement} options.openButton - Control that opens the dialog
     * @param {Function} options.onPlay - Called with (midiBytes, title, { pieceId, composer, kind })
     * @param {Function} [options.onOpenShared] - Called with (kind, token) for a piece shared with the user
     * @param {Object} [options.api] - Library API (for tests)
     * @param {string} [options.origin] - Site address for share links (for tests)
     */
    constructor({ dialog, openButton, onPlay, onOpenShared, api, origin }) {
        this.dialog = dialog;
        this.openButton = openButton;
        this.onPlay = onPlay;
        this.onOpenShared = onOpenShared || (() => {});
        this.api = api || LibraryApi;
        this.origin = origin;
        this.pieces = [];
        this.references = [];
        this.attested = false;
        this.limit = 0;
        // What is being edited or confirmed: { type: 'rename' | 'delete', id }, or null
        this.mode = null;
        // A share waiting for the right-to-share confirmation, or for a composer
        this.pendingShare = null;

        if (!dialog || !openButton) return;
        const find = id => dialog.querySelector(`#${id}`);
        this.summary = find('library-summary');
        this.list = find('library-list');
        this.refsSection = find('library-refs-section');
        this.refsList = find('library-refs');
        this.status = find('library-status');
        this.attestPanel = find('library-attest');
        this.attestCheckbox = find('library-attest-checkbox');

        openButton.addEventListener('click', () => this.open());
        find('library-dialog-close').addEventListener('click', () => this.dialog.close());
        dialog.addEventListener('click', event => {
            if (event.target === this.dialog) {
                this.dialog.close();
                return;
            }
            const target = event.target.closest && event.target.closest('button[data-action]');
            if (target) this.handleAction(target.dataset.action, target.dataset.id);
        });
        dialog.addEventListener('submit', event => {
            event.preventDefault();
            this.handleAction(event.target.dataset.action, event.target.dataset.id || '');
        });
    }

    async open() {
        this.mode = null;
        this.pendingShare = null;
        this.setStatus('', '');
        this.summary.textContent = 'Loading…';
        this.list.innerHTML = '';
        this.refsList.innerHTML = '';
        this.attestPanel.hidden = true;
        this.dialog.showModal();
        await this.refresh();
    }

    async refresh() {
        try {
            const data = await this.api.list();
            this.pieces = data.pieces;
            this.references = (data.references || []).filter(ref => ref.kind === 'piece');
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
        this.refsSection.hidden = this.references.length === 0;
        this.refsList.innerHTML = this.references.map(ref =>
            referenceRow({ ...ref, title: ref.available ? pieceName(ref) : ref.title }, () => '')).join('');
    }

    renderPiece(piece) {
        const id = piece.id;
        if (this.isMode('rename', id)) {
            return `<li class="library-item">
                <form class="library-rename" data-action="rename-save" data-id="${escapeHtmlAttribute(id)}">
                    <label>Composer <input name="composer" maxlength="200" value="${escapeHtmlAttribute(piece.composer)}"
                        title="Needed before you can share the piece"></label>
                    <label>Title <input name="title" required maxlength="200" value="${escapeHtmlAttribute(piece.title)}"
                        title="The name shown in your list and the player"></label>
                    <div class="library-buttons">
                        <button type="submit" class="btn btn-primary" title="Save the composer and title">Save</button>
                        ${button('cancel', id, 'Cancel', 'Keep the current composer and title')}
                    </div>
                </form>
            </li>`;
        }
        const buttons = this.isMode('delete', id)
            ? `<span class="library-confirm">Delete this file?</span>
               ${button('delete-confirm', id, 'Delete', 'Delete this piece from your uploaded files and from any sets. Anyone you shared it with can no longer play it. This can\'t be undone.', 'btn-danger')}
               ${button('cancel', id, 'Cancel', 'Keep this piece')}`
            : `${button('play', id, 'Play', 'Open this piece in the player on the Play Music tab', 'btn-primary')}
               ${piece.shareToken ? '' : button('share', id, 'Share', 'Get a link so others (for example your choir) can play this piece')}
               ${button('rename', id, 'Rename', 'Change the composer or title')}
               ${button('delete', id, 'Delete', 'Remove this piece from your uploaded files')}`;
        return `<li class="library-item">
            <div class="library-piece">
                <span class="library-title">${escapeHtml(pieceName(piece))}${piece.shareToken ? ' <span class="library-badge">Shared</span>' : ''}</span>
                <span class="library-details">${escapeHtml(pieceDetails(piece))}</span>
            </div>
            <div class="library-buttons">${buttons}</div>
            ${shareLinkRow('piece', piece, this.origin)}
        </li>`;
    }

    /**
     * Respond to a button or form in the dialog
     * @param {string} action - data-action of the control
     * @param {string} id - Piece (or "kind:token" for a shared entry) it applies to
     */
    async handleAction(action, id) {
        this.setStatus('', '');
        const piece = this.pieces.find(p => p.id === id);
        switch (action) {
            case 'play': return piece && this.play(piece);
            case 'rename': this.mode = { type: 'rename', id }; return this.render();
            case 'rename-save': return piece && this.rename(piece);
            case 'delete': this.mode = { type: 'delete', id }; return this.render();
            case 'delete-confirm': return piece && this.remove(piece);
            case 'cancel':
                this.mode = null;
                this.pendingShare = null;
                return this.render();
            case 'share': return piece && this.share(piece);
            case 'copy': return piece && copyLink(shareUrl('piece', piece.shareToken, this.origin), (t, k) => this.setStatus(t, k));
            case 'unshare': return piece && this.unshare(piece);
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
            // Renaming to add a composer may have been the first step of sharing
            if (this.pendingShare === piece.id && piece.composer) {
                return this.share(piece);
            }
            this.pendingShare = null;
            this.setStatus('Saved.', 'success');
        } catch (error) {
            this.setStatus(error.message, 'error');
        }
        return undefined;
    }

    async remove(piece) {
        try {
            await this.api.remove(piece.id);
            this.pieces = this.pieces.filter(p => p.id !== piece.id);
            this.mode = null;
            this.render();
            this.setStatus(`Deleted "${pieceName(piece)}".`, 'success');
        } catch (error) {
            this.setStatus(error.message, 'error');
        }
    }

    /**
     * Share a piece. A composer is needed first, then (once) confirmation
     * that the user has the right to share.
     */
    async share(piece) {
        if (!piece.composer || !piece.title) {
            this.pendingShare = piece.id;
            this.mode = { type: 'rename', id: piece.id };
            this.render();
            this.setStatus('Please add the composer (and check the title) before sharing, so people know what the piece is.', 'info');
            return;
        }
        if (!this.attested) {
            this.pendingShare = piece.id;
            this.attestCheckbox.checked = false;
            this.attestPanel.hidden = false;
            return;
        }
        try {
            piece.shareToken = await this.api.share('piece', piece.id);
            this.pendingShare = null;
            this.render();
            this.setStatus('Sharing on. Copy the link and send it to anyone who should be able to play this piece.', 'success');
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
            const piece = this.pieces.find(p => p.id === this.pendingShare);
            if (piece) await this.share(piece);
        } catch (error) {
            this.setStatus(error.message, 'error');
        }
    }

    async unshare(piece) {
        try {
            await this.api.unshare('piece', piece.id);
            piece.shareToken = null;
            this.render();
            this.setStatus('Sharing turned off. The old link no longer works.', 'success');
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
