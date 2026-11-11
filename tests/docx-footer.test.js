import test from 'node:test';
import assert from 'node:assert/strict';
import { alignDocxFooterToMargins, docxFooterParities, alignZipDocxFooters } from '../src/magazine/modules/docx-footer.js';

const anchor = (content, x = 7202170) => `<wp:anchor><wp:positionH relativeFrom="page"><wp:posOffset>${x}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>10200005</wp:posOffset></wp:positionV><wp:extent cx="457200" cy="320040"/>${content}</wp:anchor>`;
const pageField = '<w:instrText xml:space="preserve"> PAGE \\* MERGEFORMAT </w:instrText>';
const fallback = content => `<mc:Fallback><w:pict><v:rect style="position:absolute;margin-left:567.1pt;margin-top:803.15pt;width:36pt;mso-position-horizontal:absolute;mso-position-horizontal-relative:page">${content}</v:rect></w:pict></mc:Fallback>`;

test('odd page-number shape follows right text margin; even follows left text margin', () => {
    for (const [even, alignment] of [[false, 'right'], [true, 'left']]) {
        const result = alignDocxFooterToMargins(anchor(pageField), even);
        assert.match(result, new RegExp(`<wp:positionH relativeFrom="margin"><wp:align>${alignment}</wp:align></wp:positionH>`));
        assert.match(result, /<wp:positionV relativeFrom="page"><wp:posOffset>10200005<\/wp:posOffset><\/wp:positionV>/);
        assert.match(result, /<wp:extent cx="457200" cy="320040"\/>/);
        assert.ok(result.includes(pageField));
        assert.equal(alignDocxFooterToMargins(result, even), result);
    }
});

test('date/rule artwork stays at left text margin with dimensions and content preserved', () => {
    const source = anchor('<w:t>Publication date</w:t>', 900430);
    const result = alignDocxFooterToMargins(source, false);
    assert.match(result, /<wp:align>left<\/wp:align>/);
    assert.ok(result.includes('<w:t>Publication date</w:t>'));
});

test('template static numbered badges align outside while grouped dates stay left', () => {
    assert.match(alignDocxFooterToMargins(anchor('<wps:wsp><w:t>1</w:t></wps:wsp>'), false), /<wp:align>right<\/wp:align>/);
    assert.match(alignDocxFooterToMargins(fallback('<w:t>1</w:t>'), false), /mso-position-horizontal:right/);
    assert.match(alignDocxFooterToMargins(anchor('<wpg:wgp><w:t>2026</w:t></wpg:wgp>'), false), /<wp:align>left<\/wp:align>/);
});

test('legacy VML fallback follows same margin while retaining nested artwork coordinates', () => {
    const source = fallback(pageField + '<v:shape style="position:absolute;left:190;top:666"/>');
    const result = alignDocxFooterToMargins(source, false);
    assert.match(result, /margin-left:0;mso-position-horizontal:right;mso-position-horizontal-relative:margin/);
    assert.match(result, /margin-top:803.15pt;width:36pt/);
    assert.ok(result.includes('<v:shape style="position:absolute;left:190;top:666"/>'));
    assert.doesNotMatch(result, /margin-left:567.1pt|mso-position-horizontal-relative:page/);
});

test('date text reserves the badge width on the outside, preserving full-width rule artwork', () => {
    const dateGroup = anchor('<wpg:wgp><wps:bodyPr lIns="91440" rIns="91440"/><w:t>JSLHU 2026</w:t></wpg:wgp>', 900430);
    const vmlGroup = '<mc:Fallback><v:group style="position:absolute;width:496.2pt;margin-left:70.9pt;mso-position-horizontal-relative:page"><v:textbox inset=",,,0"><w:t>JSLHU 2026</w:t></v:textbox></v:group></mc:Fallback>';
    const source = anchor(pageField) + dateGroup + vmlGroup;
    for (const even of [false, true]) {
        const result = alignDocxFooterToMargins(source, even);
        assert.match(result, even ? /lIns="548640" rIns="91440"/ : /lIns="91440" rIns="548640"/);
        assert.match(result, even ? /inset="43.2pt,,,0"/ : /inset=",,43.2pt,0"/);
        assert.ok(result.includes('width:496.2pt'));
        assert.equal(alignDocxFooterToMargins(result, even), result);
    }
});

test('footer references resolve parity by relationship and actual first page before article merge', () => {
    const documentXml = '<w:footerReference r:id="rId3" w:type="first"/><w:footerReference w:type="even" r:id="rId1"/><w:footerReference w:type="default" r:id="rId2"/>';
    const rels = '<Relationships><Relationship Target="footer1.xml" Id="rId1"/><Relationship Id="rId2" Target="footer2.xml"/><Relationship Id="rId3" Target="footer3.xml"/></Relationships>';
    const parities = docxFooterParities(documentXml, rels, 2);
    assert.equal(parities.get('footer1.xml'), true);
    assert.equal(parities.get('footer2.xml'), false);
    assert.equal(parities.get('footer3.xml'), true);
    assert.equal(docxFooterParities(documentXml, rels, 3).get('footer3.xml'), false);
    const files = new Map([
        ['word/document.xml', documentXml], ['word/_rels/document.xml.rels', rels],
        ...[1, 2, 3].map(index => [`word/footer${index}.xml`, anchor(pageField)])
    ]);
    alignZipDocxFooters({ file(path, value) {
        if (value === undefined) return files.has(path) ? { asText: () => files.get(path) } : null;
        files.set(path, value);
    } }, 2);
    assert.match(files.get('word/footer1.xml'), /<wp:align>left<\/wp:align>/);
    assert.match(files.get('word/footer2.xml'), /<wp:align>right<\/wp:align>/);
    assert.match(files.get('word/footer3.xml'), /<wp:align>left<\/wp:align>/);
});
