# BBnAEH · 老江的音频提取助手

把 B 站离线缓存的视频批量转成 mp3，并自动识别「歌手 + 歌名」作为文件名。
视频既可以从电脑上的缓存文件夹读取，也可以通过 adb 直接从手机上的 B 站 App 缓存导入。

界面是一个 Vue 2 单页应用，后端是一个本地 Express 服务（`server.js`）：
读取工作目录里的 `videos/*/*/entry.json`，复制缓存里的 `audio.m4s` / `0.blv`，
再用 `ffmpeg` 转成 `audios/<曲名>.mp3`。

```
videos/                     B 站缓存（原样放进来）
  <avid>/<cid>/entry.json   视频信息（title / avid / bvid / cover）
  <avid>/<cid>/80/audio.m4s 音频流
audios/                     导出结果（同名文件已存在时跳过）
tmp/                        复制出来的中间文件
```

## 快速开始

```bash
npm install

npm run build      # 打包到 dist/
npm run server     # 启动 http://localhost:9722 （自动打开浏览器）
```

开发模式（前端热更新，接口自动代理到 9722）：

```bash
npm run server          # 先起后端
npm run serve           # 另开一个终端，访问 http://localhost:8080
```

环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `9722` | 后端端口（同时影响开发代理目标） |
| `HOST` | `127.0.0.1` | 监听地址；只有确实要从别的设备访问时才设成 `0.0.0.0` |
| `FFMPEG` | `ffmpeg` | ffmpeg 可执行文件路径 |
| `ADB` | 自动查找 | adb 可执行文件；留空则依次查 PATH、`ANDROID_HOME`、`%LOCALAPPDATA%\Android\Sdk`、常见安装位置 |
| `NO_OPEN` | 未设置 | 设为 `1` 时不自动打开浏览器（脚本化测试用） |
| `BBNAEH_API` | `http://127.0.0.1:9722` | 开发代理目标 |

## 曲名提取

输入框里的曲名 = `歌手&歌手 - 歌名`（歌手之间用 `&` 连接，不留空格），直接作为导出文件名。识别引擎可在左侧
「识别引擎」里切换，选择会记在 `localStorage` 里：

| 引擎 | 实现 | 说明 |
| --- | --- | --- |
| **智能（默认）** | `src/songTitle.js` + `src/abstractor/` | 移植自 abstractor2026：词典匹配歌手 + 括号感知切分歌名 + 72 维特征排序（线性 + MLP 集成） |
| **旧版** | `src/utils.js` 的 `predicateSongName` | 项目原有逻辑，行为一字未改：12 位歌姬 / 3 个组合的关键词匹配，取最长的非歌手段当歌名 |

智能引擎完全在浏览器本地运行：不联网、不调用大模型，模型与词典都随 bundle 打包
（打包体积约 +95 KiB，gzip 后约 +38 KiB；单条识别耗时约 0.3 ms，1000 条视频也只需不到 0.5 秒）。

### 两版在标注集上的表现

`fine_result.csv` 是 abstractor2026 的 1369 条人工标注（B 站 VOCALOID 区 MV 标题），
用 `npm run title:eval -- --dataset <fine_result.csv>` 可复现：

| 引擎 | 歌名准确率 | 歌手（不计顺序） | 歌手 + 歌名 |
| --- | --- | --- | --- |
| 智能 | **94.89%** | **97.74%** | **92.84%** |
| 旧版 | 38.50% | 93.64% | 37.18% |

- 智能引擎的 94.89% 与 abstractor2026 官方报告的数字完全一致，说明移植没有走样；
  但该数字是**训练集内**结果（模型就是用这批数据训练的），只能用来对比「旧版」，
  不能当作泛化精度。
- 旧版的差距几乎全部来自同一个 bug：它把「最长的非歌姬段」当歌名，而
  `PV付`（3 字）常常比真正的歌名（2 字）更长 ——
  `【洛天依/乐正绫】情话【PV付】` 会被认成 `洛天依&乐正绫 - PV付`。
- 少数情况旧版反而对（例如 `【心华原创】雨花 Rain Flower【回廊工作室】` 新引擎只取到「雨花」），
  所以两套引擎都保留、可随时切换。

### 文件名安全

新引擎返回的是 MV 原文里的 span，可能带 `:` `/` `?` 等 Windows 非法字符
（`Re:0`、`A/B`、`Gimme×Gimme`）。落盘前统一走 `sanitizeFileName()`：
非法字符换成全角、控制字符去掉、结尾的点和空格去掉、保留名（`CON`/`PRN`…）加前缀、
超过 120 字截断。旧版按标点切分，本来就不会带出非法字符。

## 删除误放的视频

缓存目录里偶尔会混进复制错的视频，可以在视频列表里直接清掉：

