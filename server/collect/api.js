// REST 트랜스포트: GitHub API가 열려 있는 환경에서 PR·CI 상태를 보강한다.
// 첫 호출에서 접근성을 프로브하고, 막혀 있으면 이후 호출을 건너뛴다 (git 수집만으로 동작).

const API = 'https://api.github.com';
let apiBlocked = false;

function headers() {
  const h = { Accept: 'application/vnd.github+json', 'User-Agent': 'guild-hq' };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

async function ghFetch(path) {
  if (apiBlocked) return null;
  try {
    const res = await fetch(`${API}${path}`, { headers: headers() });
    if (res.status === 403 || res.status === 401) {
      apiBlocked = true;
      console.error(`[api] GitHub API 접근 불가 (${res.status}) — git 수집만으로 동작합니다.`);
      return null;
    }
    if (!res.ok) throw new Error(`GitHub API ${res.status} ${path}`);
    return res.json();
  } catch (err) {
    console.error('[api]', err.message);
    return null;
  }
}

export async function collectFromApi(repo) {
  const open = await ghFetch(`/repos/${repo}/pulls?state=open&per_page=30`);
  if (open === null) return null; // API 사용 불가 → 호출측은 git 데이터만 사용

  const pulls = [];
  for (const pr of open) {
    let ci = 'none';
    const checks = await ghFetch(`/repos/${repo}/commits/${pr.head.sha}/check-runs`);
    if (checks?.check_runs?.length) {
      const runs = checks.check_runs;
      if (runs.some((r) => r.conclusion === 'failure')) ci = 'failing';
      else if (runs.some((r) => r.status !== 'completed')) ci = 'running';
      else ci = 'passing';
    }
    pulls.push({
      number: pr.number,
      title: pr.title,
      author: pr.user?.login ?? '',
      branch: pr.head.ref,
      updatedAt: pr.updated_at,
      draft: pr.draft,
      ci,
    });
  }

  const closed = await ghFetch(`/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=15`);
  const merged = (closed ?? [])
    .filter((pr) => pr.merged_at)
    .map((pr) => ({
      number: pr.number,
      title: pr.title,
      author: pr.user?.login ?? '',
      mergedAt: pr.merged_at,
    }));

  return { pulls, merged };
}
