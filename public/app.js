(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');
const actions = {};
let timers = [];
const every = (fn, ms) => timers.push(setInterval(fn, ms));
const clearTimers = () => { timers.forEach(clearInterval); timers = []; };
const num = (n) => Math.round((+n || 0) * 100) / 100;
const bc = (s) => String(s).replace(/\s+/g, '-');
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const fmtClock = (s) => { s = Math.max(0, s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(x).padStart(2, '0'); };
const tok = () => localStorage.getItem('adminToken');
const LOAD = '<div class="load"><div class="spinner"></div></div>';

/* ---------- core helpers ---------- */
async function api(url, { method = 'GET', body, as } = {}) {
  const h = {};
  const isFile = body instanceof Blob;
  if (body) h['Content-Type'] = isFile ? 'application/octet-stream' : 'application/json';
  if (isFile) h['x-filename'] = encodeURIComponent(body.name);
  if (as === 'admin') h.Authorization = 'Bearer ' + tok();
  if (as === 'student') h['x-attempt-token'] = localStorage.getItem('attemptToken') || '';
  let r;
  try { r = await fetch(url, { method, headers: h, body: isFile ? body : body && JSON.stringify(body) }); }
  catch { throw new Error('Network error — check your connection and try again.'); }
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && as === 'admin') {
    localStorage.removeItem('adminToken');
    if (location.hash === '#/admin') route(); else location.hash = '#/admin';
    throw Object.assign(new Error('Session expired'), { status: 401 });
  }
  if (!r.ok) throw Object.assign(new Error(d.error || 'Request failed.'), { status: r.status });
  return d;
}
async function busy(btn, fn) {
  if (btn) { btn.classList.add('busy'); btn.disabled = true; }
  try { return await fn(); }
  catch (e) { if (e.message !== 'Session expired') toast(e.message, 'err'); }
  finally { if (btn) { btn.classList.remove('busy'); btn.disabled = false; } }
}
function toast(m, t = 'ok') {
  const d = document.createElement('div');
  d.className = 'toast ' + (t === 'err' ? 'err' : '');
  d.textContent = m;
  $('#toasts').append(d);
  setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 300); }, 3800);
}
const modal = (html, wide) => { const o = $('#overlay'); o.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${html}</div>`; o.classList.add('on'); };
const closeModal = () => { const o = $('#overlay'); o.classList.remove('on'); o.innerHTML = ''; };
const confirmBox = (title, msg, ok = 'Confirm', danger = false) => new Promise((res) => {
  modal(`<h3>${esc(title)}</h3><p class="mut">${esc(msg)}</p><div class="row end"><button class="btn ghost" data-act="cno">Cancel</button><button class="btn ${danger ? 'danger' : 'pri'}" data-act="cyes">${esc(ok)}</button></div>`);
  actions.cno = () => { closeModal(); res(false); };
  actions.cyes = () => { closeModal(); res(true); };
});
const head = (extra = '') => `<header class="top"><a class="brand" href="/"><img src="/favicon.svg" alt="">ExamHub</a><div class="row">${extra}<button class="icon" data-act="theme" aria-label="Toggle dark mode">${document.documentElement.dataset.theme === 'dark' ? '☀️' : '🌙'}</button></div></header>`;
const failView = (m) => `${head()}<div class="empty"><h2>Something went wrong</h2><p>${esc(m)}</p><button class="btn pri" data-act="reload">Try again</button></div>`;

document.addEventListener('click', (e) => { const t = e.target.closest('[data-act]'); if (t && actions[t.dataset.act]) actions[t.dataset.act](t, e); });
actions.theme = (b) => { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = t; localStorage.setItem('theme', t); b.textContent = t === 'dark' ? '☀️' : '🌙'; };
actions.mclose = closeModal;
actions.reload = () => route();

/* ---------- student: join ---------- */
const ICONS = {
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  refresh: '<path d="M20 11a8 8 0 10-2.3 5.7"/><path d="M20 4v7h-7"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  moon: '<path d="M21 13A9 9 0 1111 3a7 7 0 0010 10z"/>',
  file: '<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
};
const ico = (n) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;
const FEATS = [
  ['clock', 'Live countdown timer', 'A clear timer that turns amber, then red, as time runs low and submits your work automatically at zero.'],
  ['key', 'One code for the whole class', 'Your teacher shares a single exam code. Type your name and the code. No account, no password.'],
  ['list', 'Easy question navigation', 'Jump to any question, see what you have answered, and move back and forth freely.'],
  ['refresh', 'Refresh-proof', 'Answers save as you go. Reload the page or lose signal and carry on where you stopped.'],
  ['bolt', 'Instant results', 'Objective questions are marked the moment you submit, with score, percentage and pass or fail.'],
  ['eye', 'Detailed answer review', 'See every correct answer and explanation so each mistake becomes something you learn from.'],
  ['phone', 'Works on any device', 'Designed for phones, tablets and school computers alike, with large touch-friendly controls.'],
  ['moon', 'Light and dark mode', 'Switch themes to stay comfortable during long exams. Your choice is remembered.'],
  ['shield', 'Fair by design', 'One attempt per student, a server-side clock, and answers locked once submitted.'],
];
const TEACH = [
  ['file', 'Import from PDF or Word', 'Upload an existing paper and it is turned into a ready-to-edit exam in seconds.'],
  ['chart', 'Live monitoring', 'See who is taking the exam, how far they have got and how much time is left.'],
  ['download', 'Export results', 'Download CSV, Excel or PDF reports, filtered by exam, status or student.'],
  ['list', 'AI-assisted questions', 'Generate questions with AI, or write multiple choice, true/false and short answers yourself, with marks and explanations.'],
  ['clock', 'Scheduling', 'Set open and close times, duration, passing marks and instructions for each exam.'],
  ['bolt', 'Manual grading', 'Review short answers and award marks. The final score updates straight away.'],
];
const FAQ = [
  ['Do I need an account?', 'No. Enter your full name and the exam code from your teacher. That is all.'],
  ['What happens when the timer reaches zero?', 'Your answers are submitted automatically. The clock runs on the server, so it cannot be paused by refreshing or closing the page.'],
  ['What if my internet drops or I refresh the page?', 'Your answers are saved as you go. Open the site again on the same device and you will continue where you left off, with the correct time remaining.'],
  ['Can I change my answers?', 'Yes, as often as you like until you submit. Use the review step to check unanswered questions first.'],
  ['When do I see my results?', 'Immediately after submitting. Multiple choice and true/false are marked instantly. Short answers may show as awaiting your teacher until they are graded.'],
  ['Can I take the exam twice?', 'No. Each student can submit an exam once. If something went wrong, ask your teacher to reset your attempt.'],
];
function viewJoin() {
  if (localStorage.getItem('attemptToken')) { location.hash = '#/exam'; return; }
  const card = ([i, t, d], k) => `<article class="card feat rv" style="--d:${(k % 3) * 80}ms"><span class="fi">${ico(i)}</span><h3>${t}</h3><p class="mut" style="margin:0">${d}</p></article>`;
  const nav = ['features:Features', 'how:How it works', 'teachers:For teachers', 'faq:FAQ'].map((s) => { const [k, l] = s.split(':'); return `<button class="btn ghost sm" data-act="scroll" data-to="${k}">${l}</button>`; }).join('');
  app.innerHTML = head(`<nav class="row hide-sm">${nav}</nav>`) + `<main>
  <section class="join"><div><h1>Sit your exam. No account needed.</h1><p class="lede">Write your full name and the code your teacher gave you. The timer only starts after you confirm.</p>
  <div class="chips"><span>No sign-up</span><span>Auto-submit</span><span>Instant results</span><span>Any device</span></div>
  <button class="btn ghost" data-act="scroll" data-to="how" style="margin-top:22px">See how it works</button></div>
  <form id="join" class="sheet" novalidate><label>Full name<input name="name" maxlength="80" autocomplete="name" placeholder="Abebe Kebede" required></label>
  <label>Exam code<input name="code" class="code" maxlength="12" autocapitalize="characters" autocomplete="off" placeholder="K7M2QX9R" required></label>
  <button class="btn pri block">Continue</button></form></section>
  <section class="band"><div class="band-in">${[['key', 'One shared code'], ['clock', 'Server-side timer'], ['bolt', 'Instant marking'], ['phone', 'Phone friendly']].map(([i, t]) => `<div class="rv"><span class="fi">${ico(i)}</span><b>${t}</b></div>`).join('')}</div></section>
  <section class="sec" id="features"><div class="sec-in"><h2 class="rv">Everything you need to sit an exam with confidence</h2><p class="mut rv">A calm, distraction-free exam room that works the same on every device.</p><div class="grid g3">${FEATS.map(card).join('')}</div></div></section>
  <section class="sec alt" id="how"><div class="sec-in"><h2 class="rv">Three steps to finish your exam</h2><p class="mut rv">From code to score in a few minutes.</p><div class="grid g3">${[['Get your code', 'Your teacher gives the whole class one exam code, on the board or in a message.'], ['Enter your name', 'Type your full name and the code, read the instructions, then press start.'], ['Answer and submit', 'Work through the questions, review your answers and submit to see your results straight away.']].map(([t, d], k) => `<article class="card feat step rv" style="--d:${k * 90}ms"><span class="num">${k + 1}</span><h3>${t}</h3><p class="mut" style="margin:0">${d}</p></article>`).join('')}</div></div></section>
  <section class="sec" id="teachers"><div class="sec-in"><h2 class="rv">Built for schools and teachers</h2><p class="mut rv">Create exams, share one code, and let the system do the marking.</p><div class="grid g3">${TEACH.map(card).join('')}</div></div></section>
  <section class="sec alt" id="faq"><div class="sec-in" style="max-width:780px"><h2 class="rv">Frequently asked questions</h2><div class="faq">${FAQ.map(([q, a]) => `<details class="card rv"><summary>${q}</summary><p class="mut">${a}</p></details>`).join('')}</div></div></section>
  <section class="sec"><div class="sec-in"><div class="cta-in rv"><h2 style="margin-bottom:8px">Ready when you are</h2><p style="opacity:.9">Have your name and exam code to hand, then take the exam.</p><button class="btn inv" data-act="scroll" data-to="top">Enter exam code</button></div></div></section></main>`;
  $('#join').onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    busy($('button', e.target), async () => {
      const i = await api('/api/student/lookup', { method: 'POST', body: f });
      modal(`<h3>${esc(i.title)}</h3><p class="mut">${esc(i.subject)}</p>
        <div class="grid g2" style="margin:12px 0"><div class="card stat"><b>${i.duration}</b><span>minutes</span></div><div class="card stat"><b>${i.questions}</b><span>questions · ${num(i.total)} marks</span></div></div>
        ${i.instructions ? `<h3>Instructions</h3><p style="white-space:pre-wrap">${esc(i.instructions)}</p>` : ''}
        <p class="sm mut">Pass mark: ${num(i.passMarks)}. Answers save automatically, and refreshing the page will not lose your place.</p>
        <div class="row end"><button class="btn ghost" data-act="mclose">Cancel</button><button class="btn pri" data-act="begin">Start exam now</button></div>`);
      actions.begin = (b) => busy(b, async () => {
        const { token } = await api('/api/student/start', { method: 'POST', body: f });
        localStorage.setItem('attemptToken', token); closeModal(); location.hash = '#/exam';
      });
    });
  };
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((x) => { if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target); } }), { threshold: 0.12 }) : null;
  app.querySelectorAll('.rv').forEach((el) => (io ? io.observe(el) : el.classList.add('in')));
}
actions.scroll = (b) => {
  const top = b.dataset.to === 'top';
  (top ? document.body : document.getElementById(b.dataset.to)).scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (top) setTimeout(() => $('#join input')?.focus({ preventScroll: true }), 600);
};

/* ---------- student: exam ---------- */
let S = null;
const val = (q) => String(S.answers[q.id] ?? '');
const answeredCount = () => S.questions.filter((q) => val(q).trim() !== '').length;
async function viewExam() {
  if (!localStorage.getItem('attemptToken')) { location.hash = '#/'; return; }
  app.innerHTML = LOAD;
  let d;
  try { d = await api('/api/student/attempt', { as: 'student' }); }
  catch (e) {
    if (e.status === 401) { localStorage.removeItem('attemptToken'); toast('Exam session not found. Please enter your details again.', 'err'); location.hash = '#/'; return; }
    app.innerHTML = failView(e.message); return;
  }
  if (d.submitted) { location.hash = '#/result'; return; }
  S = { ...d, i: 0, deadline: Date.now() + d.remaining, busy: false, t: {} };
  window.onbeforeunload = (e) => { e.preventDefault(); e.returnValue = ''; };
  app.innerHTML = head(`<span class="mut sm">${esc(S.name)}</span><span class="timer" id="timer">--:--</span>`) + `
  <main class="wrap"><div class="row between" style="margin-bottom:12px"><div><h3 style="margin:0">${esc(S.exam.title)}</h3><span class="mut sm">${esc(S.exam.subject)}</span></div><span class="sm mut" id="saved"></span></div>
  <div class="bar" style="margin-bottom:18px"><i id="prog" style="width:0"></i></div>
  <div class="exam"><section class="card pad q" id="qbox"></section>
  <aside class="card pad"><h3>Questions</h3><div class="qnav" id="qnav"></div><p class="sm mut" id="count" style="margin:14px 0"></p><button class="btn pri block" data-act="review">Review and submit</button></aside></div></main>`;
  paintQ(); paintNav(); tick(); every(tick, 250);
}
function tick() {
  const el = $('#timer'); if (!el || !S) return;
  const s = Math.ceil((S.deadline - Date.now()) / 1000);
  el.textContent = fmtClock(s);
  el.className = 'timer' + (s <= 60 ? ' crit' : s <= 300 ? ' warn' : '');
  if (s <= 0 && !S.busy) submitExam(true);
}
function paintQ() {
  const q = S.questions[S.i], v = val(q), n = S.questions.length;
  let body;
  if (q.type === 'mcq') body = q.options.map((o, j) => `<label class="opt"><input type="radio" name="a" value="${j}" ${v === String(j) ? 'checked' : ''}><span>${esc(o)}</span></label>`).join('');
  else if (q.type === 'tf') body = ['true', 'false'].map((o) => `<label class="opt"><input type="radio" name="a" value="${o}" ${v === o ? 'checked' : ''}><span>${o === 'true' ? 'True' : 'False'}</span></label>`).join('');
  else body = `<textarea id="short" maxlength="2000" placeholder="Type your answer here">${esc(v)}</textarea>`;
  $('#qbox').innerHTML = `<div class="row between"><span class="badge">Question ${S.i + 1} of ${n}</span><span class="badge">${num(q.marks)} mark${q.marks === 1 ? '' : 's'}</span></div>
    <h2 style="white-space:pre-wrap">${esc(q.text)}</h2>${body}
    <div class="row between" style="margin-top:18px"><button class="btn" data-act="prev" ${S.i === 0 ? 'disabled' : ''}>Previous</button>
    ${v !== '' ? '<button class="btn ghost sm" data-act="clear">Clear answer</button>' : '<span></span>'}
    ${S.i < n - 1 ? '<button class="btn pri" data-act="next">Next</button>' : '<button class="btn pri" data-act="review">Review and submit</button>'}</div>`;
}
function paintNav() {
  $('#qnav').innerHTML = S.questions.map((q, j) => `<button data-act="go" data-i="${j}" class="${val(q).trim() ? 'done ' : ''}${j === S.i ? 'cur' : ''}" aria-label="Question ${j + 1}">${j + 1}</button>`).join('');
  const a = answeredCount(), n = S.questions.length;
  $('#prog').style.width = (a / n) * 100 + '%';
  $('#count').textContent = `${a} of ${n} answered`;
}
const setSaved = (t) => { const e = $('#saved'); if (e) e.textContent = t; };
async function save(qid, v) {
  setSaved('Saving…');
  try { await api('/api/student/answer', { method: 'PUT', as: 'student', body: { questionId: qid, response: v } }); setSaved('All changes saved'); }
  catch (e) { if (e.status === 409) { location.hash = '#/result'; return; } setSaved('Offline. Answers will be sent on submit.'); }
}
function setAnswer(q, v) {
  S.answers[q.id] = v; paintNav();
  clearTimeout(S.t[q.id]);
  S.t[q.id] = setTimeout(() => save(q.id, v), q.type === 'short' ? 700 : 0);
}
document.addEventListener('input', (e) => {
  if (!S || !$('#qbox') || !$('#qbox').contains(e.target)) return;
  if (e.target.name === 'a' || e.target.id === 'short') setAnswer(S.questions[S.i], e.target.value);
});
const goto = (i) => { S.i = Math.max(0, Math.min(S.questions.length - 1, i)); paintQ(); paintNav(); };
actions.prev = () => goto(S.i - 1);
actions.next = () => goto(S.i + 1);
actions.go = (b) => goto(+b.dataset.i);
actions.clear = () => { setAnswer(S.questions[S.i], ''); paintQ(); };
actions.review = () => {
  const un = S.questions.map((q, j) => (val(q).trim() ? 0 : j + 1)).filter(Boolean);
  modal(`<h3>Ready to submit?</h3><p>You answered <b>${answeredCount()}</b> of <b>${S.questions.length}</b> questions.</p>
    ${un.length ? `<p class="sm" style="color:var(--warn)">Unanswered: ${un.join(', ')}</p>` : ''}
    <p class="sm mut">You cannot change your answers after submitting.</p>
    <div class="row end"><button class="btn ghost" data-act="mclose">Keep working</button><button class="btn pri" data-act="finish">Submit exam</button></div>`);
};
actions.finish = () => { closeModal(); submitExam(false); };
async function submitExam(auto) {
  if (S.busy) return;
  S.busy = true;
  modal(`<div class="ctr"><div class="spinner"></div><p style="margin-top:14px">${auto ? 'Time is up. Submitting your answers…' : 'Submitting your exam…'}</p></div>`);
  const tries = auto ? 5 : 1;
  for (let k = 0; k < tries; k++) {
    try {
      await api('/api/student/submit', { method: 'POST', as: 'student', body: { answers: S.answers } });
      window.onbeforeunload = null; clearTimers(); closeModal(); location.hash = '#/result'; return;
    } catch (e) {
      if (k === tries - 1) { closeModal(); S.busy = false; toast(e.message + ' Your answers are still saved. Try again.', 'err'); return; }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

/* ---------- student: result ---------- */
const show = (q, v) => (v === '' ? '<i>No answer</i>' : q.type === 'mcq' ? esc(String.fromCharCode(65 + +v) + '. ' + (q.options[+v] ?? '')) : q.type === 'tf' ? (v === 'true' ? 'True' : 'False') : esc(v));
const correctText = (q) => (q.type === 'short' ? (q.answer ? esc(q.answer.split('|').join(' / ')) : 'Marked by your teacher') : show(q, q.answer));
const LABEL = { correct: 'Correct', incorrect: 'Incorrect', partial: 'Partly correct', pending: 'Awaiting grade' };
function revHTML(q, i, extra = '') {
  return `<article class="card rev ${q.result}"><div class="row between"><b>Question ${i + 1}</b><span class="row"><span class="badge ${q.result}">${LABEL[q.result]}</span><span class="badge">${num(q.awarded)} / ${num(q.marks)}</span></span></div>
  <p style="margin:10px 0;white-space:pre-wrap">${esc(q.text)}</p>
  <div class="ans ${q.result === 'correct' ? 'good' : q.result === 'pending' ? '' : 'bad'}"><span class="mut">Answer given: </span>${show(q, q.response)}</div>
  ${q.result !== 'correct' ? `<div class="ans good"><span class="mut">Correct answer: </span>${correctText(q)}</div>` : ''}
  ${q.explanation ? `<p class="sm mut" style="margin:8px 0 0">Explanation: ${esc(q.explanation)}</p>` : ''}${extra}</article>`;
}
async function viewResult() {
  if (!localStorage.getItem('attemptToken')) { location.hash = '#/'; return; }
  app.innerHTML = LOAD;
  let r;
  try { r = await api('/api/student/result', { as: 'student' }); }
  catch (e) {
    if (e.status === 409) { location.hash = '#/exam'; return; }
    if (e.status === 401) { localStorage.removeItem('attemptToken'); location.hash = '#/'; return; }
    app.innerHTML = failView(e.message); return;
  }
  const c = r.review.filter((x) => x.result === 'correct').length;
  const w = r.review.filter((x) => x.result === 'incorrect' || x.result === 'partial').length;
  const p = r.review.filter((x) => x.result === 'pending').length;
  const col = r.status === 'Pass' ? 'var(--ok)' : r.status === 'Fail' ? 'var(--mark)' : 'var(--warn)';
  app.innerHTML = head() + `<main class="wrap fade"><div class="card pad row" style="gap:28px">
    <div class="ring" style="--p:${r.pct};--c:${col}"><div>${r.pct}%</div></div>
    <div class="grow"><span class="badge ${bc(r.status)}">${esc(r.status)}</span><h2 style="margin-top:8px">${esc(r.name)}</h2>
    <p class="mut">${esc(r.exam)}${r.auto ? ' · submitted automatically when time ran out' : ''}</p>
    <div class="row" style="gap:22px"><div><b>${num(r.score)}</b> / ${num(r.total)} marks</div><div>Pass mark <b>${num(r.passMarks)}</b></div>
    <div style="color:var(--ok)">${c} correct</div><div style="color:var(--mark)">${w} incorrect</div>${p ? `<div style="color:var(--warn)">${p} awaiting teacher</div>` : ''}</div>
    ${p ? '<p class="sm mut" style="margin:10px 0 0">Your teacher marks short-answer questions by hand, so your final score may change.</p>' : ''}</div></div>
    <h3 style="margin:26px 0 12px">Answer review</h3>${r.review.map((q, i) => revHTML(q, i)).join('')}
    <div class="row end"><button class="btn pri" data-act="done">Finish</button></div></main>`;
}
actions.done = () => { localStorage.removeItem('attemptToken'); S = null; location.hash = '#/'; route(); };

/* ---------- admin: shell, login ---------- */
function viewLogin() {
  app.innerHTML = head('<a class="btn ghost sm" href="/">Student portal</a>') + `<main class="wrap" style="max-width:440px;margin-top:6vh"><form id="login" class="card pad fade"><h2>Admin sign in</h2><p class="mut">Manage exams and review results.</p>
  <label>Username<input name="username" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label>
  <button class="btn pri block">Sign in</button></form></main>`;
  $('#login').onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    busy($('button', e.target), async () => { const r = await api('/api/admin/login', { method: 'POST', body: f }); localStorage.setItem('adminToken', r.token); location.hash = '#/admin/dashboard'; route(); });
  };
}
const TABS = [['dashboard', 'Dashboard'], ['exams', 'Exams'], ['live', 'Live monitor'], ['results', 'Results']];
function adminShell(active, inner) {
  app.innerHTML = head('<button class="btn ghost sm" data-act="logout">Log out</button>') +
    `<nav class="tabs">${TABS.map(([k, l]) => `<a href="#/admin/${k}" class="${k === active ? 'on' : ''}">${l}</a>`).join('')}</nav><main class="wrap fade">${inner}</main>`;
}
actions.logout = () => { localStorage.removeItem('adminToken'); location.hash = '#/admin'; route(); };
actions.pw = () => modal(`<h3>Change password</h3><label>Current password<input id="op" type="password" autocomplete="current-password"></label><label>New password (at least 8 characters)<input id="np" type="password" autocomplete="new-password"></label><div class="row end"><button class="btn ghost" data-act="mclose">Cancel</button><button class="btn pri" data-act="savepw">Update password</button></div>`);
actions.savepw = (b) => busy(b, async () => { await api('/api/admin/password', { method: 'POST', as: 'admin', body: { oldPassword: $('#op').value, newPassword: $('#np').value } }); closeModal(); toast('Password updated'); });

/* ---------- admin: dashboard & exams ---------- */
async function viewDash() {
  adminShell('dashboard', LOAD);
  const [s, ex] = await Promise.all([api('/api/admin/stats', { as: 'admin' }), api('/api/admin/exams', { as: 'admin' })]);
  $('main').innerHTML = `<div class="row between" style="margin-bottom:16px"><div><h2 style="margin:0">Overview</h2><p class="mut" style="margin:0">What is happening across your exams.</p></div>
    <div class="row"><button class="btn ghost" data-act="pw">Change password</button><button class="btn" data-act="aigo">Generate with AI</button><button class="btn" data-act="imp">Import PDF / Word</button><a class="btn pri" href="#/admin/exam/new">New exam</a></div></div>
    <div class="grid g4">${[['Exams', s.exams], ['Open now', s.open], ['Taking an exam now', s.active], ['Submissions', s.submissions], ['Average score', s.avg + '%'], ['Pass rate', s.passRate + '%'], ['Needs grading', s.pending]].map(([l, v]) => `<div class="card stat"><b>${v}</b><span>${l}</span></div>`).join('')}</div>
    <h3 style="margin:28px 0 12px">Recent exams</h3>
    ${ex.length ? `<div class="card scroll"><table><thead><tr><th>Exam</th><th>Code</th><th>Status</th><th>Questions</th><th>Attempts</th></tr></thead><tbody>${ex.slice(0, 6).map((e) => `<tr><td><a href="#/admin/exam/${e.id}"><b>${esc(e.title)}</b></a></td><td><button class="codechip" data-act="copy" data-v="${esc(e.code)}">${esc(e.code)}</button></td><td><span class="badge ${e.state}">${e.state}</span></td><td>${e.qn}</td><td>${e.attempts}</td></tr>`).join('')}</tbody></table></div>` : '<div class="card empty"><p>No exams yet. Create one to get started.</p></div>'}`;
}
const examCard = (e) => `<article class="card pad"><div class="row between"><span class="badge ${e.state}">${e.state}</span><span class="sm mut">${e.attempts} attempt${e.attempts === 1 ? '' : 's'}</span></div>
  <h3 style="margin-top:10px">${esc(e.title)}</h3><p class="mut sm" style="margin:0 0 10px">${esc(e.subject) || 'No subject'}</p>
  <div class="row" style="margin-bottom:10px"><button class="codechip" data-act="copy" data-v="${esc(e.code)}" title="Copy access code">${esc(e.code)}</button><span class="sm mut">Exam code for all students · tap to copy</span></div>
  <p class="sm mut">${e.qn} questions · ${num(e.total)} marks · ${e.duration} min · pass at ${num(e.pass_marks)}<br>Opens: ${e.start_at ? fmtDate(e.start_at) : 'immediately'}<br>Closes: ${e.end_at ? fmtDate(e.end_at) : 'no deadline'}</p>
  <div class="row"><a class="btn sm" href="#/admin/exam/${e.id}">Edit</a><button class="btn sm" data-act="pub" data-id="${e.id}" data-on="${e.published ? 0 : 1}">${e.published ? 'Unpublish' : 'Publish'}</button><button class="btn sm danger" data-act="delexam" data-id="${e.id}">Delete</button></div></article>`;
async function viewExams() {
  adminShell('exams', LOAD);
  const ex = await api('/api/admin/exams', { as: 'admin' });
  $('main').innerHTML = `<div class="row between" style="margin-bottom:16px"><h2 style="margin:0">Exams</h2><div class="row"><button class="btn" data-act="aigo">Generate with AI</button><button class="btn" data-act="imp">Import PDF / Word</button><a class="btn pri" href="#/admin/exam/new">New exam</a></div></div>` +
    (ex.length ? `<div class="grid g3">${ex.map(examCard).join('')}</div>` : '<div class="card empty"><h3>No exams yet</h3><p>Create an exam, add questions, then share its access code with students.</p><a class="btn pri" href="#/admin/exam/new">Create exam</a></div>');
}
actions.copy = (b) => { const v = b.dataset.v; (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(() => toast('Code copied: ' + v), () => toast('Access code: ' + v)); };
actions.pub = (b) => busy(b, async () => { await api(`/api/admin/exams/${b.dataset.id}/publish`, { method: 'POST', as: 'admin', body: { published: +b.dataset.on === 1 } }); toast(+b.dataset.on ? 'Exam published' : 'Exam unpublished'); route(); });
actions.delexam = async (b) => { if (await confirmBox('Delete this exam?', 'This permanently deletes the exam, its questions and every student result.', 'Delete exam', true)) busy(b, async () => { await api(`/api/admin/exams/${b.dataset.id}`, { method: 'DELETE', as: 'admin' }); toast('Exam deleted'); route(); }); };

/* ---------- admin: exam editor ---------- */
let E = null, PENDING = null, PENDING_AI = false;
const toLocal = (ms) => (ms ? new Date(ms - new Date(ms).getTimezoneOffset() * 6e4).toISOString().slice(0, 16) : '');
const blankQ = (type) => ({ type, text: '', options: type === 'mcq' ? ['', '', '', ''] : null, answer: type === 'mcq' ? '0' : type === 'tf' ? 'true' : '', marks: 1, explanation: '' });
async function viewEditor(id) {
  adminShell('exams', LOAD);
  if (id === 'new') E = { id: null, locked: false, exam: { title: '', subject: '', duration: 30, pass_marks: 0, instructions: '', start: '', end: '', published: false }, qs: [blankQ('mcq')] };
  else {
    const d = await api(`/api/admin/exams/${id}`, { as: 'admin' });
    E = { id: d.id, locked: d.locked, code: d.code, exam: { title: d.title, subject: d.subject, duration: d.duration, pass_marks: d.pass_marks, instructions: d.instructions, start: toLocal(d.start_at), end: toLocal(d.end_at), published: !!d.published }, qs: d.questions.map((q) => ({ type: q.type, text: q.text, options: q.options || (q.type === 'mcq' ? ['', ''] : null), answer: q.answer, marks: q.marks, explanation: q.explanation })) };
  }
  const x = E.exam;
  $('main').innerHTML = `<div class="row between" style="margin-bottom:14px"><div><a class="sm" href="#/admin/exams">Back to exams</a><h2 style="margin:4px 0 0">${E.id ? 'Edit exam' : 'New exam'}</h2></div><div class="row"><button class="btn" data-act="ai">Generate with AI</button><button class="btn" data-act="imp">Import PDF / Word</button><button class="btn pri" data-act="saveExam">Save exam</button></div></div>
  <details class="card pad sm" style="margin-bottom:14px"><summary><b>Importing a PDF, Word or text file?</b> See the supported format</summary>
  <p class="mut">Number each question, list options as A. B. C. D., and add an <code>Answer:</code> line. True/false questions have no options. Short answers list accepted answers separated by |. The <code>Explanation:</code> line (also Reason, Rationale, Solution, Why, Feedback) is imported as the explanation shown to students after the exam and can run over several lines. Also understood: <code>Marks:</code> or (2 marks), options on one line (A) x B) y), an option ending in ✓ or * (or typed in bold in Word) as the correct answer, and Q1 / Question 1 / (1) numbering. An <code>Answer Key</code> section at the end also works. Scanned (image-only) PDFs cannot be read.</p>
  <pre class="fmt">Title: Term 1 Science
