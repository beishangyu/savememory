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
    │   ├── MemoPage.tsx        #   备忘录
    │   └── SettingsPage.tsx    #   模型接口 / 视觉模型 / 评判方式 / 调度参数
    │
    ├── components/
    │   ├── GradeButtons.tsx    #   Again / Hard / Good / Easy 四档按钮
    │   ├── ImageDropzone.tsx   #   图片拖拽 / 粘贴 / 选择 / 拍照上传区
    │   ├── TabBar.tsx          #   手机底部 Tab Bar（内联 SVG 图标）
    │   ├── AttributionPanel.tsx#   错因归因面板（遗忘 / 混淆 / 没理解）
    │   ├── HandwritingCanvas.tsx #  压感手写画布（页内作答）
    │   ├── GlobalInkLayer.tsx  #   全局手写覆盖层（任意页面）
    │   ├── InkStylePicker.tsx  #   墨色 + 压感强度（两处共用）
    │   └── BlobImage.tsx       #   Blob → 图片渲染
    │
    ├── hooks/
    │   ├── useDueCount.ts      #   到期卡片数轮询（导航徽标）
    │   ├── useMediaQuery.ts    #   响应式断点（顶栏 ↔ 底部 Tab 切换）
    │   ├── useReminders.ts     #   到期徽标 + 本地通知调度
    │   └── useInkSurface.ts    #   画布核心逻辑（指针规则 / 压感 / 撤销）
    │
    ├── lib/                    # ── 通用工具
    │   ├── id.ts               #   uuid
    │   ├── date.ts             #   日期格式化
    │   ├── json.ts             #   从模型回复中稳健提取 JSON
    │   ├── image.ts            #   图片降采样、base64 转换、Blob 读写
    │   └── handwriting.ts       #   笔迹：指针判定、压感宽度、导出
    │
    ├── services/
    │   ├── ingest.ts           # 端到端管道：材料 → 概念 → 题目 → 卡片
    │   ├── session.ts          #   会话队列排序（交错练习）
    │   ├── reminder.ts         #   徽标与到期通知
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
        ├── stage3.test.ts      #   阶段 3 交错 / 题型 / 归因 / 提醒测试
        ├── stage3.ui.test.tsx  #   阶段 3 单选题界面测试
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

### `Memo` —— 备忘录

随手记下的想法，与学习材料解耦（也可以一键转成学习材料）。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 主键 |
| `title` | `string` | 标题（可空） |
| `content` | `string` | 正文 |
| `handwriting` | `Blob?` | 手写版本，存为 PNG |
| `createdAt` / `updatedAt` | `number` | epoch ms |
| `pinned` | `boolean` | 置顶，排在列表最前 |
| `sourceId` | `string?` | 转为学习材料后指向 `Source.id` |
| `cardCount` | `number?` | 那次转换生成的卡片数 |

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
memos:       id, updatedAt
```

> 数据库版本 v2 新增了 `memos` 表。这是一次**纯增量升级**：Dexie 只会新建这张表，
> 已有数据一行不动（已用「从 v1 升到 v2 不丢数据」的测试守住这条线）。

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

### 部署到 Vercel

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

### 贡献者：本地开发

```bash
npm install
npm run dev            # http://localhost:5173
npm test               # 单元 + 界面测试
npm run typecheck
npm run lint
```

**调试设备相关行为**（手写、手势等在不同品牌平板上差异极大）：

```bash
npm run dev
# 平板打开 http://<局域网 IP>:5173/#diag
```

诊断页会把原始指针/滚动事件回传到开发机（写入 `diag/telemetry.jsonl`），用来定位只有真机才复现的问题。
详见 [KNOWN_ISSUES.md](./KNOWN_ISSUES.md)。

---

## 八、运行

```bash
npm install
npm run dev        # 开发服务器（监听 0.0.0.0，手机可用局域网 IP 访问）
npm run build      # 类型检查 + 生产构建（产物在 dist/）
npm run test       # 109 项测试（管道 + 界面流程 + 备份 + 阶段 3 + 备忘录 + 手写）npm run typecheck
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
>
> dev server 强制 `Cache-Control: no-store` —— 设备上不会缓存旧包；
> 工具栏里的版本号（`v1.0.0 · 时间`）可以确认跑的是哪一份代码。

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

## 九、阶段 3：学习体验增强

### 新题型

