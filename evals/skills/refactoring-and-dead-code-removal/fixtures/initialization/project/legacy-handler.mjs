import { handlers } from './registry.mjs';

class LegacyHandler {
  static {
    handlers.set('legacy', () => 'required result');
  }
}
