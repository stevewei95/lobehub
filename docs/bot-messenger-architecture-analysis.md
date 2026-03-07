# LobeHub Bot Messenger 架构设计分析

## 一、架构设计动机（为什么这样设计）

### 1. 三层解耦架构

```
Webhook Route → BotMessageRouter → AgentBridgeService → Agent Runtime
```

**设计动机：**

- **Webhook Route 层**：Next.js Route Handler，职责仅是接收 HTTP 请求并转发。这层极薄，确保平台 webhook 验证（Discord signature / Telegram secret_token）在最早阶段完成，不合法请求不会进入业务逻辑。

- **BotMessageRouter（路由层）**：单例模式管理所有 Bot 实例，用三种 Map 索引实现 O(1) 路由。这层解决的是"一个 LobeHub 实例可以同时服务多个 Bot"的多租户问题——不同 Agent 可以绑定不同的 Discord/Telegram Bot。

- **AgentBridgeService（桥接层）**：将 Chat SDK 的事件模型（thread、message）翻译为 Agent Runtime 的执行模型（agentId、topicId、prompt）。这层隔离了"聊天平台交互"和"AI 执行"两个关注点，使得新增平台（如 Slack、飞书）时只需增加适配器，不影响 Agent 执行逻辑。

**为什么不合并？** 每层有不同的生命周期和变化频率：webhook 协议变化少但安全敏感；路由逻辑随新 Bot 注册变化；桥接逻辑随 Agent Runtime API 演进而变化。分层使每层可独立演进。

### 2. 双模式执行（Queue vs Local）

**设计动机：**

- **Queue 模式（QStash）**：Serverless 环境（如 Vercel）有函数执行时间限制（通常 10-60 秒），而 Agent 执行可能需要数分钟。QStash 将每一步拆为独立的 HTTP 请求，绕过了执行时间限制。同时 QStash 提供重试和去重机制。

- **Local 模式**：开发环境或长连接服务器不需要 QStash 的复杂性。用 Promise + setTimeout 在进程内执行，简化调试和开发体验。

**为什么不只用一种？** Queue 模式依赖外部服务（QStash），增加了延迟和运维成本；Local 模式不适合 Serverless。双模式使系统同时适应两种部署形态。

### 3. 进度消息编辑（而非流式推送）

**设计动机：**

Discord 和 Telegram 都不支持服务端推送的流式消息。唯一的实时反馈方式是：
1. 先发送一条"初始消息"
2. 在每一步完成后编辑这条消息，追加进度信息
3. 最终替换为完整回复

这模拟了 ChatGPT 风格的"打字中"体验，是平台 API 限制下的最优解。

### 4. 单例 BotMessageRouter + 5 分钟刷新

**设计动机：**

- **单例**：每个 Bot 实例持有 WebSocket 连接（Discord Gateway）或注册了 Webhook（Telegram），多实例会导致重复消息处理。
- **5 分钟后台刷新**：新 Bot 注册后无需重启服务即可生效，但也不需要每次请求都查数据库。5 分钟是延迟与性能的平衡点。

### 5. Thread State 持久化多轮对话

**设计动机：**

Chat SDK 的 thread state（存 Redis 或内存）将 `topicId` 绑定到平台 thread。这样后续消息自动关联到同一 topic，实现跨消息的上下文连续对话。选择 Redis 而非数据库是因为 thread state 是临时性数据，不需要持久化保证。

---

## 二、当前设计中未考虑到或可以改进的方面

### A. 高优先级问题

#### 1. 缺少平台 API Rate Limiting 保护

**现状：** Discord 和 Telegram REST API 调用（`editMessage`、`createMessage`、`triggerTyping`）没有客户端侧速率限制。

**风险：**
- Discord 对 `editMessage` 的频率限制约为 5 次/5秒/频道。Agent 快速执行多步时，step callback 可能频繁调用 `editMessage`，触发 429 错误。
- Telegram 的 `sendMessage` 限制约为 30 次/秒（对同一 chat）。
- 当前代码对 429 响应没有重试/退避逻辑。

**建议：** 添加 per-channel 的令牌桶限流器，或在 REST API 封装层实现 429 响应的自动重试 + 指数退避。

#### 2. Completion Callback 丢失 = 用户永远看不到回复

**现状：** 如果 completion webhook 投递失败（网络故障、QStash 重试耗尽），用户看到的进度消息会永远停在最后一步的状态，没有任何恢复机制。

**风险：** 用户体验极差——Bot 看起来"死掉了"，但实际上 Agent 已经执行完毕，回复内容存在数据库中。

**建议：**
- 添加"超时兜底"：如果进度消息超过 N 分钟未更新，由一个定时任务检查 Agent 状态并补发回复。
- 或在 Agent 完成时同时在数据库中标记"待投递"，由定时 worker 轮询清理。

#### 3. 并发消息处理无序列化

**现状：** 同一 thread 中如果用户快速发送多条消息，`handleSubscribedMessage` 会被并发调用多次。每次调用都会独立执行 `execAgent`，创建独立的 topic 消息。

**风险：**
- 多个 Agent 执行并发运行，共享同一个 `topicId`，可能导致消息交错。
- 多个进度消息同时在频道中出现。
- `thread.setState` 的最后写入者胜出，可能覆盖有效的 topicId。

