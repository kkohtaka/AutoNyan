import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import { themes as prismThemes } from 'prism-react-renderer';

// Published to GitHub Pages at https://kkohtaka.github.io/AutoNyan/.
// organizationName/projectName and baseUrl must match that URL for asset paths
// and the deploy action to resolve correctly.
const config: Config = {
  title: 'AutoNyan',
  tagline: 'Drop documents into Drive, get them classified automatically',

  url: 'https://kkohtaka.github.io',
  baseUrl: '/AutoNyan/',

  organizationName: 'kkohtaka',
  projectName: 'AutoNyan',

  onBrokenLinks: 'throw',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  // Bilingual site. `en` is the default (served at baseUrl); `ja` is served
  // under /ja/. The locale dropdown in the navbar switches between them.
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'ja'],
    localeConfigs: {
      en: { label: 'English' },
      ja: { label: '日本語' },
    },
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          // Serve docs at the site root so there is a working landing page for
          // the scaffold. Information architecture and a dedicated landing page
          // are designed in issue #339.
          routeBasePath: '/',
          editUrl: 'https://github.com/kkohtaka/AutoNyan/tree/master/docs/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    navbar: {
      title: 'AutoNyan',
      items: [
        {
          type: 'localeDropdown',
          position: 'right',
        },
        {
          href: 'https://github.com/kkohtaka/AutoNyan',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Project',
          items: [
            {
              label: 'GitHub repository',
              href: 'https://github.com/kkohtaka/AutoNyan',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} AutoNyan.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
