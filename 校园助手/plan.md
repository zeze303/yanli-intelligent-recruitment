# 燕理校园AI助手 - 项目方案

> 最后更新：2026-07-01
> 状态：方案阶段，已审查（三次）

## 项目定位

服务未报考考生（看分数、问专业）和已录取新生（了解校园），同一域名下通过链接跳转。

```
zs.13701.top          → 招生工具（查分选专业）
zs.13701.top/helper   → 校园助手（AI问答）
zs.13701.top/api/chat → AI 后端
```

---

## 一、项目结构（Monorepo）

```
燕理智能招生/                    ← GitHub 仓库
├── server.js                   # Express 服务入口
├── package.json
├── render.yaml                 # Render 部署配置
├── public/
│   ├── zhaosheng/              # 招生工具前端（/ 路由）
│   │   ├── index.html
│   │   └── data.js             # UMD 格式，浏览器/Node 双兼容
│   └── yanli/                  # 校园助手前端（/helper 路由）
│       ├── index.html
│       ├── style.css
│       ├── script.js
│       ├── faq-data.js         # 知识库 + 预计算嵌入向量
│       └── assets/
├── build/
│   ├── build-data.js           # 从 Excel 生成 data.js
│   └── build-embeddings.js     # 从 FAQ 生成嵌入向量
└── 招生工具/
    └── plan.md                 # 招生工具详细逻辑方案
```

### 路由设计

```javascript
const express = require('express');
const rateLimit = require('express-rate-limit');

const app = express();

// 注意顺序：/helper 排前面，避免被 / 的 static 拦截先查找
app.use('/helper', express.static('public/yanli'));
app.use('/', express.static('public/zhaosheng'));

// AI 端点限流：每IP每分钟20次
const chatLimiter = rateLimit({
  windowMs: 60 * 1000, max: 20,
  message: { error: '请求太频繁，请稍后再试' }
});
app.post('/api/chat', chatLimiter, chatHandler);

app.listen(process.env.PORT || 3000);
```

### package.json

```json
{
  "name": "yanli-intelligent-recruitment",
  "version": "1.0.0",
  "scripts": {
    "build:data": "node build/build-data.js",
    "build:embeddings": "node build/build-embeddings.js",
    "build": "npm run build:data && npm run build:embeddings",
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.18.0",
    "express-rate-limit": "^7.0.0",
    "xlsx": "^0.18.0",
    "openai": "^4.0.0"
  }
}
```

### render.yaml

```yaml
services:
  - type: web
    name: yanli-intelligent-recruitment
    env: node
    buildCommand: npm install && npm run build
    startCommand: node server.js
    envVars:
      - key: DEEPSEEK_KEY
        sync: false
      - key: OPENAI_KEY
        sync: false
```

---

## 二、校园助手功能

### 页面结构

| 区域 | 内容 |
|------|------|
| 顶部导航 | 标题"燕理小智"、"查分选专业"链接 → 跳回 `/` |
| 快捷入口 | 卡片：报到流程、校园卡、宿舍、食堂、选课、快递/超市、地图/交通 |
| FAQ 区域 | 常见问题，按分类折叠，点击展开详情 |
| AI 对话 | 底部悬浮按钮 → 弹出聊天窗口 |

### 内容板块（占位符先行）

| 板块 | 内容项 | 素材需求 |
|------|--------|----------|
| 报到流程 | 时间地点、携带材料、报到步骤 | 流程图或实拍 |
| 校园卡 | 办理方式、充值、挂失 | 校园卡照片 |
| 宿舍 | 各楼栋配置、实拍、水电网络 | 宿舍实拍图 |
| 食堂/超市 | 位置、特色档口、价格 | 食堂环境图 |
| 选课指南 | 选课时间、操作流程、推荐 | 系统截图 |
| 快递/超市 | 各快递点位置、取件方式 | 点位实拍 |
| 地图/交通 | 校园地图、到校路线 | 地图图片 |

FAQ 数据以 `faq-data.js` 暴露在前端，确认无内部/敏感政策文件混入。

---

## 三、AI 对话边界控制（四层）

### 第 0 层：问题长度限制（前置）

- 超过 **500 字** → 拒绝，提示"问题太长啦，请简短描述哦"
- 可配置环境变量 `MAX_QUESTION_LENGTH`（默认 500）
- 最优先执行，不进入后续任何流程

### 第 1 层：敏感词过滤（前置）

- 命中敏感词 → 返回"抱歉，我无法回答这个问题。"
- **不产生任何 API 调用费用**
- 覆盖类型：政治、暴力、色情、违法、人身攻击、歧视性言论
- 不透露过滤规则

