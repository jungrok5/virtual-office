// git 트랜스포트: 로컬 클론에서 브랜치·커밋·작성자를 수집한다.
// GitHub API가 막힌 환경에서도 동작하는 기본 수집 경로. PR/CI는 api.js가 보강한다.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const SEP = '\x1f'; // git format 구분자 (커밋 메시지에 등장하지 않는 제어문자)

async function git(repoDir, args) {
  const { stdout } = await run('git', ['-C', repoDir, ...args], { maxBuffer: 8 * 1024 * 1024 });
  return stdout.trim();
}

function parseCommits(raw, branch) {
  if (!raw) return [];
  return raw.split('\n').map((line) => {
    const [sha, author, email, date, subject] = line.split(SEP);
    return { sha, author, email, date, subject, branch };
  });
}

// 커밋 author를 표시용 이름으로 정규화 — 에이전트 커밋(noreply@anthropic.com 등)을
// 계정 주인 이름으로 귀속시키는 authorAliases(config) 적용
function applyAliases(commits, aliases) {
  if (!aliases) return commits;
  return commits.map((c) => ({
    ...c,
    author: aliases[c.email?.toLowerCase()] ?? aliases[c.author] ?? c.author,
  }));
}

export async function collectFromGit(repoDir, { activityWindowDays = 14, authorAliases } = {}) {
  try {
    await git(repoDir, ['fetch', 'origin', '--prune', '--quiet']);
  } catch (err) {
    console.error('[git] fetch 실패 (로컬 캐시로 진행):', err.message.split('\n')[0]);
  }

  // CI(Actions)에서는 GUILD_DEFAULT_BRANCH로 명시 주입 — symbolic-ref가 없는 얕은 클론 대비
  let defaultBranch = process.env.GUILD_DEFAULT_BRANCH || null;
  if (!defaultBranch) {
    try {
      const head = await git(repoDir, ['symbolic-ref', 'refs/remotes/origin/HEAD']);
      defaultBranch = head.replace('refs/remotes/origin/', '');
    } catch {
      defaultBranch = null; // 아래에서 가장 최근 브랜치로 대체
    }
  }

  const refsRaw = await git(repoDir, [
    'for-each-ref', 'refs/remotes/origin',
    '--sort=-committerdate',
    `--format=%(refname:short)${SEP}%(committerdate:iso8601-strict)`,
  ]);
  const branches = refsRaw
    ? refsRaw.split('\n').map((line) => {
        const [ref, lastCommitAt] = line.split(SEP);
        return { name: ref.replace(/^origin\//, ''), lastCommitAt };
      }).filter((b) => b.name !== 'HEAD')
    : [];
  if (!defaultBranch) defaultBranch = branches[0]?.name ?? null;

  const format = `--format=%H${SEP}%an${SEP}%ae${SEP}%aI${SEP}%s`;
  const commits = [];

  if (defaultBranch) {
    const raw = await git(repoDir, [
      'log', `origin/${defaultBranch}`, `--since=${activityWindowDays}.days`, '-n', '100', format,
    ]);
    commits.push(...parseCommits(raw, defaultBranch));
  }

  // 피처 브랜치: 기본 브랜치에 없는 커밋(= 진행 중인 작업)만 수집
  const featureBranches = [];
  for (const b of branches) {
    if (b.name === defaultBranch) continue;
    const raw = await git(repoDir, [
      'log', `origin/${defaultBranch}..origin/${b.name}`, '-n', '50', format,
    ]).catch(() => '');
    const ahead = applyAliases(parseCommits(raw, b.name), authorAliases);
    commits.push(...ahead);
    featureBranches.push({ ...b, aheadCount: ahead.length, commits: ahead });
  }

  return { defaultBranch, branches, featureBranches, commits: applyAliases(commits, authorAliases) };
}
