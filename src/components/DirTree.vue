<template>
  <div class="dir-tree">
    <div>
      <div 
        :class="'arrow-icon' + (isDir ? '' : ' hide-arrow')"
        @click="collapsed = !collapsed"
      >{{ collapsed ? '&#x25ba;' : '&#x25bc;' }}</div>
      <span class="name" @click="pick()">{{ name }}</span>
      <div v-show="list"
        class="arrow-icon"
        @click="loadItems"
      >&#x21bb;</div>
    </div>
    <div v-show="!collapsed" class="sub-tree">
      <DirTree v-for="item in list" 
        :key="item.name"
        :parent="path"
        :name="item.name"
        :is-dir="item.isDir"
        @pick="pick"
      />
      <div v-show="!err && !collapsed && !list" class="placeholder">加载中……</div>
      <div v-show="!err && list && !list.length" class="placeholder">&lt;空&gt;</div>
      <div v-show="err" class="err">{{ err }}</div>
    </div>
  </div>
</template>

<script>
import axios from 'axios';
import path from 'path';
import state from '@/state.js';

export default {
  name: "DirTree",
  props: {
    parent: {
      type: String,
      default: null,
    },
    name: String,
    isDir: Boolean
  },

  data() {
    let p = this.parent ? path.resolve(this.parent, this.name) : this.name;
    p = p.replace(/^\/+/, '');
    return {
        path: p,
        list: null,
        collapsed: true,
        err: null,
    };
  },
  
  watch: {
    collapsed(val) {
      if (this.isDir && !val && !this.list) {
        this.loadItems();
      }
    },
  },

  methods: {
      loadItems() {
          axios.get(state.urlDirList + `?path=${this.path}`)
          .then(res => this.list = res.data.succeed ? res.data.list : [])
          .catch(e => this.err = e);
      },

      pick(dir = this.path) {
        this.$emit('pick', dir);
      },
  },
};
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>
.dir-tree {
  width: 100%;
  text-align: left;
  font-family: Consolas, 微软雅黑, 'Courier New', Courier, monospace;
}
.sub-tree {
  width: 100%;
  padding-left: .5em;
  box-sizing: border-box;
}
.sub-tree > * {
  padding-left: 1em;
  border-left: 1px solid #ccc;
  box-sizing: border-box;
}
.placeholder {
  color: rgb(128, 128, 128);
}
.err {
  color: rgb(218, 69, 69);
}
.arrow-icon {
  width: 1em;
  height: 1em;
  margin-right: .5em;
  border-radius: 1em;
  color: #888;
  background-color: rgb(230, 230, 230);
  display: inline-flex;
  justify-content: center;
  align-items: center;
  user-select: none;
  cursor: pointer;
  visibility: visible;
}
.arrow-icon.hide-arrow {
  visibility: hidden;
}
.name {
  cursor: pointer;
}
</style>
