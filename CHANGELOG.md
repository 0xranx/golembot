# [0.25.0](https://github.com/0xranx/golembot/compare/v0.24.2...v0.25.0) (2026-03-11)


### Bug Fixes

* **feishu:** correct fetchHistory timestamp parsing — create_time is already milliseconds ([a42996c](https://github.com/0xranx/golembot/commit/a42996c3373105710cb7be0c4a2fd7959a3c0324))
* **inbox:** preserve mentioned field, fix dedup key to use channelType, and avoid watermark boundary duplicates ([2ef8ad3](https://github.com/0xranx/golembot/commit/2ef8ad3bd2f60b8a804bcda740ee0d6a0c9ca223))
* **slack:** pass explicit token in listChats/fetchHistory and gracefully degrade without groups:read scope ([a579e3d](https://github.com/0xranx/golembot/commit/a579e3d335f17005df3c527e9e6a206995061f98))


### Features

* **gateway:** add [SKIP] sentinel for history-fetch triage — bot can stay silent when no reply needed ([849a7e8](https://github.com/0xranx/golembot/commit/849a7e8de55e031c7866a261681baf2d7e2b7d93))
* **inbox:** add persistent message queue and historical message fetching ([fd1cb39](https://github.com/0xranx/golembot/commit/fd1cb39baf4935f8e3363bdca73f9c94c6896626)), closes [hi#water](https://github.com/hi/issues/water)

## [0.24.2](https://github.com/0xranx/golembot/compare/v0.24.1...v0.24.2) (2026-03-11)


### Bug Fixes

* add missing listHistoryFiles and readHistory exports ([6ce0fee](https://github.com/0xranx/golembot/commit/6ce0fee08bca715a86ef61c764b2f9127675d55a))

## [0.24.1](https://github.com/0xranx/golembot/compare/v0.24.0...v0.24.1) (2026-03-10)


### Bug Fixes

* **slack:** pre-validate auth token before starting Socket Mode ([2e34474](https://github.com/0xranx/golembot/commit/2e3447437d4c7f6be0e5597d56e4638ff240cf48))

# [0.24.0](https://github.com/0xranx/golembot/compare/v0.23.0...v0.24.0) (2026-03-10)


### Features

* **channels:** add quote reply and cross-platform [@mention](https://github.com/mention) support ([5d7168a](https://github.com/0xranx/golembot/commit/5d7168a6762038dfeb42467823d5285df7fcec50))

# [0.23.0](https://github.com/0xranx/golembot/compare/v0.22.0...v0.23.0) (2026-03-10)


### Features

* **cli:** add session count to golembot status ([#7](https://github.com/0xranx/golembot/issues/7)) ([2c149e0](https://github.com/0xranx/golembot/commit/2c149e0f80403f8ad868e4c6e889dadde14bd190))
* **engine:** expose fullText on done StreamEvent ([#6](https://github.com/0xranx/golembot/issues/6)) ([739323c](https://github.com/0xranx/golembot/commit/739323c250d3969adf77761aba5634aae5f16c17))
* **workspace:** add permissions config with .cursor/cli.json generation ([#8](https://github.com/0xranx/golembot/issues/8)) ([b5c59a2](https://github.com/0xranx/golembot/commit/b5c59a2c1e68934f7cf522fc7fe8fd0148650ba3))

# [0.22.0](https://github.com/0xranx/golembot/compare/v0.21.0...v0.22.0) (2026-03-09)


### Features

* add image multimodal message support across all IM channels ([99742c0](https://github.com/0xranx/golembot/commit/99742c0b849f78af4acbec0b5e45eeef7c64e52d))

# [0.21.0](https://github.com/0xranx/golembot/compare/v0.20.0...v0.21.0) (2026-03-09)


### Features

* add scheduled tasks panel to Dashboard with disable/enable/run controls ([39c3d40](https://github.com/0xranx/golembot/commit/39c3d40ffc62fcea24298988e4bb7a76340196e4))

# [0.20.0](https://github.com/0xranx/golembot/compare/v0.19.0...v0.20.0) (2026-03-09)


### Features

* add scheduled task system with cron scheduler and proactive messaging ([0b48e2a](https://github.com/0xranx/golembot/commit/0b48e2abe712f0faccf55d659dcb93fe7bfb6b60))

# [0.19.0](https://github.com/0xranx/golembot/compare/v0.18.1...v0.19.0) (2026-03-09)


### Bug Fixes

* reset model when switching engines and fix patchConfig safety ([5e51c00](https://github.com/0xranx/golembot/commit/5e51c000e21c55a209db28ffc0a7b1962bf98c18))


### Features

* add /model list command with real-time model discovery ([a55a3b7](https://github.com/0xranx/golembot/commit/a55a3b7296ab74894c2d4f962d6d922e4e1562e5))
* add unified slash commands across CLI, HTTP API, and IM gateway ([e6b9a85](https://github.com/0xranx/golembot/commit/e6b9a8528b03c95e0d3b79add9200df943c9e681))

## [0.18.1](https://github.com/0xranx/golembot/compare/v0.18.0...v0.18.1) (2026-03-09)


### Bug Fixes

* CI coverage, dev:gateway script, and engine snapshot tests ([d6fce87](https://github.com/0xranx/golembot/commit/d6fce871ae8ef0cf1d9b6f6278c5ad26b7726432))
* skip registry install test without GITHUB_TOKEN ([9cd7f10](https://github.com/0xranx/golembot/commit/9cd7f10308560f15decfd53a9693f4e5da9a7be9))

# [0.18.0-beta.3](https://github.com/0xranx/golembot/compare/v0.18.0-beta.2...v0.18.0-beta.3) (2026-03-09)


### Bug Fixes

* skip registry install test without GITHUB_TOKEN ([9cd7f10](https://github.com/0xranx/golembot/commit/9cd7f10308560f15decfd53a9693f4e5da9a7be9))

# [0.18.0-beta.2](https://github.com/0xranx/golembot/compare/v0.18.0-beta.1...v0.18.0-beta.2) (2026-03-09)


### Bug Fixes

* CI coverage, dev:gateway script, and engine snapshot tests ([d6fce87](https://github.com/0xranx/golembot/commit/d6fce871ae8ef0cf1d9b6f6278c5ad26b7726432))

# [0.18.0-beta.1](https://github.com/0xranx/golembot/compare/v0.17.4...v0.18.0-beta.1) (2026-03-09)


### Features

* streaming message delivery and Feishu read receipts ([7208ee3](https://github.com/0xranx/golembot/commit/7208ee3c0bb30c0341c6ccc88732974051dc8268))

# [0.14.0-beta.11](https://github.com/0xranx/golembot/compare/v0.14.0-beta.10...v0.14.0-beta.11) (2026-03-08)


### Bug Fixes

* reload .env before starting gateway from onboard ([fb215a2](https://github.com/0xranx/golembot/commit/fb215a2848111b66453fc1ee1c261f41d6a67d0b))

# [0.14.0-beta.10](https://github.com/0xranx/golembot/compare/v0.14.0-beta.9...v0.14.0-beta.10) (2026-03-08)


### Bug Fixes

* use importPeer() to resolve channel SDKs from bot directory ([be9ff1e](https://github.com/0xranx/golembot/commit/be9ff1e51df883745a3007fc826da65f38790279))

# [0.14.0-beta.9](https://github.com/0xranx/golembot/compare/v0.14.0-beta.8...v0.14.0-beta.9) (2026-03-08)


### Bug Fixes

* use createRequire to resolve channel deps from bot directory ([fdf50b2](https://github.com/0xranx/golembot/commit/fdf50b289df5a9bd54a65d02f92dee5b13afbbd1))

# [0.14.0-beta.8](https://github.com/0xranx/golembot/compare/v0.14.0-beta.7...v0.14.0-beta.8) (2026-03-08)


### Bug Fixes

* resolve channel peer-deps from bot working directory ([ea56116](https://github.com/0xranx/golembot/commit/ea5611632b665682304d3ccc5b40f688d2998e01))

# [0.14.0-beta.7](https://github.com/0xranx/golembot/compare/v0.14.0-beta.6...v0.14.0-beta.7) (2026-03-08)


### Features

* auto-install channel dependencies during onboard ([2ee94f4](https://github.com/0xranx/golembot/commit/2ee94f4a5e02f89bd5c7720f51e5fb565933bb55))

# [0.14.0-beta.6](https://github.com/0xranx/golembot/compare/v0.14.0-beta.5...v0.14.0-beta.6) (2026-03-08)


### Bug Fixes

* improve onboard channel selection hint to mention SPACE key ([2e1fa2d](https://github.com/0xranx/golembot/commit/2e1fa2da3414fc0e0f52b821510993ecd5af0324))

# [0.14.0-beta.5](https://github.com/0xranx/golembot/compare/v0.14.0-beta.4...v0.14.0-beta.5) (2026-03-07)


### Bug Fixes

* sync latest dashboard screenshots to VitePress public dir ([f7d78d9](https://github.com/0xranx/golembot/commit/f7d78d944894cfa87e538531abcc2b236ffcb413))

# [0.14.0-beta.4](https://github.com/0xranx/golembot/compare/v0.14.0-beta.3...v0.14.0-beta.4) (2026-03-07)


### Features

* add shutdown button to Gateway Dashboard and fix Fleet card layout ([93850b0](https://github.com/0xranx/golembot/commit/93850b0154f3b42364fa76a080d715e8a1ea296b))

# [0.14.0-beta.3](https://github.com/0xranx/golembot/compare/v0.14.0-beta.2...v0.14.0-beta.3) (2026-03-07)


### Features

* add fleet stop/start for bot lifecycle management ([a6826b5](https://github.com/0xranx/golembot/commit/a6826b586eaf155c0a410e1cfea2a1d33b062f7d))

# [0.14.0-beta.2](https://github.com/0xranx/golembot/compare/v0.14.0-beta.1...v0.14.0-beta.2) (2026-03-07)


### Features

* add Fleet Dashboard for multi-bot management ([42d87bd](https://github.com/0xranx/golembot/commit/42d87bd7e6d6c291affa4b064ede9c7e7ff120ef))

# [0.14.0-beta.1](https://github.com/0xranx/golembot/compare/v0.13.1...v0.14.0-beta.1) (2026-03-07)


### Features

* add gateway dashboard with real-time monitoring ([07b56dc](https://github.com/0xranx/golembot/commit/07b56dcc1fd2cae6f9e8b9a1ccea3abefdc2afe2))

## [0.13.1](https://github.com/0xranx/golembot/compare/v0.13.0...v0.13.1) (2026-03-06)


### Bug Fixes

* stronger [PASS] hint for multi-bot group chats when others are [@mentioned](https://github.com/mentioned) ([a446450](https://github.com/0xranx/golembot/commit/a446450bca76573441596366cdb54ad03fbb6764))

# [0.11.0-beta.14](https://github.com/0xranx/golembot/compare/v0.11.0-beta.13...v0.11.0-beta.14) (2026-03-06)


### Bug Fixes

* stronger [PASS] hint for multi-bot group chats when others are [@mentioned](https://github.com/mentioned) ([a446450](https://github.com/0xranx/golembot/commit/a446450bca76573441596366cdb54ad03fbb6764))

# [0.11.0-beta.13](https://github.com/0xranx/golembot/compare/v0.11.0-beta.12...v0.11.0-beta.13) (2026-03-06)


### Bug Fixes

* add secondary content-based dedup for Feishu group messages ([5367102](https://github.com/0xranx/golembot/commit/5367102c07de7e0dc6c043a4d9d9f049dfce0304))

# [0.11.0-beta.12](https://github.com/0xranx/golembot/compare/v0.11.0-beta.11...v0.11.0-beta.12) (2026-03-06)


### Features

* add golem ASCII art welcome screen to CLI ([d65218f](https://github.com/0xranx/golembot/commit/d65218ff3e6c93bb3d123415c93113fca207553a))

# [0.11.0-beta.11](https://github.com/0xranx/golembot/compare/v0.11.0-beta.10...v0.11.0-beta.11) (2026-03-06)


### Features

* integrate ClawHub skill registry for search and install ([eb526d0](https://github.com/0xranx/golembot/commit/eb526d0a9ddcc3c1f85ef4f7b862015f52b5611c))

# [0.11.0-beta.10](https://github.com/0xranx/golembot/compare/v0.11.0-beta.9...v0.11.0-beta.10) (2026-03-06)


### Bug Fixes

* update im-adapter skill to encourage standard markdown formatting ([d8d664b](https://github.com/0xranx/golembot/commit/d8d664b77e4b486c943ea9d1a17450d6a50b5fdc))

# [0.11.0-beta.9](https://github.com/0xranx/golembot/compare/v0.11.0-beta.8...v0.11.0-beta.9) (2026-03-06)


### Features

* **feishu:** default to card v2 for markdown messages ([de06e99](https://github.com/0xranx/golembot/commit/de06e993ae50ff351650c2daf1db4bb639fbd586))

# [0.11.0-beta.8](https://github.com/0xranx/golembot/compare/v0.11.0-beta.7...v0.11.0-beta.8) (2026-03-06)


### Features

* add Slack mrkdwn and Telegram HTML message formatting ([58573c0](https://github.com/0xranx/golembot/commit/58573c04059844cbacbb8970650e69e8112789eb))
* **feishu:** upgrade card to v2 schema with native markdown ([7fa203e](https://github.com/0xranx/golembot/commit/7fa203e9baf0f01e981ccdf8df5d67d4bc66f9fe))
* **feishu:** use native md tag in post mode for markdown rendering ([2916c51](https://github.com/0xranx/golembot/commit/2916c51290c292f490f79891d6c52cd8e294134c))

# [0.11.0-beta.7](https://github.com/0xranx/golembot/compare/v0.11.0-beta.6...v0.11.0-beta.7) (2026-03-05)


### Bug Fixes

* use card v2 markdown component for native list rendering in Feishu ([00be390](https://github.com/0xranx/golembot/commit/00be390b992f000627fbfc7bde54777d231b7c13))


### Features

* private chat context injection and group [@mention](https://github.com/mention) support ([c550d0a](https://github.com/0xranx/golembot/commit/c550d0af37b8adc5131102842ca0602d42c05f4e))

# [0.11.0-beta.8](https://github.com/0xranx/golembot/compare/v0.11.0-beta.7...v0.11.0-beta.8) (2026-03-05)


### Bug Fixes

* use card v2 markdown component for native list rendering in Feishu ([00be390](https://github.com/0xranx/golembot/commit/00be390b992f000627fbfc7bde54777d231b7c13))


### Features

* private chat context injection and group [@mention](https://github.com/mention) support ([c550d0a](https://github.com/0xranx/golembot/commit/c550d0af37b8adc5131102842ca0602d42c05f4e))

# [0.11.0-beta.8](https://github.com/0xranx/golembot/compare/v0.11.0-beta.7...v0.11.0-beta.8) (2026-03-05)


### Bug Fixes

* use card v2 markdown component for native list rendering in Feishu ([00be390](https://github.com/0xranx/golembot/commit/00be390b992f000627fbfc7bde54777d231b7c13))

# [0.11.0-beta.6](https://github.com/0xranx/golembot/compare/v0.11.0-beta.5...v0.11.0-beta.6) (2026-03-05)


### Bug Fixes

* deduplicate re-delivered events in all channel adapters ([0607885](https://github.com/0xranx/golembot/commit/06078856e4ec3dbfe38c4cdfcd9131f8e90b9aae))

# [0.11.0-beta.5](https://github.com/0xranx/golembot/compare/v0.11.0-beta.4...v0.11.0-beta.5) (2026-03-05)


### Bug Fixes

* explicitly disable npm provenance to fix silent publish failure ([8a8c5ac](https://github.com/0xranx/golembot/commit/8a8c5ac929907996725bdefefc74138f189d2f48))

# [0.11.0-beta.4](https://github.com/0xranx/golembot/compare/v0.11.0-beta.3...v0.11.0-beta.4) (2026-03-05)


### Bug Fixes

* update npm publish token for CI releases ([87d99b7](https://github.com/0xranx/golembot/commit/87d99b7e9262dffb5e3cfd09bcd9e9ac50417104))

# [0.11.0-beta.3](https://github.com/0xranx/golembot/compare/v0.11.0-beta.2...v0.11.0-beta.3) (2026-03-05)


### Bug Fixes

* disable OIDC provenance in release workflow ([26a95ae](https://github.com/0xranx/golembot/commit/26a95aef71bdab129721d6234003b78e45b810e0))

# [0.11.0-beta.2](https://github.com/0xranx/golembot/compare/v0.11.0-beta.1...v0.11.0-beta.2) (2026-03-05)


### Bug Fixes

* add .npmrc for npm token auth in CI release ([8cba977](https://github.com/0xranx/golembot/commit/8cba977a7f3df2b9a3e3efc29233d07bd6712abe))

# [0.11.0-beta.1](https://github.com/0xranx/golembot/compare/v0.10.1...v0.11.0-beta.1) (2026-03-05)


### Features

* smart Feishu message formatting with post rich text and optional card mode ([6bcb567](https://github.com/0xranx/golembot/commit/6bcb567923c0181c8be68e4f35e8ee427837657c))

# [0.11.0-beta.1](https://github.com/0xranx/golembot/compare/v0.10.1...v0.11.0-beta.1) (2026-03-05)


### Features

* smart Feishu message formatting with post rich text and optional card mode ([6bcb567](https://github.com/0xranx/golembot/commit/6bcb567923c0181c8be68e4f35e8ee427837657c))

## [0.10.1](https://github.com/0xranx/golembot/compare/v0.10.0...v0.10.1) (2026-03-05)


### Bug Fixes

* group chat memory leak, concurrency race condition, channel config validation ([7256c73](https://github.com/0xranx/golembot/commit/7256c730fbe8e422277a55d0c881a55f1c5a8c00))

# [0.10.0](https://github.com/0xranx/golembot/compare/v0.9.0...v0.10.0) (2026-03-05)


### Features

* per-session conversation history with automatic context recovery ([e9690bf](https://github.com/0xranx/golembot/commit/e9690bffc0ce3a6421accd50de331a37cb012817))

# [0.9.0](https://github.com/0xranx/golembot/compare/v0.8.6...v0.9.0) (2026-03-04)


### Features

* add engine authentication step to onboard wizard ([1024c42](https://github.com/0xranx/golembot/commit/1024c42f01035653fdc4b9be7b84574a91b85782))

## [0.8.6](https://github.com/0xranx/golembot/compare/v0.8.5...v0.8.6) (2026-03-04)


### Bug Fixes

* add Codex to onboard/init, fix model examples and doctor hint ([bb82f73](https://github.com/0xranx/golembot/commit/bb82f7337df6af4f61a012edf6240cce4a0be91a))

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
