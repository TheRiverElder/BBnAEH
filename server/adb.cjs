'use strict';

/**
 * 通过 adb 读取手机（或任何 Android 设备）上 B 站 App 的离线缓存，
 * 并把选中的视频目录复制到工作文件夹或本地临时文件夹。
 *
 * B 站 Android 的离线缓存结构（与本项目 videos/ 的期望结构一致）：
 *
 *   <root>/<avid>/<cid>/entry.json
 *   <root>/<avid>/<cid>/<quality>/audio.m4s
 *   <root>/<avid>/<cid>/<quality>/video.m4s
 *
 * 因此「复制」本质上就是 `adb pull <root>/<avid>/<cid>` 到
 * `<目标>/<avid>/<cid>`。
 *
 * 所有 adb 调用都用 spawnSync + 参数数组，不经过 shell，避免命令注入；
 * 设备序列号、缓存目录、条目路径都会先校验再使用。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

/** B 站官方 App 的默认缓存目录（新版国内版可能改用 com.bilibili.app.in 等包名）。 */
const DEFAULT_DEVICE_ROOT = '/sdcard/Android/data/tv.danmaku.bili/download';

/** 常见缓存目录，供界面提示 / 手动填写时参考。 */
const DEVICE_ROOTS = [
  '/sdcard/Android/data/tv.danmaku.bili/download',
  '/sdcard/Android/data/com.bilibili.app.in/download',
  '/storage/emulated/0/Android/data/tv.danmaku.bili/download',
  '/storage/emulated/0/Android/data/com.bilibili.app.in/download',
  '/sdcard/Android/data/tv.danmaku.bili/files/download',
  '/sdcard/Android/data/com.bilibili.app.in/files/download',
  '/sdcard/Android/data/tv.danmaku.bili/cache/download',
  '/sdcard/Android/data/com.bilibili.app.in/cache/download',
];

/** 列表脚本里的分段标记；entry.json 里不会出现这个串。 */
const LIST_MARKER = '@@BBNAEH@@';

/** 自动查找脚本里的分段标记。 */
const ROOT_MARKER = '@@R@@';
const PACKAGE_MARKER = '@@P@@';

/** adb 可执行文件可能存在的常见位置（Windows）。 */
const COMMON_ADB_PATHS = [
  'C:\\platform-tools\\adb.exe',
  'C:\\adb\\adb.exe',
  'C:\\Program Files\\platform-tools\\adb.exe',
  'C:\\Program Files (x86)\\platform-tools\\adb.exe',
];

/** 默认临时导入目录的父目录。 */
const TEMP_ROOT = path.join(os.tmpdir(), 'bbnaeh-import');

/**
 * 在 PATH / 环境变量 / 常见安装位置里找 adb。
 *
 * @returns {{path: string, source: string}|null} 找到的 adb 及来源。
 */
function findAdb() {
  const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';
  const candidates = [];

  if (process.env.ADB) candidates.push({ path: process.env.ADB, source: '环境变量 ADB' });

  // 直接扫描 PATH，而不是调用 `where adb`：
  // where.exe 按控制台代码页（中文系统是 GBK）输出，Node 按 UTF-8 解码会把
  // 路径里的中文变成乱码（例如 D:\...\搞机助手\adb.exe），导致明明装了 adb 却找不到。
  // PATH 本身已经是解码好的 JS 字符串，逐项拼接判断更可靠。
  const pathValue = process.env.PATH || process.env.Path || '';
  for (const rawDir of pathValue.split(path.delimiter)) {
    const dir = rawDir.trim().replace(/^"(.*)"$/, '$1');
    if (dir) candidates.push({ path: path.join(dir, exe), source: 'PATH' });
  }

  const sdkRoots = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk'),
    process.env.USERPROFILE && path.join(process.env.USERPROFILE, 'AppData', 'Local', 'Android', 'Sdk'),
    process.env.HOME && path.join(process.env.HOME, 'Android', 'Sdk'),
    process.env.HOME && path.join(process.env.HOME, 'Library', 'Android', 'sdk'),
  ].filter(Boolean);
  sdkRoots.forEach(root => candidates.push({ path: path.join(root, 'platform-tools', exe), source: 'Android SDK' }));

  COMMON_ADB_PATHS.forEach(file => candidates.push({ path: file, source: '常见安装位置' }));

  for (const candidate of candidates) {
    try {
      if (candidate.path && fs.existsSync(candidate.path) && fs.statSync(candidate.path).isFile()) {
        return candidate;
      }
    } catch (e) { /* 忽略不可访问的候选路径 */ }
  }
  return null;
}

