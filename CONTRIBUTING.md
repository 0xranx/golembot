# Contributing Guide

Thanks for your interest in GolemBot! Here's how to get involved.

## Development Environment

- Node.js >= 22
- pnpm >= 9

```bash
pnpm install
pnpm run build
pnpm run test
```

## Workflow

1. Fork this repository
2. Create your feature branch (`git checkout -b feat/my-feature`)
3. Commit your changes (`git commit -m 'feat: add some feature'`)
4. Push to the branch (`git push origin feat/my-feature`)
5. Open a Pull Request

## Code Standards

- TypeScript strict mode
- Use clear, self-explanatory function names — code should be readable without comments
- All exported public APIs must have JSDoc documentation
- New features must include tests

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation update
- `refactor:` Refactoring
- `test:` Tests
- `chore:` Build / toolchain

## Project Structure

```
src/
├── index.ts       # Public API — createAssistant()
├── engine.ts      # AgentEngine interface and engine implementations
├── workspace.ts   # Configuration, Skill scanning
├── session.ts     # Session management
├── server.ts      # HTTP SSE service
├── gateway.ts     # Long-running Gateway service + IM channels
├── channel.ts     # Channel adapter interface
├── channels/      # Feishu / DingTalk / WeCom adapters
└── cli.ts         # CLI entry point
```

## Adding a New Engine

1. Implement the `AgentEngine` interface in `src/engine.ts`
2. Register it in the `createEngine()` factory function
3. Add unit tests (parsing logic) and e2e tests
4. Update the engine comparison table in README

## Adding a New Channel Adapter

1. Implement the `ChannelAdapter` interface in `src/channels/`
2. Register it in the adapter factory in `src/gateway.ts`
3. Update the `GolemConfig` type and configuration docs
4. Add the IM SDK as an optional peerDependency

## License

All contributions are released under the [MIT License](LICENSE).
