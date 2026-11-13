// Oberth dashboard. Polls the service, renders project rows and the detail drawer.
const TOKEN = document.querySelector('meta[name="oberth-token"]').content;
// The setup from config.json (GET /api/config): the assistant or none, the editor, the browser, which modules run
const SETUP = (() => { try { return JSON.parse(document.querySelector('meta[name="oberth-config"]')?.content ?? '{}'); } catch { return {}; } })();
const AI = SETUP.assistant ?? null;            // { id, label, can: { open, openNew, … } } or null
const EDITOR = SETUP.editor?.label ?? 'VS Code';
const mod = (m) => SETUP.modules?.[m] !== false;
const CLAUDE = `<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#D97757" d="m4.714 15.956l4.718-2.648l.079-.23l-.08-.128h-.23l-.79-.048l-2.695-.073l-2.337-.097l-2.265-.122l-.57-.121l-.535-.704l.055-.353l.48-.321l.685.06l1.518.104l2.277.157l1.651.098l2.447.255h.389l.054-.158l-.133-.097l-.103-.098l-2.356-1.596l-2.55-1.688l-1.336-.972l-.722-.491L2 6.223l-.158-1.008l.656-.722l.88.06l.224.061l.893.686l1.906 1.476l2.49 1.833l.364.304l.146-.104l.018-.072l-.164-.274l-1.354-2.446l-1.445-2.49l-.644-1.032l-.17-.619a3 3 0 0 1-.103-.729L6.287.133L6.7 0l.995.134l.42.364l.619 1.415L9.735 4.14l1.555 3.03l.455.898l.243.832l.09.255h.159V9.01l.127-1.706l.237-2.095l.23-2.695l.08-.76l.376-.91l.747-.492l.583.28l.48.685l-.067.444l-.286 1.851l-.558 2.903l-.365 1.942h.213l.243-.242l.983-1.306l1.652-2.064l.728-.82l.85-.904l.547-.431h1.032l.759 1.129l-.34 1.166l-1.063 1.347l-.88 1.142l-1.263 1.7l-.79 1.36l.074.11l.188-.02l2.853-.606l1.542-.28l1.84-.315l.832.388l.09.395l-.327.807l-1.967.486l-2.307.462l-3.436.813l-.043.03l.049.061l1.548.146l.662.036h1.62l3.018.225l.79.522l.473.638l-.08.485l-1.213.62l-1.64-.389l-3.825-.91l-1.31-.329h-.183v.11l1.093 1.068l2.003 1.81l2.508 2.33l.127.578l-.321.455l-.34-.049l-2.204-1.657l-.85-.747l-1.925-1.62h-.127v.17l.443.649l2.343 3.521l.122 1.08l-.17.353l-.607.213l-.668-.122l-1.372-1.924l-1.415-2.168l-1.141-1.943l-.14.08l-.674 7.254l-.316.37l-.728.28l-.607-.461l-.322-.747l.322-1.476l.388-1.924l.316-1.53l.285-1.9l.17-.632l-.012-.042l-.14.018l-1.432 1.967l-2.18 2.945l-1.724 1.845l-.413.164l-.716-.37l.066-.662l.401-.589l2.386-3.036l1.439-1.882l.929-1.086l-.006-.158h-.055L4.138 18.56l-1.13.146l-.485-.456l.06-.746l.231-.243l1.907-1.312Z"/></svg>`;
const GITHUB = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" >  <path d="M5.315 2.1c.791 -.113 1.9 .145 3.333 .966l.272 .161l.16 .1l.397 -.083a13.3 13.3 0 0 1 4.59 -.08l.456 .08l.396 .083l.161 -.1c1.385 -.84 2.487 -1.17 3.322 -1.148l.164 .008l.147 .017l.076 .014l.05 .011l.144 .047a1 1 0 0 1 .53 .514a5.2 5.2 0 0 1 .397 2.91l-.047 .267l-.046 .196l.123 .163c.574 .795 .93 1.728 1.03 2.707l.023 .295l.007 .272c0 3.855 -1.659 5.883 -4.644 6.68l-.245 .061l-.132 .029l.014 .161l.008 .157l.004 .365l-.002 .213l-.003 3.834a1 1 0 0 1 -.883 .993l-.117 .007h-6a1 1 0 0 1 -.993 -.883l-.007 -.117v-.734c-1.818 .26 -3.03 -.424 -4.11 -1.878l-.535 -.766c-.28 -.396 -.455 -.579 -.589 -.644l-.048 -.019a1 1 0 0 1 .564 -1.918c.642 .188 1.074 .568 1.57 1.239l.538 .769c.76 1.079 1.36 1.459 2.609 1.191l.001 -.678l-.018 -.168a5.03 5.03 0 0 1 -.021 -.824l.017 -.185l.019 -.12l-.108 -.024c-2.976 -.71 -4.703 -2.573 -4.875 -6.139l-.01 -.31l-.004 -.292a5.6 5.6 0 0 1 .908 -3.051l.152 -.222l.122 -.163l-.045 -.196a5.2 5.2 0 0 1 .145 -2.642l.1 -.282l.106 -.253a1 1 0 0 1 .529 -.514l.144 -.047l.154 -.03z" /> </svg>`;
const GLOBE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>`;
const PHONE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="6" y="3" width="12" height="18" rx="2"/><path d="M11 4h2M12 17v.01"/></svg>`;
const EYE_OFF = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.4 5.2A9.7 9.7 0 0 1 12 5c4 0 7.3 2.4 9 7a13 13 0 0 1-2.2 3.4M6.6 6.6A13 13 0 0 0 3 12c1.7 4.6 5 7 9 7 1.6 0 3-.4 4.4-1.1"/></svg>`;
const CODE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5"/></svg>`;
const FOLDER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/></svg>`;
const PIN = (on) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 4.5l-4 4l-4 1.5l-1.5 1.5l7 7l1.5 -1.5l1.5 -4l4 -4"${on ? ' fill="currentColor"' : ''}/><path d="M9 15l-4.5 4.5"/><path d="M14.5 4l5.5 5.5"/></svg>`;
const EYE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 12c1.7-4.6 5-7 9-7s7.3 2.4 9 7c-1.7 4.6-5 7-9 7s-7.3-2.4-9-7z"/><circle cx="12" cy="12" r="2.5"/></svg>`;
const WARN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4m0 4h.01M10.3 4 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0Z"/></svg>`;
// a repository on GitHub gets its mark; one on another forge a generic branch icon, and the forge's name
const BRANCH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="7" r="2"/><path d="M6 7v10M18 9a6 6 0 0 1-6 6H6"/></svg>`;
const FORGE_NAMES = { 'github.com': 'GitHub', 'gitlab.com': 'GitLab', 'codeberg.org': 'Codeberg', 'bitbucket.org': 'Bitbucket', 'git.sr.ht': 'SourceHut' };
const forge = (url) => { try { const h = new URL(url).hostname; return FORGE_NAMES[h] ?? h; } catch { return 'Repository'; } };
const repoIcon = (url) => (url.startsWith('https://github.com/') ? GITHUB : BRANCH);
const ACTIVE = ['installing', 'starting', 'running', 'stopping'];
let projects = [];
let agenda = { needs: [], look: [], count: 0 };
let loaded = false;
const prevStatus = new Map();   // last seen status per id, to notice a fresh failure
const optimistic = new Map();   // id → status shown while a launch/stop request is in flight
const rowError = new Map();     // id → error from a rejected request, shown on its row until the next action
const $ = (s, el = document) => el.querySelector(s);
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private window */ } } };
let selected = store.get('selected'); // id shown in the drawer
const TABS = ['about', 'output', 'git', 'scripts', 'info'];
let tab = TABS.includes(store.get('tab')) ? store.get('tab') : 'about';
const STATUSES = { active: 'Active', paused: 'Paused', finished: 'Finished', idea: 'Idea' };
// What each status means (owner's definitions, 2026-11-03); shown in the edit form and on the filter buttons.
const STATUS_MEANS = {
  active: 'being built, or being worked on now',
  paused: 'not working on it for now',
  finished: 'does what it was built for and works fully; polish and extras may still come (in its notes)',
  idea: 'not started yet',
  released: 'out where anyone can use it (separate from the status)',
};
let statusFilter = Object.hasOwn(STATUSES, store.get('sfilter') ?? '') || store.get('sfilter') === 'released' ? store.get('sfilter') : 'all';
let filter = 'all'; // Output tab: 'all' lines or 'errors' only

// Grouping and order of the stopped projects (Running stays on top, Hidden at the bottom), remembered like the filter.
const GROUPINGS = {
  kind: { label: 'Kind', of: (p) => (p.kind === 'site' ? 'sites' : p.kind === 'library' ? 'libraries' : 'apps'),
    groups: { apps: 'Apps', sites: 'Sites', libraries: 'Libraries and tools · no dev server' } },
  // no status counts as active, as in the status filter
  status: { label: 'Status', of: (p) => p.about?.status ?? 'active',
    groups: { active: 'Active', paused: 'Paused', finished: 'Finished', idea: 'Ideas' } },
};
// What needs a look: a failed launch, then failing checks or errors, then unpushed, then uncommitted work.
function attention(p) {
  const failedCheck = p.checks.some((n) => p.scripts?.[n]?.status === 'failed');
  return (statusOf(p) === 'failed' ? 8 : 0) + (failedCheck ? 4 : 0) + (p.errors && ACTIVE.includes(statusOf(p)) ? 4 : 0)
    + (p.git?.ahead ? 2 : 0) + (p.git?.changed ? 1 : 0);
}
const newest = (k) => (a, b) => (b[k] ?? 0) - (a[k] ?? 0) || b.recency - a.recency;
const SORTS = {
  recent: { label: 'Recent', head: 'most recent first', cmp: (a, b) => b.recency - a.recency },
  updated: { label: 'Last updated', head: 'last commit or change first', cmp: newest('updated') },
  launched: { label: 'Last launched', head: 'last launched first', cmp: newest('lastLaunched') },
  name: { label: 'Name', head: 'by name', cmp: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) },
  started: { label: 'Started', head: 'newest first', cmp: newest('started') },
  attention: { label: 'Needs attention', head: 'needs attention first', cmp: (a, b) => attention(b) - attention(a) || b.recency - a.recency },
};
let groupBy = Object.hasOwn(GROUPINGS, store.get('group') ?? '') ? store.get('group') : 'kind';
let sortBy = Object.hasOwn(SORTS, store.get('sort') ?? '') ? store.get('sort') : 'recent';
const folded = new Set((() => { try { return JSON.parse(store.get('folded') ?? '[]'); } catch { return []; } })());
// pinned projects first within their group, each part in the chosen order
const ordered = (list) => [...list].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || SORTS[sortBy].cmp(a, b));
// Running and Hidden are fixed sections: always most recent first, no pins
const byRecent = (list) => [...list].sort(SORTS.recent.cmp);
function setView(group, sort) {
  if (group && GROUPINGS[group]) { groupBy = group; store.set('group', group); }
  if (sort && SORTS[sort]) { sortBy = sort; store.set('sort', sort); }
  render();
}

const auth = { 'X-Oberth-Token': TOKEN };
const enc = encodeURIComponent;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const statusOf = (p) => optimistic.get(p.id) ?? p.status;

async function post(path, body = {}, id) {
  if (id) rowError.delete(id);
  try {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify(body) });
    if (!r.ok) {
      const e = (await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`;
      if (id) rowError.set(id, e); else banner(e);
    }
  } catch { if (id) rowError.set(id, "can't reach Oberth service"); else banner("Can't reach Oberth service."); }
  if (id) optimistic.delete(id);
  await refresh();
  refreshActivity();
}

