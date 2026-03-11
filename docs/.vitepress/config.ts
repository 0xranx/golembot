import { defineConfig } from 'vitepress'

const sidebarEn = [
  {
    text: 'Guide',
    items: [
      { text: 'Getting Started', link: '/guide/getting-started' },
      { text: 'Configuration', link: '/guide/configuration' },
      { text: 'CLI Commands', link: '/guide/cli-commands' },
      { text: 'Docker Deployment', link: '/guide/docker' },
    ],
  },
  {
    text: 'Features',
    items: [
      { text: 'Group Chat', link: '/guide/group-chat' },
      { text: 'Inbox & History Fetch', link: '/guide/inbox' },
      { text: 'Scheduled Tasks', link: '/guide/scheduled-tasks' },
      { text: 'Memory', link: '/guide/memory' },
      { text: 'Embed in Your Product', link: '/guide/embed' },
    ],
  },
  {
    text: 'Engines',
    items: [
      { text: 'Overview', link: '/engines/overview' },
      { text: 'Cursor', link: '/engines/cursor' },
      { text: 'Claude Code', link: '/engines/claude-code' },
      { text: 'OpenCode', link: '/engines/opencode' },
      { text: 'Codex', link: '/engines/codex' },
    ],
  },
  {
    text: 'Channels',
    items: [
      { text: 'Overview', link: '/channels/overview' },
      { text: 'Feishu (Lark)', link: '/channels/feishu' },
      { text: 'DingTalk', link: '/channels/dingtalk' },
      { text: 'WeCom', link: '/channels/wecom' },
      { text: 'Slack', link: '/channels/slack' },
      { text: 'Telegram', link: '/channels/telegram' },
      { text: 'Discord', link: '/channels/discord' },
    ],
  },
  {
    text: 'Skills',
    items: [
      { text: 'Overview', link: '/skills/overview' },
      { text: 'Built-in Skills', link: '/skills/builtin' },
      { text: 'Create a Skill', link: '/skills/create-skill' },
    ],
  },
  {
    text: 'API Reference',
    items: [
      { text: 'createAssistant()', link: '/api/create-assistant' },
      { text: 'StreamEvent', link: '/api/stream-events' },
      { text: 'HTTP API', link: '/api/http-api' },
      { text: 'Channel Adapter', link: '/api/channel-adapter' },
    ],
  },
  {
    text: 'More',
    items: [
      { text: 'FAQ', link: '/faq' },
      { text: 'Architecture', link: '/reference/architecture' },
    ],
  },
  {
    text: 'CLI Field Notes',
    collapsed: true,
    items: [
      { text: 'Overview', link: '/reference/coding-cli-docs' },
      { text: 'Cursor', link: '/reference/coding-cli-cursor' },
      { text: 'Claude Code', link: '/reference/coding-cli-claude-code' },
      { text: 'OpenCode', link: '/reference/coding-cli-opencode' },
      { text: 'Codex', link: '/reference/coding-cli-codex' },
      { text: 'Comparison Matrix', link: '/reference/coding-cli-comparison' },
    ],
  },
]

const sidebarZh = [
  {
    text: '指南',
    items: [
      { text: '快速开始', link: '/zh/guide/getting-started' },
      { text: '配置说明', link: '/zh/guide/configuration' },
      { text: 'CLI 命令', link: '/zh/guide/cli-commands' },
      { text: 'Docker 部署', link: '/zh/guide/docker' },
    ],
  },
  {
    text: '功能',
    items: [
      { text: '群聊', link: '/zh/guide/group-chat' },
      { text: '消息队列与离线追回', link: '/zh/guide/inbox' },
      { text: '定时任务', link: '/zh/guide/scheduled-tasks' },
      { text: '记忆系统', link: '/zh/guide/memory' },
      { text: '嵌入到你的产品', link: '/zh/guide/embed' },
    ],
  },
  {
    text: '引擎',
    items: [
      { text: '概览', link: '/zh/engines/overview' },
      { text: 'Cursor', link: '/zh/engines/cursor' },
      { text: 'Claude Code', link: '/zh/engines/claude-code' },
      { text: 'OpenCode', link: '/zh/engines/opencode' },
      { text: 'Codex', link: '/zh/engines/codex' },
    ],
  },
  {
    text: 'IM 通道',
    items: [
      { text: '概览', link: '/zh/channels/overview' },
      { text: '飞书', link: '/zh/channels/feishu' },
      { text: '钉钉', link: '/zh/channels/dingtalk' },
      { text: '企业微信', link: '/zh/channels/wecom' },
      { text: 'Slack', link: '/zh/channels/slack' },
      { text: 'Telegram', link: '/zh/channels/telegram' },
      { text: 'Discord', link: '/zh/channels/discord' },
    ],
  },
  {
    text: 'Skill 技能',
    items: [
      { text: '概览', link: '/zh/skills/overview' },
      { text: '内置技能', link: '/zh/skills/builtin' },
      { text: '创建技能', link: '/zh/skills/create-skill' },
    ],
  },
  {
    text: 'API 参考',
    items: [
      { text: 'createAssistant()', link: '/zh/api/create-assistant' },
      { text: 'StreamEvent', link: '/zh/api/stream-events' },
      { text: 'HTTP API', link: '/zh/api/http-api' },
      { text: 'Channel Adapter', link: '/zh/api/channel-adapter' },
    ],
  },
  {
    text: '更多',
    items: [
      { text: 'FAQ', link: '/zh/faq' },
      { text: '架构设计', link: '/reference/architecture' },
    ],
  },
  {
    text: 'CLI 字段笔记',
    collapsed: true,
    items: [
      { text: '概览', link: '/reference/coding-cli-docs' },
      { text: 'Cursor', link: '/reference/coding-cli-cursor' },
      { text: 'Claude Code', link: '/reference/coding-cli-claude-code' },
      { text: 'OpenCode', link: '/reference/coding-cli-opencode' },
      { text: 'Codex', link: '/reference/coding-cli-codex' },
      { text: '对比矩阵', link: '/reference/coding-cli-comparison' },
    ],
  },
]

