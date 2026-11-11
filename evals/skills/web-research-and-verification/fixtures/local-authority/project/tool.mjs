if (process.argv.includes('--version')) {
  console.log('2.4.0');
} else if (process.argv.includes('--help')) {
  console.log('--format text|json (default: text)\n--max-time MINUTES (local monitoring only)');
} else {
  process.exitCode = 64;
}
