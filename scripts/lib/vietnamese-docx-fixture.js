'use strict';

const VIETNAMESE_DOCX_TEXT = 'Kế hoạch thực tập – Bài toán lớp 3: tiếng Việt có dấu đầy đủ.';

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function storedZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, contents] of entries) {
    const filename = Buffer.from(name, 'utf8');
    const data = Buffer.from(contents, 'utf8');
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(filename.length, 26);
    localParts.push(local, filename, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, filename);
    offset += local.length + filename.length + data.length;
  }
  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

function vietnameseDocxBytes() {
  const run = (text, font = 'Arial') => (
    `<w:r><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" `
    + `w:eastAsia="${font}" w:cs="${font}"/></w:rPr>`
    + `<w:t xml:space="preserve">${text}</w:t></w:r>`
  );
  return storedZip([
    ['[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/word/document.xml" '
      + 'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      + '</Types>'],
    ['_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" '
      + 'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
      + 'Target="word/document.xml"/>'
      + '</Relationships>'],
    ['word/document.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
      + `<w:body><w:p>${run(VIETNAMESE_DOCX_TEXT)}</w:p>`
      + '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
      + `<w:p>${run('Trang hai – kiểm tra Times New Roman: Trường học, Nguyễn Ái Quốc.', 'Times New Roman')}</w:p>`
      + '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>'
      + '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>'
      + '</w:sectPr></w:body></w:document>']
  ]);
}

module.exports = {
  VIETNAMESE_DOCX_TEXT,
  vietnameseDocxBytes
};
