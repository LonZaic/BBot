<template>
    <div class="sidebar">
        <div class="sidebar-header">
            <span class="logo">AI Chat</span>
        </div>

        <button class="btn-new" @click="newConversation">+ 新对话</button>

        <div class="conv-list">
            <div
                v-for="conv in store.conversations"
                :key="conv.id"
                :class="['conv-item', { active: conv.id === store.currentId }]"
                @click="goToChat(conv.id)"
            >
                <span class="conv-title" :title="'双击改名: ' + (conv.title || '新对话')">{{ conv.title || '新对话' }}</span>
                <button class="btn-rename" @click.stop="rename(conv)" title="改名">改</button>
                <button class="btn-delete" @click.stop="deleteChat(conv.id)">x</button>
            </div>
        </div>

        <div class="sidebar-footer">
            <button class="btn-theme" @click="theme.toggleTheme">
                {{ theme.isDark.value ? '亮色' : '暗色' }}
            </button>
            <button class="btn-home" @click="goHome">首页</button>
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
        store.switchTab(id)
        router.push('/chat/' + id)
    }
}

function rename(conv) {
    const newTitle = prompt('修改标题:', conv.title || '')
    if (newTitle && newTitle.trim() && newTitle.trim() !== conv.title) {
        store.updateConvTitle(conv.id, newTitle.trim())
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
    height: 48px;
    padding: 0 16px;
    display: flex;
    align-items: center;
    border-bottom: 2px solid var(--border);
    flex-shrink: 0;
    transition: border-color 0.2s;
}
.logo {
    font-size: 15px;
    font-weight: 700;
    color: var(--text);
}
.btn-new {
    margin: 10px 16px;
    border: 2px solid var(--primary);
    background: var(--primary);
    color: #fff;
    padding: 9px 0;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    text-align: center;
    flex-shrink: 0;
    transition: background 0.15s;
}
.btn-new:hover {
    background: var(--primary-hover);
}
.conv-list {
    flex: 1;
    overflow-y: auto;
    padding: 0 16px 8px;
    min-height: 0;
}
.conv-item {
    border: 1px solid var(--border-light);
    padding: 8px 10px;
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    margin-bottom: 6px;
    transition: background 0.1s, border-color 0.1s;
}
.conv-item:hover {
    background: var(--bg-hover);
}
.conv-item.active {
    border-color: var(--primary);
    background: var(--primary-bg);
}
.conv-title {
    font-size: 12px;
    color: var(--text);
    font-weight: 500;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.btn-rename {
    border: none;
    background: transparent;
    width: 20px;
    height: 20px;
    font-size: 10px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: var(--text-muted);
    opacity: 0;
    transition: opacity 0.1s, color 0.1s;
}
.conv-item:hover .btn-rename { opacity: 1; }
.btn-rename:hover { color: var(--primary); }
.btn-delete {
    border: none;
    background: transparent;
    width: 20px;
    height: 20px;
    font-size: 11px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: var(--text-muted);
    transition: color 0.1s, background 0.1s;
}
.btn-delete:hover {
    color: var(--red);
    background: var(--bg-hover);
}
.sidebar-footer {
    height: 44px;
    border-top: 2px solid var(--border);
    padding: 0 16px;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
    transition: border-color 0.2s;
}
.btn-theme,
.btn-home {
    flex: 1;
    border: 1px solid var(--border-light);
    background: transparent;
    padding: 5px 0;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    text-align: center;
    color: var(--text-secondary);
    transition: background 0.1s, color 0.1s;
}
.btn-theme:hover,
.btn-home:hover {
    background: var(--bg-hover);
    color: var(--text);
}
</style>
