// 정적 스냅샷 빌드: 수집 → state.json + evidence를 dist/에 굽는다.
// GitHub Actions가 주기 실행해 Pages로 배포하면 서버 없이 대시보드를 볼 수 있다.
// 주의: Pages는 공개다 — state.json(커밋 요약·멤버명)이 리포 공개 범위 그대로 노출된다.

import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectFromGit } from '../server/collect/git.js';
import { collectFromApi } from '../server/collect/api.js';
import { buildState } from '../server/state.js';
import { summarizeMember } from '../server/summarize.js';
import { listEvidence } from '../server/evidence.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(path.join(root, 'guild.config.json'), 'utf8'));
const dist = path.join(root, 'dist');

const git = await collectFromGit(root, config);
const api = await collectFromApi(config.repo);
const state = buildState({ git, api, config });
delete state.shas;
state.staticBuild = true;

for (const m of state.members) {
  const own = git.commits.filter((c) => (c.email || c.author).toLowerCase() === m.id);
  m.summary = await summarizeMember(m, own, config); // LLM 없으면 규칙 기반
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(path.join(root, 'public'), dist, { recursive: true });
await writeFile(path.join(dist, 'state.json'), JSON.stringify(state));

const evidenceSrc = path.join(root, config.evidenceDir);
if (existsSync(evidenceSrc)) {
  await cp(evidenceSrc, path.join(dist, 'evidence'), { recursive: true });
}
const evidence = await listEvidence(evidenceSrc, 'evidence'); // 정적 모드는 상대 경로
await writeFile(path.join(dist, 'evidence.json'), JSON.stringify(evidence));

console.log(`정적 빌드 완료 → dist/ (멤버 ${state.members.length}, 퀘스트 ${state.quests.length}, evidence ${evidence.length}, API ${state.apiAvailable ? 'ON' : 'OFF'})`);
