# ExamHub: Online Examination System for Schools

Express API + vanilla-JS front end, using a **Turso (libSQL) database**, so it runs locally, on **Vercel** or on **Netlify**, all on free plans.

**Features:** admin login (bcrypt + JWT, rate-limited) · create/edit/delete/schedule exams · one permanent exam code per exam, shared by all students · multiple-choice, true/false and short-answer questions with marks and explanations · **import an exam from PDF, Word (.docx) or .txt** · live monitor · server-side timer with auto-submit · instant grading + manual grading of short answers · filter and export results (CSV / Excel / PDF) · dark/light mode.

Admin area: open **`/admin`** (it is not linked from the public homepage).

**Multiple teachers:** the account created from `ADMIN_USERNAME` / `ADMIN_PASSWORD` is the **main admin**. It can add teacher accounts under the **Teachers** tab. Every teacher works privately: they only see and manage their own exams, students' results, live monitor and exports.

---
## 1. Run locally
Node.js 18+.
```bash
npm install
cp .env.example .env     # set JWT_SECRET, ADMIN_USERNAME, ADMIN_PASSWORD; leave the TURSO_ lines empty to use a local SQLite file
npm start                # http://localhost:3000  (admin: http://localhost:3000/admin)
```

## 2. Create the free database (Turso), needed for Vercel/Netlify
1. Sign up at **turso.tech** (free plan, no card).
2. **Create database** → name it `examhub` → pick the region nearest your students.
3. Open the database → copy the **URL** (`libsql://examhub-yourname.turso.io`).
4. Create a token (**Generate Token** in the dashboard; read & write) and copy it.

You will paste these as `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` below. Tables are created automatically on first request.

## 3. Push to GitHub
```bash
git init && git add . && git commit -m "ExamHub"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/examhub.git
git push -u origin main
```
`.env` and `data/` are git-ignored. Never commit real secrets.

## 4a. Deploy on Vercel
1. vercel.com → **Add New → Project** → import the GitHub repo.
2. Framework preset: **Other**. Leave build/output settings empty (`vercel.json` sets them).
3. **Environment Variables:** `JWT_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`.
4. **Deploy**. Check `https://YOUR-APP.vercel.app/api/health` → `{"ok":true,...}`, then sign in at `/admin`.

## 4b. Deploy on Netlify
1. app.netlify.com → **Add new site → Import an existing project** → pick the repo.
2. Build command: empty. Publish directory: `public`. Functions directory: `netlify/functions` (`netlify.toml` sets all three).
3. **Site configuration → Environment variables:** the same five variables as above.
4. Deploy, then check `/api/health` and sign in at `/admin`.

If you change environment variables, redeploy so they take effect.

## Importing an exam from PDF / Word
Click **Import PDF / Word** (Exams page or exam editor). Questions are filled in for you to review; nothing is saved until you press **Save exam**.
```
Title: Term 1 Science
Duration: 45 minutes
Passing marks: 6
Instructions: Answer all questions.

1. What is the chemical symbol for water? (2 marks)
A. H2O
B. CO2
C. NaCl
Answer: A
Explanation: Two hydrogen atoms and one oxygen atom.

2. The sun is a star.
Answer: True
Explanation: It is the star at the centre of our solar system.

3. Name the process plants use to make food.
Answer: photosynthesis | photo synthesis
```
Also understood: `Q1.` / `Question 1` / `(1)` numbering; options as `a)` or `(a)`, or all on one line; `Correct Answer:` / `Ans:`; explanation labelled `Explanation / Reason / Rationale / Solution / Why / Feedback` (multi-line OK); `Marks: 2` or `(2 marks)`; an **Answer Key** section at the end; an option ending in ✓ or `*`, or typed in **bold in Word**, as the correct answer; Word auto-numbered lists. Anything uncertain is flagged with a "Check this question" notice. Scanned/image-only PDFs and old `.doc` files are not supported. Maximum file size 4 MB (hosting limit).