- **删单个**：每张卡片右下角有 `✕`，点它并确认即可；
- **批量删**：勾选若干视频（勾选同时也会加入待提取列表），再点左侧「删除所选(N)」。

确认框会列出将要删除的路径。删除行为：

- 只删除工作目录 `videos/` 下选中的缓存目录，`audios/` 里已导出的歌曲不受影响；
- **永久删除、不进回收站**；删完后如果上级目录（如 `videos/<avid>`）变空，会一并清理；
- 服务端校验路径必须落在 `videos/` 内：`..`、绝对路径、`videos` 根目录、指向目录外的符号链接都会被拒绝；
- 服务默认只监听 `127.0.0.1`，避免同一局域网内的其它机器调用删除接口。

对应接口：`POST /videos/delete`，body `{workspacePath, list: [{path}]}`，
返回 `{requested, deleted, failed, results: [{path, ok, err?}]}`（单个失败不影响其它条目）。

## 从手机导入缓存（adb）

视频常常只下载在手机的 B 站 App 里。这个功能通过 adb 读取手机上的离线缓存，
把选中的视频目录复制到工作文件夹的 `videos/`（导入后直接出现在列表里），
或复制到本地临时文件夹（只想先取出来看看时用）。

入口有两个：首页的「从手机导入缓存」，或视频列表左侧的「从手机导入」。

### 准备

