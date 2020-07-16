<template>
    <dir class="top-bar-wrapper">
        <dir class="top-bar">
            <div class="top-icon" @click="goBack">&lt;</div>
            <span class="title">{{ title }}</span>
            <div class="top-icon" @click="$emit('refresh')">&#x21bb;</div>
        </dir>
        <slot class="content"/>
    </dir>
</template>

<script>
export default {
    name: "TopBarWrapper",
    props: {
        title: String,
    },
    methods: {
      goBack() {
          window.history.length ? this.$router.go(-1) : this.$router.push({name: 'Home'});
          this.$emit('back');
      }  
    },
}
</script>

<style scoped>
.top-bar-wrapper {
    width: 100%;
    height: 100%;
    padding: 0;
    margin: 0;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    background-color: #eee;
}
.top-bar {
    width: 100%;
    padding: .5em 1em;
    margin: 0;
    box-sizing: border-box;
    background-color: #fff;
    display: flex;
    justify-content: center;
    align-items: center;
}
.title {
    flex: 1;
    font-size: 1.5em;
    font-family: 微软雅黑;
    text-align: center;
}
.top-icon {
    font-size: 1.5em;
    font-family: Consolas;
    user-select: none;
    cursor: pointer;
}
.content {
    width: 100%;
    flex: 1;
}
</style>