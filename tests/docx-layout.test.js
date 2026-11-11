import assert from 'node:assert/strict';
import test from 'node:test';
import {
    mirrorDocxSectionMargins, enableDocxMirrorMargins, enforceZipDocxMirrorMargins
} from '../src/magazine/modules/docx-layout.js';

test('Word mirrors every section while preserving even starting pages and template layout', () => {
    const section = start => `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="900" w:right="1418" w:bottom="850" w:left="567" w:header="300" w:footer="400" w:gutter="120"/><w:pgNumType w:start="${start}"/><w:cols w:num="2" w:space="567"/></w:sectPr>`;
    const source = `<w:body><w:p><w:pPr>${section(2)}</w:pPr></w:p>${section(6)}</w:body>`;
    const result = mirrorDocxSectionMargins(source);
    assert.equal(result.match(/w:left="1418"/g).length, 2);
    assert.equal(result.match(/w:right="567"/g).length, 2);
    assert.equal(result.match(/w:gutter="0"/g).length, 2);
    assert.equal(result.replace(/w:(left|right|gutter)="\d+"/g, ''), source.replace(/w:(left|right|gutter)="\d+"/g, ''));
    assert.equal(mirrorDocxSectionMargins(result), result);
});

test('Word supplies omitted margin attributes and section margins', () => {
    const result = mirrorDocxSectionMargins('<w:sectPr><w:pgSz w:w="11906"/><w:cols w:num="1"/></w:sectPr>');
    assert.match(result, /<w:pgSz[^>]*\/><w:pgMar[^>]*w:left="1418"[^>]*w:right="567"[^>]*w:gutter="0"\/><w:cols/);
    const existing = mirrorDocxSectionMargins('<w:sectPr><w:pgMar w:top="900"></w:pgMar></w:sectPr>');
    assert.match(existing, /w:top="900" w:left="1418" w:right="567" w:gutter="0"><\/w:pgMar>/);
});

test('Word enables mirror margins once and retains template settings in schema order', () => {
    const source = '<w:settings xmlns:w="word"><w:zoom w:percent="100"/><w:mirrorMargins w:val="0"/><w:proofState w:spelling="clean"/><w:mirrorMargins w:val="false"></w:mirrorMargins><w:evenAndOddHeaders/><w:compat/></w:settings>';
    const result = enableDocxMirrorMargins(source);
    assert.equal(result, '<w:settings xmlns:w="word"><w:zoom w:percent="100"/><w:mirrorMargins/><w:proofState w:spelling="clean"/><w:evenAndOddHeaders/><w:compat/></w:settings>');
    assert.equal(enableDocxMirrorMargins(result), result);
});

test('Word package normalization updates document and settings without altering other parts', () => {
    const files = new Map([
        ['word/document.xml', '<w:sectPr><w:pgMar w:left="100" w:right="200" w:gutter="50"/><w:pgNumType w:start="2"/></w:sectPr>'],
        ['word/settings.xml', '<w:settings><w:evenAndOddHeaders/></w:settings>'],
        ['word/styles.xml', '<w:styles/>']
    ]);
    const zip = { file(path, value) {
        if (value === undefined) return files.has(path) ? { asText: () => files.get(path) } : null;
        files.set(path, value);
    } };
    enforceZipDocxMirrorMargins(zip);
    assert.match(files.get('word/document.xml'), /w:left="1418" w:right="567" w:gutter="0"/);
    assert.match(files.get('word/document.xml'), /w:start="2"/);
    assert.equal(files.get('word/settings.xml'), '<w:settings><w:mirrorMargins/><w:evenAndOddHeaders/></w:settings>');
    assert.equal(files.get('word/styles.xml'), '<w:styles/>');
});
