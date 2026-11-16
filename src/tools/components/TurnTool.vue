<script setup lang="ts">
import { NCard } from 'naive-ui';
import TurnTester from '@/shared-ui/TurnTester.vue';
</script>

<template>
  <n-card size="small">
    <p class="wrd-muted" style="margin-top: 0">
      Gathers ICE candidates against your STUN/TURN servers from this browser and tells you whether they work.
      Run it on the same network your users are on.
    </p>
    <TurnTester />
  </n-card>
</template>
