# SaveMemory · 个人记忆训练应用

本地优先的记忆训练工具：输入任意材料（文字/图片），系统自动把它变成**持续考你**的训练系统。

## 核心原则（不可妥协）

| 原则 | 实现方式 |
| --- | --- |
| 调度用 FSRS，AI 不参与排期 | `ts-fsrs`（FSRS-7），AI 只负责出题与判断对错 |
| 学习动作是"提取"而非"重读" | 默认只显示题干，必须先回忆才能看到参考答案 |
| 图片是一等输入 | 图片走视觉模型/OCR → 提取文本 → 与文字进入同一管道 |
| 本地优先，无需登录 | IndexedDB（Dexie）存储全部数据，API Key 由用户自填 |

---

## 一、项目目录结构

```
savememory/
├── index.html                  # 应用外壳
├── vite.config.ts              # Vite + Vitest 配置
├── tsconfig.app.json           # TS 严格配置（erasableSyntaxOnly）
├── public/
│   └── favicon.svg
└── src/
    ├── main.tsx                # 入口
    ├── App.tsx                 # 应用外壳 + 顶部导航 + 路由
    ├── styles.css              # 全局样式
    │
    ├── db/                     # ── 数据层（Dexie / IndexedDB）
    │   ├── schema.ts           #   实体类型定义 + 默认设置 + 难度配比常量
    │   ├── db.ts               #   Dexie 数据库与索引
    │   └── repo.ts             #   各实体的增删查（Repository 模式）
    │
    ├── fsrs/                   # ── 调度层（唯一决定"何时复习"的地方）
    │   └── scheduler.ts        #   ts-fsrs 封装：新卡、评分、预览、日期还原
    │
    ├── llm/                    # ── AI 层（只负责出题与判断，不碰排期）
    │   ├── types.ts            #   LLMProvider 接口 + 错误类型 + 图片载荷解析
    │   ├── openai.ts           #   OpenAI 兼容端点实现（含 vision 格式）
    │   ├── gemini.ts           #   Gemini 端点实现（含 inlineData 格式）
    │   ├── index.ts            #   Provider 工厂（含独立的视觉模型）
    │   ├── schemas.ts          #   Zod schema（AI 输出的唯一契约）
    │   ├── prompts.ts          #   概念切分 / 出题 / 难度配平 / 读图 / 判卷
    │   ├── call.ts             #   callJson：解析失败自动重试
    │   ├── generate.ts         #   管道：概念切分 → 出题 → 难度配平
    │   ├── vision.ts           #   阶段 2：图片内容识别
    │   └── judge.ts            #   阶段 2：自由文本答案评级
    │
    ├── services/
    │   └── ingest.ts           # 端到端管道：材料 → 概念 → 题目 → 卡片
    │
    ├── store/                  # ── 状态层（Zustand）
    │   ├── settings.ts         #   设置（含 API Key、FSRS 参数、评判方式）
    │   └── study.ts            #   学习会话（队列、揭示、四档评分、重排、AI 评判）
    │
    ├── pages/                  # ── 页面
    │   ├── IngestPage.tsx      #   输入材料 / 文字+图片 / 生成 / 材料列表
    │   ├── StudyPage.tsx       #   学习会话（手动自评 / AI 评判）
    │   ├── LibraryPage.tsx     #   卡片库 / 概念 / 复习历史
    │   └── SettingsPage.tsx    #   模型接口 / 视觉模型 / 评判方式 / 调度参数
    │
    ├── components/
    │   ├── GradeButtons.tsx    #   Again / Hard / Good / Easy 四档按钮
    │   ├── ImageDropzone.tsx   #   图片拖拽 / 粘贴 / 选择 / 拍照上传区
    │   └── TabBar.tsx          #   手机底部 Tab Bar（内联 SVG 图标）
    │
    ├── hooks/
    │   ├── useDueCount.ts      #   到期卡片数轮询（导航徽标）
    │   └── useMediaQuery.ts    #   响应式断点（顶栏 ↔ 底部 Tab 切换）
    │
    ├── lib/                    # ── 通用工具
    │   ├── id.ts               #   uuid
    │   ├── date.ts             #   日期格式化
    │   ├── json.ts             #   从模型回复中稳健提取 JSON
    │   └── image.ts            #   图片降采样、base64 转换、Blob 读写
    │
    ├── services/
    │   ├── ingest.ts           # 端到端管道：材料 → 概念 → 题目 → 卡片
    │   └── backup.ts           # 数据导出 / 导入（JSON，含图片）
    │
    ├── dev/                    # 仅开发环境（生产构建会被摇树移除）
    │   ├── index.ts            #   window.__memory 调试入口
    │   └── seed.ts             #   一键写入演示数据
    │
    └── test/
        ├── setup.ts            #   fake-indexeddb（+ jsdom 下的 Blob 兼容）
        ├── fakeProvider.ts     #   假模型（可解析我们的提示词）
        ├── pipeline.test.ts    #   阶段 1 管道与调度测试
        ├── ui.test.tsx         #   阶段 1 界面流程测试
        ├── stage2.test.ts      #   阶段 2 图片与 AI 评判测试
        ├── stage2.ui.test.tsx  #   阶段 2 界面流程测试
        └── backup.test.ts      #   导出 / 导入测试

scripts/
└── generate-icons.mjs         # 无依赖 PNG 生成器，产出 PWA 图标
```

