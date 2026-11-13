import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findHolder, portInUse } from '../service/conflicts.ts';
import type { Project } from '../service/types.ts';

test('portInUse reads the ways dev servers report a taken port', () => {
  assert.equal(portInUse('error when starting dev server:\nError: Port 5180 is already in use\n'), 5180);
  assert.equal(portInUse('Error: listen EADDRINUSE: address already in use :::3000\n'), 3000);
  assert.equal(portInUse('Error: listen EADDRINUSE: address already in use 127.0.0.1:8080\n'), 8080);
  assert.equal(portInUse('Error: listen tcp 127.0.0.1:1313: bind: address already in use\n'), 1313);
  assert.equal(portInUse('OSError: [Errno 48] Address already in use 127.0.0.1:8765'), 8765);
  assert.equal(portInUse('\x1b[31mError: Port \x1b[1m5173\x1b[22m is already in use\x1b[39m'), 5173);
  assert.equal(portInUse('Error: Port 5180 is already in use\nlater: Error: Port 5181 is already in use\n'), 5181); // the last mention wins
  // Vite moving on to the next port by itself is not a conflict, even if the server fails later for another reason
  assert.equal(portInUse('Port 5173 is in use, trying another one...\n  VITE ready\nTypeError: boom\n'), undefined);
  assert.equal(portInUse('\x1b[33mPort 5173 is in use, trying another one...\x1b[39m'), undefined);
  // a port inside an OSC hyperlink (FORCE_COLOR output) still reads
  assert.equal(portInUse('Error: Port \x1b]8;;http://localhost:5182/\x075182\x1b]8;;\x07 is already in use'), 5182);
  assert.equal(portInUse('npm run dev exited with code 1'), undefined);
});

const proj = (id: string, dir: string): Project => ({ id, relPath: id, dir, name: id.toUpperCase(), kind: 'app', starter: { type: 'npm-dev', devScript: 'vite' }, scripts: {}, needsInstall: false });

test('findHolder: launched project, leftover inside a project, something else, nobody', () => {
  const projects = [proj('a', '/Dev/a'), proj('b', '/Dev/b')];
  const ls = [
    { pid: 10, pgid: 10, port: 5180, cwd: '/Dev/a' },
    { pid: 20, pgid: 20, port: 5181, cwd: '/Dev/b/sub' },
    { pid: 30, pgid: 30, port: 5182, cwd: '/', command: 'Docker' },
  ];
  assert.deepEqual(findHolder(5180, ls, projects, new Map([[10, 'a']])), { port: 5180, holder: { kind: 'launched', projectId: 'a', name: 'A', pid: 10 } });
  assert.deepEqual(findHolder(5181, ls, projects, new Map()), { port: 5181, holder: { kind: 'leftover', projectId: 'b', name: 'B', pid: 20 } });
  assert.deepEqual(findHolder(5182, ls, projects, new Map()), { port: 5182, holder: { kind: 'other', pid: 30, command: 'Docker', cwd: '/' } });
  assert.equal(findHolder(9999, ls, projects, new Map()), undefined);
});
