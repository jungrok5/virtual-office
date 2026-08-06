// Guild HQ 프론트: /api/state + SSE로 스냅샷을 받고,
// 픽셀 씬(활동만 그린다 — 출퇴근 없음) · 퀘스트 보드 · Q&A · Evidence 갤러리를 렌더링한다.

(() => {
  // 인증 토큰이 URL(?token=)에 있으면 서버가 쿠키를 심어줬으므로, 히스토리·북마크·
  // 로그에 토큰이 남지 않도록 주소창에서 즉시 제거한다 (이후 요청은 쿠키로 인증).
  if (location.search.includes('token=')) {
    const u = new URL(location.href);
    u.searchParams.delete('token');
    history.replaceState(null, '', u.pathname + u.search + u.hash);
  }

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cv = document.getElementById('cv'), cx = cv.getContext('2d');
  cx.imageSmoothingEnabled = false;
  const px = (x, y, w, h, c) => { cx.fillStyle = c; cx.fillRect(x, y, w, h); };

  const HAIR = ['#f4d35e', '#ff8fab', '#8d99ae', '#80ed99', '#c77dff', '#ffa94d'];
  const DESKS = [
    { x: 110, y: 150 }, { x: 330, y: 150 }, { x: 530, y: 150 },
    { x: 110, y: 290 }, { x: 330, y: 290 }, { x: 530, y: 290 },
  ];

  let state = null;
  let seats = []; // [{ member, x, y, hair, working, fire, typing }]

  function assignSeats() {
    const members = (state?.members ?? []).slice(0, DESKS.length);
    const prev = new Map(seats.map((s) => [s.member.id, s]));
    seats = members.map((m, i) => {
      const old = prev.get(m.id);
      const blocked = (state.quests ?? []).some((q) => q.blocked && q.owner === m.name);
      return {
        member: m, ...DESKS[i], hair: HAIR[i % HAIR.length],
        typing: m.working ? 400 : 0,
        fire: blocked ? Infinity : 0,
        burst: old?.burst ?? 0,
      };
    });
  }

  // ---- 씬 드로잉 --------------------------------------------------------
  function drawFloor() {
    for (let ty = 0; ty < cv.height / 32; ty++)
      for (let tx = 0; tx < cv.width / 32; tx++)
        px(tx * 32, ty * 32, 32, 32, (tx + ty) % 2 ? '#1c1730' : '#201a36');
    for (let i = 0; i < 3; i++) {
      px(70 + i * 180, 16, 64, 40, '#141024');
      px(74 + i * 180, 20, 56, 32, '#2b2450');
      px(96 + i * 180, 20, 4, 32, '#141024');
      px(74 + i * 180, 34, 56, 3, '#141024');
    }
  }

  function drawSeat(s, t) {
    const { x, y } = s;
    px(x - 40, y + 10, 96, 34, '#3a2f24');
    px(x - 40, y + 44, 8, 14, '#241d16'); px(x + 48, y + 44, 8, 14, '#241d16');
    px(x + 8, y - 14, 34, 26, '#0c0a16');
    const on = s.typing > 0;
    px(x + 11, y - 11, 28, 20, on ? '#182a3a' : '#131022');
    if (on) for (let i = 0; i < 4; i++)
      px(x + 13, y - 8 + i * 4, 8 + ((t >> 3) + i * 7) % 14, 2, i % 2 ? '#7cc7ff' : '#6fe3a5');
    px(x + 22, y + 12, 6, 4, '#0c0a16');
    if (s.fire > 0) {
      if (reduced) { px(x - 20, y - 6, 8, 8, '#ff6b6b'); px(x - 4, y - 12, 8, 8, '#ffb454'); }
      else for (let i = 0; i < 7; i++) {
        const fx = x - 30 + ((i * 37 + (t >> 1) * 13) % 60);
        const fy = y + 6 - ((t * 2 + i * 23) % 26);
        px(fx, fy, 4, 4, i % 3 ? '#ff6b6b' : '#ffb454');
      }
    }
    const typing = s.typing > 0;
    const bob = typing && !reduced ? (t >> 3) % 2 : 0;
    px(x - 24, y - 20, 20, 14, s.hair);
    px(x - 22, y - 12, 16, 6, '#f1c9a5');
    px(x - 19, y - 10, 3, 3, '#1a1626'); px(x - 12, y - 10, 3, 3, '#1a1626');
    px(x - 26, y - 6, 24, 16, typing ? '#4a4470' : '#3a3556');
    px(x - 30, y - 2 + bob * 2, 6, 8, '#f1c9a5');
    px(x - 2, y - 2 - bob * 2, 6, 8, '#f1c9a5');
    cx.fillStyle = '#9a8fc0'; cx.font = '11px ui-monospace, monospace'; cx.textAlign = 'center';
    cx.fillText(s.member.name, x - 14, y + 56);
  }

  let confetti = [];
  function popConfetti(s) {
    if (reduced) return;
    for (let i = 0; i < 40; i++) confetti.push({
      x: s.x - 40 + (i * 17 % 60), y: s.y - 30,
      vy: -(2 + i % 4), vx: ((i * 7) % 9 - 4) / 2, life: 40 + i % 20,
      c: ['#6fe3a5', '#ffb454', '#7cc7ff', '#ff8fab'][i % 4],
    });
  }

  let t = 0;
  function frame() {
    t++;
    drawFloor();
    seats.forEach((s) => { drawSeat(s, t); if (s.typing > 0 && s.typing !== Infinity) s.typing--; });
    confetti = confetti.filter((p) => p.life-- > 0);
    confetti.forEach((p) => { p.x += p.vx; p.y += p.vy; p.vy += 0.15; px(p.x, p.y, 4, 4, p.c); });
    requestAnimationFrame(frame);
  }

  // ---- 토스트/티커 ------------------------------------------------------
  const scene = document.getElementById('scene');
  function toast(s, html) {
    const el = document.createElement('div');
    el.className = 'toast'; el.innerHTML = html;
    el.style.left = (s.x - 14) / cv.width * 100 + '%';
    el.style.top = (s.y - 44) / cv.height * 100 + '%';
    scene.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 2600);
  }

  const ticker = document.getElementById('ticker');
  const TICK_TYPES = ['push', 'merge', 'ci_fail', 'ci_pass'];
  function tick(type, text, at) {
    if (!TICK_TYPES.includes(type)) type = 'push';
    const d = at ? new Date(at) : new Date();
    const hh = String(d.getHours()).padStart(2, '0'), mm = String(d.getMinutes()).padStart(2, '0');
    const row = document.createElement('div');
    row.innerHTML = `<span class="t">${hh}:${mm}</span><span class="ev-${type}"></span>`;
    row.lastChild.textContent = text;
    ticker.prepend(row);
    while (ticker.children.length > 6) ticker.lastChild.remove();
  }

  function handleEvents(events) {
    for (const ev of events ?? []) {
      const s = seats.find((x) => x.member.name === ev.who);
      if (ev.type === 'push') {
        if (s) { s.typing = 400; toast(s, `<span class="m">push</span> ${escapeHtml(ev.msg)}`); }
        tick('push', `${ev.who} → push · ${ev.msg}`, ev.at);
      } else if (ev.type === 'ci_fail') {
        if (s) s.fire = Infinity;
        tick('ci_fail', `CI 실패 · ${ev.msg}`, ev.at);
      } else if (ev.type === 'ci_pass') {
        if (s) s.fire = 0;
        tick('ci_pass', `CI 통과 · ${ev.msg}`, ev.at);
      } else if (ev.type === 'merge') {
        if (s) { popConfetti(s); toast(s, `<span class="m">QUEST COMPLETE!</span> ${escapeHtml(ev.msg)}`); }
        tick('merge', `머지 · ${ev.msg}`, ev.at);
      }
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  // ---- 보드 렌더링 ------------------------------------------------------
  function relTime(iso) {
    if (!iso) return '';
    const min = Math.round((Date.now() - new Date(iso)) / 60e3);
    if (min < 1) return '방금';
    if (min < 60) return `${min}분 전`;
    if (min < 60 * 24) return `${Math.round(min / 60)}시간 전`;
    return `${Math.round(min / 60 / 24)}일 전`;
  }

  function renderBoard() {
    const modeLabel = state.demo ? ' · 데모 재생 중' : state.staticBuild ? ' · 정적 스냅샷' : '';
    document.getElementById('repo-label').textContent =
      `${state.repo}${modeLabel} · ${relTime(state.generatedAt)} 갱신`;
    document.getElementById('doing').innerHTML = state.quests.length
      ? state.quests.map((q) => `
        <div class="card${q.blocked ? ' blocked' : ''}">
          ${q.blocked ? '<span class="stamp">CI RED</span>' : ''}
          <div class="title">${escapeHtml(q.id)} ${escapeHtml(q.title)}</div>
          <div class="meta"><span>${escapeHtml(q.owner)}</span><span>${escapeHtml(q.branch)}</span><span>${relTime(q.updatedAt)}</span></div>
        </div>`).join('')
      : '<div class="empty">진행 중인 퀘스트가 없습니다.</div>';
    document.getElementById('did').innerHTML = state.did.slice(0, 8)
      .map((d) => `<li><b>${escapeHtml(d.who)}</b> — ${escapeHtml(d.what)} <span>(${relTime(d.at)})</span></li>`).join('');
    const c = state.stats;
    document.getElementById('c-commits').textContent = c.commitsToday;
    document.getElementById('c-quests').textContent = c.quests;
    document.getElementById('c-blocked').textContent = c.blocked;
    document.getElementById('c-members').textContent = c.members;
  }

  function applyState(next) {
    const firstLoad = !state;
    state = next;
    assignSeats();
    renderBoard();
    if (!firstLoad) handleEvents(state.events);
  }

  // ---- 데이터 연결: 서버가 있으면 SSE, 없으면 정적 스냅샷(state.json) ----
  let staticMode = false;

  function connectSSE() {
    const es = new EventSource('events');
    es.onmessage = (e) => applyState(JSON.parse(e.data));
    es.onerror = () => { es.close(); setTimeout(connectSSE, 5000); };
  }
  async function refreshStatic() {
    try {
      applyState(await fetch('state.json', { cache: 'no-cache' }).then((r) => r.json()));
    } catch { /* 다음 주기에 재시도 */ }
  }
  async function init() {
    try {
      const res = await fetch('api/state');
      if (res.ok) {
        const s = await res.json();
        if (!s.loading) applyState(s);
        connectSSE();
        return;
      }
    } catch { /* 서버 없음 → 정적 모드 */ }
    staticMode = true;
    document.getElementById('llm-row').hidden = false;
    await refreshStatic();
    setInterval(refreshStatic, 60000);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // ---- Q&A --------------------------------------------------------------
  const chat = document.getElementById('chat');
  function say(cls, text) {
    const el = document.createElement('div');
    el.className = 'msg ' + cls; el.textContent = text;
    chat.appendChild(el); chat.scrollTop = chat.scrollHeight;
  }

  // 정적 모드 규칙 기반 답변 (server/ask.js의 ruleBased 포팅)
  function clientRules(q) {
    const hit = state.members.find((m) => m.name && q.includes(m.name));
    if (hit) {
      const lines = [];
      lines.push(hit.working
        ? `${hit.name}은(는) 최근 푸시가 있어 작업 중으로 보입니다.`
        : `${hit.name}의 마지막 푸시는 ${relTime(hit.lastPushAt) || '기록 없음'}입니다.`);
      state.quests.filter((x) => x.owner === hit.name).forEach((x) => lines.push(x.blocked
        ? `진행 중: ${x.title} — CI 실패로 막혀 있습니다.`
        : `진행 중: ${x.title} (${x.branch})`));
      const done = state.did.filter((d) => d.who === hit.name).slice(0, 3);
      if (done.length) lines.push(`최근 완료: ${done.map((d) => d.what).join(' / ')}`);
      return lines.join('\n');
    }
    if (/막|블록|왜|문제|불/.test(q)) {
      const b = state.quests.filter((x) => x.blocked);
      return b.length
        ? b.map((x) => `${x.title} (${x.owner}) — CI 실패로 막혀 있습니다.`).join('\n')
        : '지금 막혀 있는 작업은 없습니다.';
    }
    if (/오늘|했|완료|됐/.test(q)) {
      return state.did.length
        ? '최근 24시간 작업:\n' + state.did.slice(0, 8).map((d) => `· ${d.who} — ${d.what}`).join('\n')
        : '최근 24시간 내 완료된 작업이 없습니다.';
    }
    return `현재: 진행 중 ${state.stats.quests}건, 최근 24시간 커밋 ${state.stats.commitsToday}건, ` +
      `블록 ${state.stats.blocked}건, 활동 멤버 ${state.stats.members}명. 멤버 이름으로 물으면 개인 현황을 알려드립니다.`;
  }

  // ---- 온디바이스 LLM (옵트인) --------------------------------------------
  // 엔진 사다리: ① 크롬 내장 AI(Gemini Nano, 다운로드 없음) → ② WebLLM(WebGPU) → ③ 규칙 기반
  let llmEngine = null;       // WebLLM 엔진
  let builtinReady = false;   // 크롬 내장 Prompt API 사용 가능
  let llmLoading = false;
  const llmBtn = document.getElementById('llm-btn');
  const llmStatus = document.getElementById('llm-status');
  const llmSelect = document.getElementById('llm-model');
  llmSelect.value = localStorage.getItem('guild-llm-model') ?? 'auto';
  if (!llmSelect.value) llmSelect.value = 'auto';
  llmSelect.addEventListener('change', () => localStorage.setItem('guild-llm-model', llmSelect.value));

  // 기기 맞춤 기본 모델 (navigator.deviceMemory는 크롬에서 최대 8로 캡)
  function autoModel() {
    const mem = navigator.deviceMemory ?? 4;
    const mobile = matchMedia('(max-width: 700px)').matches;
    if (mem >= 8) return 'Qwen3.5-4B-q4f16_1-MLC';        // 플래그십 폰(S26 울트라급)·PC
    if (mem >= 4) return 'Qwen3.5-2B-q4f16_1-MLC';
    return mobile ? 'Qwen3.5-0.8B-q4f16_1-MLC' : 'Qwen3.5-2B-q4f16_1-MLC';
  }

  async function tryBuiltin() {
    if (!('LanguageModel' in self)) return false;
    try {
      const avail = await LanguageModel.availability();
      if (avail === 'unavailable') return false;
      llmStatus.textContent = avail === 'available'
        ? '크롬 내장 AI 준비 중…'
        : '크롬 내장 모델 다운로드 중 (브라우저가 관리, 이 탭 용량 아님)…';
      const probe = await LanguageModel.create({
        monitor(m) {
          m.addEventListener('downloadprogress', (e) => {
            llmStatus.textContent = `크롬 내장 모델 다운로드 ${Math.round((e.loaded ?? 0) * 100)}%`;
          });
        },
      });
      probe.destroy?.();
      builtinReady = true;
      llmStatus.textContent = '✅ 크롬 내장 AI(Gemini Nano) 준비됨 — 추가 다운로드 없이 기기에서 답변';
      return true;
    } catch {
      builtinReady = false;
      return false;
    }
  }

  async function loadWebLlm(modelId) {
    if (!navigator.gpu) {
      llmStatus.textContent = '이 브라우저는 WebGPU를 지원하지 않습니다 — 규칙 기반으로 답합니다.';
      return false;
    }
    llmStatus.textContent = 'WebLLM 라이브러리 로딩…';
    // 버전 고정 — latest 자동 pull을 막아 공급망 표면을 줄인다. CSP script-src도 esm.run으로 한정.
    const webllm = await import('https://esm.run/@mlc-ai/web-llm@0.2.84');
    llmEngine = await webllm.CreateMLCEngine(modelId, {
      initProgressCallback: (p) =>
        { llmStatus.textContent = `${modelId.split('-q4')[0]} 준비 중 ${Math.round((p.progress ?? 0) * 100)}% — 처음 한 번만 내려받습니다`; },
    });
    llmStatus.textContent = `✅ 온디바이스 LLM 준비됨 (${modelId.split('-q4')[0]}) — 답변이 기기 GPU에서 생성됩니다`;
    return true;
  }

  llmBtn.addEventListener('click', async () => {
    if (llmEngine || builtinReady || llmLoading) return;
    llmLoading = true; llmBtn.disabled = true; llmSelect.disabled = true;
    const choice = llmSelect.value;
    try {
      // 내장 AI 우선 (auto/builtin 선택 시) — 다운로드 부담이 없다
      if (choice === 'auto' || choice === 'builtin') {
        if (await tryBuiltin()) { llmLoading = false; return; }
        if (choice === 'builtin') {
          llmStatus.textContent = '이 브라우저엔 내장 AI가 없습니다 (크롬 148+ 필요) — 아래에서 모델을 골라 다시 켜주세요.';
          llmBtn.disabled = false; llmSelect.disabled = false; llmLoading = false;
          return;
        }
      }
      const modelId = choice.startsWith('Qwen') ? choice : autoModel();
      if (!(await loadWebLlm(modelId))) { llmBtn.disabled = false; llmSelect.disabled = false; }
    } catch (err) {
      llmEngine = null;
      llmBtn.disabled = false; llmSelect.disabled = false;
      llmStatus.textContent = `LLM 로드 실패 (${String(err.message ?? err).slice(0, 50)}) — 규칙 기반으로 답합니다.`;
    }
    llmLoading = false;
  });

  // 소형(0.5~1.5B) 모델용: 컨텍스트를 짧고 단순하게 — 긴 JSON은 소형 모델이 무시하기 쉽다
  function llmContext() {
    const lines = [];
    lines.push(`저장소: ${state.repo}`);
    for (const m of state.members) {
      lines.push(`멤버 ${m.name}: ${m.working ? '지금 작업 중' : '최근 푸시 없음'}${m.summary ? ` — ${m.summary}` : ''}`);
    }
    for (const x of state.quests) {
      lines.push(`진행 중 ${x.id} ${x.title} (담당 ${x.owner})${x.blocked ? ' — CI 실패로 막힘' : ''}`);
    }
    state.did.slice(0, 8).forEach((d) => lines.push(`완료 ${d.who}: ${d.what} (${relTime(d.at)})`));
    return lines.join('\n');
  }

  async function llmOnce(q) {
    const res = await llmEngine.chat.completions.create({
      messages: [
        {
          role: 'system',
          content:
            '너는 개발팀 현황판의 안내원이다. 아래 데이터만 근거로 질문에 한국어로 짧게 답하라. ' +
            '데이터에 없는 내용은 "데이터에 없습니다"라고 답하라.\n\n' + llmContext(),
        },
        { role: 'user', content: q },
      ],
      max_tokens: 300,
      temperature: 0.2,
    });
    return res.choices?.[0]?.message?.content?.trim();
  }

  // 크롬 내장 AI: 질문마다 새 세션 (컨텍스트 누적·쿼터 문제 방지)
  async function builtinOnce(q) {
    const session = await LanguageModel.create();
    try {
      const answer = await session.prompt(
        '너는 개발팀 현황판의 안내원이다. 아래 데이터만 근거로 질문에 한국어로 짧게 답하라. ' +
        '데이터에 없는 내용은 "데이터에 없습니다"라고 답하라.\n\n' +
        llmContext() + '\n\n질문: ' + q
      );
      return answer?.trim();
    } finally {
      session.destroy?.();
    }
  }

  async function askClient(q) {
    if (builtinReady) {
      try {
        return (await builtinOnce(q)) || clientRules(q);
      } catch { /* 내장 실패 → WebLLM/규칙으로 */ }
    }
    if (!llmEngine) return clientRules(q);
    try {
      return (await llmOnce(q)) || clientRules(q);
    } catch {
      // 모바일 WebGPU에서 간헐적 버퍼 오류(mapAsync 등) — 대화 상태 리셋 후 1회 재시도
      try {
        await llmEngine.resetChat();
        return (await llmOnce(q)) || clientRules(q);
      } catch (err) {
        llmStatus.textContent = `LLM 오류(${String(err.message ?? err).slice(0, 40)}) — 이번 답은 규칙 기반입니다`;
        return clientRules(q);
      }
    }
  }

  document.getElementById('ask-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('ask-input');
    const btn = e.target.querySelector('button');
    const q = input.value.trim();
    if (!q) return;
    say('me', q); input.value = ''; btn.disabled = true;
    try {
      if (staticMode) {
        say('bot', await askClient(q));
      } else {
        const res = await fetch('api/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: q }),
        });
        const data = await res.json();
        say('bot', data.answer ?? data.error ?? '응답 없음');
      }
    } catch (err) {
      say('bot', '응답 실패: ' + err.message);
    } finally {
      btn.disabled = false; input.focus();
    }
  });

  // ---- Evidence 갤러리 --------------------------------------------------
  const lb = document.getElementById('lightbox');
  lb.addEventListener('click', () => lb.classList.remove('open'));
  addEventListener('keydown', (e) => { if (e.key === 'Escape') lb.classList.remove('open'); });

  async function loadEvidence() {
    const src = staticMode ? 'evidence.json' : 'api/evidence';
    const items = await fetch(src, { cache: 'no-cache' }).then((r) => r.json()).catch(() => []);
    const strip = document.getElementById('strip');
    if (!items.length) return;
    strip.innerHTML = '';
    for (const it of items) {
      const btn = document.createElement('button');
      btn.className = 'shot'; btn.type = 'button';
      const img = document.createElement('img');
      img.src = it.url; img.alt = it.caption; img.loading = 'lazy';
      const cap = document.createElement('div');
      cap.className = 'cap';
      cap.innerHTML = `<b>${escapeHtml(it.branch)}</b> ${escapeHtml(it.caption)}${it.createdAt ? '<br>' + relTime(it.createdAt) : ''}`;
      btn.append(img, cap);
      btn.addEventListener('click', () => {
        lb.querySelector('img').src = it.url;
        lb.querySelector('.cap').innerHTML =
          `<b>${escapeHtml(it.caption)}</b> <span>· ${escapeHtml(it.branch)} · ${escapeHtml(it.file)}</span>`;
        lb.classList.add('open');
      });
      strip.appendChild(btn);
    }
  }
  init().then(() => {
    loadEvidence();
    setInterval(loadEvidence, 60000);
  });
  frame();
})();
