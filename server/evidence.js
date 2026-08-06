// .guild/evidence/<branch>/ 를 읽어 갤러리 목록을 만든다.
// 라이브 서버(/api/evidence)와 정적 빌드(scripts/build-static.mjs)가 공유한다.

import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

export async function listEvidence(baseDir, urlPrefix = '/evidence') {
  if (!existsSync(baseDir)) return [];
  const out = [];
  for (const branch of await readdir(baseDir)) {
    const dir = path.join(baseDir, branch);
    if (!(await stat(dir)).isDirectory()) continue;
    let manifest = null;
    try {
      manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
    } catch { /* manifest 없이 이미지만 있어도 노출 */ }
    const files = (await readdir(dir)).filter((f) => /\.(png|jpg|jpeg|webp|svg)$/i.test(f));
    for (const file of files) {
      const meta = manifest?.screenshots?.find((s) => s.file === file);
      out.push({
        branch,
        file,
        url: `${urlPrefix}/${branch}/${file}`,
        caption: meta?.caption ?? file,
        createdAt: manifest?.createdAt ?? null,
        checks: manifest?.checks ?? null,
      });
    }
  }
  out.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  return out;
}
