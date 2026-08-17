import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // P1 — simulace nezná renderer
    files: ['src/sim/**/*.ts', 'src/save/**/*.ts', 'src/content/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['pixi.js', 'pixi.js/*'], message: 'P1: sim/save/content nesmí znát renderer.' },
          { group: ['electron', 'electron/*'], message: 'P1: platformní kód sem nepatří.' },
          { group: ['**/render/**', '**/ui/**', '**/platform/**'], message: 'P1: porušení směru závislostí.' },
        ],
      }],
      'no-restricted-globals': ['error',
        { name: 'window', message: 'P1: žádné DOM API v simulaci.' },
        { name: 'document', message: 'P1: žádné DOM API v simulaci.' },
        { name: 'localStorage', message: 'P1: žádné DOM API v simulaci.' },
      ],
    },
  },
  {
    // P2 — determinismus
    files: ['src/sim/**/*.ts'],
    rules: {
      'no-restricted-properties': ['error',
        { object: 'Math', property: 'random', message: 'P2: použij world.rng.next().' },
        { object: 'Date', property: 'now', message: 'P2: čas je world.tick.' },
        { object: 'performance', property: 'now', message: 'P2: čas je world.tick.' },
      ],
      'no-restricted-syntax': ['error',
        { selector: 'NewExpression[callee.name="Date"]', message: 'P2: čas je world.tick.' },
      ],
    },
  },
);
