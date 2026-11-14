import type { Difficulty, QuestionType } from '../db/schema'

/** Instruction used for every call: keep the model on rails and JSON-only. */
export const SYSTEM_PROMPT = [
  '你是一个记忆训练系统的出题引擎。',
  '你的唯一职责是根据用户提供的材料出题；你绝不参与复习排期。',
  '始终用中文输出。所有输出必须是合法 JSON，不要输出解释文字，不要使用 Markdown 代码块。',
].join('\n')

export const CONCEPT_PROMPT = `你是一个记忆训练系统的「概念切分器」。用户会提供一段学习材料。

请把材料切分为原子概念（atomic concept）：
1. 一个概念只包含一个可独立测试的事实 / 定义 / 关系。
2. statement 必须是一句完整、可独立判断真假的陈述句。
3. 只使用材料中出现的信息，不要引入外部知识，不要编造。
4. 忽略抒情、主观感受等无法客观检验的内容。
5. title 是 3-12 字的概念名。
6. tags 最多 3 个，每个不超过 6 字。
7. 不要输出重复或高度重叠的概念。

严格输出如下 JSON：
{"concepts":[{"title":"","statement":"","elaboration":"","tags":[]}]}
其中 elaboration 可以省略。`

export interface ConceptPlanItem {
  index: number
  title: string
  statement: string
  /** Target difficulty for each question slot of this concept. */
  slots: Difficulty[]
  /** Target question format for each question slot of this concept. */
  formats: QuestionType[]
}

const FORMAT_LABEL: Record<QuestionType, string> = {
  qa: 'qa（问答）',
  cloze: 'cloze（填空）',
  choice: 'choice（单选）',
  truefalse: 'truefalse（判断）',
  feynman: 'feynman（费曼追问）',
}

export function questionPrompt(concepts: ConceptPlanItem[]): string {
  const blocks = concepts.map((concept) => {
    const slots = concept.slots
      .map(
        (difficulty, slotIndex) =>
          `  - 第 ${slotIndex + 1} 题，难度=${difficulty}，题型=${FORMAT_LABEL[concept.formats[slotIndex]]}`,
      )
      .join('\n')
    return `概念 ${concept.index}：${concept.title}\n  陈述：${concept.statement}\n${slots}`
  })

  return `你是「提取练习出题器」。请针对下面每个概念设计记忆提取题。

硬性规则：
1. 一题只考一个概念，禁止复合问题。
2. 题干尽量 ≤ 20 字，答案尽量 ≤ 50 字。
3. 每题必须严格符合指定的难度与题型。
4. 题干中不得出现答案。

各题型的额外要求：
- qa（问答）：直接提问，答案是完整的表述。
- cloze（填空）：题干用 {{...}} 标记被挖空的部分，答案就是被挖掉的内容本身。
- choice（单选）：必须给出 4 个选项（options），只有 1 个正确，correctIndex 是正确项下标。
  * 干扰项必须「像对的」：可以取自材料里的相邻概念、常见误解、错误的数值或颠倒的因果关系。
  * 禁止出现「以上都对」「以上都不对」这种废话选项。
  * 禁止出现明显荒谬或一眼假的选项；干扰项要让人犹豫。
  * 正确项的位置必须随机，不能总是第一个。
- truefalse（判断）：题干是一句陈述句，答案只能是「正确」或「错误」。
  * 出「错误」题时，陈述必须「像对的」：把材料里的真实信息做小幅改动（交换两个概念、改掉数值、颠倒因果、去掉关键限定词），
    而不是写成一眼假的胡说。
  * 「正确」题与「错误」题大致各占一半。
- feynman（费曼追问）：题干是「用自己的话解释 X，并指出一个常见误解」这类要求。
  答案要包含两个部分：期望的解释要点 + 那个常见误解是什么。

难度定义：
- easy：直接复述材料原句即可作答。
- medium：需要在材料基础上做一次简单转换或推理。
- hard：需要跨句整合，或需要与相近概念做辨析。

待出题的概念：
${blocks.join('\n\n')}

严格输出如下 JSON（conceptIndex 与 slotIndex 必须与上面一致，type 必须是上面指定的题型）：
{"questions":[{"conceptIndex":0,"slotIndex":0,"type":"qa","prompt":"","answer":"","difficulty":"medium"}]}
选择题额外输出 "options":["…","…","…","…"] 和 "correctIndex":0。`
}