---

## 二、数据模型

所有实体存放在 IndexedDB（数据库名 `savememory`）。

### `Source` —— 原材料

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 主键 |
| `kind` | `'text' \| 'image'` | 文字 / 图片 |
| `title` | `string` | 标题 |
| `text` | `string` | 提取出的纯文本；图片则是视觉模型/OCR输出 |
| `image` | `Blob?` | **原始图片，以 Blob 形式存进 IndexedDB**（不存 base64，省 33% 体积） |
| `imageMimeType` | `string?` | 图片 MIME 类型 |
| `textExtractedFromImage` | `boolean?` | 文字是否来自读图。用于重试时跳过重复读图 |
| `createdAt` | `number` | epoch ms |
| `generationStatus` | `'pending' \| 'done' \| 'failed'` | 生成状态，用于"失败后重试而不必重贴材料" |
| `generationError` | `string?` | 失败原因 |

### `Concept` —— 原子概念

一个概念 = 一个可独立测试的事实/定义/关系。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 主键 |
| `sourceId` | `string` | 外键 → `Source.id` |
| `index` | `number` | 在材料中的序号 |
| `title` | `string` | 概念名（3–12 字） |
| `statement` | `string` | **原子陈述句**，可独立判断真伪 |
| `elaboration` | `string?` | 补充说明 |
| `tags` | `string[]` | 标签 |

### `Card` —— 卡片（题目 + FSRS 调度状态）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 主键，同时作为 FSRS 的 `cardId` |
| `conceptId` | `string` | 外键 → `Concept.id` |
| `sourceId` | `string` | 外键 → `Source.id` |
| `type` | `'qa' \| 'cloze' \| 'choice' \| 'truefalse' \| 'feynman'` | 题型（阶段 1 只产出 qa/cloze） |
| `prompt` | `string` | **题干**（≤20 字为佳） |
| `answer` | `string` | **参考答案**（≤50 字为佳），揭示前不展示 |
| `options` | `string[]?` | 选择题选项 |
| `correctIndex` | `number?` | 正确选项下标 |
| `questionDifficulty` | `'easy' \| 'medium' \| 'hard'` | **题目难度**（与 FSRS 难度无关） |
| `fsrsStability` | `number` | FSRS 稳定性 S |
| `fsrsStabilityFast` | `number` | FSRS-7 快速记忆轨迹稳定性（**运行时必需**） |
| `fsrsDifficulty` | `number` | FSRS 难度 D |
| `fsrsState` | `0\|1\|2\|3` | New / Learning / Review / Relearning |
| `fsrsScheduleStatus` | `'new' \| 'learning' \| 'review'` | FSRS 调度状态 |
| `dueAt` | `number` | **下次复习时间（epoch ms）**，IndexedDB 索引字段 |
| `lastReviewAt` | `number \| null` | 上次复习时间 |
| `reps` / `lapses` | `number` | 复习次数 / 遗忘次数 |
| `scheduledDays` | `number` | 本次间隔（天） |
| `learningStep` | `number` | 学习阶段步数 |
| `createdAt` | `number` | epoch ms |

