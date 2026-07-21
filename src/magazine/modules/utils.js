export function showToast(msg) {
    const toast = document.getElementById('toast-box');
    const text = document.getElementById('toast-text');
    if (!toast || !text) return;
    text.textContent = msg;

    toast.classList.remove('opacity-0', 'translate-y-10');
    toast.classList.add('opacity-100', 'translate-y-0');

    setTimeout(() => {
        toast.classList.remove('opacity-100', 'translate-y-0');
        toast.classList.add('opacity-0', 'translate-y-10');
    }, 3000);
}

export function normalizePastedAbstractText(value) {
    return String(value || '')
        .replace(/\r\n?/g, '\n')
        .replace(/\u00ad/g, '')
        .replace(/(\p{L})-\s*\n\s*(\p{L})/gu, '$1$2')
        .split(/\n\s*\n+/)
        .map(paragraph => paragraph
            .replace(/\s*\n\s*/g, ' ')
            .replace(/[ \t]+/g, ' ')
            .trim())
        .filter(Boolean)
        .join('\n\n');
}

export function handleAbstractPaste(event) {
    const text = event.clipboardData?.getData('text/plain');
    if (!text) return;
    event.preventDefault();
    const textarea = event.currentTarget;
    const normalized = normalizePastedAbstractText(text);
    textarea.setRangeText(normalized, textarea.selectionStart, textarea.selectionEnd, 'end');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

export function removeVietnameseDiacritics(value) {
    return String(value || '').normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

export function toTitleCase(value) {
    return String(value || '').toLocaleLowerCase('vi-VN').replace(/(^|[\s\-–—/([{])([\p{L}\p{N}])/gu,
        (_, separator, character) => separator + character.toLocaleUpperCase('vi-VN'));
}

export function allowDrop(ev) {
    ev.preventDefault();
}

// Helpers tạo DOCX thuần OOXML
export function xmlEscape(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function parseAuthorMarkers(value) {
    const text = String(value || '');
    const pattern = /\^\{([^}]+)\}|\^([0-9]+(?:\s*,\s*[0-9]+)*(?:\*)?|\*)/g;
    const parts = [];
    let cursor = 0;
    let match;
    while ((match = pattern.exec(text))) {
        if (match.index > cursor) parts.push({ type: 'text', value: text.slice(cursor, match.index) });
        parts.push({ type: 'sup', value: String(match[1] || match[2] || '').replace(/\s*,\s*/g, ',') });
        cursor = pattern.lastIndex;
    }
    if (cursor < text.length) parts.push({ type: 'text', value: text.slice(cursor) });
    return parts.length ? parts : [{ type: 'text', value: text }];
}

export function stripAuthorMarkers(value) {
    return parseAuthorMarkers(value)
        .filter(part => part.type !== 'sup')
        .map(part => part.value)
        .join('')
        .replace(/\s+([,;])/g, '$1')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

export function authorTextToHtml(value, fallback = '') {
    const source = value || fallback;
    return parseAuthorMarkers(source).map(part =>
        part.type === 'sup'
            ? `<sup>${xmlEscape(part.value)}</sup>`
            : xmlEscape(part.value).replace(/\r\n|\r|\n/g, '<br>')
    ).join('');
}

export function authorTextToWordRuns(value, options = {}, fallback = '') {
    const source = value || fallback;
    return parseAuthorMarkers(source).map(part =>
        wordRun(part.value, part.type === 'sup'
            ? { ...options, superscript: true, size: options.superscriptSize || Math.max(12, (options.size || 20) - 4) }
            : options)
    ).join('');
}

export function wordRun(text, options = {}) {
    if (!text) return '';
    const font = options.font || 'Times New Roman';
    const props = [
        `<w:rFonts w:ascii="${xmlEscape(font)}" w:hAnsi="${xmlEscape(font)}" w:eastAsia="${xmlEscape(font)}" w:cs="${xmlEscape(font)}"/>`,
        options.bold ? '<w:b/>' : '',
        options.italic === true ? '<w:i/><w:iCs/>' : (options.italic === false ? '<w:i w:val="0"/><w:iCs w:val="0"/>' : ''),
        options.underline ? '<w:u w:val="single"/>' : '',
        options.strike ? '<w:strike/>' : '',
        options.color ? `<w:color w:val="${options.color}"/>` : '',
        options.superscript ? '<w:vertAlign w:val="superscript"/>' : '',
        options.subscript ? '<w:vertAlign w:val="subscript"/>' : '',
        options.size ? `<w:sz w:val="${options.size}"/><w:szCs w:val="${options.size}"/>` : '',
        options.shading ? `<w:shd w:val="clear" w:color="auto" w:fill="${options.shading}"/>` : ''
    ].join('');
    const body = String(text).split('\n').map((part, index) =>
        `${index ? '<w:br/>' : ''}<w:t xml:space="preserve">${xmlEscape(part)}</w:t>`
    ).join('');
    return `<w:r><w:rPr>${props}</w:rPr>${body}</w:r>`;
}

export function wordParagraph(content, options = {}) {
    const alignment = options.align ? `<w:jc w:val="${options.align}"/>` : '';
    const spacing = `<w:spacing w:before="${options.before || 0}" w:after="${options.after ?? 100}" w:line="${options.line || 240}" w:lineRule="auto"/>`;
    const firstLine = options.firstLine < 0
        ? `w:hanging="${Math.abs(options.firstLine)}"` : `w:firstLine="${options.firstLine || 0}"`;
    const indent = options.firstLine || options.left || options.right
        ? `<w:ind ${firstLine} w:left="${options.left || 0}" w:right="${options.right || 0}"/>` : '';
    const keep = options.keepNext ? '<w:keepNext/>' : '';
    const border = options.bottomBorder ? '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="333333"/></w:pBdr>' : '';
    const style = options.style ? `<w:pStyle w:val="${options.style}"/>` : '';
    return `<w:p><w:pPr>${style}${alignment}${indent}${spacing}${keep}${border}</w:pPr>${content}</w:p>`;
}

export function cssLengthToTwips(value) {
    const number = parseFloat(value);
    if (!Number.isFinite(number)) return 0;
    if (String(value).includes('cm')) return Math.round(number * 567);
    if (String(value).includes('pt')) return Math.round(number * 20);
    if (String(value).includes('px')) return Math.round(number * 15);
    return Math.round(number * 20);
}

export function cssBorderWidthToWordSize(value) {
    const twips = cssLengthToTwips(value);
    if (!twips) return 0;
    return Math.max(2, Math.min(48, Math.round(twips / 2.5)));
}

export function cssColorToHex(value) {
    const raw = String(value || '').trim();
    if (!raw || raw === 'transparent') return '000000';
    const hex = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
    if (hex) {
        return hex.length === 3
            ? hex.split('').map(part => `${part}${part}`).join('').toUpperCase()
            : hex.toUpperCase();
    }
    const rgb = raw.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (!rgb) return '000000';
    return rgb.slice(1, 4).map(part => Math.max(0, Math.min(255, Number(part))).toString(16).padStart(2, '0')).join('').toUpperCase();
}

const ARTICLE_COLUMN_WIDTH_TWIPS = 4510;
const DEFAULT_BODY_FIRST_LINE_TWIPS = 204;

export function cssTableWidthToTwips(value, totalWidth = ARTICLE_COLUMN_WIDTH_TWIPS) {
    const raw = String(value || '').trim();
    if (!raw) return 0;
    const number = parseFloat(raw);
    if (!Number.isFinite(number)) return 0;
    if (raw.includes('%')) return Math.round(totalWidth * number / 100);
    return cssLengthToTwips(raw);
}

export function normalizeTableWidths(widths, count, totalWidth = ARTICLE_COLUMN_WIDTH_TWIPS) {
    const usable = Array.from({ length: count }, (_, index) => Math.max(0, widths[index] || 0));
    const sum = usable.reduce((total, width) => total + width, 0);
    if (!sum) return Array.from({ length: count }, () => Math.floor(totalWidth / count));
    const scaled = usable.map(width => Math.max(120, Math.round(width / sum * totalWidth)));
    const delta = totalWidth - scaled.reduce((total, width) => total + width, 0);
    scaled[scaled.length - 1] += delta;
    return scaled;
}

export function cssFontSizeToHalfPoints(value) {
    const number = parseFloat(value);
    if (!Number.isFinite(number)) return 0;
    if (String(value).includes('px')) return Math.round(number * 1.5);
    return Math.round(number * 2);
}

export function wordParagraphOptions(node, base = {}) {
    const style = node.style || {};
    const lineHeight = parseFloat(style.lineHeight);
    const explicitFirstLine = cssLengthToTwips(style.textIndent);
    const classIndent = Array.from(node.classList || []).map(name => name.match(/^ql-indent-(\d+)$/))
        .find(Boolean);
    const toolbarIndent = classIndent ? Number(classIndent[1]) * 567 : 0;
    const useDefaultFirstLine = base.defaultFirstLine !== false
        && /^(P|BLOCKQUOTE)$/i.test(node.tagName || '')
        && !explicitFirstLine
        && !toolbarIndent;
    return {
        ...base,
        firstLine: explicitFirstLine || (useDefaultFirstLine ? DEFAULT_BODY_FIRST_LINE_TWIPS : 0),
        left: cssLengthToTwips(style.marginLeft) + toolbarIndent,
        right: cssLengthToTwips(style.marginRight),
        before: style.marginTop ? cssLengthToTwips(style.marginTop) : (base.before || 0),
        after: style.marginBottom ? cssLengthToTwips(style.marginBottom) : (base.after ?? 100),
        line: Number.isFinite(lineHeight) ? Math.round(lineHeight * 240) : (base.line || 240)
    };
}

function stripLeadingIndentWhitespace(node) {
    const clone = node.cloneNode(true);
    if (!cssLengthToTwips(clone.style?.textIndent || '')) return clone;
    const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
    let textNode = walker.nextNode();
    while (textNode) {
        if (textNode.nodeValue) {
            textNode.nodeValue = textNode.nodeValue.replace(/^[\t \u00a0]+/, '');
            break;
        }
        textNode = walker.nextNode();
    }
    return clone;
}

export function inlineHtmlToWord(node, inherited = {}) {
    if (node.nodeType === Node.TEXT_NODE) return wordRun(node.nodeValue, inherited);
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    if (node.tagName === 'BR') return '<w:r><w:br/></w:r>';
    const next = { ...inherited };
    const style = node.style || {};
    const fontSize = cssFontSizeToHalfPoints(style.fontSize || '');
    if (fontSize) next.size = fontSize;
    if (style.fontFamily) next.font = style.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
    if (style.color) next.color = cssColorToHex(style.color);
    if (['STRONG', 'B'].includes(node.tagName)) next.bold = true;
    if (['EM', 'I'].includes(node.tagName) && !next.suppressItalic) next.italic = true;
    if (node.tagName === 'U' || style.textDecorationLine?.includes('underline') || style.textDecoration?.includes('underline')) next.underline = true;
    if (node.tagName === 'S' || node.tagName === 'STRIKE' || style.textDecorationLine?.includes('line-through') || style.textDecoration?.includes('line-through')) next.strike = true;
    return Array.from(node.childNodes).map(child => inlineHtmlToWord(child, next)).join('');
}

export function formulaTextFromElement(node) {
    return String(node?.dataset?.latex || node?.textContent || '').replace(/\s+/g, ' ').trim();
}

function mathRun(value) {
    return `<m:r><m:rPr><m:sty m:val="p"/></m:rPr><m:t>${xmlEscape(value)}</m:t></m:r>`;
}

function mathExpression(children) {
    return `<m:e>${children || mathRun('')}</m:e>`;
}

function readLatexGroup(source, cursor) {
    let index = cursor;
    while (/\s/.test(source[index] || '')) index += 1;
    if (source[index] !== '{') return { value: source[index] || '', end: index + 1 };
    let depth = 1;
    let body = '';
    index += 1;
    while (index < source.length && depth > 0) {
        const char = source[index];
        if (char === '{') {
            depth += 1;
            body += char;
        } else if (char === '}') {
            depth -= 1;
            if (depth) body += char;
        } else {
            body += char;
        }
        index += 1;
    }
    return { value: body, end: index };
}

function splitLatexTopLevel(source, separatorPattern) {
    const parts = [];
    let depth = 0;
    let cursor = 0;
    for (let index = 0; index < source.length; index += 1) {
        const char = source[index];
        if (char === '{') depth += 1;
        else if (char === '}') depth = Math.max(0, depth - 1);
        if (!depth && separatorPattern(source, index)) {
            parts.push(source.slice(cursor, index));
            cursor = index + (source[index] === '\\' && source[index + 1] === '\\' ? 2 : 1);
        }
    }
    parts.push(source.slice(cursor));
    return parts;
}

function matrixMathXml(body) {
    const rows = splitLatexTopLevel(body, (source, index) => source[index] === '\\' && source[index + 1] === '\\')
        .map(row => splitLatexTopLevel(row, (source, index) => source[index] === '&')
            .map(cell => `<m:e>${parseLatexMath(cell.trim()).xml || mathRun('')}</m:e>`)
            .join(''))
        .map(cells => `<m:mr>${cells}</m:mr>`)
        .join('');
    const matrixRows = rows || '<m:mr><m:e/></m:mr>';
    return `<m:d><m:dPr><m:begChr m:val="["/><m:endChr m:val="]"/></m:dPr><m:e><m:m><m:mPr/>${matrixRows}</m:m></m:e></m:d>`;
}

const latexGreekMap = {
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', theta: 'θ',
    lambda: 'λ', mu: 'μ', pi: 'π', sigma: 'σ', omega: 'ω', Delta: 'Δ',
    Gamma: 'Γ', Omega: 'Ω'
};

function latexCommandToSymbol(command) {
    if (command === 'sum') return '∑';
    if (command === 'int') return '∫';
    if (command === 'infty') return '∞';
    if (command === 'cdot' || command === 'times') return command === 'cdot' ? '·' : '×';
    if (command === 'pm') return '±';
    if (command === 'leq') return '≤';
    if (command === 'geq') return '≥';
    if (command === 'neq') return '≠';
    return latexGreekMap[command] || command;
}

function parseLatexMath(source, cursor = 0, stopChar = '') {
    const parts = [];
    let index = cursor;
    const parseScript = () => {
        while (/\s/.test(source[index] || '')) index += 1;
        if (source[index] === '{') {
            const group = readLatexGroup(source, index);
            index = group.end;
            return parseLatexMath(group.value).xml;
        }
        const atom = parseAtom();
        return atom.xml;
    };
    const applyScripts = (baseXml) => {
        let subXml = '';
        let supXml = '';
        let consumed = true;
        while (consumed) {
            consumed = false;
            while (/\s/.test(source[index] || '')) index += 1;
            if (source[index] === '_') {
                index += 1;
                subXml = parseScript();
                consumed = true;
            }
            while (/\s/.test(source[index] || '')) index += 1;
            if (source[index] === '^') {
                index += 1;
                supXml = parseScript();
                consumed = true;
            }
        }
        if (subXml && supXml) return `<m:sSubSup><m:e>${baseXml}</m:e><m:sub>${subXml}</m:sub><m:sup>${supXml}</m:sup></m:sSubSup>`;
        if (supXml) return `<m:sSup><m:e>${baseXml}</m:e><m:sup>${supXml}</m:sup></m:sSup>`;
        if (subXml) return `<m:sSub><m:e>${baseXml}</m:e><m:sub>${subXml}</m:sub></m:sSub>`;
        return baseXml;
    };
    const parseAtom = () => {
        if (stopChar && source[index] === stopChar) return { xml: '', end: index };
        if (source[index] === '\\') {
            const match = source.slice(index + 1).match(/^([A-Za-z]+|.)/);
            const command = match?.[1] || '';
            index += command.length + 1;
            if (command === 'begin') {
                const env = readLatexGroup(source, index);
                index = env.end;
                if (['matrix', 'pmatrix', 'bmatrix', 'Bmatrix', 'vmatrix', 'Vmatrix'].includes(env.value)) {
                    const endToken = `\\end{${env.value}}`;
                    const endIndex = source.indexOf(endToken, index);
                    const body = endIndex >= 0 ? source.slice(index, endIndex) : source.slice(index);
                    index = endIndex >= 0 ? endIndex + endToken.length : source.length;
                    if (env.value === 'pmatrix') {
                        return { xml: matrixMathXml(body).replace('m:val="["', 'm:val="("').replace('m:val="]"', 'm:val=")"'), end: index };
                    }
                    return { xml: matrixMathXml(body), end: index };
                }
                return { xml: mathRun(env.value), end: index };
            }
            if (command === 'end') {
                const env = readLatexGroup(source, index);
                index = env.end;
                return { xml: mathRun(''), end: index };
            }
            if (command === ',' || command === ';') return { xml: mathRun(' '), end: index };
            if (command === 'frac') {
                const numerator = readLatexGroup(source, index);
                index = numerator.end;
                const denominator = readLatexGroup(source, index);
                index = denominator.end;
                return {
                    xml: `<m:f><m:fPr><m:type m:val="bar"/></m:fPr><m:num>${parseLatexMath(numerator.value).xml}</m:num><m:den>${parseLatexMath(denominator.value).xml}</m:den></m:f>`,
                    end: index
                };
            }
            if (command === 'sqrt') {
                const radicand = readLatexGroup(source, index);
                index = radicand.end;
                return { xml: `<m:rad><m:radPr/><m:deg/><m:e>${parseLatexMath(radicand.value).xml}</m:e></m:rad>`, end: index };
            }
            return { xml: mathRun(latexCommandToSymbol(command)), end: index };
        }
        if (source[index] === '{') {
            const group = readLatexGroup(source, index);
            index = group.end;
            return { xml: parseLatexMath(group.value).xml, end: index };
        }
        const char = source[index] || '';
        index += 1;
        return { xml: mathRun(char), end: index };
    };
    while (index < source.length) {
        if (stopChar && source[index] === stopChar) break;
        const atom = parseAtom();
        if (atom.xml) parts.push(applyScripts(atom.xml));
    }
    return { xml: parts.join(''), end: index };
}

export function latexToWordMathXml(latex) {
    const cleaned = String(latex || '').trim();
    if (!cleaned) return '';
    const body = parseLatexMath(cleaned).xml || mathRun(cleaned);
    return `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="80" w:after="100"/></w:pPr><m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">${body}</m:oMath></w:p>`;
}

export function wordTable(rows, widths, options = {}) {
    const total = widths.reduce((sum, value) => sum + value, 0);
    const cellMargin = options.cellMargin ?? 100;
    const verticalAlign = options.verticalAlign || 'top';
    const grid = widths.map(width => `<w:gridCol w:w="${width}"/>`).join('');
    const body = rows.map((row, rowIndex) => {
        const rowHeight = row.rowHeight || options.rowHeight || 0;
        const rowProperties = rowHeight
            ? `<w:trPr><w:trHeight w:val="${rowHeight}" w:hRule="exact"/></w:trPr>` : '';
        return `<w:tr>${rowProperties}${row.map((cell, index) => {
            const value = typeof cell === 'object' ? cell : { content: cell };
            const shading = value.shading ? `<w:shd w:val="clear" w:color="auto" w:fill="${value.shading}"/>` : '';
            const cellBorder = options.headerBorder && rowIndex === 0
                ? '<w:tcBorders><w:bottom w:val="single" w:sz="6" w:color="000000"/></w:tcBorders>' : '';
            const span = value.gridSpan > 1 ? `<w:gridSpan w:val="${value.gridSpan}"/>` : '';
            const verticalMerge = value.vMerge ? `<w:vMerge${value.vMerge === 'restart' ? ' w:val="restart"' : ''}/>` : '';
            const individualBorders = value.borders ? `<w:tcBorders>${['top', 'bottom', 'left', 'right'].map(side => {
                const border = value.borders[side];
                const enabled = typeof border === 'object' ? border.enabled : Boolean(border);
                const size = typeof border === 'object' ? border.size || 6 : 6;
                const color = typeof border === 'object' ? border.color || '000000' : '000000';
                return `<w:${side} w:val="${enabled ? 'single' : 'nil'}" w:sz="${size}" w:color="${color}"/>`;
            }).join('')}</w:tcBorders>` : '';
            const width = value.width || widths[index] || widths[0];
            return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${span}${verticalMerge}${shading}${cellBorder}${individualBorders}<w:vAlign w:val="${value.verticalAlign || verticalAlign}"/><w:tcMar><w:top w:w="${cellMargin}" w:type="dxa"/><w:left w:w="${cellMargin}" w:type="dxa"/><w:bottom w:w="${cellMargin}" w:type="dxa"/><w:right w:w="${cellMargin}" w:type="dxa"/></w:tcMar></w:tcPr>${value.content || wordParagraph('', {})}</w:tc>`;
        }).join('')}</w:tr>`;
    }).join('');
    const borderConfig = options.borderConfig;
    const customBorders = borderConfig
        ? `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(name => `<w:${name} w:val="${borderConfig[name] ? 'single' : 'nil'}" w:sz="6" w:color="000000"/>`).join('')}</w:tblBorders>` : '';
    const borders = customBorders || (options.borders === false
        ? `<w:tblBorders><w:top w:val="${options.topBorder ? 'single' : 'nil'}" w:sz="${options.borderSize || 6}" w:color="${options.borderColor || '222222'}"/><w:left w:val="nil"/><w:bottom w:val="${options.bottomBorder ? 'single' : 'nil'}" w:sz="${options.borderSize || 6}" w:color="${options.borderColor || '222222'}"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>`
        : '<w:tblBorders><w:top w:val="single" w:sz="4" w:color="999999"/><w:left w:val="single" w:sz="4" w:color="999999"/><w:bottom w:val="single" w:sz="4" w:color="999999"/><w:right w:val="single" w:sz="4" w:color="999999"/><w:insideH w:val="single" w:sz="4" w:color="999999"/><w:insideV w:val="single" w:sz="4" w:color="999999"/></w:tblBorders>');
    const layout = options.autofit === 'fixed' ? 'fixed' : 'autofit';
    const widthType = options.autofit === 'content' ? 'auto' : 'dxa';
    return `<w:tbl><w:tblPr><w:tblW w:w="${widthType === 'auto' ? 0 : total}" w:type="${widthType}"/><w:tblLayout w:type="${layout}"/>${borders}</w:tblPr><w:tblGrid>${grid}</w:tblGrid>${body}</w:tbl>`;
}

export function quillHtmlToWordXml(html, imageMap = new Map()) {
    const source = document.createElement('div');
    source.innerHTML = html;
    const blocks = [];
    Array.from(source.children).forEach(node => {
        if (node.classList.contains('editor-page-break')) {
            blocks.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
            return;
        }
        const align = node.classList.contains('ql-align-center') ? 'center' :
            node.classList.contains('ql-align-right') ? 'right' :
                node.classList.contains('ql-align-justify') ? 'both' : 'both';
        if (/^H[1-3]$/.test(node.tagName)) {
            const headingLevel = Number(node.tagName.slice(1));
            const headingXml = inlineHtmlToWord(node, {
                bold: true,
                italic: false,
                suppressItalic: true,
                color: '2A4E8A',
                size: 20
            });
            blocks.push(wordParagraph(headingXml, wordParagraphOptions(node, {
                style: `Heading${headingLevel}`, align: 'left', before: 160, after: 80, keepNext: true
            })));
        } else if (['OL', 'UL'].includes(node.tagName)) {
            Array.from(node.children).forEach((item, index) => {
                const marker = node.tagName === 'OL' ? `${index + 1}. ` : '• ';
                blocks.push(wordParagraph(wordRun(marker, { bold: node.tagName === 'OL', size: 20 }) + inlineHtmlToWord(item, { size: 20 }), { align: 'both', after: 60 }));
            });
        } else if (node.classList.contains('scientific-table-embed') && node.querySelector('table')) {
            blocks.push(quillHtmlToWordXml(node.querySelector('table').outerHTML, imageMap));
        } else if (node.classList.contains('math-formula-embed')) {
            const latex = formulaTextFromElement(node);
            blocks.push(latexToWordMathXml(latex));
        } else if (node.tagName === 'TABLE') {
            const htmlRows = Array.from(node.rows);
            const count = Math.max(1, ...htmlRows.map(row =>
                Array.from(row.cells).reduce((sum, cell) => sum + cell.colSpan, 0)));
            const savedCols = Array.from(node.querySelectorAll(':scope > colgroup > col'))
                .map(col => cssTableWidthToTwips(col.style.width || col.getAttribute('width') || ''))
                .filter(Boolean);
            const firstRowWidths = Array.from(htmlRows[0]?.cells || [])
                .flatMap(cell => {
                    const span = Math.max(1, cell.colSpan || 1);
                    const width = cssTableWidthToTwips(cell.style.width || cell.style.minWidth || '');
                    return Array(span).fill(width ? Math.floor(width / span) : 0);
                });
            const rawWidths = Array.from({ length: count }, (_, index) =>
                savedCols[index] || firstRowWidths[index] || 0);
            const widths = normalizeTableWidths(rawWidths, count);
            const matrix = Array.from({ length: htmlRows.length }, () => Array(count).fill(null));
            htmlRows.forEach((row, rowIndex) => {
                let columnIndex = 0;
                Array.from(row.cells).forEach(cell => {
                    while (columnIndex < count && matrix[rowIndex][columnIndex]) columnIndex += 1;
                    const columnSpan = Math.max(1, cell.colSpan);
                    const rowSpan = Math.max(1, cell.rowSpan);
                    const cellStyle = cell.style;
                    const inherited = {
                        bold: cellStyle.fontWeight === 'bold' || Number(cellStyle.fontWeight) >= 600,
                        italic: cellStyle.fontStyle === 'italic',
                        underline: cellStyle.textDecorationLine?.includes('underline') || cellStyle.textDecoration?.includes('underline'),
                        strike: cellStyle.textDecorationLine?.includes('line-through') || cellStyle.textDecoration?.includes('line-through')
                    };
                    const cellFontSize = cssFontSizeToHalfPoints(cellStyle.fontSize || '');
                    if (cellFontSize) inherited.size = cellFontSize;
                    if (cellStyle.fontFamily) inherited.font = cellStyle.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
                    if (cellStyle.color) inherited.color = cssColorToHex(cellStyle.color);
                    const shadingColor = cellStyle.backgroundColor && cellStyle.backgroundColor !== 'transparent'
                        ? cssColorToHex(cellStyle.backgroundColor) : '';
                    const cellAlign = cellStyle.textAlign === 'center' ? 'center' :
                        cellStyle.textAlign === 'right' ? 'right' : 'left';
                    const cellVerticalAlign = cellStyle.verticalAlign === 'middle' ? 'center' :
                        cellStyle.verticalAlign === 'bottom' ? 'bottom' : 'top';
                    const borders = {};
                    ['top', 'bottom', 'left', 'right'].forEach(side => {
                        const borderName = `border${side[0].toUpperCase()}${side.slice(1)}`;
                        const widthValue = cellStyle[`${borderName}Width`];
                        const styleValue = cellStyle[`${borderName}Style`];
                        const size = cssBorderWidthToWordSize(widthValue);
                        borders[side] = {
                            enabled: size > 0 && styleValue !== 'none',
                            size: size || 6,
                            color: cssColorToHex(cellStyle[`${borderName}Color`])
                        };
                    });
                    const borderWith = (source, overrides = {}) => {
                        const next = { ...source };
                        Object.entries(overrides).forEach(([side, enabled]) => {
                            next[side] = { ...(source[side] || {}), enabled };
                        });
                        return next;
                    };
                    matrix[rowIndex][columnIndex] = {
                        content: wordParagraph(inlineHtmlToWord(cell, { ...inherited, size: inherited.size || 20 }), { align: cellAlign, after: 40 }),
                        gridSpan: columnSpan,
                        vMerge: rowSpan > 1 ? 'restart' : '',
                        width: widths.slice(columnIndex, columnIndex + columnSpan).reduce((sum, width) => sum + width, 0),
                        verticalAlign: cellVerticalAlign,
                        shading: shadingColor,
                        borders: rowSpan > 1 ? borderWith(borders, { bottom: false }) : borders
                    };
                    for (let x = 1; x < columnSpan; x += 1) matrix[rowIndex][columnIndex + x] = { skip: true };
                    for (let y = 1; y < rowSpan && rowIndex + y < htmlRows.length; y += 1) {
                        matrix[rowIndex + y][columnIndex] = {
                            content: wordParagraph('', {}), gridSpan: columnSpan, vMerge: 'continue',
                            width: widths.slice(columnIndex, columnIndex + columnSpan).reduce((sum, width) => sum + width, 0),
                            verticalAlign: cellVerticalAlign,
                            shading: shadingColor,
                            borders: borderWith(borders, { top: false, bottom: y === rowSpan - 1 && borders.bottom?.enabled })
                        };
                        for (let x = 1; x < columnSpan; x += 1) matrix[rowIndex + y][columnIndex + x] = { skip: true };
                    }
                    columnIndex += columnSpan;
                });
            });
            const rows = matrix.map((row, rowIndex) => {
                const wordRow = row.map((cell, columnIndex) =>
                    cell || { content: wordParagraph('', {}), width: widths[columnIndex] }
                ).filter(cell => !cell.skip);
                const height = cssLengthToTwips(htmlRows[rowIndex]?.style.height || '');
                if (height) wordRow.rowHeight = height;
                return wordRow;
            });
            const hasCustomBorders = ['top', 'bottom', 'left', 'right', 'insideH', 'insideV', 'header']
                .some(key => key in node.dataset);
            const borderConfig = hasCustomBorders ? {
                top: node.dataset.top === 'true', bottom: node.dataset.bottom === 'true',
                left: node.dataset.left === 'true', right: node.dataset.right === 'true',
                insideH: node.dataset.insideH === 'true', insideV: node.dataset.insideV === 'true'
            } : undefined;
            blocks.push(wordTable(rows, widths, {
                borderConfig,
                headerBorder: node.dataset.header === 'true',
                autofit: 'fixed'
            }));
        } else if (node.tagName === 'IMG' || node.querySelector('img')) {
            const image = node.tagName === 'IMG' ? node : node.querySelector('img');
            const imageInfo = imageMap.get(image.getAttribute('src'));
            blocks.push(imageInfo
                ? wordParagraph(imageDrawingRun(imageInfo.relationshipId, imageInfo.width, imageInfo.height, imageInfo.id), { align: 'center', after: 100 })
                : wordParagraph(wordRun('[Hình ảnh trong nội dung]', { italic: true, color: '666666' }), { align: 'center' }));
        } else {
            blocks.push(wordParagraph(inlineHtmlToWord(stripLeadingIndentWhitespace(node), { size: 20 }), wordParagraphOptions(node, { align, after: 0, line: 260 })));
        }
    });
    return blocks.join('');
}

export function sectionProperties(options = {}) {
    const refs = options.references || '';
    const columns = options.columns === 2 ? '<w:cols w:num="2" w:space="567"/>' : '<w:cols w:num="1"/>';
    const topMargin = options.topMargin || 851;
    const startPage = options.startPage ? `<w:pgNumType w:start="${Math.max(1, parseInt(options.startPage) || 1)}"/>` : '';
    return `<w:sectPr>${refs}${options.titlePage ? '<w:titlePg/>' : ''}<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="${topMargin}" w:right="567" w:bottom="851" w:left="1418" w:header="400" w:footer="400" w:gutter="0"/>${startPage}${columns}${options.nextPage ? '<w:type w:val="nextPage"/>' : ''}</w:sectPr>`;
}

export function pageFieldRun() {
    const props = '<w:rPr><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>';
    return `<w:r>${props}<w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r>` +
        `<w:r>${props}<w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>` +
        `<w:r>${props}<w:fldChar w:fldCharType="separate"/></w:r>` +
        `<w:r>${props}<w:t>1</w:t></w:r>` +
        `<w:r>${props}<w:fldChar w:fldCharType="end"/></w:r>`;
}

export function imageDrawingRun(relationshipId, width = 650000, height = 650000, id = 1) {
    return `<w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${width}" cy="${height}"/><wp:docPr id="${id}" name="JSLHU Image ${id}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="image-${id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}
