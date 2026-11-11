// Word uses these as inside/outside margins when mirrorMargins is enabled.
// Keep the existing page numbering: Word swaps the margins on even pages,
// including an article whose first numbered page is even.
const INNER_MARGIN_TWIPS = 1418;
const OUTER_MARGIN_TWIPS = 567;

function setMarginAttribute(tag, name, value) {
    const attribute = new RegExp(`\\bw:${name}\\s*=\\s*(["'])[^"']*\\1`);
    return attribute.test(tag)
        ? tag.replace(attribute, `w:${name}="${value}"`)
        : tag.replace(/\s*\/?>(?:<\/w:pgMar>)?$/, ending => ` w:${name}="${value}"${ending}`);
}

export function mirrorDocxSectionMargins(xml) {
    return xml.replace(/<w:sectPr\b[^>]*>[\s\S]*?<\/w:sectPr>/g, section => {
        const normalize = tag => {
            tag = setMarginAttribute(tag, 'left', INNER_MARGIN_TWIPS);
            tag = setMarginAttribute(tag, 'right', OUTER_MARGIN_TWIPS);
            return setMarginAttribute(tag, 'gutter', 0);
        };
        if (/<w:pgMar\b/.test(section)) {
            return section.replace(/<w:pgMar\b[^>]*\/?>(?:<\/w:pgMar>)?/g, normalize);
        }
        // Existing exports always define pgMar. Supply the same vertical
        // defaults as the manual exporter if a future template omits it.
        const margins = normalize('<w:pgMar w:top="851" w:bottom="851" w:header="400" w:footer="400"/>');
        if (/<w:pgSz\b/.test(section)) {
            return section.replace(/<w:pgSz\b[^>]*\/?>(?:<\/w:pgSz>)?/, tag => tag + margins);
        }
        const followingProperty = /<w:(?:pgBorders|lnNumType|pgNumType|cols|formProt|vAlign|noEndnote|titlePg|textDirection|bidi|rtlGutter|docGrid|printerSettings|sectPrChange)\b/;
        return followingProperty.test(section)
            ? section.replace(followingProperty, match => margins + match)
            : section.replace('</w:sectPr>', margins + '</w:sectPr>');
    });
}

export function enableDocxMirrorMargins(xml) {
    // Replace disabled or duplicate settings too, without changing any other
    // settings or namespace declarations from the journal template.
    const settings = xml.replace(/<w:mirrorMargins\b[^>]*\/?>(?:<\/w:mirrorMargins>)?/g, '');
    // These are the settings which precede mirrorMargins in CT_Settings.
    const preceding = 'writeProtection|view|zoom|removePersonalInformation|removeDateAndTime|doNotDisplayPageBoundaries|displayBackgroundShape|printPostScriptOverText|printFractionalCharacterWidth|printFormsData|embedTrueTypeFonts|embedSystemFonts|saveSubsetFonts|saveFormsData';
    const insertion = new RegExp(`(<w:settings\\b[^>]*>)(\\s*(?:<w:(?:${preceding})\\b[^>]*\\/>\\s*)*)`);
    return settings.replace(insertion, '$1$2<w:mirrorMargins/>');
}

export function enforceZipDocxMirrorMargins(zip) {
    const document = zip.file('word/document.xml');
    const settings = zip.file('word/settings.xml');
    if (!document || !settings) throw new Error('DOCX thiếu cấu hình trang hoặc tài liệu.');
    zip.file('word/document.xml', mirrorDocxSectionMargins(document.asText()));
    zip.file('word/settings.xml', enableDocxMirrorMargins(settings.asText()));
}
