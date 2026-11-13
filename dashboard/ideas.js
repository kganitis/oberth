// Ideas (docs/architecture.md, "Ideas"): the owner's notebook of new projects and of things to do later in
// existing ones. A view of the dashboard page at /#ideas; it shares app.js's helpers ($, esc, enc, auth, projects,
// iconSrc, select, ago, banner, store, folded, dateOf).
let ideas = null; // the last GET /api/ideas
let openIdea = store.get('idea');
let ideasHtml = '';
let groupsCache = null;
const BULB = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3z"/></svg>';
const SOURCE = { cli: 'command line', mcp: 'agent session', menu: 'menu bar', dashboard: 'dashboard' };
const AIL = typeof AI !== 'undefined' && AI ? AI.label : null;   // the assistant's name, or null without one (app.js)
const inIdeas = () => location.hash === '#ideas';
const allIdeas = () => (ideas ? [...ideas.newProjects, ...ideas.forProjects, ...ideas.done, ...ideas.dropped] : []);

/** What an idea can be filed against: a discovered project, or Oberth itself. */
function ideaTarget(id) {
  if (id === 'oberth') return { id, name: 'Oberth', icon: '/logo.svg', project: false };
  const p = projects.find((x) => x.id === id);
  return p && { id, name: p.name, icon: iconSrc(p), project: true };
}
const host = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return u; } };
/** Escaped text with its links made clickable. */
const linkify = (t) => esc(t).replace(/https?:\/\/[^\s<]+/g, (m) => {
  const url = m.replace(/(?:[.,;:!?)\]]|&#\d+;)+$/, '');
  return `<a href="${url}" target="_blank" rel="noopener">${url}</a>${m.slice(url.length)}`;
});

async function refreshIdeas() {
  try {
    const r = await fetch('/api/ideas', { headers: auth });
    if (!r.ok) return;
    ideas = await r.json();
  } catch { return; }
  if ($('#nav-ideas-n')) $('#nav-ideas-n').textContent = ideas.open || '';
  renderIdeas();
}

async function ipost(path, body = {}) {
  try {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { error: j.error ?? `HTTP ${r.status}` };
    return j;
  } catch { return { error: "Can't reach Oberth service." }; }
}
async function iact(path, body) {
  const r = await ipost(path, body);
  if (r.error) banner(r.error);
  await refreshIdeas();
  return r;
}

// ---------- the view ----------

