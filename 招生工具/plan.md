# 招生工具 - 详细逻辑方案

> 最后更新：2026-07-01
> 状态：方案阶段，已审查（三次）
> 部署：Express Web Service → zs.13701.top/（架构详见 校园助手/plan.md）

---

## 一、项目结构

```
public/zhaosheng/        ← Express 托管目录
├── index.html           # 界面 + 全部交互逻辑
├── data.js              # 数据文件（build-data.js 生成，浏览器端加载）
```

```
build/
├── build-data.js        # 从 Excel 生成 data.js
```

- `data.js` 独立文件，`index.html`通过 `<script src="data.js">` 加载
- `build-data.js` 从 Excel 生成，输出 MAJORS / RANK_2025 / RANK_2026 / BATCH_LINE
- Express 路由：`app.use('/', express.static('public/zhaosheng'))`

### 1.1 Excel 源格式定义（build-data.js 的输入）

build-data.js 依赖以下两个 Excel 文件，放在仓库根目录：

**文件 A：专业数据**
- 文件名：`燕京理工学院2026年招生专业及分数线汇总（含分数）.xlsx`
- Sheet：Sheet1
- 列映射：

| Excel 列 | 生成字段 | 说明 |
|----------|---------|------|
| A: 专业名称 | `name` | 如"计算机科学与技术（专）"，运行时 level 由独立字段标识，不靠名称推断 |
| B: 层次 | `level` | "本科" 或 "专科" |
| C: 科类 | `subject` | "仅物理"→`wl`，"仅历史"→`ls`，"文理兼收"→`all` |
| D: 2025投档分 | `phy_score` | 物理类投档分 |
| E: 2025位次 | `phy_rank` | 物理类位次 |
| F: 2025投档分(历史) | `his_score` | 文理兼收专业有值，仅物理为 null |
| G: 2025位次(历史) | `his_rank` | 同上 |
| H: 专业介绍 | `desc` | 描述文本 |

**文件 B：一分一档**
- 文件名：`河北省高考一分一段表.xlsx`
- Sheet：读取所有 Sheet，按年份匹配
- 列映射：

| Excel 列 | 生成字段 |
|----------|---------|
| 分数 | key（String） |
| 物理类人数 | `[0]` |
| 物理类累计 | `[1]` |
| 历史类人数 | `[2]` |
| 历史类累计 | `[3]` |

**构建依赖**：`npm install xlsx`（SheetJS 社区版）

**构建命令**：`node build/build-data.js`，输出 `public/zhaosheng/data.js`

### 1.2 data.js 双环境兼容

data.js 需要同时被浏览器端和服务器端使用（服务器在 AI 专业推荐时需要 MAJORS 数据）。

使用 UMD 模式：

```javascript
(function(root) {
  var MAJORS = [ ... ];       // 专业数据
  var RANK_2025 = { ... };    // 一分一档2025
  var RANK_2026 = { ... };    // 一分一档2026
  var BATCH_LINE = { ... };   // 省控线
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MAJORS, RANK_2025, RANK_2026, BATCH_LINE };
  } else {
    root.MAJORS = MAJORS;
    root.RANK_2025 = RANK_2025;
    root.RANK_2026 = RANK_2026;
    root.BATCH_LINE = BATCH_LINE;
  }
})(this);
```

- 浏览器：`<script src="data.js">` → 全局变量挂载到 `window`
- 服务器：`const { MAJORS } = require('./public/zhaosheng/data.js')`

---

## 二、数据层

### 2.1 data.js 对外暴露

```javascript
var MAJORS = [ ... ];        // 专业数据数组
var RANK_2025 = { ... };     // 2025年一分一档（key 为字符串分数）
var RANK_2026 = { ... };     // 2026年一分一档
var BATCH_LINE = {           // 省控线（从 Excel 生成，不硬编码）
  "2025": { "wl": 477, "ls": 459, "all": 200 },
  "2026": { "wl": 443, "ls": 485, "all": 200 }
};
```

### 2.2 专业数据（MAJORS）

```javascript
{
  name: "计算机科学与技术",    // 专业名称
  level: "本科",               // "本科" | "专科"
  subject: "wl",               // "wl"(仅物理) | "ls"(仅历史) | "all"(文理兼收)
  score: 477,                  // 2025年主要投档分（冗余，= phy_score）
  rank: 158000,                // 2025年主要投档位次（冗余，= phy_rank）
  phy_score: 477,              // 物理类投档分（仅历史专业为 null）
  phy_rank: 158000,            // 物理类投档位次
  his_score: null,             // 历史类投档分（仅物理专业为 null）
  his_rank: null,              // 历史类投档位次
  desc: "专业介绍文字..."       // 专业描述
}
```

