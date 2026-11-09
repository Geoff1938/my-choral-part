/**
 * LibraryDialog
 * "My library" on the Find Music tab: lists the pieces the user has saved
 * from their own files, with Play, Rename and Delete.
 */

import { escapeHtml, escapeHtmlAttribute } from '../utils/validation.js';
import { LibraryApi } from '../api/LibraryApi.js';

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
        return 'Your library is empty. To add a piece, choose "Or load your own MIDI or MusicXML file…", then Save to my library.';
    }
    return `${count} of ${limit} piece${limit === 1 ? '' : 's'}`;
}

export class LibraryDialog {
    /**
     * @param {Object} options
     * @param {HTMLDialogElement} options.dialog - The dialog element
     * @param {HTMLElement} options.openButton - Control that opens the dialog
     * @param {Function} options.onPlay - Called with (midiBytes, title, { pieceId, composer })
     * @param {Object} [options.api] - Library API (for tests)
     */
    constructor({ dialog, openButton, onPlay, api }) {
        this.dialog = dialog;
        this.openButton = openButton;
        this.onPlay = onPlay;
        this.api = api || LibraryApi;
        this.pieces = [];
        this.limit = 0;
        // Which piece, if any, is being renamed or confirmed for deletion
        this.editing = null;
        this.confirmingDelete = null;

        if (!dialog || !openButton) return;
        const find = id => dialog.querySelector(`#${id}`);
        this.list = find('library-list');
        this.summary = find('library-summary');
        this.status = find('library-status');

        openButton.addEventListener('click', () => this.open());
        find('library-dialog-close').addEventListener('click', () => this.dialog.close());
        dialog.addEventListener('click', event => {
            if (event.target === this.dialog) this.dialog.close();
        });
        // One handler for every button in the list
        this.list.addEventListener('click', event => {
            const button = event.target.closest('button[data-action]');
            if (button) this.handleAction(button.dataset.action, button.dataset.id);
        });
        this.list.addEventListener('submit', event => {
            event.preventDefault();
            this.handleAction('rename-save', event.target.dataset.id);
        });
    }

    async open() {
        this.editing = null;
        this.confirmingDelete = null;
        this.setStatus('', '');
        this.summary.textContent = 'Loading your library…';
        this.list.innerHTML = '';
        this.dialog.showModal();
        await this.refresh();
    }

    async refresh() {
        try {
            const { pieces, limit } = await this.api.list();
            this.pieces = pieces;
            this.limit = limit;
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

    render() {
        this.summary.textContent = librarySummary(this.pieces.length, this.limit);
        this.list.innerHTML = this.pieces.map(piece => this.renderPiece(piece)).join('');
    }

    renderPiece(piece) {
        const id = escapeHtmlAttribute(piece.id);
        if (this.editing === piece.id) {
            return `<li class="library-item">
                <form class="library-rename" data-id="${id}">
                    <label>Title <input name="title" required maxlength="200" value="${escapeHtmlAttribute(piece.title)}"
                        title="The name shown in your library and the player"></label>
                    <label>Composer <input name="composer" maxlength="200" value="${escapeHtmlAttribute(piece.composer)}"
                        title="Optional"></label>
                    <div class="library-buttons">
                        <button type="submit" class="btn btn-primary" title="Save the new title and composer">Save</button>
                        <button type="button" class="btn" data-action="rename-cancel" data-id="${id}" title="Keep the current title and composer">Cancel</button>
                    </div>
                </form>
            </li>`;
        }
        const buttons = this.confirmingDelete === piece.id
            ? `<span class="library-confirm">Delete this piece?</span>
               <button type="button" class="btn btn-danger" data-action="delete-confirm" data-id="${id}" title="Delete this piece from your library. This can't be undone.">Delete</button>
               <button type="button" class="btn" data-action="delete-cancel" data-id="${id}" title="Keep this piece">Cancel</button>`
            : `<button type="button" class="btn btn-primary" data-action="play" data-id="${id}" title="Open this piece in the player on the Play Music tab">Play</button>
               <button type="button" class="btn" data-action="rename" data-id="${id}" title="Change the title or composer">Rename</button>
               <button type="button" class="btn" data-action="delete" data-id="${id}" title="Remove this piece from your library">Delete</button>`;
        return `<li class="library-item">
            <div class="library-piece">
                <span class="library-title">${escapeHtml(piece.title)}</span>
                <span class="library-details">${escapeHtml(pieceDetails(piece))}</span>
            </div>
            <div class="library-buttons">${buttons}</div>
        </li>`;
    }

    /**
     * Respond to a button in the list
     * @param {string} action - data-action of the button
     * @param {string} id - Piece
     */
    async handleAction(action, id) {
        const piece = this.pieces.find(p => p.id === id);
        if (!piece) return;
        this.setStatus('', '');
        switch (action) {
            case 'play':
                return this.play(piece);
            case 'rename':
                this.editing = id;
                this.confirmingDelete = null;
                return this.render();
            case 'rename-cancel':
                this.editing = null;
                return this.render();
            case 'rename-save':
                return this.rename(piece);
            case 'delete':
                this.confirmingDelete = id;
                this.editing = null;
                return this.render();
            case 'delete-cancel':
                this.confirmingDelete = null;
                return this.render();
            case 'delete-confirm':
                return this.remove(piece);
            default:
        }
    }

    async play(piece) {
        this.setStatus('Opening…', 'info');
        try {
            const midi = await this.api.fetchMidi(piece.id);
            this.dialog.close();
            this.onPlay(midi, piece.title, { pieceId: piece.id, composer: piece.composer });
        } catch (error) {
            this.setStatus(error.message, 'error');
        }
    }

    async rename(piece) {
        const form = this.list.querySelector(`form[data-id="${CSS.escape(piece.id)}"]`);
        const title = form.elements.title.value;
        const composer = form.elements.composer.value;
        try {
            const updated = await this.api.rename(piece.id, { title, composer });
            Object.assign(piece, updated);
            this.editing = null;
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
            this.confirmingDelete = null;
            this.render();
            this.setStatus(`Deleted "${piece.title}".`, 'success');
        } catch (error) {
            this.setStatus(error.message, 'error');
        }
    }
}
