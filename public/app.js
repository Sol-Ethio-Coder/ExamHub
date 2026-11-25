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
let ME = null; // signed-in admin: { username, name, role }
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
    localStorage.removeItem('adminToken'); ME = null;
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
let CFG = { brand: 'ExamHub', currency: 'ETB', trialDays: 14, plans: [], annualMonthsPaid: 10, paymentInstructions: '', contactEmail: '', contactPhone: '' };
async function loadCfg() { try { CFG = await api('/api/public/config'); } catch { /* defaults */ } document.title = CFG.brand + ' | Online exams for schools'; }
const head = (extra = '') => `<header class="top"><a class="brand" href="/"><img src="/favicon.svg" alt="">${esc(CFG.brand)}</a><div class="row">${extra}<button class="icon" data-act="theme" aria-label="Toggle dark mode">${document.documentElement.dataset.theme === 'dark' ? '☀️' : '🌙'}</button></div></header>`;
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
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.5a3.5 3.5 0 010 7M18 14.3c2.2.6 3.5 2.4 3.5 5.7"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
};
const ico = (n) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;
const FEATS = [
  ['file', 'Build exams in minutes', 'Write questions, import a Word or PDF paper, or generate questions with AI. Multiple choice, true/false and short answer.'],
  ['shield', 'Secure exam mode', 'Full screen, tab-switch detection, automatic submission after repeated violations, and optional Safe Exam Browser.'],
  ['bolt', 'Instant marking', 'Objective questions are marked the moment students submit. Teachers grade short answers in one click.'],
  ['users', 'Private teacher accounts', 'Every teacher has their own login and sees only their own exams, students and results.'],
  ['chart', 'Live monitoring and reports', 'Watch students in real time, then export results to CSV, Excel or PDF.'],
  ['key', 'One code, no student accounts', 'Students enter their name and a single exam code. Nothing to install and nothing to register.'],
];
const SECURITY = [
  ['clock', 'Server-side timer', 'The clock runs on the server, so refreshing or closing the page never gives extra time.'],
  ['lock', 'One attempt per student', 'Names are checked per exam, answers lock on submission, and a teacher can reset an attempt if needed.'],
  ['eye', 'Violation log', 'Every tab switch, window change or full-screen exit is recorded with a time stamp for the teacher.'],
  ['shield', 'Safe Exam Browser', 'Require the free Safe Exam Browser for high-stakes exams, on top of strict mode.'],
];
const FAQ = [
  ['Is there a free trial?', 'Yes. Every school gets a free trial with no payment card. You can create exams, add teachers and run real exams within the trial limits.'],
  ['How do we pay?', 'Choose a plan under Billing, pay using the instructions shown, and enter the payment reference. We confirm the payment and activate your plan.'],
  ['What happens if our subscription ends?', 'Your results stay available to view and export. Creating or publishing exams, and students starting new exams, pause until the subscription is renewed.'],
  ['Do students need accounts or an app?', 'No. Students open the website, type their full name and the exam code, and start. It works in any modern browser on phones, tablets and computers.'],
  ['Can teachers see each other\'s exams?', 'No. Each teacher\'s exams, students and results are private to them. The school administrator manages teacher accounts but does not see their exam content.'],
  ['Can students still cheat?', 'Strict mode discourages and records cheating, and Safe Exam Browser makes it much harder. No website can make it impossible, so for high-stakes exams we recommend invigilation as well.'],
  ['What internet connection do we need?', 'Students need a working connection while taking the exam. Answers are saved as they go, and a refresh or a short drop in connection does not lose their place.'],
];
function viewJoin() {
  if (localStorage.getItem('attemptToken')) { location.hash = '#/exam'; return; }
  const card = ([i, t, d], k) => `<article class="card feat rv" style="--d:${(k % 3) * 80}ms"><span class="fi">${ico(i)}</span><h3>${t}</h3><p class="mut" style="margin:0">${d}</p></article>`;
  const nav = ['features:Features', 'security:Security', 'pricing:Pricing', 'faq:FAQ', 'contact:Contact'].map((s) => { const [k, l] = s.split(':'); return `<button class="btn ghost sm" data-act="scroll" data-to="${k}">${l}</button>`; }).join('');
  const money = (n) => `${Number(n).toLocaleString()} ${CFG.currency}`;
  const planCard = (p, k) => `<article class="card plan rv ${p.key === 'school' ? 'pop' : ''}" style="--d:${k * 80}ms">${p.key === 'school' ? '<span class="badge open pill">Most popular</span>' : ''}<h3>${esc(p.name)}</h3>
    <div class="price"><b>${p.price ? Number(p.price).toLocaleString() : 'Free'}</b>${p.price ? `<span> ${CFG.currency} / month</span>` : `<span> for ${CFG.trialDays} days</span>`}</div>
    <ul><li>Up to <b>${p.maxTeachers}</b> teachers</li><li>Up to <b>${p.maxExams}</b> exams</li><li><b>${Number(p.maxAttemptsPerMonth).toLocaleString()}</b> student exams per month</li><li>Secure exam mode</li><li>Import from Word or PDF</li>${p.ai ? '<li>AI question generator</li>' : ''}<li>Results export (CSV, Excel, PDF)</li></ul>
    <a class="btn ${p.key === 'school' ? 'pri' : ''} block" href="#/signup">${p.price ? 'Start free trial' : 'Start free trial'}</a></article>`;
  app.innerHTML = head(`<nav class="row hide-sm">${nav}</nav><a class="btn ghost sm" href="/admin">School sign in</a><a class="btn pri sm" href="#/signup">Free trial</a>`) + `<main>
  <section class="join"><div><p class="eyebrow">Online exams for schools</p><h1>Run secure online exams for your whole school.</h1><p class="lede">Create exams in minutes, share one code and get instant marking. Teachers work privately and students need no accounts.</p>
  <div class="row" style="gap:12px;margin-top:22px"><a class="btn pri" href="#/signup">Start free trial</a><button class="btn ghost" data-act="scroll" data-to="contact">Book a demo</button></div>
  <div class="chips"><span>${CFG.trialDays}-day free trial</span><span>No card needed</span><span>Any device</span><span>Instant results</span></div></div>
  <form id="join" class="sheet" novalidate><h3 style="margin:0 0 16px">Student? Start your exam</h3><label>Full name<input name="name" maxlength="80" autocomplete="name" placeholder="Abebe Kebede" required></label>
  <label>Exam code<input name="code" class="code" maxlength="12" autocapitalize="characters" autocomplete="off" placeholder="K7M2QX9R" required></label>
  <button class="btn pri block">Continue</button></form></section>
  <section class="band"><div class="band-in">${[['users', 'Private teacher accounts'], ['shield', 'Secure exam mode'], ['bolt', 'Instant marking'], ['phone', 'Phones and computers']].map(([i, t]) => `<div class="rv"><span class="fi">${ico(i)}</span><b>${t}</b></div>`).join('')}</div></section>
  <section class="sec" id="features"><div class="sec-in"><h2 class="rv">Everything your school needs to run exams online</h2><p class="mut rv">From writing the paper to publishing results, in one simple platform.</p><div class="grid g3">${FEATS.map(card).join('')}</div></div></section>
  <section class="sec alt" id="how"><div class="sec-in"><h2 class="rv">Up and running in three steps</h2><p class="mut rv">No installation, no servers and no setup fees.</p><div class="grid g3">${[['Create your school account', `Start a ${CFG.trialDays}-day free trial with your email. No payment card needed.`], ['Add teachers and build exams', 'Invite your teachers, then create exams by typing, importing a Word or PDF paper, or using the AI generator.'], ['Share the code', 'Give students the exam code. They enter their name and sit the exam while you watch live. Results are ready the moment they submit.']].map(([t, d], k) => `<article class="card feat step rv" style="--d:${k * 90}ms"><span class="num">${k + 1}</span><h3>${t}</h3><p class="mut" style="margin:0">${d}</p></article>`).join('')}</div></div></section>
  <section class="sec" id="security"><div class="sec-in"><h2 class="rv">Built to keep exams fair</h2><p class="mut rv">Deterrence, detection and a clear record for every attempt.</p><div class="grid g2">${SECURITY.map(card).join('')}</div></div></section>
  <section class="sec alt" id="pricing"><div class="sec-in"><h2 class="rv">Simple pricing for schools</h2><p class="mut rv">Start free, then pick the plan that fits your school. Prices are per month in ${CFG.currency}. Pay for 12 months at once and get a discount.</p>
  <div class="pricegrid">${CFG.plans.map(planCard).join('')}</div><p class="sm mut ctr rv" style="margin-top:18px">${esc(CFG.paymentInstructions || '')}</p></div></section>
  <section class="sec" id="faq"><div class="sec-in" style="max-width:780px"><h2 class="rv">Frequently asked questions</h2><div class="faq">${FAQ.map(([q, a]) => `<details class="card rv"><summary>${q}</summary><p class="mut">${a}</p></details>`).join('')}</div></div></section>
  <section class="sec alt" id="contact"><div class="sec-in"><div class="grid g2" style="align-items:start"><div class="rv"><h2 style="text-align:left">Book a demo or ask us anything</h2><p class="mut">Tell us about your school and we will show you how ${esc(CFG.brand)} works with your own exams.</p>
  ${CFG.contactEmail ? `<p>${ico('mail')} <a href="mailto:${esc(CFG.contactEmail)}">${esc(CFG.contactEmail)}</a></p>` : ''}${CFG.contactPhone ? `<p>${ico('phone')} ${esc(CFG.contactPhone)}</p>` : ''}</div>
  <form id="contact" class="card pad rv"><label>School name<input name="school_name" maxlength="120"></label><label>Your name<input name="contact_name" maxlength="80" required></label>
  <div class="grid g2" style="gap:0 14px"><label>Email<input name="email" type="email" maxlength="120"></label><label>Phone<input name="phone" maxlength="40"></label></div>
  <label>Message<textarea name="message" maxlength="2000" style="min-height:90px" placeholder="How many students and teachers do you have?"></textarea></label><button class="btn pri block">Send message</button></form></div></div></section>
  <section class="sec"><div class="sec-in"><div class="cta-in rv"><h2 style="margin-bottom:8px">Give your teachers a better way to run exams</h2><p style="opacity:.9">Start your free trial today. No card, no installation.</p><a class="btn inv" href="#/signup">Start free trial</a></div></div></section>
  <footer class="sitefoot"><div class="row between"><b>${esc(CFG.brand)}</b><div class="row"><button class="btn ghost sm" data-act="scroll" data-to="pricing">Pricing</button><a class="btn ghost sm" href="#/signup">Free trial</a><a class="btn ghost sm" href="/admin">School sign in</a><a class="btn ghost sm" href="/terms.html">Terms</a><a class="btn ghost sm" href="/privacy.html">Privacy</a></div></div></footer></main>`;
  $('#contact').onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    busy($('button', e.target), async () => { await api('/api/public/contact', { method: 'POST', body: f }); e.target.reset(); toast('Thank you. We will contact you soon.'); });
  };
  $('#join').onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    busy($('button', e.target), async () => {
      const i = await api('/api/student/lookup', { method: 'POST', body: f });
      modal(`<h3>${esc(i.title)}</h3><p class="mut">${esc(i.subject)}${i.school ? ` · ${esc(i.school)}` : ''}</p>
        <div class="grid g2" style="margin:12px 0"><div class="card stat"><b>${i.duration}</b><span>minutes</span></div><div class="card stat"><b>${i.questions}</b><span>questions · ${num(i.total)} marks</span></div></div>
        ${i.instructions ? `<h3>Instructions</h3><p style="white-space:pre-wrap">${esc(i.instructions)}</p>` : ''}
        ${i.lockdown ? `<div class="card pad sm" style="border-left:5px solid var(--warn);margin-bottom:12px"><b>Secure exam mode</b><ul style="margin:6px 0 0;padding-left:18px"><li>The exam runs in full screen.</li><li>Switching tabs or windows, or leaving full screen, is recorded and shown to your teacher.</li><li>${i.maxViolations ? `After ${i.maxViolations} violations your exam is submitted automatically.` : 'Violations are recorded for your teacher.'}</li><li>Copying, pasting and right-click are disabled.</li></ul></div>` : ''}
        <p class="sm mut">Pass mark: ${num(i.passMarks)}. Answers save automatically, and refreshing the page will not lose your place.</p>
        <div class="row end"><button class="btn ghost" data-act="mclose">Cancel</button><button class="btn pri" data-act="begin">Start exam now</button></div>`);
      actions.begin = (b) => busy(b, async () => {
        if (i.lockdown && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
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
  <main class="wrap"><div class="row between" style="margin-bottom:12px"><div><h3 style="margin:0">${esc(S.exam.title)}</h3><span class="mut sm">${esc(S.exam.subject)}${S.exam.school ? ` · ${esc(S.exam.school)}` : ''}</span></div><span class="sm mut" id="saved"></span></div>
  <div class="bar" style="margin-bottom:18px"><i id="prog" style="width:0"></i></div>
  <div class="exam"><section class="card pad q" id="qbox"></section>
  <aside class="card pad"><h3>Questions</h3><div class="qnav" id="qnav"></div><p class="sm mut" id="count" style="margin:14px 0"></p><button class="btn pri block" data-act="review">Review and submit</button></aside></div></main>`;
  paintQ(); paintNav(); tick(); every(tick, 250);
  if (S.exam.lockdown) { lockStart(); lockGate(); }
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

/* ---------- secure (strict) mode ---------- */
// A web page cannot truly lock a computer. These measures deter cheating and record it for the teacher.
const FS_OK = !!document.documentElement.requestFullscreen;
const inFs = () => !!document.fullscreenElement;
let LK = null;
const VLABEL = { tab_hidden: 'You left the exam page (tab switch or minimised window).', window_blur: 'The exam window lost focus (another window or app).', fullscreen_exit: 'You left full screen.' };
const VTXT = { tab_hidden: 'Switched tab or minimised the window', window_blur: 'Window lost focus (another window or app)', fullscreen_exit: 'Left full screen' };
function showLock(html) {
  let el = $('#lockov');
  if (!el) { el = document.createElement('div'); el.id = 'lockov'; el.className = 'lockov'; document.body.append(el); }
  el.innerHTML = `<div class="lockbox" role="alertdialog" aria-modal="true">${html}</div>`;
}
const hideLock = () => { const el = $('#lockov'); if (el) el.remove(); };
function lockStart() {
  if (LK) return;
  LK = { last: 0, handlers: [] };
  document.body.classList.add('lockdown');
  const on = (target, type, fn) => { target.addEventListener(type, fn, true); LK.handlers.push([target, type, fn]); };
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  ['contextmenu', 'copy', 'cut', 'paste', 'dragstart', 'drop'].forEach((t) => on(document, t, stop));
  on(document, 'keydown', (e) => {
    const k = String(e.key).toLowerCase(), c = e.ctrlKey || e.metaKey;
    if (e.key === 'F12' || (c && e.shiftKey && ['i', 'j', 'c', 'k'].includes(k)) || (c && ['u', 's', 'p', 'c', 'v', 'x'].includes(k))) stop(e);
  });
  on(document, 'keyup', (e) => { if (e.key === 'PrintScreen') { try { navigator.clipboard.writeText(''); } catch { /* ignore */ } } });
  on(document, 'visibilitychange', () => { if (document.hidden) violation('tab_hidden'); });
  on(window, 'blur', (e) => { if (e.target === window) violation('window_blur'); });
  on(document, 'fullscreenchange', () => { if (FS_OK && !inFs()) violation('fullscreen_exit'); });
}
function lockStop() {
  hideLock();
  if (!LK) return;
  LK.handlers.forEach(([t, ty, fn]) => t.removeEventListener(ty, fn, true));
  LK = null;
  document.body.classList.remove('lockdown');
  if (inFs()) document.exitFullscreen().catch(() => {});
}
async function violation(type) {
  if (!LK || !S || S.busy) return;
  const t = Date.now();
  if (t - LK.last < 1500) return;
  LK.last = t;
  showLock(`<h2>Security warning</h2><p>${VLABEL[type]}</p><p class="mut">Recording…</p>`);
  let r = null;
  try { r = await api('/api/student/violation', { method: 'POST', as: 'student', body: { type } }); }
  catch (e) { if (e.status === 409) { lockStop(); location.hash = '#/result'; return; } }
  if (r && r.submitted) { window.onbeforeunload = null; clearTimers(); toast('Your exam was submitted automatically because of repeated security violations.', 'err'); location.hash = '#/result'; return; }
  const left = r && r.max ? r.max - r.violations : null;
  showLock(`<h2>Security warning</h2><p>${VLABEL[type]}</p>
    ${r ? `<p><b>Violation ${r.violations}${r.max ? ' of ' + r.max : ''}.</b> ${r.max ? `Your exam is submitted automatically after ${left} more.` : 'It has been recorded for your teacher.'}</p>` : '<p>This has been noted.</p>'}
    <p class="sm mut">Stay on this page until you finish. Opening other tabs, windows or apps is recorded and shown to your teacher. Your timer is still running.</p>
    <button class="btn pri" data-act="lkreturn">Return to exam</button>`);
}
actions.lkreturn = () => { if (FS_OK && !inFs()) document.documentElement.requestFullscreen().catch(() => {}); hideLock(); };
function lockGate() {
  if (!FS_OK || inFs()) return;
  showLock(`<h2>Secure exam mode</h2><p>This exam runs in full screen. Leaving the page, switching tabs or windows, or exiting full screen is recorded${S.exam.maxViolations ? ` and your exam is submitted automatically after ${S.exam.maxViolations} violations` : ''}. Copying, pasting and right-click are disabled.</p>
    <p class="sm mut">Your timer is already running.</p><button class="btn pri" data-act="lkreturn">Enter full screen and continue</button>`);
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
    <p class="mut">${esc(r.exam)}${r.autoReason === 'violations' ? ' · submitted automatically after repeated security violations' : r.auto ? ' · submitted automatically when time ran out' : ''}</p>
    <div class="row" style="gap:22px"><div><b>${num(r.score)}</b> / ${num(r.total)} marks</div><div>Pass mark <b>${num(r.passMarks)}</b></div>
    <div style="color:var(--ok)">${c} correct</div><div style="color:var(--mark)">${w} incorrect</div>${p ? `<div style="color:var(--warn)">${p} awaiting teacher</div>` : ''}</div>
    ${p ? '<p class="sm mut" style="margin:10px 0 0">Your teacher marks short-answer questions by hand, so your final score may change.</p>' : ''}</div></div>
    <h3 style="margin:26px 0 12px">Answer review</h3>${r.review.map((q, i) => revHTML(q, i)).join('')}
    <div class="row end"><button class="btn pri" data-act="done">Finish</button></div></main>`;
}
actions.done = () => { localStorage.removeItem('attemptToken'); S = null; location.hash = '#/'; route(); };

/* ---------- admin: shell, login ---------- */
function viewLogin() {
  app.innerHTML = head('<a class="btn ghost sm" href="/">Student portal</a>') + `<main class="wrap" style="max-width:440px;margin-top:6vh"><form id="login" class="card pad fade"><h2>School sign in</h2><p class="mut">Teachers, school administrators and the platform owner sign in here.</p>
  <label>Username<input name="username" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label>
  <button class="btn pri block">Sign in</button><p class="sm mut" style="margin:14px 0 0">New school? <a href="/#/signup">Start a free trial</a></p></form></main>`;
  $('#login').onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    busy($('button', e.target), async () => { const r = await api('/api/admin/login', { method: 'POST', body: f }); localStorage.setItem('adminToken', r.token); location.hash = '#/admin/dashboard'; route(); });
  };
}
const tabs = () => {
  if (!ME) return [];
  if (ME.role === 'superadmin') return [['platform', 'Overview'], ['schools', 'Schools'], ['payments', 'Payments'], ['leads', 'Leads']];
  return [['dashboard', 'Dashboard'], ['exams', 'Exams'], ['live', 'Live monitor'], ['results', 'Results'], ...(ME.role === 'school_admin' ? [['teachers', 'Teachers'], ['billing', 'Billing']] : [])];
};
function adminShell(active, inner) {
  app.innerHTML = head(`<span class="sm mut hide-sm">${esc((ME && ME.school ? ME.school.name + ' · ' : '') + ((ME && (ME.name || ME.username)) || ''))}</span><button class="btn ghost sm" data-act="logout">Log out</button>`) +
    `<nav class="tabs">${tabs().map(([k, l]) => `<a href="#/admin/${k}" class="${k === active ? 'on' : ''}">${l}</a>`).join('')}</nav>${banner()}<main class="wrap fade">${inner}</main>`;
}
actions.logout = () => { localStorage.removeItem('adminToken'); ME = null; location.hash = '#/admin'; route(); };
actions.pw = () => modal(`<h3>Change password</h3><label>Current password<input id="op" type="password" autocomplete="current-password"></label><label>New password (at least 8 characters)<input id="np" type="password" autocomplete="new-password"></label><div class="row end"><button class="btn ghost" data-act="mclose">Cancel</button><button class="btn pri" data-act="savepw">Update password</button></div>`);
actions.savepw = (b) => busy(b, async () => { await api('/api/admin/password', { method: 'POST', as: 'admin', body: { oldPassword: $('#op').value, newPassword: $('#np').value } }); closeModal(); toast('Password updated'); });

/* ---------- public sign-up ---------- */
function viewSignup() {
  app.innerHTML = head('<a class="btn ghost sm" href="/admin">School sign in</a>') + `<main class="wrap" style="max-width:540px;margin-top:4vh"><form id="su" class="card pad fade"><h2>Start your free trial</h2><p class="mut">${CFG.trialDays} days, no payment card. Create your school account, then add your teachers.</p>
  <label>School name<input name="school_name" maxlength="120" required></label><label>Your name<input name="admin_name" maxlength="80" autocomplete="name" required></label>
  <label>Email (this is your username)<input name="email" type="email" maxlength="120" autocomplete="email" required></label><label>Phone (optional)<input name="phone" maxlength="40" autocomplete="tel"></label>
  <label>Password (at least 8 characters)<input name="password" type="password" minlength="8" autocomplete="new-password" required></label>
  <button class="btn pri block">Create school account</button><p class="sm mut" style="margin:14px 0 0">Already registered? <a href="/admin">Sign in</a></p></form></main>`;
  $('#su').onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    busy($('button', e.target), async () => { const r = await api('/api/public/signup', { method: 'POST', body: f }); localStorage.setItem('adminToken', r.token); ME = null; location.assign('/admin'); });
  };
}

/* ---------- admin: subscription banner ---------- */
function banner() {
  const s = ME && ME.school;
  if (!s) return '';
  const link = ME.role === 'school_admin' ? ' <a href="#/admin/billing"><b>Open billing</b></a>' : ' Please ask your school administrator.';
  if (!s.active) return `<div class="banner bad">${s.state === 'suspended' ? 'This school account is suspended.' : 'Your subscription has ended. Exams cannot be created, published or started until it is renewed.'}${link}</div>`;
  if (s.status === 'trial' && s.daysLeft <= 5) return `<div class="banner warn">Your free trial ends in ${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'}.${link}</div>`;
  if (s.status === 'active' && s.daysLeft <= 7) return `<div class="banner warn">Your subscription ends in ${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'}.${link}</div>`;
  return '';
}

/* ---------- platform owner: overview, schools, payments, leads ---------- */
const fmtMoney = (n, c) => `${Number(n).toLocaleString()} ${c || CFG.currency}`;
async function viewPlatform() {
  adminShell('platform', LOAD);
  const s = await api('/api/admin/platform', { as: 'admin' });
  $('main').innerHTML = `<div class="row between" style="margin-bottom:16px"><div><h2 style="margin:0">Platform overview</h2><p class="mut" style="margin:0">Your schools, subscriptions and enquiries.</p></div><button class="btn" data-act="pw">Change password</button></div>
  <div class="grid g4">${[['Schools', s.schools], ['Active trials', s.trials], ['Paying schools', s.paying], ['Expired', s.expired], ['Suspended', s.suspended], ['Teachers', s.teachers], ['Student exams this month', s.attemptsMonth], ['Revenue this month', fmtMoney(s.revenueMonth, s.currency)], ['Pending payments', s.pendingPayments], ['New leads', s.newLeads]].map(([l, v]) => `<div class="card stat"><b>${v}</b><span>${l}</span></div>`).join('')}</div>
  ${s.pendingPayments ? '<p style="margin-top:18px"><a class="btn pri" href="#/admin/payments">Review pending payments</a></p>' : ''}`;
}
let SCH = [];
const sBadge = (s) => `<span class="badge ${s.state === 'active' ? 'Pass' : s.state === 'trial' ? 'pending' : 'Fail'}">${{ trial: 'Trial', active: 'Active', suspended: 'Suspended', expired: 'Expired' }[s.state] || s.state}</span>`;
const planOptions = (sel) => CFG.plans.map((p) => `<option value="${p.key}" ${p.key === sel ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
async function viewSchools() {
  adminShell('schools', LOAD);
  SCH = await api('/api/admin/schools', { as: 'admin' });
  $('main').innerHTML = `<div class="row between" style="margin-bottom:14px"><h2 style="margin:0">Schools</h2><button class="btn pri" data-act="adds">Add school</button></div>` + (SCH.length
    ? `<div class="card scroll"><table><thead><tr><th>School</th><th>Plan</th><th>Status</th><th>Ends</th><th>Teachers</th><th>Exams</th><th>Student exams (month)</th><th>Administrator</th><th></th></tr></thead><tbody>${SCH.map((s) => `<tr><td><b>${esc(s.name)}</b><br><span class="sm mut">Joined ${fmtDate(s.created_at)}</span></td><td>${esc(s.planName)}</td><td>${sBadge(s)}</td><td>${s.endsAt ? `${fmtDate(s.endsAt)} (${s.daysLeft}d)` : '—'}</td><td>${s.teachers}</td><td>${s.exams}</td><td>${s.attempts_month}</td><td>${esc(s.admin_username || '—')}</td><td class="right"><button class="btn sm" data-act="msch" data-id="${s.id}">Manage</button></td></tr>`).join('')}</tbody></table></div>`
    : '<div class="card empty"><h3>No schools yet</h3><p>Schools appear here when they sign up. You can also add one yourself.</p></div>');
}
actions.adds = () => modal(`<h3>Add a school</h3><div class="grid g2"><label>School name<input id="sn" maxlength="120"></label><label>Administrator name<input id="sa" maxlength="80"></label>
  <label>Administrator username or email<input id="su2" maxlength="80" autocomplete="off"></label><label>Temporary password<input id="sp" value="${randomPw()}" autocomplete="off"></label>
  <label>Plan<select id="spl">${planOptions('trial')}</select></label><label>Months paid (paid plans)<input id="smo" type="number" min="1" max="36" value="1"></label></div>
  <div class="row end"><button class="btn ghost" data-act="mclose">Cancel</button><button class="btn pri" data-act="saves">Create school</button></div>`, true);
actions.saves = (b) => busy(b, async () => {
  await api('/api/admin/schools', { method: 'POST', as: 'admin', body: { school_name: $('#sn').value, admin_name: $('#sa').value, username: $('#su2').value, password: $('#sp').value, plan: $('#spl').value, months: +$('#smo').value } });
  closeModal(); toast('School created. Share the username and password with the administrator.'); route();
});
actions.msch = (b) => {
  const s = SCH.find((x) => x.id === +b.dataset.id);
  modal(`<h3>${esc(s.name)}</h3><p class="sm mut">Administrator: ${esc(s.admin_username || 'none yet')} · ${sBadge(s)}${s.endsAt ? ` · ends ${fmtDate(s.endsAt)}` : ''}</p>
  <div class="grid g2"><label>School name<input id="mn" value="${esc(s.name)}" maxlength="120"></label><label>Plan<select id="mp">${planOptions(s.plan)}</select></label>
  <label>Status<select id="ms"><option value="trial" ${s.status === 'trial' ? 'selected' : ''}>Trial</option><option value="active" ${s.status === 'active' ? 'selected' : ''}>Active (paid)</option><option value="suspended" ${s.status === 'suspended' ? 'selected' : ''}>Suspended</option></select></label>
  <label>Extend by (days)<input id="me" type="number" min="0" max="3650" value="0"></label></div>
  <div class="row between"><div class="row"><button class="btn sm" data-act="addadm" data-id="${s.id}">Add administrator</button><button class="btn sm danger" data-act="delsch" data-id="${s.id}" data-n="${esc(s.name)}">Delete</button></div>
  <div class="row"><button class="btn ghost" data-act="mclose">Cancel</button><button class="btn pri" data-act="savem" data-id="${s.id}">Save</button></div></div>`, true);
};
actions.savem = (b) => busy(b, async () => {
  await api(`/api/admin/schools/${b.dataset.id}`, { method: 'PUT', as: 'admin', body: { name: $('#mn').value, plan: $('#mp').value, status: $('#ms').value, extendDays: +$('#me').value || 0 } });
  closeModal(); toast('School updated'); route();
});
actions.addadm = (b) => modal(`<h3>Add a school administrator</h3><label>Name<input id="an" maxlength="80"></label><label>Username or email<input id="au" maxlength="80" autocomplete="off"></label><label>Temporary password<input id="ap" value="${randomPw()}" autocomplete="off"></label>
  <div class="row end"><button class="btn ghost" data-act="mclose">Cancel</button><button class="btn pri" data-act="saveadm" data-id="${b.dataset.id}">Create account</button></div>`);
actions.saveadm = (b) => busy(b, async () => {
  await api(`/api/admin/schools/${b.dataset.id}/admin`, { method: 'POST', as: 'admin', body: { name: $('#an').value, username: $('#au').value, password: $('#ap').value } });
  closeModal(); toast('Administrator account created'); route();
});
actions.delsch = async (b) => {
  if (await confirmBox('Delete this school?', `"${b.dataset.n}" and its accounts will be removed. A school that has exams cannot be deleted. Suspend it instead.`, 'Delete school', true))
    busy(b, async () => { await api(`/api/admin/schools/${b.dataset.id}`, { method: 'DELETE', as: 'admin' }); toast('School deleted'); route(); });
};
async function viewPayments() {
  adminShell('payments', LOAD);
  const rows = await api('/api/admin/payments', { as: 'admin' });
  $('main').innerHTML = `<h2 style="margin-bottom:14px">Payments</h2>` + (rows.length
    ? `<div class="card scroll"><table><thead><tr><th>Date</th><th>School</th><th>Plan</th><th>Months</th><th>Amount</th><th>Reference</th><th>Status</th><th></th></tr></thead><tbody>${rows.map((p) => `<tr><td>${fmtDate(p.created_at)}</td><td><b>${esc(p.school_name)}</b></td><td>${esc((CFG.plans.find((x) => x.key === p.plan) || {}).name || p.plan)}</td><td>${p.months}</td><td>${fmtMoney(p.amount)}</td><td>${esc(p.reference)}</td><td><span class="badge ${p.status === 'approved' ? 'Pass' : p.status === 'rejected' ? 'Fail' : 'pending'}">${p.status}</span></td><td class="right">${p.status === 'pending' ? `<button class="btn sm pri" data-act="payok" data-id="${p.id}">Approve</button> <button class="btn sm ghost" data-act="payno" data-id="${p.id}">Reject</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="card empty"><p>No payment requests yet. They appear here when a school requests a plan.</p></div>');
}
actions.payok = async (b) => { if (await confirmBox('Approve this payment?', 'Check that the money has arrived. The school\'s plan is activated immediately.', 'Approve')) busy(b, async () => { await api(`/api/admin/payments/${b.dataset.id}`, { method: 'PUT', as: 'admin', body: { action: 'approve' } }); toast('Payment approved. Plan activated.'); route(); }); };
actions.payno = async (b) => { if (await confirmBox('Reject this payment?', 'The school is not charged or upgraded.', 'Reject', true)) busy(b, async () => { await api(`/api/admin/payments/${b.dataset.id}`, { method: 'PUT', as: 'admin', body: { action: 'reject' } }); toast('Payment rejected'); route(); }); };
async function viewLeads() {
  adminShell('leads', LOAD);
  const rows = await api('/api/admin/leads', { as: 'admin' });
  $('main').innerHTML = `<h2 style="margin-bottom:14px">Leads</h2>` + (rows.length
    ? `<div class="card scroll"><table><thead><tr><th>Date</th><th>School</th><th>Contact</th><th>Message</th><th>Status</th><th></th></tr></thead><tbody>${rows.map((l) => `<tr><td>${fmtDate(l.created_at)}</td><td>${esc(l.school_name || '—')}</td><td><b>${esc(l.contact_name)}</b><br><span class="sm mut">${esc(l.email)} ${esc(l.phone)}</span></td><td style="white-space:normal;min-width:220px">${esc(l.message)}</td><td><span class="badge ${l.status === 'new' ? 'pending' : l.status === 'closed' ? '' : 'Pass'}">${l.status}</span></td><td class="right">${l.status !== 'contacted' ? `<button class="btn sm" data-act="leadst" data-id="${l.id}" data-s="contacted">Contacted</button> ` : ''}${l.status !== 'closed' ? `<button class="btn sm ghost" data-act="leadst" data-id="${l.id}" data-s="closed">Close</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="card empty"><p>No enquiries yet. Messages from the website contact form appear here.</p></div>');
}
actions.leadst = (b) => busy(b, async () => { await api(`/api/admin/leads/${b.dataset.id}`, { method: 'PUT', as: 'admin', body: { status: b.dataset.s } }); route(); });

/* ---------- school administrator: billing ---------- */
async function viewBilling() {
  adminShell('billing', LOAD);
  const b = await api('/api/admin/billing', { as: 'admin' });
  BILL = b;
  const s = b.school, u = b.usage, l = b.limits;
  const meter = (label, used, max) => `<div style="margin-bottom:12px"><div class="row between sm"><span>${label}</span><b>${Number(used).toLocaleString()} / ${Number(max).toLocaleString()}</b></div><div class="bar"><i style="width:${Math.min(100, max ? (used / max) * 100 : 0)}%"></i></div></div>`;
  const planCard = (p) => `<article class="card plan ${p.key === s.plan && s.status === 'active' ? 'pop' : ''}"><h3>${esc(p.name)}</h3><div class="price"><b>${Number(p.price).toLocaleString()}</b><span> ${b.currency} / month</span></div>
    <ul><li>Up to <b>${p.maxTeachers}</b> teachers</li><li>Up to <b>${p.maxExams}</b> exams</li><li><b>${Number(p.maxAttemptsPerMonth).toLocaleString()}</b> student exams per month</li></ul><button class="btn ${p.key === s.plan && s.status === 'active' ? '' : 'pri'} block" data-act="reqplan" data-p="${p.key}">${p.key === s.plan && s.status === 'active' ? 'Renew this plan' : 'Choose this plan'}</button></article>`;
  $('main').innerHTML = `<h2 style="margin-bottom:14px">Billing</h2>
  <div class="grid g2"><div class="card pad">${sBadge(s)}<h3 style="margin:8px 0 4px">${esc(s.planName)} plan</h3><p class="mut">${s.active ? `${s.status === 'trial' ? 'Your free trial ends' : 'Your subscription ends'} on ${fmtDate(s.endsAt)} (${s.daysLeft} days left).` : 'Your subscription is not active. Choose a plan below to renew.'}</p>
  ${meter('Teachers', u.teachers, l.maxTeachers)}${meter('Exams', u.exams, l.maxExams)}${meter('Student exams this month', u.attemptsMonth, l.maxAttemptsPerMonth)}</div>
  <div class="card pad"><h3>How to pay</h3><p class="mut">${esc(b.instructions)}</p><p class="sm mut">Choose a plan below, pay, then enter the payment reference. We activate your plan as soon as the payment is confirmed. Paying for 12 months costs ${b.annualMonthsPaid} months.</p></div></div>
  <h3 style="margin:26px 0 12px">Choose a plan</h3><div class="pricegrid">${b.plans.filter((p) => p.key !== 'trial').map(planCard).join('')}</div>
  <h3 style="margin:26px 0 12px">Payment requests</h3>${b.payments.length ? `<div class="card scroll"><table><thead><tr><th>Date</th><th>Plan</th><th>Months</th><th>Amount</th><th>Reference</th><th>Status</th></tr></thead><tbody>${b.payments.map((p) => `<tr><td>${fmtDate(p.created_at)}</td><td>${esc((b.plans.find((x) => x.key === p.plan) || {}).name || p.plan)}</td><td>${p.months}</td><td>${fmtMoney(p.amount, b.currency)}</td><td>${esc(p.reference)}</td><td><span class="badge ${p.status === 'approved' ? 'Pass' : p.status === 'rejected' ? 'Fail' : 'pending'}">${p.status}</span></td></tr>`).join('')}</tbody></table></div>` : '<div class="card empty"><p>No payment requests yet.</p></div>'}`;
}
let BILL = null;
actions.reqplan = (b) => {
  const p = BILL.plans.find((x) => x.key === b.dataset.p);
  const opt = (m) => `<option value="${m}">${m} month${m > 1 ? 's' : ''} · ${fmtMoney(p.price * (m === 12 ? BILL.annualMonthsPaid : m), BILL.currency)}</option>`;
  modal(`<h3>${esc(p.name)} plan</h3><p class="mut sm">${esc(BILL.instructions)}</p><label>Period<select id="rm">${[1, 3, 6, 12].map(opt).join('')}</select></label>
  <label>Payment reference (transaction number)<input id="rr" maxlength="120" placeholder="e.g. bank or mobile money reference"></label>
  <div class="row end"><button class="btn ghost" data-act="mclose">Cancel</button><button class="btn pri" data-act="sendreq" data-p="${p.key}">Submit payment request</button></div>`);
};
actions.sendreq = (b) => busy(b, async () => {
  await api('/api/admin/billing/request', { method: 'POST', as: 'admin', body: { plan: b.dataset.p, months: +$('#rm').value, reference: $('#rr').value } });
  closeModal(); toast('Request sent. We will activate your plan once the payment is confirmed.'); route();
});

/* ---------- admin: teacher accounts (school administrator) ---------- */
const randomPw = () => { const c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'; const a = new Uint32Array(10); crypto.getRandomValues(a); return [...a].map((x) => c[x % c.length]).join(''); };
async function viewTeachers() {
  adminShell('teachers', LOAD);
  const list = await api('/api/admin/teachers', { as: 'admin' });
  $('main').innerHTML = `<div class="row between" style="margin-bottom:14px"><div><h2 style="margin:0">Teachers</h2><p class="mut" style="margin:0">Each teacher signs in at /admin and sees only their own exams and results.</p></div><button class="btn pri" data-act="addt">Add teacher</button></div>
  <div class="card scroll"><table><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Exams</th><th>Status</th><th></th></tr></thead><tbody>${list.map((t) => `<tr><td><b>${esc(t.name || '—')}</b></td><td>${esc(t.username)}</td><td>${t.role === 'school_admin' ? 'School admin' : 'Teacher'}</td><td>${t.exams}</td><td><span class="badge ${t.disabled ? 'Fail' : 'Pass'}">${t.disabled ? 'Disabled' : 'Active'}</span></td>
  <td class="right">${t.role === 'school_admin' ? '' : `<button class="btn sm" data-act="resett" data-id="${t.id}" data-u="${esc(t.username)}">Reset password</button> <button class="btn sm" data-act="togglet" data-id="${t.id}" data-on="${t.disabled ? 0 : 1}">${t.disabled ? 'Enable' : 'Disable'}</button> <button class="btn sm danger" data-act="delt" data-id="${t.id}" data-u="${esc(t.username)}">Delete</button>`}</td></tr>`).join('')}</tbody></table></div>
  <p class="sm mut" style="margin-top:14px">Teachers cannot see each other's exams, students or results, and neither can you. Disable an account to block sign-in without losing the teacher's data. An account can only be deleted when the teacher owns no exams.</p>`;
}
actions.addt = () => modal(`<h3>Add a teacher</h3>
  <label>Full name<input id="tn" maxlength="80" placeholder="Mr. Abebe Kebede"></label>
  <label>Username<input id="tu" maxlength="40" autocomplete="off" placeholder="abebe.k"></label>
  <label>Temporary password (at least 8 characters)<input id="tp" value="${randomPw()}" autocomplete="off"></label>
  <p class="sm mut">Give the teacher the username and password. They sign in at /admin and can change the password under Dashboard, Change password.</p>
  <div class="row end"><button class="btn ghost" data-act="genpw">New password</button><button class="btn ghost" data-act="mclose">Cancel</button><button class="btn pri" data-act="savet">Create account</button></div>`);
actions.genpw = () => { $('#tp').value = randomPw(); };
actions.savet = (b) => busy(b, async () => {
  const body = { name: $('#tn').value, username: $('#tu').value, password: $('#tp').value };
  await api('/api/admin/teachers', { method: 'POST', as: 'admin', body });
  closeModal(); toast(`Teacher added. Username: ${body.username}`); route();
});
actions.resett = (b) => modal(`<h3>Reset password</h3><p class="mut">New password for <b>${esc(b.dataset.u)}</b> (at least 8 characters).</p><label>New password<input id="rp" value="${randomPw()}" autocomplete="off"></label>
  <div class="row end"><button class="btn ghost" data-act="mclose">Cancel</button><button class="btn pri" data-act="savepwt" data-id="${b.dataset.id}">Save password</button></div>`);
actions.savepwt = (b) => busy(b, async () => {
  const password = $('#rp').value;
  await api(`/api/admin/teachers/${b.dataset.id}`, { method: 'PUT', as: 'admin', body: { password } });
  closeModal(); toast('Password updated. Share the new password with the teacher.');
});
actions.togglet = (b) => busy(b, async () => {
  await api(`/api/admin/teachers/${b.dataset.id}`, { method: 'PUT', as: 'admin', body: { disabled: +b.dataset.on === 1 } });
  toast(+b.dataset.on ? 'Account disabled' : 'Account enabled'); route();
});
actions.delt = async (b) => {
  if (await confirmBox('Delete this teacher account?', `The account "${b.dataset.u}" will be removed. This cannot be undone.`, 'Delete account', true))
    busy(b, async () => { await api(`/api/admin/teachers/${b.dataset.id}`, { method: 'DELETE', as: 'admin' }); toast('Account deleted'); route(); });
};

/* ---------- admin: dashboard & exams ---------- */
async function viewDash() {
  adminShell('dashboard', LOAD);
  const [s, ex] = await Promise.all([api('/api/admin/stats', { as: 'admin' }), api('/api/admin/exams', { as: 'admin' })]);
  $('main').innerHTML = `<div class="row between" style="margin-bottom:16px"><div><h2 style="margin:0">Overview</h2><p class="mut" style="margin:0">Your exams and results. Only you can see them.</p></div>
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
  if (id === 'new') E = { id: null, locked: false, exam: { title: '', subject: '', duration: 30, pass_marks: 0, instructions: '', start: '', end: '', published: false, lockdown: true, max_violations: 3, require_seb: false }, qs: [blankQ('mcq')] };
  else {
    const d = await api(`/api/admin/exams/${id}`, { as: 'admin' });
    E = { id: d.id, locked: d.locked, code: d.code, exam: { title: d.title, subject: d.subject, duration: d.duration, pass_marks: d.pass_marks, instructions: d.instructions, start: toLocal(d.start_at), end: toLocal(d.end_at), published: !!d.published, lockdown: !!d.lockdown, max_violations: d.max_violations, require_seb: !!d.require_seb }, qs: d.questions.map((q) => ({ type: q.type, text: q.text, options: q.options || (q.type === 'mcq' ? ['', ''] : null), answer: q.answer, marks: q.marks, explanation: q.explanation })) };
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
  <div class="card pad sm" style="margin-top:14px;background:var(--soft)"><b>Exam security</b>
  <label class="row" style="gap:10px;margin:10px 0 0;font-weight:500"><input type="checkbox" data-f="lockdown" ${x.lockdown ? 'checked' : ''}> Strict mode: full screen, record tab or window switching, block copy, paste and right-click</label>
  <label style="margin:10px 0 0">Submit automatically after this many violations (0 = never, only record them)<input type="number" min="0" max="10" data-f="max_violations" value="${x.max_violations}" style="max-width:120px"></label>
  <label class="row" style="gap:10px;margin:10px 0 0;font-weight:500"><input type="checkbox" data-f="require_seb" ${x.require_seb ? 'checked' : ''}> Require Safe Exam Browser (students must open the exam inside the SEB app)</label>
  <p class="sm mut" style="margin:8px 0 0">A web page cannot fully lock a device. Strict mode discourages and records cheating. For the strongest control, also require Safe Exam Browser.</p></div>
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
  const body = { title: x.title, subject: x.subject, duration: +x.duration, pass_marks: +x.pass_marks, instructions: x.instructions, published: x.published, lockdown: x.lockdown, max_violations: x.max_violations === '' ? 3 : +x.max_violations, require_seb: x.require_seb, start_at: x.start ? new Date(x.start).getTime() : null, end_at: x.end ? new Date(x.end).getTime() : null };
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
      el.innerHTML = r.length ? `<div class="scroll"><table><thead><tr><th>Student</th><th>Exam</th><th style="min-width:190px">Progress</th><th>Time left</th><th>Violations</th><th>Started</th></tr></thead><tbody>${r.map((a) => `<tr><td><b>${esc(a.name)}</b></td><td>${esc(a.exam)}</td><td><div class="row" style="flex-wrap:nowrap"><div class="bar grow"><i style="width:${a.total ? (a.answered / a.total) * 100 : 0}%"></i></div><span class="sm">${a.answered}/${a.total}</span></div></td><td><span class="badge ${a.remaining < 300 ? 'pending' : ''}">${fmtClock(a.remaining)}</span></td><td>${a.violations ? `<span class="badge Fail">${a.violations}</span>` : '0'}</td><td>${fmtDate(a.startedAt)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><h3>No one is taking an exam right now</h3><p>Students appear here the moment they start.</p></div>';
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
    el.innerHTML = rows.length ? `<div class="scroll"><table><thead><tr><th>Student</th><th>Exam</th><th>Score</th><th>%</th><th>Status</th><th>Submitted</th><th>Violations</th><th></th></tr></thead><tbody>${rows.map((s) => `<tr><td><b>${esc(s.name)}</b></td><td>${esc(s.exam)}</td><td>${num(s.score)} / ${num(s.total)}</td><td>${s.pct}%</td><td><span class="badge ${bc(s.status)}">${s.status}</span></td><td>${fmtDate(s.submittedAt)}</td><td>${s.violations ? `<span class="badge Fail">${s.violations}</span>` : '0'}</td><td class="right"><button class="btn sm" data-act="att" data-id="${s.id}" ${s.submittedAt ? '' : 'disabled'}>Review and grade</button> <button class="btn sm ghost" data-act="delatt" data-id="${s.id}">Reset</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><h3>No results match</h3><p>Results appear here as students submit their exams.</p></div>';
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
const logBlock = (a) => (a.violations ? `<div class="card pad sm" style="border-left:5px solid var(--mark);margin-bottom:14px"><b>Security log: ${a.violations} violation${a.violations === 1 ? '' : 's'}</b>${a.autoReason === 'violations' ? ' (the exam was submitted automatically)' : ''}<ul style="margin:6px 0 0;padding-left:18px">${(a.violationLog || []).map((v) => `<li>${new Date(v.t).toLocaleTimeString()}: ${esc(VTXT[v.type] || v.type)}</li>`).join('')}</ul></div>` : '');
async function openAttempt(id) {
  const a = await api(`/api/admin/attempts/${id}`, { as: 'admin' });
  const grader = (q) => (q.type === 'short' ? `<div class="row" style="margin-top:10px"><label style="margin:0" class="sm">Marks awarded</label><input type="number" id="g${q.id}" min="0" max="${q.marks}" step="0.5" value="${q.awarded ?? ''}" style="width:90px;margin:0"><span class="sm mut">of ${num(q.marks)}</span><button class="btn sm pri" data-act="grade" data-a="${a.id}" data-q="${q.id}">Save marks</button></div>` : '');
  modal(`<div class="row between"><div><h3 style="margin:0">${esc(a.name)}</h3><span class="mut sm">${esc(a.exam)}</span></div><span class="badge ${bc(a.status)}">${a.status}</span></div>
    <p style="margin:10px 0 16px"><b>${num(a.score)}</b> / ${num(a.total)} marks · ${a.pct}% · pass mark ${num(a.passMarks)}</p>${logBlock(a)}${a.review.map((q, i) => revHTML(q, i, grader(q))).join('')}
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
  clearTimers(); closeModal(); lockStop(); window.onbeforeunload = null;
  let p = location.hash.replace(/^#\/?/, '').split('/');
  const onAdmin = location.pathname.replace(/\/+$/, '') === '/admin';
  if (onAdmin && p[0] !== 'admin') p = ['admin'];
  if (!onAdmin && p[0] === 'admin') { location.replace('/admin' + (p[1] ? '#/admin/' + p.slice(1).join('/') : '')); return; }
  try {
    if (p[0] === 'signup') return viewSignup();
    if (p[0] === 'exam') return await viewExam();
    if (p[0] === 'result') return await viewResult();
    if (p[0] === 'admin') {
      if (!tok()) return viewLogin();
      if (!ME) ME = await api('/api/admin/me', { as: 'admin' });
      const owner = ME.role === 'superadmin', head1 = ME.role === 'school_admin';
      let v = p[1] || (owner ? 'platform' : 'dashboard');
      if (owner && v === 'dashboard') v = 'platform';
      if (v === 'platform') return owner ? await viewPlatform() : await viewDash();
      if (v === 'schools') return owner ? await viewSchools() : await viewDash();
      if (v === 'payments') return owner ? await viewPayments() : await viewDash();
      if (v === 'leads') return owner ? await viewLeads() : await viewDash();
      if (v === 'billing') return head1 ? await viewBilling() : await viewDash();
      if (v === 'teachers') return head1 ? await viewTeachers() : await viewDash();
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
loadCfg().then(route);
})();
