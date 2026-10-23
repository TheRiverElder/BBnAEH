const API_TARGET = process.env.BBNAEH_API || 'http://127.0.0.1:9722';

// webpack 4（vue-cli 4）内部到处调用 crypto.createHash('md4')：HashedModuleIdsPlugin、
// cache-loader 的缓存摘要等。Node >= 17 默认使用 OpenSSL 3，md4 属于 legacy provider，
// 会直接抛 ERR_OSSL_EVP_UNSUPPORTED，导致 `npm run serve` / `npm run build` 失败。
// 这里把 md4 映射到 sha256（两者都只用于取哈希，长度不同不影响正确性），
// 这样不必再设置 NODE_OPTIONS=--openssl-legacy-provider，旧版 Node 上也依然可用。
const crypto = require('crypto');
const createHash = crypto.createHash;
crypto.createHash = function patchedCreateHash(algorithm, options) {
  return createHash.call(this, algorithm === 'md4' ? 'sha256' : algorithm, options);
};

// vue.config.js
module.exports = {
  // 开发模式（npm run serve）下把接口请求转发给本地 server.js，
  // 否则页面在 8080 端口上请求 /info /dir-list /workspace /act 会 404。
  devServer: {
    proxy: {
      '/info': { target: API_TARGET, changeOrigin: true },
      '/dir-list': { target: API_TARGET, changeOrigin: true },
      '/workspace': { target: API_TARGET, changeOrigin: true },
      '/act': { target: API_TARGET, changeOrigin: true },
      '/videos': { target: API_TARGET, changeOrigin: true },
      '/adb': { target: API_TARGET, changeOrigin: true },
    },
  },
};
