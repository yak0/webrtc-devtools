<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { NAlert, NButton, NCard, NTag } from 'naive-ui';
import { errorText, listDevices, unlockLabels } from '../media';

const devices = ref<MediaDeviceInfo[]>([]);
const error = ref('');
const permissions = ref<Record<string, string>>({});

async function refresh() {
  devices.value = await listDevices();
  for (const name of ['camera', 'microphone'] as const) {
    try {
      permissions.value[name] = (await navigator.permissions.query({ name: name as PermissionName })).state;
    } catch {
      permissions.value[name] = 'unknown';
    }
  }
}
async function grant() {
  error.value = '';
  try {
    await unlockLabels('both');
  } catch (e) {
    error.value = errorText(e);
  }
  await refresh();
}
onMounted(() => {
  void refresh();
  navigator.mediaDevices.addEventListener('devicechange', refresh);
});
onBeforeUnmount(() => navigator.mediaDevices.removeEventListener('devicechange', refresh));

const hidden = computed(() => devices.value.some((d) => !d.label));
const groups = computed(() =>
  (['videoinput', 'audioinput', 'audiooutput'] as const).map((kind) => ({
    kind,
    title: kind === 'videoinput' ? 'Cameras' : kind === 'audioinput' ? 'Microphones' : 'Speakers / outputs',
    list: devices.value.filter((d) => d.kind === kind)
  }))
);
const permTone = (s?: string) => (s === 'granted' ? 'success' : s === 'denied' ? 'error' : 'warning');
</script>

<template>
  <div class="wrd-grid">
    <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap">
      <span class="wrd-muted">Permissions:</span>
      <n-tag size="small" :type="permTone(permissions.camera)" :bordered="false">camera: {{ permissions.camera ?? '…' }}</n-tag>
      <n-tag size="small" :type="permTone(permissions.microphone)" :bordered="false">microphone: {{ permissions.microphone ?? '…' }}</n-tag>
      <span style="flex: 1" />
      <n-button size="small" @click="refresh">Refresh</n-button>
      <n-button v-if="hidden" size="small" type="primary" @click="grant">Allow access to see device names</n-button>
    </div>
    <n-alert v-if="error" type="error" :bordered="false">{{ error }}</n-alert>
    <n-card v-for="g in groups" :key="g.kind" size="small" :title="`${g.title} (${g.list.length})`">
      <div v-if="!g.list.length" class="wrd-muted">None found{{ g.kind === 'audiooutput' ? ' (output selection may be unavailable on this platform)' : '' }}</div>
      <table v-else class="devs">
        <tr v-for="d in g.list" :key="d.deviceId + d.groupId">
          <td>
            <strong>{{ d.label || '(name hidden until permission is granted)' }}</strong>
            <n-tag v-if="d.deviceId === 'default'" size="tiny" :bordered="false" style="margin-left: 6px">system default</n-tag>
            <n-tag v-if="d.deviceId === 'communications'" size="tiny" :bordered="false" style="margin-left: 6px">communications</n-tag>
          </td>
          <td class="mono wrd-muted" :title="d.deviceId">{{ d.deviceId ? d.deviceId.slice(0, 12) + '…' : '—' }}</td>
          <td class="mono wrd-muted" :title="`groupId ${d.groupId}`">group {{ d.groupId ? d.groupId.slice(0, 8) : '—' }}</td>
        </tr>
      </table>
    </n-card>
    <div class="wrd-muted">Devices with the same group belong to the same physical device (e.g. a headset's mic and speaker). The list updates when you plug devices in or out.</div>
  </div>
</template>

<style scoped>
.devs {
  width: 100%;
  border-collapse: collapse;
}
.devs td {
  padding: 4px 12px 4px 0;
  border-bottom: 1px solid rgba(128, 128, 128, 0.12);
}
</style>
