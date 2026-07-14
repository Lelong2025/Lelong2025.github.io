import { state, saveToLocalStorage } from './state.js';
import {
    showToast, toTitleCase, removeVietnameseDiacritics,
    quillHtmlToWordXml, wordParagraph, wordRun, wordTable, sectionProperties,
    imageDrawingRun
} from './utils.js';
import {
    activeArticle, footerDateText, headerMetaText, articleIssueYear,
    articleIssueNumber, articlePageRangeText, preparePreviewForOutput, formatKeywords
} from './ui.js';
import { getQuillInstance, getQuillArticleId } from './editor.js';

export function safeExportName(art, extension) {
    const base = (art.titleVn || art.titleEn || 'Ban_thao_bai_bao').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 90);
    return `${base}.${extension}`;
}

export function journalMetaTemplateText(art) {
    return `${articleIssueYear(art)}, ${articleIssueNumber(art)}, ${articlePageRangeText(art)}`;
}

export function currentExportData() {
    const art = activeArticle();
    if (!art) throw new Error('Vui lòng chọn bài báo trước khi xuất.');
    const quill = getQuillInstance();
    const quillArticleId = getQuillArticleId();
    if (quill && quillArticleId === art.id) {
        art.bodyContent = quill.root.innerHTML;
        saveToLocalStorage();
    }
    const contentHtml = art.bodyContent || '';
    const contentHolder = document.createElement('div');
    contentHolder.innerHTML = contentHtml;
    const selectedTitle = art.headerTitle || art.titleVn || art.titleEn;
    return {
        title: art.titleVn || '', title_en: art.titleEn || '',
        headerTitle: art.headerTitle || toTitleCase(selectedTitle || 'TIÊU ĐỀ BÀI BÁO'),
        authors: art.authors || '', authors_en: removeVietnameseDiacritics(art.authors),
        contact: art.email || '', abstract: art.abstractVn || '', abstract_en: art.abstractEn || '',
        keywords: art.keywordsVn || '', keywords_en: art.keywordsEn || '',
        doi: art.doi || '', link_doi: art.linkDoi || '',
        date: footerDateText(art),
        journal_meta: journalMetaTemplateText(art),
        journal_meta_full: headerMetaText(art),
        publishDate: art.datePublished || '',
        startPage: parseInt(art.startPage || 1),
        contentHtml, contentText: contentHolder.textContent.trim(),
        authorProfiles: Array.isArray(art.authorProfiles) ? art.authorProfiles : []
    };
}

export async function prepareContentImages(zip, html) {
    const source = document.createElement('div');
    source.innerHTML = html;
    const map = new Map();
    const relationships = [];
    const images = Array.from(source.querySelectorAll('img'));
    for (let index = 0; index < images.length; index++) {
        const src = images[index].getAttribute('src');
        if (!src || map.has(src)) continue;
        try {
            let extension = 'png';
            let data;
            let options = {};
            const match = src.match(/^data:image\/(png|jpe?g);base64,(.+)$/i);
            if (match) {
                extension = match[1].toLowerCase().replace('jpeg', 'jpg');
                data = match[2];
                options = { base64: true };
            } else {
                const response = await fetch(src);
                if (!response.ok) continue;
                const type = response.headers.get('content-type') || '';
                extension = type.includes('jpeg') ? 'jpg' : 'png';
                data = await response.arrayBuffer();
            }
            const number = map.size + 1;
            const relationshipId = `rIdContentImage${number}`;
            const fileName = `content-${number}.${extension}`;
            zip.file(`word/media/${fileName}`, data, options);
            relationships.push(`<Relationship Id="${relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${fileName}"/>`);
            map.set(src, { relationshipId, width: 2700000, height: 1800000, id: number + 1 });
        } catch (error) {
            console.warn('Không thể nhúng ảnh nội dung:', error);
        }
    }
    return { map, relationships: relationships.join('') };
}

export async function prepareAuthorProfileImages(zip, profiles, prefix = 'author-profile') {
    const map = new Map();
    const relationships = [];
    for (let index = 0; index < profiles.length; index += 1) {
        const src = profiles[index]?.photoUrl;
        if (!src || map.has(src)) continue;
        try {
            let extension = 'png';
            let data;
            let options = {};
            const match = src.match(/^data:image\/(png|jpe?g);base64,(.+)$/i);
            if (match) {
                extension = match[1].toLowerCase().replace('jpeg', 'jpg');
                data = match[2];
                options = { base64: true };
            } else {
                const response = await fetch(src);
                if (!response.ok) continue;
                const type = response.headers.get('content-type') || '';
                extension = type.includes('jpeg') ? 'jpg' : 'png';
                data = await response.arrayBuffer();
            }
            const number = map.size + 1;
            const relationshipId = `rIdAuthorProfileImage${number}`;
            const fileName = `${prefix}-${number}.${extension}`;
            zip.file(`word/media/${fileName}`, data, options);
            relationships.push(`<Relationship Id="${relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${fileName}"/>`);
            map.set(src, { relationshipId, width: 650000, height: 820000, id: 300 + number });
        } catch (error) {
            console.warn('Không thể nhúng ảnh hồ sơ tác giả:', error);
        }
    }
    return { map, relationships: relationships.join('') };
}

export function authorProfilesToWordXml(profiles = [], imageMap = new Map()) {
    if (!profiles.length) return '';
    return profiles.map((profile, index) => {
        const imageInfo = imageMap.get(profile.photoUrl);
        const photo = imageInfo
            ? wordParagraph(imageDrawingRun(imageInfo.relationshipId, imageInfo.width, imageInfo.height, imageInfo.id), { align: 'center', after: 0 })
            : wordParagraph('', { after: 0 });
        const text = wordParagraph(
            wordRun(profile.name || '', { bold: true, size: 16 }) +
            wordRun(profile.info ? ` ${profile.info}` : '', { size: 16 }),
            { after: 20, line: 190 }
        ) +
            (profile.email ? wordParagraph(wordRun('His/Her contact is via: ', { size: 16 }) + wordRun(profile.email, { size: 16, color: '0645AD', underline: true }) + wordRun('.', { size: 16 }), { after: 10, line: 190 }) : '') +
            (profile.orcid ? wordParagraph(wordRun('ORCID: ', { size: 16 }) + wordRun(profile.orcid, { size: 16, color: '0645AD', underline: true }), { after: 0, line: 190 }) : '');
        return wordTable([[photo, text]], [1050, 8588], {
            borders: false,
            cellMargin: 40,
            verticalAlign: 'top',
            rowHeight: 1180
        }) + (index === profiles.length - 1 ? '' : wordParagraph('', { after: 40, line: 100 }));
    }).join('');
}

