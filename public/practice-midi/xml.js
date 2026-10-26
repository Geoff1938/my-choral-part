/**
 * Minimal XML parser for MusicXML
 * Handles elements, attributes, text, CDATA, entities, comments, processing
 * instructions and a DOCTYPE (whose internal subset is skipped). No DTD
 * validation and no namespaces, which MusicXML does not need. Pure JavaScript,
 * so it runs where DOMParser is not available (Jest, the server).
 */

export class XmlParseError extends Error {
    constructor(message) {
        super(message);
        this.name = 'XmlParseError';
    }
}

const NAMED_ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: '\'' };

function decodeEntities(text) {
    if (text.indexOf('&') < 0) return text;
    return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g, (match, entity) => {
        if (entity[0] === '#') {
            const code = entity[1] === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
            return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
        }
        // Entities defined in a DTD are not expanded; keep them as written
        return NAMED_ENTITIES[entity] ?? match;
    });
}

const NAME = /[A-Za-z_:][\w.:-]*/y;
const ATTRIBUTE = /\s*([A-Za-z_:][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/y;

/**
 * Parse an XML document
 * @param {string} text - Document text
 * @returns {{name: string, attrs: Object<string, string>, children: Array<Object|string>}} Root element
 * @throws {XmlParseError} If the document is not well-formed
 */
export function parseXml(text) {
    let pos = 0;
    const stack = [];
    let root = null;

    function fail(message) {
        const line = text.slice(0, pos).split('\n').length;
        throw new XmlParseError(`${message} (line ${line})`);
    }

    function skipPast(terminator, what) {
        const end = text.indexOf(terminator, pos);
        if (end < 0) fail(`Unterminated ${what}`);
        pos = end + terminator.length;
    }

    while (pos < text.length) {
        const lt = text.indexOf('<', pos);
        const textEnd = lt < 0 ? text.length : lt;
        if (textEnd > pos) {
            const content = text.slice(pos, textEnd);
            if (stack.length) {
                if (content.trim()) stack[stack.length - 1].children.push(decodeEntities(content));
            } else if (content.trim()) {
                pos = textEnd;
                fail('Text outside the root element');
            }
        }
        if (lt < 0) break;
        pos = lt;

        if (text.startsWith('<!--', pos)) {
            skipPast('-->', 'comment');
        } else if (text.startsWith('<![CDATA[', pos)) {
            const end = text.indexOf(']]>', pos);
            if (end < 0) fail('Unterminated CDATA section');
            if (!stack.length) fail('CDATA outside the root element');
            stack[stack.length - 1].children.push(text.slice(pos + 9, end));
            pos = end + 3;
        } else if (text.startsWith('<?', pos)) {
            skipPast('?>', 'processing instruction');
        } else if (text.startsWith('<!DOCTYPE', pos) || text.startsWith('<!doctype', pos)) {
            // Skip to the closing '>', past any internal subset in brackets
            let depth = 0;
            pos += 9;
            while (pos < text.length) {
                const c = text[pos++];
                if (c === '[') depth++;
                else if (c === ']') depth--;
                else if (c === '>' && depth <= 0) break;
            }
        } else if (text.startsWith('</', pos)) {
            pos += 2;
            NAME.lastIndex = pos;
            const match = NAME.exec(text);
            if (!match) fail('Invalid closing tag');
            pos = NAME.lastIndex;
            const open = stack.pop();
            if (!open || open.name !== match[0]) {
                fail(`Closing tag </${match[0]}> does not match ${open ? `<${open.name}>` : 'any open element'}`);
            }
            const gt = text.indexOf('>', pos);
            if (gt < 0 || text.slice(pos, gt).trim()) fail('Invalid closing tag');
            pos = gt + 1;
        } else {
            pos++;
            NAME.lastIndex = pos;
            const match = NAME.exec(text);
            if (!match) fail('Invalid tag');
            pos = NAME.lastIndex;
            const element = { name: match[0], attrs: {}, children: [] };
            for (;;) {
                ATTRIBUTE.lastIndex = pos;
                const attr = ATTRIBUTE.exec(text);
                if (!attr) break;
                element.attrs[attr[1]] = decodeEntities(attr[3] ?? attr[4]);
                pos = ATTRIBUTE.lastIndex;
            }
            while (pos < text.length && /\s/.test(text[pos])) pos++;
            let selfClosing = false;
            if (text.startsWith('/>', pos)) {
                selfClosing = true;
                pos += 2;
            } else if (text[pos] === '>') {
                pos++;
            } else {
                fail(`Invalid tag <${element.name}>`);
            }
            if (stack.length) {
                stack[stack.length - 1].children.push(element);
            } else if (root) {
                fail('More than one root element');
            } else {
                root = element;
            }
            if (!selfClosing) stack.push(element);
        }
    }

    if (stack.length) fail(`Element <${stack[stack.length - 1].name}> is not closed`);
    if (!root) fail('No root element');
    return root;
}

/**
 * First child element with a name
 * @param {Object} element - Parent element
 * @param {string} name - Child element name
 * @returns {Object|null} Child element
 */
export function child(element, name) {
    if (!element) return null;
    for (const c of element.children) {
        if (typeof c !== 'string' && c.name === name) return c;
    }
    return null;
}

/**
 * All child elements, optionally with a name
 * @param {Object} element - Parent element
 * @param {string} [name] - Child element name
 * @returns {Array<Object>} Child elements
 */
export function children(element, name) {
    if (!element) return [];
    return element.children.filter(c => typeof c !== 'string' && (name === undefined || c.name === name));
}

/**
 * Text content of an element (or of a child of it, by path)
 * @param {Object} element - Element
 * @param {...string} path - Names of descendants to follow
 * @returns {string|null} Trimmed text, or null if the element is missing
 */
export function textOf(element, ...path) {
    let current = element;
    for (const name of path) {
        current = child(current, name);
    }
    if (!current) return null;
    let result = '';
    for (const c of current.children) {
        result += typeof c === 'string' ? c : textOf(c);
    }
    return result.trim();
}