**建议：** 添加 per-thread 的执行队列/锁，确保同一 thread 中的消息按序处理。可以用 Redis 分布式锁实现。

### B. 中等优先级问题

#### 4. Bot 配置变更不会热更新已有实例

**现状：** `loadAgentBots()` 在刷新时跳过已注册的 `key`（`if (this.botInstances.has(key)) continue`）。如果用户在管理界面修改了 Bot 的凭证或绑定的 Agent，旧实例会一直使用旧配置，直到进程重启。

**建议：** 检测配置变更（如凭证 hash），对变更的 Bot 实例先销毁再重建。

#### 5. 缺少结构化错误上报

**现状：** 错误处理以 `debug()` 日志为主，`fire-and-forget` 模式下失败静默丢弃。

**风险：**
- 生产环境默认不启用 debug 日志
- 无法监控 Bot 的健康状态（成功率、延迟、错误率）
- 当 webhook 投递静默失败时，难以排查

**建议：**
- 接入结构化日志（如 Pino）或 APM（如 Sentry）
- 关键路径添加 metrics（webhook 处理延迟、Agent 执行时间、平台 API 错误率）
- Completion callback 失败时发告警

#### 6. Telegram 私聊的全量拦截

**现状：** Telegram Bot 注册了 `onNewMessage(/./)` 全匹配处理器，会响应私聊中的所有消息。

**风险：**
- 任何发送给 Bot 的消息都会触发 Agent 执行，可能导致不必要的 LLM 调用和费用。
- 没有命令前缀或白名单机制。

**建议：** 考虑添加 `/start` 命令引导、用户白名单、或每日使用量限制。

#### 7. 文件附件处理的局限性

**现状：**
- 仅提取 Discord 原生附件和引用消息附件
- Telegram 的文件（`document`、`photo`、`video`）需要通过 Bot API 的 `getFile` 获取 URL，当前代码依赖 Chat SDK 的解析
- 没有文件大小限制验证
- 没有文件类型过滤（恶意文件可能被传入 Agent）

**建议：** 添加文件大小上限检查（如 50MB）和 MIME 类型白名单。

### C. 低优先级 / 长期考虑

#### 8. 单点故障：进程内单例

**现状：** `BotMessageRouter` 是进程内单例，所有 Bot 实例和索引 Map 存在内存中。

**影响：**
- 不支持多实例水平扩展（每个实例都会注册相同的 Telegram webhook，导致消息被多个实例处理）
- 进程崩溃会丢失所有 Bot 实例状态（需要重新初始化）
- 内存中的 thread state（无 Redis 时）在进程重启后丢失

**长期方向：** 如果需要多实例部署，需要引入 Leader Election 或将 webhook 路由移到网关层。

#### 9. 缺少 Graceful Shutdown

**现状：** 没有 shutdown 钩子来：
- 等待正在进行的 Agent 执行完成
- 清理 typing indicator interval
- 关闭 Chat SDK 连接

**建议：** 注册 `SIGTERM` 处理器，drain 正在进行的请求后再退出。

#### 10. 消息模板渲染不支持富文本

**现状：** 进度消息和最终回复以 Markdown 纯文本渲染。Discord 支持 Embed（富文本卡片），Telegram 支持 InlineKeyboard、HTML 格式等。

**未来方向：** 可以利用平台原生富文本能力提升用户体验（如带颜色的执行状态指示器、可折叠的 tool 执行详情等）。

#### 11. 没有用户权限控制

**现状：** 任何能在频道中 @mention Bot 的用户都能触发 Agent 执行。

**风险：** 非授权用户可能消耗大量 LLM token。

**建议：** 支持配置允许列表（Discord role、Telegram user ID）或按用户限流。

#### 12. 缺少 Health Check 端点

**现状：** 没有专门的端点来检查 Bot 系统的健康状态（Bot 实例数量、连接状态、最近错误）。

**建议：** 添加 `/api/health/bots` 端点，返回各 Bot 的在线状态和指标。

---

## 三、架构优点总结

| 设计决策 | 优点 |
|---------|------|
| 三层解耦 | 关注点分离，新平台接入成本低 |
| 双模式执行 | 灵活适应 Serverless 和传统服务器 |
| Chat SDK 抽象 | 统一事件模型，平台差异在适配器层消化 |
| 进度消息编辑 | 在平台限制内最大化用户反馈 |
| Thread State | 轻量级多轮对话支持，无需额外数据库表 |
| Fire-and-forget 模式 | 次要操作（emoji、标题生成）不阻塞主流程 |
| QStash 集成 | 解决 Serverless 执行时间限制 |
| 凭证加密 | KeyVaultsGateKeeper 保护 Bot Token 安全 |
| Stale topicId 自动恢复 | FK violation 检测 + 重试，优雅处理 topic 删除 |

## 四、改进优先级路线图

```
P0 (立即)  → 平台 API Rate Limiting + Completion 兜底机制
P1 (近期)  → 并发消息序列化 + Bot 配置热更新
P2 (中期)  → 结构化日志/监控 + 用户权限控制
P3 (长期)  → 多实例支持 + 富文本消息 + Health Check
```
