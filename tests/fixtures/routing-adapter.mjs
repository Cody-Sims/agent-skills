let input = '';
for await (const chunk of process.stdin) input += chunk;

const request = JSON.parse(input);
let selectedSkills = ['requirements-and-spec-writing'];
if (/unfamiliar repository.*entry points|architecture boundaries.*safest change site/i.test(request.prompt)) {
  selectedSkills = ['codebase-exploration'];
}
if (/README, command reference, and changelog|remain accurate after.*CLI change/i.test(request.prompt)) {
  selectedSkills = ['documentation-maintenance'];
}
if (/third-party Agent Skill.*provenance|licensing.*instruction safety/i.test(request.prompt)) {
  selectedSkills = ['external-skill-review'];
}
if (/restructure this module.*dead code|without changing observable behavior/i.test(request.prompt)) {
  selectedSkills = ['refactoring-and-dead-code-removal'];
}
if (/repository-specific agent instructions|commands, conventions, and safety boundaries/i.test(request.prompt)) {
  selectedSkills = ['repository-agent-bootstrap'];
}
if (/evidence-linked decision graph|architecture claims.*code, tests, and commits/i.test(request.prompt)) {
  selectedSkills = ['shadow-architecture'];
}
if (/new Agent Skill.*valid frontmatter|progressive disclosure.*activation prompts/i.test(request.prompt)) {
  selectedSkills = ['skill-creator'];
}
if (/reproduce this failing test|root cause.*exact error output/i.test(request.prompt)) {
  selectedSkills = ['systematic-debugging'];
}
if (/before reporting.*complete|fresh targeted validation.*original symptom/i.test(request.prompt)) {
  selectedSkills = ['verification-before-completion'];
}
if (/current version of this external API|primary documentation.*authoritative URLs/i.test(request.prompt)) {
  selectedSkills = ['web-research-and-verification'];
}
if (/pull request|staged patch/i.test(request.prompt)) selectedSkills = ['code-review'];
if (/rebase this completed feature branch|atomic commit.*pull request/i.test(request.prompt)) {
  selectedSkills = ['git-and-pr-workflow'];
}
if (/authentication|threat model/i.test(request.prompt)) selectedSkills = ['security-review'];
if (/approved specification|sequence the accepted/i.test(request.prompt)) {
  selectedSkills = ['planning-and-task-breakdown'];
}
if (/approved migration|assigned in parallel/i.test(request.prompt)) {
  selectedSkills = ['planning-and-task-breakdown'];
}
if (/separate git worktrees|dependency waves/i.test(request.prompt)) {
  selectedSkills = ['parallel-worktree-delivery'];
}
if (/suspiciously green|production mutation/i.test(request.prompt)) {
  selectedSkills = ['verification-discipline'];
}
if (/feature test-first|failing behavior test/i.test(request.prompt)) {
  selectedSkills = ['test-driven-development'];
}
if (/GitHub-hosted Copilot cloud-agent task|observed session model.*task URL/i.test(request.prompt)) {
  selectedSkills = ['copilot-cloud-agent'];
}

process.stdout.write(JSON.stringify({
  selectedSkills,
  inputTokens: 16,
  outputTokens: 2,
}));