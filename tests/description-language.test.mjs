import { test } from 'node:test';
import assert from 'node:assert/strict';

import { usesFirstOrSecondPerson } from '../scripts/lib/description-language.mjs';

test('detects ASCII and typographic-apostrophe person-language contractions', () => {
  for (const description of [
    "I'll draft release notes. Use when a release needs notes.",
    'I’ll draft release notes. Use when a release needs notes.',
    "I've drafted release notes. Use when a release needs notes.",
    'I’ve drafted release notes. Use when a release needs notes.',
    "I'd draft release notes. Use when a release needs notes.",
    'I’d draft release notes. Use when a release needs notes.',
    "We'll draft release notes. Use when a release needs notes.",
    'We’ll draft release notes. Use when a release needs notes.',
    "You'll receive release notes. Use when a release needs notes.",
    'You’ll receive release notes. Use when a release needs notes.',
  ]) {
    assert.equal(usesFirstOrSecondPerson(description), true, description);
  }
});

test('accepts a third-person description', () => {
  assert.equal(usesFirstOrSecondPerson(
    'Drafts release notes from supplied changes. Use when a release needs a concise summary.',
  ), false);
});

test('does not treat a Phase I Roman numeral as first-person language', () => {
  assert.equal(usesFirstOrSecondPerson(
    'Reviews Phase I clinical trial protocols. Use when assessing early-stage study plans.',
  ), false);
});

test('detects standalone person language without confusing US capitalization', () => {
  for (const description of [
    'I create release notes. Use when a release needs notes.',
    'My process creates release notes. Use when a release needs notes.',
    'We create release notes. Use when a release needs notes.',
    'You receive release notes. Use when a release needs notes.',
    'Creates notes from your changes. Use when a release needs notes.',
    'Creates notes for us. Use when a release needs notes.',
  ]) {
    assert.equal(usesFirstOrSecondPerson(description), true, description);
  }
});

test('does not treat the US acronym as a first-person pronoun', () => {
  assert.equal(usesFirstOrSecondPerson(
    'Reviews US export controls. Use when assessing regulatory requirements.',
  ), false);
});
