import { existsSync, readFileSync, statSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import { validateAgainstSchema } from './jsonschema.mjs';
import { validateEvaluationResult, validateEvaluationSuite } from './evaluations.mjs';
import { assertNoSymlinks, sha256, sha256Tree } from './paths.mjs';

export function validateContributionEvidence(schema, manifest, { artifactRoot, resultSchema, suiteSchema } = {}) {
  const errors = validateAgainstSchema(schema, manifest);
  if (manifest.expertiseSources?.length === 0) {
    errors.push('$.expertiseSources: at least one real expertise source is required.');
  }
  const hasComparison = manifest.comparison !== null && manifest.comparison !== undefined;
  const hasException = manifest.exception !== null && manifest.exception !== undefined;
  if (hasComparison === hasException) {
    errors.push('$: provide exactly one baseline comparison or safety/compliance exception.');
  }
  if (!artifactRoot) {
    errors.push('$: artifact root is required to validate committed evidence sources.');
    return errors;
  }
  for (const [index, source] of (manifest.expertiseSources ?? []).entries()) {
    if (source.reference.startsWith('/') || /^https?:\/\//i.test(source.reference)) {
      errors.push(`$.expertiseSources[${index}].reference: expertise reference must be a committed relative path.`);
      continue;
    }
    try {
      const sourcePath = assertNoSymlinks(artifactRoot, source.reference);
      if (!existsSync(sourcePath)) {
        errors.push(`$.expertiseSources[${index}].reference: expertise source does not exist.`);
      } else if (!statSync(sourcePath).isFile()) {
        errors.push(`$.expertiseSources[${index}].reference: expertise source must be a regular file.`);
      }
    } catch (error) {
      errors.push(`$.expertiseSources[${index}].reference: ${error.message}`);
    }
  }
  if (hasComparison
      && Number.isFinite(manifest.comparison.baselinePassRate)
      && Number.isFinite(manifest.comparison.candidatePassRate)
      && manifest.comparison.candidatePassRate <= manifest.comparison.baselinePassRate) {
    errors.push('$.comparison.candidatePassRate: candidate pass rate must exceed baseline pass rate.');
  }
  if (hasComparison) {
    if (!resultSchema || !suiteSchema) {
      errors.push('$.comparison.artifact: result and suite schemas are required for validation.');
      return errors;
    }
    if (manifest.comparison.artifact.startsWith('/')) {
      errors.push('$.comparison.artifact: artifact path must be relative.');
      return errors;
    }
    let artifactPath;
    try {
      artifactPath = assertNoSymlinks(artifactRoot, manifest.comparison.artifact);
    } catch (error) {
      errors.push(`$.comparison.artifact: ${error.message}`);
      return errors;
    }
    if (!existsSync(artifactPath)) {
      errors.push(`$.comparison.artifact: artifact does not exist: ${manifest.comparison.artifact}.`);
      return errors;
    }
    let artifact;
    try {
      artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
    } catch (error) {
      errors.push(`$.comparison.artifact: invalid result JSON (${error.message}).`);
      return errors;
    }
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
      errors.push('$.comparison.artifact: artifact must be a JSON object.');
      return errors;
    }
    const resultErrors = validateEvaluationResult(resultSchema, artifact);
    for (const error of resultErrors) {
      errors.push(`$.comparison.artifact: ${error}`);
    }
    if (resultErrors.length > 0) return errors;
    if (artifact.skill !== manifest.skill) {
      errors.push('$.comparison.artifact: result skill does not match manifest skill.');
    }
    let suite;
    try {
      const suitePath = assertNoSymlinks(artifactRoot, manifest.comparison.suite);
      if (!existsSync(suitePath)) {
        errors.push('$.comparison.suite: suite does not exist.');
      } else {
        suite = JSON.parse(readFileSync(suitePath, 'utf8'));
      }
    } catch (error) {
      errors.push(`$.comparison.suite: invalid suite (${error.message}).`);
    }
    if (suite === null || (suite !== undefined && (typeof suite !== 'object' || Array.isArray(suite)))) {
      errors.push('$.comparison.suite: suite must be a JSON object.');
    } else if (suite) {
      for (const error of validateEvaluationSuite(suiteSchema, suite)) {
        errors.push(`$.comparison.suite: ${error}`);
      }
      if (suite.skill !== manifest.skill) {
        errors.push('$.comparison.suite: suite skill does not match manifest skill.');
      }
      if (artifact.suite !== suite.name) errors.push('$.comparison.artifact: suite name does not match committed suite.');
      if (artifact.suiteSha256 !== sha256(JSON.stringify(suite))) {
        errors.push('$.comparison.artifact: suite hash does not match committed suite.');
      }
      const expectedCases = Array.isArray(suite.cases)
        ? suite.cases.map((entry) => ({
          id: entry.id,
          promptSha256: sha256(entry.prompt),
          assertions: entry.assertions.map(({ id, type }) => ({ id, type })),
          humanReview: entry.humanReview.map(({ id, question }) => ({ id, question })),
        }))
        : null;
      const artifactCases = (artifact.cases ?? []).map((entry) => ({
        id: entry.id,
        promptSha256: entry.promptSha256,
        baselineAssertions: entry.baseline.assertions.map(({ id, type }) => ({ id, type })),
        candidateAssertions: entry.candidate.assertions.map(({ id, type }) => ({ id, type })),
        humanReview: entry.humanReview.map(({ id, question }) => ({ id, question })),
      }));
      const casesMatch = expectedCases !== null
        && artifactCases.length === expectedCases.length
        && artifactCases.every((entry, index) => (
          entry.id === expectedCases[index].id
          && entry.promptSha256 === expectedCases[index].promptSha256
          && isDeepStrictEqual(entry.baselineAssertions, expectedCases[index].assertions)
          && isDeepStrictEqual(entry.candidateAssertions, expectedCases[index].assertions)
          && isDeepStrictEqual(entry.humanReview, expectedCases[index].humanReview)
        ));
      if (!casesMatch) errors.push('$.comparison.artifact: cases do not match committed suite.');
    }
    try {
      const skillRoot = assertNoSymlinks(artifactRoot, `skills/${manifest.skill}`);
      const skillPath = assertNoSymlinks(skillRoot, 'SKILL.md');
      if (!existsSync(skillPath)) {
        errors.push('$.comparison.artifact: candidate skill file does not exist.');
      } else if (artifact.skillSha256 !== sha256Tree(skillRoot)) {
        errors.push('$.comparison.artifact: skill hash does not match candidate skill content.');
      }
    } catch (error) {
      errors.push(`$.comparison.artifact: invalid candidate skill path (${error.message}).`);
    }
    if (artifact.summary?.baseline?.passRate !== manifest.comparison.baselinePassRate) {
      errors.push('$.comparison.baselinePassRate: value does not match artifact.');
    }
    if (artifact.summary?.candidate?.passRate !== manifest.comparison.candidatePassRate) {
      errors.push('$.comparison.candidatePassRate: value does not match artifact.');
    }
    const humanReviews = (artifact.cases ?? []).flatMap((entry) => entry.humanReview);
    if (humanReviews.some((review) => review.status === 'pending')) {
      errors.push('$.comparison.artifact: result contains pending human review.');
    }
    if (humanReviews.some((review) => review.status === 'fail')) {
      errors.push('$.comparison.artifact: every human review must pass.');
    }
  }
  return errors;
}