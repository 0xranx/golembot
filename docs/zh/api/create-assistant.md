# createAssistant()

GolemBot 作为库使用的主入口。

## 签名

```typescript
import { createAssistant } from 'golembot';

function createAssistant(opts: CreateAssistantOpts): Assistant;
```

## CreateAssistantOpts

```typescript
interface CreateAssistantOpts {
  dir: string;                  // 助手目录路径
  engine?: string;              // 覆盖 golem.yaml 中的引擎
  model?: string;               // 覆盖 golem.yaml 中的模型
  apiKey?: string;              // Agent API Key
  maxConcurrent?: number;       // 全局最大并发 chat() 数（默认：10）
  maxQueuePerSession?: number;  // 每个 sessionKey 最大排队数（默认：3）
  timeoutMs?: number;           // 引擎调用超时毫秒数（默认：300000）
}
```

## Assistant 接口

```typescript
interface Assistant {
  chat(message: string, opts?: ChatOpts): AsyncIterable<StreamEvent>;
  init(opts: { engine: string; name: string }): Promise<void>;
  resetSession(sessionKey?: string): Promise<void>;
}
```

### `chat(message, opts?)`

发送消息并接收事件流。

```typescript
interface ChatOpts {
  sessionKey?: string;   // 默认："default"
}
```

返回 `AsyncIterable<StreamEvent>`。详见 [StreamEvent](/zh/api/stream-events)。

**并发**：相同 `sessionKey` 的调用串行化（排队）。不同 `sessionKey` 并行运行。

```typescript
// 单用户
for await (const event of assistant.chat('你好')) {
  if (event.type === 'text') process.stdout.write(event.content);
}

// 多用户
for await (const event of assistant.chat('你好', { sessionKey: 'user-123' })) {
  // ...
}
```

### `init(opts)`

初始化新的助手目录。如果 `golem.yaml` 已存在则抛出错误。

### `resetSession(sessionKey?)`

清除指定 Key 的会话（默认：`"default"`）。

## 生产环境：限流 + 超时

```typescript
const assistant = createAssistant({
  dir: './my-bot',
  maxConcurrent: 20,       // 超过 20 个并发立即返回 error 事件
  maxQueuePerSession: 2,   // 同一用户超过 2 个排队请求立即返回 error 事件
  timeoutMs: 120_000,      // 2 分钟强制超时
});

// 处理限流 / 超时的 error 事件
for await (const event of assistant.chat('你好', { sessionKey: 'user-1' })) {
  if (event.type === 'error') {
    console.error('聊天错误:', event.message);
    break;
  }
  if (event.type === 'text') process.stdout.write(event.content);
}
```

## 重导出

`golembot` 包还重导出：

```typescript
export type { StreamEvent } from './engine.js';
export type { GolemConfig, SkillInfo, ChannelsConfig, GatewayConfig,
              StreamingConfig } from './workspace.js';
export { createGolemServer, startServer, type ServerOpts } from './server.js';
export type { ChannelAdapter, ChannelMessage, ReadReceipt } from './channel.js';
export { buildSessionKey, stripMention } from './channel.js';
export { startGateway } from './gateway.js';
```
