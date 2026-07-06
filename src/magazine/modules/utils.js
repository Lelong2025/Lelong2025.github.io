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

export function wordRun(text, options = {}) {
    if (!text) return '';
    const props = [
        options.bold ? '<w:b/>' : '', options.italic ? '<w:i/>' : '',
        options.underline ? '<w:u w:val="single"/>' : '',
        options.color ? `<w:color w:val="${options.color}"/>` : '',
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

export function wordParagraphOptions(node, base = {}) {
    const style = node.style || {};
    const lineHeight = parseFloat(style.lineHeight);
    const classIndent = Array.from(node.classList || []).map(name => name.match(/^ql-indent-(\d+)$/))
        .find(Boolean);
    const toolbarIndent = classIndent ? Number(classIndent[1]) * 567 : 0;
    return {
        ...base,
        firstLine: cssLengthToTwips(style.textIndent),
        left: cssLengthToTwips(style.marginLeft) + toolbarIndent,
        right: cssLengthToTwips(style.marginRight),
        before: style.marginTop ? cssLengthToTwips(style.marginTop) : (base.before || 0),
        after: style.marginBottom ? cssLengthToTwips(style.marginBottom) : (base.after ?? 100),
        line: Number.isFinite(lineHeight) ? Math.round(lineHeight * 240) : (base.line || 260)
    };
}

export function inlineHtmlToWord(node, inherited = {}) {
    if (node.nodeType === Node.TEXT_NODE) return wordRun(node.nodeValue, inherited);
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    if (node.tagName === 'BR') return '<w:r><w:br/></w:r>';
    const next = { ...inherited };
    if (['STRONG', 'B'].includes(node.tagName)) next.bold = true;
    if (['EM', 'I'].includes(node.tagName)) next.italic = true;
    if (node.tagName === 'U') next.underline = true;
    return Array.from(node.childNodes).map(child => inlineHtmlToWord(child, next)).join('');
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
        const individualBorders = value.borders ? `<w:tcBorders>${['top', 'bottom', 'left', 'right'].map(side =>
            `<w:${side} w:val="${value.borders[side] ? 'single' : 'nil'}" w:sz="6" w:color="000000"/>`).join('')}</w:tcBorders>` : '';
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
            blocks.push(wordParagraph(inlineHtmlToWord(node, { bold: true, color: '2A4E8A', size: 20 }), wordParagraphOptions(node, {
                style: `Heading${node.tagName.slice(1)}`, align: 'left', before: 160, after: 80, keepNext: true
            })));
        } else if (['OL', 'UL'].includes(node.tagName)) {
            Array.from(node.children).forEach((item, index) => {
                const marker = node.tagName === 'OL' ? `${index + 1}. ` : '• ';
                blocks.push(wordParagraph(wordRun(marker, { bold: node.tagName === 'OL' }) + inlineHtmlToWord(item), { align: 'both', after: 60 }));
            });
        } else if (node.classList.contains('scientific-table-embed') && node.querySelector('table')) {
            blocks.push(quillHtmlToWordXml(node.querySelector('table').outerHTML, imageMap));
        } else if (node.tagName === 'TABLE') {
            const htmlRows = Array.from(node.rows);
            const count = Math.max(1, ...htmlRows.map(row =>
                Array.from(row.cells).reduce((sum, cell) => sum + cell.colSpan, 0)));
            const savedCols = Array.from(node.querySelectorAll(':scope > colgroup > col'))
                .map(col => cssLengthToTwips(col.style.width || col.getAttribute('width') || ''))
                .filter(Boolean);
            const firstRowWidths = Array.from(htmlRows[0]?.cells || [])
                .flatMap(cell => {
                    const span = Math.max(1, cell.colSpan || 1);
                    const width = cssLengthToTwips(cell.style.width || '');
                    return Array(span).fill(width ? Math.floor(width / span) : 0);
                });
            const widths = Array.from({ length: count }, (_, index) =>
                savedCols[index] || firstRowWidths[index] || Math.floor(4510 / count));
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
                        italic: cellStyle.fontStyle === 'italic'
                    };
                    const cellAlign = cellStyle.textAlign === 'center' ? 'center' :
                        cellStyle.textAlign === 'right' ? 'right' : 'left';
                    const borders = {};
                    ['top', 'bottom', 'left', 'right'].forEach(side => {
                        const widthValue = cellStyle[`border${side[0].toUpperCase()}${side.slice(1)}Width`];
                        borders[side] = parseFloat(widthValue) > 0;
                    });
                    matrix[rowIndex][columnIndex] = {
                        content: wordParagraph(inlineHtmlToWord(cell, inherited), { align: cellAlign, after: 40 }),
                        gridSpan: columnSpan,
                        vMerge: rowSpan > 1 ? 'restart' : '',
                        width: widths.slice(columnIndex, columnIndex + columnSpan).reduce((sum, width) => sum + width, 0),
                        borders
                    };
                    for (let x = 1; x < columnSpan; x += 1) matrix[rowIndex][columnIndex + x] = { skip: true };
                    for (let y = 1; y < rowSpan && rowIndex + y < htmlRows.length; y += 1) {
                        matrix[rowIndex + y][columnIndex] = {
                            content: wordParagraph('', {}), gridSpan: columnSpan, vMerge: 'continue',
                            width: widths.slice(columnIndex, columnIndex + columnSpan).reduce((sum, width) => sum + width, 0),
                            borders
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
                autofit: node.dataset.autofit || 'window'
            }));
        } else if (node.tagName === 'IMG' || node.querySelector(':scope > img')) {
            const image = node.tagName === 'IMG' ? node : node.querySelector(':scope > img');
            const imageInfo = imageMap.get(image.getAttribute('src'));
            blocks.push(imageInfo
                ? wordParagraph(imageDrawingRun(imageInfo.relationshipId, imageInfo.width, imageInfo.height, imageInfo.id), { align: 'center', after: 100 })
                : wordParagraph(wordRun('[Hình ảnh trong nội dung]', { italic: true, color: '666666' }), { align: 'center' }));
        } else {
            blocks.push(wordParagraph(inlineHtmlToWord(node), wordParagraphOptions(node, { align, after: 100, line: 260 })));
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