出题时不再只有问答/填空，设置页可以勾选允许的题型：

| 题型 | 说明 | 判定方式 |
| --- | --- | --- |
| `qa` 问答 | 直接提问 | 自由文本 → AI 评判 / 自评 |
| `cloze` 填空 | 挖掉原文关键词（`{{...}}`） | 自由文本 → AI 评判 / 自评 |
| `choice` 单选 | 4 个选项，1 个正确 | **本地直接判定**，不调用模型 |
| `truefalse` 判断 | 陈述句真假 | **本地直接判定**，不调用模型 |
| `feynman` 费曼追问 | 用自己的话讲清 + 指出常见误解 | 自由文本 → AI 评判 / 自评 |

几个实现细节：

- **难度配比 30/50/20 不受影响**：出题前先算好每个槽位的难度与题型（`buildQuestionPlan`），所以配比是**构造**出来的，不是碰运气。
- **单选题的干扰项**在提示词里被明确要求「像对的」：取自相邻概念、常见误解、错误数值或颠倒的因果，禁止「以上都对」这类废话选项，禁止一眼假的选项，并要求正确项位置随机。
- **判断题的错句**同样要求「像对的」：把材料里的真实信息做小幅改动（交换两个概念、改掉数值、颠倒因果），而不是写一句胡说。
- **类型以内容为准，不信模型自报的 `type`**：模型如果把答案写成了「正确/错误」但标成 `qa`，我们会识别出它其实是判断题；选项不全、选项重复、答案不是「正确/错误」则降级回问答题，绝不产出半成品。
- 单选/判断题**在本地判定**：选对 → 建议「良好」，选错 → 建议「重来」，全程不请求模型，因此离线也能用、也不消耗额度。用户仍然可以改选其它档位。

### 交错练习

一次会话里的卡片不再是一个主题刷到底。`buildSessionQueue` 两层轮转：

```
卡片 → 按材料（主题）分组 → 组内再按概念分组 → 两层 round-robin
```

结果是**相邻两张卡片必定来自不同主题**；同一主题下的不同概念也会交叉出现。设置页可切换回「按到期顺序」（纯 FSRS 顺序）。会话结束时会显示本次覆盖了多少个主题。

> 为什么值得做：集中练习（blocking）短期感觉更轻松，长期保留效果反而更差。交错练习是低成本版本的做法。

### 错因归因

答错（选「重来」，或 AI 判定为 incorrect）后会先问一句「这道题为什么没记住？」，三个选项：

| 归因 | 含义 | 后续策略 |
| --- | --- | --- |
| 忘记了 | 学过，但想不起来 | 交给 FSRS 拉长间隔，间隔本身会自然变长 |
| 混淆了 | 和别的概念搞混了 | 在卡片库标为「易混淆」，提示需要对比相邻概念 |
| 没理解 | 当初就没搞懂 | 在卡片库标为「需要重学」——这种情况不该按「遗忘」算遗忘，应重新学 |

选择结果写入 `ReviewLog.errorCause`，跳过则不记录。卡片库会按概念汇总并打出「需要重学 / 易混淆 / 易遗忘」标签，复习历史里也能看到每次的错因。

### 到期提醒

- **徽标**：应用图标与页面标题显示到期数量（`(3) 记忆训练`）。Chrome/Edge 上还能用 PWA Badge API 直接在图标上显示数字。
- **本地通知**：到期时弹出通知。
- **只提醒「有多少张到期」，绝不包含卡片内容** —— 看一眼通知不算复习，否则会悄悄污染复习计划。通知正文固定为「有 N 张卡片到期了，打开应用开始复习。」
- 提醒在设置页开关，并可单独授予通知权限；没有权限时仍可用徽标查看到期数量。

---

## 十、备忘录

底部 Tab Bar 新增「备忘」页（手机上 5 个标签）。

| 能力 | 说明 |
| --- | --- |
| 快速记录 | 一个「＋ 写一条」按钮，标题可选，写完保存 |
| 编辑 / 删除 | 行内编辑，随时改；删除后不留残留 |
| 置顶 | 置顶的备忘永远排在列表最前 |
| 搜索 | 按标题或正文过滤 |
| **一键转为学习材料** | 备忘内容 → 走完整的「概念切分 → 出题 → FSRS」管道 |

