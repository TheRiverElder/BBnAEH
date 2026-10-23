<template>
  <TopBarWrapper :title="`视频列表(${workspace ? workspace.videos.length : 0})`" @refresh="refresh">
      <ErrInfo v-show="err" :message="err" />
      <div v-if="workspace" class="workspace">
        <!-- 动作按钮 -->
        <aside class="action-bar">
          <div class="engine-picker" :title="engineHint">
            <span>识别引擎</span>
            <select v-model="engine">
              <option v-for="option of engineOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
          </div>
          <div
            class="select-button"
            :disabled="waiting || !workspace.videos.length"
            :title="selectedVideos.length ? '反转每个视频的勾选状态' : '勾选全部视频'"
            @click="toggleSelectAll"
          >{{ selectedVideos.length === 0 ? '全选' : '反选' }}</div>
          <div
            class="act-button"
            :disabled="waiting || !selectedVideos.length"
            @click="act"
          >{{ waiting ? '执行中…' : '执行' }}</div>
          <div
            class="delete-button"
            :disabled="waiting || !selectedVideos.length"
            :title="selectedVideos.length ? '从 videos 目录永久删除勾选的视频' : '先勾选要删除的视频'"
            @click="deleteSelected"
          >删除所选({{ selectedVideos.length }})</div>
          <router-link
            class="import-link"
            :to="{ name: 'ImportCache', query: { path } }"
            title="通过 adb 把手机上的 B 站缓存复制到 videos/"
          >从手机导入</router-link>
          <div v-if="status" class="status">{{ status }}</div>
        </aside>
        <!-- 视频列表 -->
        <div>
          <BVideo
            v-for="video of workspace.videos"
            :key="video.path"
            ref="videos"
            :path="video.path"
            :entry="video.entry"
            :engine="engine"
            @select="selectVideo"
            @unselect="unselectVideo"
            @delete="deleteVideo(video)"
            class="video"
          />
        </div>
        <!-- 歌曲列表 -->
        <div>
          <!-- 已有歌曲列表 -->
          <div v-for="audio of workspace.audios" :key="audio.path" class="audio static">
            <span>{{ audio.name }}</span>
            <span>{{ audio.path }}</span>
          </div>
          <!-- 追加歌曲列表 -->
          <div v-for="video of selectedVideos" 
            :key="video.path" 
            class="audio"
          >
            <span>{{ video.name }}</span>
            <span>{{ video.path }}</span>
          </div>
        </div>
      </div>
  </TopBarWrapper>
</template>

<script>
import TopBarWrapper from "@/components/TopBarWrapper.vue";
import BVideo from "@/components/BVideo.vue";
import ErrInfo from "@/components/ErrInfo.vue";
import axios from "axios";
import state from '@/state.js';
import { ENGINE_OPTIONS, ENGINE_SMART, extractorInfo } from '@/songTitle.js';

const ENGINE_STORAGE_KEY = 'bbnaeh.engine';

/**
 * 读取上次选择的引擎（localStorage 不可用时退回智能引擎）。
 * @returns {string} 引擎标识。
 */
function loadEngine() {
  try {
    const saved = window.localStorage.getItem(ENGINE_STORAGE_KEY);
    return ENGINE_OPTIONS.some(option => option.value === saved) ? saved : ENGINE_SMART;
  } catch (e) {
    return ENGINE_SMART;
  }
}

