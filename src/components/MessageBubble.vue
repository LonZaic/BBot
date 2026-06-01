<template>
    <div :class="['msg', role]">
        <div class="avatar">{{ role === 'user' ? '🧑' : '🤖' }}</div>
        <div class="bubble">{{ text }}</div>
    </div>
</template>

<script setup>
defineProps({
    role: {
        type: String,
        required: true
    },
    text: {
        type: String,
        required: true
    }
})
</script>

<style scoped>
    .msg {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        max-width: 85%;
    }
    .msg.user {
        align-self: flex-end;
        flex-direction: row-reverse;
    }
    .avatar {
        width: 32px;
        height: 32px;
        border: 2px solid #333;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        flex-shrink: 0;
    }
    .msg.user .avatar { border-color: #2563eb; }
    .msg.ai .avatar { border-color: #16a34a; }
    .bubble {
        border: 2px solid #333;
        padding: 10px 14px;
        font-size: 14px;
        line-height: 1.6;
        color: #333;
        white-space: pre-wrap;
        word-break: break-word;
    }
    .msg.user .bubble { border-color: #2563eb; }
    .msg.ai .bubble { border-color: #16a34a; }
</style>