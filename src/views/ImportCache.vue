<template>
  <TopBarWrapper title="从手机导入 B 站缓存" @refresh="loadDevices">
    <ErrInfo v-show="err" :message="err" />
    <div class="import-page">
      <!-- 1. 设备 -->
      <section class="panel">
        <h3>1. 手机 / 设备</h3>
        <div class="row">
          <select v-model="device" :disabled="loadingDevices || !devices.length">
            <option value="">{{ loadingDevices ? '正在查找设备…' : '（请选择设备）' }}</option>
            <option v-for="item of devices" :key="item.serial" :value="item.serial">{{ item.label }}</option>
          </select>
          <button :disabled="loadingDevices" @click="loadDevices">刷新设备</button>
        </div>
        <p v-if="adb && adb.hint" class="hint warn">{{ adb.hint }}</p>
        <p v-else-if="adb" class="hint">
          adb：{{ adb.adbPath }}（{{ adb.source }}）{{ adb.adbVersion ? ' · ' + adb.adbVersion : '' }}
        </p>
      </section>

      <!-- 2. 缓存目录 -->
      <section class="panel">
        <h3>2. 手机上的缓存目录</h3>
        <div class="row">
          <input v-model="root" spellcheck="false" />
          <button :disabled="!device || loadingEntries || detecting" @click="loadEntries">
            {{ loadingEntries ? '读取中…' : '读取视频列表' }}
          </button>
          <button :disabled="!device || detecting" @click="autoDetect">
            {{ detecting ? '查找中…' : '自动查找' }}
          </button>
          <button :disabled="!device" @click="toggleBrowser">
            {{ browserOpen ? '收起浏览' : '浏览…' }}
          </button>
        </div>
        <p class="hint">
          B 站客户端有多个包名（<code>tv.danmaku.bili</code>、<code>com.bilibili.app.in</code> 等），
          缓存也可能在 SD 卡上。不知道路径就点「自动查找」，或「浏览…」手动定位到
          <code>Android/data/&lt;包名&gt;/download</code>。
        </p>

        <!-- 设备目录浏览器 -->
        <div class="browser" v-if="browserOpen">
          <div class="row browser-head">
            <button :disabled="!browsing.parent || browsingLoading" @click="browseTo(browsing.parent)">↑ 上一级</button>
            <input :value="browsing.path" readonly spellcheck="false" />
            <button class="primary small" :disabled="!browsing.path" @click="useBrowsedDir">使用此目录</button>
          </div>
          <p v-if="browseErr" class="hint warn">{{ browseErr }}</p>
          <div class="browser-list">
            <div
              v-for="entry of browsing.entries"
              :key="entry.path"
              class="browser-entry"
              :class="{ file: !entry.isDir }"
              @click="entry.isDir && browseTo(entry.path)"
            >
              <span class="browser-icon">{{ entry.isDir ? '&#x1F4C1;' : '&#x1F4C4;' }}</span>
              <span class="browser-name">{{ entry.name }}</span>
            </div>
            <p v-if="browsing.path && !browsing.entries.length" class="hint">（空目录）</p>
            <p v-if="browsingLoading" class="hint">读取中…</p>
          </div>
        </div>
      </section>

      <!-- 3. 选择视频 -->
      <section class="panel" v-if="entries.length">
        <h3>3. 选择视频（已选 {{ selected.length }} / {{ entries.length }}）</h3>
        <div class="row">
          <input v-model="filter" placeholder="按标题 / BV 号 / 目录过滤" spellcheck="false" />
          <button @click="toggleAll">{{ allSelected ? '全不选' : '全选当前' }}</button>
        </div>
        <div class="entry-list">
          <label v-for="entry of filteredEntries" :key="entry.path" class="entry">
            <input type="checkbox" :value="entry.path" v-model="selected" />
            <span class="entry-title">{{ entry.title || '（无标题）' }}</span>
            <span class="entry-meta">
              {{ entry.bvid || entry.avid }}
              <template v-if="entry.page > 1"> · P{{ entry.page }}</template>
              · {{ entry.path }}
            </span>
            <span v-if="entry.broken" class="entry-broken">entry.json 解析失败</span>
          </label>
          <p v-if="!filteredEntries.length" class="hint">没有匹配的视频。</p>
        </div>
      </section>

      <!-- 4. 复制到 -->
      <section class="panel">
        <h3>4. 复制到</h3>
        <label class="radio" :class="{ disabled: !workspacePath }">
          <input type="radio" value="workspace" v-model="mode" :disabled="!workspacePath" />
          工作文件夹的 videos/（导入后直接出现在视频列表）
        </label>
        <p class="hint indent" v-if="workspacePath">{{ workspacePath }}\videos</p>
        <p class="hint indent" v-else>
          还没有选择工作文件夹，
          <router-link :to="{ name: 'WorkspacePicker' }">先去选择</router-link>。
        </p>

        <label class="radio">
          <input type="radio" value="temp" v-model="mode" />
          本地临时文件夹（只复制过来，不加入视频列表）
        </label>
        <div class="row indent" v-if="mode === 'temp'">
          <input
            v-model="tempDir"
            spellcheck="false"
            :placeholder="tempPlaceholder"
          />
        </div>
        <p class="hint indent" v-if="mode === 'temp'">留空则自动创建带时间戳的子目录。</p>

        <button
          class="primary"
          :disabled="importing || !selected.length || (mode === 'workspace' && !workspacePath)"
          @click="doImport"
        >{{ importing ? '导入中…（大文件可能要几分钟）' : `导入选中的 ${selected.length} 个视频` }}</button>

        <p v-if="status" class="status">{{ status }}</p>
        <p v-if="result" class="hint">
          目标目录：<code>{{ result.targetDir }}</code>
        </p>
        <p v-if="result && mode === 'workspace' && result.imported > 0" class="hint">
          <router-link :to="{ name: 'Workspace', query: { path: workspacePath } }">→ 回到视频列表</router-link>
          （列表会自动刷新）
        </p>
      </section>
    </div>
  </TopBarWrapper>
