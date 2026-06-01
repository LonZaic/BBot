<template>
    <div class="sidebar">
        <div class="sidebar-header">
            <h2 class="logo">AI Chat</h2>
        </div>

        <button class="btn-new" @click="newConversation">+ 新对话</button>

        <div class="conv-list">
            <div
                v-for="conv in store.conversations"
                :key="conv.id"
                :class="['conv-item', { active: conv.id === store.currentId }]"
                @click="goToChat(conv.id)"
            >
                <span class="conv-title">{{ conv.title || '新对话' }}</span>
                <button class="btn-delete" @click.stop="deleteChat(conv.id)">✕</button>
            </div>
        </div>

        <div class="sidebar-footer">
            <button class="btn-theme" @click="theme.toggleTheme">
                {{ theme.isDark.value ? '亮色' : '暗色' }}
            </button>
            <button class="btn-home" @click="goHome">回到首页</button>
        </div>
    </div>
</template>

<script setup>
import { inject } from 'vue'
import { useRouter } from 'vue-router'
import { useChatStore } from '../store/chatStore.js'

const theme = inject('theme')
const router = useRouter()
const store = useChatStore()

function newConversation() {
    if (!store.apikey) {
        alert('请先输入 API Key')
        return
    }
    const id = 'conv_' + Date.now()
    store.createConversation(id)
    router.push('/chat/' + id)
}

function goToChat(id) {
    if (id !== store.currentId) {
        router.push('/chat/' + id)
    }
}

function deleteChat(id) {
    store.deleteConv(id)
}

function goHome() {
    router.push('/')
}
</script>

<style scoped>
.sidebar {
    width: 260px;
    min-width: 260px;
    height: 100vh;
    border-right: 2px solid var(--border);
    display: flex;
    flex-direction: column;
    background: var(--bg-secondary);
    transition: background 0.2s, border-color 0.2s;
}
.sidebar-header {
    padding: 18px 16px 12px;
    border-bottom: 2px solid var(--border);
}
.logo {
    font-size: 18px;
    font-weight: 700;
    color: var(--text);
    margin: 0;
}
.btn-new {
    margin: 12px 16px;
    border: 2px solid var(--primary);
    background: var(--primary);
    color: #fff;
    padding: 10px 0;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
    text-align: center;
    transition: background 0.15s, border-color 0.15s;
}
.btn-new:hover {
    background: var(--primary-hover);
    border-color: var(--primary-hover);
}
.conv-list {
    flex: 1;
    overflow-y: auto;
    padding: 0 16px 16px;
}
.conv-item {
    border: 2px solid var(--border);
    padding: 10px 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    margin-bottom: 8px;
    transition: background 0.15s;
}
.conv-item:hover {
    background: var(--bg-hover);
}
.conv-item.active {
    border-color: var(--primary);
    background: var(--primary-bg);
}
.conv-title {
    font-size: 13px;
    color: var(--text);
    font-weight: 600;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.btn-delete {
    border: 1px solid var(--border-light);
    background: transparent;
    width: 22px;
    height: 22px;
    font-size: 11px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: var(--text-muted);
}
.btn-delete:hover {
    border-color: var(--red);
    color: var(--red);
}
.sidebar-footer {
    border-top: 2px solid var(--border);
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.btn-theme {
    width: 100%;
    border: 2px solid var(--border);
    background: transparent;
    padding: 8px 0;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    text-align: center;
    color: var(--text);
    transition: background 0.15s;
}
.btn-theme:hover {
    background: var(--bg-hover);
}
.btn-home {
    width: 100%;
    border: 2px solid var(--border);
    background: transparent;
    padding: 8px 0;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    text-align: center;
    color: var(--text);
    transition: background 0.15s;
}
.btn-home:hover {
    background: var(--bg-hover);
}
</style>
