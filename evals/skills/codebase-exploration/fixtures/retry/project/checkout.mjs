import { retry } from './retry.mjs';

export async function checkout(submit) {
  return retry(submit, 3);
}
