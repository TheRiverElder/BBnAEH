<template>
  <TopBarWrapper title="选择工作文件夹" @refresh="refresh">
      <DirPicker v-if="info" 
        :roots="info.roots"
        :recommandWorkspacePath="info.recommandWorkspacePath"
        @confirm="goToWorkspace"
      />
  </TopBarWrapper>
</template>

<script>

import TopBarWrapper from '@/components/TopBarWrapper.vue'
import DirPicker from '@/components/DirPicker.vue'
import axios from 'axios';
import state from '@/state.js';

export default {
  name: 'WorkspacePicker',
  components: {
    TopBarWrapper,
    DirPicker
  },
  data() {
    return {
      info: null,
    };
  },
  methods: {
      goToWorkspace(workspace) {
        this.$router.push({name: 'Workspace', query: {path: workspace}});
      },
      refresh() {
        axios.get(state.urlInfo)
        .then(res => this.info = res.data.succeed ? res.data.info : null)
        .catch(e => console.log(e));
      },
  },
  created() {
    this.refresh();
  },
}
</script>
