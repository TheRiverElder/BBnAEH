#!/usr/bin/env node
/**
 * 假的 adb，用于在没有真机的情况下跑通「读取缓存 → 复制到本地」的全链路测试。
 *
 * 环境变量：
 *   FAKE_ADB_FIXTURE      设备 /sdcard 对应的宿主机目录
 *   FAKE_ADB_NO_DEVICE    设为 1 时 `adb devices` 不返回设备
 *   FAKE_ADB_FAIL_LIST    设为 1 时「一次性读取列表」失败，用来测试回退路径
 *
 * 支持 adb 与本项目用到的全部调用：
 *   adb version
 *   adb devices -l
 *   adb -s <serial> shell        （脚本从 stdin 传入：列表 / 自动查找 / ls / cat）
 *   adb -s <serial> pull <remote> <local>
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SERIAL = 'FAKE123';
const LIST_MARKER = '@@BBNAEH@@';
const ROOT_MARKER = '@@R@@';
const PACKAGE_MARKER = '@@P@@';
const FIXTURE = process.env.FAKE_ADB_FIXTURE;
const DATA_ROOT = FIXTURE ? path.join(FIXTURE, 'Android', 'data') : '';

/**
 * 设备路径 → 宿主机路径。
 * @param {string} devicePath 设备上的绝对路径。
 * @returns {string|null} 宿主机路径；不在 /sdcard 下时返回 null。
 */
function toHost(devicePath) {
  const clean = String(devicePath || '').replace(/\/+$/, '');
  if (clean === '/sdcard' || clean === '/storage/emulated/0' || clean === '/storage/sdcard0') return FIXTURE;
  const match = /^\/(?:sdcard|storage\/emulated\/0|storage\/sdcard0)(\/.*)?$/.exec(clean);
  if (!match) return null;
  return path.join(FIXTURE, match[1] || '');
}

/**
 * 递归复制目录（模拟 adb pull 一个目录）。
 * @param {string} from 源目录。
 * @param {string} to 目标目录。
 * @returns {number} 复制的文件数。
 */
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  let count = 0;
  for (const name of fs.readdirSync(from)) {
    const source = path.join(from, name);
    const target = path.join(to, name);
    if (fs.statSync(source).isDirectory()) {
      count += copyDir(source, target);
    } else {
      fs.copyFileSync(source, target);
      count += 1;
    }
  }
  return count;
}

/**
 * 统计缓存目录里的 entry.json 数量（每个 avid/cid 一个）。
 * @param {string} dir 缓存目录。
 * @returns {number} entry.json 数量。
 */
function countEntries(dir) {
  let count = 0;
  for (const avid of fs.readdirSync(dir)) {
    const avidPath = path.join(dir, avid);
    if (!fs.statSync(avidPath).isDirectory()) continue;
    for (const cid of fs.readdirSync(avidPath)) {
      if (fs.existsSync(path.join(avidPath, cid, 'entry.json'))) count += 1;
    }
  }
  return count;
}

/**
 * 模拟自动查找脚本。
 * @returns {string} 脚本输出。
 */
function detectOutput() {
  let output = '';
  if (!fs.existsSync(DATA_ROOT)) return output;
  for (const pkg of fs.readdirSync(DATA_ROOT)) {
    if (!/^(tv\.danmaku\.bili|com\.bilibili\.)/.test(pkg)) continue;
    for (const sub of ['download', 'files/download', 'cache/download']) {
      const dir = path.join(DATA_ROOT, pkg, sub);
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
      const count = countEntries(dir);
      if (count > 0) output += `${ROOT_MARKER}/sdcard/Android/data/${pkg}/${sub}|${count}\n`;
    }
    output += `${PACKAGE_MARKER}/sdcard/Android/data/${pkg}\n`;
  }
  return output;
}

/**
 * 模拟「一次性读取所有 entry.json」脚本。
 * @param {string} script 脚本内容。
 * @returns {{status: number, output: string}} 状态与输出。
 */
