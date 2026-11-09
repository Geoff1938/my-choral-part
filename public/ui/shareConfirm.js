/**
 * Shared pieces of the "My uploaded files" and "My sets" dialogs: the
 * share-link row and the one-time right-to-share confirmation.
 */

import { escapeHtml, escapeHtmlAttribute } from '../utils/validation.js';
import { shareUrl } from '../api/LibraryApi.js';

/**
 * A dialog button
 * @param {string} action - data-action, handled by the dialog
 * @param {string} id - data-id, the item it applies to
 * @param {string} label - Text (HTML-escaped by the caller if needed)
 * @param {string} title - Tooltip
 * @param {string} [style] - Extra classes, e.g. 'btn-primary'
 * @returns {string} HTML
 */
export function button(action, id, label, title, style = '') {
    return `<button type="button" class="btn${style ? ` ${style}` : ''}" data-action="${action}" ` +
        `data-id="${escapeHtmlAttribute(id)}" title="${escapeHtmlAttribute(title)}">${label}</button>`;
}

/**
 * The link row shown under a shared piece or set
 * @param {'piece'|'set'} kind
 * @param {{id: string, shareToken: string|null}} item
 * @param {string} [origin] - Site address (for tests)
 * @returns {string} HTML, or '' if not shared
 */
export function shareLinkRow(kind, item, origin) {
    if (!item.shareToken) return '';
    const url = shareUrl(kind, item.shareToken, origin);
    return `<div class="library-share">
        <input type="text" readonly value="${escapeHtmlAttribute(url)}" aria-label="Share link"
            title="Anyone with this link can play the ${kind} and it is added to their own list">
        ${button('copy', item.id, 'Copy link', 'Copy the link so you can paste it into an email or message')}
        ${button('unshare', item.id, 'Stop sharing', 'Turn the link off: people who have it can no longer play this. Sharing again gives a new link.')}
    </div>`;
}

/**
 * Copy a link, falling back to showing it if the clipboard isn't available
 * @param {string} url - Link
 * @param {Function} setStatus - (text, type) to report the result
 */
export async function copyLink(url, setStatus) {
    try {
        await navigator.clipboard.writeText(url);
        setStatus('Link copied.', 'success');
    } catch (error) {
        setStatus(`Copy this link: ${url}`, 'info');
    }
}

/**
 * HTML for "Shared with you" entries
 * @param {Object} ref - From the library listing: { kind, token, available, title, composer, itemCount }
 * @param {Function} describe - (ref) => details line for an available entry
 * @returns {string} HTML
 */
export function referenceRow(ref, describe) {
    const id = `${ref.kind}:${ref.token}`;
    const name = ref.available ? ref.title : (ref.kind === 'set' ? 'A shared set' : 'A shared piece');
    const details = ref.available ? describe(ref) : 'No longer available';
    const buttons = (ref.available
        ? button('open-shared', id, 'Play', ref.kind === 'set' ? 'Play this set in order' : 'Open this piece in the player', 'btn-primary')
        : '') +
        button('remove-ref', id, 'Remove', 'Take this off your list (it stays available to others)');
    return `<li class="library-item">
        <div class="library-piece">
            <span class="library-title">${escapeHtml(name)}</span>
            <span class="library-details">${escapeHtml(details)}</span>
        </div>
        <div class="library-buttons">${buttons}</div>
    </li>`;
}
