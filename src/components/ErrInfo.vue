<template>
    <div class="err-info">
        {{ message }}
    </div>
</template>

<script>
export default {
    name: 'ErrInfo',
    props: {
        message: String,
    },
}
</script>

<style scoped>
    .err-info {
        padding: .5em;
        text-align: center;
        color: rgb(212, 86, 86);
    }
</style>