function banner(msg) {
  const b = document.createElement('div');
  b.className = 'banner'; b.textContent = msg;
  $('#banners').prepend(b); setTimeout(() => b.remove(), 8000);
}
// what config.json got wrong, said once on the page until it is fixed (each field fell back to its default)
if (SETUP.problems?.length) {
  const b = document.createElement('div');
  b.className = 'banner';
  b.innerHTML = `<span><b>config.json:</b> ${SETUP.problems.map(esc).join(' · ')}</span>`;
  $('#banners').append(b);
}

function ago(ms) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24); if (d === 1) return 'yesterday';
  const many = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  if (d < 7) return many(d, 'day'); if (d < 30) return many(Math.round(d / 7), 'week');
  return many(Math.round(d / 30), 'month');
}
const upFor = (ms) => { const m = Math.round((Date.now() - ms) / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };

// Pre-flight (preflight.ts): what would make a launch fail, said before it does. Grey: nothing has failed yet.
// Out-of-date dependencies get an install first, like missing ones, with the project's package manager.
const pm = (p) => p.packageManager ?? 'npm';
const installs = (p) => p.needsInstall || (p.preflight ?? []).some((f) => f.check === 'deps');
function preflightNote(p) {
  const all = (p.preflight ?? []).filter((f) => !(f.check === 'deps' && p.needsInstall));
  if (!all.length) return '';
  const more = all.length > 1 ? ` +${all.length - 1}` : '';
  // its own element, since .meta is a flex row: the gap stands in for the space before the dot
  return `<span>· <span class="pre" title="${esc(all.map((f) => f.text).join('\n'))}">${esc(all[0].short)}${more}</span></span>`;
}

function status(p) {
  const err = rowError.get(p.id);
  if (err) return `couldn't do that: ${esc(err)}`;
  switch (statusOf(p)) {
    case 'running': return `<span class="dot"></span>${p.kind === 'window' ? 'window open' : p.address && p.mode === 'local' ? `<span title="${esc(`port ${p.port}`)}">${esc(new URL(p.address).host)}</span>` : `:${p.port}`} · up ${upFor(p.startedAt)}${p.mode === 'lan' ? ' · phone mode' : ''}`;
    case 'installing': return '<span class="dot busy"></span>installing…';
    case 'starting': return '<span class="dot busy"></span>starting…';
    case 'stopping': return '<span class="dot busy"></span>stopping…';
    case 'failed': return `failed: ${esc(p.error)}${preflightNote(p)}`;
    default:
      if (p.foreign.length) return `<span class="dot foreign"></span>running outside Oberth · ${esc(new URL(p.foreignUrl).host)}`;
      return `${p.kind === 'window' ? 'window app · ' : ''}${ago(p.recency)}${p.needsInstall && p.kind !== 'library' ? ` · needs ${pm(p)} install` : ''}${preflightNote(p)}`;
  }
}

// Git only shows when it needs attention.
function gitChips(g) {
  if (!g) return '';
  const out = [];
  if (g.branch !== 'main' && g.branch !== 'master') out.push(`<span class="chip">${esc(g.branch)}</span>`);
  if (g.changed) out.push(`<span class="chip d">${g.changed} changed</span>`);
  if (g.ahead) out.push(`<span class="chip">↑ ${g.ahead} unpushed</span>`);
  return out.join('');
}

// The error count only means something while the server runs (it resets on each launch).
const errChip = (p) => (p.errors && ACTIVE.includes(statusOf(p)) ? `<span class="chip x" data-act="errors" title="Show the errors">${p.errors} error${p.errors === 1 ? '' : 's'}</span>` : '');

// A pinned check (test, typecheck, build) whose last run failed; it counts toward Needs attention, so it shows.
function checkChip(p) {
  const bad = p.checks.filter((n) => p.scripts?.[n]?.status === 'failed');
  return bad.length ? `<span class="chip x" data-act="checks" title="Show the scripts">${esc(bad.join(', '))} failed</span>` : '';
}

// The assistant's session for the project (assistant.ts). Its icon shows whether there is one;
// the chip appears only while the assistant is mid-turn, the state worth noticing at a glance.
const short = (s, n = 32) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
// Claude's mark for Claude; a generic spark for any other assistant
const SPARK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M6.3 17.7l2.5-2.5M15.2 8.8l2.5-2.5"/></svg>`;
const AI_ICON = AI?.id === 'claude' ? CLAUDE : SPARK;
function claudeChip(p) {
  const c = p.assistant;
  if (!AI || !c?.working) return '';
  const tip = `${c.title} · ${c.working ? 'working now' : `last active ${ago(c.at)}`}${c.others ? ` · ${c.others} more session${c.others === 1 ? '' : 's'}` : ''}`;
  return `<span class="chip c work" title="${esc(tip)}">${AI_ICON}${esc(AI.label)} working</span>`;
}
const claudeTip = (p) => (p.assistant ? `Open “${p.assistant.title}” in ${AI?.label}` : `New ${AI?.label} session on this project`);

// What the owner wrote about the project (About tab): a status chip for anything but active, and the description.
// Status and Released chips open the status menu (no form) when clicked.
const CHANGE = ' · click to change';
const releasedChip = (a, id) => (a?.released ? `<button class="chip rel" data-stmenu="${esc(id)}" title="${esc((a.releasedWhere ? `Released: ${a.releasedWhere}` : STATUS_MEANS.released) + CHANGE)}">Released</button>` : '');
const stChip = (status, id) => `<button class="chip st ${status}" data-stmenu="${esc(id)}" title="${esc(STATUS_MEANS[status] + CHANGE)}">${STATUSES[status]}</button>`;
const statusChip = (p) => (p.about?.status && p.about.status !== 'active' ? stChip(p.about.status, p.id) : '') + releasedChip(p.about, p.id);

const rowClass = (p) => ({ running: 'live', installing: 'busy', starting: 'busy', stopping: 'busy', failed: 'failed' })[statusOf(p)] ?? (p.foreign.length ? 'foreign' : '');

/** The one labelled button (or pair): what the row is for in its current state. */
function mainButtons(p) {
  const st = statusOf(p);
  if (st === 'running') return `${p.kind !== 'window' && p.mode === 'local' ? '<button class="btn go" data-act="open">Open</button>' : ''}<button class="btn stop" data-act="stop">Stop</button>`;
  if (st === 'starting' || st === 'installing') return `<button class="btn" disabled>${st === 'installing' ? 'Installing…' : 'Starting…'}</button><button class="btn stop" data-act="stop">Stop</button>`;
  if (st === 'stopping') return '<button class="btn" disabled>Stopping…</button>';
  if (p.foreign.length) return p.kind === 'window' ? '' : '<button class="btn ghost" data-act="open">Open</button>';
  if (st === 'failed') return '<button class="btn ghost" data-act="launch">Retry</button>';
  if (p.kind === 'library') return '';
  return `<button class="btn ghost" data-act="launch">${installs(p) ? 'Install + Launch' : 'Launch'}</button>`;
}

// Live site check (the service asks at most every 10 minutes, only while this page is open).
function liveTip(p) {
  const l = p.liveStatus;
  if (!l) return `Live site: ${p.liveUrl}`;
  const when = ago(l.checkedAt);
  return l.ok ? `Live site: ${p.liveUrl}\n${l.status} · ${l.ms} ms · checked ${when}` : `Live site not answering: ${p.liveUrl}\n${l.status ?? l.error} · checked ${when}`;
}

// Fixed icon slots so each kind sits in the same column on every row; a missing one leaves its slot empty.
function iconButtons(p) {
  const slot = (html) => html || '<span></span>';
  return `<div class="icons">${[
    slot(p.liveUrl && `<a class="ib live" href="${esc(p.liveUrl)}" target="_blank" rel="noopener" title="${esc(liveTip(p))}">${GLOBE}${p.liveStatus ? `<span class="pip ${p.liveStatus.ok ? 'up' : 'down'}"></span>` : ''}</a>`),
    slot(p.repoUrl && `<a class="ib" href="${esc(p.repoUrl)}" target="_blank" rel="noopener" title="${esc(forge(p.repoUrl))}: ${esc(p.repoUrl)}">${repoIcon(p.repoUrl)}</a>`),
    slot(p.phone && `<button class="ib" data-act="phone" title="Open on phone (restarts it on the local network)">${PHONE}</button>`),
    // dimmed: no session yet (a click starts one); orange dot: has one; pulsing dot: the assistant is working in it
    slot(AI?.can.open && `<button class="ib claude${p.assistant ? '' : ' none'}" data-act="assistant" title="${esc(claudeTip(p))}">${AI_ICON}${p.assistant ? `<span class="pip${p.assistant.working ? ' work' : ''}"></span>` : ''}</button>`),
    `<button class="ib" data-act="editor" title="Open in ${esc(EDITOR)}">${CODE}</button>`,
    `<button class="ib" data-act="finder" title="Show in Finder">${FOLDER}</button>`,
    `<button class="ib pin${p.pinned ? ' on' : ''}" data-act="${p.pinned ? 'unpin' : 'pin'}" title="${p.pinned ? 'Unpin' : 'Pin to the top of its group'}">${PIN(p.pinned)}</button>`,
    `<button class="ib hide" data-act="${p.hidden ? 'unhide' : 'hide'}" title="${p.hidden ? 'Show again' : 'Hide from the dashboard'}">${p.hidden ? EYE : EYE_OFF}</button>`,
  ].join('')}</div>`;
}

const iconSrc = (p) => `/api/icon/${enc(p.id)}?v=${Date.now() >> 14}`;

/** A launch that failed on a taken port: who holds it, and a fix when Oberth may stop the holder. */
function conflictBox(p) {
  const c = p.conflict;
  if (!c || statusOf(p) !== 'failed') return '';
  const h = c.holder;
  const who = h.kind === 'other' ? `<code>${esc(h.command ?? 'a process')}</code> (pid ${h.pid}${h.cwd ? `, in <code>${esc(h.cwd)}</code>` : ''}), which isn't one of Oberth's projects`
    : h.projectId === p.id ? `a leftover server of this project (pid ${h.pid})`
    : h.kind === 'launched' ? `<b>${esc(h.name)}</b>, started here` : `a leftover server of <b>${esc(h.name)}</b> (pid ${h.pid})`;
  const fix = h.kind === 'other' ? '' : `<button class="btn stop" data-act="free-port">${h.kind === 'launched' ? `Stop ${esc(h.name)} and retry` : 'Stop it and retry'}</button>`;
  return `<div class="fix"><span>Port ${c.port} is held by ${who}.</span>${fix}</div>`;
}

function row(p) {
  return `<div class="row ${rowClass(p)}${p.id === selected ? ' sel' : ''}" data-id="${esc(p.id)}">
    <img src="${iconSrc(p)}" alt="">
    <div class="who"><h3 title="${esc(p.about?.description ?? '')}">${esc(p.name)}${agenda.needs.some((it) => it.projectId === p.id) ? '<span class="needdot" title="Needs you"></span>' : ''}</h3><div class="meta${statusOf(p) === 'failed' || rowError.has(p.id) ? ' failed' : ''}">${status(p)}${statusChip(p)}${errChip(p)}${checkChip(p)}${claudeChip(p)}${gitChips(p.git)}</div>${conflictBox(p)}</div>
    ${iconButtons(p)}<div class="main">${mainButtons(p)}</div></div>`;
}

function summary(visible) {
  const n = (f) => visible.filter(f).length;
  const parts = [];
  const running = n((p) => statusOf(p) === 'running' || p.foreign.length);
  const busy = n((p) => ['installing', 'starting'].includes(statusOf(p)));
  const failed = n((p) => statusOf(p) === 'failed');
  if (running) parts.push(`<b>${running}</b> running`);
  if (busy) parts.push(`<b>${busy}</b> starting`);
  if (failed) parts.push(`<span class="bad"><b>${failed}</b> failed</span>`);
  return parts.join(' · ');
}

// ---------- the Agenda: what is waiting for the owner (see docs/architecture.md, "The Agenda") ----------

const mainLabel = (it, p) => ({ session: 'Open session', assistant: p?.assistant ? 'Open session' : 'New session', tab: it.action.tab === 'about' ? 'About' : 'Git', 'backup-log': 'Show log', url: it.action.url?.startsWith('https://github.com/') ? 'Open on GitHub' : 'Open site', review: 'Open review' })[it.action.kind];

function agendaRow(it) {
  const p = projects.find((x) => x.id === it.projectId);
  const needs = it.level === 'needs';
  return `<div class="arow ${needs ? 'needs' : 'quiet'}" data-agkey="${esc(it.key)}"${p ? ` data-agid="${esc(p.id)}"` : ''}>
    ${p ? `<img src="${iconSrc(p)}" alt="">` : `<span class="badge">${WARN}</span>`}
    <div><div class="t">${esc(it.title)}</div><div class="p">${esc(it.where)}${it.detail ? ` · ${esc(it.detail)}` : ''}</div></div>
    <span class="age">${esc(ago(it.since))}</span>
    <button class="btn ${needs ? 'go' : ''}" data-ag="open">${esc(mainLabel(it, p))}</button>
    <span class="acts">${it.source === 'ask' ? '<button class="later" data-ag="done">Done</button>' : ''}<button class="later" data-ag="later">Later</button></span>
  </div>`;
}

function renderAgenda() {
  const h = agenda.health;
  const notes = [h?.sessions && !h.sessions.ok && `Can't read ${AI?.label ?? 'the assistant'}'s sessions, so this list may be missing items.`, h?.backup && !h.backup.ok && "Can't read the backup log.", h?.outside && !h.outside.ok && `${h.outside.error}, so issues from others may be missing.`].filter(Boolean);
  $('#agenda').hidden = !agenda.needs.length && !agenda.look.length && !notes.length;
  $('#ag-needs-box').hidden = !agenda.needs.length;
  $('#ag-look-box').hidden = !agenda.look.length;
  $('#ag-count').textContent = agenda.needs.length ? `· ${agenda.needs.length}` : '';
  if ($('#nav-need')) $('#nav-need').textContent = agenda.needs.length || '';
  $('#ag-look-count').textContent = agenda.look.length ? `· ${agenda.look.length}` : '';
  $('#ag-health').hidden = !notes.length;
  $('#ag-health').textContent = notes.join(' ');
  // Worth a look starts folded: for this key the remembered set means open
  const shut = !folded.has('agenda:look');
  $('#ag-look-box').classList.toggle('folded', shut);
  $('#ag-look-box h2').setAttribute('aria-expanded', String(!shut));
  // rewrite only on change, as with the project rows
  for (const [box, list] of [[$('#ag-needs'), agenda.needs], [$('#ag-look'), agenda.look]]) {
    const html = list.map(agendaRow).join('');
    if (box.dataset.html !== html) { box.innerHTML = html; box.dataset.html = html; }
  }
}

async function refreshAgenda() {
  if (!mod('agenda')) return;
  try {
    const r = await fetch('/api/agenda', { headers: auth });
    if (!r.ok) return;
    agenda = await r.json();
    render();
  } catch { /* the offline note already says so */ }
}

async function agendaAct(key, what) {
  const it = [...agenda.needs, ...agenda.look].find((x) => x.key === key);
  if (!it) return;
  if (what === 'open' && it.action.kind === 'tab') return select(it.projectId, it.action.tab);
  if (what === 'open' && it.action.kind === 'review') { location.href = `/logbook?week=${encodeURIComponent(it.action.start)}`; return; }
  if (what === 'open') await post('/api/agenda/open', { key });
  if (what === 'later') await post('/api/agenda/later', { key });
  if (what === 'done') await post(`/api/agenda/asks/${enc(key.slice('ask:'.length))}/done`);
  await refreshAgenda();
}

function render() {
  renderAgenda();
  const running = [], hidden = [];
  const grouping = GROUPINGS[groupBy];
  const groups = Object.fromEntries(Object.keys(grouping.groups).map((k) => [k, []]));
  // the status filter narrows the stopped lists; running projects always show
  const shown = (p) => statusFilter === 'all' || (statusFilter === 'released' ? !!p.about?.released : (p.about?.status ?? 'active') === statusFilter);
  for (const p of projects) {
    if (p.hidden) hidden.push(p);
    else if (ACTIVE.includes(statusOf(p))) running.push(p);
    // a group the grouping doesn't know (a hand-edited status) falls into its first group rather than vanishing
    else if (shown(p)) (groups[grouping.of(p)] ?? Object.values(groups)[0]).push(p);
  }
  const fill = (sec, list) => {
    sec.hidden = list.length === 0;
    $('.count', sec).textContent = list.length ? `· ${list.length}` : '';
    // rewrite only on change: icons are served no-store, so a rewrite refetches every one of them
    const html = list.map(row).join('');
    if (sec.dataset.html !== html) { $('.list', sec).innerHTML = html; sec.dataset.html = html; }
  };
  fill($('[data-group="running"]'), byRecent(running));
  fill($('[data-group="hidden"]'), byRecent(hidden));
  // one section per group, made once per grouping and kept, so unchanged lists aren't rewritten
  const box = $('#groups');
  if (box.dataset.by !== groupBy) {
    box.dataset.by = groupBy;
    box.innerHTML = Object.entries(grouping.groups).map(([k, title]) => `<section data-group="${groupBy}:${k}" hidden><h2 class="fold" data-fold="${groupBy}:${k}" tabindex="0" role="button"><span class="caret"></span>${esc(title)} <span class="count"></span> <span class="order"></span></h2><div class="list"></div></section>`).join('');
  }
  for (const [k, list] of Object.entries(groups)) {
    const key = `${groupBy}:${k}`;
    const sec = $(`[data-group="${key}"]`, box);
    const shut = folded.has(key);
    sec.classList.toggle('folded', shut);
    $('h2', sec).setAttribute('aria-expanded', String(!shut));
    $('.order', sec).textContent = `· ${SORTS[sortBy].head}`;
    fill(sec, ordered(list)); // a folded group keeps its rows; CSS hides them, so unfolding rewrites nothing
  }
  $('#group-by').value = groupBy;
  $('#sort-by').value = sortBy;
  $('#summary').innerHTML = summary(projects.filter((p) => !p.hidden));
  $('#sfilters').hidden = !projects.some((p) => p.about?.status || p.about?.released);
  for (const b of document.querySelectorAll('[data-sfilter]')) { b.classList.toggle('on', b.dataset.sfilter === statusFilter); b.title = STATUS_MEANS[b.dataset.sfilter] ?? ''; }
  $('#stop-all').hidden = running.length === 0;
  $('#banners').querySelectorAll('.leftover').forEach((e) => e.remove());
  for (const p of projects) for (const f of p.foreign) {
    const b = document.createElement('div');
    b.className = 'banner leftover';
    b.innerHTML = `<span class="dot foreign"></span><span><b>${esc(p.name)}</b> is running on :${f.port}, but Oberth didn't start it (probably an old session).</span>
      <span class="acts">${p.kind === 'window' ? '' : `<a class="btn" href="${esc(p.foreignUrl)}" target="_blank">Open</a>`}<button class="btn stop" data-foreign="${f.pid}">Stop it</button></span>`;
    $('#banners').append(b);
  }
  renderDrawer();
  if (typeof renderIdeas === 'function') renderIdeas(); // project names and icons in the Ideas view
}

async function refresh() {
  try {
    const r = await fetch('/api/projects?live=1');
    projects = await r.json();
    $('#offline').hidden = true;
  } catch { $('#offline').hidden = false; return; }
  // A launch that just failed opens its output, so the error is in front of you.
  for (const p of projects) {
    const before = prevStatus.get(p.id);
    if (loaded && p.status === 'failed' && before && before !== 'failed') select(p.id, 'output');
    prevStatus.set(p.id, p.status);
  }
  if (selected && !projects.some((p) => p.id === selected)) select(null);
  loaded = true;
  render();
}

// ---------- drawer ----------

function select(id, wantTab) {
  if (id !== selected) { resetLog(); filter = 'all'; openLogs.clear(); aboutEditing = false; aboutHtml = ''; }
  selected = id;
  if (wantTab) tab = wantTab;
  store.set('selected', id); store.set('tab', tab);
  $('#body').classList.toggle('open', !!id);
  render();
  if (id) tick(true);
}

function renderDrawer() {
  const p = projects.find((x) => x.id === selected);
  $('#drawer').hidden = !p;
  $('#body').classList.toggle('open', !!p);
  if (!p) return;
  const d = $('#drawer');
  d.dataset.id = p.id;
  if ($('#d-name').textContent !== p.name) { $('#d-name').textContent = p.name; $('#d-icon').src = iconSrc(p); }
  const meta = $('#d-status');
  meta.className = `meta${statusOf(p) === 'failed' || rowError.has(p.id) ? ' failed' : ''}`;
  meta.innerHTML = status(p) + statusChip(p) + errChip(p) + claudeChip(p) + gitChips(p.git);
  const extra = [
    p.liveUrl && `<a class="btn" href="${esc(p.liveUrl)}" target="_blank" rel="noopener">${GLOBE} Live</a>`,
    p.repoUrl && `<a class="btn" href="${esc(p.repoUrl)}" target="_blank" rel="noopener">${repoIcon(p.repoUrl)} ${esc(forge(p.repoUrl))}</a>`,
    p.phone && `<button class="btn" data-act="phone">${PHONE} Phone</button>`,
    `<button class="btn" data-act="editor">${CODE} ${esc(EDITOR)}</button>`,
    `<button class="btn" data-act="finder">${FOLDER} Finder</button>`,
    `<button class="btn" data-act="${p.pinned ? 'unpin' : 'pin'}">${PIN(p.pinned)} ${p.pinned ? 'Pinned' : 'Pin'}</button>`,
    AI?.can.open && `<button class="btn" data-act="assistant" title="${esc(claudeTip(p))}">${AI_ICON} ${p.assistant ? esc(short(p.assistant.title, 24)) : `New ${esc(AI.label)} session`}</button>`,
  ].filter(Boolean).join('');
  const acts = mainButtons(p) + extra;
  if ($('#d-acts').innerHTML !== acts) $('#d-acts').innerHTML = acts;
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('on', t.dataset.tab === tab);
  for (const t of TABS) $(`#p-${t}`).hidden = tab !== t;
  const errs = ACTIVE.includes(statusOf(p)) ? p.errors : 0;
  $('#n-output').textContent = errs || '';
  $('#n-errors').textContent = errs || '';
  for (const b of document.querySelectorAll('[data-filter]')) b.classList.toggle('on', b.dataset.filter === filter);
  const runs = Object.values(p.scripts ?? {});
  const nScripts = $('#n-scripts');
  const failed = p.checks.some((n) => p.scripts?.[n]?.status === 'failed');
  nScripts.textContent = runs.some((r) => r.status === 'running') ? '…' : failed ? '✗' : '';
  nScripts.classList.toggle('run', nScripts.textContent === '…');
}

// Output: the log is fetched incrementally (?from=offset) and kept raw; ANSI colours become spans.
const log = { id: null, text: '', offset: 0, clearedAt: 0, busy: false };
function resetLog() { Object.assign(log, { id: null, text: '', offset: 0, clearedAt: 0 }); $('#term').innerHTML = ''; $('#term').dataset.drawn = ''; $('#out-q').value = ''; drawnErrors = ''; }

async function fetchLog(p) {
  const from = log.id === p.id ? log.offset : null;
  const r = await fetch(`/api/projects/${enc(p.id)}/log${from == null ? '' : `?from=${from}`}`, { headers: auth });
  if (!r.ok) return false;
  const start = Number(r.headers.get('X-Log-From'));
  const chunk = await r.text();
  // a new launch rewrites the log from 0: start over
  const restarted = log.id !== p.id || start !== log.offset;
  if (restarted) { log.text = ''; log.clearedAt = 0; }
  log.id = p.id;
  log.offset = Number(r.headers.get('X-Log-Size'));
  if (!chunk && !restarted) return false;
  log.text = (log.text + chunk).slice(-400_000);
  return true;
}

const FG = ['#777', '#ff7b72', '#7ee07e', '#ffd479', '#79b8ff', '#d2a8ff', '#76e3ea', '#ddd'];
const FG_BRIGHT = ['#999', '#ffa198', '#a5f0a5', '#ffe9a8', '#a5d6ff', '#e2c5ff', '#b3f0ff', '#fff'];
const xterm = (n) => (n < 8 ? FG[n] : n < 16 ? FG_BRIGHT[n - 8] : undefined);

function applySgr(st, params) {
  const c = params ? params.split(';').map(Number) : [0];
  for (let i = 0; i < c.length; i++) {
    const n = c[i];
    if (n === 0) { for (const k in st) delete st[k]; }
    else if (n === 1) st.bold = true; else if (n === 2) st.dim = true; else if (n === 22) { st.bold = false; st.dim = false; }
    else if (n === 3) st.italic = true; else if (n === 23) st.italic = false;
    else if (n === 4) st.under = true; else if (n === 24) st.under = false;
    else if (n >= 30 && n <= 37) st.fg = FG[n - 30]; else if (n >= 90 && n <= 97) st.fg = FG_BRIGHT[n - 90]; else if (n === 39) st.fg = undefined;
    else if (n >= 40 && n <= 47) st.bg = FG[n - 40]; else if (n === 49) st.bg = undefined;
    else if (n === 38 || n === 48) {
      const key = n === 38 ? 'fg' : 'bg';
      if (c[i + 1] === 5) { st[key] = xterm(c[i + 2]); i += 2; }
      else if (c[i + 1] === 2) { st[key] = `rgb(${c[i + 2]},${c[i + 3]},${c[i + 4]})`; i += 4; }
    }
  }
}
const cssOf = (st) => [st.fg && `color:${st.fg}`, st.bg && `background:${st.bg}`, st.bold && 'font-weight:600', st.dim && 'opacity:.6', st.italic && 'font-style:italic', st.under && 'text-decoration:underline'].filter(Boolean).join(';');

/** Splits raw output into lines of { html, plain }, carrying colour state across lines. */
function ansiLines(text, mark) {
  const st = {};
  const lines = [];
  const clean = text.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, ''); // OSC (terminal titles, hyperlinks)
  for (let line of clean.split('\n')) {
    // a carriage return redraws the line (spinners, progress): keep what was drawn last
    if (line.includes('\r')) line = line.split('\r').filter(Boolean).pop() ?? '';
    let html = '', plain = '', last = 0, m;
    const push = (t) => {
      if (!t) return;
      plain += t;
      // markers survive esc(), then become <mark> tags, so a search never cuts into an entity
      const h = mark ? esc(t.replace(mark, '\u0000$&\u0001')).replace(/\u0000/g, '<mark>').replace(/\u0001/g, '</mark>') : esc(t);
      const css = cssOf(st);
      html += css ? `<span style="${css}">${h}</span>` : h;
    };
    const re = /\x1b\[([0-9;?]*)([A-Za-z])/g;
    while ((m = re.exec(line))) { push(line.slice(last, m.index)); last = re.lastIndex; if (m[2] === 'm') applySgr(st, m[1]); }
    push(line.slice(last));
    lines.push({ html, plain });
  }
  return lines;
}

function drawLog(p) {
  if (filter === 'errors') return drawErrors(p);
  const term = $('#term');
  const q = $('#out-q').value.trim();
  const text = log.text.slice(Math.max(0, log.clearedAt - (log.offset - log.text.length)));
  if (!text) {
    $('#out-n').textContent = '';
    const msg = ACTIVE.includes(statusOf(p)) ? 'No output yet.' : log.clearedAt ? 'Cleared.' : 'Not running. Launch it to see its output here.';
    term.innerHTML = `<span class="empty">${msg}</span>`;
    return;
  }
  const mark = searchMark(q);
  let lines = ansiLines(text, mark);
  if (q) lines = lines.filter((l) => l.plain.toLowerCase().includes(q.toLowerCase()));
  $('#out-n').textContent = q ? `${lines.length} line${lines.length === 1 ? '' : 's'}` : '';
  const atBottom = term.scrollTop + term.clientHeight >= term.scrollHeight - 8;
  term.innerHTML = lines.slice(-4000).map((l) => l.html).join('\n') || '<span class="empty">No matching lines.</span>';
  if (atBottom || !term.dataset.drawn) term.scrollTop = term.scrollHeight;
  term.dataset.drawn = '1';
}

const searchMark = (q) => (q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi') : null);
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

// Errors filter: the service's own error groups (each with a line of context), newest last.
let errorsData = { count: 0, groups: [] };
let drawnErrors = '';
async function fetchErrors(p) {
  const r = await fetch(`/api/projects/${enc(p.id)}/errors`, { headers: auth });
  if (r.ok && selected === p.id) errorsData = await r.json();
}
function drawErrors() {
  const term = $('#term');
  const q = $('#out-q').value.trim();
  const key = JSON.stringify([errorsData.count, errorsData.groups.length, errorsData.groups.at(-1)?.lines.length, q]);
  if (key === drawnErrors) return;
  drawnErrors = key;
  const mark = searchMark(q);
  const groups = errorsData.groups.filter((g) => !q || g.lines.some((l) => l.toLowerCase().includes(q.toLowerCase())));
  $('#out-n').textContent = q ? `${groups.length} of ${errorsData.groups.length}` : '';
  term.innerHTML = groups.length
    ? groups.map((g) => `<span class="group">${clock(g.at)}</span>${ansiLines(g.lines.join('\n'), mark).map((l) => l.html).join('\n')}`).join('\n')
    : `<span class="empty">${q ? 'No matching errors.' : 'No errors since this launch.'}</span>`;
  term.scrollTop = term.scrollHeight;
}

async function drawGit(p) {
  const r = await fetch(`/api/projects/${enc(p.id)}/git`);
  if (!r.ok || selected !== p.id || tab !== 'git') return;
  const g = await r.json();
  if (!g) { $('#p-git').innerHTML = '<div class="sec note">Not a git repository.</div>'; return; }
  const sync = !g.upstream ? 'no upstream branch'
    : [g.ahead ? `↑ ${g.ahead} unpushed` : '', g.behind ? `${g.behind} behind` : '', !g.ahead && !g.behind ? 'up to date' : ''].filter(Boolean).join(' · ') + ' <span class="note">(as of the last fetch)</span>';
  const live = g.liveOnPush && g.ahead ? `<dt>live site</dt><dd>${g.ahead} commit${g.ahead === 1 ? '' : 's'} not live yet (it deploys on push)</dd>` : '';
  const files = g.files.length
    ? g.files.map((f) => `<div class="file"><span class="st ${esc(f.status)}">${esc(f.status)}</span><span>${esc(f.path)}</span></div>`).join('') + (g.files.length >= 200 ? '<div class="note">Showing the first 200.</div>' : '')
    : '<div class="note">Working tree clean.</div>';
  const commits = g.commits.length
    ? g.commits.map((c) => `<div class="commit${c.unpushed ? ' up' : ''}"><code>${esc(c.hash)}</code><span class="t" title="${esc(c.subject)}">${esc(c.subject)}</span><span class="w">${c.unpushed ? 'unpushed' : ago(c.time)}</span></div>`).join('')
    : '<div class="note">No commits yet.</div>';
  // each forge has its own commits page; GitLab's sits under /-/
  const commitsAt = g.repoUrl && `${g.repoUrl}${g.repoUrl.startsWith('https://gitlab.com/') ? '/-' : ''}/commits/${enc(g.branch)}`;
  const gh = g.repoUrl ? `<div style="margin-top:8px"><a class="btn" href="${esc(commitsAt)}" target="_blank" rel="noopener">${repoIcon(g.repoUrl)} Commits on ${esc(forge(g.repoUrl))}</a></div>` : '';
  $('#p-git').innerHTML = `<div class="sec"><dl class="kv" style="padding:0"><dt>branch</dt><dd><code>${esc(g.branch)}</code></dd><dt>upstream</dt><dd>${g.upstream ? `<code>${esc(g.upstream)}</code> · ` : ''}${sync}</dd>${live}</dl></div>
    <div class="sec"><h4>Changed${g.files.length ? ` · ${g.files.length}` : ''}</h4>${files}</div>
    <div class="sec"><h4>Recent commits</h4>${commits}${gh}</div>`;
}

// Scripts: the project's own package.json scripts; open logs are refetched while their run goes on.
const openLogs = new Map(); // script name → log text shown under its row
const secs = (ms) => (ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`);
async function drawScripts(p) {
  const r = await fetch(`/api/projects/${enc(p.id)}/scripts`, { headers: auth });
  if (!r.ok || selected !== p.id || tab !== 'scripts') return;
  const s = await r.json();
  for (const name of openLogs.keys()) {
    const lr = await fetch(`/api/projects/${enc(p.id)}/scripts/${enc(name)}/log`, { headers: auth });
    if (lr.ok) openLogs.set(name, await lr.text());
  }
  const mark = { running: '<span class="spin"></span>', passed: '✓', failed: '✗', cancelled: '–' };
  const one = ({ name, result: res }) => {
    const st = res?.status;
    const text = !res ? 'not run yet'
      : st === 'running' ? `running… ${secs(Date.now() - res.startedAt)}`
      : st === 'passed' ? `passed · ${ago(res.endedAt)} · ${secs(res.endedAt - res.startedAt)}`
      : st === 'failed' ? `failed${res.code != null ? ` (exit ${res.code})` : ''} · ${ago(res.endedAt)}`
      : `cancelled · ${ago(res.endedAt)}`;
    const btn = st === 'running' ? '<button class="btn stop" data-sact="cancel">Cancel</button>' : `<button class="btn" data-sact="run"${s.needsInstall ? ` disabled title="Launch it once first: that runs ${pm(s)} install"` : ''}>Run</button>`;
    const shown = openLogs.get(name);
    const tail = shown != null ? shown || '(no output)' : st === 'failed' && res.tail?.length ? res.tail.join('\n') : null;
    const pre = tail == null ? '' : `<pre>${ansiLines(tail.slice(-60_000)).map((l) => l.html).join('\n')}</pre>`;
    const logLink = res ? `<button class="link" data-sact="log">${shown != null ? 'hide log' : 'full log'}</button>` : '';
    return `<div class="script" data-script="${esc(name)}"><span class="mk ${st ?? ''}">${mark[st] ?? '○'}</span><code title="${pm(s)} run ${esc(name)}">${esc(name)}</code><span class="res ${st ?? ''}">${text}</span>${btn}${pre}${logLink}</div>`;
  };
  const pinned = s.pinned.length ? s.pinned.map(one).join('') : '<div class="note">No test, typecheck, build or lint script.</div>';
  const other = s.other.length ? `<div class="sec"><h4>Other scripts</h4>${s.other.map(one).join('')}</div>` : '';
  const html = `<div class="sec"><h4>Checks</h4>${pinned}</div>${other}<div class="sec note">Only scripts from this project's package.json run here, with <code>${pm(s)} run</code>.</div>`;
  const pane = $('#p-scripts');
  if (pane.dataset.html !== html) { const top = pane.scrollTop; pane.innerHTML = html; pane.dataset.html = html; pane.scrollTop = top; }
}

// About: what the owner wrote (editable here) and what Oberth can read for itself.
let aboutEditing = false;
let aboutHtml = '';
const dateOf = (ms) => new Date(ms).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
async function drawAbout(p) {
  if (aboutEditing) return; // never redraw over a form being typed in
  const r = await fetch(`/api/projects/${enc(p.id)}/about`);
  if (!r.ok || selected !== p.id || tab !== 'about' || aboutEditing) return;
  const { about: a, facts: f, outside: o } = await r.json();
  // its open ideas (ideas.js): token-guarded, as they are the owner's own text
  const ir = mod('ideas') ? await fetch(`/api/ideas?project=${enc(p.id)}`, { headers: auth }).catch(() => null) : null;
  const pideas = ir?.ok ? (await ir.json()).forProjects : [];
  if (selected !== p.id || tab !== 'about' || aboutEditing) return;
  // a paused project gets a "where was I?" card; its route needs the token, as it carries prompts and session titles
  let recap;
  if (a.status === 'paused') {
    const rr = await fetch(`/api/projects/${enc(p.id)}/recap`, { headers: auth }).catch(() => null);
    if (rr?.ok) recap = await rr.json();
    if (selected !== p.id || tab !== 'about' || aboutEditing) return;
  }
  const vis = f.visibility === 'local' ? 'local only, no remote'
    : f.repoUrl ? `<a href="${esc(f.repoUrl)}" target="_blank" rel="noopener">${f.visibility ?? 'online'}</a>` : '';
  const links = (f.links ?? []).map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join(' · ');
  const facts = [
    f.stack?.length && ['stack', f.stack.map((s) => `<span class="chip">${esc(s)}</span>`).join(' ')],
    ['ships to', f.deploy ? esc(f.deploy) : '<span class="note">nothing set up</span>'],
    f.startedAt && ['started', `${dateOf(f.startedAt)} <span class="note">(${ago(f.startedAt)})</span>`],
    f.commits && ['commits', f.commits.toLocaleString()],
    f.lastWorkedOn && ['last worked on', ago(f.lastWorkedOn)],
    vis && ['repository', vis],
    links && ['links', links],
  ].filter(Boolean);
  const html = `${recap ? recapCard(recap) : ''}<div class="sec about">
      <div class="about-head">${a.status ? stChip(a.status, p.id) : `<button class="chip none" data-stmenu="${esc(p.id)}" title="Set a status">No status</button>`}${releasedChip(a, p.id)}${a.released && a.releasedWhere ? `<span class="note">${esc(a.releasedWhere)}</span>` : ''}<button class="btn" data-about="edit">Edit</button></div>
      <p class="about-desc">${a.description ? esc(a.description) : '<span class="note">No description yet.</span>'}</p>
      ${a.notes ? `<h4>Notes</h4><div class="about-notes">${esc(a.notes)}</div>` : ''}
    </div>
    <div class="sec"><h4>Ideas${pideas.length ? ` · ${pideas.length}` : ''}</h4>
      ${pideas.length ? `<div class="pideas">${pideas.map((i) => `<button data-ishow="${esc(i.id)}"><span class="ibulb">${typeof BULB === 'string' ? BULB : ''}</span><span>${esc(i.title)}</span><span class="note">${esc(ago(i.updatedAt))}</span></button>`).join('')}</div>` : ''}
      <form class="iadd" data-iproject="${esc(p.id)}" autocomplete="off"><input maxlength="120" placeholder="Add an idea for ${esc(p.name)}…" aria-label="New idea for ${esc(p.name)}"><button class="btn">Add</button></form>
    </div>
    ${o ? outsideCard(o) : ''}
    <div class="sec"><h4>From the project</h4><dl class="kv" style="padding:0">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl></div>`;
  if (html !== aboutHtml) { aboutHtml = html; $('#p-about').innerHTML = html; }
  lastHints = f.hints;
}
// Released work seen from outside (outside.ts): GitHub, PyPI and the live site, as the background checks last found them
function outsideCard(o) {
  const n = (x) => Number(x).toLocaleString();
  // each row's name links to the place it describes
  const at = (label, url) => (url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${label}</a>` : label);
  const rows = [
    o.stars !== undefined && [at('GitHub', o.repo), `★ ${n(o.stars)} · ${n(o.forks)} fork${o.forks === 1 ? '' : 's'}${o.openFromOthers ? ` · ${o.openFromOthers} open from others${o.waiting ? `, <b>${o.waiting} waiting for you</b>` : ''}` : ''}`],
    o.downloads && [at('PyPI', o.pypi), `${n(o.downloads.week)} downloads last week · ${n(o.downloads.month)} last month`],
    o.site && [at('live site', o.liveUrl), o.site.downSince ? `<span class="down">down since ${esc(dateOf(o.site.downSince))}, ${esc(new Date(o.site.downSince).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</span>`
      : o.site.ok ? `<span class="up">● up</span>${o.site.status ? ` (${o.site.status})` : ''}` : `<span class="note">one failed check (${esc(o.site.error ?? o.site.status)}), checking again</span>`],
  ].filter(Boolean);
  if (!rows.length) return '';
  const when = o.checkedAt ?? o.site?.checkedAt;
  return `<div class="sec"><h4>Outside</h4><dl class="kv" style="padding:0">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>${when ? `<p class="note">Checked ${esc(ago(when))}</p>` : ''}</div>`;
}

function recapCard(r) {
  const left = r.left && [
    r.left.branch !== 'main' && r.left.branch !== 'master' && `on branch <code>${esc(r.left.branch)}</code>`,
    r.left.changed && `${r.left.changed} file${r.left.changed === 1 ? '' : 's'} not committed`,
    r.left.ahead && `${r.left.ahead} commit${r.left.ahead === 1 ? '' : 's'} not pushed`,
    r.left.stashes && `${r.left.stashes} stash${r.left.stashes === 1 ? '' : 'es'}`,
  ].filter(Boolean);
  if (!r.lastWorkAt && !r.prompt && !left?.length) return '';
  const mins = (ms) => { const m = Math.round(ms / 60000); return m < 1 ? '' : m < 60 ? `${m} m` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} m`; };
  const row = (text, note) => `<li><span>${text}</span><span class="note">${esc(note)}</span></li>`;
  return `<div class="sec recap">
    <h4>Where was I?${AI?.can.openNew ? `<button class="btn" data-act="resume" title="A new ${esc(AI.label)} session with this card and your notes typed in, ready to send">${AI_ICON} Resume in ${esc(AI.label)}</button>` : ''}</h4>
    ${r.lastWorkAt ? `<p class="recap-when">Last worked on ${dateOf(r.lastWorkAt)} <span class="note">(${ago(r.lastWorkAt)})</span></p>` : ''}
    ${r.prompt ? `<blockquote title="What you last asked ${esc(AI?.label ?? 'the assistant')} here">${esc(r.prompt.text)}</blockquote>` : ''}
    ${left?.length ? `<p class="recap-left">Left behind: ${left.join(', ')}</p>` : ''}
    ${r.sessions.length ? `<h5>Sessions</h5><ul>${r.sessions.map((s) => row(esc(s.title), mins(s.ms))).join('')}</ul>` : ''}
    ${r.commits.length ? `<h5>Commits</h5><ul>${r.commits.map((c) => row(`<code>${esc(c.hash)}</code> ${esc(c.subject)}`, dateOf(c.time))).join('')}</ul>` : ''}
  </div>`;
}
let lastHints;
// What Oberth can see that suggests a release, shown next to the Released checkbox. The mark stays the owner's call.
function hintText(h) {
  if (!h) return '';
  const seen = [h.publicRepo && 'a public GitHub repo', h.pypi && `${h.pypi.name} ${h.pypi.version} on PyPI`, h.liveUrl && `a live site (${new URL(h.liveUrl).host})`].filter(Boolean);
  return seen.length ? `Seen: ${seen.join(', ')}.` : 'Nothing public seen.';
}
function editAbout(p) {
  aboutEditing = true; aboutHtml = '';
  const a = p.about ?? {};
  $('#p-about').innerHTML = `<form class="sec about-form" id="about-form">
      <label>Description <span class="note">one line, so you remember what it is</span><input name="description" maxlength="200" value="${esc(a.description ?? '')}"></label>
      <label>Status <select name="status"><option value="">No status</option>${Object.entries(STATUSES).map(([k, v]) => `<option value="${k}"${a.status === k ? ' selected' : ''}>${v}: ${STATUS_MEANS[k]}</option>`).join('')}</select></label>
      <div class="rel-row"><label class="check"><input type="checkbox" name="released"${a.released ? ' checked' : ''}> Released <span class="note">anyone can use it</span></label>
        <label class="where">Where <input name="releasedWhere" maxlength="80" placeholder="PyPI, a website, an app store…" value="${esc(a.releasedWhere ?? '')}"></label></div>
      <div class="note hint">${esc(hintText(lastHints))}</div>
      <label>Notes <span class="note">where you left off, what's next</span><textarea name="notes" rows="9" maxlength="4000">${esc(a.notes ?? '')}</textarea></label>
      <div class="about-actions"><button class="btn go" type="submit">Save</button><button class="btn" type="button" data-about="cancel">Cancel</button></div>
    </form>`;
  $('#about-form [name=description]').focus();
}

async function drawInfo(p) {
  const r = await fetch(`/api/projects/${enc(p.id)}/info`, { headers: auth });
  if (!r.ok || selected !== p.id || tab !== 'info') return;
  const i = await r.json();
  const mb = (b) => `${Math.round(b / 1048576)} MB`;
  const rows = [
    ['folder', `<code>${esc(i.folder)}</code>`],
    ['command', `<code>${esc(i.command)}</code>`],
    i.address && ['address', `<a href="${esc(i.address)}" target="_blank">${esc(i.address)}</a>${i.url ? '' : ' <span class="note">when running</span>'}`],
    i.url && ['local', `<a href="${esc(i.url)}" target="_blank">${esc(i.url)}</a>${i.address ? ' <span class="note">this launch\'s port</span>' : ''}`],
    i.pgid && ['process', [`group ${i.pgid}`, i.memory && mb(i.memory), i.startedAt && `up ${upFor(i.startedAt)}`].filter(Boolean).join(' · ')],
    i.node && ['node', `${esc(i.node)} (nvm)`],
    p.preflight?.length && ['before launch', p.preflight.map((f) => esc(f.text)).join('<br>')],
    i.liveUrl && ['live', `<a href="${esc(i.liveUrl)}" target="_blank" rel="noopener">${esc(i.liveUrl)}</a>${p.liveStatus ? `<br><span class="${p.liveStatus.ok ? 'up' : 'down'}">● ${p.liveStatus.ok ? `${p.liveStatus.status} · ${p.liveStatus.ms} ms` : `not answering (${esc(p.liveStatus.status ?? p.liveStatus.error)})`}</span> <span class="note">checked ${ago(p.liveStatus.checkedAt)}</span>` : ''}`],
    AI?.can.states && [AI.label.toLowerCase(), p.assistant ? `${esc(p.assistant.title)} · ${p.assistant.working ? '<b>working now</b>' : `idle, last active ${ago(p.assistant.at)}`}${p.assistant.others ? ` · ${p.assistant.others} more session${p.assistant.others === 1 ? '' : 's'}` : ''}` : `no ${esc(AI.label)} session`],
    ['log', `<code>${esc(i.logPath)}</code>`],
  ].filter(Boolean);
  $('#p-info').innerHTML = `<dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
}

// How often each tab refetches while it is open (git runs real git commands).
const PACE = { about: 5000, output: 0, git: 4000, scripts: 1000, info: 3000 };
let lastFetch = 0;
async function tick(force = false) {
  const p = projects.find((x) => x.id === selected);
  if (!p || log.busy) return;
  if (!force && Date.now() - lastFetch < (filter === 'errors' && tab === 'output' ? 1500 : PACE[tab])) return;
  log.busy = true;
  lastFetch = Date.now();
  try {
    if (tab === 'output' && filter === 'errors') { await fetchErrors(p); drawErrors(); }
    else if (tab === 'output') { if (await fetchLog(p) || !$('#term').innerHTML) drawLog(p); }
    else if (tab === 'about') await drawAbout(p);
    else if (tab === 'git') await drawGit(p);
    else if (tab === 'scripts') await drawScripts(p);
    else await drawInfo(p);
  } catch { /* service briefly unreachable; the next tick retries */ }
  log.busy = false;
}

// ---------- status menu: pick a status (or Released) straight from a chip ----------

function openStatusMenu(id, anchor) {
  const p = projects.find((x) => x.id === id);
  if (!p) return;
  const a = p.about ?? {};
  const menu = $('#stmenu');
  menu.dataset.id = id;
  menu.innerHTML = Object.entries(STATUSES).map(([k, v]) => `<button role="menuitemradio" aria-checked="${a.status === k}" data-stpick="${k}" title="${esc(STATUS_MEANS[k])}"><span class="mark">${a.status === k ? '✓' : ''}</span><span class="chip st ${k}">${v}</span><span class="means">${esc(STATUS_MEANS[k].split(';')[0])}</span></button>`).join('')
    + `<button role="menuitemradio" aria-checked="${!a.status}" data-stpick=""><span class="mark">${a.status ? '' : '✓'}</span><span class="note">No status</span></button>`
    + `<hr><button role="menuitemcheckbox" aria-checked="${!!a.released}" data-stpick="released"><span class="mark">${a.released ? '✓' : ''}</span><span class="chip rel">Released</span><span class="means">anyone can use it</span></button>`;
  menu.hidden = false;
  const r = anchor.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${r.bottom + 4 + menu.offsetHeight > innerHeight ? r.top - menu.offsetHeight - 4 : r.bottom + 4}px`;
  menu.querySelector('[aria-checked="true"]')?.focus();
}
const closeStatusMenu = () => { $('#stmenu').hidden = true; };

/** Saves one change to a project's About (status or Released), keeping every other field as it was. */
async function changeAbout(id, change) {
  const p = projects.find((x) => x.id === id);
  if (!p) return;
  const { updatedAt, ...about } = p.about ?? {};
  const next = { ...about, ...change };
  p.about = next; // show it at once; the refresh confirms it
  render();
  const r = await fetch(`/api/projects/${enc(id)}/about`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify(next) });
  if (!r.ok) banner((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
  aboutHtml = '';
  await refresh();
  if (selected === id && tab === 'about' && !aboutEditing) tick(true);
}

// ---------- phone ----------

function showPhone(p, anchor) {
  const pop = $('#popover');
  const rect = anchor.getBoundingClientRect();
  pop.style.left = `${Math.min(rect.left, innerWidth - 260)}px`;
  pop.style.top = `${Math.min(rect.bottom + 6, innerHeight - 300)}px`;
  pop.hidden = false;
  // the click that opened it is still on its way up to the document handler, which closes popovers on outside clicks
  pop.dataset.opening = '1';
  setTimeout(() => { delete pop.dataset.opening; });
  pop.innerHTML = 'Starting phone mode…';
  const poll = async () => {
    if (pop.hidden) return;
    const cur = projects.find((x) => x.id === p.id);
    if (cur?.status === 'failed') { pop.innerHTML = `Phone mode failed: ${esc(cur.error)}<br><button class="btn" data-close>Close</button>`; return; }
    const r = await fetch(`/api/projects/${enc(p.id)}/qr`);
    if (!r.ok) { setTimeout(poll, 800); return; }
    const svg = await r.text();
    const url = r.headers.get('X-Phone-Url');
    pop.innerHTML = `${svg}<div>Scan on your phone (same Wi-Fi)</div><b>${esc(url)}</b>${cur?.lanNote ? `<div>${esc(cur.lanNote)}</div>` : ''}<button class="btn" data-close>Close</button>`;
  };
  poll();
}

// ---------- events ----------

function toggleFold(key) {
  if (folded.has(key)) folded.delete(key); else folded.add(key);
  store.set('folded', JSON.stringify([...folded]));
  render();
}
$('#group-by').addEventListener('change', (e) => setView(e.target.value));
$('#sort-by').addEventListener('change', (e) => setView(undefined, e.target.value));
document.addEventListener('keydown', (e) => {
  const fold = e.target.closest?.('[data-fold]');
  if (fold && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleFold(fold.dataset.fold); }
});

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act],[data-foreign],[data-close],[data-tab],[data-filter],[data-sact],[data-about],[data-sfilter],#stop-all,#d-close,#out-copy,#out-clear');
  const st = e.target.closest('[data-stmenu],[data-stpick]');
  if (st?.dataset.stmenu) { const m = $('#stmenu'); if (!m.hidden && m.dataset.id === st.dataset.stmenu) return closeStatusMenu(); return openStatusMenu(st.dataset.stmenu, st); }
  if (st && st.dataset.stpick !== undefined) {
    const id = $('#stmenu').dataset.id;
    const pick = st.dataset.stpick;
    const cur = projects.find((x) => x.id === id)?.about ?? {};
    closeStatusMenu();
    return changeAbout(id, pick === 'released' ? { released: !cur.released } : { status: pick || undefined });
  }
  closeStatusMenu();
  const fold = e.target.closest('[data-fold]');
  if (fold) return toggleFold(fold.dataset.fold);
  if (!el) {
    if (!e.target.closest('#popover') && !$('#popover').dataset.opening) $('#popover').hidden = true;
    // a click on a row (outside its buttons) selects it
    const ag = e.target.closest('[data-ag]');
    if (ag) return agendaAct(ag.closest('.arow').dataset.agkey, ag.dataset.ag);
    const arow = e.target.closest('.arow[data-agid]');
    if (arow && !e.target.closest('a')) return select(arow.dataset.agid);
    const rowEl = e.target.closest('.row');
    if (rowEl && !e.target.closest('a')) select(rowEl.dataset.id === selected ? null : rowEl.dataset.id);
    return;
  }
  if (el.id === 'd-close') return select(null);
  if (el.id === 'stop-all') return post('/api/stop-all');
  if (el.id === 'out-copy') return navigator.clipboard.writeText([...$('#term').childNodes].map((n) => n.textContent).join(''));
  if (el.id === 'out-clear') { log.clearedAt = log.offset; return drawLog(projects.find((x) => x.id === selected)); }
  if (el.dataset.about === 'edit') return editAbout(projects.find((x) => x.id === selected));
  if (el.dataset.about === 'cancel') { aboutEditing = false; aboutHtml = ''; return tick(true); }
  if (el.dataset.sfilter) { statusFilter = el.dataset.sfilter; store.set('sfilter', statusFilter); return render(); }
  if (el.dataset.tab) { if (el.dataset.tab !== 'about') aboutEditing = false; aboutHtml = ''; tab = el.dataset.tab; store.set('tab', tab); renderDrawer(); $('#term').dataset.drawn = ''; $('#term').innerHTML = ''; drawnErrors = ''; return tick(true); }
  if (el.dataset.filter) { filter = el.dataset.filter; renderDrawer(); $('#term').dataset.drawn = ''; $('#term').innerHTML = ''; drawnErrors = ''; return tick(true); }
  if (el.dataset.sact) {
    const name = el.closest('[data-script]').dataset.script;
    const sbase = `/api/projects/${enc(selected)}/scripts/${enc(name)}`;
    if (el.dataset.sact === 'log') { if (openLogs.has(name)) openLogs.delete(name); else openLogs.set(name, ''); return tick(true); }
    if (el.dataset.sact === 'run') { el.disabled = true; el.textContent = 'Starting…'; }
    await post(`${sbase}/${el.dataset.sact}`, {});
    return tick(true);
  }
  if (el.dataset.close !== undefined) { $('#popover').hidden = true; return; }
  if (el.dataset.foreign) return post(`/api/foreign/${el.dataset.foreign}/stop`);
  return doAct(el.closest('[data-id]').dataset.id, el.dataset.act, el);
});

/** One action on one project, from a button or the palette. anchor: where the phone QR popover appears. */
function doAct(id, act, anchor) {
  const p = projects.find((x) => x.id === id);
  if (!p) return;
  const base = `/api/projects/${enc(id)}`;
  // show the new state at once; the request's answer (and the next poll) replace it
  const now = (st) => { optimistic.set(id, st); rowError.delete(id); render(); };
  switch (act) {
    case 'launch': if (!p.foreign.length) now(installs(p) ? 'installing' : 'starting'); return post(`${base}/launch`, { mode: 'local' }, id);
    case 'open': return post(`${base}/launch`, { mode: 'local' }, id);
    case 'stop': now('stopping'); return post(`${base}/stop`, {}, id);
    case 'assistant': return post(`${base}/assistant`, {}, id);
    case 'resume': return post(`${base}/resume`, {}, id);
    case 'hide': return post(`${base}/hide`, {}, id);
    case 'unhide': return post(`${base}/unhide`, {}, id);
    case 'pin': return post(`${base}/pin`, {}, id);
    case 'unpin': return post(`${base}/unpin`, {}, id);
    case 'editor': return post(`${base}/editor`, {}, id);
    case 'finder': return post(`${base}/finder`, {}, id);
    case 'free-port': {
      // the service retries in the mode that failed: a phone-mode retry needs its QR code again
      const lan = p.mode === 'lan';
      now('starting');
      const done = post(`${base}/free-port`, {}, id);
      if (lan) showPhone(p, anchor ?? $('#kbar'));
      return done;
    }
    case 'checks': return select(id, 'scripts');
    case 'errors': filter = 'errors'; drawnErrors = ''; return select(id, 'output');
    case 'phone': now('starting'); post(`${base}/launch`, { mode: 'lan' }, id); return showPhone(p, anchor ?? $('#kbar'));
  }
}

// ---------- activity strip: today's launches, failures, script results and commits ----------

const ACT_TAB = { failed: 'output', crashed: 'output', launch: 'output', ready: 'output', stopped: 'output', script: 'scripts', commit: 'git' };
let activityHtml = '';
async function refreshActivity() {
  let events = [];
  try { const r = await fetch('/api/activity'); if (r.ok) events = await r.json(); } catch { return; }
  const names = new Map(projects.map((p) => [p.id, p]));
  const html = events.filter((e) => names.has(e.id) && !names.get(e.id).hidden).slice(0, 25).map((e) => {
    const p = names.get(e.id);
    const cls = e.ok === false ? 'bad' : e.ok ? 'ok' : '';
    // commit text is "<hash> <subject>"; git's short hash grows past 7 characters in bigger repos
    const sp = e.text.indexOf(' ');
    const text = e.kind === 'commit' && sp > 0 ? `<span class="hash">${esc(e.text.slice(0, sp))}</span> ${esc(short(e.text.slice(sp + 1), 48))}` : esc(short(e.text, 60));
    return `<button class="ev ${cls}" data-ev="${esc(e.id)}" data-ev-tab="${ACT_TAB[e.kind] ?? 'output'}" title="${esc(`${p.name}: ${e.text}`)}"><img src="${iconSrc(p)}" alt=""><time>${clock(e.at).slice(0, 5)}</time>${esc(p.name)} · ${text}</button>`;
  }).join('');
  if (html !== activityHtml) { activityHtml = html; $('#activity').innerHTML = html; }
  $('#activity').hidden = !html;
}

// ---------- ⌘K palette: every project action, by typing a few letters of the project and the action ----------

function commands() {
  const out = [];
  for (const p of projects) {
    const add = (label, hint, run) => out.push({ p, label, hint, run });
    const st = statusOf(p);
    if (st === 'running') {
      if (p.kind !== 'window' && p.mode === 'local') add('Open', p.port ? `:${p.port}` : '', () => doAct(p.id, 'open'));
      add('Stop', '', () => doAct(p.id, 'stop'));
    } else if (st === 'starting' || st === 'installing') add('Stop', st, () => doAct(p.id, 'stop'));
    else if (p.foreign.length) { if (p.kind !== 'window') add('Open', 'started outside Oberth', () => doAct(p.id, 'open')); }
    else if (st !== 'stopping' && p.kind !== 'library') add(st === 'failed' ? 'Retry' : 'Launch', installs(p) ? `runs ${pm(p)} install first` : (p.preflight?.[0]?.short ?? ''), () => doAct(p.id, 'launch'));
    if (p.conflict && p.conflict.holder.kind !== 'other' && st === 'failed') add('Stop it and retry', `frees :${p.conflict.port}`, () => doAct(p.id, 'free-port'));
    if (p.errors && ACTIVE.includes(st)) add('Show errors', `${p.errors}`, () => doAct(p.id, 'errors'));
    add('About', short(p.about?.description ?? '', 44), () => select(p.id, 'about'));
    add('Show output', '', () => select(p.id, 'output'));
    for (const n of p.checks) add(`Run ${n}`, p.scripts?.[n]?.status ?? '', async () => { select(p.id, 'scripts'); await post(`/api/projects/${enc(p.id)}/scripts/${enc(n)}/run`); tick(true); });
    add('Git', p.git ? [p.git.changed && `${p.git.changed} changed`, p.git.ahead && `${p.git.ahead} unpushed`].filter(Boolean).join(' · ') : 'no git', () => select(p.id, 'git'));
    add('Scripts', '', () => select(p.id, 'scripts'));
    add('Info', '', () => select(p.id, 'info'));
    if (AI?.can.open) add(AI.label, p.assistant ? `open “${short(p.assistant.title, 28)}”` : 'new session', () => doAct(p.id, 'assistant'));
    add(EDITOR, '', () => doAct(p.id, 'editor'));
    add('Finder', '', () => doAct(p.id, 'finder'));
    if (p.liveUrl) add('Live site', new URL(p.liveUrl).host, () => window.open(p.liveUrl, '_blank', 'noopener'));
    if (p.repoUrl) add(forge(p.repoUrl), '', () => window.open(p.repoUrl, '_blank', 'noopener'));
    if (p.phone && st !== 'stopping') add('Open on phone', '', () => doAct(p.id, 'phone'));
    add(p.pinned ? 'Unpin' : 'Pin', p.pinned ? '' : 'to the top of its group', () => doAct(p.id, p.pinned ? 'unpin' : 'pin'));
    add(p.hidden ? 'Unhide' : 'Hide', '', () => doAct(p.id, p.hidden ? 'unhide' : 'hide'));
  }
  for (const it of [...agenda.needs, ...agenda.look]) {
    const needs = it.level === 'needs';
    out.push({ p: projects.find((x) => x.id === it.projectId), agenda: needs, view: !needs, label: short(it.title, 60), hint: needs ? 'Needs you' : 'Worth a look', run: () => agendaAct(it.key, 'open') });
  }
  for (const [k, g] of Object.entries(GROUPINGS)) out.push({ view: true, label: `Group by ${g.label.toLowerCase()}`, hint: groupBy === k ? 'current' : '', run: () => setView(k) });
  for (const [k, o] of Object.entries(SORTS)) out.push({ view: true, label: `Sort by ${o.label.toLowerCase()}`, hint: sortBy === k ? 'current' : o.head, run: () => setView(undefined, k) });
  if (mod('agenda')) out.push({ view: true, label: 'Agenda', hint: 'what is waiting for you', run: () => { location.hash = 'agenda'; } });
  if (mod('ideas')) out.push({ view: true, label: 'Ideas', hint: 'your notebook', run: () => { location.hash = 'ideas'; } });
  if (mod('ideas')) out.push({ view: true, label: 'New idea', hint: 'for a new project or an existing one', run: () => { location.hash = 'ideas'; setTimeout(() => $('#idea-title').focus(), 50); } });
  if (mod('logbook')) out.push({ view: true, label: 'Logbook', hint: 'where the time went', run: () => { location.href = '/logbook'; } });
  out.push({ view: true, label: 'About Oberth', hint: '', run: () => { location.href = '/about'; } });
  if (projects.some((p) => ACTIVE.includes(statusOf(p)))) out.push({ label: 'Stop all', hint: '', run: () => post('/api/stop-all') });
  return out;
}

// Recall: what the typed words find across projects, listed after the commands, which arrive at once and stay on top
const RECALL_MIN = 3;
const RECALL_LABEL = { notes: 'notes', ideas: 'idea', sessions: 'session', code: 'code', docs: 'docs' };
let recall = { q: '', hits: [], note: '' };
let recallTimer;
function recallRows() {
  return recall.hits.map((h) => ({
    p: projects.find((x) => x.id === h.projectId), recallProject: h.project, label: h.title, snip: h.snippet,
    hint: h.at ? `${RECALL_LABEL[h.kind]} · ${new Date(h.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : RECALL_LABEL[h.kind],
    run: () => (h.kind === 'notes' ? select(h.projectId, 'about') : h.kind === 'ideas' ? showIdea(h.key.slice('ideas:'.length)) : post('/api/recall/open', { key: h.key })),
  }));
}
function searchRecall() {
  const q = $('#pal-q').value.replace(/\s+/g, ' ').trim();
  clearTimeout(recallTimer);
  recall = { q, hits: [], note: q.length >= RECALL_MIN && mod('recall') ? 'Searching…' : '' };
  if (q.length < RECALL_MIN || !mod('recall')) return; // search is a module that can be off
  recallTimer = setTimeout(async () => {
    let r;
    try {
      const res = await fetch(`/api/recall?q=${enc(q)}`, { headers: auth });
      r = res.ok ? await res.json() : { hits: [], error: 'Search failed' };
    } catch { r = { hits: [], error: 'Search failed' }; }
    if (recall.q !== q || $('#veil').hidden) return; // the words have changed since
    recall = { q, hits: r.hits, note: r.error ?? (r.cut ? 'Ran out of time, there may be more' : '') };
    drawPalette();
  }, 250);
}

const words = (s) => s.toLowerCase().split(/[^a-z0-9.:]+/).filter(Boolean);
let palHits = [];
let palIndex = 0;
function drawPalette() {
  const q = words($('#pal-q').value);
  const all = commands();
  // every typed word must start a word of "project action" (or appear in the project's name)
  const matches = (c, text) => {
    const hay = words(text);
    const name = (c.p?.name ?? '').toLowerCase();
    return q.every((w) => hay.some((h) => h.startsWith(w)) || name.includes(w));
  };
  const named = (c) => `${c.p?.name ?? ''} ${c.p?.id ?? ''} ${c.label}`;
  palHits = all.filter((c) => matches(c, `${named(c)} ${c.p?.about?.description ?? ''} ${(c.p?.stack ?? []).join(' ')}`));
  if (!q.length) palHits = palHits.filter((c) => (c.p ? c.agenda || ACTIVE.includes(statusOf(c.p)) || c.p.id === selected || ['Launch', 'Retry'].includes(c.label) : !c.view));
  // hits on the name or the action first, then those found only in a description or stack ("sort" vs a
  // description that says "sorts"); the sort is stable, so general commands stay after the projects' own
  const strong = new Set(palHits.filter((c) => matches(c, named(c))));
  palHits = palHits.filter((c) => !c.p?.hidden || q.length).sort((a, b) => (strong.has(b) ? 1 : 0) - (strong.has(a) ? 1 : 0)).slice(0, 40).concat(recallRows());
  palIndex = Math.min(palIndex, Math.max(0, palHits.length - 1));
  $('#pal-res').innerHTML = palHits.map((c, i) => {
    const name = c.p?.name ?? c.recallProject;
    const icon = c.p ? `<img src="${iconSrc(c.p)}" alt="">` : c.recallProject ? '<img src="/logo.svg" alt="">' : '<span></span>';
    return `<li class="${i === palIndex ? 'on' : ''}" data-pal="${i}">${icon}<span>${name ? `${esc(name)} <span class="sep">—</span> ` : ''}<b>${esc(c.label)}</b>${c.snip ? `<span class="snip">${esc(c.snip)}</span>` : ''}</span><span class="k">${esc(c.hint || '')}</span></li>`;
  }).join('') || `<li class="none"><span></span><span>${recall.note === 'Searching…' ? 'Searching…' : 'No match'}</span><span></span></li>`;
  $('#pal-note').textContent = recall.note;
  $('#pal-res .on')?.scrollIntoView({ block: 'nearest' });
}
function openPalette() { $('#veil').hidden = false; $('#pal-q').value = ''; palIndex = 0; searchRecall(); drawPalette(); $('#pal-q').focus(); }
function closePalette() { $('#veil').hidden = true; }
function runPalette(i) { const c = palHits[i]; if (!c) return; closePalette(); c.run(); }
$('#kbar').addEventListener('click', openPalette);

// three views of one page: Projects, the Agenda on its own (#agenda), and Ideas (#ideas, drawn by ideas.js)
function applyView() {
  const view = location.hash === '#agenda' && mod('agenda') ? 'agenda' : location.hash === '#ideas' && mod('ideas') ? 'ideas' : 'projects';
  document.body.classList.toggle('v-agenda', view === 'agenda');
  document.body.classList.toggle('v-ideas', view === 'ideas');
  $('#ideas-view').hidden = view !== 'ideas';
  $('#view-title').textContent = { projects: 'Projects', agenda: 'Agenda', ideas: 'Ideas' }[view];
  document.title = view === 'projects' ? 'Oberth · Dev Project Console' : `${view === 'agenda' ? 'Agenda' : 'Ideas'} · Oberth`;
  for (const [id, on] of [['#nav-projects', view === 'projects'], ['#nav-agenda', view === 'agenda'], ['#nav-ideas', view === 'ideas']]) {
    if (!$(id)) continue; // a module that is off has no link
    $(id).classList.toggle('on', on);
    if (on) $(id).setAttribute('aria-current', 'page'); else $(id).removeAttribute('aria-current');
  }
  if (view === 'ideas' && typeof renderIdeas === 'function') renderIdeas(true);
}
$('#nav-projects').addEventListener('click', (e) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  if (location.hash) { history.pushState(null, '', '/'); applyView(); }
  scrollTo(0, 0);
});
addEventListener('hashchange', applyView);
applyView();
$('#pal-q').addEventListener('input', () => { palIndex = 0; searchRecall(); drawPalette(); });
$('#pal-q').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { palIndex = Math.min(palIndex + 1, palHits.length - 1); drawPalette(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { palIndex = Math.max(palIndex - 1, 0); drawPalette(); e.preventDefault(); }
  else if (e.key === 'Enter') { runPalette(palIndex); e.preventDefault(); }
});
$('#veil').addEventListener('click', (e) => {
  const li = e.target.closest('[data-pal]');
  if (li) runPalette(Number(li.dataset.pal)); else if (e.target === $('#veil')) closePalette();
});
$('#activity').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ev]');
  if (b) select(b.dataset.ev, b.dataset.evTab);
});

document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'about-form') return;
  e.preventDefault();
  const form = new FormData(e.target);
  const id = selected;
  const body = { released: form.get('released') === 'on', releasedWhere: form.get('releasedWhere'), description: form.get('description'), status: form.get('status'), notes: form.get('notes') };
  const r = await fetch(`/api/projects/${enc(id)}/about`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify(body) });
  if (!r.ok) { banner((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`); return; }
  aboutEditing = false; aboutHtml = '';
  await refresh();
  tick(true);
});

$('#out-q').addEventListener('input', () => { const p = projects.find((x) => x.id === selected); if (p) drawLog(p); });
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); return $('#veil').hidden ? openPalette() : closePalette(); }
  if (e.key === '/' && $('#veil').hidden && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName ?? '')) { e.preventDefault(); return openPalette(); }
  if (e.key !== 'Escape') return;
  if (!$('#stmenu').hidden) return closeStatusMenu();
  if (!$('#veil').hidden) return closePalette();
  if (!$('#popover').hidden) $('#popover').hidden = true;
  else if (document.activeElement === $('#out-q') && $('#out-q').value) { $('#out-q').value = ''; $('#out-q').dispatchEvent(new Event('input')); }
  else if (selected) select(null);
});

// Links from the menu bar app and its notifications: /?p=<id>&tab=output&filter=errors
const params = new URLSearchParams(location.search);
if (params.has('p')) {
  selected = params.get('p');
  if (TABS.includes(params.get('tab'))) tab = params.get('tab');
  if (params.get('filter') === 'errors') filter = 'errors';
  history.replaceState(null, '', '/');
}
refresh().then(() => {
  refreshActivity(); // needs the project list for names and icons
  refreshAgenda();
  if (!selected) return;
  const f = filter;
  select(selected, tab); filter = f; renderDrawer(); tick(true);
  // the menu's "Restart for phone…" lands here to show the QR code
  if (params.get('phone') === '1') $('#d-acts [data-act="phone"]')?.click();
});
setInterval(refresh, 2000);
setInterval(refreshActivity, 5000);
setInterval(refreshAgenda, 5000);
setInterval(tick, 700);