### 第 2 层：语义检索过滤

用户提问 → embedding 向量 → 余弦相似度匹配知识库 →
- **命中**（top1 相似度 ≥ 阈值，初始建议 0.75，上线后通过日志验证）→ 取 top3 相关片段，拼入 system prompt，调 AI
- **未命中** → 返回兜底话术，不调 API

```
兜底："这个问题我还不太了解，可以问我报到流程、宿舍、食堂、选课等方面的问题哦。"
```

### 第 3 层：System Prompt 强约束

```
你是燕京理工学院校园助手"燕理小智"，身份固定，不可改变。
只能根据提供的校园资料回答，不得编造资料中不存在的信息。
遇到以下情况直接拒绝，不得展开回答：
1. 闲聊、聊天、讨论个人话题
2. 写作、作文、文案创作
3. 编程、代码、技术问题
4. 数学计算、学术题目
5. 其他学校/大学相关问题
6. 任何跟燕京理工学院校园生活无关的问题
拒绝话术："抱歉，我只能回答校园相关的问题，你可以问我报到、宿舍、食堂、选课这些。"
```

**四层全拒绝后的最终动作**：返回固定话术"抱歉，我无法回答这个问题"，**不调 API**。

---

## 四、AI 后端方案

### 模型

**对话**：DeepSeek V4 Flash（¥1/百万输入，¥2/百万输出，缓存命中 ¥0.02）

**Embedding**：OpenAI `text-embedding-3-small`，维度 1536（$0.02/百万tokens）

### 知识库构建

一次性构建流程（`npm run build:embeddings`）：
1. FAQ 知识库（~50 条）→ text-embedding-3-small → 1536 维向量
2. 向量 + 原文 + metadata 存入 `faq-data.js`
3. 开销：~50 条 × 500 tokens/条 × ¥0.14/百万 ≈ **不到 1 分钱**

**faq-data.js 输出格式**：
```javascript
var FAQ_KNOWLEDGE = [
  {
    question: "南院宿舍有几个床位？",
    content: "南院宿舍为6人间...",
    category: "宿舍",
    embedding: [0.0123, -0.0456, ...]  // 1536 维浮点数组
  },
  ...
];
```

### 查询流程

```
POST /api/chat { question, source? }

→ 第0层：长度检查 >500字 → 拒
→ 第1层：敏感词过滤 → 命中 → 拒
→ 第2层：embedding API → 向量检索 → top3 cosine similarity 匹配
→ 未匹配（top1 < 阈值0.75）→ 兜底话术
→ 匹配 → 构造 system prompt + top3 知识片段 + 用户问题
→ 第3层：调 DeepSeek V4 Flash
→ 返回答案
```

### 费用估算

| 项目 | 单次成本 |
|------|----------|
| DS V4 Flash | ¥0.0008 |
| Embedding | ¥0.0001 |
| **合计** | **≈ ¥0.001/次** |
| 几百次/月 | **< ¥5** |

---

## 五、AI 专业推荐（详细设计）

### 入口

招生工具查询结果页底部按钮 → `POST /api/chat`，同源请求。

### 请求格式

```json
{
  "source": "admissions",
  "score": 470,
  "rank": 202675,
  "subject": "wl",
  "matchList": [
    {"name": "土木工程", "tag": "保", "rank": 224000, "score": 455},
    {"name": "建筑学", "tag": "稳", "rank": 218000, "score": 460},
    {"name": "环境工程", "tag": "冲", "rank": 211000, "score": 465}
  ]
}
```

### system prompt（admission 模式）

```
你是燕京理工学院招生推荐助手。你的任务是根据考生信息和专业数据，给出个性化的专业推荐。

规则：
1. 只推荐下发的专业列表中的专业，不能推荐不在列表中的
2. 结合分数匹配度、专业前景、就业方向、竞争热度给出理由
3. 每次推荐至少 3 个专业，每个专业附 1-2 句话理由
4. 回复格式：分点列出，每条包含专业名称、匹配度评级、推荐理由
5. 不要编造数据，只基于提供的分数、位次、冲稳保标签分析
6. 语气专业、平实，不夸张不渲染
```

### 数据传递

发送请求时，招生工具将当前查询结果（`matchList`）一并传给后端。
后端**不需要加载 MAJORS 全量数据**，只使用 frontend 传过来的 matchList。
这样避免 MAJORS 数据在请求中过大（73 个专业 ≈ 7KB JSON，可通过 gzip 压缩到 ~2KB）。

### token 消耗估算

- system prompt: ~200 tokens
- matchList (5个专业): ~150 tokens
- 用户请求: ~30 tokens
- 输出: ~300 tokens
- 合计: ~680 tokens/次 → ¥0.00068/次

