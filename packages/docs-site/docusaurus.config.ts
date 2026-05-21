import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Squadboard (pre-alpha)',
  tagline: 'Pre-alpha local-first workflow board for deterministic multi-agent orchestration.',
  favicon: 'img/squadboard.svg',

  url: 'https://sabbour.me',
  baseUrl: '/squadboard/',

  organizationName: 'sabbour',
  projectName: 'squadboard',
  trailingSlash: false,

  onBrokenLinks: 'throw',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  markdown: {
    format: 'detect',
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  themes: ['@docusaurus/theme-mermaid'],

  staticDirectories: ['static'],

  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          showLastUpdateTime: true,
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/social-card.svg',
    colorMode: {
      defaultMode: 'light',
      disableSwitch: true,
      respectPrefersColorScheme: false,
    },
    navbar: {
      title: 'Squadboard (pre-alpha)',
      logo: {
        alt: 'Squadboard',
        src: 'img/squadboard.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'tutorialSidebar',
          position: 'left',
          label: 'Docs',
        },
        {
          to: '/getting-started/quickstart',
          label: 'Quickstart',
          position: 'left',
        },
        {
          to: '/user-guide/copilot-squad-coexistence',
          label: 'Copilot + Squad',
          position: 'left',
        },
        {
          href: 'https://github.com/sabbour/squadboard',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'light',
      links: [
        {
          title: 'Start',
          items: [
            {label: 'Installation', to: '/getting-started/installation'},
            {label: 'Quickstart', to: '/getting-started/quickstart'},
            {label: 'Learning Path', to: '/getting-started/learning-path'},
          ],
        },
        {
          title: 'Use',
          items: [
            {label: 'Copilot CLI + Squad coexistence', to: '/user-guide/copilot-squad-coexistence'},
            {label: 'Squad Integration', to: '/user-guide/squad-integration'},
            {label: 'MCP Integration', to: '/user-guide/mcp'},
            {label: 'Scribe and Ralph', to: '/user-guide/scribe-ralph'},
          ],
        },
        {
          title: 'Reference',
          items: [
            {label: 'Architecture', to: '/developer-guide/architecture'},
            {label: 'FAQ', to: '/reference/faq'},
          ],
        },
      ],
      copyright: `Copyright ${new Date().getFullYear()} Squadboard contributors.`,
    },
    prism: {
      theme: {
        plain: {
          color: '#24292f',
          backgroundColor: '#f6f8fa',
        },
        styles: [],
      },
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