</template>

<script>
import TopBarWrapper from '@/components/TopBarWrapper.vue';
import ErrInfo from '@/components/ErrInfo.vue';
import axios from 'axios';
import state from '@/state.js';

const ROOT_STORAGE_KEY = 'bbnaeh.adb.root';

/**
 * 记住上次成功使用的缓存目录（localStorage 不可用时忽略）。
 * @returns {string} 上次的目录，或空串。
 */
function loadSavedRoot() {
  try {
    return window.localStorage.getItem(ROOT_STORAGE_KEY) || '';
  } catch (e) {
    return '';
  }
}

/**
 * 保存缓存目录。
 * @param {string} root 目录。
 * @returns {void}
 */
function saveRoot(root) {
  try {
    window.localStorage.setItem(ROOT_STORAGE_KEY, root);
  } catch (e) { /* 隐私模式下忽略 */ }
}

export default {
  name: 'ImportCache',
  components: {
    TopBarWrapper,
    ErrInfo,
  },
  data() {
    return {
      workspacePath: this.$route.query.path || '',
      adb: null,
      devices: [],
      device: '',
      root: loadSavedRoot(),
      entries: [],
      selected: [],
      filter: '',
      loadingDevices: false,
      loadingEntries: false,
      detecting: false,
      importing: false,
      browserOpen: false,
      browsing: { path: '', parent: null, entries: [] },
      browseErr: '',
      browsingLoading: false,
      err: null,
      status: '',
      mode: this.$route.query.path ? 'workspace' : 'temp',
      tempDir: '',
      result: null,
    };
  },
  computed: {
    filteredEntries() {
      const keyword = this.filter.trim().toLowerCase();
      if (!keyword) return this.entries;
      return this.entries.filter(entry =>
        `${entry.title} ${entry.bvid} ${entry.avid} ${entry.path}`.toLowerCase().includes(keyword));
    },
    allSelected() {
      return this.filteredEntries.length > 0
        && this.filteredEntries.every(entry => this.selected.includes(entry.path));
    },
    tempPlaceholder() {
      return this.adb ? this.adb.tempDefault : '留空则使用系统临时目录';
    },
  },
  methods: {
    /**
     * 读取 adb 环境与设备列表；选好设备后自动定位缓存目录。
     * @returns {Promise<void>} 完成。
     */
    async loadDevices() {
      this.loadingDevices = true;
      this.err = null;
      try {
        const res = await axios.get(state.urlAdbInfo);
        const data = res.data || {};
        if (!data.succeed) {
          this.err = data.err || '读取 adb 环境失败';
          return;
        }
        this.adb = data;
        this.devices = data.devices || [];
        const current = this.devices.find(item => item.serial === this.device);
        if (!current || current.state !== 'device') {
          const usable = this.devices.find(item => item.state === 'device');
          this.device = usable ? usable.serial : '';
        }
        if (!this.device) {
          this.status = '';
          return;
        }
        // 先用记住的目录试一次；失败（例如换了手机/换了包名）再自动查找。
        if (this.root) {
          const ok = await this.loadEntries();
          if (!ok) await this.autoDetect();
        } else {
          await this.autoDetect();
        }
      } catch (e) {
        this.err = e + '，请检查服务器是否仍在运行';
      } finally {
        this.loadingDevices = false;
      }
    },
    /**
     * 读取设备上的缓存视频列表。
     * @returns {Promise<boolean>} 是否读取成功。
     */
    async loadEntries() {
      if (!this.device) return false;
      this.loadingEntries = true;
      this.err = null;
      this.status = '';
      try {
        const res = await axios.post(state.urlAdbList, { device: this.device, root: this.root });
        const data = res.data || {};
        if (!data.succeed) {
          this.err = data.err || '读取缓存列表失败';
          this.entries = [];
          this.selected = [];
          return false;
        }
        this.entries = data.entries || [];
        // 保留仍然存在的勾选（重新读取时不会丢选择）
        const available = new Set(this.entries.map(entry => entry.path));
        this.selected = this.selected.filter(value => available.has(value));
        this.status = `读取到 ${this.entries.length} 个视频`
          + `（${data.mode === 'fast' ? '一次读取' : '逐个读取'}，${data.ms} ms）`;
        saveRoot(this.root);
        return true;
      } catch (e) {
        this.err = e + '，请检查服务器是否仍在运行';
        return false;
      } finally {
        this.loadingEntries = false;
      }
    },
    /**
     * 自动查找设备上的 B 站缓存目录（支持多个包名 / SD 卡）。
     * @returns {Promise<boolean>} 是否找到并成功读取。
     */
    async autoDetect() {
      if (!this.device || this.detecting) return false;
      this.detecting = true;
      this.err = null;
      try {
        const res = await axios.post(state.urlAdbDetect, { device: this.device });
        const data = res.data || {};
        if (!data.succeed) {
          this.err = data.err || '自动查找缓存目录失败';
          return false;
        }
        const roots = data.roots || [];
        if (roots.length > 0) {
          this.root = roots[0].path;
          const ok = await this.loadEntries();
          if (ok) {
            this.status = `已自动定位到 ${this.root}`
              + (roots.length > 1
                ? `（共找到 ${roots.length} 个缓存目录：${roots.map(item => `${item.path} ${item.entries} 个`).join('；')}）`
                : '')
              + `，读取到 ${this.entries.length} 个视频。`;
          }
          return ok;
        }
        const packages = data.packages || [];
        this.status = packages.length
          ? `找到了 B 站客户端（${packages.map(item => item.split('/').pop()).join('、')}），`
            + '但里面还没有已下载的缓存。先在 App 里下载视频，或用「浏览…」手动定位。'
          : '没有自动找到 B 站缓存目录。可以点「浏览…」手动定位，'
            + '一般在 Android/data/<包名>/download。';
        return false;
      } catch (e) {
        this.err = e + '，请检查 USB 连接与服务器状态';
        return false;
      } finally {
        this.detecting = false;
      }
    },
    /** 展开 / 收起设备目录浏览器。 */
    async toggleBrowser() {
      if (this.browserOpen) {
        this.browserOpen = false;
        return;
      }
      this.browserOpen = true;
      await this.browseTo(this.root || '/sdcard');
    },
    /**
     * 浏览设备上的一个目录。
     * @param {string|null} dirPath 目录；为空时忽略。
     * @returns {Promise<void>} 完成。
     */
    async browseTo(dirPath) {
      if (!dirPath) return;
      this.browsingLoading = true;
      this.browseErr = '';
      try {
        const res = await axios.post(state.urlAdbBrowse, { device: this.device, path: dirPath });
        const data = res.data || {};
        if (!data.succeed) {
          this.browseErr = data.err || '读取设备目录失败';
          return;
        }
        this.browsing = data;
      } catch (e) {
        this.browseErr = e + '，请检查服务器是否仍在运行';
      } finally {
        this.browsingLoading = false;
      }
    },
    /** 使用浏览器当前所在的目录作为缓存目录。 */
    useBrowsedDir() {
      if (!this.browsing.path) return;
      this.root = this.browsing.path;
      this.browserOpen = false;
      this.loadEntries();
    },
    /** 全选 / 全不选当前过滤结果。 */
    toggleAll() {
      if (this.allSelected) {
        this.selected = [];
      } else {
        this.selected = this.filteredEntries.map(entry => entry.path);
      }
    },
    /**
     * 执行导入。
     * @returns {Promise<void>} 完成。
     */
    doImport() {
      if (this.importing || !this.selected.length) return Promise.resolve();
      this.importing = true;
      this.err = null;
      this.status = '';
      this.result = null;
      return axios.post(state.urlAdbImport, {
        device: this.device,
        root: this.root,
        entries: this.selected,
        target: {
          mode: this.mode,
          dir: this.mode === 'temp' ? this.tempDir : '',
          workspacePath: this.workspacePath,
        },
      }, { timeout: 30 * 60 * 1000 })
        .then(res => {
          const data = res.data || {};
          if (!data.succeed) {
            this.err = data.err || '导入失败';
            return;
          }
          this.result = data.result;
          const failed = (data.result.results || []).filter(item => !item.ok);
          this.status = `已导入 ${data.result.imported} 个`
            + (data.result.skipped ? `，跳过 ${data.result.skipped} 个（目标已存在）` : '')
            + (failed.length ? `，失败 ${failed.length} 个：${failed.map(item => `${item.path}（${item.err}）`).join('；')}` : '');
        })
        .catch(e => {
          this.err = e + '，请检查 USB 连接与服务器状态';
        })
        .then(() => {
          this.importing = false;
        });
    },
  },
  created() {
    this.loadDevices();
  },
};
</script>