### `ReviewLog` —— 复习记录

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 主键 |
| `cardId` / `conceptId` | `string` | 外键 |
| `rating` | `1\|2\|3\|4` | 1=Again 2=Hard 3=Good 4=Easy |
| `reviewedAt` | `number` | 复习时间 |
| `dueAt` | `number` | FSRS 给出的下次到期时间 |
| `state` | `number` | 复习后的 FSRS 状态 |
| `elapsedDays` / `scheduledDays` | `number` | 间隔统计 |
| `durationMs` | `number` | 作答耗时 |
| `mode` | `'self' \| 'ai'` | 自评 / AI 评判 |
| `aiVerdict` | `'correct'\|'partial'\|'incorrect'?` | AI 判定结果 |
| `aiFeedback` | `string?` | AI 给出的评分理由 |
| `aiSuggestedRating` | `number?` | AI 建议的评分（即使被用户改选也保留，便于统计一致率） |
| `errorCause` | `'forgotten'\|'confused'\|'not_understood'?` | 阶段 3：错因归因 |

### `Settings` —— 设置（单行，`id = 'settings'`）

| 字段 | 说明 |
| --- | --- |
| `provider` | `'openai' \| 'gemini'` |
| `baseUrl` / `model` / `apiKey` | 接口地址、主模型、密钥 |
| `visionModel` | **视觉模型名称**，留空则复用 `model` |
| `desiredRetention` / `maximumInterval` | FSRS 参数 |
| `questionsPerConcept` | 每个概念出几道题 |
| `gradingMode` | `'self' \| 'ai'` —— 手动自评 / AI 评判 |
| `ocrEndpoint` | 可选的自定义 OCR 接口；留空则禁用 |

### 索引

```
sources:     id, createdAt, generationStatus
concepts:    id, sourceId, [sourceId+index]
cards:       id, conceptId, sourceId, dueAt, [sourceId+createdAt]
reviewLogs:  id, cardId, conceptId, reviewedAt
settings:    id
```

---

## 三、阶段 1 实现要点

### 数据流

```
文字材料
  → 概念切分（LLM + Zod 校验）
  → 出题（LLM + Zod 校验，按难度计划分配）
  → 难度配平（30% / 50% / 20%）
  → 写入 IndexedDB，同时用 FSRS 初始化调度状态
  → 学习页按 dueAt 取出到期卡片
  → 只显示题干 → 用户回忆 → 显示答案 → 四档自评
  → ts-fsrs 更新调度 → 写入 ReviewLog
```

### 关键设计决策

**1. 难度配比是"构造"出来的，不是"祈祷"出来的。**
生成前先算出每个题目槽位的目标难度（`buildDifficultyPlan`），保证 30/50/20 精确成立；模型自报的难度若与配平不符，再跑一次"只改标签不改内容"的配平调用；配平失败则回退到预先算好的计划——两种路径下配比都精确成立。

**2. AI 输出全部经过 schema 校验后才入库。**
`callJson` 负责：解析模型回复 → Zod 校验 → 失败则带着具体错误信息重问 → 仍失败则抛出可读错误。管道层面捕获异常后把 `Source` 标记为 `failed` 并保留材料，用户可一键重试，不会崩溃。

**3. ts-fsrs 的两个坑已处理：**
- `card.dueAt` 在库内是 `Date` 对象。IndexedDB 读出来是字符串，直接喂回 `review()` 会抛 *"Expected valid Date fields"*。所有从数据库读出的卡片都必须经 `toSchedulerCard()` 还原为 `Date`。
- FSRS-7 **运行时必需** `stabilityFast`，但库导出的 `DefaultSchedulerCardInput` 类型里没有这个字段。直接照抄类型会导致编译通过、运行时抛 *"Expected FSRS7 memory state with finite stability, stabilityFast and difficulty"*。因此我们自行声明 `SchedulerCardInput` 类型，让 TypeScript 把住这个坑。

**4. 答错不跳过"先回忆"。**
选择「重来」的卡片会被追加到**本次会话队列末尾**，下次出现时 `revealed` 复位为 `false`——依然必须先回忆才能看答案。单张卡最多重排 3 次，避免死循环。

---

## 四、阶段 2：图片输入与 AI 评判

### 任务 1：图片是一等输入

```
图片 (Blob)
  → 降采样（长边 ≤2000px，PNG 保留无损 / 照片转 JPEG）
  → 视觉模型读图，返回结构化 JSON { text, title, language, hasFormula, semanticSummary }
  → Zod 校验
  → 拼成「材料文本」，写入 Source.text
  → 复用阶段 1 的概念切分 → 出题 → FSRS 管道（零改动）
```