Duration: 45 minutes
Passing marks: 6

1. What is the chemical symbol for water? (2 marks)
A. H2O
B. CO2
C. NaCl
Answer: A
Explanation: Two hydrogen atoms, one oxygen atom.

2. The sun is a star.
Answer: True

3. Name the process plants use to make food.
Answer: photosynthesis | photo synthesis</pre>
  <a href="/exam-template.txt" download>Download a sample template</a></details>
  <div id="ed"><div class="card pad"><div class="grid g2">
  <label>Title<input data-f="title" maxlength="150" value="${esc(x.title)}" placeholder="Term 1 Mathematics"></label>
  <label>Subject<input data-f="subject" maxlength="100" value="${esc(x.subject)}" placeholder="Mathematics, Grade 9"></label>
  <label>Duration (minutes)<input type="number" min="1" max="600" data-f="duration" value="${x.duration}"></label>
  <label>Passing marks<input type="number" min="0" step="0.5" data-f="pass_marks" value="${x.pass_marks}"></label>
  <label>Opens (optional)<input type="datetime-local" data-f="start" value="${x.start}"></label>
  <label>Closes: last time to start (optional)<input type="datetime-local" data-f="end" value="${x.end}"></label></div>
  <label>Instructions for students<textarea data-f="instructions" maxlength="3000">${esc(x.instructions)}</textarea></label>
  <label class="row" style="gap:10px;margin:0"><input type="checkbox" data-f="published" ${x.published ? 'checked' : ''}> Published: students can enter with the access code</label>
  <p class="sm mut" style="margin:10px 0 0">${E.code ? `Exam code for all students: <b>${esc(E.code)}</b> (permanent, one code per exam)` : 'One unique exam code is generated automatically when you save. Every student uses the same code.'}</p></div>
  <div class="row between" style="margin:24px 0 12px"><h3 style="margin:0">Questions · <span id="tm">0</span> marks in total</h3>
  <div class="row" ${E.locked ? 'hidden' : ''}><button class="btn sm" data-act="addq" data-t="mcq">Add multiple choice</button><button class="btn sm" data-act="addq" data-t="tf">Add true / false</button><button class="btn sm" data-act="addq" data-t="short">Add short answer</button></div></div>
  ${E.locked ? '<div class="card pad sm" style="margin-bottom:14px;border-left:5px solid var(--warn)">Students have already started this exam, so its questions are locked. Reset or delete their attempts to change them.</div>' : ''}
  <div id="qs"></div></div>`;
  renderQs();
  if (PENDING_AI) { PENDING_AI = false; actions.ai($('[data-act=ai]')); }
  if (PENDING) { const d = PENDING; PENDING = null; try { applyImport(d); } catch (e) { toast(e.message, 'err'); } }
}
function qHTML(q, i) {
  const sel = (v, l, cur) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${l}</option>`;
  let body;
  if (q.type === 'mcq') body = '<p class="sm mut" style="margin:6px 0">Select the circle beside the correct option.</p>' + q.options.map((o, j) => `<div class="optrow"><input type="radio" name="c${i}" data-q="${i}" data-k="answer" value="${j}" ${q.answer === String(j) ? 'checked' : ''} aria-label="Mark option ${j + 1} as correct"><input data-q="${i}" data-k="o${j}" value="${esc(o)}" placeholder="Option ${String.fromCharCode(65 + j)}">${q.options.length > 2 ? `<button class="btn sm ghost" data-act="delopt" data-q="${i}" data-j="${j}" aria-label="Remove option">Remove</button>` : ''}</div>`).join('') + (q.options.length < 6 ? `<button class="btn sm" data-act="addopt" data-q="${i}">Add option</button>` : '');
  else if (q.type === 'tf') body = `<label>Correct answer<select data-q="${i}" data-k="answer">${sel('true', 'True', q.answer)}${sel('false', 'False', q.answer)}</select></label>`;
  else body = `<label>Accepted answers (optional)<input data-q="${i}" data-k="answer" value="${esc(q.answer)}" placeholder="photosynthesis | photo synthesis"></label><p class="sm mut" style="margin-top:-6px">Exact matches, ignoring case, are marked automatically. Everything else waits for you to grade it. Separate alternatives with |</p>`;
  return `<div class="card qed">${q.warn ? `<div class="warnbadge sm">Check this question: ${esc(q.warn)}</div>` : ''}<div class="row between"><b>Question ${i + 1}</b><div class="row"><select style="width:auto;margin:0" data-q="${i}" data-k="type">${sel('mcq', 'Multiple choice', q.type)}${sel('tf', 'True / False', q.type)}${sel('short', 'Short answer', q.type)}</select><button class="btn sm danger" data-act="delq" data-i="${i}">Remove</button></div></div>
  <label style="margin-top:12px">Question<textarea data-q="${i}" data-k="text" style="min-height:70px">${esc(q.text)}</textarea></label>${body}
  <div class="grid g2"><label>Marks<input type="number" min="0.5" step="0.5" data-q="${i}" data-k="marks" value="${q.marks}"></label><label>Explanation shown after the exam (optional)<input data-q="${i}" data-k="explanation" value="${esc(q.explanation)}"></label></div></div>`;
}
const sumMarks = () => { const el = $('#tm'); if (el && E) el.textContent = num(E.qs.reduce((t, q) => t + (+q.marks || 0), 0)); };
function renderQs() {
  $('#qs').innerHTML = E.qs.length ? `<fieldset ${E.locked ? 'disabled' : ''}>${E.qs.map(qHTML).join('')}</fieldset>` : '<div class="card empty">No questions yet. Add one with the buttons above.</div>';
  sumMarks();
}
document.addEventListener('input', (e) => {
  const t = e.target;
  if (!E || !t.closest || !t.closest('#ed')) return;
  if (t.dataset.f) { E.exam[t.dataset.f] = t.type === 'checkbox' ? t.checked : t.value; return; }
  if (t.dataset.q === undefined) return;
  const i = +t.dataset.q, Q = E.qs[i], k = t.dataset.k;
  if (Q.warn) { delete Q.warn; t.closest('.qed')?.querySelector('.warnbadge')?.remove(); }
  if (k === 'type') { E.qs[i] = { ...blankQ(t.value), text: Q.text, marks: Q.marks, explanation: Q.explanation }; renderQs(); }
  else if (/^o\d$/.test(k)) Q.options[+k.slice(1)] = t.value;
  else { Q[k] = t.value; if (k === 'marks') sumMarks(); }
});
actions.addq = (b) => { E.qs.push(blankQ(b.dataset.t)); renderQs(); $('#qs').lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'end' }); };
actions.delq = (b) => { E.qs.splice(+b.dataset.i, 1); renderQs(); };
actions.addopt = (b) => { E.qs[+b.dataset.q].options.push(''); renderQs(); };
actions.delopt = (b) => {
  const Q = E.qs[+b.dataset.q], j = +b.dataset.j;
  Q.options.splice(j, 1);
  Q.answer = +Q.answer === j ? '0' : +Q.answer > j ? String(+Q.answer - 1) : Q.answer;
  renderQs();
};
actions.saveExam = (b) => busy(b, async () => {
  const x = E.exam;
  const body = { title: x.title, subject: x.subject, duration: +x.duration, pass_marks: +x.pass_marks, instructions: x.instructions, published: x.published, start_at: x.start ? new Date(x.start).getTime() : null, end_at: x.end ? new Date(x.end).getTime() : null };
  if (!E.locked) body.questions = E.qs;
  const r = await api(E.id ? `/api/admin/exams/${E.id}` : '/api/admin/exams', { method: E.id ? 'PUT' : 'POST', as: 'admin', body });
  toast(E.id ? 'Exam saved' : `Exam created. Exam code for all students: ${r.code}`); location.hash = '#/admin/exams';
});
function applyImport(d) {
  if (E.locked) throw new Error('Questions are locked because students already started this exam.');
  const m = d.exam, x = E.exam;
  if (!x.title.trim()) x.title = m.title || d.fileName || '';
  if (!x.subject.trim() && m.subject) x.subject = m.subject;
  if (!x.instructions.trim() && m.instructions) x.instructions = m.instructions;
  if (m.duration) x.duration = m.duration;
  if (m.pass_marks != null) x.pass_marks = m.pass_marks;
  document.querySelectorAll('#ed [data-f]').forEach((el) => { const v = x[el.dataset.f]; if (el.type === 'checkbox') el.checked = !!v; else el.value = v ?? ''; });
  const blank = E.qs.length === 1 && !E.qs[0].text.trim();
  E.qs = (blank ? [] : E.qs).concat(d.questions);
  renderQs();
  const c = (t) => d.questions.filter((q) => q.type === t).length;
  modal(`<h3>Imported ${d.questions.length} question${d.questions.length === 1 ? '' : 's'}</h3>
    <p class="mut">${c('mcq')} multiple choice · ${c('tf')} true/false · ${c('short')} short answer. Review them, fix anything that looks off, then save the exam.</p>
    ${d.warnings.length ? `<div class="card pad sm" style="border-left:5px solid var(--warn);margin-bottom:12px"><b>Please check:</b><ul style="margin:6px 0 0;padding-left:18px">${d.warnings.slice(0, 12).map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
    <div class="row end"><button class="btn pri" data-act="mclose">Review questions</button></div>`);
}
actions.imp = (b) => {
  const inEditor = /^#\/admin\/exam\//.test(location.hash) && E;
  if (inEditor && E.locked) return toast('Questions are locked because students already started this exam.', 'err');
  const i = document.createElement('input');
  i.type = 'file'; i.accept = '.pdf,.docx,.txt';
  i.onchange = () => { const f = i.files[0]; if (!f) return; busy(b, async () => {
    if (f.size > 4 * 1024 * 1024) throw new Error('File is too large (maximum 4 MB). Try a smaller file or split the exam.');
    const d = await api('/api/admin/import', { method: 'POST', as: 'admin', body: f });
    d.fileName = f.name.replace(/\.[^.]+$/, '');
    if (inEditor) applyImport(d); else { PENDING = d; location.hash = '#/admin/exam/new'; }
    toast(`${d.questions.length} questions imported`);
  }); };
  i.click();
};

/* ---------- admin: AI question generator ---------- */
const aiOpts = () => ({
  topic: $('#ai-topic').value, level: $('#ai-level').value, count: +$('#ai-count').value, difficulty: $('#ai-diff').value, language: $('#ai-lang').value,
  marks: +$('#ai-marks').value || 1, types: [...document.querySelectorAll('#overlay [name=ait]:checked')].map((x) => x.value), extra: $('#ai-extra').value, source: $('#ai-src').value,
});
function finishAi(d, o) {
  const n = d.questions.length;
  d.questions.forEach((q) => { q.marks = o.marks; });
  d.exam.title = d.exam.title || `${o.topic || 'AI'} Quiz`.slice(0, 150);
  d.exam.subject = d.exam.subject || o.topic.slice(0, 100);
  d.exam.duration = d.exam.duration || Math.max(5, Math.ceil(n * 1.5));
  if (d.exam.pass_marks == null) d.exam.pass_marks = Math.ceil((n * o.marks) / 2);
  d.fileName = o.topic;
  closeModal(); applyImport(d);
}
actions.aigo = () => { PENDING_AI = true; location.hash = '#/admin/exam/new'; };
actions.ai = (b) => busy(b, async () => {
  if (E && E.locked) throw new Error('Questions are locked because students already started this exam.');
  const st = await api('/api/admin/ai/status', { as: 'admin' });
  const chk = (v, l, on) => `<label class="row" style="gap:8px;margin:0 14px 0 0;font-weight:500"><input type="checkbox" name="ait" value="${v}" ${on ? 'checked' : ''}> ${l}</label>`;
  modal(`<h3>Generate questions with AI</h3>
  <div class="grid g2"><label>Topic<input id="ai-topic" maxlength="300" placeholder="Photosynthesis"></label><label>Level or grade<input id="ai-level" maxlength="100" placeholder="Grade 9"></label>
  <label>Number of questions<input id="ai-count" type="number" min="1" max="50" value="10"></label>
  <label>Difficulty<select id="ai-diff"><option value="mixed">Mixed</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></label>
  <label>Language<input id="ai-lang" maxlength="50" value="English"></label><label>Marks per question<input id="ai-marks" type="number" min="0.5" step="0.5" value="1"></label></div>
  <div class="row" style="margin-bottom:14px">${chk('mcq', 'Multiple choice', 1)}${chk('tf', 'True / false', 1)}${chk('short', 'Short answer', 0)}</div>
  <label>Extra instructions (optional)<textarea id="ai-extra" maxlength="600" style="min-height:60px" placeholder="Focus on chapters 3 and 4. Use examples from Ethiopia."></textarea></label>
  <details style="margin-bottom:14px"><summary class="sm"><b>Base the questions on your own text</b> (optional)</summary><textarea id="ai-src" maxlength="6000" style="min-height:110px" placeholder="Paste lesson notes here"></textarea></details>
  <div class="row" style="margin-bottom:14px"><button class="btn sm pri" data-act="aitab" data-t="paste">Free: ChatGPT copy and paste</button><button class="btn sm" data-act="aitab" data-t="auto">Automatic (API key)</button></div>
  <div id="ai-paste"><p class="sm mut">The free ChatGPT app cannot be connected directly to other software, so this works by copy and paste. No key, no cost.</p>
  <ol class="sm" style="padding-left:18px;margin:0 0 12px"><li>Press <b>Copy prompt</b> and paste it into <a href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer">ChatGPT</a>.</li><li>Copy the whole reply and paste it below.</li><li>Press <b>Convert to questions</b>.</li></ol>
  <button class="btn pri sm" data-act="aiprompt" style="margin-bottom:10px">Copy prompt</button>
  <textarea id="ai-prompt" class="fmt" readonly hidden style="width:100%;min-height:120px;margin-bottom:10px"></textarea>
  <label>ChatGPT's reply<textarea id="ai-reply" style="min-height:140px" placeholder="Paste the reply here"></textarea></label><button class="btn pri" data-act="aiparse">Convert to questions</button></div>
  <div id="ai-auto" hidden>${st.enabled ? `<p class="sm mut">Uses <b>${esc(st.model)}</b> through ${esc(st.host)}. This can take up to 30 seconds.</p><button class="btn pri" data-act="aigen">Generate questions</button>` : '<p class="sm">Not set up yet. Add <code>AI_API_KEY</code> (and optionally <code>AI_BASE_URL</code> and <code>AI_MODEL</code>) to your environment variables and redeploy. See the README, section "AI question generator". Until then, use the free copy-and-paste tab.</p>'}</div>
  <div class="row end" style="margin-top:16px"><button class="btn ghost" data-act="mclose">Close</button></div>`, true);
});
actions.aitab = (b) => {
  document.querySelectorAll('[data-act=aitab]').forEach((x) => x.classList.toggle('pri', x === b));
  $('#ai-paste').hidden = b.dataset.t !== 'paste'; $('#ai-auto').hidden = b.dataset.t !== 'auto';
};
actions.aiprompt = (b) => busy(b, async () => {
  const { prompt } = await api('/api/admin/ai/prompt', { method: 'POST', as: 'admin', body: aiOpts() });
  const t = $('#ai-prompt'); t.value = prompt; t.hidden = false;
  try { await navigator.clipboard.writeText(prompt); toast('Prompt copied. Paste it into ChatGPT.'); } catch { t.select(); toast('Select and copy the prompt shown below.'); }
});
actions.aiparse = (b) => busy(b, async () => {
  const o = aiOpts(), text = $('#ai-reply').value;
  if (text.trim().length < 20) throw new Error("Paste ChatGPT's reply first.");
  finishAi(await api('/api/admin/parse', { method: 'POST', as: 'admin', body: { text } }), o);
});
actions.aigen = (b) => busy(b, async () => { const o = aiOpts(); finishAi(await api('/api/admin/ai/generate', { method: 'POST', as: 'admin', body: o }), o); });

/* ---------- admin: live monitor ---------- */
async function viewLive() {
  adminShell('live', '<div class="row between"><h2 style="margin:0">Live monitor</h2><span class="sm mut" id="lt">Refreshes every 4 seconds</span></div><div id="lv" class="card" style="margin-top:14px">' + LOAD + '</div>');
  const refresh = async () => {
    try {
      const r = await api('/api/admin/live', { as: 'admin' });
      const el = $('#lv'); if (!el) return;
      el.innerHTML = r.length ? `<div class="scroll"><table><thead><tr><th>Student</th><th>Exam</th><th style="min-width:190px">Progress</th><th>Time left</th><th>Started</th></tr></thead><tbody>${r.map((a) => `<tr><td><b>${esc(a.name)}</b></td><td>${esc(a.exam)}</td><td><div class="row" style="flex-wrap:nowrap"><div class="bar grow"><i style="width:${a.total ? (a.answered / a.total) * 100 : 0}%"></i></div><span class="sm">${a.answered}/${a.total}</span></div></td><td><span class="badge ${a.remaining < 300 ? 'pending' : ''}">${fmtClock(a.remaining)}</span></td><td>${fmtDate(a.startedAt)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><h3>No one is taking an exam right now</h3><p>Students appear here the moment they start.</p></div>';
    } catch (e) { const t = $('#lt'); if (t) t.textContent = e.message; }
  };
  await refresh(); every(refresh, 4000);
}

/* ---------- admin: results ---------- */
let R = { exam: '', status: '', q: '' }, rtimer;
const query = () => new URLSearchParams({ exam_id: R.exam, status: R.status, q: R.q }).toString();
async function viewResults() {
  adminShell('results', LOAD);
  const ex = await api('/api/admin/exams', { as: 'admin' });
  $('main').innerHTML = `<div class="row between" style="margin-bottom:14px"><h2 style="margin:0">Results</h2><div class="row"><span class="sm mut">Export</span><button class="btn sm" data-act="exp" data-f="csv">CSV</button><button class="btn sm" data-act="exp" data-f="xlsx">Excel</button><button class="btn sm" data-act="exp" data-f="pdf">PDF</button></div></div>
  <div class="card pad" style="margin-bottom:14px"><div class="grid g3">
  <label style="margin:0">Exam<select id="fx"><option value="">All exams</option>${ex.map((e) => `<option value="${e.id}" ${+R.exam === e.id ? 'selected' : ''}>${esc(e.title)}</option>`).join('')}</select></label>
  <label style="margin:0">Status<select id="fs">${['', 'Pass', 'Fail', 'Pending review', 'In progress'].map((s) => `<option value="${s}" ${R.status === s ? 'selected' : ''}>${s || 'All statuses'}</option>`).join('')}</select></label>
  <label style="margin:0">Student<input id="fq" placeholder="Search by name" value="${esc(R.q)}"></label></div></div><div class="card" id="rt">${LOAD}</div>`;
  ['fx', 'fs', 'fq'].forEach((id) => $('#' + id).addEventListener('input', () => { R = { exam: $('#fx').value, status: $('#fs').value, q: $('#fq').value }; clearTimeout(rtimer); rtimer = setTimeout(loadResults, 250); }));
  loadResults();
}
async function loadResults() {
  try {
    const rows = await api('/api/admin/results?' + query(), { as: 'admin' });
    const el = $('#rt'); if (!el) return;
    el.innerHTML = rows.length ? `<div class="scroll"><table><thead><tr><th>Student</th><th>Exam</th><th>Score</th><th>%</th><th>Status</th><th>Submitted</th><th></th></tr></thead><tbody>${rows.map((s) => `<tr><td><b>${esc(s.name)}</b></td><td>${esc(s.exam)}</td><td>${num(s.score)} / ${num(s.total)}</td><td>${s.pct}%</td><td><span class="badge ${bc(s.status)}">${s.status}</span></td><td>${fmtDate(s.submittedAt)}</td><td class="right"><button class="btn sm" data-act="att" data-id="${s.id}" ${s.submittedAt ? '' : 'disabled'}>Review and grade</button> <button class="btn sm ghost" data-act="delatt" data-id="${s.id}">Reset</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><h3>No results match</h3><p>Results appear here as students submit their exams.</p></div>';
  } catch (e) { if (e.message !== 'Session expired') toast(e.message, 'err'); }
}
actions.exp = (b) => busy(b, async () => {
  const r = await fetch(`/api/admin/export/${b.dataset.f}?` + query(), { headers: { Authorization: 'Bearer ' + tok() } });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Export failed.');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await r.blob());
  a.download = `results-${new Date().toISOString().slice(0, 10)}.${b.dataset.f}`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  toast('Export ready');
});
async function openAttempt(id) {
  const a = await api(`/api/admin/attempts/${id}`, { as: 'admin' });
  const grader = (q) => (q.type === 'short' ? `<div class="row" style="margin-top:10px"><label style="margin:0" class="sm">Marks awarded</label><input type="number" id="g${q.id}" min="0" max="${q.marks}" step="0.5" value="${q.awarded ?? ''}" style="width:90px;margin:0"><span class="sm mut">of ${num(q.marks)}</span><button class="btn sm pri" data-act="grade" data-a="${a.id}" data-q="${q.id}">Save marks</button></div>` : '');
  modal(`<div class="row between"><div><h3 style="margin:0">${esc(a.name)}</h3><span class="mut sm">${esc(a.exam)}</span></div><span class="badge ${bc(a.status)}">${a.status}</span></div>
    <p style="margin:10px 0 16px"><b>${num(a.score)}</b> / ${num(a.total)} marks · ${a.pct}% · pass mark ${num(a.passMarks)}</p>${a.review.map((q, i) => revHTML(q, i, grader(q))).join('')}
    <div class="row end"><button class="btn pri" data-act="mclose">Close</button></div>`, true);
}
actions.att = (b) => busy(b, () => openAttempt(b.dataset.id));
actions.grade = (b) => busy(b, async () => {
  const v = $('#g' + b.dataset.q).value;
  if (v === '') throw new Error('Enter the marks to award.');
  await api(`/api/admin/attempts/${b.dataset.a}/grade`, { method: 'PUT', as: 'admin', body: { questionId: +b.dataset.q, awarded: +v } });
  toast('Marks saved'); await openAttempt(b.dataset.a); loadResults();
});
actions.delatt = async (b) => {
  if (await confirmBox('Reset this attempt?', 'The submission and its answers are deleted, so the student can take the exam again.', 'Reset attempt', true))
    busy(b, async () => { await api(`/api/admin/attempts/${b.dataset.id}`, { method: 'DELETE', as: 'admin' }); toast('Attempt reset'); loadResults(); });
};

/* ---------- router ---------- */
async function route() {
  clearTimers(); closeModal(); window.onbeforeunload = null;
  let p = location.hash.replace(/^#\/?/, '').split('/');
  const onAdmin = location.pathname.replace(/\/+$/, '') === '/admin';
  if (onAdmin && p[0] !== 'admin') p = ['admin'];
  if (!onAdmin && p[0] === 'admin') { location.replace('/admin' + (p[1] ? '#/admin/' + p.slice(1).join('/') : '')); return; }
  try {
    if (p[0] === 'exam') return await viewExam();
    if (p[0] === 'result') return await viewResult();
    if (p[0] === 'admin') {
      if (!tok()) return viewLogin();
      const v = p[1] || 'dashboard';
      if (v === 'exams') return await viewExams();
      if (v === 'exam') return await viewEditor(p[2] || 'new');
      if (v === 'live') return await viewLive();
      if (v === 'results') return await viewResults();
      return await viewDash();
    }
    viewJoin();
  } catch (e) {
    if (e.message === 'Session expired') return;
    app.innerHTML = failView(e.message);
  }
}
addEventListener('hashchange', route);
route();
})();