## Secure exam mode (Safe Exam Browser style)
In the exam editor, the **Exam security** box controls three settings for each exam:
- **Strict mode** (on by default for new exams). The exam runs in full screen. Switching tabs, minimising, switching to another window or app, or leaving full screen is detected, counted as a **violation**, and shown to the student with a warning they must acknowledge. Copy, cut, paste, right-click, drag, text selection of questions, printing and common shortcuts (F12, Ctrl+Shift+I/J/C, Ctrl+U/S/P) are blocked.
- **Submit automatically after N violations** (default 3, range 0 to 10). When the limit is reached the exam is submitted at once and the result says why. Use 0 to only record violations without auto-submitting.
- **Require Safe Exam Browser.** Students must open the exam inside the real [Safe Exam Browser](https://safeexambrowser.org/) app (free). The server refuses other browsers. In SEB, set the *Start URL* to your site address.

Teachers see violations on the **Live monitor** (as they happen), in the **Results** table and exports (a Violations column), and a time-stamped **security log** when reviewing a student's attempt.

**What this can and cannot do.** A website can detect and record that a student left the exam page, but it cannot stop them from opening another tab, a second device or a phone, and browsers do not let pages block shortcuts such as Ctrl+T or Alt+Tab. Strict mode is a strong deterrent with an audit trail. For the strongest control, require Safe Exam Browser and, for high-stakes exams, invigilate the room. The Safe Exam Browser check uses the browser's identifier, which a determined student could fake. iPhones do not support the full-screen API, so on iPhones the tab-switch and app-switch detection still works but full screen is not enforced.

## Teacher accounts (multiple admins)
1. Sign in at `/admin` as the main admin and open **Teachers → Add teacher**. Enter the teacher's name, a username and a temporary password (a random one is suggested), then give those details to the teacher.
2. Each teacher signs in at the same `/admin` address, creates their own exams and shares their own exam codes. Teachers cannot see, edit, grade, export or delete anyone else's exams or results. The main admin cannot see them either, except through the Teachers list (name, username, number of exams, status).
3. **Reset password** replaces a forgotten password. **Disable** blocks sign-in immediately (existing sessions stop working) without deleting the teacher's data, and **Enable** restores access. **Delete** removes an account, but only when it owns no exams.
4. Teachers can change their own password from **Dashboard → Change password**.

**Upgrading an existing site:** deploy this version over the old one. The database upgrades itself on the first request: your existing admin becomes the main admin and keeps all existing exams and results. No data is lost.

## AI question generator
In the exam editor press **Generate with AI**, describe what you want (topic, grade, number of questions, difficulty, language, question types, extra instructions, or paste your own lesson text) and the questions land in the editor for you to review before saving.

**Option 1: free ChatGPT, copy and paste (no setup).** The free ChatGPT app has no connection that other software can call, so ExamHub builds a ready-made prompt for you: press *Copy prompt*, paste it into chatgpt.com, copy ChatGPT's whole reply, paste it back into ExamHub and press *Convert to questions*. Markdown such as **bold** and bullet points is cleaned automatically. Works with Amharic and other languages (the labels `A.` `Answer:` `Explanation:` stay in English so they can be read).

**Option 2: automatic generation (API key).** Add environment variables to your host (and redeploy):

| Variable | Meaning |
|---|---|
| `AI_API_KEY` | key from your AI provider (kept on the server, never sent to browsers) |
| `AI_BASE_URL` | OpenAI-compatible base URL (default `https://api.openai.com/v1`) |
| `AI_MODEL` | model name (default `gpt-4o-mini`) |

Any OpenAI-compatible provider works. Several offer a free tier with an API key (limits change, so check their pricing pages): Google Gemini (`AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai`), Groq (`https://api.groq.com/openai/v1`), OpenRouter (`https://openrouter.ai/api/v1`). Pick a current model name from the provider's documentation. OpenAI's own API is billed separately from a ChatGPT subscription and normally needs paid credit.
Automatic generation is limited to 30 questions per request and 25 seconds (use copy and paste for bigger sets). Netlify's default 10-second function limit may be too short; Vercel is configured for 30 seconds.

## Notes
- **Vercel Hobby** is for non-commercial use; Netlify's free plan has no such restriction. Free-plan function limits (timeouts, monthly invocations) are plenty for a class.
- There are no background timers on serverless hosting. An unfinished attempt is auto-submitted the next time that student or an admin page touches it, using the original deadline.
- The live monitor and results refresh by polling; keep it open only while needed to save free-tier quota.
- Each exam has exactly one code, generated on creation and never changed.
- Back up your data from the Turso dashboard, or export results regularly.

Developer: [Sol Ethio Coder](https://sol-ethio-coder.netlify.app/)
