<template>
    <div :class="['msg', role, { streaming }]">
        <span class="avatar">{{ role === 'user' ? 'U' : 'A' }}</span>
        <div class="body">
            <div v-if="role === 'ai'" class="bubble markdown-body" v-html="renderedText"></div>
            <div v-else class="bubble">{{ text }}</div>
            <span v-if="streaming" class="stream-cursor"></span>
            <div class="msg-actions" v-if="!streaming && text">
                <button v-if="role === 'ai'" title="重新生成" @click="$emit('regenerate')">重</button>
                <button title="复制" @click="copyText">抄</button>
                <button title="编辑" @click="$emit('edit', text)">改</button>
                <button title="删除" class="del" @click="$emit('delete')">删</button>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed } from 'vue'
import { renderMarkdown } from '../utils/markdown.js'

const props = defineProps({
    role: { type: String, required: true },
    text: { type: String, required: true },
    streaming: { type: Boolean, default: false },
})

defineEmits(['regenerate', 'edit', 'delete'])

const renderedText = computed(() => {
    if (props.role !== 'ai') return ''
    return renderMarkdown(props.text)
})

async function copyText() {
    try {
        await navigator.clipboard.writeText(props.text)
    } catch {
        const ta = document.createElement('textarea')
        ta.value = props.text
        ta.style.cssText = 'position:fixed;opacity:0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
    }
}
</script>

<style scoped>
.msg {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    max-width: 75%;
}
.msg.user {
    margin-left: auto;
    max-width: 60%;
    flex-direction: row-reverse;
    margin-right: 4px;
}
.avatar {
    width: 24px;
    height: 24px;
    border: 1px solid var(--border-light);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 700;
    flex-shrink: 0;
    color: var(--text-muted);
    background: var(--bg-secondary);
}
.msg.user .avatar {
    border-color: var(--primary);
    color: var(--primary);
    background: var(--primary-bg);
}
.msg.ai .avatar {
    border-color: var(--green);
    color: var(--green);
}
.body {
    position: relative;
    min-width: 0;
}
.bubble {
    border: 1px solid var(--border-light);
    padding: 6px 10px;
    font-size: 13px;
    line-height: 1.55;
    color: var(--text);
    word-break: break-word;
    background: var(--bg);
    border-radius: 0;
    transition: background 0.2s, color 0.2s, border-color 0.2s;
}
.msg.user .bubble {
    background: var(--primary-bg);
    border-color: var(--primary);
    white-space: pre-wrap;
}
.msg.ai .bubble {
}
.stream-cursor {
    display: inline-block;
    width: 6px;
    height: 14px;
    margin-left: 2px;
    background: var(--primary);
    animation: blink 0.8s infinite;
}
@keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.2; }
}
.msg-actions {
    display: flex;
    gap: 3px;
    margin-top: 3px;
    opacity: 0;
    transition: opacity 0.12s;
}
.msg.user .msg-actions {
    justify-content: flex-end;
}
.body:hover .msg-actions {
    opacity: 1;
}
.msg-actions button {
    height: 20px;
    padding: 0 6px;
    font-size: 11px;
    border: 1px solid var(--border-light);
    background: var(--bg-secondary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    transition: background 0.1s, border-color 0.1s, color 0.1s;
}
.msg-actions button:hover {
    background: var(--bg-hover);
    color: var(--text);
}
.msg-actions button.del:hover {
    border-color: var(--red);
    color: var(--red);
}
</style>
