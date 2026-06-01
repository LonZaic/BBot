<template>
    <div :class="['msg', role]">
        <div class="avatar">{{ role === 'user' ? 'U' : 'A' }}</div>
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
        border: 2px solid var(--border);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 13px;
        font-weight: 700;
        flex-shrink: 0;
        color: var(--text);
        background: var(--bg-secondary);
    }
    .msg.user .avatar { border-color: var(--primary); }
    .msg.ai .avatar { border-color: var(--green); }
    .bubble {
        border: 2px solid var(--border);
        padding: 10px 14px;
        font-size: 14px;
        line-height: 1.6;
        color: var(--text);
        white-space: pre-wrap;
        word-break: break-word;
        background: var(--bg);
        transition: background 0.2s, color 0.2s, border-color 0.2s;
    }
    .msg.user .bubble { border-color: var(--primary); }
    .msg.ai .bubble { border-color: var(--green); }
</style>