export function headerXml(text, alignment) {
    const singleLineText = String(text || '').replace(/\s+/g, ' ').trim();
    const paragraph = wordParagraph(wordRun(singleLineText, { italic: true, size: 16 }), {
        align: alignment,
        after: 0,
        line: 190
    });
    const fullWidthHeader = `<w:tbl><w:tblPr><w:tblW w:w="9638" w:type="dxa"/><w:tblInd w:w="0" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="single" w:sz="6" w:space="1" w:color="333333"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="9638"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="9638" w:type="dxa"/><w:noWrap/><w:tcMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="50" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tcMar></w:tcPr>${paragraph}</w:tc></w:tr></w:tbl>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${fullWidthHeader}<w:p/></w:hdr>`;
}

export function footerXml(dateText, even) {
    const pageCell = `<w:tc><w:tcPr><w:tcW w:w="430" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="666666"/><w:vAlign w:val="center"/><w:tcMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tcPr>${wordParagraph(pageFieldRun(), { align: 'center', after: 0, line: 200 })}</w:tc>`;
    const dateCell = `<w:tc><w:tcPr><w:tcW w:w="3500" w:type="dxa"/><w:vAlign w:val="center"/><w:tcMar><w:top w:w="0" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tcPr>${wordParagraph(wordRun(dateText, { italic: true, size: 16 }), { align: even ? 'left' : 'right', after: 0, line: 200 })}</w:tc>`;
    const spacerCell = '<w:tc><w:tcPr><w:tcW w:w="5708" w:type="dxa"/><w:tcMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tcPr><w:p/></w:tc>';
    const cells = even ? pageCell + dateCell + spacerCell : spacerCell + dateCell + pageCell;
    const grid = even
        ? '<w:gridCol w:w="430"/><w:gridCol w:w="3500"/><w:gridCol w:w="5708"/>'
        : '<w:gridCol w:w="5708"/><w:gridCol w:w="3500"/><w:gridCol w:w="430"/>';
    const table = `<w:tbl><w:tblPr><w:tblW w:w="9638" w:type="dxa"/><w:tblInd w:w="0" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders><w:top w:val="single" w:sz="10" w:color="222222"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid}</w:tblGrid><w:tr><w:trPr><w:trHeight w:val="430" w:hRule="exact"/></w:trPr>${cells}</w:tr></w:tbl>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${table}<w:p/></w:hdr>`;
}

export function pageFieldRun() {
    const props = '<w:rPr><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>';
    return `<w:r>${props}<w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r>` +
        `<w:r>${props}<w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>` +
        `<w:r>${props}<w:fldChar w:fldCharType="separate"/></w:r>` +
        `<w:r>${props}<w:t>1</w:t></w:r>` +
        `<w:r>${props}<w:fldChar w:fldCharType="end"/></w:r>`;
}

