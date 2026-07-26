import { Worker } from 'node:worker_threads';

const WORKER_URL = new URL('./regex-grader-worker.mjs', import.meta.url);

export function gradeRegex({ pattern, flags, text, timeoutMs = 2_000 }) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Regex grading timeout must be positive.');
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_URL, {
      workerData: { pattern, flags, text },
    });
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      finish(() => {
        void worker.terminate();
        reject(new Error(`Regular expression grading timed out after ${timeoutMs}ms.`));
      });
    }, timeoutMs);
    worker.once('message', (message) => {
      finish(() => {
        void worker.terminate();
        if (message.error) reject(new Error(`Invalid regular expression: ${message.error}`));
        else resolve(message.matched);
      });
    });
    worker.once('error', (error) => finish(() => reject(error)));
    worker.once('exit', (code) => {
      if (code !== 0) finish(() => reject(new Error(`Regex grader exited with code ${code}.`)));
    });
  });
}