**字段关系（关键）**：
- `score` 和 `rank` 是冗余字段，始终等于 `phy_score` 和 `phy_rank`
- 匹配逻辑中**不使用** `m.rank`，根据查询科目动态取值：
  - 物理类查询 → 使用 `m.phy_rank`
  - 历史类查询 → 使用 `m.his_rank`
- 仅物理专业（31 个）：phy_rank 有值，his_rank 为 null
- 仅历史专业（0 个）：his_rank 有值，phy_rank 为 null
- 文理兼收（42 个）：两者都有值

### 2.3 一分一档（RANK_2025 / RANK_2026）

对象格式，**key 统一为字符串**（代码中 `String(score)` 确保类型一致）：

```javascript
RANK_2026 = {
  "750": [15, 15, null, null],   // [物理人数, 物理累计, 历史人数, 历史累计]
  "443": [null, 245360, null, 104800],
  "200": [null, 414200, null, 263500],
}
```

- `[0]` 物理段人数，`[1]` 物理累计，`[2]` 历史段人数，`[3]` 历史累计
- 段人数在低分区可能为 null，累计必有值

### 2.4 数据断档

2026 年一分一档在 503-488 分区间有缺失。build-data.js 不建对应 key，运行时二分降级处理。

### 2.5 省控线

从 `BATCH_LINE` 动态读取，不硬编码。取当前年份和科目。

---

## 三、核心算法

### 3.1 查分 → 位次（lookupRank）

**输入**：score(number), rankData, cumIdx(物理=1, 历史=3)

```
1. key = String(score)
2. rankData[key] 存在 → 返回 rankData[key][cumIdx]
3. 不存在 → 降级：
   a. 将 rankData 的 key 数组转为升序排列（200 → 750）
   b. 二分查找最后一个 ≤ key 的值（即 upper_bound 的左侧）
   c. 返回该 key 对应的 cumIdx
4. 找不到 → 返回该科目最大累计人数
```

**排序方向说明**：一分一档原始 key 是降序排列，但二分查找要求升序。建一个升序 key 数组（可用 `Object.keys().sort((a,b)=>a-b)`），再执行二分。

### 3.2 位次 → 分数（findScore）

**输入**：rank(number), rankData, cumIdx

```
遍历所有 key（降序，从高分到低分）：
  rankData[key][cumIdx] >= rank → 取符合条件的最大 key（最低临界分）
未匹配 → 返回 cumIdx 非 null 的最小 key（该科最低有数据的分段）
仍找不到 → 返回 0
```

### 3.3 2025等效分

```
1. lookupRank(考生分, RANK_2026, cumIdx) → 考生位次
2. findScore(位次, RANK_2025, cumIdx) → 等效分
```

已知局限性：跨年映射非严格双射。UI 注明"基于两年位次分布估算"。

### 3.4 2026预测分

**按用户查询科目选累计列**：

```
1. querySubject==='wl' → cumIdx=1, 用 m.phy_rank
   querySubject==='ls' → cumIdx=3, 用 m.his_rank
   对应 rank 为 null → 返回 "—"
2. findScore(rank, RANK_2026, cumIdx) → 预测分
```

**注**：当 querySubject='all'（全部科目）时，默认 cumIdx=1（物理累计列），用 m.rank（=phy_rank）。对历史类用户选"全部"时有微小偏差，已如实标注。实际使用中"全部"查询很少由历史类考生使用。

### 3.5 本科线差

```
线差 = 考生分数 - BATCH_LINE["2026"][科目Key]
```

---

## 四、匹配逻辑（冲稳保）

### 4.1 位次取值

匹配时**不使用** `m.rank`，根据查询科目动态选择：

```
function getMatchRank(m, querySubject):
  querySubject === 'wl' → m.phy_rank
  querySubject === 'ls' → m.his_rank
  否则 → m.rank（默认）
返回 null → 跳过匹配（该专业不适用）
```

### 4.2 阈值

| 层次 | 冲（下限）| 保（上限）| 依据 |
|------|---------|---------|------|
| 本科 | -20,000 | +30,000 | 往年位次波动经验值 |
| 专科 | -5,000 | +10,000 | 专科分段密集，绝对值差小，暂用经验值 |

注意：专科专业位次密集（16 个专业分布在 20 万-40 万区间），预测分仅供参考，实际录取波动可能较大。专科阈值偏窄，上线后根据实际反馈调整，后续可考虑比例阈值。

### 4.3 判断

```
matchRank = getMatchRank(m, querySubject)
matchRank == null || matchRank <= 0 → "—"
diff = matchRank - queryRank     ← 注意方向：专业位次 - 考生位次
diff > 保阈值 → "保"
diff > 0 → "稳"
diff > 冲阈值 → "冲"
否则 → "—"
```

