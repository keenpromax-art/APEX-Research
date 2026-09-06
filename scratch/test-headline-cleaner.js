function cleanDisclosureHeadline(headline, companyName, ticker) {
  let clean = headline.trim();
  const cleanTicker = ticker ? ticker.replace(/\.[a-zA-Z]+$/, '') : '';
  const prefixes = [
    companyName ? companyName + ' Ltd:' : '',
    companyName ? companyName + ' Limited:' : '',
    companyName ? companyName + ' Ltd' : '',
    companyName ? companyName + ' Limited' : '',
    companyName ? companyName + ':' : '',
    companyName ? companyName + ' -' : '',
    companyName ? companyName : '',
    ticker ? ticker + ':' : '',
    cleanTicker ? cleanTicker + ':' : '',
    'Suzlon Energy SUZLON:',
    'Suzlon Energy Ltd',
    'Suzlon Energy',
    'Suzlon'
  ].filter(Boolean);

  for (const p of prefixes) {
    if (clean.toLowerCase().startsWith(p.toLowerCase())) {
      clean = clean.slice(p.length).replace(/^[\s:\-]+/, '').trim();
      break;
    }
  }
  if (clean.length > 0) clean = clean.charAt(0).toUpperCase() + clean.slice(1);
  if (/^[A-Z0-9_-]+:\s*/i.test(clean)) clean = clean.replace(/^[A-Z0-9_-]+:\s*/i, '').trim();
  if (/^names\s+/i.test(clean)) clean = 'Appoints ' + clean.replace(/^names\s+/i, '');
  if (/^crosses\s+/i.test(clean)) clean = 'Crosses ' + clean.replace(/^crosses\s+/i, '');
  if (clean.length > 0) clean = clean.charAt(0).toUpperCase() + clean.slice(1);
  return clean;
}

function cleanTokens(s) {
  const stopWords = new Set([
    'ltd', 'limited', 'energy', 'the', 'and', 'for', 'with', 'from', 'its',
    'shares', 'stock', 'price', 'today', 'new', 'see', 'sees', 'per', 'via',
    'amid', 'after', 'over', 'into', 'under', 'about', 'suzlon'
  ]);
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));
}

function isDuplicateHeadline(h1, h2) {
  const w1 = cleanTokens(h1);
  const w2 = new Set(cleanTokens(h2));
  if (w1.length === 0 || w2.size === 0) return false;

  let matches = 0;
  for (const w of w1) {
    if (w2.has(w)) matches++;
  }

  // Key corporate event entity anchors: if both mention president/c-suite role or specific names
  const keyEntities = ['president', 'ceo', 'cfo', 'coo', 'director', 'nclt', 'reorganisation', 'reorganization', 'tata', 'volume'];
  const entityMatch = keyEntities.some((k) => w1.includes(k) && w2.has(k));
  if (entityMatch && matches >= 1) return true;

  const overlap = matches / Math.min(w1.length, w2.size);
  return overlap >= 0.28;
}

const testTitles = [
  'Suzlon Energy Receives NCLT Approval for Reserve Reorganisation Scheme',
  'Suzlon Energy Appoints Manjari Upadhye As President of RE Asset Management',
  'Suzlon Energy Ltd Sees Exceptional Volume Amid Bearish Trend',
  'Suzlon crosses 1 GW partnership with Tata Power following recent wind deal',
  'Suzlon Energy SUZLON: New President RE Asset Management',
  'Suzlon names Manjari Upadhye president of RE asset management'
];

const cleaned = testTitles.map(t => cleanDisclosureHeadline(t, 'Suzlon Energy', 'SUZLON.NS'));
const deduplicated = [];
for (const c of cleaned) {
  if (!deduplicated.some(existing => isDuplicateHeadline(existing, c))) {
    deduplicated.push(c);
  }
}

console.log('Original Count:', testTitles.length);
console.log('Deduplicated Count:', deduplicated.length);
deduplicated.forEach((d, i) => console.log(`${i + 1}.`, d));

