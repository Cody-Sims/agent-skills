import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';

import { validate } from '../scripts/validate-skills.mjs';
import { makeTempDir, removeDir, writeSkill, validFrontmatter } from './helpers.mjs';

function rules(diagnostics) {
  return new Set(diagnostics.items.map((d) => d.rule));
}

function withSkillsRoot(fn, options) {
  const root = makeTempDir('skills-');
  try {
    return fn(root, options);
  } finally {
    removeDir(root);
  }
}

test('a well-formed skill produces no errors', () => {
  withSkillsRoot((root) => {
    writeSkill(root, 'good-skill', {
      frontmatter: validFrontmatter('good-skill'),
      body: '# Good Skill\n\nDoes the thing.\n',
    });
    const diagnostics = validate({ skillsRoot: root });
    assert.equal(diagnostics.hasErrors(), false, JSON.stringify(diagnostics.items));
  });
});

test('name must match the directory name', () => {
  withSkillsRoot((root) => {
    writeSkill(root, 'dir-name', { frontmatter: validFrontmatter('other-name') });
    const diagnostics = validate({ skillsRoot: root });
    assert.ok(rules(diagnostics).has('frontmatter/name-directory-match'));
  });
});

test('missing name and description are reported', () => {
  withSkillsRoot((root) => {
    writeSkill(root, 'empty-fm', { frontmatter: 'license: MIT' });
    const diagnostics = validate({ skillsRoot: root });
    const r = rules(diagnostics);
    assert.ok(r.has('frontmatter/name-required'));
    assert.ok(r.has('frontmatter/description-required'));
  });
});

test('invalid name pattern is rejected', () => {
  withSkillsRoot((root) => {
    // Directory has uppercase so name can match it while still being invalid.
    writeSkill(root, 'Bad_Name', { frontmatter: 'name: Bad_Name\ndescription: A thing that does stuff. Use when needed for testing purposes here.' });
    const diagnostics = validate({ skillsRoot: root });
    assert.ok(rules(diagnostics).has('frontmatter/name-pattern'));
  });
});

test('reserved words in name are rejected', () => {
  withSkillsRoot((root) => {
    writeSkill(root, 'my-claude', { frontmatter: 'name: my-claude\ndescription: A thing that does stuff. Use when needed for testing purposes here.' });
    const diagnostics = validate({ skillsRoot: root });
    assert.ok(rules(diagnostics).has('frontmatter/name-reserved'));
  });
});

test('angle brackets in description are rejected', () => {
  withSkillsRoot((root) => {
    writeSkill(root, 'angle', { frontmatter: 'name: angle\ndescription: Uses <html> tags in the description which is not allowed. Use when testing.' });
    const diagnostics = validate({ skillsRoot: root });
    assert.ok(rules(diagnostics).has('frontmatter/description-angle-brackets'));
  });
});

test('non-string metadata values and bad semver are rejected', () => {
  withSkillsRoot((root) => {
    writeSkill(root, 'meta', {
      frontmatter: 'name: meta\ndescription: A thing that does stuff. Use when needed for testing purposes here.\nmetadata:\n  version: "1.0"\n  count: 5',
    });
    const diagnostics = validate({ skillsRoot: root });
    const r = rules(diagnostics);
    assert.ok(r.has('frontmatter/metadata-value-type'));
    assert.ok(r.has('frontmatter/metadata-version-semver'));
  });
});

test('unknown top-level keys are rejected', () => {
  withSkillsRoot((root) => {
    writeSkill(root, 'unknown', { frontmatter: `${validFrontmatter('unknown')}\nbogus: value` });
    const diagnostics = validate({ skillsRoot: root });
    assert.ok(rules(diagnostics).has('frontmatter/unknown-key'));
  });
});

test('portable profile rejects host-specific keys', () => {
  withSkillsRoot((root) => {
    writeSkill(root, 'hosty', { frontmatter: `${validFrontmatter('hosty')}\nuser-invocable: true` });
    const repo = validate({ skillsRoot: root, profile: 'repository' });
    assert.ok(!rules(repo).has('frontmatter/unknown-key'));
    const portable = validate({ skillsRoot: root, profile: 'portable' });
    assert.ok(rules(portable).has('frontmatter/unknown-key'));
  });
});

test('missing frontmatter delimiters are reported', () => {
  withSkillsRoot((root) => {
    const dir = writeSkill(root, 'nofm', { frontmatter: 'name: nofm\ndescription: x' });
    // Overwrite SKILL.md with content lacking frontmatter.
    writeFileSync(`${dir}/SKILL.md`, '# Just markdown, no frontmatter\n');
    const diagnostics = validate({ skillsRoot: root });
    assert.ok(rules(diagnostics).has('frontmatter/missing'));
  });
});

test('broken and escaping links are reported', () => {
  withSkillsRoot((root) => {
    writeSkill(root, 'links', {
      frontmatter: validFrontmatter('links'),
      body: [
        '# Links',
        '',
        'See [missing](references/missing.md).',
        'See [escape](../../../etc/passwd).',
        'See [absolute](/etc/passwd).',
        'See [ok](https://example.com).',
      ].join('\n'),
    });
    const diagnostics = validate({ skillsRoot: root });
    const r = rules(diagnostics);
    assert.ok(r.has('links/broken'));
    assert.ok(r.has('links/escapes-skill-dir'));
    assert.ok(r.has('path/absolute'));
  });
});

test('a resolvable link to an existing file passes', () => {
  withSkillsRoot((root) => {
    writeSkill(root, 'goodlinks', {
      frontmatter: validFrontmatter('goodlinks'),
      body: '# Links\n\nSee [ref](references/guide.md).\n',
      files: { 'references/guide.md': '# Guide\n' },
    });
    const diagnostics = validate({ skillsRoot: root });
    assert.equal(rules(diagnostics).has('links/broken'), false);
  });
});

test('duplicate skill names are reported', () => {
  withSkillsRoot((root) => {
    writeSkill(root, 'one', { frontmatter: 'name: shared\ndescription: A thing that does stuff. Use when needed for testing purposes here.' });
    writeSkill(root, 'two', { frontmatter: 'name: shared\ndescription: A thing that does stuff. Use when needed for testing purposes here.' });
    const diagnostics = validate({ skillsRoot: root });
    assert.ok(rules(diagnostics).has('skill/duplicate-name'));
  });
});

test('unsafe Unicode anywhere in the tree is reported', () => {
  withSkillsRoot((root) => {
    writeSkill(root, 'unicode', {
      frontmatter: validFrontmatter('unicode'),
      files: { 'references/note.md': `contains a zero width space\u200bhere\n` },
    });
    const diagnostics = validate({ skillsRoot: root });
    assert.ok(rules(diagnostics).has('unicode/unsafe'));
  });
});

test('missing license produces a warning, not an error', () => {
  withSkillsRoot((root) => {
    writeSkill(root, 'nolicense', {
      frontmatter: 'name: nolicense\ndescription: A thing that does stuff well. Use when needed for testing purposes here.',
    });
    const diagnostics = validate({ skillsRoot: root });
    assert.equal(diagnostics.hasErrors(), false);
    assert.ok(rules(diagnostics).has('license/missing'));
  });
});

test('empty skills root is handled gracefully', () => {
  withSkillsRoot((root) => {
    const diagnostics = validate({ skillsRoot: root });
    assert.equal(diagnostics.hasErrors(), false);
    assert.equal(diagnostics.items.length, 0);
  });
});
