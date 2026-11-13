// The Logbook's weekly view: where the time went, per day and per project.
const TOKEN = document.querySelector('meta[name="oberth-token"]').content;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
// The setup (config.json): with an assistant, the week is measured in its session time; without one, in commits
const SETUP = (() => { try { return JSON.parse(document.querySelector('meta[name="oberth-config"]')?.content ?? '{}'); } catch { return {}; } })();
const AI = SETUP.assistant?.can?.sessions ? SETUP.assistant : null;
/** What a bar measures: session time when the week has any, else commits (no assistant, or a week without sessions). */
let byTime = !!AI;
const amount = (x) => (byTime ? x.ms : x.commits);
const amountText = (x) => (byTime ? span(x.ms) : x.commits ? plural(x.commits, 'commit') : '–');

/** A span of time as people say it: 3 h 20 m, 45 m, under a minute. Nothing at all is a dash. */
function span(ms) {
  if (!ms) return '–';
  const m = Math.round(ms / 60000);
  if (m < 1) return '<1 m';
  return m < 60 ? `${m} m` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} m`;
}
/** Dollars as people say them: $0.42, $12, $1,204. Nothing at all is a dash. */
const usd = (n) => (!n ? '–' : n < 1 ? `$${n.toFixed(2)}` : n < 100 ? `$${n.toFixed(n < 10 ? 2 : 1)}` : `$${Math.round(n).toLocaleString('en-GB')}`);
const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
const local = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
const fmt = (key, o) => local(key).toLocaleDateString('en-GB', o);

function dayColumn(d, peak, today) {
  const h = peak ? Math.round((amount(d) / peak) * 100) : 0;
  const tip = `${fmt(d.date, { weekday: 'long', day: 'numeric', month: 'short' })}: ${AI ? `${span(d.ms)}, ${plural(d.turns, 'turn')}, ` : ''}${plural(d.commits, 'commit')}${d.usd ? `, ${usd(d.usd)} at API prices` : ''}`;
  return `<div class="lbday${d.date === today ? ' today' : ''}" tabindex="0" aria-label="${esc(tip)}">
    <span class="tip">${esc(tip)}</span>
    <div class="col"><div class="bar" style="height:${amount(d) ? `max(${h}%, 3px)` : '0'}"></div></div>
    <span class="v">${amount(d) ? esc(amountText(d)) : ''}</span>
    <span class="d">${esc(fmt(d.date, { weekday: 'short' }))}</span>
  </div>`;
}

function projectRow(p, peak) {
  const counts = [p.turns && plural(p.turns, 'turn'), p.commits && plural(p.commits, 'commit'), p.launches && plural(p.launches, 'launch').replace('launchs', 'launches')].filter(Boolean).join(' · ');
  const icon = p.icon ? `<img src="${esc(p.icon)}" alt="">` : `<span class="badge">${esc(p.name.slice(0, 1).toUpperCase())}</span>`;
  const head = `${icon}<span class="who"><span class="t">${esc(p.name)}</span><span class="p">${esc(counts)}</span></span>
    <span class="track"><span class="fill" style="width:${peak && amount(p) ? `max(${(amount(p) / peak) * 100}%, 3px)` : '0'}"></span></span>
    <span class="time">${esc(amountText(p))}</span>
    ${AI ? `<span class="usd" title="${esc(p.tokens ? `${p.tokens.toLocaleString('en-GB')} tokens at API prices` : 'no tokens recorded')}">${esc(usd(p.usd))}</span>` : '<span class="usd"></span>'}`;
  if (!p.sessions.length) return `<div class="lbrow"><div class="lbline">${head}</div></div>`;
  const sessions = p.sessions.map((s) => `<li><span>${esc(s.title)}</span><span class="time">${esc(span(s.ms))}</span></li>`).join('');
  return `<details class="lbrow"><summary class="lbline">${head}</summary><ul>${sessions}</ul></details>`;
}

// The week in review (review.ts), for a finished week: what the week view doesn't already show. Projects left
// untouched long enough to pause, Released projects that changed, and released work seen from outside.
const days = (n) => plural(n, 'day');
async function drawReview(w) {
  const box = $('#lb-review');
  if (w.current) { box.hidden = true; return; }
  let r;
  try {
    const res = await fetch(`/api/review?start=${encodeURIComponent(w.start)}`, { headers: { 'X-Oberth-Token': TOKEN } });
    if (!res.ok) throw new Error();
    r = await res.json();
  } catch { box.hidden = true; return; }
  if (week !== w) return; // another week was opened meanwhile
  const open = (id) => `/?p=${encodeURIComponent(id)}`;
  const parts = [];
  if (r.ms || r.commits) {
    parts.push(`<p class="lbsum">${AI ? `${esc(span(r.ms))} with ${esc(AI.label)}` : 'Work'} across ${esc(plural(r.worked, 'project'))} \u00b7 ${esc(plural(r.commits, 'commit'))}${r.usd ? ` \u00b7 ${esc(usd(r.usd))} at API prices` : ''}${r.top[0] ? `. Most time on <a href="${open(r.top[0].id)}">${esc(r.top[0].name)}</a>.` : ''}</p>`);
  }
  if (r.untouched.length) {
    parts.push(`<h3>Untouched for three weeks or more</h3><ul>${r.untouched.map((p) => `<li data-rid="${esc(p.id)}"><a href="${open(p.id)}">${esc(p.name)}</a><span class="note">last touched ${esc(days(p.days))} ago</span><button class="btn" data-pause>Pause it</button></li>`).join('')}</ul>`);
  }
  if (r.releasedWork.length) {
    parts.push(`<h3>Released, and changed this week</h3><ul>${r.releasedWork.map((p) => `<li><a href="${open(p.id)}">${esc(p.name)}</a><span class="note">${esc(plural(p.commits, 'commit'))}: time for a release?</span></li>`).join('')}</ul>`);
  }
  if (r.outside.length) {
    parts.push(`<h3>Outside</h3><ul>${r.outside.map((p) => {
      const bits = [p.stars !== undefined && `\u2605 ${p.stars}`, p.forks && plural(p.forks, 'fork'), p.downloads !== undefined && `${p.downloads.toLocaleString('en-GB')} downloads last week`,
        p.waiting && `<b>${plural(p.waiting, 'issue')} waiting for you</b>`, p.siteDown && '<b class="down">site down</b>'].filter(Boolean);
      return `<li><a href="${open(p.id)}">${esc(p.name)}</a><span class="note">${bits.join(' \u00b7 ')}</span></li>`;
    }).join('')}</ul>`);
  }
  box.innerHTML = parts.length ? `<h2>Week in review</h2>${parts.join('')}` : '';
  box.hidden = !parts.length;
  // seen: the Agenda's "Last week in review" row has done its job
  if (parts.length) fetch('/api/review/seen', { method: 'POST', headers: { 'X-Oberth-Token': TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ start: w.start }) }).catch(() => {});
}

$('#lb-review').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-pause]');
  if (!b) return;
  const li = b.closest('[data-rid]');
  b.disabled = true;
  const r = await fetch(`/api/projects/${encodeURIComponent(li.dataset.rid)}/status`, { method: 'POST', headers: { 'X-Oberth-Token': TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'paused' }) });
  if (r.ok) b.replaceWith(Object.assign(document.createElement('span'), { className: 'chip st paused', textContent: 'Paused' }));
  else { b.disabled = false; b.textContent = 'Try again'; }
});

let week = null;
function draw() {
  const w = week;
  const sameMonth = w.start.slice(0, 7) === w.end.slice(0, 7);
  $('#lb-range').textContent = `${fmt(w.start, sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' })} – ${fmt(w.end, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  $('#lb-prev').disabled = !w.prev;
  $('#lb-next').disabled = !w.next;
  // hidden by visibility, so its space stays and the arrows never move
  $('#lb-now').style.visibility = w.current ? 'hidden' : 'visible';
  void drawReview(w);
  const empty = !w.projects.length;
  $('#lb-week').hidden = empty;
  $('#lb-empty').hidden = !empty;
  if (empty) return;
  byTime = !!AI && w.ms > 0;
  $('#lb-ms').textContent = span(w.ms);
  for (const id of ['#lb-ms', '#lb-turns', '#lb-usd']) $(id).parentElement.hidden = !AI;
  $('#lb-note').hidden = !AI;
  $('#lb-turns').textContent = w.turns;
  $('#lb-commits').textContent = w.commits;
  $('#lb-usd').textContent = usd(w.usd);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const peakDay = Math.max(...w.days.map(amount));
  $('#lb-days').innerHTML = w.days.map((d) => dayColumn(d, peakDay, today)).join('');
  const peak = Math.max(...w.projects.map(amount));
  $('#lb-projects').innerHTML = w.projects.map((p) => projectRow(p, peak)).join('');
}

async function load(start, push) {
  try {
    const r = await fetch(`/api/logbook/week${start ? `?start=${encodeURIComponent(start)}` : ''}`, { headers: { 'X-Oberth-Token': TOKEN } });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
    week = await r.json();
    $('#lb-error').hidden = true;
    if (push) history.pushState(null, '', week.current ? '/logbook' : `/logbook?week=${week.start}`);
    draw();
  } catch (e) {
    $('#lb-error').hidden = false;
    $('#lb-error').textContent = `Can't load this week: ${e.message}`;
  }
}

const fromUrl = () => new URLSearchParams(location.search).get('week') ?? undefined;
$('#lb-prev').addEventListener('click', () => week?.prev && load(week.prev, true));
$('#lb-next').addEventListener('click', () => week?.next && load(week.next, true));
$('#lb-now').addEventListener('click', () => load(undefined, true));
addEventListener('popstate', () => load(fromUrl()));

// the sidebar's counts (filled in when the page was served), kept current like the dashboard's
async function refreshCounts() {
  const get = (path) => fetch(path, { headers: { 'X-Oberth-Token': TOKEN } }).then((r) => (r.ok ? r.json() : null), () => null);
  const [agenda, ideas] = await Promise.all([get('/api/agenda'), get('/api/ideas')]);
  if (agenda && $('#nav-need')) $('#nav-need').textContent = agenda.count || '';
  if (ideas && $('#nav-ideas-n')) $('#nav-ideas-n').textContent = ideas.open || '';
}
setInterval(refreshCounts, 5000);
load(fromUrl());