export default {
  name: "Workspace",
  components: {
    TopBarWrapper,
    BVideo,
    ErrInfo
  },
  data() {
    const meta = extractorInfo();
    const trained = Number(meta.model.rows);
    return {
      path: "",
      workspace: null,
      selectedVideos: [],
      err: null,
      waiting: false,
      status: '',
      engine: loadEngine(),
      engineOptions: ENGINE_OPTIONS,
      engineHint: `智能引擎：词典 ${meta.artists} 位歌手 / ${meta.bands} 个组合；`
        + `排序器 ${meta.members} 个成员（${meta.features} 维特征）`
        + (Number.isFinite(trained) ? `，训练 ${trained} 行` : '')
        + '。旧版引擎只用 12 位歌姬 + 3 个组合的关键词匹配，仅作对照。',
    };
  },

  watch: {
    engine(value) {
      try {
        window.localStorage.setItem(ENGINE_STORAGE_KEY, value);
      } catch (e) { /* 隐私模式下忽略 */ }
    },
  },

  methods: {
    refresh() {
      axios
        .get(state.urlWorkspace, { params: { path: this.path } })
        .then(res => {
          if (!res.data.succeed) {
            this.err = res.data.err + "，请稍后刷新重试";
            return;
          }
          this.workspace = res.data.workspace;
          this.err = null;
          // 视频被删除/导入后，清理已经不在列表里的勾选项
          const available = new Set(this.workspace.videos.map(video => video.path));
          this.selectedVideos = this.selectedVideos.filter(video => available.has(video.path));
        })
        .catch(e => (this.err = e + "，请检查网络连接并刷新"));
    },
    /**
     * 全选 / 反选：没有勾选时选中全部，已有勾选时逐个反转。
     *
     * 勾选状态是 BVideo 内部的数据（通过 select/unselect 事件同步到右侧列表），
     * 所以这里直接驱动子组件，而不是只改 selectedVideos（那样卡片不会跟着变）。
     * @returns {void}
     */
    toggleSelectAll() {
      if (this.waiting) return;
      const videos = this.$refs.videos || [];
      if (!videos.length) return;
      const anySelected = videos.some(video => video.selected);
      videos.forEach(video => video.setSelected(anySelected ? !video.selected : true));
    },
    /**
     * 取消所有卡片的勾选（执行成功后调用，避免左侧卡片仍显示勾选）。
     * @returns {void}
     */
    clearCardSelection() {
      (this.$refs.videos || []).forEach(video => video.setSelected(false));
    },
    selectVideo(entry) {
      // 切换引擎时 BVideo 会重新发送一次 select，这里按路径更新而不是重复追加。
      const existing = this.selectedVideos.find(video => video.path === entry.path);
      if (existing) {
        existing.name = entry.name;
      } else {
        this.selectedVideos.push(entry);
      }
    },
    unselectVideo(path) {
      const index = this.selectedVideos.findIndex(e => e.path === path);
      if (index >= 0) {
        this.selectedVideos.splice(index, 1);
      }
    },
    removeSong(index) {
      this.selectedVideos.splice(index, 1);
    },
    act() {
      if (this.waiting || !this.selectedVideos.length) return;
      const config = {
        workspacePath: this.path,
        list: this.selectedVideos,
      };
      this.waiting = true;
      this.status = '';
      this.err = null;
      axios.post(state.urlAct, config)
      .then(res => {
        if (res.data && res.data.succeed) {
          const summary = res.data.result || {};
          this.status = `已提取 ${summary.converted ?? '?'} 首`
            + (summary.skipped ? `，跳过 ${summary.skipped} 首（同名文件已存在）` : '')
            + (summary.failed ? `，失败 ${summary.failed} 首（详见服务器控制台）` : '');
          this.selectedVideos = [];
          this.clearCardSelection();
          this.refresh();
        } else {
          this.err = (res.data && res.data.err) || '执行失败';
        }
      }).catch(e => {
        this.err = e + '，请检查服务器是否仍在运行';
      }).then(() => {
        this.waiting = false;
      });
    },
    /**
     * 删除前的确认框：列出将要删除的路径（最多 5 条）。
     * @param {Array<{path: string}>} videos 待删除的视频。
     * @returns {boolean} 用户是否确认。
     */
    confirmDelete(videos) {
      const paths = videos.map(video => video.path);
      const preview = paths.slice(0, 5).map((p, i) => `${i + 1}. ${p}`).join('\n');
      const more = paths.length > 5 ? `\n…共 ${paths.length} 个` : '';
      return window.confirm(
        `将从 videos 目录永久删除以下 ${paths.length} 个视频（不可恢复）：\n\n`
        + `${preview}${more}\n\n`
        + '只删除 videos/ 下的缓存目录，audios/ 里已经导出的歌曲不受影响。',
      );
    },
    /**
     * 调用后端删除视频，刷新列表并同步勾选状态。
     * @param {Array<{path: string}>} videos 待删除的视频。
     * @returns {Promise<void>} 删除结束（无论成功失败）。
     */
    removeVideos(videos) {
      if (this.waiting || !videos.length) return Promise.resolve();
      if (!this.confirmDelete(videos)) return Promise.resolve();
      this.waiting = true;
      this.status = '';
      this.err = null;
      return axios.post(state.urlVideoDelete, {
        workspacePath: this.path,
        list: videos.map(video => ({path: video.path})),
      }).then(res => {
        const data = res.data || {};
        if (!data.succeed) {
          this.err = data.err || '删除失败';
          return;
        }
        const result = data.result || {};
        const failed = (result.results || []).filter(item => !item.ok);
        this.status = `已删除 ${result.deleted ?? 0} 个视频`
          + (failed.length ? `，失败 ${failed.length} 个：${failed.map(item => `${item.path}（${item.err}）`).join('；')}` : '');
        // 删除失败的条目保持勾选，避免界面勾选状态和右侧列表对不上。
        const failedPaths = new Set(failed.map(item => item.path));
        this.selectedVideos = this.selectedVideos.filter(video => failedPaths.has(video.path));
        this.refresh();
      }).catch(e => {
        this.err = e + '，请检查服务器是否仍在运行';
      }).then(() => {
        this.waiting = false;
      });
    },
    /** 删除勾选的视频。 */
    deleteSelected() {
      return this.removeVideos(this.selectedVideos.slice());
    },
    /**
     * 删除单个视频（卡片右下角的 ✕）。
     * @param {{path: string}} video 视频。
     * @returns {Promise<void>} 删除结束。
     */
    deleteVideo(video) {
      return this.removeVideos([video]);
    },
  },

  created() {
    this.path = this.$route.query["path"] || "";
    this.refresh();
  }
};
</script>