「转为学习材料」是备忘录和主线功能的连接点：随手记下的东西不用重抄一遍，
点一下就变成可复习的卡片。转换完成后备忘上会显示「已生成 N 张卡片」，
原始备忘保留，随时可以改写后重新生成。

备份 / 恢复同样包含备忘录。

---

## 十一、手写（Apple Pencil）适配

iPad 上用手写笔直接作答或记事。三个入口：**学习页的作答区**、**备忘录页**、**全局覆盖层**。

### 全局手写覆盖层

任何页面右下角一个 `✍` 按钮（宽屏时顶部导航栏也有「✍ 手写」），点开即在**整个应用之上**铺一层透明画布，可以直接写在当前看到的任何内容上。

| 控件 | 作用 |
| --- | --- |
| 仅手写笔 / 手指也能写 | 切换指针模式（**仅页内画布有**；全局覆盖层固定为仅手写笔） |
| 撤销 / 清空 | 笔画级操作 |
| 保存 | 把当前笔迹导出为 PNG 下载（**不是必须**——不保存也能用） |
| 关闭 | 退出覆盖层 |
| 指针类型：xxx | **诊断信息**：显示设备实际上报的 `pointerType` |
| 画布：W×H | **诊断信息**：画布的实际尺寸（应等于视口尺寸） |
| 事件 ↓n →n ↑n ✕n ｜ 笔画 n（点 n） | **诊断信息**：实时事件与采样点计数 |

**核心行为（手写笔模式）**：只有手写笔能落笔，**手指完全不参与绘制**——手指只是正常地滑动页面，不会在屏幕上留下一道墨迹。这正是平板上的真实场景：手掌搭在屏幕边缘、另一只手拿笔写字。

> **笔只能写，手指只能滑。**
>
> - 覆盖层打开期间，页面被**整体锁定**（`documentElement` 的 `touch-action: none`）。
>   锁必须**在笔落下之前**就生效 —— 浏览器是在手势**开始那一刻**计算 `touch-action` 的，
>   如果等到 `pointerdown` 里再锁，这一次笔迹照样能拖动页面。
> - 因此**手写笔无法拖动页面**，**手指的滚动由应用自己驱动**（并补了一点惯性），
>   而手指的点击、选择等能力完全不受影响。
> - 覆盖层画布是 `position: fixed`，**始终固定在视口**，页面滚动时它不跟着移动，
>   笔迹也就始终贴着笔尖。
>
> 工具栏上的模式切换按钮已被移除——它曾让「手指也能写」被误开，这正是手指画出墨迹的原因。
>
> 若某台设备把笔**误报成 `mouse`**（部分安卓/鸿蒙浏览器会这样），全局手写将无法识别它；
> 这种设备请用**页内画布**（学习页/备忘录）的「自动」模式，它同时接受 `pen` 与 `mouse`。

### 跨品牌兼容（这一节是踩过坑之后写的）

各家平板/浏览器对笔的**上报方式并不统一**，最初的实现只认 `pointerType === 'pen'`，在华为平板上完全画不出来。现在按下面几层处理：

1. **画布不拦截指针事件**（`pointer-events: none`），指针监听挂在 **window** 上。
   这样页面保留**原生滚动**与**原生焦点**行为，不依赖各家对 `touch-action` 的不同实现。
2. **手写笔模式只拒绝 `touch`**，不强制要求 `pointerType === 'pen'`。
   鼠标永远不会是搭在屏幕上的手掌，所以接受它是安全的；而很多安卓/鸿蒙浏览器**把笔报成 `mouse`**，只认 `pen` 的话这些设备就完全不能用。
3. **`pointerdown` 不调用 `preventDefault()`**。
   这一条很关键：取消 pointerdown 会连带取消浏览器默认的**聚焦**行为，导致覆盖层打开时**整个应用的输入框都点不进去**（焦点永远留在 `autoFocus` 的那个元素上）。滚动与选中问题改由 `pointermove` 阶段取消，并配合 `user-select: none`。
