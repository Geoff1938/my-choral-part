/**
 * ImportDialog
 * "Or load your own MIDI or MusicXML file..." on the Find Music tab. The user
 * picks a file, it is converted into a practice MIDI in the browser (the
 * original file never leaves the device), and a report is shown. Play now
 * saves the practice MIDI to the user's uploaded files (My uploaded files)
 * and opens it in the player.
 *
 * The report wording is in plain functions so it can be tested without a browser.
 */

import { escapeHtml } from '../utils/validation.js';
import { LibraryApi } from '../api/LibraryApi.js';

/** Overall status of a conversion, as shown at the top of the report */
const STATUS_TEXT = {
    ok: 'Ready to play.',
    warning: 'Ready to play. Please check the notes below.',
    rejected: 'This file can\'t be used.'
};

/** Symbols shown before each report message */
const LEVEL_SYMBOL = { reject: '✕', warning: '!', info: 'i' };

/**
 * Turn a conversion result into what the report shows
 * @param {Object} result - Result of convertFile: status, messages, suggested, midi
 * @param {string} filename - Name of the file the user picked
 * @returns {{heading: string, subheading: string, status: string, statusText: string,
 *            messages: Array<{level: string, text: string}>, canPlay: boolean}} Report
 */
export function buildReport(result, filename) {
    const suggested = result.suggested || {};
    const canPlay = result.status !== 'rejected' && Boolean(result.midi);
    return {
        heading: suggested.title || filename || 'Your file',
        subheading: suggested.composer || '',
        status: result.status,
        statusText: STATUS_TEXT[result.status] || STATUS_TEXT.rejected,
        // Problems first, then the informational summary
        messages: [...result.messages].sort((a, b) => levelOrder(a.level) - levelOrder(b.level)),
        canPlay
    };
}

function levelOrder(level) {
    return { reject: 0, warning: 1, info: 2 }[level] ?? 3;
}

/**
 * Report for a file that could not be converted for an unexpected reason
 * @param {string} filename - Name of the file the user picked
 * @returns {Object} Report, as from buildReport
 */
export function failureReport(filename) {
    return buildReport({
        status: 'rejected',
        messages: [{
            level: 'reject',
            text: 'Something went wrong while reading this file. It may be damaged, or in a form we don\'t support yet.'
        }],
        suggested: null,
        midi: null
    }, filename);
}

export class ImportDialog {
    /**
     * @param {Object} options
     * @param {HTMLDialogElement} options.dialog - The dialog element
     * @param {HTMLElement} options.openButton - Control that opens the dialog
     * @param {Function} options.onPlay - Called with (midiBytes, title, { pieceId, composer, kind, saveError })
     *     when the user chooses Play now. The piece is saved to the user's
     *     uploaded files first; if that fails it still plays, with saveError set.
     * @param {Function} [options.loadConverter] - Returns the converter module (for tests)
     * @param {Object} [options.api] - Library API (for tests)
     */
    constructor({ dialog, openButton, onPlay, loadConverter, api }) {
        this.dialog = dialog;
        this.openButton = openButton;
        this.onPlay = onPlay;
        this.api = api || LibraryApi;
        // The converter is only downloaded when someone first uses this dialog
        this.loadConverter = loadConverter || (() => import('../practice-midi/convert.js'));
        this.result = null;
        this.report = null;

        if (!dialog || !openButton) return;
        const find = id => dialog.querySelector(`#${id}`);
        this.fileInput = find('import-file-input');
        this.chooseButton = find('import-choose-btn');
        this.dropZone = find('import-drop-zone');
        this.workingPanel = find('import-working');
        this.reportPanel = find('import-report');
        this.playButton = find('import-play-btn');
        this.againButton = find('import-again-btn');
        this.cancelButton = find('import-cancel-btn');
        this.closeButton = find('import-dialog-close');
        this.savedHint = find('import-saved-hint');

        this.bindEvents();
    }