export function balancePrompt(
  items: Array<{ index: number; prompt: string; difficulty: Difficulty }>,
  targets: Record<Difficulty, number>,
): string {
  const list = items
    .map(
      (item) =>
        `  ${item.index}｜${item.prompt.slice(0, 40)}｜当前难度=${item.difficulty}`,
    )
    .join('\n')

  return `下面是本次生成的题目列表及其当前难度标签。
目标配比：简单 ${targets.easy} 题、中等 ${targets.medium} 题、困难 ${targets.hard} 题。

请只调整 difficulty 标签，使得三档数量恰好等于目标数量；不得修改题干、答案、conceptIndex、slotIndex。
在语义允许的前提下，尽量让标签仍然符合题目本身的难度。

${list}

严格输出如下 JSON：
{"labels":[{"index":0,"difficulty":"easy"}]}`
}

/* ------------------------------------------------------------------ *
 * Stage 2 prompts
 * ------------------------------------------------------------------ */

export const IMAGE_EXTRACTION_PROMPT = `你是一个图片内容识别器。用户上传了一张图片，可能是笔记截图、文档照片、白板、手写笔记、流程图或照片。

请识别图片中的内容，输出结构化 JSON：
{
  "text": "图片中出现的全部文字，按阅读顺序整理。保持原文语言，不要翻译。图表请写出标题、标签与数值。",
  "title": "根据图片内容推断的简短标题（不超过 20 字）",
  "language": "主要语言，例如 zh / en",
  "hasFormula": "图片中是否包含公式或数学表达式",
  "semanticSummary": "用 1-3 句话概括这张图在讲什么。如果图片文字很少（纯照片、示意图、插图），请在这里详细描述图中的语义信息。"
}

要求：
1. 只描述你确实看到的内容，不要编造，不要补充图片里没有的知识。
2. 手写文字尽量辨认；确实无法辨认的部分用 [?] 标注。
3. text 与 semanticSummary 至少要有一个非空。
4. 严格输出 JSON，不要输出解释文字，不要使用 Markdown 代码块。`

export const JUDGE_PROMPT = `你是一个记忆训练系统的判卷器。

下面是三段内容：
- 题目：用户被要求回忆的原子概念
- 参考答案：唯一正确的表述
- 用户的作答：自由文本（可能是手写图片，需要你识别其中的文字），可能不完整、可能有错别字、可能答非所问、也可能完全正确

请比较用户的作答与参考答案，给出评级。

suggestedRating 的含义（1-4）：
- 1 (Again)：答错、答非所问，或完全没有提到关键要点。
- 2 (Hard)：提到了部分要点，但有明显缺失或表述含糊。
- 3 (Good)：核心要点正确，表述略有出入或不够完整。
- 4 (Easy)：完全正确，且表达清晰完整。

verdict 必须与 suggestedRating 自洽：
- correct 对应 suggestedRating 为 3 或 4
- partial 对应 suggestedRating 为 2 或 3
- incorrect 对应 suggestedRating 为 1

feedback：一句话说明为什么给这个分，指出用户漏掉或答错的地方（不超过 60 字）。

严格输出如下 JSON：
{"verdict":"correct","feedback":"...","suggestedRating":3}`

export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  qa: '问答',
  cloze: '填空',
  choice: '选择',
  truefalse: '判断',
  feynman: '费曼追问',
}