/**
 * 把 adb 路径与参数组装成实际要执行的命令。
 *
 * 正常情况下就是 adb.exe 本身。为了可测试（以及允许用户用脚本包装 adb），
 * 当 `ADB` 指向一个 .js/.cjs/.mjs 文件时，用当前 Node 解释器执行它。
 *
 * @param {string} adbPath adb 可执行文件。
 * @param {string[]} args adb 参数。
 * @returns {{command: string, args: string[]}} 可执行的命令。
 */
function adbCommand(adbPath, args) {
  if (/\.(c?js|mjs)$/i.test(adbPath)) {
    return { command: process.execPath, args: [adbPath, ...args] };
  }
  return { command: adbPath, args };
}

/**
 * 执行 adb，失败（进程起不来 / 超时）时抛错。
 *
 * @param {string} adbPath adb 可执行文件。
 * @param {string[]} args 参数列表。
 * @param {object} [options] 选项。
 * @param {number} [options.timeout=30000] 超时毫秒数。
 * @returns {{status: number|null, stdout: string, stderr: string}} 执行结果。
 */
function runAdb(adbPath, args, options = {}) {
  const command = adbCommand(adbPath, args);
  const result = spawnSync(command.command, command.args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: options.timeout ?? 30000,
    maxBuffer: 64 * 1024 * 1024,
    input: options.input,
  });
  if (result.error) {
    throw new Error(`无法执行 adb（${adbPath}）：${result.error.message}`);
  }
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

/**
 * 把路径包成 shell 单引号字面量（支持路径里的空格、中文、单引号）。
 *
 * @param {string} value 要引用的文本。
 * @returns {string} 可以安全放进 sh 命令里的字符串。
 */
function shellQuote(value) {
  const text = String(value);
  if (/[\r\n\0]/.test(text)) throw new Error('路径包含换行或控制字符');
  return `'${text.replace(/'/g, "'\\''")}'`;
}

/**
 * 在设备上执行一段 shell（通过 stdin 传给 `adb shell`，不经过参数拼接）。
 *
 * 这比 `adb shell ls <path>` 可靠：路径里的空格不会被远程 shell 重新拆分，
 * 也不用担心 Windows 侧的参数转义；脚本可以有多行。
 *
 * @param {string} adbPath adb 可执行文件。
 * @param {string} serial 设备序列号。
 * @param {string} script 要执行的脚本。
 * @param {object} [options] 选项。
 * @param {number} [options.timeout=60000] 超时毫秒数。
 * @returns {{status: number|null, stdout: string, stderr: string}} 执行结果。
 */
function runShell(adbPath, serial, script, options = {}) {
  return runAdb(adbPath, ['-s', serial, 'shell'], {
    timeout: options.timeout ?? 60000,
    input: script.endsWith('\n') ? script : `${script}\n`,
  });
}

/**
 * 校验设备序列号：必须是 `adb devices` 里已授权的那一台。
 * 同时挡住以 `-` 开头、会被 adb 当成选项的值。
 *
 * @param {string} serial 设备序列号。
 * @param {Array<{serial: string, state: string}>} devices 设备列表。
 * @returns {string} 校验通过的序列号。
 */
function requireDevice(serial, devices) {
  const value = String(serial || '').trim();
  if (!value) throw new Error('请先选择设备');
  if (!/^[A-Za-z0-9._:\-]+$/.test(value)) throw new Error(`设备序列号不合法：${value}`);
  const device = devices.find(item => item.serial === value);
  if (!device) throw new Error(`设备未连接：${value}（先点「刷新设备」）`);
  if (device.state !== 'device') throw new Error(`设备状态为 ${device.state}，无法读取（请在手机上允许 USB 调试）`);
  return value;
}

/**
 * 校验设备上的缓存目录：必须是绝对路径，且不含 shell 元字符。
 *
 * @param {string} root 缓存目录。
 * @returns {string} 去掉末尾斜杠的目录。
 */
