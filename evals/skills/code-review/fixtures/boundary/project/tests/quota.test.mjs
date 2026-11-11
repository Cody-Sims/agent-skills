import assert from 'node:assert/strict';
import { allowed } from '../src/quota.js';

assert.equal(allowed(1), true);
