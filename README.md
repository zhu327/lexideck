# LexiDeck

LexiDeck 是一个基于 **Cloudflare Workers + D1 + PWA** 的轻量级间隔重复 (SRS) 词汇学习系统，配合 **Yomitan** 浏览器插件实现「阅读即制卡」的沉浸式英语学习工作流。

> 名称说明：选择 **LexiDeck** 是为了突出“词汇（lexicon）+ 卡组（deck）”的定位，同时避免把项目命名为 Anki 或某个词典名称，降低开源发布时的品牌与版权混淆风险。本项目仅实现 AnkiConnect 兼容接口，不隶属于 Anki、Yomitan 或任何词典出版方。

---

## 功能概览

### 后端 (Cloudflare Workers)

| 模块 | 说明 |
|------|------|
| **SRS 引擎** | 基于 [FSRS v5](https://github.com/open-spaced-repetition/ts-fsrs) 算法调度复习，支持 Again / Hard / Good / Easy 四级评分 |
| **Notes CRUD** | 创建、搜索、编辑、删除笔记；支持多 Deck 与多 Model |
| **AnkiConnect 兼容 API** | 实现 `addNote`、`findNotes`、`notesInfo`、`deckNames`、`modelNames` 等常用 action，供 Yomitan 直接调用 |
| **LLM 词汇增强** | 调用 LLM（兼容 OpenAI chat/completions 接口）为单词生成：常见错误、高频搭配、词源记忆、文化注释 |
| **每日限额** | 可配置每日新卡上限与复习上限，支持时区感知的每日重置 |
| **API Key 鉴权** | 所有 API 通过 Bearer Token 保护；AnkiConnect 端点额外支持 body 内 `key` 字段（Yomitan 专用） |

### 前端 (PWA)

> 新笔记通常通过 **Yomitan 浏览器插件**（AnkiConnect API）在阅读时直接创建，PWA 不提供手动添加入口。

| 功能 | 说明 |
|------|------|
| **Review** | 翻卡 → 评分，支持 TTS 发音、快捷键（Space 翻卡，1-4 评分）、Enrichment 增强 |
| **Search** | 词库中心：搜索与浏览全部笔记、分页加载、标记/取消 Known、展开卡片查看字段与 Enrichment、导出 `.apkg` |
| **Stats** | 学习统计：今日复习数、连续天数、总卡片数、各状态分布 |
| **离线支持** | Service Worker 缓存 + 离线复习队列，恢复网络后自动同步 |
| **Badge 通知** | 通过 Web Badge API 在 PWA 图标上显示待复习数量 |
| **Enrichment 面板** | 复习或 Search 展开时一键调用 LLM 生成词汇增强内容，结果自动缓存 |

---

## 部署指南

### 前置条件

- [Cloudflare 账号](https://dash.cloudflare.com/sign-up)（免费套餐即可）
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) `>= 4.x`
- Node.js `>= 20`
- （可选）一个 LLM API 服务（Cloudflare Workers AI / OpenAI / DeepSeek 等）

### 1. 克隆与安装

```bash
git clone <repo-url> lexideck
cd lexideck
npm install
```

### 2. 创建 D1 数据库

```bash
wrangler d1 create lexideck
```

将返回的 `database_id` 记录下来，填入 `wrangler.toml`。

### 3. 准备配置文件

#### `wrangler.toml`

> ⚠️ 此文件包含敏感信息，已被 `.gitignore` 排除。

复制示例配置并填入你的真实值：

```bash
cp wrangler.toml wrangler.toml.bak   # 备份已有配置（可选）
```

编辑 `wrangler.toml`，需要填写的配置项：

| 配置项 | 必填 | 说明 |
|--------|------|------|
| `database_id` | ✅ | `wrangler d1 create` 返回的 UUID |
| `LLM_BASE_URL` | ✅ | LLM API 地址。使用 Cloudflare Workers AI 时格式为 `https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1` |
| `LLM_MODEL` | ✅ | 模型名称，如 `@cf/qwen/qwen3-30b-a3b-fp8`、`gpt-4o-mini` 等 |
| `LLM_API_KEY` | ✅ | LLM API 密钥 |
| `ANKICONNECT_API_KEY` | ✅ | 自定义 API 密钥，PWA 和 Yomitan 都用它鉴权。生成方式：`openssl rand -hex 24` |
| `NEW_CARDS_PER_DAY` | ❌ | 每日新卡上限，默认 `20` |
| `REVIEWS_PER_DAY` | ❌ | 每日复习上限，默认 `100` |
| `TIMEZONE` | ❌ | 时区偏移（小时），如 `+8` 表示 UTC+8，默认 `0` |

#### `.dev.vars`（本地开发用）

```env
DEV=1
ANKICONNECT_API_KEY=your-api-key-here
LLM_API_KEY=your-llm-api-key
LLM_BASE_URL=https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1
LLM_MODEL=@cf/qwen/qwen3-30b-a3b-fp8
```

### 4. 运行数据库迁移

```bash
# 本地
wrangler d1 migrations apply lexideck --local

# 生产
wrangler d1 migrations apply lexideck --remote
```

迁移脚本会自动创建表结构和默认数据（Default Deck、Basic Model）。

### 5. 构建 PWA 并部署

```bash
# 构建 PWA 前端
npm run build:pwa

# 本地预览
npx wrangler dev

# 部署到 Cloudflare Workers
npx wrangler deploy
```

部署完成后，访问 `https://lexideck.<your-subdomain>.workers.dev` 即可使用。

### 6. 首次使用 PWA

1. 在浏览器打开部署地址
2. 输入你在 `wrangler.toml` 中设置的 `ANKICONNECT_API_KEY`
3. 验证通过后进入主界面；通过 Yomitan 在阅读时制卡，然后在 PWA 中复习和管理词库

---

## Yomitan 配置指南

[Yomitan](https://github.com/themoeway/yomitan) 是一款浏览器划词翻译插件，支持通过 AnkiConnect 协议自动向本系统制卡。

### 1. 安装 Yomitan

- [Chrome Web Store](https://chromewebstore.google.com/detail/yomitan/likgccmbimhjbgkjambclfkhldnlhbog)
- [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/yomitan/)

### 2. 导入词典

安装后进入 Yomitan 设置页面 → **Dictionaries** → **Configure installed and enabled dictionaries…** → **Import**，按需导入你有权使用的 Yomitan 词典文件。

出于版权合规考虑，本项目不提供、不托管、也不链接第三方商业词典下载资源。请选择来源清晰、授权允许个人使用或开源发布的词典；如果你使用商业词典，请确认自己已获得相应授权。

可选方向：

| 类型 | 说明 |
|------|------|
| Yomitan 内置或官方推荐资源 | 优先使用 Yomitan 设置页中可直接获取、来源说明清晰的词典资源 |
| 开放授权词典 | 选择带有明确许可证的公开词典，并遵守其署名、再分发等要求 |
| 自购商业词典 | 仅在授权允许的范围内个人使用，不要随项目仓库分发词典文件 |

> 导入 `.zip` 格式的 Yomitan 词典文件即可。仓库中不应提交词典压缩包、转换后的词典数据或任何无法确认授权的词典内容。

### 3. 配置 AnkiConnect 连接

进入 Yomitan 设置 → **Anki** → **Configure AnkiConnect connection…**：

| 字段 | 值 |
|------|-----|
| **AnkiConnect URL** | `https://lexideck.<your-subdomain>.workers.dev/ankiconnect` |
| **API key** | 你的 `ANKICONNECT_API_KEY` |

点击 **Test connection**，看到成功提示即表示连接正常。

> **注意**：由于 Yomitan 在浏览器内发起跨域请求，本后端已配置全局 CORS `*` 允许，无需额外设置。

### 4. 配置 Anki Cards（制卡模板）

进入 Yomitan 设置 → **Anki** → **Configure Anki card format…**，点击 **Add** 新建一个卡片模板：

#### 基本设置

| 字段 | 值 |
|------|-----|
| **Deck** | `Default`（或你在系统中创建的其他 Deck 名称） |
| **Model** | `Basic` |

#### 字段映射

Basic Model 有两个字段：`Front` 和 `Back`。按如下方式配置映射：

| 字段 | 值 / 模板 | 说明 |
|------|-----------|------|
| **Front** | `{expression}` | 查词的单词或短语 |
| **Back** | 见下方模板 | 包含释义、例句等 |

**Back 字段推荐模板**（在 Yomitan 的字段编辑器中粘贴）：

```
{definition}
<br>
{#sentences}<br><i>{sentence}</i>{/sentences}
<br>
{#tags}<span style="color:#888">{tags}</span>{/tags}
```

> 你也可以点击字段旁的 **{…}** 按钮浏览所有可用的 Yomitan 模板变量，根据需要自行调整。

#### 推荐的模板变量

| 变量 | 说明 |
|------|------|
| `{expression}` | 查询的单词/短语 |
| `{reading}` | 读音（日语假名等） |
| `{definition}` | 词典释义（包含所有已启用词典的内容） |
| `{sentence}` | 当前页面中包含该单词的句子（上下文） |
| `{url}` | 来源页面 URL |
| `{tags}` | 词典标签 |

### 5. 使用方式

1. 在任意英文网页上选中一个单词
2. Yomitan 弹出释义窗口
3. 点击窗口中的 **+** 按钮（或按配置的快捷键）
4. 卡片自动通过 AnkiConnect API 创建到你的 LexiDeck 后端
5. 打开 PWA 即可在 Review 中看到新添加的卡片

---

## 项目结构

```
.
├── src/                    # Workers 后端
│   ├── index.ts            # 入口，组装 Hono 子路由
│   ├── env.ts              # 环境变量类型
│   ├── auth/               # API Key 鉴权
│   ├── ankiconnect/        # AnkiConnect 兼容 API
│   ├── notes/              # 笔记 CRUD
│   ├── review/             # SRS 复习 (due/submit/quiz/familiar)
│   ├── srs/                # FSRS 调度器
│   ├── llm/                # LLM 词汇增强
│   ├── stats/              # 统计数据
│   ├── db/                 # D1 数据库客户端与 Repository
│   └── utils/              # 时区等工具函数
├── pwa/                    # PWA 前端源码
│   ├── index.html
│   └── src/
│       ├── main.ts         # 入口、路由、Service Worker
│       ├── review.ts       # 复习界面
│       ├── search.ts       # 词库中心：搜索、浏览、Known、展开卡片
│       ├── stats.ts        # 统计界面
│       ├── api.ts          # 后端 API 客户端
│       ├── card-renderer.ts  # 卡片渲染与 Enrichment 展示
│       ├── tts.ts          # TTS 发音
│       ├── enrichment-panel.ts  # LLM 增强面板
│       ├── fields.ts       # 字段渲染辅助
│       ├── edit-modal.ts   # 笔记编辑弹窗
│       ├── keyboard.ts     # 快捷键处理
│       ├── offline-review.ts  # 离线复习队列
│       ├── review-session.ts  # 复习会话管理
│       ├── review-sync.ts  # 离线同步
│       ├── dom.ts          # DOM 工具
│       └── helpers.ts      # 通用工具函数
├── dist/pwa/               # PWA 构建产物 (部署用)
├── migrations/             # D1 数据库迁移脚本
│   ├── 0001_init.sql       # 建表
│   └── 0002_seed.sql       # 初始数据
├── wrangler.toml           # Workers 配置 (不提交)
├── .dev.vars               # 本地开发环境变量 (不提交)
└── package.json
```

## 开发

```bash
# 类型检查
npm run typecheck

# Lint
npm run lint

# 测试
npm test

# 本地开发 (使用 .dev.vars)
npx wrangler dev

# 部署预检
npm run deploy:dryrun
```

## 技术栈

- **运行时**: Cloudflare Workers (V8 Isolates)
- **框架**: [Hono](https://hono.dev/)
- **数据库**: Cloudflare D1 (SQLite)
- **SRS**: [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) (FSRS v5)
- **前端**: 原生 TypeScript + Vite 构建
- **PWA**: Service Worker + Web App Manifest + Badge API
- **LLM**: 兼容 OpenAI chat/completions 接口的任意服务
