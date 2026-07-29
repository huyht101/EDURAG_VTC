'use strict';

const assert = require('assert/strict');
const { execFile } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { promisify } = require('util');

const fileService = require('../src/services/document-file-service');
const previewService = require('../src/services/document-preview-service');
const {
  VIETNAMESE_DOCX_TEXT,
  vietnameseDocxBytes
} = require('./lib/vietnamese-docx-fixture');

const exec = promisify(execFile);

async function command(command, args) {
  return exec(command, args, {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true
  });
}

async function main() {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'edurag-vietnamese-docx-'));
  try {
    const fontMatches = {};
    for (const font of ['Arial', 'Times New Roman', 'Calibri', 'Noto Sans']) {
      const { stdout } = await command('fc-match', ['-f', '%{family}|%{file}\n', font]);
      const [family, filename] = stdout.trim().split('|');
      assert(family && filename, `Fontconfig did not resolve ${font}.`);
      await fs.access(filename);
      fontMatches[font] = family;
    }

    const sourcePath = path.join(temporaryDirectory, 'vietnamese-preview.docx');
    await fs.writeFile(sourcePath, vietnameseDocxBytes());
    const pdfPath = await previewService.convertDocxToPdf(sourcePath, temporaryDirectory);
    const pdf = await fs.readFile(pdfPath);
    assert.equal(pdf.subarray(0, 5).toString('ascii'), '%PDF-');
    assert.equal(await fileService.countPdfPages(pdf), 2);

    const extracted = (await command('pdftotext', ['-enc', 'UTF-8', pdfPath, '-'])).stdout
      .replace(/\s+/g, ' ')
      .trim();
    assert(
      extracted.includes(VIETNAMESE_DOCX_TEXT),
      'Extracted PDF text must preserve the complete Vietnamese sentence.'
    );
    assert(!/[□�]/u.test(extracted), 'Extracted PDF text contains a missing-glyph marker.');

    const fontTable = (await command('pdffonts', [pdfPath])).stdout;
    const fontRows = fontTable.split(/\r?\n/).slice(2).filter((line) => line.trim());
    assert(fontRows.length > 0, 'Converted PDF must contain font metadata.');
    assert(
      fontRows.some((line) => /\byes\b/i.test(line)),
      'Converted PDF must embed at least one substituted font.'
    );

    const rendered = path.join(temporaryDirectory, 'rendered');
    await command('pdftoppm', ['-f', '1', '-singlefile', '-png', '-r', '120', pdfPath, rendered]);
    const png = await fs.readFile(`${rendered}.png`);
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert(png.length > 5000, 'Rendered preview image is unexpectedly small.');

    console.log(JSON.stringify({
      result: 'DOCX_VIETNAMESE_PREVIEW_OK',
      pageCount: 2,
      extractedText: true,
      missingGlyphMarker: false,
      embeddedFont: true,
      renderedPng: true,
      fontMatches
    }));
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
