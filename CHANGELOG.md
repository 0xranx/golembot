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
