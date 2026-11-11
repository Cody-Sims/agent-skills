if (process.argv.includes('--left') && process.argv.includes('--right')) {
  console.error('TARGET_PAIR_FAILURE: flags interact');
  process.exitCode = 1;
} else {
  console.log('target check passed');
}
