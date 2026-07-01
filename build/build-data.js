const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const dataDir = path.resolve(__dirname, '..', '资料');
const outDir = path.resolve(__dirname, '..', 'public', 'zhaosheng');

// ===== Helper functions =====
function parseScore(v) {
  if (v == null || v === '-' || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

// Rank lookup by score (二分降级)
function scoreToRank(score, rankData, cumIdx) {
  if (score == null) return 0;
  const key = String(score);
  if (rankData[key]) return rankData[key][cumIdx];
  const keys = Object.keys(rankData).map(Number).filter(n => !isNaN(n)).sort((a, b) => a - b);
  let lo = 0, hi = keys.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (keys[mid] <= score) { found = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  if (found >= 0) return rankData[String(keys[found])][cumIdx];
  return 0;
}

// ===== Parse Rank Data =====
function parseRankSheet(wb, sheetName) {
  const ws = wb.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const result = {};
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (r[0] == null) continue;
    const num = parseInt(r[0], 10);
    if (isNaN(num)) continue;
    result[String(num)] = [
      r[1] ? parseInt(r[1], 10) || 0 : 0,
      r[2] ? parseInt(r[2], 10) || 0 : 0,
      r[3] ? parseInt(r[3], 10) || 0 : 0,
      r[4] ? parseInt(r[4], 10) || 0 : 0,
    ];
  }
  return result;
}

const rankFile = path.join(dataDir, '河北省高考一分一段表.xlsx');
const wb_rank = XLSX.readFile(rankFile);
const RANK_2025 = parseRankSheet(wb_rank, '2025年');
const RANK_2026 = parseRankSheet(wb_rank, '2026年');
console.log(`Rank: 2025=${Object.keys(RANK_2025).length}keys, 2026=${Object.keys(RANK_2026).length}keys`);

// ===== Read ALL sheets from majors Excel =====
const majorFile = path.join(dataDir, '燕京理工学院2026年招生专业及分数线汇总（含分数）.xlsx');
const wb = XLSX.readFile(majorFile);

function sheetData(name) {
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1 });
}

// Read Sheet 1 (本科) and Sheet 3 (专科) for the main data
const sheet1 = sheetData('本科专业及分数线');
const sheet3 = sheetData('专科专业及分数线');

// Read cross-reference sheets for subject determination
const histBatch = sheetData('河北本科批投档分-历史类'); // Sheet 5
const physBatch = sheetData('河北本科批投档分-物理类'); // Sheet 6
const histZkBatch = sheetData('河北专科批投档分-历史类'); // Sheet 7
const physZkBatch = sheetData('河北专科批投档分-物理类'); // Sheet 8

// Build lookup sets for subject determination
const histMajors = new Set(); // majors that have history class scores
const physMajors = new Set(); // majors that have physics class scores

for (let i = 1; i < histBatch.length; i++) {
  if (histBatch[i][1]) histMajors.add(String(histBatch[i][1]).trim());
}
for (let i = 1; i < physBatch.length; i++) {
  if (physBatch[i][1]) physMajors.add(String(physBatch[i][1]).trim());
}
for (let i = 1; i < histZkBatch.length; i++) {
  if (histZkBatch[i][1]) histMajors.add(String(histZkBatch[i][1]).trim());
}
for (let i = 1; i < physZkBatch.length; i++) {
  if (physZkBatch[i][1]) physMajors.add(String(physZkBatch[i][1]).trim());
}

console.log(`Batch ref: ${histMajors.size} history-class, ${physMajors.size} physics-class majors`);

// ===== Build MAJORS =====
const majors = [];

// Parse Sheet 1: 本科专业及分数线
for (let i = 1; i < sheet1.length; i++) {
  const r = sheet1[i];
  if (!r[2]) continue;
  const name = String(r[2]).trim();
  const level = String(r[4] || '本科');
  const phyScore = parseScore(r[8]); // 河北物理类投档分
  const hisScore = parseScore(r[7]); // 河北历史类投档分
  const remark = String(r[9] || '');

  // Subject: no pure 文科. 仅物理(only in physics batch) or 文理兼收(in history batch or both)
  let subject = 'all';
  if (physMajors.has(name) && !histMajors.has(name)) {
    subject = 'wl'; // only in physics batch → 仅物理
  }
  // else → 文理兼收 (including art/sports with no scores)

  const phyRank = scoreToRank(phyScore, RANK_2025, 1);
  const hisRank = scoreToRank(hisScore, RANK_2025, 3);

  majors.push({
    name, level, subject,
    score: phyScore != null ? phyScore : (hisScore || 0),
    rank: phyRank,
    phy_score: phyScore, phy_rank: phyRank,
    his_score: hisScore, his_rank: hisRank,
    desc: remark || ''
  });
}

// Parse Sheet 3: 专科专业及分数线
for (let i = 1; i < sheet3.length; i++) {
  const r = sheet3[i];
  if (!r[2]) continue;
  const name = String(r[2]).trim();
  const level = '专科';
  const hisScore = parseScore(r[6]); // 河北历史类投档分 (col index 6 in this sheet)
  const phyScore = parseScore(r[7]); // 河北物理类投档分

  // Subject: cross-reference with 专科 batch sheets
  let subject = 'all';
  if (physZkBatch.some(row => String(row[1]).trim() === name) && !histZkBatch.some(row => String(row[1]).trim() === name)) {
    subject = 'wl';
  }

  const phyRank = scoreToRank(phyScore, RANK_2025, 1);
  const hisRank = scoreToRank(hisScore, RANK_2025, 3);

  majors.push({
    name, level, subject,
    score: phyScore != null ? phyScore : (hisScore || 0),
    rank: phyRank,
    phy_score: phyScore, phy_rank: phyRank,
    his_score: hisScore, his_rank: hisRank,
    desc: ''
  });
}

// Stats
const wl = majors.filter(m => m.subject === 'wl').length;
const all = majors.filter(m => m.subject === 'all').length;
const benke = majors.filter(m => m.level === '本科').length;
const zhuanke = majors.filter(m => m.level === '专科').length;
console.log(`\nTotal: ${majors.length} majors`);
console.log(`仅物理: ${wl}, 文理兼收: ${all}, 仅历史: ${majors.filter(m => m.subject === 'ls').length}`);
console.log(`本科: ${benke}, 专科: ${zhuanke}`);

// ===== BATCH_LINE =====
const BATCH_LINE = {
  "2025": { "wl": 477, "ls": 459, "all": 200 },
  "2026": { "wl": 443, "ls": 485, "all": 200 }
};

// ===== Generate data.js (UMD) =====
const content = `(function(root) {
  var MAJORS = ${JSON.stringify(majors, null, 2)};
  var RANK_2025 = ${JSON.stringify(RANK_2025, null, 2)};
  var RANK_2026 = ${JSON.stringify(RANK_2026, null, 2)};
  var BATCH_LINE = ${JSON.stringify(BATCH_LINE, null, 2)};
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MAJORS, RANK_2025, RANK_2026, BATCH_LINE };
  } else {
    root.MAJORS = MAJORS;
    root.RANK_2025 = RANK_2025;
    root.RANK_2026 = RANK_2026;
    root.BATCH_LINE = BATCH_LINE;
  }
})(this);
`;

fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'data.js');
fs.writeFileSync(outFile, content, 'utf-8');
console.log(`\ndata.js written: ${(Buffer.byteLength(content, 'utf-8') / 1024).toFixed(1)}KB`);