export default defineConfig({
  title: 'GolemBot',
  description: 'Run your Coding Agent everywhere — IM, HTTP, or embedded in your product.',
  base: '/golembot/',
  sitemap: { hostname: 'https://0xranx.github.io/golembot/' },

  head: [
    ['link', { rel: 'icon', href: '/golembot/logo-icon-dark.svg' }],
    // Open Graph
    ['meta', { property: 'og:title', content: 'GolemBot' }],
    ['meta', { property: 'og:description', content: 'Run your Coding Agent everywhere — IM, HTTP, or embedded in your product.' }],
    ['meta', { property: 'og:image', content: 'https://0xranx.github.io/golembot/og-image.png' }],
    ['meta', { property: 'og:url', content: 'https://0xranx.github.io/golembot/' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:locale', content: 'en_US' }],
    ['meta', { property: 'og:locale:alternate', content: 'zh_CN' }],
    // Twitter Card
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: 'GolemBot' }],
    ['meta', { name: 'twitter:description', content: 'Run your Coding Agent everywhere — IM, HTTP, or embedded in your product.' }],
    ['meta', { name: 'twitter:image', content: 'https://0xranx.github.io/golembot/og-image.png' }],
    // SEO
    ['meta', { name: 'theme-color', content: '#4FC3F7' }],
    ['link', { rel: 'alternate', hreflang: 'en', href: 'https://0xranx.github.io/golembot/' }],
    ['link', { rel: 'alternate', hreflang: 'zh-CN', href: 'https://0xranx.github.io/golembot/zh/' }],
  ],

  locales: {
    root: {
      label: 'English',
      lang: 'en',
    },
    zh: {
      label: '简体中文',
      lang: 'zh-CN',
      description: '让你的 Coding Agent 随处运行 — IM、HTTP 或嵌入到你的产品中。',
      themeConfig: {
        nav: [
          { text: '文档', link: '/zh/guide/getting-started' },
          { text: 'API', link: '/zh/api/create-assistant' },
          { text: 'FAQ', link: '/zh/faq' },
        ],
        sidebar: sidebarZh,
        editLink: {
          pattern: 'https://github.com/0xranx/golembot/edit/main/docs/:path',
          text: '在 GitHub 上编辑此页',
        },
        footer: {
          message: '基于 <a href="https://github.com/0xranx/golembot/blob/main/LICENSE">MIT 协议</a> 发布。',
          copyright: 'Coding Agent = 灵魂，GolemBot = 泥土之躯。',
        },
        docFooter: { prev: '上一页', next: '下一页' },
        outline: { label: '页面导航' },
        lastUpdated: { text: '最后更新于' },
        returnToTopLabel: '回到顶部',
        sidebarMenuLabel: '菜单',
        darkModeSwitchLabel: '主题',
      },
    },
  },

  themeConfig: {
    logo: {
      light: '/logo-icon-light.svg',
      dark: '/logo-icon-dark.svg',
    },

    nav: [
      { text: 'Docs', link: '/guide/getting-started' },
      { text: 'API', link: '/api/create-assistant' },
      { text: 'FAQ', link: '/faq' },
    ],

    sidebar: sidebarEn,

    socialLinks: [
      { icon: 'github', link: 'https://github.com/0xranx/golembot' },
      { icon: 'discord', link: 'https://discord.gg/tgU5FXChgM' },
      { icon: 'npm', link: 'https://www.npmjs.com/package/golembot' },
    ],

    editLink: {
      pattern: 'https://github.com/0xranx/golembot/edit/main/docs/:path',
    },

    footer: {
      message: 'Released under the <a href="https://github.com/0xranx/golembot/blob/main/LICENSE">MIT License</a>.',
      copyright: 'Coding Agent = soul, GolemBot = body of clay.',
    },

    search: {
      provider: 'local',
    },
  },
})
