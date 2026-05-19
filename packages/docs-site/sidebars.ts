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
        'getting-started/quickstart',
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
