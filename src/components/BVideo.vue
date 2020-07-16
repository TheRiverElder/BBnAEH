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
        <div class="song-name"><span>曲名</span><input v-model="songName" :disabled="selected"/></div>
      </div>
    </div>
    <input class="selected" type="checkbox" v-model="selected"/>
  </div>
</template>

<script>
import {predicateSongName} from '@/utils.js';

export default {
  name: 'BVideo',
  props: {
    path: String,
    entry: Object,
  },

  data() {
    return {
      selected: false,
      songName: this.entry.title,
    };
  },

  watch: {
    selected(newVal) {
      newVal 
      ? this.$emit('select', {path: this.path, name: this.songName})
      : this.$emit('unselect', this.path);
    },
  },

  computed: {
    avid() { return this.entry.avid; },
    bvid() { return this.entry.bvid; },
    cover() { return this.entry.cover; },
    title() { return this.entry.title; },
  },

  created() {
    this.songName = predicateSongName(this.title);
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
    .selected {
      width: 2rem;
      height: 2rem;
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
</style>
