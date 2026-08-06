// .guild/evidence/<branch>/ 를 읽어 갤러리 목록을 만든다.
// 라이브 서버(/api/evidence)와 정적 빌드(scripts/build-static.mjs)가 공유한다.

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

// 심볼릭 링크로 base 밖 파일을 노출하는 것을 막는다 — evidence는 외부 기여자가
// 커밋할 수 있는 디렉터리이므로 실제 파일(심링크 아님)만, 그리고 base 안에 있는 것만 취급.
export function isRealFileInside(baseReal, entry) {
  // entry: readdir(withFileTypes) Dirent — 심링크는 isFile()이 false
  return entry.isFile();
}

export async function listEvidence(baseDir, urlPrefix = '/evidence') {
  if (!existsSync(baseDir)) return [];
  const out = [];
  let branches;
  try {
    branches = await readdir(baseDir, { withFileTypes: true });
  } catch { return []; }
  for (const b of branches) {
    if (!b.isDirectory()) continue; // 심링크 디렉터리도 isDirectory()=false → 제외
    const branch = b.name;
    const dir = path.join(baseDir, branch);
    let manifest = null;
    try {
      manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
    } catch { /* manifest 없이 이미지만 있어도 노출 */ }
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch { continue; }
    const files = entries
      .filter((e) => e.isFile() && /\.(png|jpg|jpeg|webp|svg)$/i.test(e.name)) // 심링크 파일 제외
      .map((e) => e.name);
    for (const file of files) {
      const meta = manifest?.screenshots?.find((s) => s.file === file);
      out.push({
        branch,
        file,
        url: `${urlPrefix}/${encodeURIComponent(branch)}/${encodeURIComponent(file)}`,
        caption: meta?.caption ?? file,
        createdAt: manifest?.createdAt ?? null,
        checks: manifest?.checks ?? null,
      });
    }
  }
  out.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  return out;
}
