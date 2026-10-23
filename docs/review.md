# BBnAEH 项目检查报告

检查时间：2026-10-22 · 范围：`src/`、`server.js`、`vue.config.js`、`package.json`、`README.md`
（`dist/`、`node_modules/`、`yarn.lock`、`package-lock.json` 未纳入评审）

## 结论

1. **曲名提取**是这次最大的短板：旧逻辑只看「最长的一段不是歌姬名的文本」，
   在 1369 条真实标注上歌名准确率只有 **38.50%**（新引擎 94.89%），
   而且经常把 `PV付`、`官方PV版` 当成歌名。已按 abstractor2026 的成果重写，
   旧逻辑原样保留、界面可切换（见 [README](../README.md#曲名提取)）。
2. 项目本身「能跑」，但存在**几处会直接卡住使用的问题**：Node 17+ 无法构建、
   开发模式接口 404、`package.json` 漏了后端依赖、曲名里的非法字符会写坏路径。
   这些已经修掉。
3. 还有一批**结构性**问题（同步阻塞的 ffmpeg、Vue 2 已 EOL、没有测试与 CI、
   Node polyfill 白占体积）。建议按下面的优先级处理，但都不影响现在使用。

---

## 一、曲名提取：改了什么

| | 旧版（保留） | 智能（新默认） |
| --- | --- | --- |
| 实现 | [`src/utils.js`](../src/utils.js) `predicateSongName` | [`src/songTitle.js`](../src/songTitle.js) + [`src/abstractor/`](../src/abstractor/README.md) |
| 歌手 | 12 位歌姬 + 3 个组合的关键词包含判断 | 31 位歌手 / 7 个组合的词典，最长匹配 + 别名归一 + 组合阈值 + VOCALOID 兜底 + 词典外歌手推测 |
| 歌名 | 按标点切段后取最长的非歌姬段 | 括号感知切分出候选池，72 维特征排序取 top-1 |
| 标注集歌名准确率 | 38.50% | 94.89% |
| 标注集歌手准确率（不计顺序） | 93.64% | 97.74% |
| 尾部 `PV付` / `官方PV版` | 会被当成歌名 | 识别为元数据 |

验证方式：

```bash
npm test                                                  # 曲名 14 个用例 + 删除接口 8 项断言
npm run title:eval -- --dataset <fine_result.csv>          # 1369 行对比
npm run build && npm run server                            # 界面里切换引擎对照
```

无头浏览器实测（同一批视频，切换引擎后输入框内容）：

| MV | 智能 | 旧版 |
| --- | --- | --- |
| `【洛天依/乐正绫】情话【PV付】` | `洛天依&乐正绫 - 情话` | `洛天依&乐正绫 - PV付` |
| `【Vsinger乐正绫】未来的我【官方PV版】` | `乐正绫 - 未来的我` | `乐正绫 - 官方PV版` |

---

## 二、已修复的问题

| # | 问题 | 影响 | 处理 |
| --- | --- | --- | --- |
| 1 | Node 17+ 下 `npm run build` 直接崩溃（`ERR_OSSL_EVP_UNSUPPORTED`） | 新机器/新 Node 完全无法构建 | [vue.config.js](../vue.config.js) 把 webpack 4 内部硬编码的 `md4` 映射到 `sha256`，不再需要 `NODE_OPTIONS=--openssl-legacy-provider` |
| 2 | `npm run serve` 时接口全部 404 | 开发模式不可用（只能先 build 再 server） | 同上文件，`devServer.proxy` 转发 `/info` `/dir-list` `/workspace` `/act` |
| 3 | `package.json` 没有 `express` / `body-parser` | 新环境 `npm install` 后 `server.js` 起不来 | 补进 `dependencies` |
| 4 | `POST /act` 先 `res.json` 再干活，异常只打日志 | 前端永远显示成功，失败无感知 | 改为执行完再返回 `{converted, skipped, failed}`；界面显示「已提取 N 首 / 跳过 N 首 / 失败 N 首」并刷新列表 |
| 5 | 曲名含 `: / ? * " < > |` 时 `path.format()` 会建子目录或写失败 | 导出文件名错乱 / 报错 | 新增 `sanitizeFileName()`（全角替换、去控制字符、去尾点、保留名、120 字截断） |
| 6 | 接口用字符串拼 `?path=`，目录名含 `#` `&` `+` 会被截断 | 选不到特定目录 | 改用 axios `params`（3 处） |
| 7 | `getVideoList` 在 `videos/` 不存在、或存在非目录时抛错 | 选到未初始化的工作目录整页报错 | 目录缺失返回空列表；逐条 try/catch |
| 8 | `entry.json` 带 UTF-8 BOM 时 `JSON.parse` 失败（整条视频被跳过） | 视频列表凭空少一条 | 解析前去掉 BOM |
| 9 | `execSync` 拼 shell 命令（`ffmpeg -n -i "..." "..."`） | 文件名含 `"`/`&` 时转换失败，且存在命令注入面 | 改 `spawnSync(FFMPEG, [...])`，删除 `escapePath` |
| 10 | `ensureWorkspaceValid` 用非递归 `mkdirSync` | 工作目录本身不存在时抛错 | `{recursive: true}` |
| 11 | 默认工作目录写成 `./test/`（不存在） | 首次打开推荐一个不存在的路径 | 改为当前目录 |
| 12 | 执行按钮用 `<div disabled>`，点击仍会触发 | 重复提交、并发跑 ffmpeg | `act()` 内 `if (waiting) return`；等待时文案变「执行中…」 |
| 13 | 执行成功后不清空已选、不刷新 | 看到的是旧列表，容易重复导出 | 清空已选并 `refresh()` |
| 14 | 引擎切换不持久化 | 每次进页面都要重选 | 存 `localStorage`（key 由 `Workspace.vue` 统一管理） |
| 15 | 端口写死 9722、启动必开浏览器 | 端口冲突时无法改、脚本化测试会弹窗 | 支持 `PORT` / `FFMPEG` / `NO_OPEN` |
| 16 | `res.json()` 之后又 `res.end()` | 无害但冗余，容易掩盖错误处理 | 删除 |
| 17 | 空 `catch` 触发 eslint `no-empty` | `npm run lint` 失败 | 补注释；新增 [.eslintignore](../.eslintignore) 排除移植目录 |

---

## 三、仍建议改进（按优先级）

### P0 · 影响正确性或安全性

1. **ffmpeg 同步阻塞事件循环**（[server.js](../server.js) `act()`）
   `spawnSync` 会把整个 Express 卡住：转换 20 个视频期间，任何请求（包括刷新页面）都不响应。
   建议改成任务队列：`POST /act` 立即返回 `jobId`，后台 `spawn`（异步）→ `GET /job/:id` 轮询进度。
   界面已经能显示 summary，改造成本不高。`/adb/import` 里的 `adb pull` 也是同一类问题。
2. ~~**服务监听所有网卡**~~（2026-10-23 已修复）：`server.listen(PORT)` 改成默认只绑
   `127.0.0.1`，可用 `HOST=0.0.0.0` 显式放开。加入删除接口后这条尤其重要——
   否则同一局域网内任何人都能调用 `/videos/delete` 删掉 `videos/` 下的目录。
   仍建议顺手去掉全开的 CORS 头。
3. **`express.static('./dist')` 依赖启动时的工作目录**：从别的目录 `node path/to/server.js`
   会 404。建议 `path.join(__dirname, 'dist')`（`server.bat` 里 `cd /d %~dp0` 也行）。
4. **同名曲目静默跳过**：不同视频导出同名 mp3 时，旧文件不动、新文件直接「跳过」。
   建议重名时加 ` (2)` 后缀，或至少把冲突列出来让用户确认。

### P1 · 影响可维护性

5. **升级工具链**：Vue 2 已 EOL（2023-12），vue-cli 4 / webpack 4 只兼容旧 Node。
   建议迁移 Vite + Vue 3 + `<script setup>`。本次新增的代码已经按可迁移方式写：
   纯 ESM、无 Node API、逻辑与 UI 分离（`songTitle.js` 不依赖 Vue），迁移时只需换构建配置。
6. **去掉 Node polyfill**：`DirTree.vue` 里的 `import path from 'path'` 会让 webpack 打包
   `path-browserify`（约 10–12 KB），实际只用到 `resolve()` 和去前导斜杠。
   用 10 行字符串处理即可，构建产物也能小一圈。
7. **加 CI**：目前没有任何自动化。建议 GitHub Actions 跑
   `npm ci && npm run lint && npm test && npm run build`，并加 `npm run title:data:check`
   防止词典/模型与生成物不一致。
8. **统一代码风格**：`server.js` 是 tab 缩进，`src/` 是 2 空格；没有 `.editorconfig` / Prettier。
   建议加 Prettier（`singleQuote: true`、`printWidth: 100`）并一次性格式化。
9. **清理死代码/垃圾文件**：`src/components/HelloWorld.vue`、`src/assets/logo.png`（仅 HelloWorld 用）、
   根目录被提交的 `debug.log`、`Workspace.vue` 里未被调用的 `removeSong()`。
   `record.json` 已在 `.gitignore` 里（这点做得对）。

### P2 · 体验与小 bug

10. `TopBarWrapper.vue` 用了不存在的 `<dir>` 标签（应为 `<div>`）；`<slot class="content">`
    的 class 不会作用到插槽内容上，`.content { flex: 1 }` 实际未生效，目前靠子元素自己撑开。
11. `TopBarWrapper.goBack()` 用 `window.history.length ? go(-1) : push(Home)` 判断——
    直接从地址栏打开页面时 `history.length` 也可能是 2，会退到空白页。建议用 `router.currentRoute`
    或记录一个 `canGoBack` 标记。
12. `DirPicker.vue` 的 `.top-bar > input:first-child` 永远不命中（第一个子元素是 `<select>`），
    目录输入框的样式没生效。
13. 路由 path 大小写不一致（定义 `/WorkSpacePicker`、链接 `/WorkspacePicker`）。
    目前 vue-router 默认大小写不敏感所以能跳转，但建议统一。
14. 曲名输入框没有 `<label for>`，键盘/读屏软件不友好；`BVideo` 的封面图建议加
    `loading="lazy"`（视频多时首屏少加载几十张图）。
15. 前端没有校验接口返回结构：`workspace.videos` 缺失时 `v-if="workspace"` 仍会渲染并在
    `.length` 上抛错。建议加一层 shape 校验或默认值。
16. `state.js` 用 `window.location.host` 拼接口地址，部署到子路径（反代）会失效；
    建议统一用 `process.env.BASE_URL`。

---

## 四、做得好的地方

- 目录选择器按需加载（`DirTree` 展开才请求），大目录也不卡。
- 后端接口职责清晰（`/info` `/dir-list` `/workspace` `/act`），错误信息是中文、能直接给用户看。
- 服务端对单个坏条目（读不了的文件、坏 `entry.json`）是跳过而不是整体失败——这个思路本次继续沿用。
- `record.json` 记住上次工作目录、`.gitignore` 也排除了它。
- 旧曲名逻辑虽粗糙，但完全可预测；正因为保留它，才能量化新引擎的收益（38.5% → 94.9%）。

---

## 五、本次改动的文件

新增：

```
src/songTitle.js                     曲名提取统一入口（引擎调度 / 格式化 / 文件名清洗）
src/abstractor/**                    abstractor2026 移植（含 runtime.js 与 data/*.js）
tools/build-abstractor-data.mjs       词典/模型 → JS 数据
tools/eval-songtitle.cjs              标注集评测
tools/test-songtitle.cjs              回归测试
tools/lib/esm-loader.cjs              Node 侧 ESM 加载器（仅工具链）
vue.config.js                         开发代理 + md4 兼容
.eslintignore                         排除移植目录
docs/review.md                        本报告
```

修改：

```
package.json        补 express / body-parser，加 test / title:* 脚本
server.js           依赖修复、/act 同步返回结果、BOM、spawnSync、容错、PORT/NO_OPEN
src/utils.js        仅加注释与 predicateSongNameLegacy 别名（逻辑零改动）
src/views/Workspace.vue      引擎选择、持久化、执行反馈、选择去重
src/components/BVideo.vue    改用 songTitle.js、来源标签、候选 tooltip、重识别按钮
src/components/DirTree.vue   接口参数编码
README.md           重写（架构、命令、评测、限制）
```

---

## 六、2026-10-23 增补：删除误放的视频

缓存目录里会混进复制错的视频，原来只能去资源管理器里翻 `videos/<avid>/<cid>`，
现在可以直接在列表里删。

### 交互

- 每张卡片右下角一个 `✕`：删单个；
- 左侧动作栏「删除所选(N)」：先勾选（勾选同时也会进入待提取列表），再批量删；
- 两种方式都先弹 `window.confirm`，列出将删除的路径；
- 删除完成后刷新列表、清空已选、在动作栏显示「已删除 N 个视频」；
  部分失败时保留失败项的勾选并在状态栏里列出原因。

### 服务端：`POST /videos/delete`

```
{ workspacePath, list: [{ path: "BV1xx411c7mD\\1" }] }
→ { succeed: true, result: { requested, deleted, failed, results: [{path, ok, err?}] } }
```

安全约束（都有测试覆盖）：

1. 路径必须是 `videos/` 内的相对路径：`path.isAbsolute()` 直接拒绝，
   `path.resolve` 后必须满足 `target.startsWith(videosRoot + sep)`，`videos` 根目录本身也拒绝；
2. 符号链接只 `unlink` 链接本身，不递归跟随到工作目录之外；
3. 删除成功后只向上清理**变空**的父目录，遇到非空或符号链接立即停止；
4. 空列表 → 整个请求失败；单条失败不影响其它条目；
5. 服务只监听 `127.0.0.1`（默认），避免局域网内被调用。

### 测试

`tools/test-server.cjs` 会真的拉起 `server.js`（随机端口、临时工作目录），
断言正常删除、`../audios`、`..\..\Windows`、`.`、绝对路径、不存在目录、空列表、混合成功/失败
共 8 组场景；`npm test` 现在会同时跑曲名提取和删除接口两组测试。

### 本次改动的文件

```
server.js                    + /videos/delete、路径校验、空目录清理、默认绑 127.0.0.1
src/state.js                 + urlVideoDelete
src/views/Workspace.vue      + 删除所选、单个删除、确认框、失败项保留勾选
src/components/BVideo.vue    + 卡片右下角 ✕
vue.config.js                + /videos 开发代理
tools/test-server.cjs        新增：删除接口集成测试（8 组场景）
package.json                 test 脚本串联两组测试
README.md                    + 「删除误放的视频」与 HOST 说明
```

### 仍未做（如果需要可以继续）

- 删除不进回收站，没有「撤销」；要更稳妥可以改成移到 `tmp/trash/<时间戳>/` 再让用户手动清空。
- 删除时没有检查该视频是否正在被 ffmpeg 使用（目前 `/act` 同步执行，实际上串行，不会并发）。
- 列表勾选同时承担「待提取」和「待删除」两种语义，如果以后需要更细的权限感，
  可以加一个「管理/清理」模式，把删除按钮只在管理模式显示。

---

## 七、2026-10-23 增补：从手机导入 B 站缓存

视频经常只下载在手机上。新增页面 `src/views/ImportCache.vue` + 服务端 `server/adb.cjs`，
通过 adb 把手机里 B 站 App 的离线缓存复制到工作文件夹的 `videos/`，或复制到本地临时文件夹。

### 流程

1. `GET /adb/info`：找 adb（环境变量 → PATH → `ANDROID_HOME` / SDK → 常见路径）、列设备、给默认目录；
2. `POST /adb/detect`：扫描设备上所有 `Android/data/<包名>/{download,files/download,cache/download}`
   里有没有 `entry.json`，返回找到的缓存目录（按条目数排序）；B 站有多个包名
   （`tv.danmaku.bili`、`com.bilibili.app.in` 等），所以不按包名白名单匹配；
3. `POST /adb/browse`：像文件管理器一样列设备目录，用于自动查找失败时手动定位；
4. `POST /adb/list`：读取 `<root>/*/*/entry.json`，返回标题 / avid / cid / bvid / P 数；
5. `POST /adb/import`：对每个选中的 `avid/cid` 执行 `adb pull`，目标为
   `<工作目录>/videos` 或 `<临时目录>`，保持 `<avid>/<cid>/entry.json` 结构。

页面进入时如果本地没记住目录，会先自动查找；记住的目录如果失效（换手机、换包名），
读取失败后自动回退到自动查找。

### 三个值得记录的实现细节

- **列表读取有两套策略**：优先一次 `adb shell`（脚本走 stdin）把整棵缓存的
  `entry.json` 打上标记读回来；脚本执行失败或没有标记时，自动回退成 `ls -1 -p` + 逐个 `cat`。
  测试两种路径都覆盖了。
- **shell 命令走 stdin，不拼参数**：`adb shell ls <path>` 在路径有空格时会被远端 shell 重新拆分，
  而 Windows 侧对 `adb.exe` 的参数转义规则又很怪（PowerShell 5.1 尤其）。改成把命令/脚本
  通过 stdin 传给 `adb shell`、路径用单引号转义后，空格、中文目录都稳定。
- **`adb pull` 先拉到隐藏的 staging 目录再 rename**：`adb pull <远端目录> <本地>` 在
  「本地目录已存在」时的行为随 adb 版本不同（可能多套一层目录名），直接拉容易让
  `entry.json` 落到错误层级；先拉到不存在的 staging、再原子改名，结构稳定。
  失败会清掉 staging，不会留下半成品。

### 真机验证时发现并修掉的问题

1. **`where adb` 的中文路径乱码**：`adb` 装在 `D:\Program Files (x86)\搞机助手\adb.exe`（中文路径）。
   `where.exe` 按控制台代码页（中文系统是 GBK）输出，Node 按 UTF-8 解码后路径变成
   `D:\...\�������\adb.exe`，`fs.existsSync` 为 false，于是「明明装了 adb 却提示未找到」。
   改成直接遍历 `process.env.PATH` 拼 `adb.exe` 判断存在性，不再经过子进程输出。
2. **`do;` 语法错误导致快速读取静默回退**：列表脚本原先用 `; ` 把 `for ... do` 拼成一行
   （`do; [ -f ... ]`），Android 的 `dash/mksh` 直接报 `syntax error: unexpected ';'`，
   快速读取返回空 → 回退到逐个 `cat`：347 条缓存要 19.8 秒。
   改成多行脚本后回到 8.4 秒，且列表 `mode` 重新是 `fast`。
3. **默认路径写死 `tv.danmaku.bili`**：该用户设备装的是国际版 `com.bilibili.app.in`，
   缓存实际在 `/sdcard/Android/data/com.bilibili.app.in/download`（347 条），
   旧默认值必然报 `No such file or directory`。现在改为「自动查找 + 浏览 + 记住上次目录」。

真机实测（OnePlus PLC110，包名 `com.bilibili.app.in`）：

```
GET  /adb/detect → roots: [/sdcard/Android/data/com.bilibili.app.in/download (347)]
POST /adb/list   → mode=fast, 347 条, 8.4s
POST /adb/import → 导入 113304374614780/c_26284459473，成功拉下 entry.json +
                   danmaku.xml + 80/audio.m4s(3.1MB) + 80/video.m4s
```

### 安全约束

- 设备序列号必须在 `adb devices` 里且状态为 `device`，且只允许 `[A-Za-z0-9._:-]`；
- 缓存目录必须是设备绝对路径，只允许 `[A-Za-z0-9._-/]`，禁止 `..` 与引号（避免设备端 shell 注入）；
- 浏览目录必须是绝对路径，禁止 `..`；只返回目录内容，不读文件内容；
- 视频目录必须是 `avid/cid` 两段，导入目标只能落在所选目录内；
- 所有 shell 调用都走 `adb shell` 的 stdin，参数本身不拼命令；`adb pull` 仍用参数数组；
- 目标已有 `entry.json` 时跳过；一次最多 200 个；
- 服务默认只监听 `127.0.0.1`（上一节已改），避免局域网内被调用。

### 测试

`tools/fake-adb.cjs` 用 Node 模拟了一台设备（`devices` / `shell`（列表、自动查找、`ls`、`cat`）/ `pull`），
假设备上放了两个 B 站包名和一个名字里带 `bili` 的干扰包。`tools/test-adb.cjs` 会真的拉起三个 server 实例：

| 实例 | 场景 |
| --- | --- |
| A | 自动查找（两个包名都找到、按条目数排序）、浏览目录、快速列表、复制到临时/工作目录、重复导入跳过 |
| B | 快速读取失败 → 回退 `ls + cat`，结果一致 |
| C | PATH 里没有 adb → `available:false` 与可读的提示，而不是崩溃 |

另外覆盖了：`/storage/sdcard0` 与 `/sdcard` 去重、设备注入、目录引号注入、`..` 穿越、
相对临时目录、`avid/cid/额外层级`、坏 `entry.json`（标记 broken 而不中断列表）、
默认临时目录带时间戳、中文目录里的 adb 能被找到等。

### 仍可改进

- 导入同样是同步执行，`adb pull` 大文件时整个服务被阻塞；和 `/act` 一样建议改成任务队列 + 进度轮询。
- 没有逐文件进度条，只能看到「导入中…」。
- 列表用一次 `cat` 拉回 347 份 `entry.json` 约 8 秒，主要耗在设备端逐个 `cat`；可以改成
  `toybox find ... -exec` 或只读取需要的字段。
- 只支持「缓存目录 → 本地」；反向（把本地视频推到手机）没做。
- 部分 Android 11+ 机型对 `Android/data` 有额外限制，需要用户自己开「USB 调试（安全设置）」，
  页面只能把 adb 的报错原样显示出来。

### 本次改动的文件

```
server/adb.cjs               新增：adb 发现、设备/目录校验、自动查找、浏览、缓存列表、pull 导入
server.js                    + /adb/info /adb/list /adb/detect /adb/browse /adb/import
src/views/ImportCache.vue    新增：导入页面（设备 → 自动查找/浏览 → 选择 → 目标）
src/router/index.js          + ImportCache 路由
src/views/Home.vue           + 「从手机导入缓存」入口与说明
src/views/Workspace.vue      + 左侧「从手机导入」入口
src/state.js                 + adb 接口地址
vue.config.js                + /adb 开发代理
tools/fake-adb.cjs           新增：假 adb（支持 shell stdin / 自动查找 / 浏览 / pull）
tools/test-adb.cjs           新增：40+ 断言，三个 server 实例
package.json                 test 串联 adb 测试，新增 test:adb
README.md                    + 「从手机导入缓存（adb）」完整说明
```