function requireDeviceRoot(root) {
  const value = String(root || DEFAULT_DEVICE_ROOT).trim().replace(/\/+$/, '');
  if (!value.startsWith('/')) throw new Error('缓存目录必须是设备上的绝对路径（以 / 开头）');
  if (!/^\/[A-Za-z0-9._\-/]+$/.test(value)) {
    throw new Error('缓存目录包含不支持的字符（只允许字母、数字、点、下划线、减号、斜杠）');
  }
  if (value.split('/').includes('..')) throw new Error('缓存目录不能包含 ..');
  return value;
}

/**
 * 校验单个视频目录（形如 `123/456`）。
 *
 * @param {string} value 相对路径。
 * @returns {string} 校验后的相对路径。
 */
function requireEntryPath(value) {
  const entryPath = String(value || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!/^[A-Za-z0-9._\-]+\/[A-Za-z0-9._\-]+$/.test(entryPath)) {
    throw new Error(`视频目录不合法：${value}`);
  }
  if (entryPath.split('/').includes('..')) throw new Error(`视频目录不合法：${value}`);
  return entryPath;
}

/**
 * 解析 `adb devices -l` 的输出。
 *
 * @param {string} stdout 原始输出。
 * @returns {Array<{serial: string, state: string, model: string, product: string, device: string, label: string}>} 设备列表。
 */
function parseDevices(stdout) {
  const devices = [];
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const text = line.trim();
    if (!text || text.startsWith('List of devices')) continue;
    const match = /^(\S+)\s+(device|offline|unauthorized|no permissions|bootloader|recovery|sideload)\b(.*)$/.exec(text);
    if (!match) continue;
    const meta = {};
    for (const part of match[3].trim().split(/\s+/)) {
      const index = part.indexOf(':');
      if (index > 0) meta[part.slice(0, index)] = part.slice(index + 1);
    }
    const model = (meta.model || '').replace(/_/g, ' ');
    const label = `${model || 'Android 设备'} (${match[1]})${match[2] === 'device' ? '' : ` · ${match[2]}`}`;
    devices.push({
      serial: match[1],
      state: match[2],
      model,
      product: meta.product || '',
      device: meta.device || '',
      label,
    });
  }
  return devices;
}

/**
 * 列出已连接的设备。
 *
 * @param {string} adbPath adb 可执行文件。
 * @returns {Array<object>} 设备列表。
 */
function listDevices(adbPath) {
  const result = runAdb(adbPath, ['devices', '-l'], { timeout: 20000 });
  if (result.status !== 0) {
    throw new Error(`adb devices 失败：${(result.stderr || result.stdout || '').trim() || `退出码 ${result.status}`}`);
  }
  return parseDevices(result.stdout);
}

/**
 * 从 entry.json 生成一条列表项。
 *
 * @param {string} relativePath 形如 `123/456/entry.json`。
 * @param {object} entry entry.json 内容。
 * @returns {object} 列表项。
 */
function makeEntry(relativePath, entry) {
  const directory = String(relativePath).replace(/\\/g, '/').replace(/\/?entry\.json$/i, '');
  const [avidDir, cidDir] = directory.split('/');
  const page = entry.page_data || {};
  const title = String(entry.title || page.download_title || page.part || '').trim();
  return {
    path: directory,
    avid: String(entry.avid ?? avidDir ?? ''),
    cid: String(entry.cid ?? cidDir ?? ''),
    bvid: String(entry.bvid || ''),
    title,
    part: String(page.part || page.download_subtitle || '').trim(),
    page: Number(page.page) || 1,
    cover: String(entry.cover || ''),
    totalBytes: Number(entry.total_bytes) || 0,
  };
}

/**
 * 解析「一次性 dump 所有 entry.json」的输出。
 *
 * 输出格式：每个视频一段
 *   @@BBNAEH@@123/456/entry.json
 *   { ...entry.json... }
 *
 * @param {string} output adb exec-out 的原始输出。
 * @returns {Array<object>} 列表项。
 */
function parseEntryDump(output) {
  const text = String(output || '').replace(/\r\n/g, '\n');
  const parts = text.split(LIST_MARKER).slice(1);
  const entries = [];
  for (const part of parts) {
    const newline = part.indexOf('\n');
    if (newline < 0) continue;
    const relativePath = part.slice(0, newline).trim();
    if (!relativePath) continue;
    const body = part.slice(newline + 1).trim();
    if (!body) continue;
    try {
      entries.push(makeEntry(relativePath, JSON.parse(body.replace(/^\uFEFF/, ''))));
    } catch (e) {
      // 单个 entry.json 坏掉不应该让整个列表失败
      entries.push({
        path: relativePath.replace(/\/?entry\.json$/i, ''),
        avid: relativePath.split('/')[0] || '',
        cid: relativePath.split('/')[1] || '',
        bvid: '',
        title: '（entry.json 解析失败）',
        part: '',
        page: 1,
        cover: '',
        totalBytes: 0,
        broken: true,
      });
    }
  }
  return entries;
}

