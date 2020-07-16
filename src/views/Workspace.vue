<template>
  <TopBarWrapper :title="`视频列表(${workspace ? workspace.videos.length : 0})`" @refresh="refresh">
      <ErrInfo v-show="err" :message="err" />
      <div v-if="workspace" class="workspace">
        <!-- 动作按钮 -->
        <aside class="action-bar">
          <div @click="act" :disabled="waiting">执行</div>
        </aside>
        <!-- 视频列表 -->
        <div>
          <BVideo
            v-for="video of workspace.videos"
            :key="video.path"
            :path="video.path"
            :entry="video.entry"
            @select="selectVideo"
            @unselect="unselectVideo"
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

export default {
  name: "Workspace",
  components: {
    TopBarWrapper,
    BVideo,
    ErrInfo
  },
  data() {
    return {
      path: "",
      workspace: null,
      selectedVideos: [],
      err: null,
      waiting: false,
    };
  },

  methods: {
    refresh() {
      axios
        .get(state.urlWorkspace + `?path=${this.path}`)
        .then(res =>
          res.data.succeed
            ? ((this.workspace = res.data.workspace), (this.err = null))
            : (this.err = res.data.err + "，请稍后刷新重试")
        )
        .catch(e => (this.err = e + "，请检查网络连接并刷新"));
    },
    selectVideo(entry) {
      this.selectedVideos.push(entry);
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
      const config = {
        workspacePath: this.path,
        list: this.selectedVideos,
      };
      axios.post(state.urlAct, config)
      .then(res => {
        this.waiting = false;
        if (res.data.succeed) {
          console.log('Action started, config:', res.config);
          alert('Action started! Open console to see the config.');
        }
      }).catch(e => {
        this.err = e;
        this.waiting = false;
        console.log('Action error:', e)
      });
      this.waiting = true;
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
  cursor: pointer;
  border-bottom: 1px solid #ccc;
}

.action-bar > *[disabled] {
  cursor: wait;
  color: #888;
}
</style>
