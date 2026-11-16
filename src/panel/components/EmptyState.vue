<script setup lang="ts">
import { inject } from 'vue';
import { NButton, NEmpty } from 'naive-ui';
import type { Bridge } from '../bridge';
import { session } from '../store/session';

const bridge = inject<Bridge>('bridge')!;
</script>

<template>
  <div style="flex: 1; display: flex; align-items: center; justify-content: center; padding: 24px">
    <n-empty :description="session.connected ? 'No RTCPeerConnection on this page yet' : 'Connecting to the page…'">
      <template #extra>
        <div class="wrd-muted" style="max-width: 420px; text-align: center; line-height: 1.6; margin-bottom: 10px">
          Connections created on this page show up here as soon as they are created. If the page created them
          before the extension was installed or enabled, reload it.
        </div>
        <n-button size="small" @click="bridge.reloadPage()">Reload page</n-button>
      </template>
    </n-empty>
  </div>
</template>
