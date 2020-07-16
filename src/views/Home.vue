<template>
  <TopBarWrapper title="老江的音频提取助手">
    <div class="home">
      <router-link class="button" to="/WorkspacePicker">开始</router-link>
      <div class="introduction">
        <h2>食用方法</h2>
        <ol>
          <li>先选择工作文件夹，其中工作文件夹要包含以下文件夹：
            <ul>
              <li><strong>videos</strong>（必须），里面是从B站离线缓存的视频文件夹</li>
              <li><strong>audios</strong>（可选），里面是一些已经从更好的渠道下载好的音乐</li>
              <li><strong>videos</strong>（可选），临时文件夹</li>
            </ul>
          </li>
          <li>在视频信息中修改歌曲名字</li>
          <li>选中要提取的视频（选中后不可修改名字，取消之后才行）</li>
          <li>点击执行，等待回复</li>
        </ol>
      </div>
    </div>
  </TopBarWrapper>
</template>

<script>
import TopBarWrapper from '@/components/TopBarWrapper.vue';

export default {
  name: 'Home',
  components: {
    TopBarWrapper,
  }
}
</script>

<style scoped>
.home {
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
}
.button {
  font-size: 1.5rem;
  font-weight: bold;
  padding: 1rem 2rem;
  border-radius: .5rem;
  background: #fff;
}
.introduction {
  text-align: left;
}
</style>