/**
 * 生成在设备上一次性读取所有 entry.json 的 shell 脚本。
 *
 * 路径已经过 {@link requireDeviceRoot} 校验（无引号、无空格），可以安全地用单引号包起来。
 *
 * @param {string} root 缓存目录。
 * @returns {string} shell 脚本（多行，通过 stdin 传给 adb shell）。
 */
function buildListScript(root) {
  // 注意：必须用换行分隔，不能拼成 `do; ...` —— 部分 Android 的 sh（dash/mksh）
  // 会把 `do;` 当成语法错误，导致快速读取整体失败并回退到逐个 cat。
  return [
    `cd '${root}' 2>/dev/null || exit 3`,
    'for f in */*/entry.json; do',
    '  [ -f "$f" ] || continue',
    `  printf '\\n${LIST_MARKER}%s\\n' "$f"`,
    '  cat "$f"',
    'done',
    '',
  ].join('\n');
}

/**
 * 快速列表：一次 exec-out 拿回所有 entry.json。
 *
 * @param {string} adbPath adb 可执行文件。
 * @param {string} serial 设备序列号。
 * @param {string} root 缓存目录。
 * @returns {Array<object>|null} 列表项；失败返回 null 以便回退慢速方式。
 */
function listCacheFast(adbPath, serial, root) {
  const result = runShell(adbPath, serial, buildListScript(root), { timeout: 120000 });
  if (result.status !== 0) return null;
  if (!result.stdout.includes(LIST_MARKER)) return null;
  return parseEntryDump(result.stdout);
}

/**
 * 慢速但兼容性更好的列表：先 ls 目录，再逐个 cat entry.json。
 *
 * @param {string} adbPath adb 可执行文件。
 * @param {string} serial 设备序列号。
 * @param {string} root 缓存目录。
 * @returns {Array<object>} 列表项。
 */
function listCacheSimple(adbPath, serial, root) {
  /**
   * 列出设备上的一个目录。
   * @param {string} dir 目录。
   * @returns {string[]} 子项名。
   */
  const listDir = (dir) => {
    const result = runShell(adbPath, serial, `ls -1 -p ${shellQuote(dir)}`, { timeout: 30000 });
    if (result.status !== 0) {
      const reason = (result.stderr || '').replace(/\r/g, '').trim() || '目录不存在或没有权限';
      throw new Error(`读取设备目录失败：${dir}（${reason}）`);
    }
    return result.stdout.replace(/\r/g, '').split('\n')
      .map(line => line.trim().replace(/\/+$/, ''))
      .filter(Boolean);
  };

  const entries = [];
  for (const avid of listDir(root)) {
    if (!/^[A-Za-z0-9._\-]+$/.test(avid)) continue;
    let cids = [];
    try {
      cids = listDir(`${root}/${avid}`);
    } catch (e) {
      continue;
    }
    for (const cid of cids) {
      if (!/^[A-Za-z0-9._\-]+$/.test(cid)) continue;
      const result = runShell(adbPath, serial, `cat ${shellQuote(`${root}/${avid}/${cid}/entry.json`)}`, { timeout: 30000 });
      if (result.status !== 0 || !result.stdout.trim()) continue;
      try {
        entries.push(makeEntry(`${avid}/${cid}/entry.json`, JSON.parse(result.stdout.replace(/^\uFEFF/, ''))));
      } catch (e) {
        entries.push({
          path: `${avid}/${cid}`,
          avid,
          cid,
          bvid: '',
          title: '（entry.json 解析失败）',
          part: '',
          page: 1,
          cover: '',
          totalBytes: 0,
          broken: true,
        });
      }
    }
  }
  return entries;
}

/**
 * 读取设备上的缓存列表。
 *
 * @param {string} adbPath adb 可执行文件。
 * @param {string} serial 设备序列号。
 * @param {string} root 缓存目录。
 * @returns {{entries: object[], mode: 'fast'|'simple'}} 列表项与所用方式。
 */
