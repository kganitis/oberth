import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addIdea, addNote, briefOf, cleanIdea, cleanNote, deleteIdea, dropIdea, editIdea, FOLDER, linksOf, loadIdeas, markStarted, restoreIdea, sessionOf, slugOf, viewIdeas, type Idea } from '../service/ideas.ts';

const dir = () => mkdtempSync(join(tmpdir(), 'ideas-'));

test('cleanIdea and cleanNote: trimmed, within limits, a known source', () => {
  assert.deepEqual(cleanIdea({ title: '  Recipe scaler ', source: 'cli' }), { title: 'Recipe scaler', note: undefined, projectId: undefined, source: 'cli', sessionId: undefined });
  assert.equal(cleanIdea({ title: 'x', source: 'carrier pigeon' }).source, 'dashboard');
  assert.equal(cleanIdea({ title: 'x', sessionId: '../etc' }).sessionId, undefined);
  assert.throws(() => cleanIdea({ title: '   ' }), /title is missing/);
  assert.throws(() => cleanIdea({ title: 'x'.repeat(121) }), /longer than 120/);
  assert.throws(() => cleanNote({ text: '' }), /note is missing/);
});

test('ideas are stored, noted, moved, dropped, restored, started and deleted', () => {
  const d = dir();
  const a = addIdea(d, { title: 'Recipe scaler', source: 'cli' }, 1000);
  assert.match(a.id, /^i[0-9a-z]{3}$/);
  assert.deepEqual(a.notes, []);
  const b = addIdea(d, { title: 'Steam import', note: 'via the Web API', projectId: 'reading-log', source: 'mcp', sessionId: 'local_1' }, 2000);
  assert.equal(b.notes[0].sessionId, 'local_1');
  assert.equal(sessionOf(b), 'local_1');

  // the same open title for the same project adds the note instead of a twin
  const again = addIdea(d, { title: 'recipe SCALER', note: 'by servings', source: 'dashboard' }, 3000);
  assert.equal(again.id, a.id);
  assert.equal(loadIdeas(d).length, 2);
  assert.equal(addNote(d, a.id, { text: 'and units', source: 'cli' }, 4000)!.notes.length, 2);

  assert.equal(editIdea(d, a.id, { projectId: 'tune-picker' }, 5000)!.projectId, 'tune-picker');
  assert.equal(editIdea(d, a.id, { projectId: null, title: 'Scaler' }, 6000)!.projectId, undefined);
  assert.equal(dropIdea(d, a.id, 7000)!.state, 'dropped');
  assert.equal(restoreIdea(d, a.id, 8000)!.state, 'open');
  assert.deepEqual(markStarted(d, b.id, 'reading-log', true, 9000)!.started, { at: 9000, projectId: 'reading-log', claude: true });
  assert.equal(deleteIdea(d, a.id), true);
  assert.equal(deleteIdea(d, a.id), false);
  assert.deepEqual(loadIdeas(d).map((i) => i.id), [b.id]);
  assert.equal(addNote(d, 'nope', { text: 'x', source: 'cli' }), undefined);
});

const idea = (extra: Partial<Idea>): Idea => ({ id: 'i000', title: 'T', notes: [], state: 'open', createdAt: 0, updatedAt: 0, ...extra });

test('linksOf: the links in the notes, without trailing punctuation or repeats', () => {
  const i = idea({ notes: [{ at: 0, text: 'see https://a.com/x, and (https://b.org/y).', source: 'cli' }, { at: 1, text: 'again https://a.com/x', source: 'cli' }] });
  assert.deepEqual(linksOf(i), ['https://a.com/x', 'https://b.org/y']);
});

test('briefOf: the title, the pitch, the other notes as a list, and a first step', () => {
  const i = idea({ title: 'Rules explainer', notes: [{ at: 0, text: 'Paste a rulebook.', source: 'cli' }, { at: 1, text: 'needs OCR\nfor scans', source: 'cli' }] });
  assert.equal(briefOf(i), 'Rules explainer\n\nPaste a rulebook.\n\nNotes so far:\n- needs OCR for scans\n\nStart by proposing a stack and a first version small enough to try this week.');
  assert.match(briefOf(i, 'Tune Picker'), /^Idea for Tune Picker: Rules explainer[\s\S]*in this codebase/);
  assert.ok(briefOf(idea({ notes: [{ at: 0, text: 'x'.repeat(9000), source: 'cli' }] })).length <= 8000);
});

test('slugOf: a valid folder name from any title', () => {
  assert.equal(slugOf('Board game rules — explainer!'), 'board-game-rules-explainer');
  assert.equal(slugOf('Café Ωmega'), 'cafe-mega');
  assert.equal(slugOf('???'), 'new-project');
  assert.ok(FOLDER.test(slugOf('A very long title that goes on and on well past forty one characters')));
});

test('viewIdeas: open by newest activity, split by project; Done for 30 days; Dropped', () => {
  const now = 100 * 86_400_000;
  const all = [
    idea({ id: 'a', updatedAt: 1 }), idea({ id: 'b', updatedAt: 5, projectId: 'p' }), idea({ id: 'c', updatedAt: 3 }),
    idea({ id: 'd', state: 'started', started: { at: now - 86_400_000, projectId: 'p', claude: true } }),
    idea({ id: 'e', state: 'started', started: { at: now - 40 * 86_400_000, projectId: 'p', claude: true } }),
    idea({ id: 'f', state: 'dropped', droppedAt: 2 }),
  ];
  const v = viewIdeas(all, now);
  assert.deepEqual([v.newProjects, v.forProjects, v.done, v.dropped].map((xs) => xs.map((i) => i.id)), [['c', 'a'], ['b'], ['d'], ['f']]);
  assert.deepEqual(viewIdeas([idea({ id: 'x', updatedAt: 7 }), idea({ id: 'y', updatedAt: 7 })], now).newProjects.map((i) => i.id), ['y', 'x'], 'a tie goes to the later one');
});