export function coverXml(data, logoRun = '', headerOnly = false) {
    const journalHeader = wordTable([[
        {
            shading: '91AAC4',
            content: wordParagraph(logoRun, { align: 'center', after: 0, line: 180 })
        },
        wordParagraph(wordRun('JOURNAL OF SCIENCE', { color: '1F4E79', size: 32, font: 'Cambria' }), { left: 120, after: 0, line: 260 }) +
        wordParagraph(wordRun('OF LAC HONG UNIVERSITY', { bold: true, color: '1F4E79', size: 20 }), { left: 120, after: 0, line: 180 }),
        wordParagraph(wordRun('ISSN: 2525 - 2186', { bold: true, color: '1F4E79', size: 20 }), { align: 'right', after: 50, line: 210 }) +
        wordParagraph(wordRun(data.journal_meta_full || 'Tạp chí Khoa học Lạc Hồng, 2025, 20, 001-005', { color: '1F4E79', size: 20 }), { align: 'right', after: 0, line: 190 })
    ]], [705, 3513, 5184], {
        borders: false, bottomBorder: true, borderColor: '1F3864', borderSize: 4,
        cellMargin: 0, verticalAlign: 'center', rowHeight: 709
    });
    if (headerOnly) {
        return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${journalHeader}<w:p/></w:hdr>`;
    }
    const viInfo = wordTable([[
        wordParagraph(wordRun('THÔNG TIN BÀI BÁO', { bold: true, size: 18 }), { align: 'left', bottomBorder: true, after: 70 }) +
        wordParagraph(wordRun('Ngày nhận:\nNgày hoàn thiện:\nNgày chấp nhận:\nNgày đăng: ' + data.publishDate, { size: 20 }), { align: 'left', after: 90, line: 250 }) +
        wordParagraph(wordRun('TỪ KHÓA', { bold: true, size: 20 }), { align: 'left', bottomBorder: true, after: 60 }) +
        wordParagraph(wordRun(formatKeywords(data.keywords, ''), { size: 20 }), { align: 'left', after: 0, line: 250 }),
        wordParagraph(wordRun('TÓM TẮT', { bold: true, size: 20 }), { align: 'left', bottomBorder: true, after: 70 }) +
        wordParagraph(wordRun(data.abstract, { size: 20 }), { align: 'both', after: 0, line: 245 })
    ]], [3100, 6538], { borders: false, topBorder: true });
    const enInfo = wordTable([[
        wordParagraph(wordRun('ARTICLE INFORMATION', { bold: true, size: 18 }), { align: 'left', bottomBorder: true, after: 70 }) +
        wordParagraph(wordRun('Received:\nRevised:\nAccepted:\nPublished: ' + data.publishDate, { size: 20 }), { align: 'left', after: 90, line: 250 }) +
        wordParagraph(wordRun('KEYWORDS', { bold: true, size: 20 }), { align: 'left', bottomBorder: true, after: 60 }) +
        wordParagraph(wordRun(formatKeywords(data.keywords_en, ''), { size: 20 }), { align: 'left', after: 0, line: 250 }),
        wordParagraph(wordRun('ABSTRACT', { bold: true, size: 20 }), { align: 'left', bottomBorder: true, after: 70 }) +
        wordParagraph(wordRun(data.abstract_en, { size: 20 }), { align: 'both', after: 0, line: 245 })
    ]], [3100, 6538], { borders: false, topBorder: true, bottomBorder: true });
    const doiInfo = wordParagraph(wordRun('Doi: ' + (data.doi || ''), { size: 20 }), { align: 'left', after: 0, line: 220 }) +
        wordParagraph(wordRun('Available online at: ' + (data.link_doi || ''), { size: 20 }), { align: 'left', after: 80, line: 220, bottomBorder: true });
    return '' +
        wordParagraph(wordRun(data.title || 'TIÊU ĐỀ BÀI BÁO', { bold: true, color: '2A4E8A', size: 30 }), { align: 'center', before: 160, after: 100 }) +
        wordParagraph(wordRun(data.authors || 'Tác giả', { size: 24 }), { align: 'right', after: 40 }) +
        wordParagraph(wordRun('Trường Đại học Lạc Hồng, Số 10 Huỳnh Văn Nghệ, phường Bửu Long, Biên Hòa, Đồng Nai, Vietnam', { italic: true, size: 20 }), { align: 'right', after: 30 }) +
        wordParagraph(wordRun('*Tác giả liên hệ: ' + data.contact, { size: 20 }), { align: 'right', after: 120 }) + viInfo +
        wordParagraph(wordRun(data.title_en || 'ARTICLE TITLE', { bold: true, color: '2A4E8A', size: 30 }), { align: 'center', before: 160, after: 80 }) +
        wordParagraph(wordRun(data.authors_en || 'Authors', { size: 24 }), { align: 'right', after: 30 }) +
        wordParagraph(wordRun('Lac Hong University, Bien Hoa, Dong Nai Province, Vietnam', { italic: true, size: 20 }), { align: 'right', after: 30 }) +
        wordParagraph(wordRun('*Corresponding Author: ' + data.contact, { size: 20 }), { align: 'right', after: 100 }) + enInfo + doiInfo;
}

export async function buildDefaultDocx(data) {
    if (typeof window.PizZip === 'undefined') {
        throw new Error('Thư viện PizZip chưa được nạp.');
    }
    const zip = new window.PizZip();
    let logoLoaded = false;
    try {
        const logo = document.querySelector('#a4-container img');
        if (logo) {
            if (!logo.complete || !logo.naturalWidth) {
                await new Promise((resolve, reject) => {
                    logo.addEventListener('load', resolve, { once: true });
                    logo.addEventListener('error', reject, { once: true });
                });
            }
            const canvas = document.createElement('canvas');
            canvas.width = logo.naturalWidth;
            canvas.height = logo.naturalHeight;
            const context = canvas.getContext('2d');
            context.drawImage(logo, 0, 0);
            zip.file('word/media/image.png', canvas.toDataURL('image/png').split(',')[1], { base64: true });
            logoLoaded = true;
        }
    } catch (error) {
        console.warn('Không thể đọc đầy đủ logo, sẽ dùng ảnh gốc:', error);
    }
    if (!logoLoaded) {
        try {
            const response = await fetch('/assets/magazine/image.png');
            if (response.ok) {
                zip.file('word/media/image.png', await response.arrayBuffer());
                logoLoaded = true;
            }
        } catch (error) {
            console.warn('Không thể nhúng logo vào DOCX:', error);
        }
    }
    const contentImages = await prepareContentImages(zip, data.contentHtml);
    const authorImages = await prepareAuthorProfileImages(zip, data.authorProfiles);
    const content = quillHtmlToWordXml(data.contentHtml, contentImages.map) + authorProfilesToWordXml(data.authorProfiles, authorImages.map);
    const refs = '<w:headerReference w:type="default" r:id="rIdHeaderOdd"/><w:headerReference w:type="even" r:id="rIdHeaderEven"/><w:footerReference w:type="default" r:id="rIdFooterOdd"/><w:footerReference w:type="even" r:id="rIdFooterEven"/>';
    const coverRefs = '<w:headerReference w:type="first" r:id="rIdHeaderFirst"/><w:footerReference w:type="first" r:id="rIdFooterOdd"/><w:footerReference w:type="default" r:id="rIdFooterOdd"/>';
    const coverSection = `<w:p><w:pPr>${sectionProperties({ columns: 1, nextPage: true, references: coverRefs, titlePage: true, topMargin: 851, startPage: data.startPage || 1 })}</w:pPr></w:p>`;
    const finalSection = sectionProperties({ columns: 2, references: refs });
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${coverXml(data)}${coverSection}${content || wordParagraph(wordRun('Nội dung bài báo bắt đầu từ trang 2.', { italic: true, color: '777777' }), { align: 'center' })}${finalSection}</w:body></w:document>`;
    const relationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://relationships.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/><Relationship Id="rIdHeaderOdd" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header-odd.xml"/><Relationship Id="rIdHeaderEven" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header-even.xml"/><Relationship Id="rIdHeaderFirst" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header-first.xml"/><Relationship Id="rIdFooterOdd" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer-odd.xml"/><Relationship Id="rIdFooterEven" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer-even.xml"/>${logoLoaded ? '<Relationship Id="rIdLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image.png"/>' : ''}${contentImages.relationships}${authorImages.relationships}</Relationships>`;
    const hasImages = logoLoaded || contentImages.map.size > 0 || authorImages.map.size > 0;
    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${hasImages ? '<Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/>' : ''}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/header-odd.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/header-even.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/header-first.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer-odd.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/word/footer-even.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="20"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="260" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr></w:pPrDefault></w:docDefaults>${[1, 2, 3].map(level => `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="160" w:after="80"/></w:pPr><w:rPr><w:b/><w:i w:val="0"/><w:iCs w:val="0"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:color w:val="2A4E8A"/></w:rPr></w:style>`).join('')}<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`;
    zip.file('[Content_Types].xml', contentTypes);
    zip.folder('_rels').file('.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    const word = zip.folder('word');
    word.file('document.xml', documentXml).file('styles.xml', styles)
        .file('settings.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:evenAndOddHeaders/><w:updateFields w:val="true"/><w:compat/></w:settings>')
        .file('header-odd.xml', headerXml(data.authors || 'Tác giả', 'right'))
        .file('header-even.xml', headerXml(data.headerTitle || data.title || data.title_en || 'TIÊU ĐỀ BÀI BÁO', 'left'))
        .file('header-first.xml', coverXml(data, logoLoaded ? imageDrawingRun('rIdLogo', 410000, 406525, 1) : '', true))
        .file('footer-odd.xml', footerXml(data.date, false)).file('footer-even.xml', footerXml(data.date, true));
    word.folder('_rels').file('document.xml.rels', relationships);
    if (logoLoaded) {
        word.folder('_rels').file('header-first.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image.png"/></Relationships>');
    }
    enforceZipDocxFonts(zip);
    return zip;
}

export async function exportCurrentArticleWordManual() {
    if (typeof window.PizZip === 'undefined' || typeof window.saveAs === 'undefined') {
        showToast('Chưa tải được thư viện xuất Word.');
        return false;
    }
    const art = activeArticle();
    if (!art) {
        showToast('Vui lòng chọn bài báo trước khi xuất.');
        return false;
    }
    const button = document.getElementById('export-word-btn');
    const originalLabel = button ? button.innerHTML : 'Word';
    if (button) {
        button.disabled = true;
        button.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Word';
    }
    try {
        const data = currentExportData();
        const zip = await buildDefaultDocx(data);
        const blob = zip.generate({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
        window.saveAs(blob, safeExportName(art, 'docx'));
    } catch (error) {
        console.error(error);
        showToast('Lỗi xuất Word: ' + (error.message || 'Không xác định'));
    } finally {
        if (button) {
            button.disabled = false;
            button.innerHTML = originalLabel;
        }
    }
}

export async function exportCurrentArticleWordFromTemplate() {
    if (typeof window.PizZip === 'undefined' || typeof window.saveAs === 'undefined') {
        showToast('Chưa tải được thư viện xuất Word.');
        return false;
    }
    const art = activeArticle();
    if (!art) {
        showToast('Vui lòng chọn bài báo trước khi xuất.');
        return false;
    }
    const button = document.getElementById('export-word-btn');
    const originalLabel = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Word';

    try {
        const response = await fetch('/assets/magazine/template.docx');
        if (!response.ok) throw new Error('Không thể tải file template.docx');
        const arrayBuffer = await response.arrayBuffer();
        const zip = new window.PizZip(arrayBuffer);

        const data = currentExportData();
        data.title_en = data.title_en || data.title;
        data.authors_vi = data.authors;
        data.authors_en = data.authors_en || removeVietnameseDiacritics(data.authors);

        const contentImages = await prepareContentImages(zip, data.contentHtml);
        const authorImages = await prepareAuthorProfileImages(zip, data.authorProfiles);
        const bodyContentXml = quillHtmlToWordXml(data.contentHtml, contentImages.map);
        const authorProfilesXml = authorProfilesToWordXml(data.authorProfiles, authorImages.map);
        data.content = bodyContentXml + authorProfilesXml;

        if (contentImages.relationships || authorImages.relationships) {
            const relsPath = 'word/_rels/document.xml.rels';
            const relsFile = zip.file(relsPath);
            if (!relsFile) throw new Error('Template thiếu document.xml.rels để liên kết ảnh nội dung.');
            const relsXml = relsFile.asText().replace(
                '</Relationships>',
                `${contentImages.relationships}${authorImages.relationships}</Relationships>`
            );
            zip.file(relsPath, relsXml);

            const contentTypesPath = '[Content_Types].xml';
            let contentTypesXml = zip.file(contentTypesPath).asText();
            if (contentImages.relationships || authorImages.relationships) {
                const defaults = [];
                if (!contentTypesXml.includes('Extension="jpg"')) defaults.push('<Default Extension="jpg" ContentType="image/jpeg"/>');
                if (!contentTypesXml.includes('Extension="png"')) defaults.push('<Default Extension="png" ContentType="image/png"/>');
                if (defaults.length) {
                    contentTypesXml = contentTypesXml.replace('</Types>', `${defaults.join('')}</Types>`);
                }
            }
            zip.file(contentTypesPath, contentTypesXml);
        }

        let docXml = zip.file('word/document.xml').asText();
        docXml = normalizeAndReplaceDocxXml(docXml, data);
        zip.file('word/document.xml', docXml);

        const headerNames = ['word/header1.xml', 'word/header2.xml', 'word/header3.xml', 'word/header4.xml', 'word/header5.xml', 'word/header6.xml'];
        headerNames.forEach(name => {
            const file = zip.file(name);
            if (file) {
                let hxml = file.asText();
                hxml = normalizeAndReplaceDocxXml(hxml, {
                    ...data,
                    title: data.headerTitle || data.title || data.title_en
                });
                zip.file(name, hxml);
            }
        });

        const footerNames = Object.keys(zip.files || {}).filter(name => /^word\/footer[^/]*\.xml$/i.test(name));
        footerNames.forEach(name => {
            const file = zip.file(name);
            if (file) {
                let fxml = file.asText();
                fxml = replaceFooterDatePlaceholdersXml(fxml, data.date);
                zip.file(name, fxml);
            }
        });

        enforceZipDocxFonts(zip);
        const blob = zip.generate({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
        window.saveAs(blob, safeExportName(art, 'docx'));
        showToast("Đã tải tệp Word từ template thành công!");
        return true;
    } catch (error) {
        console.error(error);
        showToast('Lỗi xuất Word từ template: ' + (error.message || 'Không xác định'));
        return false;
    } finally {
        button.disabled = false;
        button.innerHTML = originalLabel;
    }
}

export async function exportCurrentArticleWord() {
    try {
        return await exportCurrentArticleWordFromTemplate();
    } catch (err) {
        console.warn('Template export failed, falling back to manual OOXML generation:', err);
        await exportCurrentArticleWordManual();
        return true;
    }
}

export function enforceDocxRunFonts(xml) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'application/xml');
    const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

    const setRunFont = (run, fontName) => {
        let runProperties = Array.from(run.childNodes).find(node => node.nodeName === 'w:rPr');
        if (!runProperties) {
            runProperties = doc.createElementNS(WORD_NS, 'w:rPr');
            run.insertBefore(runProperties, run.firstChild);
        }
        let fonts = Array.from(runProperties.childNodes).find(node => node.nodeName === 'w:rFonts');
        if (!fonts) {
            fonts = doc.createElementNS(WORD_NS, 'w:rFonts');
            runProperties.insertBefore(fonts, runProperties.firstChild);
        }
        ['ascii', 'hAnsi', 'eastAsia', 'cs'].forEach(key => {
            fonts.setAttribute(`w:${key}`, fontName);
        });
    };

    Array.from(doc.getElementsByTagName('w:p')).forEach(paragraph => {
        const paragraphText = Array.from(paragraph.getElementsByTagName('w:t'))
            .map(node => node.textContent)
            .join('');
        const fontName = paragraphText.trim() === 'JOURNAL OF SCIENCE'
            ? 'Cambria'
            : 'Times New Roman';
        Array.from(paragraph.getElementsByTagName('w:r')).forEach(run => setRunFont(run, fontName));
    });

    return new XMLSerializer().serializeToString(doc);
}

export function enforceZipDocxFonts(zip) {
    Object.keys(zip.files || {}).forEach(path => {
        if (!/^word\/(?:document|header[^/]*|footer[^/]*)\.xml$/i.test(path)) return;
        const file = zip.file(path);
        if (!file) return;
        zip.file(path, enforceDocxRunFonts(file.asText()));
    });
}

function escapeXmlText(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
    }[char]));
}

export function replaceFooterDatePlaceholdersXml(xml, dateText) {
    let used = false;
    const escapedDate = escapeXmlText(dateText);
    return String(xml || '').replace(/\{date\}/g, () => {
        if (used) return '';
        used = true;
        return escapedDate;
    });
}

export function normalizeAndReplaceDocxXml(xml, data, options = {}) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'application/xml');
    const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

    const replaceInlineJournalMeta = () => {
        const allTextNodes = Array.from(doc.getElementsByTagName('w:t'));
        const normalizeText = value => String(value || '').replace(/\s+/g, ' ').trim();

        Array.from(doc.getElementsByTagName('w:p')).forEach(paragraph => {
            const textNodes = Array.from(paragraph.getElementsByTagName('w:t'));
            const paragraphText = textNodes.map(node => node.textContent).join('');
            if (!paragraphText.includes('journal_meta')) return;
            if (!/Tạp\s*chí\s*Khoa\s*học\s*Lạc\s*Hồng/i.test(normalizeText(paragraphText))) return;
            const fullMeta = data.journal_meta_full || (data.journal_meta ? `Tạp chí Khoa học Lạc Hồng, ${data.journal_meta}` : '');
            const startIndex = textNodes.findIndex(node => /Tạp/i.test(node.textContent));
            textNodes.forEach((node, index) => {
                if (index < startIndex) return;
                node.textContent = index === startIndex ? fullMeta : '';
            });
        });

        allTextNodes.forEach(node => {
            if (node.textContent.includes('{journal_meta}')) {
                node.textContent = node.textContent.replaceAll('{journal_meta}', data.journal_meta || '');
            }
        });
        for (let index = 0; index < allTextNodes.length - 2; index += 1) {
            const open = allTextNodes[index];
            const name = allTextNodes[index + 1];
            const close = allTextNodes[index + 2];
            if (open.textContent === '{' && name.textContent === 'journal_meta' && close.textContent === '}') {
                open.textContent = '';
                name.textContent = data.journal_meta || '';
                close.textContent = '';
            }
        }
    };

    const setRunTextWithBreaks = (textNode, value) => {
        const run = textNode?.parentNode;
        if (!run) return;
        Array.from(run.childNodes).forEach(child => {
            if (child.nodeName !== 'w:rPr') child.remove();
        });
        String(value ?? '').split('\n').forEach((part, index) => {
            if (index) run.appendChild(doc.createElementNS(WORD_NS, 'w:br'));
            const text = doc.createElementNS(WORD_NS, 'w:t');
            text.setAttribute('xml:space', 'preserve');
            text.textContent = part;
            run.appendChild(text);
        });
    };

    replaceInlineJournalMeta();

    const placeholders = [
        'title', 'headerTitle', 'title_en', 'authors_vi', 'authors_en', 'authors',
        'contact', 'abstract', 'abstract_en', 'keywords', 'keywords_en', 'doi', 'link_doi', 'date', 'content'
    ];
    let dateReplacementUsed = false;

    const paragraphs = doc.getElementsByTagName('w:p');
    for (let p of paragraphs) {
        const tNodes = [];
        const rNodes = p.getElementsByTagName('w:r');
        for (let r of rNodes) {
            const ts = r.getElementsByTagName('w:t');
            for (let t of ts) {
                tNodes.push(t);
            }
        }

        if (tNodes.length === 0) continue;

        let fullText = tNodes.map(node => node.textContent).join('');

        let hasPlaceholder = placeholders.some(ph => fullText.includes(`{${ph}}`));
        if (!hasPlaceholder) continue;

        if (fullText.includes('{content}')) {
            p.setAttribute('replace-with-content', 'true');
            continue;
        }

        placeholders.forEach(ph => {
            const key = `{${ph}}`;
            if (fullText.includes(key)) {
                let val = '';
                if (ph === 'title') val = data.title;
                else if (ph === 'headerTitle') val = data.headerTitle || data.title || data.title_en;
                else if (ph === 'title_en') val = data.title_en || data.title;
                else if (ph === 'authors_vi') val = data.authors;
                else if (ph === 'authors_en') val = data.authors_en;
                else if (ph === 'authors') val = data.authors;
                else if (ph === 'contact') val = data.contact;
                else if (ph === 'abstract') val = data.abstract;
                else if (ph === 'abstract_en') val = data.abstract_en;
                else if (ph === 'keywords') val = formatKeywords(data.keywords, '');
                else if (ph === 'keywords_en') val = formatKeywords(data.keywords_en, '');
                else if (ph === 'doi') val = data.doi;
                else if (ph === 'link_doi') val = data.link_doi;
                else if (ph === 'date') {
                    val = data.date;
                    if (options.singleDatePlaceholder) {
                        val = dateReplacementUsed ? '' : data.date;
                        dateReplacementUsed = true;
                    }
                }

                fullText = fullText.replaceAll(key, val);
            }
        });

        setRunTextWithBreaks(tNodes[0], fullText);
        for (let i = 1; i < tNodes.length; i++) {
            tNodes[i].textContent = '';
        }
    }

    const sectPrs = doc.getElementsByTagName('w:sectPr');
    for (let i = 0; i < sectPrs.length; i++) {
        const sectPr = sectPrs[i];
        let pgNumType = sectPr.getElementsByTagName('w:pgNumType')[0];
        if (i === 0) {
            if (!pgNumType) {
                pgNumType = doc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:pgNumType');
                sectPr.appendChild(pgNumType);
            }
            pgNumType.setAttribute('w:start', data.startPage || 1);
        } else {
            if (pgNumType) {
                pgNumType.removeAttribute('w:start');
            }
        }
    }

    // The source template can contain a manual page break immediately before
    // a section paragraph that changes columns. Word applies both transitions,
    // producing an empty page between metadata and the article body.
    Array.from(doc.getElementsByTagName('w:br')).forEach(br => {
        if ((br.getAttribute('w:type') || br.getAttribute('type')) !== 'page') return;
        let breakParagraph = br.parentNode;
        while (breakParagraph && breakParagraph.nodeName !== 'w:p') breakParagraph = breakParagraph.parentNode;
        const nextParagraph = breakParagraph?.nextElementSibling;
        if (nextParagraph?.getElementsByTagName('w:sectPr').length) breakParagraph.remove();
    });

    const serializer = new XMLSerializer();
    let resultXml = serializer.serializeToString(doc);

    if (data.content !== undefined) {
        const contentToInject = data.content;
        resultXml = resultXml.replace(/<w:p[^>]*replace-with-content="true"[^>]*>[\s\S]*?<\/w:p>/, () => contentToInject);
    }

    return enforceDocxRunFonts(resultXml);
}

export async function exportVectorPdf() {
    const button = document.getElementById('export-pdf-btn');
    if (!button) return false;
    const original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> PDF';
    try {
        await preparePreviewForOutput();
        document.body.classList.add('pdf-output-mode');
        window.print();
        return true;
    } catch (error) {
        console.error(error);
        showToast('Lỗi chuẩn bị PDF: ' + (error.message || 'Không xác định'));
        return false;
    } finally {
        document.body.classList.remove('pdf-output-mode');
        button.disabled = false;
        button.innerHTML = original;
    }
}

export function exportIssue() {
    const currentIssue = state.appState.issues[state.appState.currentIssueId];
    if (!currentIssue) return;

    const modal = document.getElementById('export-modal');
    const listContainer = document.getElementById('export-list-content');
    if (!modal || !listContainer) return;
    listContainer.innerHTML = '';

    if (currentIssue.articles.length === 0) {
        listContainer.innerHTML = `<div class="p-4 text-center text-slate-400">Không có dữ liệu bài viết để xuất bản.</div>`;
    } else {
        currentIssue.articles.forEach((art, index) => {
            const formatPage = (num) => String(num).padStart(3, '0');
            const row = document.createElement('div');
            row.className = "p-3 flex justify-between items-center hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors";
            row.innerHTML = `
                <div class="flex-1 min-w-0 pr-4 text-xs">
                    <span class="text-[9px] font-bold text-blue-600 dark:text-blue-400">BÀI ${index + 1} (${art.pageCount} TRANG)</span>
                    <h5 class="font-bold text-slate-700 dark:text-slate-200 truncate mt-0.5">${art.titleVn}</h5>
                    <p class="text-[9px] text-slate-500 dark:text-slate-400 truncate">${art.authors}</p>
                </div>
                <div class="text-right shrink-0">
                    <span class="text-xs font-mono font-bold bg-slate-100 dark:bg-slate-700 px-2 py-1 rounded text-slate-600 dark:text-slate-300">
                        Trang ${formatPage(art.startPage)} - ${formatPage(art.endPage)}
                    </span>
                </div>
            `;
            listContainer.appendChild(row);
        });
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

export function closeExportModal() {
    const modal = document.getElementById('export-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

export function exportJSON() {
    const currentIssue = state.appState.issues[state.appState.currentIssueId];
    if (!currentIssue) return;
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentIssue, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `${state.appState.currentIssueId}_export_data.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showToast("Đã tải tệp cấu hình xuất bản JSON!");
}

export function getArticleExportData(art) {
    const contentHtml = art.bodyContent || '';
    const contentHolder = document.createElement('div');
    contentHolder.innerHTML = contentHtml;
    const selectedTitle = art.headerTitle || art.titleVn || art.titleEn;
    return {
        title: art.titleVn || '', title_en: art.titleEn || '',
        headerTitle: art.headerTitle || toTitleCase(selectedTitle || 'TIÊU ĐỀ BÀI BÁO'),
        authors: art.authors || '', authors_en: removeVietnameseDiacritics(art.authors),
        contact: art.email || '', abstract: art.abstractVn || '', abstract_en: art.abstractEn || '',
        keywords: art.keywordsVn || '', keywords_en: art.keywordsEn || '',
        doi: art.doi || '', link_doi: art.linkDoi || '',
        date: footerDateText(art),
        journal_meta: journalMetaTemplateText(art),
        journal_meta_full: headerMetaText(art),
        publishDate: art.datePublished || '',
        startPage: parseInt(art.startPage || 1),
        contentHtml, contentText: contentHolder.textContent.trim(),
        authorProfiles: Array.isArray(art.authorProfiles) ? art.authorProfiles : []
    };
}

export async function prepareAllContentImages(zip, articles) {
    const map = new Map();
    const relationshipsByArticle = [];
    let imageCounter = 0;

    for (let i = 0; i < articles.length; i++) {
        const art = articles[i];
        const html = art.bodyContent || '';
        const source = document.createElement('div');
        source.innerHTML = html;
        const articleMap = new Map();
        const rels = [];
        const images = Array.from(source.querySelectorAll('img'));

        for (let index = 0; index < images.length; index++) {
            const src = images[index].getAttribute('src');
            if (!src) continue;

            if (articleMap.has(src)) continue;

            try {
                let extension = 'png';
                let data;
                let options = {};
                const match = src.match(/^data:image\/(png|jpe?g);base64,(.+)$/i);
                if (match) {
                    extension = match[1].toLowerCase().replace('jpeg', 'jpg');
                    data = match[2];
                    options = { base64: true };
                } else {
                    const response = await fetch(src);
                    if (!response.ok) continue;
                    const type = response.headers.get('content-type') || '';
                    extension = type.includes('jpeg') ? 'jpg' : 'png';
                    data = await response.arrayBuffer();
                }

                imageCounter++;
                const relationshipId = `rIdContentImage${imageCounter}`;
                const fileName = `content-${imageCounter}.${extension}`;

                zip.file(`word/media/${fileName}`, data, options);
                rels.push(`<Relationship Id="${relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${fileName}"/>`);

                articleMap.set(src, { relationshipId, width: 2700000, height: 1800000, id: imageCounter + 1 });
            } catch (error) {
                console.warn('Không thể nhúng ảnh:', error);
            }
        }
        relationshipsByArticle.push({ map: articleMap, relsXml: rels.join('') });
    }

    return relationshipsByArticle;
}

export async function exportIssueWord() {
    if (typeof window.PizZip === 'undefined' || typeof window.saveAs === 'undefined') {
        showToast('Chưa tải được thư viện xuất Word.');
        return false;
    }
    const currentIssue = state.appState.issues[state.appState.currentIssueId];
    if (!currentIssue || currentIssue.articles.length === 0) {
        showToast('Không có bài báo nào để xuất.');
        return false;
    }
    const button = document.getElementById('btn-export-issue-word');
    const originalLabel = button ? button.innerHTML : '';
    if (button) {
        button.disabled = true;
        button.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Đang xuất...';
    }

    try {
        const response = await fetch('/assets/magazine/template.docx');
        if (!response.ok) throw new Error('Không thể tải file template.docx');
        const templateBytes = await response.arrayBuffer();

        const baseZip = new window.PizZip(templateBytes);
        const articles = currentIssue.articles;

        const relationshipsByArticle = await prepareAllContentImages(baseZip, articles);

        const templateRelsXml = baseZip.file('word/_rels/document.xml.rels').asText();
        const parser = new DOMParser();
        const relsDoc = parser.parseFromString(templateRelsXml, 'application/xml');
        const templateRels = Array.from(relsDoc.getElementsByTagName('Relationship')).map(r => ({
            id: r.getAttribute('Id'),
            type: r.getAttribute('Type'),
            target: r.getAttribute('Target')
        }));

        const mergedRels = [];
        const contentTypesOverrides = [];
        templateRels.forEach(rel => {
            if (!rel.target.includes('header') && !rel.target.includes('footer') && !rel.target.includes('media/')) {
                mergedRels.push(`<Relationship Id="${rel.id}" Type="${rel.type}" Target="${rel.target}"/>`);
            }
        });
        relationshipsByArticle.forEach(item => { if (item.relsXml) mergedRels.push(item.relsXml); });

        contentTypesOverrides.push(`<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>`);
        contentTypesOverrides.push(`<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>`);
        contentTypesOverrides.push(`<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>`);

        const mergedBodyParts = [];
        let lastSectPrXml = '';

        for (let i = 0; i < articles.length; i++) {
            const art = articles[i];
            const data = getArticleExportData(art);
            data.title_en = data.title_en || data.title;
            data.authors_vi = data.authors;
            data.authors_en = data.authors_en || removeVietnameseDiacritics(data.authors);
            data.content = quillHtmlToWordXml(data.contentHtml, relationshipsByArticle[i].map);

            const localRelMap = new Map();
            templateRels.forEach(rel => {
                if (rel.target.includes('header') || rel.target.includes('footer') || rel.target.includes('media/')) {
                    const uniqueId = `${rel.id}_art_${i}`;
                    const newFilename = rel.target.replace(/^(.*?)(\.[^.]+)$/, `$1_art_${i}$2`);
                    localRelMap.set(rel.id, { uniqueId, newFilename, type: rel.type, originalFilename: rel.target });
                }
            });

            const artZip = new window.PizZip(templateBytes);
            let artDocXml = artZip.file('word/document.xml').asText();
            artDocXml = normalizeAndReplaceDocxXml(artDocXml, data);

            localRelMap.forEach((info, oldId) => {
                artDocXml = artDocXml.replace(new RegExp(`r:id="${oldId}"`, 'g'), `r:id="${info.uniqueId}"`);
                artDocXml = artDocXml.replace(new RegExp(`r:embed="${oldId}"`, 'g'), `r:embed="${info.uniqueId}"`);
            });

            const idOffset = (i + 1) * 10000;
            artDocXml = artDocXml.replace(/<w:bookmarkStart\s+([^>]*w:id="(\d+)"[^>]*w:name="([^"]+)"[^>]*|[^>]*w:name="([^"]+)"[^>]*w:id="(\d+)"[^>]*)\/>/g, (match) => {
                const idMatch = match.match(/w:id="(\d+)"/);
                const nameMatch = match.match(/w:name="([^"]+)"/);
                if (idMatch && nameMatch) {
                    const newId = parseInt(idMatch[1]) + idOffset;
                    const newName = `${nameMatch[1]}_art_${i}`;
                    return match.replace(/w:id="\d+"/, `w:id="${newId}"`).replace(/w:name="[^"]+"/, `w:name="${newName}"`);
                }
                return match;
            });
            artDocXml = artDocXml.replace(/<w:bookmarkEnd\s+[^>]*w:id="(\d+)"[^>]*\/>/g, (match, idVal) => {
                const newId = parseInt(idVal) + idOffset;
                return match.replace(/w:id="\d+"/, `w:id="${newId}"`);
            });

            artDocXml = artDocXml.replace(/<wp:docPr\s+[^>]*id="(\d+)"[^>]*>/g, (match, idVal) => {
                const newId = parseInt(idVal) + idOffset;
                return match.replace(/id="\d+"/, `id="${newId}"`);
            });

            if (i > 0) {
                let firstSectPrHandled = false;
                artDocXml = artDocXml.replace(/<w:sectPr\b[^>]*>[\s\S]*?<\/w:sectPr>/, (block) => {
                    if (firstSectPrHandled) return block;
                    firstSectPrHandled = true;
                    if (/<w:type[^/]*\/>/.test(block)) {
                        block = block.replace(/<w:type[^/]*\/>/, '<w:type w:val="nextPage"/>');
                    } else {
                        block = block.replace('</w:sectPr>', '<w:type w:val="nextPage"/></w:sectPr>');
                    }
                    block = block.replace(/<w:pgNumType\b[^/]*\/>/, '<w:pgNumType/>');
                    return block;
                });
            }

            const bodyMatch = artDocXml.match(/<w:body>([\s\S]*)<\/w:body>/);
            if (!bodyMatch) throw new Error(`Bài ${i + 1}: Không tìm thấy w:body trong template`);
            const bodyContent = bodyMatch[1];

            let sectPrMatch = null;
            const lastPEnd = bodyContent.lastIndexOf('</w:p>');
            if (lastPEnd !== -1) {
                const tail = bodyContent.slice(lastPEnd + '</w:p>'.length);
                const trailingSectPr = tail.match(/^\s*(<w:sectPr[\s\S]*<\/w:sectPr>)\s*$/);
                if (trailingSectPr) {
                    sectPrMatch = [null, bodyContent.slice(0, lastPEnd + '</w:p>'.length), trailingSectPr[1]];
                }
            }
            if (!sectPrMatch) {
                sectPrMatch = bodyContent.match(/^\s*(<w:sectPr[\s\S]*<\/w:sectPr>)\s*$/) ? [null, '', bodyContent.trim()] : null;
            }
            if (sectPrMatch) {
                const contentWithoutSectPr = sectPrMatch[1];
                const sectPrXml = sectPrMatch[2];

                if (i < articles.length - 1) {
                    mergedBodyParts.push(contentWithoutSectPr);
                    mergedBodyParts.push(`<w:p><w:pPr>${sectPrXml}</w:pPr></w:p>`);
                } else {
                    mergedBodyParts.push(contentWithoutSectPr);
                    lastSectPrXml = sectPrXml;
                }
            } else {
                mergedBodyParts.push(bodyContent);
            }

            for (const [oldId, info] of localRelMap) {
                if (info.originalFilename.includes('media/')) {
                    const mediaFile = baseZip.file(`word/${info.originalFilename}`);
                    if (mediaFile) baseZip.file(`word/${info.newFilename}`, mediaFile.asArrayBuffer());
                } else {
                    const xmlFile = baseZip.file(`word/${info.originalFilename}`);
                    if (xmlFile) {
                        let fileXml = xmlFile.asText();
                        const partData = info.originalFilename.includes('header')
                            ? { ...data, title: data.headerTitle || data.title || data.title_en }
                            : data;
                        fileXml = info.originalFilename.includes('footer')
                            ? replaceFooterDatePlaceholdersXml(fileXml, data.date)
                            : normalizeAndReplaceDocxXml(fileXml, partData);
                        localRelMap.forEach((mInfo, mOldId) => {
                            fileXml = fileXml.replace(new RegExp(`r:id="${mOldId}"`, 'g'), `r:id="${mInfo.uniqueId}"`);
                            fileXml = fileXml.replace(new RegExp(`r:embed="${mOldId}"`, 'g'), `r:embed="${mInfo.uniqueId}"`);
                        });
                        baseZip.file(`word/${info.newFilename}`, fileXml);

                        const origRelsPath = `word/_rels/${info.originalFilename}.rels`;
                        const relsFile = baseZip.file(origRelsPath);
                        if (relsFile) {
                            let relsXml = relsFile.asText();
                            localRelMap.forEach((mInfo, mOldId) => {
                                relsXml = relsXml.replace(new RegExp(`Id="${mOldId}"`, 'g'), `Id="${mInfo.uniqueId}"`);
                                const targetBase = mInfo.originalFilename.split('/').pop();
                                const newTargetBase = mInfo.newFilename.split('/').pop();
                                relsXml = relsXml.replace(new RegExp(`Target="media/${targetBase}"`, 'g'), `Target="media/${newTargetBase}"`);
                            });
                            const newRelsPath = `word/_rels/${info.newFilename.split('/').pop()}.rels`;
                            baseZip.file(newRelsPath, relsXml);
                        }
                    }
                }
                mergedRels.push(`<Relationship Id="${info.uniqueId}" Type="${info.type}" Target="${info.newFilename}"/>`);
                if (!info.originalFilename.includes('media/')) {
                    const ct = info.originalFilename.includes('header')
                        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml'
                        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml';
                    contentTypesOverrides.push(`<Override PartName="/word/${info.newFilename}" ContentType="${ct}"/>`);
                }
            }
        }

        const templateDocXml = baseZip.file('word/document.xml').asText();
        const mergedBodyContent = mergedBodyParts.join('');
        const bodyReplacement = `<w:body>${mergedBodyContent}${lastSectPrXml}</w:body>`;
        const finalDocXml = templateDocXml.replace(/<w:body>[\s\S]*<\/w:body>/, () => bodyReplacement);
        baseZip.file('word/document.xml', finalDocXml);

        const finalRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${mergedRels.join('')}</Relationships>`;
        baseZip.file('word/_rels/document.xml.rels', finalRelsXml);

        let origContentTypes = baseZip.file('[Content_Types].xml').asText();
        origContentTypes = origContentTypes.replace(/<Override PartName="\/word\/(header|footer)[^"]*"[^>]*\/>/g, '');
        const newCtEntries = contentTypesOverrides.filter(e => e.includes('header') || e.includes('footer')).join('');
        let imageCount = 0;
        relationshipsByArticle.forEach(item => { imageCount += item.map.size; });
        const jpgDefault = imageCount > 0 && !origContentTypes.includes('Extension="jpg"')
            ? '<Default Extension="jpg" ContentType="image/jpeg"/>' : '';
        origContentTypes = origContentTypes.replace('</Types>', `${jpgDefault}${newCtEntries}</Types>`);
        baseZip.file('[Content_Types].xml', origContentTypes);

        templateRels.forEach(rel => {
            if (rel.target.includes('header') || rel.target.includes('footer')) {
                try { baseZip.remove(`word/${rel.target}`); } catch (_) { }
            }
        });

        enforceZipDocxFonts(baseZip);
        const blob = baseZip.generate({
            type: 'blob',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            compression: 'DEFLATE'
        });
        const baseName = currentIssue.title.replace(/[\\/:*?"<>|]+/g, '_');
        window.saveAs(blob, `${baseName}_Full_Issue.docx`);
        showToast('Đã tải tệp Word toàn bộ số báo thành công!');
        closeExportModal();
        return true;
    } catch (error) {
        console.error(error);
        showToast('Lỗi xuất Word toàn bộ số báo: ' + (error.message || 'Không xác định'));
        return false;
    } finally {
        if (button) {
            button.disabled = false;
            button.innerHTML = originalLabel;
        }
    }
}