- **本地存储**：图片以 `Blob` 存进 IndexedDB，只在发给模型时才转成 base64。
- **视觉模型独立配置**：`settings.visionModel` 留空则复用主模型，可让出题用便宜小模型、读图用多模态模型。
- **降级链路**：

  | 情况 | 行为 |
  | --- | --- |
  | 视觉模型正常 | 直接读图，继续管道 |
  | 视觉模型不支持图片（接口报错） | 识别为 `visionUnsupported` → 弹出兜底 UI |
  | 网络请求失败 / 模型输出不可用 | 同样弹出兜底 UI |
  | 配置了 `ocrEndpoint` | 先自动调用它，成功则继续管道 |
  | 兜底 UI | **展示原图 + 一个文本框**，用户对照图片输入文字，之后走「文字 → 概念 → 卡片」的原有管道 |

- **重试不重复读图**：读出的文字写回 `Source.text` 并标记 `textExtractedFromImage`，重试时直接复用。

### 任务 2：AI 评判自由文本答案

```
题干（不显示答案）
  → 用户在文本框写下答案
  → 点「提交答案」
  → LLM 按参考答案评级，返回 { verdict, feedback, suggestedRating }
  → Zod 严格校验（含 verdict 与 suggestedRating 的一致性检查）
  → 展示反馈 + 高亮建议档位（用户可改选其它档位）
  → 用户确认后写入 FSRS
```

- **一致性由 Zod 强制**：`correct → 3|4`、`partial → 2|3`、`incorrect → 1`。不自洽即视为校验失败 → 带着具体错误重问 → 仍失败则**降级为手动评分，绝不自动套用一个未经验证的分数**。
- **评判失败不丢分**：网络错误、JSON 不合法、重试用尽 → 提示「已切换为手动评分」，保留用户已输入的答案，直接展示参考答案与四档按钮，此时不会写入任何复习记录。
- **用户始终掌控**：AI 只给建议，高亮对应按钮，但最终写入的是用户点击的那一档；AI 的原始建议记录在 `aiSuggestedRating` 里，便于日后统计一致率。
- **未作答**直接判为「重来」，不调用模型。

### 阶段 2 的额外字段

| 位置 | 变更 |
| --- | --- |
| `Source` | `image` / `imageMimeType` / `textExtractedFromImage` |
| `ReviewLog` | `aiFeedback` / `aiSuggestedRating` |
| `Settings` | `visionModel` / `gradingMode` / `ocrEndpoint` |

数据库**无需升级版本**：Dexie 对非索引字段是 schemaless 的，新增字段对存量数据无损。

---

## 五、移动端与 PWA

### 响应式布局

| 断点 | 导航 | 说明 |
| --- | --- | --- |
| ≥ 768px | 顶部导航栏 | 桌面 / 平板 |
| < 768px | 底部固定 Tab Bar | 输入 / 学习 / 卡片库 / 设置，内联 SVG 图标 + 到期徽标 |

两套导航**只会渲染其中一套**（`useMediaQuery` 驱动），避免出现重复的地标元素。

其它移动端适配：

- 所有 `input` / `textarea` / `select` / 按钮的字号 ≥ 16px —— iOS Safari 聚焦小于 16px 的输入框时会自动放大页面。
- 四档评分按钮在手机上变成 **2×2 网格**，按钮更大更好按。
- 卡片内容区在手机上加大上下内边距。
- 适配 iPhone 刘海与底部安全区（`viewport-fit=cover` + `env(safe-area-inset-bottom)`）。
- 图片上传区额外提供一个「📷 拍照」按钮（`capture="environment"`，直接开后置摄像头）。

> ⚠️ 关于 `capture`：在 iOS 上给 input 加 `capture` 会**取代**相册选择器，只剩相机。
> 所以这里用了两个 input —— 拖拽区点击走普通选择器（相册 + 文件），「拍照」按钮走摄像头。

### PWA

`vite-plugin-pwa`（`registerType: 'autoUpdate'`）生成：

- `manifest.webmanifest`：`name: 记忆训练`、`display: 'standalone'`、`theme_color: #0f1115`、192/512/maskable 图标。
- `sw.js` + Workbox：预缓存 22 个静态资源（≈555 KiB），SPA 导航回退到 `index.html`，断网可用。
- `apple-touch-icon.png`（180×180）、`viewport-fit=cover`、`apple-mobile-web-app-capable` 等 iOS 元信息。