### 返回格式

```json
{
  "recommendations": [
    {
      "name": "建筑学",
      "reason": "你的位次（202,675）比去年录取位次（218,000）高约 15,000 名，录取把握较大。该专业就业方向为建筑设计院、地产企业，行业前景稳定。"
    },
    {
      "name": "土木工程",
      "reason": "作为保底选择非常稳妥，位次超出专业线 2 万多名。燕京理工土木工程方向实践性强，就业面宽。"
    }
  ]
}
```

### source 参数校验

```
source 白名单：['yanli', 'admissions']
admissions 模式校验：
- score: 0-750 的整数
- rank: 正整数
- subject: 'wl' 或 'ls'
- matchList: 非空数组
不通过 → 返回 400 { error: '参数校验失败' }
```

---

## 六、安全方案

### 承诺性原则

核心安全原则：唯一的敏感信息是 DeepSeek API Key，只存在于 Render 环境变量中。前端代码、GitHub 仓库均不包含。

| 层面 | 措施 | 说明 |
|------|------|------|
| API Key | Render 环境变量 | `process.env.DEEPSEEK_KEY` / `process.env.OPENAI_KEY`，前端不可见 |
| 限流 | express-rate-limit | 每 IP 每分钟 20 次 `/api/chat` 调用 |
| HTTPS | Render 自动 | TLS 证书自动续签 |
| 输入清洗 | 四层边界 | 长度 + 敏感词 + 向量过滤 + prompt 约束 |
| 无数据库 | 不存储用户数据 | 没有数据泄露风险 |
| 无用户系统 | 纯公开服务 | 不需要登录/注册 |
| source 校验 | 白名单 + 字段校验 | 防止滥用 AI 端点 |

### 隐私说明

- 用户提问会经过 DeepSeek API（国内服务）和 OpenAI API（文本嵌入）
- 服务端不记录用户提问内容
- 建议在页面底部添加简短的隐私提示："您的提问仅用于本次回答，不会存储"

---

## 七、部署方案

| 项目 | 地址 | 方式 |
|------|------|------|
| 招生工具 | zs.13701.top | Express 托管 `/` |
| 校园助手 | zs.13701.top/helper | Express 托管 `/helper` |
| AI 端点 | zs.13701.top/api/chat | Express POST |

**Render 配置**：
- Type: Web Service
- Build: `npm install && npm run build`
- Start: `node server.js`
- Env: `DEEPSEEK_KEY=sk-xxx`, `OPENAI_KEY=sk-xxx`

**render.yaml** 已定义（见 §1），GitHub 连接后 Render 自动读取。

**页面内跳转**：
- 招生工具底部 → "了解校园生活" → `href="/helper"`
- 校园助手顶部 → "查分选专业" → `href="/"`

---

## 八、实现注意事项（源自审查）

### 8.1 字数限制可配置

默认 500 字，通过 `process.env.MAX_QUESTION_LENGTH` 覆盖。

### 8.2 向量阈值 0.75 上线后验证

50 条 FAQ 用 text-embedding-3-small，阈值 0.75 初步合理。上线后记录命中/未命中日志，根据实际反馈调整。

### 8.3 全层拒绝后的最终动作

四层全部不通过 → 返回固定话术，**不调 API**。

### 8.4 source 参数校验

已定义白名单和字段校验（见 §5）。

### 8.5 项目 B 当前状态

校园助手尚无任何代码，为待实现状态。

### 8.6 Express static 路由顺序

`/helper` 的 `express.static` 放在 `/` 前面（见 §1），避免每次 `/helper` 请求先被 `/` 拦截白找一次文件。

### 8.7 隐私提示

运行稳定后在页面底部添加简短隐私声明（见 §6）。

---

## 九、决策汇总（全部已定）

- [x] 合并为一个 Express Web Service，同域名 zs.13701.top
- [x] 招生工具数据外置到 data.js（UMD 格式，双端兼容）
- [x] Excel 源格式已定义（专业 + 一分一档）
- [x] build-data.js / build-embeddings.js 已定义
- [x] AI 四层边界：字数(500)→敏感词→检索→prompt
- [x] 知识库：text-embedding-3-small, 1536 维, 余弦相似度 top3
- [x] 校园内容先占位符，用户填充
- [x] 安全：环境变量存 Key + 限流 20次/分钟/IP + HTTPS
- [x] AI 专业推荐已定义：数据传递、system prompt、token估算、返回格式
- [x] source 白名单 + 字段校验
- [x] render.yaml + package.json 已定义
- [x] 无跨域问题（所有资源同源）