    bindEvents() {
        this.openButton.addEventListener('click', () => this.open());
        this.closeButton.addEventListener('click', () => this.dialog.close());
        this.cancelButton.addEventListener('click', () => this.dialog.close());
        // Clicking the shaded area outside the dialog closes it
        this.dialog.addEventListener('click', event => {
            if (event.target === this.dialog) this.dialog.close();
        });

        this.chooseButton.addEventListener('click', () => this.fileInput.click());
        this.againButton.addEventListener('click', () => this.fileInput.click());
        this.fileInput.addEventListener('change', () => {
            const file = this.fileInput.files && this.fileInput.files[0];
            // Clear the input so choosing the same file again still triggers a change
            this.fileInput.value = '';
            if (file) this.handleFile(file);
        });

        // Drag and drop (desktop)
        this.dropZone.addEventListener('dragover', event => {
            event.preventDefault();
            this.dropZone.classList.add('drag-over');
        });
        this.dropZone.addEventListener('dragleave', () => this.dropZone.classList.remove('drag-over'));
        this.dropZone.addEventListener('drop', event => {
            event.preventDefault();
            this.dropZone.classList.remove('drag-over');
            const file = event.dataTransfer && event.dataTransfer.files[0];
            if (file) this.handleFile(file);
        });

        this.playButton.addEventListener('click', () => this.play());
    }

    /**
     * Play now: save the piece to the user's uploaded files, then hand it to the player
     */
    async play() {
        if (!this.result || !this.report || !this.report.canPlay || this.playButton.disabled) return;
        const { heading: title, subheading: composer } = this.report;
        const midi = this.result.midi;
        this.playButton.disabled = true;
        this.playButton.textContent = 'Saving…';
        let options;
        try {
            const saved = await this.api.save({ title, composer, midi });
            options = { pieceId: saved.id, composer: saved.composer, kind: 'library' };
        } catch (error) {
            options = { pieceId: null, composer, kind: 'file', saveError: error.message };
        }
        this.playButton.disabled = false;
        this.playButton.textContent = 'Play now';
        this.dialog.close();
        this.onPlay(midi, title, options);
    }

    open() {
        this.showPanel('choose');
        this.dialog.showModal();
        this.chooseButton.focus();
    }

    /**
     * Show one part of the dialog: 'choose', 'working' or 'report'
     * @param {string} name - Panel name
     */
    showPanel(name) {
        this.dropZone.hidden = name !== 'choose';
        this.workingPanel.hidden = name !== 'working';
        this.reportPanel.hidden = name !== 'report';
    }

    /**
     * Read, convert and report on a file the user picked
     * @param {File} file - The chosen file
     */
    async handleFile(file) {
        this.result = null;
        this.showPanel('working');
        try {
            const { convertFile } = await this.loadConverter();
            const bytes = new Uint8Array(await file.arrayBuffer());
            this.result = await convertFile(bytes, file.name);
            this.report = buildReport(this.result, file.name);
        } catch (error) {
            console.error('[Import] Could not convert file:', error);
            this.result = null;
            this.report = failureReport(file.name);
        }
        this.renderReport();
        this.showPanel('report');
    }

    renderReport() {
        const report = this.report;
        const items = report.messages.map(m =>
            `<li class="import-message import-message-${escapeHtml(m.level)}">` +
            `<span class="import-message-symbol" aria-hidden="true">${LEVEL_SYMBOL[m.level] || ''}</span>` +
            `<span>${escapeHtml(m.text)}</span></li>`
        ).join('');

        this.reportPanel.querySelector('.import-report-body').innerHTML =
            (report.subheading ? `<p class="import-composer">${escapeHtml(report.subheading)}</p>` : '') +
            `<h4 class="import-title">${escapeHtml(report.heading)}</h4>` +
            `<p class="import-status import-status-${escapeHtml(report.status)}">${escapeHtml(report.statusText)}</p>` +
            `<ul class="import-messages">${items}</ul>`;

        // A playable file: Play now / Cancel. A rejected one: Choose another file / Cancel.
        this.playButton.hidden = !report.canPlay;
        this.againButton.hidden = report.canPlay;
        if (this.savedHint) this.savedHint.hidden = !report.canPlay;
        if (report.canPlay) {
            this.playButton.focus();
        } else {
            this.againButton.focus();
        }
    }
}