function ideaRow(i, kind) {
  const t = i.projectId && ideaTarget(i.projectId);
  const open = openIdea === i.id && kind === 'open';
  const icon = i.projectId
    ? (t ? `<img class="iico" src="${t.icon}" alt="">` : '<span class="iico gone">?</span>')
    : `<span class="ibulb${kind === 'open' ? '' : ' dim'}">${kind === 'dropped' ? '–' : kind === 'done' ? '✓' : BULB}</span>`;
  const first = i.notes[0];
  const meta = [
    i.projectId && (t?.project ? `<button class="chip proj" data-iact="proj" title="Open ${esc(t.name)}">${esc(t.name)}</button>` : `<span class="chip proj">${esc(t?.name ?? `${i.projectId} (gone)`)}</span>`),
    kind === 'done' ? `<span>${i.started?.claude ? `started in ${AIL ? `a ${esc(AIL)}` : 'an assistant'} session` : 'marked done'} ${esc(dateOf(i.started.at))}</span>`
      : kind === 'dropped' ? `<span>dropped ${esc(dateOf(i.droppedAt ?? i.updatedAt))}</span>` : `<span>${esc(ago(i.updatedAt))}</span>`,
    i.notes.length ? `<span>${i.notes.length} note${i.notes.length === 1 ? '' : 's'}</span>` : '',
    ...i.links.slice(0, 3).map((u) => `<a class="chip link" href="${esc(u)}" target="_blank" rel="noopener">↗ ${esc(host(u))}</a>`),
    i.sessionId && AIL ? `<button class="chip c" data-iact="session" title="Open the ${esc(AIL)} session this came from">from a ${esc(AIL)} session</button>`
      : first ? `<span class="chip">${esc(SOURCE[first.source] ?? first.source)}</span>` : '',
  ].filter(Boolean).join('');
  const acts = kind === 'open'
    ? `<button class="btn ghost" data-iact="start">Start…</button>${i.projectId ? '<button class="btn quiet" data-iact="done">Done</button>' : ''}<button class="btn quiet" data-iact="drop">Drop</button>`
    : kind === 'dropped' ? '<button class="btn quiet" data-iact="restore">Restore</button><button class="btn quiet" data-iact="delete">Delete…</button>'
    : `${t?.project ? '<button class="btn quiet" data-iact="proj">Open project</button>' : ''}<button class="btn quiet" data-iact="restore" title="Back to the open ideas">Reopen</button>`;
  const targets = [['', 'New project'], ...projects.filter((p) => !p.hidden || p.id === i.projectId).map((p) => [p.id, p.name]).sort((a, b) => a[1].localeCompare(b[1])), ['oberth', 'Oberth']];
  const thread = open ? `
      <div class="ithread">${i.notes.map((n) => `<div><span class="when">${esc(dateOf(n.at))} · ${esc(SOURCE[n.source] ?? n.source)}</span><p>${linkify(n.text)}</p></div>`).join('') || '<div class="note">No notes yet.</div>'}</div>
      <div class="iaddnote"><textarea data-inote rows="1" maxlength="4000" placeholder="Add a note or a link…"></textarea><button class="btn" data-iact="note">Add note</button>
        <select data-imove title="Move it to a project, or make it a new-project idea">${targets.map(([v, n]) => `<option value="${esc(v)}"${(i.projectId ?? '') === v ? ' selected' : ''}>${v === '' ? 'For: new project' : `For: ${esc(n)}`}</option>`).join('')}</select>
        <button class="btn quiet" data-iact="rename">Rename</button></div>` : '';
  return `<div class="irow${open ? ' open' : ''}${kind === 'open' ? '' : ' past'}" data-iid="${esc(i.id)}">
    ${icon}<h3>${esc(i.title)}</h3><div class="iacts">${acts}</div>
    <div class="ipitch">${first ? esc(first.text.replace(/\s+/g, ' ')) : '<span class="note">No notes yet.</span>'}</div>
    <div class="imeta">${meta}</div>${thread}
  </div>`;
}

function startedRow(s) {
  const p = projects.find((x) => x.id === s.id);
  const when = s.startedAt ? `started ${dateOf(s.startedAt)}${s.fromIdea ? ` from “${esc(s.fromIdea)}”` : ''}` : p?.recency ? `last worked on ${esc(ago(p.recency))}` : '';
  return `<div class="irow past started" data-sid="${esc(s.id)}">
    ${p ? `<img class="iico" src="${iconSrc(p)}" alt="">` : `<span class="ibulb">${BULB}</span>`}<h3>${esc(s.name)}</h3>
    <div class="iacts"><button class="btn ghost" data-iact="open-started">Open</button></div>
    <div class="imeta"><span class="chip st idea">Idea</span>${when ? `<span>${when}</span>` : ''}</div>
  </div>`;
}

function isection(title, sub, rows, empty) {
  return `<section class="icard"><h2>${esc(title)} <span class="count">${rows.length ? `· ${rows.length}` : ''}</span><span class="sub">${esc(sub)}</span></h2>
    <div class="list">${rows.join('') || `<div class="iempty">${empty}</div>`}</div></section>`;
}
function ifold(key, title, rows) {
  if (!rows.length) return '';
  const shut = !folded.has(key); // folded by default: for these keys the remembered set means open
  return `<section class="icard${shut ? ' folded' : ''}"><h2 class="fold" data-fold="${key}" tabindex="0" role="button" aria-expanded="${!shut}"><span class="caret"></span>${esc(title)} <span class="count">· ${rows.length}</span></h2><div class="list">${rows.join('')}</div></section>`;
}

