import { mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';

/**
 * Public German documents, all free to redistribute for this purpose.
 * gesetze-im-internet.de: clean legal text, long, heading-rich (§ structure).
 * dserver.bundestag.de: Drucksachen — messy layouts, tables, footnotes; some ids 404 (skipped).
 */
const LAWS = [
  'ustg_1980/UStG',
  'ao_1977/AO',
  'gewo/GewO',
  'bdsg_2018/BDSG',
  'arbzg/ArbZG',
  'kschg/KSchG',
  'milog/MiLoG',
  'prodhaftg/ProdHaftG',
  'uwg_2004/UWG',
  'vwvfg/VwVfG',
  'gmbhg/GmbHG',
  'hgb/HGB',
  'bgb/BGB',
  'estg/EStG',
  'tddg/TDDDG',
  'lfgb/LFGB',
  'ifsg/IfSG',
  'gastg/GastG',
];
const DRUCKSACHEN = Array.from({ length: 40 }, (_, i) => 1000 + i * 7); // 21/01000, 21/01007, ...

async function fetchTo(url: string, file: string) {
  try {
    await access(file);
    return 'exists';
  } catch {}
  const res = await fetch(url, { headers: { 'user-agent': 'rags2riches-corpus-fetch' } });
  if (!res.ok) return `HTTP ${res.status}`;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  return 'ok';
}

const root = path.resolve(process.argv[2] ?? 'corpus');
for (const l of LAWS) {
  const name = l.split('/')[1]!;
  console.log(
    name.padEnd(28),
    await fetchTo(
      `https://www.gesetze-im-internet.de/${l}.pdf`,
      path.join(root, 'gesetze', `${name}.pdf`),
    ),
  );
}
for (const n of DRUCKSACHEN) {
  const id = `21${String(n).padStart(5, '0')}`;
  const url = `https://dserver.bundestag.de/btd/21/${String(n).padStart(5, '0').slice(0, 3)}/${id}.pdf`;
  console.log(
    `Drucksache 21/${n}`.padEnd(28),
    await fetchTo(url, path.join(root, 'drucksachen', `${id}.pdf`)),
  );
}
