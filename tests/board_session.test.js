import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickSeats, pickChallenger, parsePacket, slugify } from '../utils/board_session.js';

test('code directives seat coder + architect', () => {
  const seats = pickSeats('Implement the TypeScript API and deploy the MVP');
  assert.ok(seats.includes('coder'));
  assert.ok(seats.includes('architect'));
  assert.equal(seats.length, 3);
});

test('security directive challenges with security', () => {
  const seats = pickSeats('Harden auth and stop XSS');
  assert.equal(pickChallenger(seats, 'Harden auth and stop XSS'), 'security');
});

test('parsePacket reads JSON blob', () => {
  const p = parsePacket('here\n{"decision":"Ship it","goal":"MVP","plan":["a"],"risks":[],"actions":[{"owner":"coder","action":"PR"}],"files":[],"dissent":"none"}');
  assert.equal(p.decision, 'Ship it');
  assert.equal(p.actions[0].owner, 'coder');
});

test('slugify trims', () => {
  assert.equal(slugify('Hello, Board!!!'), 'hello-board');
});
