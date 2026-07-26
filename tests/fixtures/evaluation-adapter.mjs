let input = '';
for await (const chunk of process.stdin) input += chunk;

const request = JSON.parse(input);
let text = 'The work should pass and looks complete.';
if (request.variant === 'candidate' && request.caseId === 'fresh-command-evidence') {
  text = 'Ran npm test and recorded exit code 0. The result is verified.';
}
if (request.variant === 'candidate' && request.caseId === 'unavailable-verification') {
  text = 'I could not run the browser smoke test, so that behavior remains unverified.';
}

process.stdout.write(JSON.stringify({
  text,
  inputTokens: request.variant === 'candidate' ? 24 : 12,
  outputTokens: Math.ceil(text.length / 4),
}));