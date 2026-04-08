const htmlDocx = require('html-docx-js');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.resolve(__dirname, 'timechamp-system-report.html'), 'utf8');

// html-docx-js needs a full HTML document
const docx = htmlDocx.asBlob(html, {
  orientation: 'portrait',
  margins: { top: 720, right: 720, bottom: 720, left: 720 },
});

// html-docx-js returns a Blob in Node 18+ — convert via arrayBuffer
docx.arrayBuffer().then((ab) => {
  fs.writeFileSync(path.resolve(__dirname, 'timechamp-system-report.docx'), Buffer.from(ab));
  console.log('DOCX saved: docs/timechamp-system-report.docx');
});
console.log('DOCX saved: docs/timechamp-system-report.docx');
