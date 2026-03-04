## [0.8.5](https://github.com/0xranx/golembot/compare/v0.8.4...v0.8.5) (2026-03-04)


### Bug Fixes

* inject Codex skills to .agents/skills/ via symlinks ([fe8b834](https://github.com/0xranx/golembot/commit/fe8b834e8c9311f45349cc370a4e5b264f59270a))

## [0.8.4](https://github.com/0xranx/golembot/compare/v0.8.3...v0.8.4) (2026-03-04)


### Bug Fixes

* add typing indicator, maxMessageLength, senderName to adapters ([209051b](https://github.com/0xranx/golembot/commit/209051bfb540e5099d3867b903268d89fdd84963))

## [0.8.3](https://github.com/0xranx/golembot/compare/v0.8.2...v0.8.3) (2026-03-04)


### Bug Fixes

* forward all Feishu group messages to gateway for smart/always mode ([43d3917](https://github.com/0xranx/golembot/commit/43d391794320ccaf90e1408953228bc36e3fbe2e))

## [0.8.2](https://github.com/0xranx/golembot/compare/v0.8.1...v0.8.2) (2026-03-03)


### Bug Fixes

* set mentioned=true in Slack/Feishu/DingTalk group adapters ([ee04abd](https://github.com/0xranx/golembot/commit/ee04abd69a570ef1f03cbfae8c581bd7abd3d79f))

## [0.8.1](https://github.com/0xranx/golembot/compare/v0.8.0...v0.8.1) (2026-03-03)


### Bug Fixes

* Telegram group [@mention](https://github.com/mention), typing indicator, cross-engine session isolation ([2e3fbf0](https://github.com/0xranx/golembot/commit/2e3fbf00dd626582d40e5cd3da79b2591b8dc833))

# [0.8.0](https://github.com/0xranx/golembot/compare/v0.7.1...v0.8.0) (2026-03-03)


### Features

* add Slack, Telegram, Discord to onboard wizard channel selection ([37047c0](https://github.com/0xranx/golembot/commit/37047c0014b72f326dcb0111d1b63af0e4a64d60))

## [0.7.1](https://github.com/0xranx/golembot/compare/v0.7.0...v0.7.1) (2026-03-03)


### Bug Fixes

* Discord mention detection works without botName configured ([1d8188e](https://github.com/0xranx/golembot/commit/1d8188ef60a325d8894b8ee0ee947901b2942f06))

# [0.7.0-beta.2](https://github.com/0xranx/golembot/compare/v0.7.0-beta.1...v0.7.0-beta.2) (2026-03-03)


### Bug Fixes

* Discord mention detection works without botName configured ([1d8188e](https://github.com/0xranx/golembot/commit/1d8188ef60a325d8894b8ee0ee947901b2942f06))

# [0.7.0-beta.1](https://github.com/0xranx/golembot/compare/v0.6.1-beta.1...v0.7.0-beta.1) (2026-03-03)


### Features

* add Discord channel adapter and fix /reset group state cleanup ([7b30b89](https://github.com/0xranx/golembot/commit/7b30b895f91722c7609908ab26a909d6e83e97f9))

## [0.6.1](https://github.com/0xranx/golembot/compare/v0.6.0...v0.6.1) (2026-03-03)


### Bug Fixes

* reset groupTurnCounter after 1 hour of group inactivity ([7f8cb15](https://github.com/0xranx/golembot/commit/7f8cb1532d8d43774c3e611d9d5f977dd2d4e51d))

# [0.6.0](https://github.com/0xranx/golembot/compare/v0.5.0...v0.6.0) (2026-03-03)


### Bug Fixes

* load groupChat config from golem.yaml + tune multi-bot demo timeout ([6bf1a52](https://github.com/0xranx/golembot/commit/6bf1a52e30e4a50a373e083286e3c64aa76e53f0))
* persist and parse groupChat in writeConfig/loadConfig ([c037f3c](https://github.com/0xranx/golembot/commit/c037f3c5c6dad431ff97a80d2b255b76bbe81bb9))


### Features

* add group chat support with configurable response policy ([445d4c2](https://github.com/0xranx/golembot/commit/445d4c27cacd0203d9433c007573ed8671a06c6a))
* support custom channel adapters via _adapter field in golem.yaml ([0b0ef3d](https://github.com/0xranx/golembot/commit/0b0ef3decb722a6df783b429c4f20e7c0fa162a3))

# [0.5.0](https://github.com/0xranx/golembot/compare/v0.4.0...v0.5.0) (2026-03-02)


### Features

* **channels:** add Slack and Telegram channel adapters ([8aa5de5](https://github.com/0xranx/golembot/commit/8aa5de5d07677e2682635451778a563421d0e53c))

# [0.4.0](https://github.com/0xranx/golembot/compare/v0.3.0...v0.4.0) (2026-03-02)


### Bug Fixes

* **feishu:** fallback to any-mention check when bot open_id is unavailable ([7b101e7](https://github.com/0xranx/golembot/commit/7b101e7d3245e30f51112072db39facbece8f3ae))
* **feishu:** lazy-retry bot open_id fetch on each group message until resolved ([96e202a](https://github.com/0xranx/golembot/commit/96e202aa43db2295bfa64cf45c6bc0c3f3c98605))
* **feishu:** only respond in group chats when [@mentioned](https://github.com/mentioned) ([229adcb](https://github.com/0xranx/golembot/commit/229adcbd7cacefc419629171a62d8fc9fa40d07a))
* **feishu:** use correct SDK path bot.v3.info.get() to fetch bot open_id ([adcd035](https://github.com/0xranx/golembot/commit/adcd035344a6ee813fe7ec6e9054564646673c04))
* **feishu:** use tokenManager + raw fetch for bot open_id, fix mentions source ([d974702](https://github.com/0xranx/golembot/commit/d974702cdca787ce53b09ee1df7cfebc0ba1df1f))


### Features

* inject systemPrompt into AGENTS.md instead of prepending to every message ([a4ecd0a](https://github.com/0xranx/golembot/commit/a4ecd0aabd29fd7221c180cecf4cd3e1b036eb7b))

# [0.4.0-beta.5](https://github.com/0xranx/golembot/compare/v0.4.0-beta.4...v0.4.0-beta.5) (2026-03-02)


### Bug Fixes

* **feishu:** use tokenManager + raw fetch for bot open_id, fix mentions source ([d974702](https://github.com/0xranx/golembot/commit/d974702cdca787ce53b09ee1df7cfebc0ba1df1f))

# [0.4.0-beta.4](https://github.com/0xranx/golembot/compare/v0.4.0-beta.3...v0.4.0-beta.4) (2026-03-02)


### Bug Fixes

* **feishu:** lazy-retry bot open_id fetch on each group message until resolved ([96e202a](https://github.com/0xranx/golembot/commit/96e202aa43db2295bfa64cf45c6bc0c3f3c98605))

# [0.4.0-beta.3](https://github.com/0xranx/golembot/compare/v0.4.0-beta.2...v0.4.0-beta.3) (2026-03-02)


### Bug Fixes

* **feishu:** fallback to any-mention check when bot open_id is unavailable ([7b101e7](https://github.com/0xranx/golembot/commit/7b101e7d3245e30f51112072db39facbece8f3ae))

# [0.4.0-beta.2](https://github.com/0xranx/golembot/compare/v0.4.0-beta.1...v0.4.0-beta.2) (2026-03-02)


### Bug Fixes

* **feishu:** use correct SDK path bot.v3.info.get() to fetch bot open_id ([adcd035](https://github.com/0xranx/golembot/commit/adcd035344a6ee813fe7ec6e9054564646673c04))

# [0.4.0-beta.1](https://github.com/0xranx/golembot/compare/v0.3.0...v0.4.0-beta.1) (2026-03-02)


### Bug Fixes

* **feishu:** only respond in group chats when [@mentioned](https://github.com/mentioned) ([229adcb](https://github.com/0xranx/golembot/commit/229adcbd7cacefc419629171a62d8fc9fa40d07a))


### Features

* inject systemPrompt into AGENTS.md instead of prepending to every message ([a4ecd0a](https://github.com/0xranx/golembot/commit/a4ecd0aabd29fd7221c180cecf4cd3e1b036eb7b))

# [0.3.0](https://github.com/0xranx/golembot/compare/v0.2.3...v0.3.0) (2026-03-02)


### Features

* add systemPrompt field to golem.yaml for hardened persona definition ([df60b5a](https://github.com/0xranx/golembot/commit/df60b5aac34f1b2051ba7d5060f44a13f3cbcff6))

## [0.2.3](https://github.com/0xranx/golembot/compare/v0.2.2...v0.2.3) (2026-03-02)


### Bug Fixes

* **opencode:** register provider models entry in opencode.json to fully resolve ProviderModelNotFoundError ([6d278c4](https://github.com/0xranx/golembot/commit/6d278c4c6ba9c78db5c4da4c4d52e7c9579279b5))

## [0.2.2](https://github.com/0xranx/golembot/compare/v0.2.1...v0.2.2) (2026-03-02)


### Bug Fixes

* **opencode:** register provider block in opencode.json to fix ProviderModelNotFoundError ([c10e01e](https://github.com/0xranx/golembot/commit/c10e01e0f1466bdb75b90da66bd6a271cdefc375))

## [0.2.1](https://github.com/0xranx/golembot/compare/v0.2.0...v0.2.1) (2026-03-02)


### Bug Fixes

* **codex:** map top-level error events to error instead of warning ([e531eb0](https://github.com/0xranx/golembot/commit/e531eb0b7047648fba6fbe9efb0e8e87ba80566c))
