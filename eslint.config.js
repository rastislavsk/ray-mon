import globals from 'globals';

/** Globály, ktoré shared/ smie použiť navyše k jazyku: rovnaké v prehliadači, Node aj vo Workeri. */
const SHARED_GLOBALS = Object.fromEntries(['Intl', 'URL', 'TextEncoder', 'TextDecoder', 'atob', 'btoa'].map((g) => [g, 'readonly']));

/**
 * Moduly vo web/, ktoré smie importovať aj nová appka (obloha/): nesiahajú na DOM ani stav súčasnej
 * appky. Rovnaký zoznam je v CLAUDE.md. Všetko ostatné vo web/ (state.js, dom.js, render/, …)
 * a app.js patrí súčasnej appke - novému modulu stačí dopísať sa sem, keď je naozaj neutrálny.
 */
const NEUTRAL_WEB = [
    'store',
    'storage',
    'data',
    'refresh',
    'day-pager',
    'nav-history',
    'setup-wiring',
    'settings-store',
    'svg',
    'qr',
    'day-chart',
    'teraz-gestures',
];

/**
 * Zákaz importu súčasnej appky z novej. Cesta je relatívna, takže koreň repozitára je z každej
 * hĺbky obloha/ o iný počet `../` - preto jeden blok na hĺbku.
 */
const oblohaLayers = [1, 2, 3].map((depth) => ({
    files: [`obloha/${'*/'.repeat(depth - 1)}*.js`],
    rules: {
        'no-restricted-imports': [
            'error',
            {
                patterns: [
                    {
                        regex: `^(\.\./){${depth}}(app\.js$|web/(?!(${NEUTRAL_WEB.join('|')})\.js$))`,
                        message:
                            'Nová appka nesmie importovať súčasnú (CLAUDE.md). Čistú časť vytiahni do shared/ alebo do neutrálneho modulu vo web/.',
                    },
                ],
            },
        ],
    },
}));

const rules = {
    complexity: ['error', 12],
    'max-lines-per-function': ['error', { max: 60, skipBlankLines: true, skipComments: true }],
    'max-depth': ['error', 4],
    'max-params': ['error', 5],
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    eqeqeq: ['error', 'always', { null: 'ignore' }],
    'prefer-const': 'error',
    'no-var': 'error',
    'no-undef': 'error',
};

export default [
    { ignores: ['node_modules/**', 'worker/node_modules/**', 'worker/dist/**', 'playwright-report/**', 'test-results/**'] },
    {
        files: ['app.js', 'boot.js', 'web/**/*.js', 'obloha/**/*.js'],
        languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: globals.browser },
        rules,
    },
    ...oblohaLayers,
    {
        // Doména nesmie siahnuť na DOM, sieť ani čas - globály prehliadača a Node tu preto nie sú
        // vôbec, len jazyk a to, čo je rovnaké všade (Intl, URL, kódovanie textu).
        files: ['shared/**/*.js'],
        languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.es2022, ...SHARED_GLOBALS } },
        rules,
    },
    {
        files: ['worker/**/*.js'],
        languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.serviceworker, ...globals.node } },
        rules,
    },
    {
        files: ['test/**/*.js', 'scripts/**/*.js', 'playwright.config.js', 'eslint.config.js'],
        languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
        rules: { ...rules, 'max-lines-per-function': 'off' },
    },
];
