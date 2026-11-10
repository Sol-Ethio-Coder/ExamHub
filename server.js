'use strict';
try { require('dotenv').config(); } catch { /* optional */ }
const express = require('express');
const { createClient } = require('@libsql/client');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse/lib/pdf-parse.js');

const PORT = process.env.PORT || 3000;
const SERVERLESS = !!(process.env.VERCEL || process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME);
const MAX_BODY = 4 * 1024 * 1024; // Vercel/Netlify functions accept ~4.5 MB request bodies

/* ---------- configuration & database (Turso / libSQL) ---------- */
let CONFIG_ERROR = '';
let SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET === 'change-me') {
  if (SERVERLESS) CONFIG_ERROR = 'JWT_SECRET is not set. Add it in your hosting dashboard (Environment Variables).';
  else { SECRET = crypto.randomBytes(48).toString('hex'); console.warn('⚠ JWT_SECRET not set: using a temporary secret (admin sessions reset on restart).'); }
}
let dbUrl = process.env.TURSO_DATABASE_URL;
if (!dbUrl) {
  if (SERVERLESS) CONFIG_ERROR = CONFIG_ERROR || 'TURSO_DATABASE_URL is not set. Create a free Turso database and add TURSO_DATABASE_URL and TURSO_AUTH_TOKEN as environment variables.';
  else {
    const f = process.env.DB_PATH || path.join(__dirname, 'data', 'examhub.db');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    dbUrl = 'file:' + f; // local development: plain SQLite file
  }
}
const db = CONFIG_ERROR ? null : createClient({ url: dbUrl, authToken: process.env.TURSO_AUTH_TOKEN });