function listOutput(script) {
  if (process.env.FAKE_ADB_FAIL_LIST === '1') return { status: 3, output: '' };
  const match = /cd '([^']+)'/.exec(script);
  const host = match ? toHost(match[1]) : null;
  if (!host || !fs.existsSync(host)) return { status: 3, output: '' };

  let output = '';
  for (const avid of fs.readdirSync(host)) {
    const avidPath = path.join(host, avid);
    if (!fs.statSync(avidPath).isDirectory()) continue;
    for (const cid of fs.readdirSync(avidPath)) {
      const entry = path.join(avidPath, cid, 'entry.json');
      if (!fs.existsSync(entry)) continue;
      output += `\n${LIST_MARKER}${avid}/${cid}/entry.json\n`;
      output += fs.readFileSync(entry, 'utf8');
    }
  }
  return { status: 0, output };
}

/**
 * 模拟 `ls -1 -p <dir>`。
 * @param {string} dir 设备路径。
 * @returns {{status: number, output: string, stderr: string}} 结果。
 */
function lsOutput(dir) {
  const host = toHost(dir);
  if (!host || !fs.existsSync(host) || !fs.statSync(host).isDirectory()) {
    return { status: 1, output: '', stderr: `ls: ${dir}: No such file or directory\n` };
  }
  const lines = fs.readdirSync(host).sort().map((name) => {
    const isDir = fs.statSync(path.join(host, name)).isDirectory();
    return isDir ? `${name}/` : name;
  });
  return { status: 0, output: `${lines.join('\n')}\n`, stderr: '' };
}

/**
 * 从 stdin 读取脚本并分派。
 * @returns {void}
 */
function runShellFromStdin() {
  const script = fs.readFileSync(0, 'utf8');
  if (script.includes(ROOT_MARKER)) {
    process.stdout.write(detectOutput());
    return;
  }
  if (script.includes(LIST_MARKER)) {
    const result = listOutput(script);
    process.stdout.write(result.output);
    process.exitCode = result.status;
    return;
  }
  const ls = /^ls -1 -p '(.+)'\s*$/m.exec(script);
  if (ls) {
    const result = lsOutput(ls[1]);
    process.stdout.write(result.output);
    process.stderr.write(result.stderr);
    process.exitCode = result.status;
    return;
  }
  const cat = /^cat '(.+)'\s*$/m.exec(script);
  if (cat) {
    const host = toHost(cat[1]);
    if (!host || !fs.existsSync(host) || !fs.statSync(host).isFile()) {
      process.stderr.write(`cat: ${cat[1]}: No such file or directory\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(fs.readFileSync(host, 'utf8'));
    return;
  }
  process.stderr.write('fake-adb: 未实现的 shell 命令\n');
  process.exitCode = 2;
}

/**
 * 主入口。
 * @returns {void}
 */
function main() {
  const args = process.argv.slice(2);
  if (!FIXTURE) {
    process.stderr.write('fake-adb: 缺少 FAKE_ADB_FIXTURE\n');
    process.exit(2);
  }

  if (args[0] === 'version') {
    process.stdout.write('Android Debug Bridge version 1.0.41\nVersion 34.0.5-fake\n');
    return;
  }

  if (args[0] === 'devices' && args[1] === '-l') {
    process.stdout.write('List of devices attached\n');
    if (process.env.FAKE_ADB_NO_DEVICE !== '1') {
      process.stdout.write(`${SERIAL}\tdevice product:fake model:Pixel_Fake device:fake transport_id:1\n`);
    }
    process.stdout.write('\n');
    return;
  }

  if (args[0] !== '-s' || args[1] !== SERIAL) {
    process.stderr.write('fake-adb: 未知设备\n');
    process.exit(1);
  }

  if (args[2] === 'shell') {
    runShellFromStdin();
    return;
  }

  if (args[2] === 'pull') {
    const host = toHost(args[3]);
    const local = args[4];
    if (!host || !fs.existsSync(host)) {
      process.stderr.write(`adb: error: remote object '${args[3]}' does not exist\n`);
      process.exit(1);
    }
    if (!local) {
      process.stderr.write('adb: error: destination directory is required\n');
      process.exit(1);
    }
    const count = copyDir(host, local);
    process.stdout.write(`${path.basename(args[3])}: ${count} file${count === 1 ? '' : 's'} pulled\n`);
    return;
  }

  process.stderr.write(`fake-adb: 未实现的命令 ${args.join(' ')}\n`);
  process.exit(2);
}

main();