图标由 `scripts/generate-icons.mjs` 生成 —— 一个**无依赖的 PNG 编码器**（手写 zlib/CRC32/IHDR/IDAT），因为 iOS 的 `apple-touch-icon` 必须是真实 PNG，而引入一个光栅化库不划算。`npm run icons` 可重新生成，`prebuild` 会自动跑一次。

**添加到主屏幕**：手机浏览器打开站点 → Safari「分享 → 添加到主屏幕」/ Chrome「安装应用」→ 之后从桌面图标启动即为全屏应用，无浏览器地址栏。

---

## 六、数据备份与恢复

「设置 → 数据备份与恢复」：

- **导出数据**：把 `sources` / `concepts` / `cards` / `reviewLogs` / `settings` 全部导出为一个 JSON 文件下载。图片以 data URL 内嵌，因此备份是**完整**的。
- **导入数据**：选择 JSON 文件校验后**覆盖**恢复本地数据。

两条安全约定：

1. **API Key 永不进入备份文件**（`apiKeyIncluded: false`，导出文件里 `apiKey` 被置空），界面上也明确提示。导入时**保留本机已有的 Key**，所以恢复后不用重新填写。
2. 导入文件用 **Zod 严格校验**，格式不对会给出可读错误，不会写坏数据库。

---

## 七、部署到 Vercel

项目是纯静态 SPA，`dist/` 直接托管即可。

```bash
npm i -g vercel
vercel            # 首次会引导登录
vercel --prod     # 生产部署
```

或者在 Vercel 控制台里：

| 配置项 | 值 |
| --- | --- |
| Framework Preset | Vite |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Node.js Version | 20 或更高（`ts-fsrs` 要求 ≥ 24，开发机请用 24） |

`vite.config.ts` 里所有资源路径都是根相对（`/assets/…`、`/manifest.webmanifest`），没有配置 `base` —— 部署到域名根目录即可。若要部署到子路径，记得设置 `base` 并同步修改 manifest 的 `start_url` / `scope`。

**注意**：Service Worker 需要 HTTPS（`localhost` 除外），Vercel 默认提供 HTTPS，没问题。

---

## 八、运行

```bash
npm install
npm run dev        # 开发服务器（监听 0.0.0.0，手机可用局域网 IP 访问）
npm run build      # 类型检查 + 生产构建（产物在 dist/）
npm run test       # 48 项测试（管道 + 界面流程 + 备份）
npm run typecheck
npm run icons      # 重新生成 PWA 图标
```

### 局域网调试

`vite.config.ts` 里 `server.host = '0.0.0.0'`，所以同一 Wi-Fi 下的手机可以直接访问：

```
http://<你的局域网 IP>:5173
```

用 `ipconfig`（Windows）查 WLAN 的 IPv4 地址即可。

> ⚠️ 手机与电脑必须在同一网络；某些公司/学校 Wi-Fi 开启了「AP 隔离」，会导致手机访问不到电脑。
> 实在不行就改用 `npm run preview`（同样监听 0.0.0.0，端口 4173），或者用隧道工具把端口暴露出去。

### 验证步骤

1. `npm run dev` 后打开页面。
2. 进入「设置」填写 API Key（OpenAI 兼容或 Gemini），点「测试连接」确认连通。
   - 想用图片：填一个**视觉模型**名称（如 `gpt-4o-mini` / `gemini-2.0-flash`），留空则复用主模型。
   - 想用 AI 评判：把「作答后如何打分」切到 **AI 评判**。
3. 进入「输入」：
   - **文字**页签粘贴笔记 → 点「生成概念与卡片」。
   - **图片**页签拖拽/粘贴/选择图片 → 点「识别图片并生成卡片」。
4. 进入「学习」→ 卡片立即到期 → 只显示题干 → 回忆后回答 → 四档自评。
   - AI 评判模式下会先调模型给出反馈和建议档位，可直接采用也可改选。
5. 刷新页面：数据仍在，卡片按 FSRS 给出的日期到期。

**没有 API Key 也能先看界面**：开发模式下在浏览器控制台执行

```js
await __memory.seedDemo()   // 写入演示材料与 7 张卡片
location.reload()
```

`__memory.clear()` 可清空本地数据库。

---

## 九、阶段 3 待办

- 选择题 / 判断题生成、费曼式追问
- 跨主题交错练习
- 错因归因（写入 `ReviewLog.errorCause`）
- 本地到期提醒（Notification API）
