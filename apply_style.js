const fs = require('fs');
const path = require('path');

const indexPath = 'e:\\Lelong2025.github.io\\index.html';
const cssPath = 'C:\\Users\\Nhac Phuoc\\.gemini\\antigravity-ide\\brain\\1c0ac9c4-1535-4cbc-9aff-cd5667992221\\scratch\\new_style.css';

try {
    let html = fs.readFileSync(indexPath, 'utf8');
    const css = fs.readFileSync(cssPath, 'utf8');

    const styleStartTag = '<style>';
    const styleEndTag = '</style>';

    const startIndex = html.indexOf(styleStartTag);
    if (startIndex === -1) {
        console.error("Could not find <style> tag");
        process.exit(1);
    }

    const endIndex = html.indexOf(styleEndTag, startIndex);
    if (endIndex === -1) {
        console.error("Could not find </style> tag");
        process.exit(1);
    }

    // Keep the tags, but replace the content between them
    const before = html.substring(0, startIndex + styleStartTag.length);
    const after = html.substring(endIndex);

    const updatedHtml = before + '\n' + css + '\n  ' + after;
    fs.writeFileSync(indexPath, updatedHtml, 'utf8');
    console.log("Successfully replaced style block in index.html!");
} catch (e) {
    console.error("Error modifying file:", e);
    process.exit(1);
}