4. **只有正在画的那根指针才会被取消**（`pointermove` 阶段 `preventDefault`）——手指在笔模式下压根不会被接受，因此页面照常滚动。
5. **不支持 Pointer Events 的浏览器自动降级**到 Touch Events + 鼠标事件；Touch 路径下用 `force`（真实压感）粗略区分笔与手指。
6. **手指模式下**才把 `document.documentElement` 的 `touch-action` 设为 `none`（手指要画，就不能让页面滚）；笔模式不设，手指才能滚动。
7. **画布必须在挂载时立刻定尺寸**。全局覆盖层的 canvas 是「打开时才渲染」的，如果尺寸逻辑只在组件挂载时跑一次，那会儿元素还不存在，画布会停留在默认的 **300×150** —— 写在屏幕中部的笔迹全部落在画布之外，**看起来就是完全不出墨**（但笔确实被检测到了）。因此用的是 **callback ref**：元素一挂载就立刻按视口尺寸分配后备存储。
8. **笔的 `pointerdown` 必须被取消，鼠标的不能。**
   - 取消笔的 pointerdown：浏览器就不能在这时候启动滚动手势。安卓上**手掌落到屏幕上就足以触发一次手势识别**，随之而来的是 `pointercancel` —— 笔画会被**从中断掉**，表现就是「落笔前一秒有墨、后面没有了」。
   - 鼠标**不取消**：取消 pointerdown 会连带取消浏览器默认的**聚焦**行为，导致覆盖层打开时整个应用的输入框都点不进去。
   - 同时对笔调用 `setPointerCapture`，保证事件持续送达。
9. **笔尖落下期间锁定页面手势**（`documentElement` 临时 `touch-action: none`），笔尖抬起即恢复。这样手掌再落到屏幕上也不会打断正在写的笔画，而手指平时照常滚动页面。
10. **被浏览器掐断的笔画会被接续**。`pointercancel` 之后保留墨迹与笔画状态（后续 move 仍能继续延伸），并记住这一笔；下一次落笔**接着画**而不是另起一笔，用户不会看到断成两截的笔画。
11. **绘制由「移动」驱动，而不是「按下」。**
    浏览器随时可能因为手掌手势而取消 `pointerdown`；如果笔画只在 `pointerdown` 时建立，
    那一次落笔就白费了。因此当某个指针移动过来却**没有活动笔画**时，就地建立一笔。
    再配合「悬停不画」（`buttons === 0`）与「被掐断的笔画下一笔接续」，
    无论浏览器怎么取消，笔迹都不会丢。
12. **绘制过程中绝不调用 `preventDefault()`**（`pointermove` 尤其不能）。
    Chrome 在 `pointermove` 被取消后会**停止投递该指针的原始数位板采样**，笔画会在两三个点后"枯竭" —— 表现正是「一次落笔只换来 3 个移动事件、笔迹写不完」。防选中改用 CSS（`user-select: none` / `-webkit-touch-callout: none`），防滚动改用 `touch-action`，两者都不影响事件流。

13. **优先使用 `pointerrawupdate`（原始数位板采样流）。**
    这是关键的一条。某些平板/浏览器（尤其是安卓与鸿蒙）**每次落笔只投递两三个 `pointermove`
    就把指针取消了** —— 实测华为平板上是 `↓28 →54 ✕22`，即每次落笔平均只有 2 个采样点，
    于是笔迹成了「两点之间的直线」。
    `pointerrawupdate` 是 Chrome 为此提供的接口：**数位板的每一个原始采样都会触发一次**，
    **不受帧率合并影响，也不会因为手势/防误触而取消**。它不冒泡，所以监听必须注册在**捕获阶段**。
    浏览器不支持时（Safari）自动退回 `pointermove`。
    工具栏里的 `⟂` 就是原始采样的计数。
14. **手势锁定跟随覆盖层的整个生命周期**，而不是「笔按下期间」。
    `touch-action` 由浏览器在**手势开始那一刻**评估，若在 `pointerdown` 处理器里才锁定，
    这一笔照样能拖动页面。所以锁在覆盖层打开时就设上，直到关闭才解除。
    代价是浏览器原生滚动被禁用，因此**手指的滚动由应用自己驱动**（含惯性）。

15. **墨迹用「偏移补偿」钉在屏幕上，而不是依赖 `position: fixed`。**
    `position: fixed` 在部分安卓/鸿蒙浏览器上并不可靠 —— 页面滚动时覆盖层会跟着一起滚，
    笔迹就被抬走了。因此每次滚动/缩放/挂载时都测量画布相对视口原点的漂移量，
    绘制时把这个位移抵消掉。笔迹坐标因此恒等于**屏幕坐标**，
    无论 `fixed` 是否生效，墨迹都稳稳停在原地。
    另外覆盖层画布被 **portal 到 `<body>`**，这样任何祖先元素上的 `transform` / `filter`
    都不会把 `fixed` 变成「相对某个容器定位」。