function listCache(adbPath, serial, root) {
  const entries = process.env.BBNAEH_ADB_SIMPLE === '1' ? null : listCacheFast(adbPath, serial, root);
  if (entries) return { entries, mode: 'fast' };
  return { entries: listCacheSimple(adbPath, serial, root), mode: 'simple' };
}

/**
 * 把常见的别名路径归一，减少自动查找时的重复项。
 * @param {string} value 设备路径。
 * @returns {string} 归一后的路径。
 */
function normalizeDevicePath(value) {
  return String(value || '').trim().replace(/\r/g, '')
    .replace(/\/+$/, '')
    .replace(/^\/storage\/emulated\/0(?=\/|$)/, '/sdcard')
    .replace(/^\/storage\/sdcard0(?=\/|$)/, '/sdcard');
}

/**
 * 从缓存路径里取出包名：`/sdcard/Android/data/<包名>/download` → `<包名>`。
 * @param {string} devicePath 缓存目录。
 * @returns {string} 包名（取不到时返回空串）。
 */
function packageOf(devicePath) {
  const match = /\/Android\/data\/([^/]+)/.exec(devicePath);
  return match ? match[1] : '';
}

/**
 * 生成自动查找脚本：扫描所有 App 数据目录里形如 `<pkg>/download/<avid>/<cid>/entry.json` 的结构。
 *
 * 不按包名白名单匹配——B 站有 tv.danmaku.bili、com.bilibili.app.in 等多个包名，
 * 直接按「有没有 entry.json」识别更可靠（也顺带支持改包名的第三方客户端）。
 *
 * @returns {string} shell 脚本。
 */
function buildDetectScript() {
  return `for base in /sdcard /storage/*; do
  [ -d "$base/Android/data" ] || continue
  for d in "$base"/Android/data/*/download "$base"/Android/data/*/files/download "$base"/Android/data/*/cache/download; do
    [ -d "$d" ] || continue
    n=$(ls -1 "$d"/*/*/entry.json 2>/dev/null | wc -l)
    [ "$n" -gt 0 ] || continue
    echo "${ROOT_MARKER}$d|$n"
  done
  for p in "$base"/Android/data/tv.danmaku.bili "$base"/Android/data/com.bilibili.*; do
    [ -d "$p" ] && echo "${PACKAGE_MARKER}$p"
  done
done
`;
}

/**
 * 解析自动查找脚本的输出。
 *
 * @param {string} output 脚本输出。
 * @returns {{roots: Array<{path: string, entries: number, package: string}>, packages: string[]}} 结果。
 */
function parseDetectOutput(output) {
  /** @type {Map<string, {path: string, entries: number, package: string}>} */
  const roots = new Map();
  const packages = new Set();
  for (const line of String(output || '').replace(/\r/g, '').split('\n')) {
    if (line.startsWith(ROOT_MARKER)) {
      const rest = line.slice(ROOT_MARKER.length);
      const separator = rest.lastIndexOf('|');
      if (separator < 0) continue;
      const devicePath = normalizeDevicePath(rest.slice(0, separator));
      if (!devicePath) continue;
      const entries = Number(rest.slice(separator + 1).trim()) || 0;
      const existing = roots.get(devicePath);
      if (!existing || existing.entries < entries) {
        roots.set(devicePath, { path: devicePath, entries, package: packageOf(devicePath) });
      }
    } else if (line.startsWith(PACKAGE_MARKER)) {
      const devicePath = normalizeDevicePath(line.slice(PACKAGE_MARKER.length));
      if (devicePath) packages.add(devicePath);
    }
  }
  const rootList = [...roots.values()]
    .sort((a, b) => b.entries - a.entries || a.path.localeCompare(b.path));
  return { roots: rootList, packages: [...packages].sort() };
}

/**
 * 自动查找设备上的 B 站缓存目录（支持多个包名 / SD 卡）。
 *
 * @param {string} adbPath adb 可执行文件。
 * @param {string} serial 设备序列号。
 * @returns {{roots: Array<{path: string, entries: number, package: string}>, packages: string[], ms: number}} 查找结果。
 */
function detectRoots(adbPath, serial) {
  const started = Date.now();
  const result = runShell(adbPath, serial, buildDetectScript(), { timeout: 60000 });
  if (result.status !== 0) {
    const reason = (result.stderr || '').replace(/\r/g, '').trim() || `退出码 ${result.status}`;
    throw new Error(`自动查找缓存目录失败：${reason}`);
  }
  const parsed = parseDetectOutput(result.stdout);
  return { ...parsed, ms: Date.now() - started };
}

