import './resolve-weak-polyfill.cjs';

process.argv[1] = 'docusaurus';

await import('@docusaurus/core/bin/docusaurus.mjs');