1. 安装 [Android SDK Platform-Tools](https://developer.android.com/tools/releases/platform-tools)，
   确保 `adb` 在 PATH 里（或设置环境变量 `ADB` 指向 `adb.exe`）；
2. 手机打开「开发者选项 → USB 调试」，用数据线连接后执行 `adb devices`，
   在手机上点「允许 USB 调试」；
   - 无线调试：先在手机打开「无线调试 / adb over network」，电脑上 `adb connect <手机IP:端口>`，
     页面里的「刷新设备」就能看到；
3. 在 B 站 App 里把视频下载到本地。

### 使用

1. 选择设备（一般只有一个）；
2. 选好设备后会自动查找缓存目录并读出视频列表，不需要知道包名；
   - B 站客户端有多个包名（`tv.danmaku.bili`、`com.bilibili.app.in` 等），缓存也可能在
     SD 卡上，所以「自动查找」会扫描所有 App 的 `Android/data/<包名>/{download,files/download,cache/download}`
     里是否有 `entry.json`，找到后按条目数排序、自动填入第一个；
   - 也可以点「浏览…」像文件管理器一样在手机目录里点进去，选到 `download` 目录后点「使用此目录」；
   - 路径会记在 `localStorage` 里，下次进页面先试上次的目录，失败再自动查找；
   - 读取时优先用一次 `adb shell` 脚本把目录下所有 `entry.json` 读回来（几百条也只要几秒），
     失败时自动回退为 `ls` + 逐个 `cat`；
3. 勾选要导入的视频（可按标题 / BV 号 / 目录过滤、全选当前）；
4. 选择目标：
   - **工作文件夹的 videos/**：复制到 `<工作目录>\videos\<avid>\<cid>\`，回到视频列表即可看到；
   - **本地临时文件夹**：目录留空会自动创建 `%TEMP%\bbnaeh-import\<时间戳>\`，也可填任意绝对路径；
5. 点「导入选中的 N 个视频」，完成后会显示目标目录、跳过/失败明细。

### 接口

| 接口 | 说明 |
| --- | --- |
| `GET /adb/info` | adb 是否可用、设备列表、默认缓存目录、默认临时目录 |
| `POST /adb/list` | `{device, root}` → `{entries:[{path,avid,cid,title,bvid,page,...}], mode, ms}` |
| `POST /adb/detect` | `{device}` → `{roots:[{path,entries,package}], packages, ms}`（自动查找缓存目录） |
| `POST /adb/browse` | `{device, path}` → `{path,parent,entries:[{name,path,isDir}]}`（浏览设备目录） |
| `POST /adb/import` | `{device, root, entries:[path], target:{mode:'workspace'\|'temp', workspacePath?, dir?}}` → `{targetDir, imported, skipped, failed, results}` |

### 安全校验

- 设备序列号必须是 `adb devices` 里状态为 `device` 的那一台，且只允许字母数字和 `.:_-`；
- 缓存目录必须是设备上的绝对路径，只允许字母、数字、`.`、`_`、`-`、`/`，不能含 `..` 或引号；
- 浏览目录同样只接受设备上的绝对路径，不允许 `..`；
- 每个视频目录必须形如 `123/456`，最终复制目标只能落在所选目标目录内；
- adb 的 shell 命令都通过 stdin 传给 `adb shell`（不拼接参数、不依赖 Windows 引号规则），
  路径用单引号转义；`adb pull` 先拉到临时目录再改名，
  保证 `<avid>/<cid>/entry.json` 结构稳定；
- 目标已存在 `entry.json` 时跳过，不覆盖。

### 说明与限制

- 复制的是缓存目录本身（`entry.json`、`danmaku.xml`、各清晰度的 `audio.m4s`/`video.m4s`），
  和手动把 B 站缓存复制进 `videos/` 完全等价，后续提取流程不变；
- Android 11+ 对 `Android/data` 有限制，部分机型（MIUI/HyperOS、ColorOS 等）需要在
  「开发者选项」里额外打开「USB 调试（安全设置）」；如果 `ls` 报权限错误，先把缓存目录
  改成手机能读的路径（或把文件移动到 `/sdcard/Download/` 再导入）；
- B 站部分版权/付费内容可能是加密缓存，导入后 ffmpeg 可能无法解析，这类视频请用其他渠道；
- 导入是同步执行的（和「执行」一样），大文件多时页面会一直显示「导入中…」，完成后才返回；
- 一次最多导入 200 个；重复导入同一目录会跳过；
- 已在 OnePlus PLC110（Android，包名 `com.bilibili.app.in`，347 条缓存）上实测：
  自动定位到 `/sdcard/Android/data/com.bilibili.app.in/download`，列表 8 秒左右读完，
  单条导入（含 3 MB 的 `audio.m4s`）正常落盘。

## 项目结构

```
server.js                   本地 Express 服务（静态页 + /info /dir-list /workspace /act /videos/delete /adb/*）
server/adb.cjs              ★ adb 设备发现、缓存列举、导入（路径与设备校验都在这里）
vue.config.js               开发代理 + webpack4 在新版 Node 下的 md4 兼容
src/main.js, App.vue        入口
src/views/Home.vue          说明页
src/views/WorkspacePicker.vue  选择工作目录
src/views/Workspace.vue     视频列表 / 引擎切换 / 删除 / 执行 / 从手机导入入口
src/views/ImportCache.vue   ★ 从手机导入缓存（设备 → 缓存目录 → 选择 → 目标）
src/components/BVideo.vue   单个视频卡片（封面、路径、曲名输入、来源标签、重识别、删除）
src/components/DirTree.vue  目录树（懒加载）
src/songTitle.js            ★ 曲名提取统一入口（引擎调度、格式化、文件名清洗）
src/utils.js                旧版提取逻辑（原样保留）
src/abstractor/             ★ 从 abstractor2026 移植的抽象器（见该目录 README）
tools/build-abstractor-data.mjs  词典/模型 → 可打包的 JS 数据
tools/eval-songtitle.cjs    标注集评测（新旧引擎对比）
tools/test-songtitle.cjs    曲名提取回归测试（零依赖）
tools/test-server.cjs       删除接口集成测试（零依赖）
tools/test-adb.cjs          adb 导入集成测试（用假的 adb 模拟设备）
tools/fake-adb.cjs          假 adb：让 adb 导入流程能无真机测试
tools/lib/esm-loader.cjs    让 Node 直接 require src 里的 ESM（仅工具链用）
```

## 常用命令

```bash
npm run build          # 生产打包
npm run serve          # 开发服务器（需先 npm run server）
npm run server         # 后端
npm run lint           # ESLint

npm test               # 曲名 14 用例 + 删除 8 断言 + adb 导入 40+ 断言
npm run test:songtitle # 只跑曲名提取测试
npm run test:server    # 只跑删除接口测试
npm run test:adb       # 只跑 adb 导入测试（无需真机）
npm run title:data     # 重新生成 src/abstractor/data/*.js
npm run title:data:check  # 校验生成物是否过期（CI 用）
npm run title:eval -- --dataset <fine_result.csv>   # 准确率对比
```

`npm run build` 在 Node 17+（OpenSSL 3）上会因 webpack 4 硬编码 md4 而失败，
`vue.config.js` 里已把 md4 映射到 sha256，因此不需要再设置
`NODE_OPTIONS=--openssl-legacy-provider`。

## 已知限制

- 智能引擎的模型是在 VOCALOID 区 MV 上训练的；其他分区的标题格式（例如
  `「歌名」` 很少出现、大量 `【】` 标签）效果可能下降，切换旧版即可对照。
- 歌手写在自由文本里（`镜音连中文翻唱小城夏天`）时，智能引擎只从 `【…】`
  歌手槽推测，可能识别不到。
- 服务端目前同步执行 ffmpeg，批量转换期间接口不响应；见
  [`docs/review.md`](docs/review.md) 的改进建议。
- 同名曲目会跳过而不是覆盖（这是原有行为），执行后界面会显示「跳过 N 首」。