16. **绘制路径上绝不取消任何指针事件。**
    Chrome 一旦取消 `pointerdown` / `pointermove`，就**停止投递该指针的原始数位板采样**。
    实测平板（Chrome 116 / Android）：诊断页不做任何取消 → 笔的原始采样是 `pointermove` 的
    **14 倍**（184 vs 13）；而应用取消 pointerdown 之后，原始采样只剩 19 个、移动事件却有
    918 个 —— 笔画因此只剩「两点之间的直线」。
    手势改由 `touch-action: none` 阻止（覆盖层打开期间一直生效），不再依赖取消事件。
17. **笔画存在 React 树之外，组件重挂载也不会丢。**
    开发模式下 React 的 `<StrictMode>` 会故意挂载→卸载→再挂载一次，用来暴露副作用问题。
    笔画原本放在 `useRef` 里，第二次挂载时 ref 被重置 → **墨迹整片消失**，
    只剩最新那一笔 —— 看起来就像「墨迹在页面滑动时乱跳」。
    现在笔画存放在模块级注册表里（按画布区分），重挂载后可以原样重绘；
    覆盖层关闭时再显式清空（它是临时批注层，不是要保留的画作）。
    工具栏里的「挂载 N」就是用来盯这件事的。
18. **版本标识常驻可见。** 工具栏与「设置 → 关于」里都显示 `v1.0.0 · 构建时间`，
    dev server 也强制 `Cache-Control: no-store`。
    设备上偶尔会跑到缓存的旧包，版本号能一眼确认跑的是哪份代码 —— 这在调试手写这类
    强依赖浏览器行为的特性时是刚需。

### 设备诊断（`#diag`）

手写这类特性在不同品牌平板上行为差异极大，桌面上无法复现。因此 dev server 内置了一个
采集端点：平板把原始事件直接回传到开发机。

平板打开 `http://<lan-ip>:5173/#diag`：

1. 点「打开全局手写」—— 诊断的是**真实覆盖层**，测出来的就是它的行为
2. 点「开始采集」
3. 用笔写字，用手指滑动页面
4. 点「上报数据」

数据写入 `diag/telemetry.jsonl`（已 gitignore），包含：全部原始指针事件、每条事件时刻的画布位置
与 `scrollY`、真实覆盖层墨迹的屏幕坐标（用来算漂移）、UA / 视口 / 设备能力、以及构建号。

### 真实浏览器验证

用真实 Chrome 派发合成笔事件验证：

```
事件 ↓4 →0 ⟂8 ↑1 ✕3 ｜ 笔画 1（点 12）
```

- **原始流正常**：`⟂8` 个采样，而 `pointermove` 为 `→0`
- **跨取消自动接续**：4 次落笔、其中 3 次被 `pointercancel` 掐断，最终仍是**一笔连贯的线**（笔画 1，12 个点）
- 手指与鼠标**不产生任何墨迹**
- 覆盖层开启时，输入框仍能正常聚焦与输入
- **笔拖不动页面**（实测位移 0px），**手指能滑动页面**（由应用驱动）
- **墨迹恒定钉在屏幕上**：画完时、画布被带着上移 150px（模拟 `fixed` 失效）时、
  页面真实滚动 250px 时、之后再用手指滚动时 —— 四种情况下墨迹的屏幕坐标均为 **297.33**，纹丝不动

> **华为平板自查**：如果笔仍然不落笔，打开「设置 → 无障碍 → 手写笔（Stylus）」，确认系统已识别笔，并关闭「不允许触发系统手势」一类选项——华为系统默认会让笔在屏幕边缘触发返回导航，这会吃掉笔的输入。
>
> 排查时先看工具栏的两个诊断值：**「指针类型」**告诉你设备把笔报成了什么（`pen` / `mouse` / `touch`），**「画布：W×H」**告诉你画布是否被正确铺满（应等于屏幕尺寸）。这两个值能直接把问题定位到「输入识别」还是「渲染」环节。

### 墨色与压感强度

**全局覆盖层**和**页内画布**共用同一套样式设置（`InkStylePicker`），一处改、两处生效。

| 控件 | 说明 |
| --- | --- |
| 墨色 | 8 个预设色（白 / 蓝 / 青 / 绿 / 黄 / 橙 / 红 / 粉）+ 一个自定义取色器 |
| 压感强度 | 0% – 100% 的滑杆 |