**方向确认**：
- 冲：考生位次比专业要求差一些但在范围内（专业位次 - 考生位次 > -20000）
- 稳：考生位次优于专业要求（专业位次 > 考生位次）
- 保：考生位次远优于专业要求（专业位次 - 考生位次 > 30000）

---

## 五、筛选逻辑

### 5.1 层次筛选

"本科" → `m.level === '本科'`；"专科" → `m.level === '专科'`；"全部" → 不筛选

**自动切换**：
- 分数 > 当年本科线 → 自动切"本科" + 按钮联动高亮
- 分数 ≤ 当年本科线 且 ≥ 专科线(200) → 自动切"专科" + 按钮联动高亮
- 分数 < 专科线(200) → 自动切"专科"，数据为空，提示"分数低于省控线，建议咨询招生办"
- **查询时始终执行自动切换，不受手动选中状态的干扰**
- 手动点击筛选按钮不触发自动切换

**边界说明**：
- 物理类 480 分，本科线 443 → 切本科，显示全部符合条件的本科专业
- 物理类 300 分，本科线 443，专科线 200 → 切专科，匹配 16 个专科专业
- 物理类 150 分，本科线 443，专科线 200 → 切专科，数据为空，提示咨询

### 5.2 科目筛选

```
物理类：排除 m.subject === 'ls'（保留仅物理 + 文理兼收）
历史类：排除 m.subject === 'wl'（保留仅历史 + 文理兼收）
全部：不筛选
```

专业分布：仅物理 31 个 + 文理兼收 42 个 + 仅历史 0 个

---

## 六、排序逻辑

默认 → MAJORS 原始顺序。查询后 → 冲(0) → 稳(1) → 保(2) → 无数据(9)。同键内保持原始顺序。

---

## 七、表格渲染

表头：专业名称 | 投档分 | 位次 | 2026预测 | 录取概率

表头 `position: sticky` + JS 动态计算 top；`.major-section` 不得有 overflow。点击展开手风琴详情，colSpan=5。

---

## 八、交互流程

```
输入分数 + 选科 → 查询
→ lookupRank(分数, RANK_2026, cumIdx) → 位次
→ findScore(位次, RANK_2025, cumIdx) → 等效分
→ 计算线差（BATCH_LINE 动态取值）
→ 分数 > 本科线 → 自动切本科；≤ → 自动切专科
→ 渲染结果面板
→ 排序 + 筛选 + 渲染表格
→ 更新分享卡片（冲2 + 稳2 + 保1）
→ adjustStickyTop()
```

输入验证：空 不查询 / 非数字 提示 / <0 或 >750 提示 / 未选科 提示

---

## 九、分享与导出

**分享卡片**：html2canvas → 4 CDN 依次加载 → 每个 8 秒超时 → 全失败则复制文本

**复制摘要**：位次 + 等效分 + 科目 + 推荐专业

**Excel 导出**：
- 尊重当前筛选
- HTML table → .xls
- 列：专业名称、层次、科类、2025投档分、位次、2026预测、录取建议
- 冲稳保排序 + 查询摘要
- **编码处理**：HTML 中设置 `<meta charset="utf-8">`，文件内容前加 BOM（`\uFEFF`）确保中文 Excel 打开不乱码
- 备选方案：用 `xlsx` 库生成真正的 .xlsx 文件（服务器端），如果浏览器端 HTML table 方式有兼容问题

---

## 十、边界处理

| 场景 | 处理 |
|------|------|
| 无投档分 | "—"，不参与匹配 |
| 分数查不到 | 二分降级 |
| 断档区间(503-488) | 二分降级 |
| 位次超范围 | 返回极值 |
| 文理兼收 | 物理类查用 phy_rank，历史类查用 his_rank |
| querySubject=all | 用 m.rank 默认，cumIdx=1（物理累计列）；历史类选"全部"时有微小偏差 |
| 初始化 | 加载 data.js → 渲染全部专业 |
| 分数 < 专科线(200) | 数据为空，提示"分数低于省控线" |
| 无网络无数据 | 提示"数据加载失败，请检查网络" |

---

## 十一、实现注意事项（源自审查）

### 11.1 MAJORS 数据结构：必须用对象格式

现有代码用扁平元组 `[name, score, rank]`，不支持科目分类和分科位次。

**必须转换为：**
```javascript
{
  name: "计算机科学与技术",
  level: "本科",        // 独立字段，不靠 name.includes('(专)') 推断
  subject: "wl",        // "wl" | "ls" | "all"
  score: 477,
  rank: 158000,
  phy_score: 477,
  phy_rank: 158000,
  his_score: null,
  his_rank: null,
  desc: "..."
}
```

