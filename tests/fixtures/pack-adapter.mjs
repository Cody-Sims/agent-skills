let input = '';
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
const prompt = request.prompt.toLowerCase();

const routes = [
  ['bounded read-only shadow scan|candidate observations still contain unsupported claims', 'shadow-observe'],
  ['candidate observations are ready for future-state exploration|future-state proposal is complete but human approval is still missing', 'shadow-dream'],
  ['human explicitly approved the future-state proposal|approved decision still needs to be recorded and indexed', 'shadow-architecture'],
  ['approved decisions and implementation are updated.*read-only check', 'shadow-drift'],
  ['turn this vague request|implementation-ready specification|acceptance criteria are unclear', 'requirements-and-spec-writing'],
  ['decompose the approved|ordered tasks|dependency-aware implementation tasks', 'planning-and-task-breakdown'],
  ['map the unfamiliar|locate the controlling code path|read-only repository map', 'codebase-exploration'],
  ['failing behavior test|red-green-refactor|test-first', 'test-driven-development'],
  ['review (?:the )?completed (?:release )?patch|review this implementation|actionable correctness findings', 'code-review'],
  ['update the readme|documentation and changelog|release-facing documentation', 'documentation-maintenance'],
  ['fresh evidence|run the final verification|prove the checks pass', 'verification-before-completion'],
  ['behavior-preserving refactor|mechanical refactor|remove proven dead code', 'refactoring-and-dead-code-removal'],
  ['threat model|security vulnerabilities|security review', 'security-review'],
  ['prepare the branch|open the pull request|git workflow', 'git-and-pr-workflow'],
];

let selectedSkills = [];
for (const [pattern, skill] of routes) {
  if (new RegExp(pattern).test(prompt)) {
    selectedSkills = [skill];
    break;
  }
}

process.stdout.write(JSON.stringify({
  selectedSkills,
  inputTokens: Buffer.byteLength(JSON.stringify(request), 'utf8'),
  outputTokens: selectedSkills.length,
}));