const toObjs = (r) => r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c, row[i]])));
const all = async (sql, args = []) => toObjs(await db.execute({ sql, args }));
const one = async (sql, args = []) => (await all(sql, args))[0];
const run = (sql, args = []) => db.execute({ sql, args });

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS admins(id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, hash TEXT NOT NULL)',
  `CREATE TABLE IF NOT EXISTS exams(id INTEGER PRIMARY KEY, title TEXT NOT NULL, subject TEXT DEFAULT '', instructions TEXT DEFAULT '',
    code TEXT UNIQUE NOT NULL, duration INTEGER NOT NULL, pass_marks REAL NOT NULL DEFAULT 0, start_at INTEGER, end_at INTEGER,
    published INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS questions(id INTEGER PRIMARY KEY, exam_id INTEGER NOT NULL, pos INTEGER NOT NULL, type TEXT NOT NULL,
    text TEXT NOT NULL, options TEXT, answer TEXT DEFAULT '', marks REAL NOT NULL DEFAULT 1, explanation TEXT DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS attempts(id INTEGER PRIMARY KEY, exam_id INTEGER NOT NULL, name TEXT NOT NULL, name_key TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL, started_at INTEGER NOT NULL, deadline INTEGER NOT NULL, submitted_at INTEGER, auto INTEGER DEFAULT 0,
    UNIQUE(exam_id, name_key))`,
  `CREATE TABLE IF NOT EXISTS answers(attempt_id INTEGER NOT NULL, question_id INTEGER NOT NULL, response TEXT, awarded REAL,
    PRIMARY KEY(attempt_id, question_id))`,
  'CREATE INDEX IF NOT EXISTS idx_q_exam ON questions(exam_id)',
  'CREATE INDEX IF NOT EXISTS idx_a_exam ON attempts(exam_id)',
];
let ready = null;
function init() {
  if (CONFIG_ERROR) return Promise.reject(err(503, CONFIG_ERROR));
  ready = ready || (async () => {
    await db.batch(SCHEMA, 'write');
    if (!(await one('SELECT 1 x FROM admins'))) {
      const u = process.env.ADMIN_USERNAME || 'admin';
      let p = process.env.ADMIN_PASSWORD;
      if (!p) {
        if (SERVERLESS) throw err(503, 'ADMIN_PASSWORD is not set. Add ADMIN_USERNAME and ADMIN_PASSWORD as environment variables, then redeploy.');
        p = crypto.randomBytes(6).toString('hex');
        console.log(`Admin account created → username: ${u}  password: ${p}`);
      } else console.log(`Admin account created → username: ${u}`);
      await run('INSERT INTO admins(username,hash) VALUES(?,?)', [u, bcrypt.hashSync(p, 12)]);
    }
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

/* ---------- helpers ---------- */
const now = () => Date.now();
const err = (status, message) => Object.assign(new Error(message), { status });
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
async function genCode() {
  for (;;) {
    const b = crypto.randomBytes(8);
    let c = '';
    for (let i = 0; i < 8; i++) c += ALPHA[b[i] % ALPHA.length];
    if (!(await one('SELECT 1 x FROM exams WHERE code=?', [c]))) return c;
  }
}
const parseQ = (q) => ({ ...q, options: q.options ? JSON.parse(q.options) : null });
const totalMarks = async (examId) => (await one('SELECT COALESCE(SUM(marks),0) t FROM questions WHERE exam_id=?', [examId])).t;

function cleanExam(b) {
  const s = (v, max) => String(v ?? '').trim().slice(0, max);
  const e = {
    title: s(b.title, 150), subject: s(b.subject, 100), instructions: s(b.instructions, 3000),
    duration: Math.round(+b.duration), pass_marks: +b.pass_marks || 0,
    start_at: b.start_at ? +b.start_at : null, end_at: b.end_at ? +b.end_at : null, published: b.published ? 1 : 0,
  };
  if (!e.title) throw err(400, 'Exam title is required.');
  if (!(e.duration >= 1 && e.duration <= 600)) throw err(400, 'Duration must be between 1 and 600 minutes.');
  if (e.pass_marks < 0) throw err(400, 'Passing marks cannot be negative.');
  if (e.start_at && e.end_at && e.end_at <= e.start_at) throw err(400, 'The closing time must be after the opening time.');
  return e;
}
function cleanQs(list) {
  if (!Array.isArray(list)) throw err(400, 'Invalid questions.');
  if (list.length > 300) throw err(400, 'An exam can have at most 300 questions.');
  return list.map((q, i) => {
    const n = i + 1;
    const type = q.type;
    if (!['mcq', 'tf', 'short'].includes(type)) throw err(400, `Question ${n}: invalid type.`);
    const text = String(q.text || '').trim();
    if (!text) throw err(400, `Question ${n}: enter the question text.`);
    const marks = +q.marks;
    if (!(marks > 0 && marks <= 1000)) throw err(400, `Question ${n}: marks must be greater than 0.`);
    let options = null;
    const answer = String(q.answer ?? '').trim().slice(0, 500);
    if (type === 'mcq') {
      options = (Array.isArray(q.options) ? q.options : []).map((o) => String(o).trim().slice(0, 300));
      if (options.length < 2 || options.length > 6 || options.some((o) => !o)) throw err(400, `Question ${n}: provide 2–6 filled-in options.`);
      if (!/^\d+$/.test(answer) || +answer >= options.length) throw err(400, `Question ${n}: select the correct option.`);
    }
    if (type === 'tf' && !['true', 'false'].includes(answer)) throw err(400, `Question ${n}: choose True or False.`);
    return { type, text: text.slice(0, 2000), options: options && JSON.stringify(options), answer, marks, explanation: String(q.explanation || '').trim().slice(0, 1000) };
  });
}
async function saveExam(id, b) {
  const e = cleanExam(b);
  const qs = b.questions !== undefined ? cleanQs(b.questions) : null;
  const total = qs ? qs.reduce((t, q) => t + q.marks, 0) : id !== null ? await totalMarks(id) : 0;
  if (e.published && total === 0) throw err(400, 'Add at least one question before publishing.');
  if (e.pass_marks > total && total > 0) throw err(400, `Passing marks (${e.pass_marks}) cannot exceed total marks (${total}).`);
  const stmts = [];
  let code = null;
  if (id === null) {
    code = await genCode();
    stmts.push({ sql: 'INSERT INTO exams(title,subject,instructions,code,duration,pass_marks,start_at,end_at,published,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)', args: [e.title, e.subject, e.instructions, code, e.duration, e.pass_marks, e.start_at, e.end_at, e.published, now()] });
  } else {
    if (!(await one('SELECT 1 x FROM exams WHERE id=?', [id]))) throw err(404, 'Exam not found.');
    stmts.push({ sql: 'UPDATE exams SET title=?,subject=?,instructions=?,duration=?,pass_marks=?,start_at=?,end_at=?,published=? WHERE id=?', args: [e.title, e.subject, e.instructions, e.duration, e.pass_marks, e.start_at, e.end_at, e.published, id] });
  }
  if (qs) {
    if (id !== null) {
      if (await one('SELECT 1 x FROM attempts WHERE exam_id=? LIMIT 1', [id])) throw err(409, 'Questions are locked because students have already started this exam.');
      stmts.push({ sql: 'DELETE FROM questions WHERE exam_id=?', args: [id] });
    }
    qs.forEach((q, i) => stmts.push({
      sql: `INSERT INTO questions(exam_id,pos,type,text,options,answer,marks,explanation) VALUES(${id === null ? '(SELECT id FROM exams WHERE code=?)' : '?'},?,?,?,?,?,?,?)`,
      args: [id === null ? code : id, i, q.type, q.text, q.options, q.answer, q.marks, q.explanation],
    }));
  }
  await db.batch(stmts, 'write');
  return one(id === null ? 'SELECT id,code FROM exams WHERE code=?' : 'SELECT id,code FROM exams WHERE id=?', [id === null ? code : id]);
}
const examState = (e) => (!e.published ? 'draft' : e.start_at && e.start_at > now() ? 'scheduled' : e.end_at && now() > e.end_at ? 'closed' : 'open');

/* ---------- grading ---------- */
async function finalize(id, auto) {
  const a = await one('SELECT * FROM attempts WHERE id=?', [id]);
  if (!a || a.submitted_at) return;
  const qs = await all('SELECT * FROM questions WHERE exam_id=?', [a.exam_id]);
  const ans = Object.fromEntries((await all('SELECT question_id,response FROM answers WHERE attempt_id=?', [id])).map((r) => [r.question_id, r.response]));
  const stmts = qs.map((q) => {
    const r = String(ans[q.id] ?? '').trim();
    let aw;
    if (!r) aw = 0;
    else if (q.type === 'short') aw = q.answer.split('|').map(norm).filter(Boolean).includes(norm(r)) ? q.marks : null; // null = needs manual grading
    else aw = r === q.answer ? q.marks : 0;
    return { sql: 'INSERT INTO answers(attempt_id,question_id,response,awarded) VALUES(?,?,?,?) ON CONFLICT(attempt_id,question_id) DO UPDATE SET awarded=excluded.awarded', args: [id, q.id, ans[q.id] ?? '', aw] };
  });
  stmts.push({ sql: 'UPDATE attempts SET submitted_at=?, auto=? WHERE id=? AND submitted_at IS NULL', args: [auto ? Math.min(now(), a.deadline) : now(), auto ? 1 : 0, id] });
  await db.batch(stmts, 'write');
}
// No background timers on serverless hosts: expired attempts are closed whenever they (or an admin page) are touched.
const sweep = async () => { for (const r of await all('SELECT id FROM attempts WHERE submitted_at IS NULL AND deadline<?', [now()])) await finalize(r.id, true); };

const mkSummary = (r) => {
  const pending = r.pending || 0;
  const status = !r.submitted_at ? 'In progress' : pending ? 'Pending review' : r.score >= r.pass_marks ? 'Pass' : 'Fail';
  return { id: r.id, name: r.name, exam: r.exam, examId: r.exam_id, score: r.score, total: r.total, pct: r.total ? Math.round((r.score / r.total) * 1000) / 10 : 0, pending, status, passMarks: r.pass_marks, startedAt: r.started_at, submittedAt: r.submitted_at, auto: !!r.auto };
};
const summaries = async (where = '', args = []) => (await all(`SELECT a.id, a.exam_id, a.name, a.started_at, a.submitted_at, a.auto, e.title exam, e.pass_marks,
  (SELECT COALESCE(SUM(marks),0) FROM questions WHERE exam_id=a.exam_id) total,
  (SELECT COALESCE(SUM(awarded),0) FROM answers WHERE attempt_id=a.id) score,
  (SELECT COUNT(*) FROM answers WHERE attempt_id=a.id AND awarded IS NULL) pending
  FROM attempts a JOIN exams e ON e.id=a.exam_id ${where} ORDER BY a.id DESC`, args)).map(mkSummary);
async function review(a) {
  return (await all('SELECT q.*, an.response, an.awarded FROM questions q LEFT JOIN answers an ON an.question_id=q.id AND an.attempt_id=? WHERE q.exam_id=? ORDER BY q.pos', [a.id, a.exam_id]))
    .map(parseQ).map((q) => ({
      id: q.id, type: q.type, text: q.text, options: q.options, marks: q.marks, answer: q.answer, explanation: q.explanation,
      response: q.response ?? '', awarded: q.awarded,
      result: q.awarded === null ? 'pending' : q.awarded >= q.marks ? 'correct' : q.awarded > 0 ? 'partial' : 'incorrect',
    }));
}

/* ---------- import: PDF / Word / text → questions ---------- */
const decodeHtml = (s) => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
// Word → plain lines. Re-creates numbering Word hides in auto-numbered lists (1. 2. / A. B.) and
// flags options that are fully bold in the document as the correct answer (a common teacher habit).
function htmlToLines(html) {
  const out = [], stack = [];
  let cur = '', pending = '';
  const flush = () => {
    const t = decodeHtml(cur.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    if (t) {
      const bold = /^(?:<[^>]+>)*<(strong|b)\b[^>]*>[\s\S]*<\/\1>(?:<[^>]+>)*$/i.test(cur.trim());
      const line = pending + t;
      out.push(bold && /^\(?[A-Fa-f][.):]\s?\S/.test(line) ? line + ' ✓' : line);
      pending = '';
    }
    cur = '';
  };
  for (const tk of html.split(/(<\/?(?:ol|ul|li|p|br|h[1-6]|tr|table|div)\b[^>]*>)/i)) {
    const m = /^<(\/)?(ol|ul|li|p|br|h[1-6]|tr|table|div)\b/i.exec(tk);
    if (!m) { cur += tk; continue; }
    const close = !!m[1], tag = m[2].toLowerCase();
    flush();
    if (tag === 'ol' || tag === 'ul') { if (close) stack.pop(); else stack.push({ t: tag, n: 0 }); }
    else if (tag === 'li') {
      if (close) pending = '';
      else {
        const s = stack[stack.length - 1];
        if (s) { s.n++; pending = stack.length > 1 ? String.fromCharCode(64 + s.n) + '. ' : s.t === 'ol' ? s.n + '. ' : ''; }
      }
    }
  }
  flush();
  return out;
}
const letterIdx = (a, n) => {
  const t = String(a).trim();
  let m = /^(?:option\s*|choice\s*)?\(?([A-Fa-f])\)?(?=$|[\s.,:;)\-–])/i.exec(t);
  if (m) { const i = m[1].toUpperCase().charCodeAt(0) - 65; return i < n ? i : -1; }
  m = /^(?:option\s*|choice\s*)?([1-6])$/i.exec(t);
  if (m) return +m[1] - 1 < n ? +m[1] - 1 : -1;
  return -1;
};
function parseExamText(raw) {
  let text = String(raw).replace(/\r/g, '').replace(/\u00a0/g, ' ');
  let keyText = '';
  const km = text.search(/^\s*(?:answer\s*keys?|answers|marking\s*scheme)\s*:?\s*$/im);
  if (km >= 0) { keyText = text.slice(km); text = text.slice(0, km); }
  const QS = [
    /^(?:q(?:uestion)?\.?\s*)?(\d{1,3})\s*[.):\-–](?:\s+|(?=[^\d\s]))(\S.*)$/i,
    /^\((\d{1,3})\)\s+(\S.*)$/,
    /^q\.?\s*(\d{1,3})\s+(\S.*)$/i,
    /^question\s+(\d{1,3})\s*[:.\-–]?\s*()$/i,
  ];
  const OPT = /^\(?([A-Fa-f])(?:[.:]\s+|\)\s*)(\S.*)$/;
  const ANS = /^(?:correct\s+(?:answer|option|choice)|answer|ans|key)\s*[:.\-–=]\s*(.*)$/i;
  const EXP = /^(?:explanation|explain|reasoning|reason|rationale|solution|why|feedback|remarks?|note)\s*[:\-–]\s*(.*)$/i;
  const MRK = /^(?:marks?|points?|score)\s*[:\-–]\s*(\d+(?:\.\d+)?)/i;
  const HEADING = /^(?:section|part)\s+(?:[A-Z]|[IVX]+|\d+)\b\s*[:.\-–)]?\s*.{0,70}$/i;
  const NOISE = /^(?:total\s+marks?\b.*|page\s+\d+(?:\s*(?:of|\/)\s*\d+)?|\d{1,3})$/i;
  const CORRECT = /\s*(?:✓|✔|☑|\*|\((?:correct|answer|ans)\)|\[(?:correct|answer|ans)\])\s*$/i;
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
    .flatMap((l) => (/^\(?[Aa][.)]\s/.test(l) && /\s\(?[Bb][.)]\s/.test(l) ? l.split(/\s+(?=\(?[A-Fa-f][.)]\s)/) : [l])); // "A) x  B) y  C) z" on one line
  const raws = [], pre = [];
  let cur = null, mode = 'q', m;
  for (const line of lines) {
    if (HEADING.test(line) || NOISE.test(line)) continue;
    let qm = null;
    for (const re of QS) if ((m = re.exec(line))) { qm = m; break; }
    if (qm) { cur = { n: +qm[1], text: qm[2], options: [], answer: '', explanation: '', marks: null, marked: undefined }; raws.push(cur); mode = 'q'; continue; }
    if (!cur) { pre.push(line); continue; }
    if ((m = ANS.exec(line))) { cur.answer = m[1].trim(); mode = 'ans'; continue; }
    if ((m = EXP.exec(line))) { cur.explanation = m[1].trim(); mode = 'exp'; continue; }
    if ((m = MRK.exec(line))) { cur.marks = +m[1]; continue; }
    let L = line, star = false;
    if (/^[*✓✔]\s*(?=\(?[A-Fa-f][.):])/.test(L)) { star = true; L = L.replace(/^[*✓✔]\s*/, ''); }
    if ((m = OPT.exec(L)) && (cur.options.length || /^\(?[Aa]/.test(L))) {
      let t = m[2].trim();
      if (CORRECT.test(t)) { t = t.replace(CORRECT, '').trim(); star = true; }
      if (star) cur.marked = cur.options.length;
      cur.options.push(t); mode = 'opt'; continue;
    }
    if (mode === 'exp') cur.explanation += ' ' + line;
    else if (mode === 'opt' && cur.options.length) cur.options[cur.options.length - 1] += ' ' + line;
    else if (mode === 'ans') cur.answer += ' ' + line;
    else cur.text = (cur.text + ' ' + line).trim();
  }
  const key = {};
  for (const k of keyText.matchAll(/(\d{1,3})\s*[.):\-–]?\s*\(?([A-Fa-f]|true|false|t|f)\b\)?/gi)) key[+k[1]] = k[2];

  const warnings = [];
  const tfOf = (a) => { const t = /^(true|false|t|f)\.?$/i.exec(String(a).trim()); return t ? (/^t/i.test(t[1]) ? 'true' : 'false') : ''; };
  const questions = raws.slice(0, 300).map((r, i) => {
    const w = [];
    let marks = r.marks;
    const inl = /\s*[(\[]\s*(\d+(?:\.\d+)?)\s*(?:marks?|mks?|pts?|points?)\s*[)\]]/i.exec(r.text);
    if (inl) { if (marks == null) marks = +inl[1]; r.text = r.text.replace(inl[0], ''); }
    if (!(marks > 0)) marks = 1;
    const a = (r.answer || String(key[r.n] ?? '')).trim();
    const opts = r.options.length >= 2 ? r.options.slice(0, 6) : [];
    if (r.options.length > 6) w.push('more than 6 options found; extra options were ignored.');
    const base = { text: r.text.trim().slice(0, 2000), marks, explanation: r.explanation.trim().slice(0, 1000) };
    const isTFOpts = opts.length === 2 && opts.every((o) => /^(true|false)\.?$/i.test(o));
    let q;
    if (isTFOpts || (!opts.length && tfOf(a)) || (!opts.length && !a && /true\s*(?:or|\/)\s*false/i.test(r.text))) {
      let ans = tfOf(a);
      if (!ans && isTFOpts) { const li = letterIdx(a, 2); const t = li >= 0 ? opts[li] : r.marked !== undefined ? opts[r.marked] : ''; if (t) ans = /^true/i.test(t) ? 'true' : 'false'; }
      if (!ans) { w.push('true/false answer not found. Please check it.'); ans = 'true'; }
      q = { type: 'tf', options: null, answer: ans, ...base };
    } else if (opts.length) {
      let idx = opts.findIndex((o) => norm(o) === norm(a));
      if (idx < 0 && a) idx = letterIdx(a, opts.length);
      if (idx < 0 && r.marked !== undefined && r.marked < opts.length) idx = r.marked;
      if (/^\(?[A-F]\)?\s*(?:[,&\/]|and)\s*\(?[A-F]\b/i.test(a)) w.push('several correct answers were listed; only the first was used.');
      if (idx < 0) w.push('correct option not found. Please select it.');
      q = { type: 'mcq', options: opts, answer: idx < 0 ? '' : String(idx), ...base };
    } else q = { type: 'short', options: null, answer: a.split(/\s*(?:\||;)\s*/).filter(Boolean).join(' | ').slice(0, 500), ...base };
    if (w.length) { q.warn = w.join(' '); warnings.push(`Question ${i + 1}: ${q.warn}`); }
    return q;
  });
  if (raws.length > 300) warnings.push('Only the first 300 questions were imported.');

  const exam = { title: '', subject: '', instructions: '', duration: null, pass_marks: null };
  const instr = [];
  let inInstr = false;
  for (const l of pre) {
    if ((m = /^(?:exam\s*)?title\s*[:\-–]\s*(.+)/i.exec(l))) exam.title = m[1].trim();
    else if ((m = /^subject\s*[:\-–]\s*(.+)/i.exec(l))) exam.subject = m[1].trim();
    else if ((m = /^(?:duration|time(?:\s*allowed)?)\s*[:\-–]\s*(\d+(?:\.\d+)?)\s*(h|m)?/i.exec(l))) exam.duration = Math.round(/^h/i.test(m[2] || '') ? m[1] * 60 : +m[1]);
    else if ((m = /^pass(?:ing)?\s*(?:marks?|score)?\s*[:\-–]\s*(\d+(?:\.\d+)?)/i.exec(l))) exam.pass_marks = +m[1];
    else if ((m = /^instructions?\s*[:\-–]?\s*(.*)$/i.exec(l))) { inInstr = true; if (m[1]) instr.push(m[1]); }
    else if (inInstr) instr.push(l);
    else if (!exam.title && l.length <= 150 && !l.includes(':')) exam.title = l;
  }
  exam.title = exam.title.slice(0, 150); exam.subject = exam.subject.slice(0, 100); exam.instructions = instr.join('\n').slice(0, 3000);
  return { exam, questions, warnings };
}

/* ---------- AI question generator ---------- */
// Works with any OpenAI-compatible API (OpenAI, Google Gemini, Groq, OpenRouter...). The API key stays on the server.
const AI_KEY = () => process.env.AI_API_KEY || process.env.OPENAI_API_KEY || '';
const AI_BASE = () => (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const AI_MODEL = () => process.env.AI_MODEL || 'gpt-4o-mini';
const TYPE_LABEL = { mcq: 'multiple choice', tf: 'true/false', short: 'short answer' };
function cleanAiOpts(b) {
  const s = (v, m) => String(v ?? '').trim().slice(0, m);
  const o = {
    topic: s(b.topic, 300), level: s(b.level, 100), difficulty: ['easy', 'medium', 'hard', 'mixed'].includes(b.difficulty) ? b.difficulty : 'mixed',
    language: s(b.language, 50) || 'English', count: Math.round(+b.count),
    types: (Array.isArray(b.types) ? b.types : []).filter((t) => TYPE_LABEL[t]), extra: s(b.extra, 600), source: s(b.source, 6000),
  };
  if (!o.topic && !o.source) throw err(400, 'Enter a topic, or paste some lesson text to base the questions on.');
  if (!(o.count >= 1 && o.count <= 50)) throw err(400, 'Choose between 1 and 50 questions.');
  if (!o.types.length) o.types = ['mcq'];
  return o;
}
function buildPrompt(o) {
  const types = o.types.map((t) => TYPE_LABEL[t]);
  return [
    `You are an experienced teacher writing an exam. Write exactly ${o.count} exam question${o.count === 1 ? '' : 's'}.`,
    '',
    `Topic: ${o.topic || 'the text provided below'}`,
    o.level ? `Level: ${o.level}` : null,
    `Difficulty: ${o.difficulty}`,
    `Language of the questions, options and explanations: ${o.language}`,
    `Question types: ${types.join(', ')}${types.length > 1 ? ' (use a sensible mix; multiple choice should be the largest share if included)' : ''}`,
    o.extra ? `Extra instructions: ${o.extra}` : null,
    '',
    'OUTPUT FORMAT. Follow it exactly. Plain text only: no markdown, no bold, no bullet points, no headings, no introduction or closing remarks.',
    '- Number the questions 1., 2., 3. and leave a blank line between questions.',
    '- Multiple choice: the question, then four options on separate lines labelled A. B. C. D., then "Answer: " followed by one letter, then "Explanation: " with one or two sentences.',
    '- True/false: the statement, then "Answer: True" or "Answer: False", then "Explanation: ...".',
    '- Short answer: the question, then "Answer: " with the expected answer (separate accepted alternatives with |), then "Explanation: ...".',
    'Keep the labels A. B. C. D., the words "Answer:" and "Explanation:", and the words True/False in English even if the language above is not English.',
    'Each question must have exactly one correct answer. Make wrong options plausible, avoid "all of the above", and vary which letter is correct.',
    '',
    'Example (multiple choice):',
    '1. Which gas do plants absorb for photosynthesis?',
    'A. Oxygen',
    'B. Carbon dioxide',
    'C. Nitrogen',
    'D. Hydrogen',
    'Answer: B',
    'Explanation: Plants take in carbon dioxide and use it with water and light to make sugar.',
    o.source ? `\nBase every question only on this text:\n"""\n${o.source}\n"""` : null,
  ].filter((l) => l !== null).join('\n');
}
// ChatGPT likes markdown (**bold**, bullets, code fences). Strip it so the importer sees plain lines.
const cleanAiText = (t) => String(t || '').replace(/\r/g, '').replace(/```[a-z]*\n?/gi, '').replace(/\*\*|__/g, '').replace(/^\s*#{1,6}\s*/gm, '').replace(/^\s*[-•]\s+/gm, '').replace(/^(\s*\d{1,3})\\\./gm, '$1.');
async function callAI(prompt) {
  const key = AI_KEY();
  if (!key) throw err(503, 'Automatic AI generation is not set up. Add AI_API_KEY to your environment variables, or use the free copy-and-paste tab.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  let r;
  try {
    r = await fetch(`${AI_BASE()}/chat/completions`, {
      method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: AI_MODEL(), temperature: 0.4, messages: [{ role: 'system', content: 'You write exam questions in a strict plain-text format.' }, { role: 'user', content: prompt }] }),
    });
  } catch (e) {
    throw err(504, e.name === 'AbortError' ? 'The AI service took too long. Try fewer questions, or use the copy-and-paste tab.' : 'Could not reach the AI service.');
  } finally { clearTimeout(timer); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw err(502, `AI service error: ${String((d.error && d.error.message) || (Array.isArray(d) && d[0] && d[0].error && d[0].error.message) || r.status)}`.slice(0, 300));
  const text = d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
  if (!text) throw err(502, 'The AI returned an empty answer. Please try again.');
  return text;
}

/* ---------- app ---------- */
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
// Netlify rewrites /api/* to /.netlify/functions/api/*; put the /api prefix back.
app.use((req, res, next) => { req.url = req.url.replace(/^\/\.netlify\/functions\/api/, '/api'); next(); });
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin', 'Cache-Control': req.path.startsWith('/api') ? 'no-store' : 'no-cache' });
  next();
});
// Own body reader: works the same on Node, Vercel and Netlify (no body-parser quirks with pre-read streams).
const readStream = (req) => new Promise((resolve, reject) => {
  const chunks = []; let n = 0, over = false;
  req.on('data', (c) => { n += c.length; if (n > MAX_BODY) { over = true; chunks.length = 0; } else if (!over) chunks.push(c); });
  req.on('end', () => (over ? reject(err(413, 'File is too large (maximum 4 MB).')) : resolve(Buffer.concat(chunks))));
  req.on('error', reject);
});
app.use('/api', wrap(async (req, res, next) => {
  req.data = {};
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return next();
  let buf;
  if (req.readableEnded) { const b = req.body; buf = Buffer.isBuffer(b) ? b : typeof b === 'string' ? Buffer.from(b) : Buffer.from(JSON.stringify(b || {})); }
  else buf = await readStream(req);
  if ((req.get('content-type') || '').includes('application/json')) {
    try { req.data = buf.length ? JSON.parse(buf.toString('utf8')) : {}; } catch { throw err(400, 'Invalid JSON.'); }
  } else req.data = buf;
  next();
}));
app.use(express.static(path.join(__dirname, 'public')));
// Hidden admin entry point: https://your-site/admin
app.get(['/admin', '/admin/'], (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use('/api', wrap(async (req, res, next) => { await init(); next(); }));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many login attempts. Try again in 15 minutes.' } });
const joinLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests. Please wait a minute.' } });

app.get('/api/health', wrap(async (req, res) => { await one('SELECT 1 x'); res.json({ ok: true, serverless: SERVERLESS }); }));

/* ----- student ----- */
async function openExam(nameRaw, codeRaw) {
  const name = String(nameRaw || '').trim().replace(/\s+/g, ' ');
  const code = String(codeRaw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (name.length < 2 || name.length > 80) throw err(400, 'Enter your full name (2–80 characters).');
  const exam = code && (await one('SELECT * FROM exams WHERE code=? AND published=1', [code]));
  if (!exam) throw err(404, 'That exam code is not valid.');
  if (exam.start_at && now() < exam.start_at) throw err(403, `This exam opens on ${new Date(exam.start_at).toUTCString()}.`);
  if (exam.end_at && now() > exam.end_at) throw err(403, 'This exam is closed.');
  const key = norm(name);
  const prev = await one('SELECT submitted_at FROM attempts WHERE exam_id=? AND name_key=?', [exam.id, key]);
  if (prev) throw err(409, prev.submitted_at ? 'You have already submitted this exam.' : 'This exam was already started under your name. Resume on the original device, or ask your teacher to reset it.');
  return { exam, name, key };
}
app.post('/api/student/lookup', joinLimiter, wrap(async (req, res) => {
  const { exam } = await openExam(req.data.name, req.data.code);
  const n = (await one('SELECT COUNT(*) c FROM questions WHERE exam_id=?', [exam.id])).c;
  res.json({ title: exam.title, subject: exam.subject, instructions: exam.instructions, duration: exam.duration, questions: n, total: await totalMarks(exam.id), passMarks: exam.pass_marks });
}));
app.post('/api/student/start', joinLimiter, wrap(async (req, res) => {
  const { exam, name, key } = await openExam(req.data.name, req.data.code);
  const token = crypto.randomBytes(24).toString('hex');
  try {
    await run('INSERT INTO attempts(exam_id,name,name_key,token,started_at,deadline) VALUES(?,?,?,?,?,?)', [exam.id, name, key, token, now(), now() + exam.duration * 60000]);
  } catch { throw err(409, 'You have already started this exam.'); }
  res.json({ token });
}));
const studentAuth = wrap(async (req, res, next) => {
  const t = req.get('x-attempt-token');
  let a = t && (await one('SELECT * FROM attempts WHERE token=?', [t]));
  if (!a) throw err(401, 'Exam session not found.');
  if (!a.submitted_at && now() > a.deadline) { await finalize(a.id, true); a = await one('SELECT * FROM attempts WHERE id=?', [a.id]); }
  req.attempt = a;
  next();
});
app.get('/api/student/attempt', studentAuth, wrap(async (req, res) => {
  const a = req.attempt;
  if (a.submitted_at) return res.json({ submitted: true });
  const exam = await one('SELECT title,subject,instructions,duration FROM exams WHERE id=?', [a.exam_id]);
  const questions = (await all('SELECT id,type,text,options,marks FROM questions WHERE exam_id=? ORDER BY pos', [a.exam_id])).map(parseQ);
  const answers = Object.fromEntries((await all('SELECT question_id,response FROM answers WHERE attempt_id=?', [a.id])).map((r) => [r.question_id, r.response]));
  res.json({ exam, name: a.name, questions, answers, remaining: a.deadline - now() });
}));
async function storeAnswers(a, entries) {
  const valid = new Set((await all('SELECT id FROM questions WHERE exam_id=?', [a.exam_id])).map((r) => r.id));
  const stmts = entries.filter(([q]) => valid.has(+q)).map(([q, v]) => ({
    sql: 'INSERT INTO answers(attempt_id,question_id,response) VALUES(?,?,?) ON CONFLICT(attempt_id,question_id) DO UPDATE SET response=excluded.response',
    args: [a.id, +q, String(v ?? '').slice(0, 2000)],
  }));
  if (stmts.length) await db.batch(stmts, 'write');
}
app.put('/api/student/answer', studentAuth, wrap(async (req, res) => {
  const a = req.attempt;
  if (a.submitted_at) throw err(409, 'This exam has already been submitted.');
  await storeAnswers(a, [[req.data.questionId, req.data.response]]);
  res.json({ ok: true });
}));
app.post('/api/student/submit', studentAuth, wrap(async (req, res) => {
  const a = req.attempt;
  if (!a.submitted_at) {
    const given = req.data && typeof req.data.answers === 'object' && req.data.answers ? req.data.answers : {};
    if (now() <= a.deadline + 10000) await storeAnswers(a, Object.entries(given));
    await finalize(a.id, false);
  }
  res.json({ ok: true });
}));
app.get('/api/student/result', studentAuth, wrap(async (req, res) => {
  if (!req.attempt.submitted_at) throw err(409, 'Exam not submitted yet.');
  res.json({ ...(await summaries('WHERE a.id=?', [req.attempt.id]))[0], review: await review(req.attempt) });
}));

/* ----- admin ----- */
app.post('/api/admin/login', loginLimiter, wrap(async (req, res) => {
  const u = await one('SELECT * FROM admins WHERE username=?', [String(req.data.username || '').trim()]);
  if (!u || !bcrypt.compareSync(String(req.data.password || ''), u.hash)) throw err(401, 'Incorrect username or password.');
  res.json({ token: jwt.sign({ id: u.id, u: u.username }, SECRET, { expiresIn: '8h' }), username: u.username });
}));
app.use('/api/admin', (req, res, next) => {
  try { req.admin = jwt.verify((req.get('authorization') || '').replace(/^Bearer /, ''), SECRET); next(); }
  catch { next(err(401, 'Please sign in again.')); }
});

app.post('/api/admin/password', wrap(async (req, res) => {
  const p = String(req.data.newPassword || '');
  const u = await one('SELECT * FROM admins WHERE id=?', [req.admin.id]);
  if (!u || !bcrypt.compareSync(String(req.data.oldPassword || ''), u.hash)) throw err(400, 'Current password is incorrect.');
  if (p.length < 8) throw err(400, 'New password must be at least 8 characters.');
  await run('UPDATE admins SET hash=? WHERE id=?', [bcrypt.hashSync(p, 12), u.id]);
  res.json({ ok: true });
}));
app.get('/api/admin/stats', wrap(async (req, res) => {
  await sweep();
  const exams = await all('SELECT * FROM exams');
  const subs = await summaries('WHERE a.submitted_at IS NOT NULL');
  res.json({
    exams: exams.length, open: exams.filter((e) => examState(e) === 'open').length,
    active: (await one('SELECT COUNT(*) c FROM attempts WHERE submitted_at IS NULL')).c,
    submissions: subs.length, pending: subs.filter((s) => s.pending).length,
    avg: subs.length ? Math.round((subs.reduce((t, s) => t + s.pct, 0) / subs.length) * 10) / 10 : 0,
    passRate: subs.length ? Math.round((subs.filter((s) => s.status === 'Pass').length / subs.length) * 100) : 0,
  });
}));
app.get('/api/admin/exams', wrap(async (req, res) => {
  const rows = await all(`SELECT e.*, (SELECT COUNT(*) FROM questions WHERE exam_id=e.id) qn,
    (SELECT COALESCE(SUM(marks),0) FROM questions WHERE exam_id=e.id) total,
    (SELECT COUNT(*) FROM attempts WHERE exam_id=e.id) attempts FROM exams e ORDER BY e.id DESC`);
  res.json(rows.map((e) => ({ ...e, state: examState(e) })));
}));
app.get('/api/admin/exams/:id', wrap(async (req, res) => {
  const e = await one('SELECT * FROM exams WHERE id=?', [+req.params.id]);
  if (!e) throw err(404, 'Exam not found.');
  res.json({ ...e, state: examState(e), locked: !!(await one('SELECT 1 x FROM attempts WHERE exam_id=? LIMIT 1', [e.id])), questions: (await all('SELECT * FROM questions WHERE exam_id=? ORDER BY pos', [e.id])).map(parseQ) });
}));
app.post('/api/admin/exams', wrap(async (req, res) => res.status(201).json(await saveExam(null, req.data))));
app.put('/api/admin/exams/:id', wrap(async (req, res) => res.json(await saveExam(+req.params.id, req.data))));
app.post('/api/admin/exams/:id/publish', wrap(async (req, res) => {
  const e = await one('SELECT * FROM exams WHERE id=?', [+req.params.id]);
  if (!e) throw err(404, 'Exam not found.');
  const on = req.data.published ? 1 : 0;
  if (on && (await totalMarks(e.id)) === 0) throw err(400, 'Add at least one question before publishing.');
  await run('UPDATE exams SET published=? WHERE id=?', [on, e.id]);
  res.json({ ok: true });
}));
app.delete('/api/admin/exams/:id', wrap(async (req, res) => {
  const id = +req.params.id;
  await db.batch([
    { sql: 'DELETE FROM answers WHERE attempt_id IN (SELECT id FROM attempts WHERE exam_id=?)', args: [id] },
    { sql: 'DELETE FROM attempts WHERE exam_id=?', args: [id] },
    { sql: 'DELETE FROM questions WHERE exam_id=?', args: [id] },
    { sql: 'DELETE FROM exams WHERE id=?', args: [id] },
  ], 'write');
  res.json({ ok: true });
}));

app.post('/api/admin/import', wrap(async (req, res) => {
  const buf = req.data;
  if (!Buffer.isBuffer(buf) || !buf.length) throw err(400, 'No file received.');
  const ext = path.extname(decodeURIComponent(req.get('x-filename') || '').toLowerCase());
  let text;
  if (ext === '.pdf') {
    if (buf.subarray(0, 4).toString() !== '%PDF') throw err(400, 'This is not a valid PDF file.');
    text = (await pdfParse(buf)).text;
  } else if (ext === '.docx') {
    if (buf.subarray(0, 2).toString() !== 'PK') throw err(400, 'This is not a valid Word (.docx) file.');
    text = htmlToLines((await mammoth.convertToHtml({ buffer: buf })).value).join('\n');
  } else if (ext === '.txt') text = buf.toString('utf8');
  else throw err(400, 'Upload a .pdf, .docx or .txt file. For an old .doc file, open it in Word and choose Save As .docx.');
  if (text.trim().length < 10) throw err(422, 'No readable text found. Scanned or image-only PDFs are not supported.');
  const out = parseExamText(text);
  if (!out.questions.length) throw err(422, 'No questions were detected. Number each question (1. 2. 3.), list options as A. B. C. D., and add an "Answer: B" line. See the format guide in the exam editor.');
  res.json(out);
}));

const aiLimiter = rateLimit({ windowMs: 60 * 1000, max: 8, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many AI requests. Please wait a minute.' } });
app.get('/api/admin/ai/status', (req, res) => res.json({ enabled: !!AI_KEY(), model: AI_MODEL(), host: new URL(AI_BASE()).host }));
app.post('/api/admin/ai/prompt', wrap(async (req, res) => res.json({ prompt: buildPrompt(cleanAiOpts(req.data)) })));
app.post('/api/admin/ai/generate', aiLimiter, wrap(async (req, res) => {
  const o = cleanAiOpts(req.data);
  if (o.count > 30) throw err(400, 'Automatic generation is limited to 30 questions at a time. Use copy-and-paste for more.');
  const out = parseExamText(cleanAiText(await callAI(buildPrompt(o))));
  if (!out.questions.length) throw err(502, 'The AI reply could not be read as questions. Please try again.');
  res.json(out);
}));
app.post('/api/admin/parse', wrap(async (req, res) => {
  const text = cleanAiText(req.data.text);
  if (text.trim().length < 20) throw err(400, 'Paste the reply first.');
  if (text.length > 80000) throw err(413, 'That text is too long.');
  const out = parseExamText(text);
  if (!out.questions.length) throw err(422, "No questions were found in that text. Make sure you pasted ChatGPT's whole reply and that it followed the format in the prompt.");
  res.json(out);
}));

app.get('/api/admin/live', wrap(async (req, res) => {
  await sweep();
  const rows = await all(`SELECT a.*, e.title,
    (SELECT COUNT(*) FROM questions WHERE exam_id=a.exam_id) qn,
    (SELECT COUNT(*) FROM answers WHERE attempt_id=a.id AND TRIM(COALESCE(response,''))<>'') answered
    FROM attempts a JOIN exams e ON e.id=a.exam_id WHERE a.submitted_at IS NULL ORDER BY a.started_at DESC`);
  res.json(rows.map((r) => ({ id: r.id, name: r.name, exam: r.title, answered: r.answered, total: r.qn, remaining: Math.max(0, Math.round((r.deadline - now()) / 1000)), startedAt: r.started_at })));
}));

async function listResults(q) {
  await sweep();
  const exam = +q.exam_id || 0;
  const needle = norm(q.q);
  return (await summaries(exam ? 'WHERE a.exam_id=?' : '', exam ? [exam] : []))
    .filter((s) => (!q.status || s.status === q.status) && (!needle || norm(s.name).includes(needle)));
}
app.get('/api/admin/results', wrap(async (req, res) => res.json(await listResults(req.query))));
app.get('/api/admin/attempts/:id', wrap(async (req, res) => {
  const a = await one('SELECT * FROM attempts WHERE id=?', [+req.params.id]);
  if (!a) throw err(404, 'Attempt not found.');
  res.json({ ...(await summaries('WHERE a.id=?', [a.id]))[0], review: await review(a) });
}));
app.put('/api/admin/attempts/:id/grade', wrap(async (req, res) => {
  const a = await one('SELECT * FROM attempts WHERE id=?', [+req.params.id]);
  if (!a || !a.submitted_at) throw err(404, 'Submitted attempt not found.');
  const q = await one('SELECT * FROM questions WHERE id=? AND exam_id=?', [+req.data.questionId, a.exam_id]);
  const awarded = Number(req.data.awarded);
  if (!q) throw err(404, 'Question not found.');
  if (!Number.isFinite(awarded) || awarded < 0 || awarded > q.marks) throw err(400, `Marks must be between 0 and ${q.marks}.`);
  await run('UPDATE answers SET awarded=? WHERE attempt_id=? AND question_id=?', [awarded, a.id, q.id]);
  res.json({ ok: true });
}));
app.delete('/api/admin/attempts/:id', wrap(async (req, res) => {
  await db.batch([{ sql: 'DELETE FROM answers WHERE attempt_id=?', args: [+req.params.id] }, { sql: 'DELETE FROM attempts WHERE id=?', args: [+req.params.id] }], 'write');
  res.json({ ok: true });
}));

const safeCell = (v) => (typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v);
app.get('/api/admin/export/:fmt', wrap(async (req, res) => {
  const rows = (await listResults(req.query)).map((s) => ({ ...s, name: safeCell(s.name), when: s.submittedAt ? new Date(s.submittedAt).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '' }));
  const head = ['Student', 'Exam', 'Score', 'Total', 'Percentage', 'Status', 'Submitted'];
  const line = (s) => [s.name, s.exam, s.score, s.total, s.pct + '%', s.status, s.when];
  const stamp = new Date().toISOString().slice(0, 10);
  if (req.params.fmt === 'csv') {
    const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="results-${stamp}.csv"` });
    return res.send('\ufeff' + [head, ...rows.map(line)].map((r) => r.map(esc).join(',')).join('\r\n'));
  }
  if (req.params.fmt === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Results');
    ws.columns = head.map((h, i) => ({ header: h, width: [26, 30, 10, 10, 12, 16, 22][i] }));
    rows.forEach((s) => ws.addRow(line(s)));
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D3FBB' } };
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="results-${stamp}.xlsx"` });
    return res.send(Buffer.from(await wb.xlsx.writeBuffer()));
  }
  if (req.params.fmt === 'pdf') {
    const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    const done = new Promise((resolve) => doc.on('end', resolve));
    const xs = [40, 190, 380, 450, 510, 580, 670];
    const row = (cells, bold) => { const y = doc.y; doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9); cells.forEach((c, i) => doc.text(String(c), xs[i], y, { width: (xs[i + 1] || 800) - xs[i] - 6, height: 12, ellipsis: true, lineBreak: false })); doc.y = y + 18; };
    doc.font('Helvetica-Bold').fontSize(18).text('Examination Results', 40, 40);
    doc.font('Helvetica').fontSize(9).fillColor('#555').text(`Generated ${new Date().toUTCString()} · ${rows.length} record(s)`, 40, 64).fillColor('#000');
    doc.y = 90; row(head, true);
    rows.forEach((s) => { if (doc.y > 520) { doc.addPage(); doc.y = 40; row(head, true); } row(line(s)); });
    doc.end();
    await done;
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="results-${stamp}.pdf"` });
    return res.send(Buffer.concat(chunks));
  }
  throw err(400, 'Unsupported export format.');
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((e, req, res, next) => {
  if (!e.status) console.error(e);
  res.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong on the server.' });
});

module.exports = app;
if (require.main === module) app.listen(PORT, () => { console.log(`ExamHub running on http://localhost:${PORT}`); init().catch((e) => console.error('Startup error:', e.message)); });
