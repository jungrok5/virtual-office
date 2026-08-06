// GitHub REST 폴링: 커밋 목록을 가져와 팀원별로 그룹핑한다.
// 토큰은 GITHUB_TOKEN 환경변수로 주입 (공개 레포는 없어도 동작, rate limit만 낮음).

const API = 'https://api.github.com';
const fileCache = new Map(); // sha → [{ filename, status }]

function headers() {
  const h = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'virtual-office',
  };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

async function ghFetch(path) {
  const res = await fetch(`${API}${path}`, { headers: headers() });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} ${path}`);
  }
  return res.json();
}

export async function fetchRecentCommits(repo, branch, perPage = 50) {
  const list = await ghFetch(`/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=${perPage}`);
  return list.map((c) => ({
    sha: c.sha,
    message: c.commit.message,
    authorName: c.commit.author?.name ?? '',
    authorEmail: c.commit.author?.email ?? '',
    login: c.author?.login ?? '',
    date: c.commit.author?.date ?? c.commit.committer?.date,
  }));
}

export async function fetchCommitFiles(repo, sha) {
  if (fileCache.has(sha)) return fileCache.get(sha);
  const detail = await ghFetch(`/repos/${repo}/commits/${sha}`);
  const files = (detail.files ?? []).map((f) => ({ filename: f.filename, status: f.status }));
  fileCache.set(sha, files);
  if (fileCache.size > 500) {
    fileCache.delete(fileCache.keys().next().value);
  }
  return files;
}

// 커밋 author를 config의 gitAuthors(로그인/이메일/이름)와 대조해 팀원별로 묶는다.
export function groupByMember(commits, members) {
  const byMember = new Map(members.map((m) => [m.id, []]));
  for (const commit of commits) {
    const keys = [commit.login, commit.authorEmail, commit.authorName]
      .filter(Boolean)
      .map((s) => s.toLowerCase());
    const member = members.find((m) =>
      m.gitAuthors.some((a) => keys.includes(a.toLowerCase()))
    );
    if (member) byMember.get(member.id).push(commit);
  }
  return byMember;
}
