let input = '';
for await (const chunk of process.stdin) input += chunk;

const request = JSON.parse(input);
let selectedSkills = ['requirements-and-spec-writing'];
if (/pull request|staged patch/i.test(request.prompt)) selectedSkills = ['code-review'];
if (/authentication|threat model/i.test(request.prompt)) selectedSkills = ['security-review'];
if (/approved specification|sequence the accepted/i.test(request.prompt)) {
  selectedSkills = ['planning-and-task-breakdown'];
}

process.stdout.write(JSON.stringify({
  selectedSkills,
  inputTokens: 16,
  outputTokens: 2,
}));