<style scoped>
.workspace {
  width: 100%;
  height: 100%;
  padding: 1rem;
  display: flex;
  box-sizing: border-box;
}
.workspace > * {
  height: 100%;
  padding: 1rem;
  overflow-y: auto;
  box-sizing: border-box;
}
.workspace > *:nth-child(2) {
  flex: 6;
  padding: 0;
  margin: 0 1rem;
}
.workspace > *:nth-child(3) {
  flex: 4;
  background-color: #fff;
  border-radius: 0.5rem;
}

.video {
  width: 100%;
  margin-bottom: 1em;
}

.static {
  cursor: not-allowed;
  color: #aaa;
}
.audio {
  width: 100%;
  padding: 0.5em 1em;
  margin: 0;
  border-bottom: 1px solid #ccc;
  box-sizing: border-box;
}
.audio > *:first-child {
  margin-right: 1em;
}
.audio > *:nth-child(2) {
  font-weight: lighter;
  font-size: 0.8em;
  color: #aaa;
}

.action-bar {
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  align-items: center;
  box-sizing: border-box;
  background-color: #fff;
  border-radius: 0.5rem;
}
.action-bar > * {
  padding: 1rem 0;
  font-weight: bold;
  font-family: Consolas, 微软雅黑;
  user-select: none;
  border-bottom: 1px solid #ccc;
}
.engine-picker {
  width: 100%;
  padding: 0.5rem 1rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  font-size: 0.8rem;
  font-weight: normal;
  color: #666;
  cursor: help;
  box-sizing: border-box;
}
.engine-picker > select {
  margin-top: 0.5rem;
  max-width: 100%;
  font-size: 0.8rem;
}
.select-button {
  width: 100%;
  text-align: center;
  cursor: pointer;
  font-size: 0.95rem;
  color: #3c4a6b;
  box-sizing: border-box;
}
.select-button:not([disabled]):hover {
  background-color: #eef1f8;
}
.select-button[disabled] {
  cursor: not-allowed;
  color: #b9bdca;
}
.act-button {
  width: 100%;
  text-align: center;
  cursor: pointer;
}
.act-button[disabled] {
  cursor: not-allowed;
  color: #888;
}
.delete-button {
  width: 100%;
  text-align: center;
  cursor: pointer;
  font-size: 0.95rem;
  color: #b23b3b;
}
.delete-button:not([disabled]):hover {
  background-color: #fdeeee;
}
.delete-button[disabled] {
  cursor: not-allowed;
  color: #c9a3a3;
}
.import-link {
  width: 100%;
  text-align: center;
  text-decoration: none;
  color: #3c4a6b;
  font-size: 0.95rem;
  box-sizing: border-box;
}
.import-link:hover {
  background-color: #eef1f8;
}
.status {
  width: 100%;
  padding: 0.5rem 1rem;
  font-size: 0.75rem;
  font-weight: normal;
  color: #5e6b8c;
  border-bottom: none;
  box-sizing: border-box;
  word-break: break-all;
}
</style>
