function attribute(tag, name) {
    return tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`))?.[2] || '';
}

export function docxFooterParities(documentXml, relationshipsXml, startPage = 1) {
    const relationships = new Map();
    for (const [tag] of relationshipsXml.matchAll(/<Relationship\b[^>]*>/g)) {
        relationships.set(attribute(tag, 'Id'), attribute(tag, 'Target'));
    }
    const parities = new Map();
    for (const [tag] of documentXml.matchAll(/<w:footerReference\b[^>]*>/g)) {
        const target = relationships.get(attribute(tag, 'r:id'));
        if (!target) continue;
        const type = attribute(tag, 'w:type');
        parities.set(target.replace(/^\/?word\//, ''), type === 'even' || (type === 'first' && Number(startPage) % 2 === 0));
    }
    return parities;
}

function containsPageField(xml) {
    return /<w:instrText\b[^>]*>[^<]*\bPAGE\b/i.test(xml) || /<w:fldSimple\b[^>]*\bw:instr\s*=\s*["'][^"']*\bPAGE\b/i.test(xml);
}

function isPageNumberShape(xml) {
    return containsPageField(xml) || (!/<(?:wpg:wgp|v:group)\b/.test(xml) && /<w:t\b[^>]*>\s*\d+\s*<\/w:t>/.test(xml));
}

function reserveDateInset(xml, even, badgeWidth) {
    if (!badgeWidth) return xml;
    const insetName = even ? 'lIns' : 'rIns';
    const minimumInset = badgeWidth + 91440; // badge plus the template's 0.1in padding
    let result = xml.replace(/<wps:bodyPr\b[^>]*>/g, tag => {
        const current = Number(attribute(tag, insetName)) || 0;
        if (current >= minimumInset) return tag;
        const existing = new RegExp(`\\b${insetName}=["'][^"']*["']`);
        return existing.test(tag)
            ? tag.replace(existing, `${insetName}="${minimumInset}"`)
            : tag.replace(/\s*\/?>(?=$)/, end => ` ${insetName}="${minimumInset}"${end}`);
    });
    result = result.replace(/<v:textbox\b[^>]*>/g, tag => {
        const insets = attribute(tag, 'inset').split(',');
        while (insets.length < 4) insets.push('');
        const side = even ? 0 : 2;
        const raw = insets[side].trim();
        const unit = raw.match(/[a-z]+$/i)?.[0] || 'pt';
        const scale = { pt: 12700, in: 914400, cm: 360000, mm: 36000 }[unit] || 12700;
        const existing = raw ? (parseFloat(raw) || 0) * scale : 91440;
        if (existing >= minimumInset) return tag;
        insets[side] = `${Number((minimumInset / 12700).toFixed(4))}pt`;
        return /\binset=/.test(tag)
            ? tag.replace(/\binset=(["']).*?\1/, `inset="${insets.join(',')}"`)
            : tag.replace(/\s*\/?>(?=$)/, end => ` inset="${insets.join(',')}"${end}`);
    });
    return result;
}

export function alignDocxFooterToMargins(xml, even) {
    const anchors = [...xml.matchAll(/<wp:anchor\b[^>]*>[\s\S]*?<\/wp:anchor>/g)].map(match => match[0]);
    const badge = anchors.find(isPageNumberShape);
    const badgeWidth = Number(badge?.match(/<wp:extent\b[^>]*\bcx=["'](\d+)["']/)?.[1]) || 0;
    // Keep the template's artwork and vertical placement, but anchor it to
    // the mirrored text margins rather than absolute paper coordinates.
    let result = xml.replace(/<wp:anchor\b[^>]*>[\s\S]*?<\/wp:anchor>/g, anchor => {
        const alignment = isPageNumberShape(anchor) && !even ? 'right' : 'left';
        const positioned = anchor.replace(/<wp:positionH\b[^>]*>[\s\S]*?<\/wp:positionH>/, `<wp:positionH relativeFrom="margin"><wp:align>${alignment}</wp:align></wp:positionH>`);
        return /<wpg:wgp\b/.test(positioned) ? reserveDateInset(positioned, even, badgeWidth) : positioned;
    });
    // Legacy Word readers use the VML fallback. Change only the outer shape
    // or group; nested artwork keeps its internal coordinate system.
    result = result.replace(/<mc:Fallback\b[^>]*>[\s\S]*?<\/mc:Fallback>/g, fallback => {
        const alignment = isPageNumberShape(fallback) && !even ? 'right' : 'left';
        const positioned = fallback.replace(/<v:(?:group|rect|shape)\b[^>]*>/, tag => tag.replace(/\bstyle=(['"])(.*?)\1/, (_, quote, style) => {
            const rules = style.split(';').filter(rule => !/^\s*(?:margin-left|mso-position-horizontal|mso-position-horizontal-relative)\s*:/i.test(rule));
            rules.push('margin-left:0', `mso-position-horizontal:${alignment}`, 'mso-position-horizontal-relative:margin');
            return `style=${quote}${rules.filter(Boolean).join(';')}${quote}`;
        }));
        return /<v:group\b/.test(positioned) ? reserveDateInset(positioned, even, badgeWidth) : positioned;
    });
    return result;
}

export function alignZipDocxFooters(zip, startPage = 1) {
    const document = zip.file('word/document.xml');
    const relationships = zip.file('word/_rels/document.xml.rels');
    if (!document || !relationships) return;
    for (const [target, even] of docxFooterParities(document.asText(), relationships.asText(), startPage)) {
        const footer = zip.file(`word/${target}`);
        if (footer) zip.file(`word/${target}`, alignDocxFooterToMargins(footer.asText(), even));
    }
}
