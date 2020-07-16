<template>
  <div class="dir-picker">
    <div class="top-bar">
        <select v-model="root">
            <option v-for="rt of roots" :key="rt" :value="rt">{{ rt }}</option>
        </select>
        <input v-model="pickedDir"/>
        <button :disabled="!pickedDir.length" @click="confirm">确定</button>
    </div>
    <div class="dir-tree-wrapper">
        <DirTree :key="root"
            class="dir-tree"
            :name="root" 
            :isDir="true" 
            @pick="pickDir" 
        />
    </div>
  </div>
</template>

<script>
import DirTree from "./DirTree.vue";

export default {
  name: "DirPicker",
  components: { DirTree },
  props: {
      roots: Array,
      recommandWorkspacePath: String,
  },
  data() {
      return {
          pickedDir: this.recommandWorkspacePath || '',
          root: this.roots.length ? this.roots[0] : 'E:/',
      };
  },
  methods: {
    pickDir(dir) {
        this.pickedDir = dir;
    },
    confirm() {
        this.$emit('confirm', this.pickedDir);
    },
  }
};
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>
.dir-picker {
  width: 100%;
  height: 100%;
  background-color: #eee;
  padding: 1rem;
  box-sizing: border-box;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.top-bar {
    width: 100%;
    height: 1.2rem;
    display: flex;
    justify-content: center;
    align-items: center;
    margin-bottom: 1rem;
}
.top-bar > * {
    height: auto;
}
.top-bar > input:first-child {
    flex: 2;
    height: 100%;
    padding: 0 1rem;
}
.top-bar > input {
    flex: 7;
    height: 100%;
    margin: 0 1rem;
}

.dir-tree-wrapper {
    flex: 1;
    padding: .5rem;
    border: 1px solid #888;
    border-radius: .2rem;
    box-sizing: border-box;
    overflow-y: auto;
}
</style>
