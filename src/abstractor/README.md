# src/abstractor —— 从 abstractor2026 移植的曲名/歌手抽象器

本目录是 abstractor2026（`E:\sync\section_work\Projects\abstractor2026`）的**忠实移植**：
除新增 `runtime.js`、`data/*.js` 外，其余文件与上游一一对应，只做了「去掉 fs」这一件事
（上游 `index.js` 负责读文件，浏览器用不到，因此没有移植）。

## 来源

| 项目 | 版本 |
| --- | --- |
| 上游 | `E:\sync\section_work\Projects\abstractor2026`（2026-10，非 git 仓库，按文件快照移植） |
| 数据集 | `fine_result.csv`，1369 行（**未**随本仓库携带） |
| 模型 | `data/title-ranker.json`（ensemble-ranker-v1，线性 + MLP 概率平均，72 维特征） |
| 词典 | `alias_list.csv`（31 位歌手）/ `band_list.csv`（7 个组合） |

## 文件

```
text.js        字符类、全半角折叠、装饰裁剪、带偏移切分、歌名比较
segment.js     括号感知切块（【】《》「」（）[]…，含嵌套与不成对括号）
lexicon.js     元数据词表、强制/可选分词规则
dictionary.js  别名/组合词典与最长匹配
artists.js     歌手抽取（组合阈值、VOCALOID 兜底、词典外名字、单字缩写）
candidates.js  歌名候选池
features.js    72 维特征
scoring.js     手调规则权重（可解释基线）
model/         线性 / MLP / 集成排序器（含训练代码，便于以后重训）
extract.js     端到端流水线
csv.js         RFC4180 CSV 读写（仅 tools 使用）
runtime.js     ★ 本项目新增：用 data/*.js 装配词典与模型，浏览器可直接调用
data/*.csv     词典源文件（生成器的输入）
data/*.js      ★ 生成产物：aliases.js / ranker.js
```

## 更新词典或模型

1. 用上游最新文件覆盖 `data/alias_list.csv`、`data/band_list.csv`、`data/title-ranker.json`；
2. 运行 `npm run title:data` 重新生成 `data/aliases.js` 与 `data/ranker.js`；
3. 运行 `npm test` 与 `npm run title:eval` 复核；
4. `npm run build` 重新打包（模型会进入 `app.js`，约 +30 KiB）。

`runtime.js` 会校验模型的特征名/维度与 `features.js` 的 `FEATURE_NAMES` 完全一致，
模型与代码不匹配时会抛错，而不是静默给出错误排序（`songTitle.js` 随后回退旧版引擎）。

## 与上游的差异

- `runtime.js`、`data/aliases.js`、`data/ranker.js` 为新增；
- `artists.js`、`features.js`、`text.js` 里保留了上游的 eslint 告警写法（未使用的 import、
  正则里的多余转义），以便整目录覆盖升级，因此在 `.eslintignore` 中排除了本目录；
- 其余逻辑、阈值、词表与上游完全一致，评测结果见 `README.md`。