`level` 用独立字段代替字符串匹配 `name.includes('(专)')`。

### 11.2 BATCH_LINE 必须由 build-data.js 生成

省控线不硬编码在 HTML 或 JS 中，由 data.js 输出 BATCH_LINE 对象。
代码中读取 `BATCH_LINE["2026"][subjectKey]`，所有涉及本科线差和自动切换的地方都从它取值。

### 11.3 位次上限动态获取，不硬编码

```javascript
// 不要这样：
const maxCum = subject === 'wuli' ? 363040 : 243812;

// 要这样（RANK_2025 是扁平对象，无 subjectKey 嵌套）：
const allData = Object.values(RANK_2025 || {});
const maxCum = allData.reduce((m, arr) => Math.max(m, arr[cumIdx] || 0), 0);
```

### 11.4 lookupRank 必须用二分查找

- 建一个升序 key 数组：`const keys = Object.keys(rankData).sort((a,b)=>a-b)`
- 二分查找最后一个 ≤ target 的 key
- 找不到返回该科最大累计值

### 11.5 findScore 语义：cumIdx ≥ target 的最小分数，不是 Math.abs

```javascript
// 正确：取累计数 ≥ target 位次的最大分数 key（降序遍历）
for (key in sorted descending) if cum >= target → return key

// 错误：取绝对值差最小的分数
Math.abs(cum - target)  // 语义不同，数据稀疏区会有偏差
```

### 11.6 冲稳保 diff 符号方向

diff = 专业位次 - 考生位次  （不是考生位次 - 专业位次）
- diff > +30000 → "保"
- diff > 0 → "稳"
- diff > -20000 → "冲"
- 否则 → "—"

### 11.7 查询后排序必须实现

查询后按 冲(0) → 稳(1) → 保(2) → 无数据(9) 排序，同标签保持原始顺序。

### 11.8 自动切换必须实现

- 分数 > 本科线 → 自动切"本科"，按钮联动高亮
- 分数 ≤ 本科线 → 自动切"专科"，按钮联动高亮
- 低于专科线 → 数据为空，提示咨询
- 仅查询时触发，手动点击不触发

### 11.9 分享卡片 CDN 超时

每个 CDN 加载设 8 秒超时，超时自动跳下一个。

### 11.10 历史类数据

文理兼收专业必须提供 his_rank / his_score 数据。历史类考生查询时能看到匹配结果。

### 11.11 data.js 服务器端可用

data.js 使用 UMD 模式（见 §1.2），同时支持浏览器和 Node.js 加载。
AI 专业推荐当前选择前端传递 matchList 方案，不直接加载 data.js。
UMD 格式作为备用接口，后续若需扩展（如后端独立推荐）可随时切换。

### 11.12 Excel 编码

HTML table 导出 .xls 时，加 BOM + charset=utf-8，避免中文 Excel 乱码。
备选：升级为 `xlsx` 库生成真 .xlsx。

---

## 十二、验收清单（P0=MVP必须 / P1=重要 / P2=可后置）

### P0（上线必须通过）

- [ ] 物理类查文理兼收 → 预测分用 phy_rank + 物理累计列
- [ ] 历史类查文理兼收 → 预测分用 his_rank + 历史累计列
- [ ] 匹配用 phy_rank/his_rank 动态取值，不用 m.rank
- [ ] 本科线从 BATCH_LINE 动态读取
- [ ] 分数 > 本科线 → 自动切本科 + 按钮联动
- [ ] 分数 ≤ 本科线 → 自动切专科 + 按钮联动
- [ ] 排序：冲→稳→保→无数据
- [ ] 仅物理不显示给历史类考生
- [ ] MAJORS 是对象格式，含 subject/phy_rank/his_rank 字段
- [ ] BATCH_LINE 由 data.js 生成，不硬编码
- [ ] findScore 用 cumIdx ≥ target 逻辑，不用 Math.abs
- [ ] diff = 专业位次 - 考生位次（符号方向正确）
- [ ] RANK key 统一 String() 避免类型不匹配

### P1（重要，上线前完成）

- [ ] 清空查询 → 恢复默认
- [ ] 表头吸附正常（overflow 不破坏 sticky）
- [ ] 断档区间降级不报错
- [ ] lookupRank 用二分查找
- [ ] 历史类考生能看到文理兼收专业的匹配结果
- [ ] 分数 < 专科线 → 数据为空，提示咨询

### P2（可后置）

- [ ] 筛选后排序不丢失
- [ ] 分享 CDN 超时自动跳下一个
- [ ] Excel 导出：尊重筛选 + 冲稳保排序
- [ ] 专科专业 16 个
- [ ] maxCum 从数据动态计算
- [ ] Excel 导出加 BOM 防乱码
