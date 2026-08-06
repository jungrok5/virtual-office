// 상태 엔진: 마지막 푸시 이후 경과 시간 하나로 근무/자리비움/퇴근을 판별한다.
// 실시간 입력 감지 없음 — 감시가 아니라 결과물 기반의 느슨한 추론.

export function computeStatus(lastPushIso, thresholds, now = new Date()) {
  if (!lastPushIso) return 'offline';
  const hours = (now - new Date(lastPushIso)) / 36e5;
  if (hours < thresholds.awayHours) return 'working';
  if (hours < thresholds.offlineHours) return 'away';
  return 'offline';
}

const FILE_CATEGORIES = [
  { key: 'code', label: '코드', exts: ['js', 'ts', 'tsx', 'jsx', 'cs', 'py', 'go', 'rs', 'java', 'kt', 'cpp', 'c', 'h', 'css', 'html', 'shader', 'sql'] },
  { key: 'art', label: '아트', exts: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'psd', 'ai', 'fbx', 'blend', 'tga', 'svg', 'spine', 'anim', 'mat', 'prefab'] },
  { key: 'doc', label: '문서/기획', exts: ['md', 'txt', 'docx', 'xlsx', 'pptx', 'pdf', 'csv'] },
  { key: 'config', label: '설정', exts: ['json', 'yaml', 'yml', 'toml', 'xml', 'ini', 'env'] },
];

export function classifyFiles(filenames) {
  const stats = {};
  for (const name of filenames) {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    const category = FILE_CATEGORIES.find((c) => c.exts.includes(ext));
    const key = category ? category.key : 'etc';
    stats[key] = (stats[key] ?? 0) + 1;
  }
  return stats;
}

export function categoryLabel(key) {
  return FILE_CATEGORIES.find((c) => c.key === key)?.label ?? '기타';
}
