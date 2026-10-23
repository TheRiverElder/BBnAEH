<template>
  <div class="b-video">
    <img 
      class="cover"
      :src="cover"
      :alt="title"
    />
    <!-- <img src="favicon.ico"/> -->
    <div class="bv-info-wrapper">
      <div class="bv-info">
        <div class="title"><a :href="`https://www.bilibili.com/video/${bvid}`" target="_blank">→</a><span>{{ title }}</span></div>
        <div class="bv-info-detail">
          <div><span>文件路径</span><span>{{ path }}</span></div>
          <div><span>AV号</span><span>{{ avid }}</span></div>
          <div><span>BV号</span><span>{{ bvid }}</span></div>
        </div>
        <div class="song-name">
          <span>曲名</span>
          <input v-model="songName" :disabled="selected"/>
          <span
            class="source"
            :class="{ 'is-fallback': !!info.fallback || !!info.error }"
            :title="hint"
          >{{ sourceLabel }}</span>
          <button class="retry" :disabled="selected" title="重新识别曲名" @click="refreshSongName">&#x21bb;</button>
        </div>
      </div>
    </div>
    <div class="actions">
      <input
        class="selected"
        type="checkbox"
        v-model="selected"
        title="勾选后可提取；取消勾选可修改曲名"
      />
      <button
        class="delete"
        title="从 videos 目录删除这个视频（误复制的缓存可以这样清理，删除后不可恢复）"
        @click="$emit('delete')"
      >&#x2715;</button>
    </div>
  </div>
</template>

<script>
import { extractSongInfo, formatSongName, sanitizeFileName, artistSourceLabel } from '@/songTitle.js';

export default {
  name: 'BVideo',
  props: {
    path: String,
    entry: Object,
    // 曲名提取引擎：'smart'（默认，词典 + 排序器）或 'legacy'（旧版关键词匹配）。
    engine: {
      type: String,
      default: 'smart',
    },
  },

  data() {
    return {
      selected: false,
      songName: this.entry.title,
      info: {},
    };
  },

  watch: {
    selected(newVal) {
      newVal 
      ? this.$emit('select', {path: this.path, name: this.songName})
      : this.$emit('unselect', this.path);
    },
    engine() {
      this.refreshSongName();
      // 已勾选的条目在右侧列表里保存的是快照，换了引擎要把新名字同步过去。
      if (this.selected) this.$emit('select', {path: this.path, name: this.songName});
    },
  },

  computed: {
    avid() { return this.entry.avid; },
    bvid() { return this.entry.bvid; },
    cover() { return this.entry.cover; },
    title() { return this.entry.title; },
    sourceLabel() { return artistSourceLabel(this.info); },
    hint() {
      const lines = [];
      if (this.info.error) lines.push(`智能引擎出错，已回退旧版：${this.info.error}`);
      else if (this.info.fallback) lines.push('智能引擎没有给出候选，已回退旧版');
      lines.push(`引擎：${this.engine === 'legacy' ? '旧版关键词匹配' : '智能（词典 + 排序器）'}`);
      if (this.engine !== 'legacy' && this.info.candidates && this.info.candidates.length) {
        lines.push('', '候选排名：');
        this.info.candidates.forEach((candidate, index) => {
          lines.push(`${index + 1}. ${candidate.text}  score=${candidate.score}  (${candidate.variant})`);
        });
      }
      return lines.join('\n');
    },
  },

  methods: {
    /**
     * 按当前引擎重新识别曲名，并清洗成合法文件名。
     * 勾选状态下不改动，避免用户已经确认的名字被覆盖。
     */
    refreshSongName() {
      const info = extractSongInfo(this.title, { engine: this.engine });
      this.info = info;
      this.songName = sanitizeFileName(formatSongName(info));
    },
    /**
     * 由父组件（全选 / 反选 / 执行完清空）设置勾选状态。
     * 变更会通过 selected 的 watcher 通知 Workspace。
     * @param {boolean} value 是否选中。
     * @returns {void}
     */
    setSelected(value) {
      const next = !!value;
      if (this.selected === next) return;
      this.selected = next;
    },
  },

  created() {
    this.refreshSongName();
  },
  
}
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>
    .b-video {
      height: 6rem;
      background-color: #fff;
      border-radius: .5rem;
      padding: .5rem;
      display: flex;
      justify-content: center;
      align-items: center;
      box-sizing: border-box;
    }
    .cover {
      height: 100%;
      width: 10rem;
      object-fit: contain;
      border-radius: .2rem;
    }
    .bv-info-wrapper {
      flex: 1;
      height: 100%;
      margin: 0 1rem;
    }

    .bv-info {
      height: 100%;
      width: 100%;
    }
    .title {
      color: #222222;
      font-weight: bold;
      text-align: left;
    }
    .title:hover {
      color: #5e5679;
    }
    .bv-info-detail {
      display: flex;
    }
    .bv-info-detail > div {
      flex: 1;
      color: #a3a3a3;
      font-size: .8rem;
      margin: .5rem 0;
      display: flex;
      justify-content: left;
      align-items: center;
    }
    .bv-info-detail > div > span:first-child {
      flex: 2;
      margin-right: .5em;
      text-align: right;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .bv-info-detail > div > span:first-child::after {
      content: '：'
    }
    .bv-info-detail > div > span:last-child {
      flex: 8;
      font-weight: lighter;
      text-align: left;
    }
    .actions {
      height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      align-items: center;
      padding: .2rem 0;
      box-sizing: border-box;
    }
    .selected {
      width: 2rem;
      height: 2rem;
    }
    .delete {
      width: 1.5rem;
      height: 1.5rem;
      padding: 0;
      border: none;
      border-radius: .3rem;
      font-size: .8rem;
      line-height: 1;
      color: #bbbbbb;
      background-color: transparent;
      cursor: pointer;
    }
    .delete:hover {
      color: #fff;
      background-color: #d05b5b;
    }

    .song-name {
      width: 100%;
      display: flex;
      align-items: center;
    }
    .song-name > input {
      flex: 1;
      margin-left: 1em;
      border: none;
      border-bottom: 1px solid #cecece;
    }
    .song-name > .source {
      margin-left: .5em;
      padding: .1em .45em;
      border-radius: .3em;
      font-size: .7rem;
      white-space: nowrap;
      cursor: help;
      background-color: #eef1f8;
      color: #5e6b8c;
    }
    .song-name > .source.is-fallback {
      background-color: #fff0e6;
      color: #a4571f;
    }
    .song-name > .retry {
      margin-left: .5em;
      padding: 0 .4em;
      border: none;
      border-radius: .3em;
      font-size: 1rem;
      color: #5e6b8c;
      background-color: #eef1f8;
      cursor: pointer;
    }
    .song-name > .retry[disabled] {
      color: #c2c2c2;
      cursor: not-allowed;
    }
</style>