/** A note being typed, a menu open or a rename under way: a redraw would lose it. */
const ideasBusy = () => {
  const a = document.activeElement;
  return (a && $('#ideas-list').contains(a) && /TEXTAREA|INPUT|SELECT/.test(a.tagName)) || [...document.querySelectorAll('#ideas-list textarea')].some((t) => t.value);
};

function renderIdeas(force = false) {
  fillFor();
  if (!ideas || !inIdeas()) return;
  $('#ideas-sum').innerHTML = [
    `<b>${ideas.newProjects.length}</b> new project${ideas.newProjects.length === 1 ? '' : 's'}`,
    `<b>${ideas.forProjects.length}</b> for existing ones`,
    ideas.started.length && `<b>${ideas.started.length}</b> started`,
  ].filter(Boolean).join(' · ');
  const html = [
    isection('New projects', 'no folder yet', ideas.newProjects.map((i) => ideaRow(i, 'open')), 'None yet: type one above.'),
    isection('For existing projects', 'to do later in a project', ideas.forProjects.map((i) => ideaRow(i, 'open')), 'None yet: pick a project next to the box above, or add one from a project’s About tab.'),
    ideas.started.length ? isection('Started', 'projects with status Idea', ideas.started.map(startedRow), '') : '',
    ifold('ideas:done', 'Done', ideas.done.map((i) => ideaRow(i, 'done'))),
    ifold('ideas:dropped', 'Dropped', ideas.dropped.map((i) => ideaRow(i, 'dropped'))),
  ].join('');
  if (html === ideasHtml || (!force && ideasBusy())) return;
  ideasHtml = html;
  $('#ideas-list').innerHTML = html;
}

/** The capture box's project picker, kept in step with the project list. */
function fillFor() {
  const sel = $('#idea-for');
  const opts = [['', 'New project'], ...projects.filter((p) => !p.hidden).map((p) => [p.id, p.name]).sort((a, b) => a[1].localeCompare(b[1])), ['oberth', 'Oberth']];
  const html = opts.map(([v, n]) => `<option value="${esc(v)}">${esc(n)}</option>`).join('');
  if (sel.dataset.html === html) return;
  const keep = sel.value;
  sel.innerHTML = html; sel.dataset.html = html;
  sel.value = opts.some(([v]) => v === keep) ? keep : '';
}

