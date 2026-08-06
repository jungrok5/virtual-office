// Guild HQ 프론트: /api/state + SSE로 스냅샷을 받고,
// 픽셀 씬(활동만 그린다 — 출퇴근 없음) · 퀘스트 보드 · Q&A · Evidence 갤러리를 렌더링한다.

(() => {
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
  function tick(type, text, at) {
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
    document.getElementById('repo-label').textContent =
      `${state.repo}${state.demo ? ' · 데모 재생 중' : ''} · ${relTime(state.generatedAt)} 갱신`;
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

  // ---- 데이터 연결: SSE + 폴백 폴링 -------------------------------------
  function connect() {
    const es = new EventSource('/events');
    es.onmessage = (e) => applyState(JSON.parse(e.data));
    es.onerror = () => { es.close(); setTimeout(connect, 5000); };
  }
  fetch('/api/state').then((r) => r.json()).then((s) => { if (!s.loading) applyState(s); });
  connect();

  // ---- Q&A --------------------------------------------------------------
  const chat = document.getElementById('chat');
  function say(cls, text) {
    const el = document.createElement('div');
    el.className = 'msg ' + cls; el.textContent = text;
    chat.appendChild(el); chat.scrollTop = chat.scrollHeight;
  }
  document.getElementById('ask-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('ask-input');
    const btn = e.target.querySelector('button');
    const q = input.value.trim();
    if (!q) return;
    say('me', q); input.value = ''; btn.disabled = true;
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();
      say('bot', data.answer ?? data.error ?? '응답 없음');
    } catch (err) {
      say('bot', '서버 연결 실패: ' + err.message);
    } finally {
      btn.disabled = false; input.focus();
    }
  });

  // ---- Evidence 갤러리 --------------------------------------------------
  const lb = document.getElementById('lightbox');
  lb.addEventListener('click', () => lb.classList.remove('open'));
  addEventListener('keydown', (e) => { if (e.key === 'Escape') lb.classList.remove('open'); });

  async function loadEvidence() {
    const items = await fetch('/api/evidence').then((r) => r.json()).catch(() => []);
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
  loadEvidence();
  setInterval(loadEvidence, 60000);

  frame();
})();
