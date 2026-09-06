import fs from 'fs';
import zlib from 'zlib';

const buf = fs.readFileSync('scratch/inoxwind_test.pdf');
const str = buf.toString('latin1');

const streams = [...str.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)];

console.log('Total streams found:', streams.length);

let decompressedPages = [];
for (let i = 0; i < streams.length; i++) {
  try {
    const raw = Buffer.from(streams[i][1], 'latin1');
    const decomp = zlib.inflateSync(raw).toString('latin1');
    const pageMatch = decomp.match(/Page\s+(\d+)\s+of\s+(\d+)/);
    // In PDF, text can be in Tj or TJ
    const tjs = [...decomp.matchAll(/\[(.*?)\]\s*TJ/g)];
    const singleTjs = [...decomp.matchAll(/\((.*?)\)\s*Tj/g)];
    const textSnippet = decomp.slice(0, 180).replace(/[\r\n\t]+/g, ' ');
    decompressedPages.push({
      streamIndex: i,
      decompLength: decomp.length,
      pageFooter: pageMatch ? pageMatch[0] : null,
      sample: textSnippet
    });
  } catch (e) {
    decompressedPages.push({
      streamIndex: i,
      error: e.message
    });
  }
}


function dumpHex(streamObjNum) {
  const re = new RegExp(`${streamObjNum}\\s+0\\s+obj[\\s\\S]*?stream\\r?\\n([\\s\\S]*?)\\r?\\nendstream`, 'g');
  const m = re.exec(str);
  if (!m) return;
  const decomp = zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1');
  console.log(`\n=== HEX DECODED FOR OBJ ${streamObjNum} ===`);
  const hexMatches = [...decomp.matchAll(/<([0-9a-fA-F]+)>/g)].map(h => {
    return Buffer.from(h[1], 'hex').toString('utf8');
  });
  console.log(hexMatches.join(' '));
}

dumpHex(6);
dumpHex(13);





