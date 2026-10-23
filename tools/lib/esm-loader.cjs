'use strict';

/**
 * 让 Node 能 require 本项目的 ESM 源码（src/**）。
 *
 * 本项目的 src 是给 webpack 用的 ES 模块，而 package.json 没有 "type": "module"
 * （server.js 与 babel.config.js 是 CJS），Node 直接 require 会报
 * "Cannot use import statement outside a module"。这里用 @babel/core 现场把
 * 目标目录转成 CJS 后交给 Node 编译，不改动任何源文件、也不影响 webpack 构建。
 *
 * 只对 src/abstractor、src/songTitle.js、src/utils.js 生效，node_modules 不受影响。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

/** 允许通过本加载器加载的文件/目录。 */
const TARGETS = [
  path.join(ROOT, 'src', 'abstractor'),
  path.join(ROOT, 'src', 'songTitle.js'),
  path.join(ROOT, 'src', 'utils.js'),
];

/**
 * 判断某个文件是否属于需要转译的项目源码。
 * @param {string} file 文件路径。
 * @returns {boolean} `true` 表示需要转译。
 */
function isProjectEsm(file) {
  const absolute = path.resolve(file);
  return TARGETS.some((target) => (target.endsWith('.js')
    ? absolute === target
    : absolute.startsWith(`${target}${path.sep}`)));
}

/**
 * 注册 require 钩子（重复调用无副作用）。
 * @returns {{babel: object}} 实际使用的 @babel/core。
 * @throws {Error} 当缺少 @babel/core 或 CommonJS 转换插件时。
 */
function registerEsmLoader() {
  let babel;
  let plugin;
  try {
    babel = require('@babel/core');
    plugin = require.resolve('@babel/plugin-transform-modules-commonjs');
  } catch (error) {
    console.error('需要 @babel/core 与 @babel/plugin-transform-modules-commonjs（vue-cli 4 已随依赖安装）。');
    throw error;
  }

  if (registerEsmLoader.installed) return { babel };
  registerEsmLoader.installed = true;

  const originalJs = require.extensions['.js'];
  require.extensions['.js'] = function loadProjectEsm(module, filename) {
    if (!isProjectEsm(filename)) return originalJs(module, filename);
    const { code } = babel.transformSync(fs.readFileSync(filename, 'utf8'), {
      filename,
      babelrc: false,
      configFile: false,
      sourceType: 'module',
      plugins: [plugin],
      compact: false,
    });
    module._compile(code, filename);
  };

  return { babel };
}

module.exports = { ROOT, registerEsmLoader, isProjectEsm };
