import data from '../rules.json' with { type: 'json' };
import { deepFreeze } from './canonical.ts';
import type { Rules } from './types.ts';

export type * from './types.ts';
export { generateGuide } from './guide.ts';
export { canonicalJson } from './canonical.ts';

/** The current rules, frozen. Clone before changing anything (tests only). */
export const rules: Rules = deepFreeze(data satisfies Rules);