<style scoped>
.import-page {
  width: 100%;
  height: 100%;
  padding: 1rem;
  box-sizing: border-box;
  overflow-y: auto;
  text-align: left;
}
.panel {
  max-width: 60rem;
  margin: 0 auto 1rem;
  padding: 1rem;
  background-color: #fff;
  border-radius: 0.5rem;
  box-sizing: border-box;
}
.panel h3 {
  margin: 0 0 0.8rem;
  font-size: 1rem;
}
.row {
  display: flex;
  align-items: center;
  margin-bottom: 0.5rem;
}
.row > input,
.row > select {
  flex: 1;
  min-width: 0;
  height: 1.8rem;
  padding: 0 0.5rem;
  border: 1px solid #cecece;
  border-radius: 0.3rem;
  box-sizing: border-box;
}
.row > button {
  margin-left: 0.5rem;
  height: 1.8rem;
  padding: 0 0.9rem;
  border: none;
  border-radius: 0.3rem;
  background-color: #eef1f8;
  color: #3c4a6b;
  cursor: pointer;
  white-space: nowrap;
}
.row > button[disabled] {
  color: #aaa;
  cursor: not-allowed;
}
.hint {
  margin: 0.3rem 0 0;
  font-size: 0.8rem;
  color: #888;
  line-height: 1.5;
}
.hint.warn {
  color: #a4571f;
}
.hint.indent {
  margin-left: 1.5rem;
}
.hint code {
  background-color: #f3f4f7;
  padding: 0 0.2rem;
  border-radius: 0.2rem;
}
.entry-list {
  max-height: 24rem;
  overflow-y: auto;
  margin-top: 0.5rem;
  border-top: 1px solid #eee;
}
.entry {
  display: flex;
  align-items: baseline;
  padding: 0.4rem 0.2rem;
  border-bottom: 1px solid #f2f2f2;
  cursor: pointer;
}
.entry:hover {
  background-color: #fafbff;
}
.entry > input {
  margin-right: 0.5rem;
}
.entry-title {
  flex: 1;
  min-width: 0;
  font-size: 0.9rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.entry-meta {
  margin-left: 1rem;
  font-size: 0.75rem;
  color: #999;
  white-space: nowrap;
}
.entry-broken {
  margin-left: 0.5rem;
  font-size: 0.75rem;
  color: #c0392b;
}
.radio {
  display: block;
  margin: 0.5rem 0;
  font-size: 0.9rem;
  cursor: pointer;
}
.radio.disabled {
  color: #aaa;
  cursor: not-allowed;
}
button.primary {
  margin-top: 0.8rem;
  padding: 0.45rem 1.2rem;
  border: none;
  border-radius: 0.3rem;
  background-color: #3c4a6b;
  color: #fff;
  font-weight: bold;
  cursor: pointer;
}
button.primary[disabled] {
  background-color: #c3c8d4;
  cursor: not-allowed;
}
.status {
  margin: 0.6rem 0 0;
  font-size: 0.85rem;
  color: #3c4a6b;
}
.browser {
  margin-top: 0.6rem;
  padding: 0.5rem;
  border: 1px solid #e3e6f0;
  border-radius: 0.3rem;
  background-color: #fbfcff;
}
.browser-head > input {
  background-color: #fff;
  color: #666;
}
.browser-list {
  max-height: 16rem;
  overflow-y: auto;
  margin-top: 0.4rem;
}
.browser-entry {
  display: flex;
  align-items: center;
  padding: 0.25rem 0.3rem;
  border-radius: 0.2rem;
  cursor: pointer;
}
.browser-entry:hover {
  background-color: #eef1f8;
}
.browser-entry.file {
  color: #aaa;
  cursor: default;
}
.browser-entry.file:hover {
  background-color: transparent;
}
.browser-icon {
  width: 1.3rem;
  font-size: 0.85rem;
}
.browser-name {
  font-size: 0.85rem;
  word-break: break-all;
}
button.primary.small {
  margin-top: 0;
  padding: 0.25rem 0.8rem;
  font-size: 0.8rem;
}
</style>
