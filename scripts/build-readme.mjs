import { mkdir, readFile, writeFile } from 'node:fs/promises';
import https from 'node:https';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readmePath = resolve(root, 'README.md');
const api = process.env.GOTOART_ARTISTS_API || 'https://h5.goto.art/api/artists';
const profileBase = 'https://h5.goto.art/#/artist/';
const categories = [
  ['a2_01', 'Painting'],
  ['a2_02', 'Sculpture'],
  ['a2_03', 'Photography'],
  ['a2_04', 'Mixed Media'],
  ['a2_05', 'Other Media'],
];
const categoryNames = new Map(categories);

function oneLine(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function safeBio(value) {
  const firstSection = String(value || '')
    .split(/\n\s*\n\s*补充信息[：:]/u, 1)[0]
    .replace(/^艺术家简介[：:]\s*/u, '');
  const cleaned = oneLine(firstSection)
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '')
    .replace(/(?:微信|电话|手机|小红书|抖音|Instagram|IG)[^。；;，,]{0,80}/giu, '')
    .replace(/1[3-9]\d{9}/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!cleaned) return 'Explore this artist’s public portfolio on GotoArt.';
  return cleaned.length <= 180 ? cleaned : `${cleaned.slice(0, 177).trimEnd()}…`;
}

function context(artist) {
  const parts = [];
  if (artist.city) parts.push(`Based in ${oneLine(artist.city)}`);
  if (artist.graduate && !/^(未知|无|暂无)$/u.test(oneLine(artist.graduate))) {
    parts.push(`education: ${oneLine(artist.graduate)}`);
  }
  return parts.join(' · ');
}

function entry(artist) {
  const meta = context(artist);
  const detail = safeBio(artist.bio);
  const description = meta ? `${meta}. ${detail}` : detail;
  return `- [${oneLine(artist.name)}](${profileBase}${encodeURIComponent(artist.id)}) — ${description}`;
}

function getJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { accept: 'application/json' } }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`GotoArt artist API returned ${response.statusCode}`));
          return;
        }
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    }).on('error', reject);
  });
}

const artists = await getJSON(api);
if (!Array.isArray(artists)) throw new Error('GotoArt artist API did not return an array');

const validArtists = artists
  .filter((artist) => artist && artist.id && artist.name)
  .sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'));
const byCategory = new Map(categories.map(([id]) => [id, []]));
const uncategorized = [];

for (const artist of validArtists) {
  const types = Array.isArray(artist.type) ? artist.type : [];
  const primary = types.find((type) => byCategory.has(type));
  (primary ? byCategory.get(primary) : uncategorized).push(artist);
}

const sections = [
  '## Directory',
  '',
  `*${validArtists.length} publicly visible artist profiles. Refreshed ${new Date().toISOString().slice(0, 10)}.*`,
  '',
  '### Contents',
  '',
  ...categories.map(([id, label]) => `- [${label}](#${label.toLowerCase().replace(/ /g, '-')}) (${byCategory.get(id).length})`),
];

for (const [id, label] of categories) {
  sections.push('', `### ${label}`, '', ...byCategory.get(id).map(entry));
}
if (uncategorized.length) sections.push('', '### Other', '', ...uncategorized.map(entry));

const readme = await readFile(readmePath, 'utf8');
const marker = '## Browse the directory';
const before = readme.slice(0, readme.indexOf(marker));
const after = readme.slice(readme.indexOf('## Contributing'));
if (!before || !after) throw new Error('README markers are missing');
await mkdir(root, { recursive: true });
await writeFile(readmePath, `${before}${sections.join('\n')}\n\n${after}`);
console.log(`Generated ${validArtists.length} public artist entries.`);
