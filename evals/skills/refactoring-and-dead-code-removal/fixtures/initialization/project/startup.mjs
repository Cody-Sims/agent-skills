import './legacy-handler.mjs';
import { handlers } from './registry.mjs';

export const result = handlers.get('legacy')();
