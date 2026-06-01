<template>
  <div id="app-root">
    <router-view />
  </div>
</template>

<script setup>
import { provide } from 'vue'
import { useTheme } from './composables/useTheme.js'

const theme = useTheme()
provide('theme', theme)
</script>