/**
 * 校验浏览用的设备目录。
 *
 * @param {string} dirPath 目录。
 * @returns {string} 校验后的绝对路径。
 */
function requireBrowsePath(dirPath) {
  const value = String(dirPath || '/sdcard').trim().replace(/\/+$/, '') || '/';
  if (!value.startsWith('/')) throw new Error('设备目录必须是绝对路径（以 / 开头）');
  if (/[\r\n\0]/.test(value)) throw new Error('设备目录包含非法字符');
  if (value.split('/').includes('..')) throw new Error('设备目录不能包含 ..');
  return value;
}

/**
 * 列出设备上的一个目录，用于界面里的“浏览…”。
 *
 * @param {string} adbPath adb 可执行文件。
 * @param {string} serial 设备序列号。
 * @param {string} dirPath 目录（默认 /sdcard）。
 * @returns {{path: string, parent: string|null, entries: Array<{name: string, path: string, isDir: boolean}>, truncated: boolean}} 目录内容。
 */
function browse(adbPath, serial, dirPath) {
  const current = requireBrowsePath(dirPath);
  const result = runShell(adbPath, serial, `ls -1 -p ${shellQuote(current)}`, { timeout: 30000 });
  if (result.status !== 0) {
    const reason = (result.stderr || '').replace(/\r/g, '').trim() || '目录不存在或没有权限';
    throw new Error(`读取设备目录失败：${current}（${reason}）`);
  }
  const entries = [];
  for (const raw of result.stdout.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line || line === './' || line === '../') continue;
    const isDir = line.endsWith('/');
    const name = isDir ? line.slice(0, -1) : line;
    if (!name) continue;
    entries.push({
      name,
      isDir,
      path: current === '/' ? `/${name}` : `${current}/${name}`,
    });
  }
  entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
  const capped = entries.slice(0, 500);
  const parent = current === '/' ? null : (current.lastIndexOf('/') <= 0 ? '/' : current.slice(0, current.lastIndexOf('/')));
  return { path: current, parent, entries: capped, truncated: entries.length > capped.length };
}

/**
 * 描述 adb 环境：是否可用、设备、默认目录。
 *
 * @returns {object} 环境信息。
 */
function describe() {
  const base = {
    defaultRoot: DEFAULT_DEVICE_ROOT,
    roots: DEVICE_ROOTS,
    tempRoot: TEMP_ROOT,
    tempDefault: path.join(TEMP_ROOT, timestamp()),
  };
  const adb = findAdb();
  if (!adb) {
    return {
      ...base,
      available: false,
      adbPath: null,
      adbVersion: '',
      source: null,
      devices: [],
      hint: '未找到 adb。请安装 Android SDK Platform-Tools，把 adb 加入 PATH，'
        + '或设置环境变量 ADB 指向 adb.exe（例如 C:\\platform-tools\\adb.exe）。',
    };
  }
  let version = '';
  try {
    const result = runAdb(adb.path, ['version'], { timeout: 10000 });
    version = (result.stdout || '').split(/\r?\n/).find(line => line.trim()) || '';
  } catch (e) { /* 版本拿不到不影响使用 */ }

  let devices = [];
  let hint = '';
  try {
    devices = listDevices(adb.path);
    if (devices.length === 0) {
      hint = '没有检测到设备：用数据线连接手机，打开「开发者选项 → USB 调试」，'
        + '在手机上允许这台电脑调试；无线调试请先 `adb connect <ip:port>`。';
    } else if (!devices.some(item => item.state === 'device')) {
      hint = '设备已连接但未授权：在手机上点「允许 USB 调试」后重试。';
    }
  } catch (e) {
    hint = String((e && e.message) || e);
  }

  return {
    ...base,
    available: true,
    adbPath: adb.path,
    adbVersion: version,
    source: adb.source,
    devices,
    hint,
  };
}

/**
 * 时间戳文件名：20261023-214712。
 * @returns {string} 时间戳。
 */
function timestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
    + `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/**
 * 计算复制目标目录。
 *
 * @param {object} target 目标配置。
 * @param {'workspace'|'temp'} [target.mode] 模式。
 * @param {string} [target.dir] 临时模式下的目录（留空则自动生成）。
 * @param {string} [target.workspacePath] 工作目录。
 * @returns {string} 目标目录绝对路径。
 */
function resolveTarget(target = {}) {
  if (target.mode === 'workspace') {
    if (!target.workspacePath) throw new Error('缺少工作目录，无法复制到工作文件夹');
    const dir = path.resolve(target.workspacePath, 'videos');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
  if (target.mode === 'temp') {
    const raw = String(target.dir || '').trim();
    if (raw && !path.isAbsolute(raw)) throw new Error('临时目录必须是绝对路径');
    const dir = raw ? path.resolve(raw) : path.join(TEMP_ROOT, timestamp());
    if (fs.existsSync(dir) && !fs.statSync(dir).isDirectory()) throw new Error('目标路径已存在且不是目录');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
  throw new Error('未知的复制目标，只支持 workspace 或 temp');
}

/**
 * 把选中的视频目录从设备复制到本地目标。
 *
 * @param {object} options 选项。
 * @param {string} options.adbPath adb 可执行文件。
 * @param {string} options.serial 设备序列号。
 * @param {string} options.root 设备缓存目录。
 * @param {Array<string|{path: string}>} options.entries 选中的视频目录（`avid/cid`）。
 * @param {string} options.targetDir 目标目录（绝对路径）。
 * @returns {{targetDir: string, requested: number, imported: number, skipped: number, failed: number,
 *   results: Array<{path: string, ok: boolean, skipped?: boolean, localPath?: string, err?: string}>}} 结果摘要。
 */
function importEntries({ adbPath, serial, root, entries, targetDir }) {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('请先选择要导入的视频');
  if (entries.length > 200) throw new Error('一次最多导入 200 个视频');

  const results = [];
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (const item of entries) {
    const raw = typeof item === 'string' ? item : (item && item.path);
    let entryPath;
    try {
      entryPath = requireEntryPath(raw);
    } catch (e) {
      failed += 1;
      results.push({ path: String(raw || ''), ok: false, err: String(e.message) });
      continue;
    }

    const remote = `${root}/${entryPath}`;
    const localPath = path.join(targetDir, ...entryPath.split('/'));
    const entryFile = path.join(localPath, 'entry.json');

    if (fs.existsSync(entryFile)) {
      skipped += 1;
      results.push({ path: entryPath, ok: true, skipped: true, localPath });
      continue;
    }

    // adb pull 到不存在的目录时会“以远端目录名创建”，行为随版本略有差异；
    // 统一先拉到一个临时目录，再 rename 到最终位置，结果稳定。
    const staging = path.join(targetDir, `.staging-${crypto.randomBytes(6).toString('hex')}`);
    try {
      const pull = runAdb(adbPath, ['-s', serial, 'pull', remote, staging], { timeout: 10 * 60 * 1000 });
      if (pull.status !== 0) {
        throw new Error((pull.stderr || pull.stdout || 'adb pull 失败').trim().split(/\r?\n/).slice(-1)[0]);
      }
      if (!fs.existsSync(staging)) throw new Error('adb pull 没有生成文件');

      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      if (fs.existsSync(localPath)) fs.rmSync(localPath, { recursive: true, force: true });
      fs.renameSync(staging, localPath);

      if (!fs.existsSync(path.join(localPath, 'entry.json'))) {
        throw new Error('复制完成但缺少 entry.json（不是有效的 B 站缓存目录）');
      }
      imported += 1;
      results.push({ path: entryPath, ok: true, localPath });
    } catch (e) {
      failed += 1;
      results.push({ path: entryPath, ok: false, err: String((e && e.message) || e) });
      try {
        if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
      } catch (cleanupError) { /* 清理失败不影响结果 */ }
    }
  }

  return {
    targetDir,
    requested: entries.length,
    imported,
    skipped,
    failed,
    results,
  };
}

module.exports = {
  DEFAULT_DEVICE_ROOT,
  DEVICE_ROOTS,
  TEMP_ROOT,
  LIST_MARKER,
  ROOT_MARKER,
  PACKAGE_MARKER,
  findAdb,
  parseDevices,
  parseEntryDump,
  parseDetectOutput,
  makeEntry,
  requireDevice,
  requireDeviceRoot,
  requireEntryPath,
  requireBrowsePath,
  normalizeDevicePath,
  resolveTarget,
  listCache,
  detectRoots,
  browse,
  describe,
  importEntries,
};
