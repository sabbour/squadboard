import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  tutorialSidebar: [
    'intro',
    {
      type: 'category',
      label: 'Getting Started',
      link: {type: 'doc', id: 'getting-started/index'},
      items: [
        'getting-started/installation',
        'getting-started/what-is-squadboard',
        'getting-started/quickstart',
        'getting-started/key-concepts',
        'getting-started/learning-path',
        {
          type: 'category',
          label: 'Tutorials',
          link: {type: 'doc', id: 'getting-started/tutorials/index'},
          items: [
            'getting-started/tutorials/connect-spark',
            'getting-started/tutorials/cast-the-team',
            'getting-started/tutorials/run-the-launch-wave',
            'getting-started/tutorials/connect-tools',
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'Product Guide',
      link: {type: 'doc', id: 'features/overview'},
      items: [
        'features/overview',
        {
          type: 'category',
          label: 'Understand Squadboard',
          items: [
            'features/workflow-engine',
            'features/copilot-squad-coexistence',
            'features/board-and-runs',
            'features/ceremonies-and-automation',
            'features/agents-and-workspaces',
            'features/integrations',
          ],
        },
        {
          type: 'category',
          label: 'Operate Squadboard',
          items: [
            'user-guide/electron-app',
            'user-guide/configuration',
            'user-guide/copilot-squad-coexistence',
            'user-guide/coordinator-loops',
            'user-guide/squad-integration',
            'user-guide/storage-provider',
            'user-guide/squad-tools-hooks',
            'user-guide/built-ins',
            'user-guide/squad-apps',
            'user-guide/importing',
            'user-guide/board-and-runs',
            'user-guide/ceremonies-workflows',
            'user-guide/agents-skills',
            'user-guide/mcp',
            'user-guide/github',
            'user-guide/scribe-ralph',
            'user-guide/security',
          ],
        },
        {
          type: 'category',
          label: 'How-to Guides',
          items: [
            'user-guide/how-to/move-card-to-ready',
            'user-guide/how-to/find-why-run-failed',
            'user-guide/how-to/add-squadboard-to-squad-project',
          ],
        },
        {
          type: 'category',
          label: 'App Reference',
          link: {type: 'doc', id: 'app-reference/index'},
          items: [
            'app-reference/project-picker',
            'app-reference/now',
            'app-reference/inbox',
            'app-reference/apps',
            'app-reference/consult',
            'app-reference/dashboard',
            'app-reference/board',
            'app-reference/flow',
            'app-reference/agents',
            'app-reference/skills',
            'app-reference/tools',
            'app-reference/mcp-servers',
            'app-reference/costs',
            'app-reference/ceremonies',
            'app-reference/templates',
            'app-reference/settings',
            'app-reference/diagnostics-heartbeat',
            'app-reference/live-run-viewer',
          ],
        },
        {
          type: 'category',
          label: 'Operations',
          items: [
            'features/reliability-and-ui',
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'Developer Guide',
      link: {type: 'doc', id: 'developer-guide/index'},
      items: [
        'developer-guide/architecture',
        'developer-guide/contributing-docs',
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      link: {type: 'doc', id: 'reference/index'},
      items: [
        'reference/faq',
        'reference/troubleshooting',
      ],
    },
  ],
};

export default sidebars;