**压感强度的含义**：它控制「笔压对线宽的影响幅度」。

- **0%** → 所有笔画粗细完全一致，笔压被忽略（适合压感不稳定的设备，或想要钢笔般的匀速效果）。
- **100%** → 使用完整线宽范围（页内画布 2.2px → 6.5px，全局覆盖层 2.4px → 7px），下笔轻收笔重。

实现上不是简单地缩放笔压，而是**收缩线宽区间**：`applyPressureStrength(base, max, strength)` 把 `max` 拉向 `base`，所以 0% 时上下限相等 → 恒定粗细。

笔画是以**向量**保存的（点序列），不是像素缓冲。因此换颜色或调压感之后，**已有的笔迹会立刻按新样式重绘**，不用清空重写。

选择结果存在 `Settings`（`inkColor` / `inkPressure`），因此**刷新后保留，并且会随备份文件一起导出**。

### 画布行为

| 特性 | 实现 |
| --- | --- |
| **压感笔迹** | 笔压映射到线宽（2.4px → 7px），下笔轻、收笔重，笔迹有粗细变化 |
| **防误触（防手掌）** | 一旦检测到笔（`pointerType === 'pen'`），自动屏蔽手指输入 |
| **采样保真** | 使用 Pointer Events 的 `getCoalescedEvents()`，取回数位板每一帧的真实采样点。**全局覆盖层同样使用**——只用每帧一个点的话，快速书写时相邻采样点间距超过笔宽，线条就会变成**点状虚线**，而且看起来只剩「一笔的开头」是连续的 |
| **pointerId 容错** | 某些浏览器在 `pointerdown` 与 `pointermove` 之间会换一个 `pointerId`。此时事件会按「同类型指针、且当前只有一条活动笔画」匹配上，笔画不会在第一个点就断掉 |
| **渲染成本** | 笔画以**向量**保存，渲染时按「逐段描边 + 圆角端点」画，代价随采样点数线性增长——而不是每个采样点画一个圆（那样每次移动都要重画 N 个圆，笔一快就掉帧） |
| **HiDPI** | 画布按 `devicePixelRatio`（上限 3x）分配后备存储，Retina 屏上笔迹不糊 |
| **不抢手势** | 画布 `pointer-events: none` + 页面保留原生滚动 |
| **多点同时书写** | 按 `pointerId` 分别追踪，笔和手指可以同时画（手指模式下） |
| 撤销 / 清空 | 撤销删除最后一笔；清空整块画布 |

用 Pointer Events 而非 Touch Events，是为了用同一套代码同时支持**手写笔、鼠标、手指**——桌面上也能用鼠标写字调试。

`useInkSurface` 把指针规则抽成唯一的实现，学习页画布和全局覆盖层共用同一套逻辑（防误触、合并采样、多点笔迹），避免两处各写一遍却在细节上跑偏。

### 手写内容怎么用

- **学习页（AI 评判模式）**：切到「手写笔」作答 → 点「提交答案」，画布导出成 PNG，**交给视觉模型识别手写内容后再评级**，判定与打字作答走完全同一条路径（同样的 Zod 校验、同样的一致性检查、同样失败降级为手动评分）。
- **备忘录**：切到「手写笔」写备忘 → 手写图像以 PNG Blob 存在本地 → 点「转为学习材料」时走**图片管道**（视觉模型读图 → 概念切分 → 出题 → FSRS），和上传一张笔记截图是同一条路径。
- **全局覆盖层**：只做标注，**不落盘**；需要保留时用「保存」导出 PNG。

### 已知边界

- 手写识别由视觉模型完成，**字迹潦草时识别率有限**——识别错了会直接体现为评分偏差，这是模型能力边界，不是调度问题。
- 编辑一条已有手写备忘时，画布**不会回填**旧笔迹（不写新内容则保留原手写图）。
- 手写答案**不会留在本地**：评判完即用于一次请求，不落盘（只有你的文字输入、手写备忘和手动导出的 PNG 会保存）。

---

## 十二、阶段 4 待办

- 错因归因的**自动策略**：把「混淆」的概念自动补一道对比题
- 间隔重复的每日目标 / 连续天数等轻量激励
- 卡片编辑与手写补充（不改 AI 生成结果的措辞）