/** Opens the Ideas view with one idea open (from the palette, a search hit or a project's About tab). */
function showIdea(id) {
  openIdea = id; store.set('idea', id);
  if (!inIdeas()) location.hash = 'ideas'; else renderIdeas(true);
  setTimeout(() => $(`.irow[data-iid="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center' }), 60);
}

// ---------- the start sheets ----------

let sheetFor = null;
async function openSheet(i) {
  sheetFor = i;
  const t = i.projectId && ideaTarget(i.projectId);
  const sheet = $('#idea-sheet');
  if (i.projectId) {
    sheet.innerHTML = AIL ? `<header><h3>Start “${esc(i.title)}”</h3><p>Opens a new ${esc(AIL)} session in ${esc(t?.name ?? i.projectId)} with this brief. Nothing is written into the project.</p></header>
      <div class="form"><label>Brief <span class="note">the first message to ${esc(AIL)}, which you see before it's sent</span><textarea name="brief" maxlength="8000" required>${esc(i.brief)}</textarea></label></div>
      <p class="ierr" hidden></p>
      <footer><button type="button" class="btn quiet" data-iact="done" style="margin-right:auto">Mark done without ${esc(AIL)}</button><button type="button" class="btn" data-iact="close-sheet">Cancel</button><button class="btn go">Open ${esc(AIL)} in ${esc(t?.name ?? i.projectId)}</button></footer>`
      : `<header><h3>“${esc(i.title)}”</h3><p>An idea for ${esc(t?.name ?? i.projectId)}. Mark it done once you have taken it up.</p></header>
      <p class="ierr" hidden></p>
      <footer><button type="button" class="btn" data-iact="close-sheet" style="margin-right:auto">Cancel</button><button type="button" class="btn go" data-iact="done">Mark done</button></footer>`;
  } else {
    if (!groupsCache) groupsCache = await fetch('/api/ideas/groups', { headers: auth }).then((r) => (r.ok ? r.json() : []), () => []);
    const then = AIL ? `a ${esc(AIL)} session to start it` : 'the folder opened in your editor';
    sheet.innerHTML = `<header><h3>Start “${esc(i.title)}”</h3><p>Makes it a project: a new folder, its About, and ${then}.</p></header>
      <div class="form">
        <div class="two">
          <label>Folder name<input name="folder" value="${esc(i.folder)}" maxlength="41" pattern="[a-z0-9][a-z0-9\\-]{0,40}" required><span class="note">lower case, digits and dashes</span></label>
          <label>Where<select name="group">${groupsCache.map((g) => `<option value="${esc(g.name)}">${esc(g.label)}</option>`).join('')}</select><span class="note">a project folder or one of its groups</span></label>
        </div>
        <div class="ipath" id="idea-path"></div>
        <div class="field"><span class="flabel">Status</span><span class="seg"><button type="button" class="on" data-istatus="idea">Idea</button><button type="button" data-istatus="active">Active</button></span><input type="hidden" name="status" value="idea"></div>
        <label>Brief <span class="note">becomes the About's notes${AIL ? ` and the first message to ${esc(AIL)}, which you see before it's sent` : ''}</span><textarea name="brief" maxlength="8000" required>${esc(i.brief)}</textarea></label>
        <ul class="iwill"><li>a folder with <code>git init</code>, nothing else written in it</li><li>About: description from the title, the status picked, the brief as notes</li><li>${AIL ? `a new ${esc(AIL)} session in that folder, the brief typed in` : 'the new folder opened in your editor'}</li></ul>
      </div>
      <p class="ierr" hidden></p>
      <footer><span class="note" style="margin-right:auto">Nothing is created until you press the button.</span><button type="button" class="btn" data-iact="close-sheet">Cancel</button><button class="btn go">${AIL ? `Create folder and open ${esc(AIL)}` : 'Create folder'}</button></footer>`;
    updatePath();
  }
  $('#idea-veil').hidden = false;
  $('#idea-sheet [name=folder], #idea-sheet [name=brief]')?.focus();
}
function closeSheet() { $('#idea-veil').hidden = true; sheetFor = null; }
function updatePath() {
  const f = $('#idea-sheet [name=folder]');
  if (!f) return;
  const g = (groupsCache ?? []).find((x) => x.name === $('#idea-sheet [name=group]').value) ?? { path: '', idPrefix: '' };
  const id = g.idPrefix + f.value;
  const ok = /^[a-z0-9][a-z0-9-]{0,40}$/.test(f.value);
  const taken = projects.some((p) => p.id === id);
  $('#idea-path').innerHTML = !ok ? '<span class="bad">Use lower case letters, digits and dashes, starting with a letter or digit.</span>'
    : `Creates <b>${esc(g.path)}/${esc(f.value)}</b> · ${taken ? '<span class="bad">already a project</span>' : 'free'}`;
}

// ---------- events ----------

async function ideaAct(act, el) {
  const id = el.closest('[data-iid]')?.dataset.iid ?? sheetFor?.id;
  const i = allIdeas().find((x) => x.id === id);
  if (act === 'close-sheet') return closeSheet();
  if (act === 'open-started') return select(el.closest('[data-sid]').dataset.sid);
  if (!i) return;
  const base = `/api/ideas/${enc(i.id)}`;
  switch (act) {
    case 'start': return openSheet(i);
    case 'done': closeSheet(); return iact(`${base}/done`);
    case 'drop': return iact(`${base}/drop`);
    case 'restore': return iact(`${base}/restore`);
    case 'delete': if (confirm(`Delete “${i.title}” for good? Dropped ideas can be restored; deleted ones can't.`)) return iact(`${base}/delete`); return;
    case 'session': return iact(`${base}/session`);
    case 'proj': if (ideaTarget(i.projectId)?.project) select(i.projectId); return;
    case 'note': {
      const ta = el.closest('.irow').querySelector('[data-inote]');
      if (!ta.value.trim()) return ta.focus();
      const r = await ipost(`${base}/notes`, { text: ta.value, source: 'dashboard' });
      if (r.error) return banner(r.error);
      ta.value = '';
      return refreshIdeas().then(() => renderIdeas(true));
    }
    case 'rename': {
      const title = prompt('Rename the idea', i.title);
      if (title && title.trim() !== i.title) return iact(base, { title });
    }
  }
}

document.addEventListener('click', (e) => {
  const st = e.target.closest('[data-istatus]');
  if (st) {
    for (const b of document.querySelectorAll('[data-istatus]')) b.classList.toggle('on', b === st);
    $('#idea-sheet [name=status]').value = st.dataset.istatus;
    return;
  }
  const b = e.target.closest('[data-iact]');
  if (b) { e.preventDefault(); return ideaAct(b.dataset.iact, b); }
  if (e.target === $('#idea-veil')) return closeSheet();
  const row = e.target.closest('.irow[data-iid]:not(.past)');
  if (row && !e.target.closest('a,button,textarea,select,input,.ithread,.iaddnote')) {
    openIdea = openIdea === row.dataset.iid ? null : row.dataset.iid;
    store.set('idea', openIdea);
    renderIdeas(true);
  }
  const il = e.target.closest('[data-ishow]');
  if (il) showIdea(il.dataset.ishow);
});

document.addEventListener('change', async (e) => {
  if (!e.target.matches('[data-imove]')) return;
  const id = e.target.closest('[data-iid]').dataset.iid;
  await iact(`/api/ideas/${enc(id)}`, { projectId: e.target.value || null });
  renderIdeas(true);
});
document.addEventListener('input', (e) => { if (e.target.closest('#idea-sheet')) updatePath(); });

document.addEventListener('submit', async (e) => {
  if (e.target.id === 'idea-capture') {
    e.preventDefault();
    const title = $('#idea-title').value.trim();
    if (!title) return $('#idea-title').focus();
    const r = await ipost('/api/ideas', { title, note: $('#idea-note').value || undefined, projectId: $('#idea-for').value || undefined, source: 'dashboard' });
    if (r.error) return banner(r.error);
    $('#idea-title').value = ''; $('#idea-note').value = ''; $('#idea-note').hidden = true;
    $('#idea-title').focus();
    return refreshIdeas();
  }
  if (e.target.matches('.iadd')) {
    // "Add an idea" in a project's About tab
    e.preventDefault();
    const input = e.target.querySelector('input');
    if (!input.value.trim()) return input.focus();
    const r = await ipost('/api/ideas', { title: input.value.trim(), projectId: e.target.dataset.iproject, source: 'dashboard' });
    if (r.error) return banner(r.error);
    input.value = '';
    aboutHtml = '';
    refreshIdeas();
    return tick(true);
  }
  if (e.target.id === 'idea-sheet') {
    e.preventDefault();
    const i = sheetFor;
    if (!i) return;
    const f = new FormData(e.target);
    const go = e.target.querySelector('.btn.go');
    go.disabled = true;
    const r = await ipost(`/api/ideas/${enc(i.id)}/start`, { brief: f.get('brief'), folder: f.get('folder') ?? undefined, group: f.get('group') ?? undefined, status: f.get('status') ?? undefined });
    go.disabled = false;
    if (r.error) { const er = $('#idea-sheet .ierr'); er.textContent = r.error; er.hidden = false; return; }
    closeSheet();
    groupsCache = null;
    await refresh();
    await refreshIdeas();
    if (r.projectId && !i.projectId) select(r.projectId, 'about');
  }
});

$('#idea-title').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); $('#idea-note').hidden = false; $('#idea-note').focus(); }
});
$('#idea-note').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); $('#idea-capture').requestSubmit(); }
});
// Esc closes the sheet before app.js's Esc closes the drawer
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#idea-veil').hidden) { e.stopImmediatePropagation(); closeSheet(); }
}, true);

refreshIdeas();
setInterval(refreshIdeas, 5000);
