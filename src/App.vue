<template>
  <div id="app-root">
    <router-view />
  </div>
</template>

<script setup>
import { provide, onMounted } from 'vue'
import { useTheme } from './composables/useTheme.js'
import { connect } from './api/ws.js'

const theme = useTheme()
provide('theme', theme)

// Auto-connect WebSocket if already logged in (survives page refresh)
onMounted(() => {
  const token = localStorage.getItem('bbot_token')
  if (token) {
    connect(token)
  }
})
</script>
