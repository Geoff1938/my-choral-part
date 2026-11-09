/**
 * ImportDialog
 * "Or load your own MIDI or MusicXML file..." on the Find Music tab. The user
 * picks a file, it is converted into a practice MIDI in the browser (nothing
 * is uploaded), and a report is shown with options to play or download it.
 *
 * The report wording and file naming are plain functions (below the class's
 * helpers) so they can be tested without a browser.
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

/**
 * File name for the downloaded practice MIDI, e.g. "Gloria (practice).mid"
 * @param {string} title - Piece title
 * @returns {string} Safe file name
 */
export function practiceFilename(title) {
    const safe = String(title || 'Piece')
        .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80) || 'Piece';
    return `${safe} (practice).mid`;
}

export class ImportDialog {
    /**
     * @param {Object} options
     * @param {HTMLDialogElement} options.dialog - The dialog element
     * @param {HTMLElement} options.openButton - Control that opens the dialog
     * @param {Function} options.onPlay - Called with (midiBytes, title, { pieceId, composer })
     *     when the user chooses Play now; pieceId is set if the piece was saved first
     * @param {Function} [options.onSaved] - Called with the saved piece after Save to my library
     * @param {Function} [options.loadConverter] - Returns the converter module (for tests)
     * @param {Object} [options.api] - Library API (for tests)
     */
    constructor({ dialog, openButton, onPlay, onSaved, loadConverter, api }) {
        this.dialog = dialog;
        this.openButton = openButton;
        this.onPlay = onPlay;
        this.onSaved = onSaved || (() => {});
        this.api = api || LibraryApi;
        // The converter is only downloaded when someone first uses this dialog
        this.loadConverter = loadConverter || (() => import('../practice-midi/convert.js'));
        this.result = null;
        this.report = null;
        this.savedPiece = null;

        if (!dialog || !openButton) return;
        const find = id => dialog.querySelector(`#${id}`);
        this.fileInput = find('import-file-input');
        this.chooseButton = find('import-choose-btn');
        this.dropZone = find('import-drop-zone');
        this.workingPanel = find('import-working');
        this.reportPanel = find('import-report');
        this.playButton = find('import-play-btn');
        this.downloadButton = find('import-download-btn');
        this.againButton = find('import-again-btn');
        this.closeButton = find('import-dialog-close');
        this.savedHint = find('import-saved-hint');
        this.saveButton = find('import-save-btn');
        this.saveStatus = find('import-save-status');

        this.bindEvents();
    }

    bindEvents() {
        this.openButton.addEventListener('click', () => this.open());
        this.closeButton.addEventListener('click', () => this.dialog.close());
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

        this.playButton.addEventListener('click', () => {
            if (!this.result || !this.report || !this.report.canPlay) return;
            this.dialog.close();
            const saved = this.savedPiece;
            this.onPlay(this.result.midi, saved ? saved.title : this.report.heading, {
                pieceId: saved ? saved.id : null,
                composer: saved ? saved.composer : this.report.subheading
            });
        });
        this.downloadButton.addEventListener('click', () => this.download());
        this.saveButton.addEventListener('click', () => this.save());
    }

    /**
     * Save the converted piece to the user's library
     */
    async save() {
        if (!this.result || !this.report || !this.report.canPlay || this.savedPiece) return;
        this.saveButton.disabled = true;
        this.saveButton.textContent = 'Saving…';
        this.setSaveStatus('', '');
        try {
            this.savedPiece = await this.api.save({
                title: this.report.heading,
                composer: this.report.subheading,
                midi: this.result.midi
            });
            this.saveButton.textContent = 'Saved to your library';
            this.setSaveStatus('Saved. Find it again under My library on the Find Music tab.', 'success');
            if (this.savedHint) this.savedHint.hidden = true;
            this.onSaved(this.savedPiece);
        } catch (error) {
            this.saveButton.disabled = false;
            this.saveButton.textContent = 'Save to my library';
            this.setSaveStatus(error.message, 'error');
        }
    }

    setSaveStatus(text, type) {
        if (!this.saveStatus) return;
        this.saveStatus.textContent = text;
        this.saveStatus.className = `import-save-status${type ? ` import-save-status-${type}` : ''}`;
        this.saveStatus.hidden = !text;
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
        this.savedPiece = null;
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
            `<h4 class="import-title">${escapeHtml(report.heading)}</h4>` +
            (report.subheading ? `<p class="import-composer">${escapeHtml(report.subheading)}</p>` : '') +
            `<p class="import-status import-status-${escapeHtml(report.status)}">${escapeHtml(report.statusText)}</p>` +
            `<ul class="import-messages">${items}</ul>`;

        this.playButton.hidden = !report.canPlay;
        this.downloadButton.hidden = !report.canPlay;
        this.saveButton.hidden = !report.canPlay;
        this.saveButton.disabled = false;
        this.saveButton.textContent = 'Save to my library';
        this.setSaveStatus('', '');
        if (this.savedHint) this.savedHint.hidden = !report.canPlay;
        if (report.canPlay) {
            this.playButton.focus();
        } else {
            this.againButton.focus();
        }
    }

    download() {
        if (!this.result || !this.result.midi) return;
        const blob = new Blob([this.result.midi], { type: 'audio/midi' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = practiceFilename(this.report.heading);
        document.body.appendChild(link);
        link.click();
        link.remove();
        // Give the browser time to start the download before releasing the data
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
}
