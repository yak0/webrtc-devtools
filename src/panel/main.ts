import { ChromeBridge } from './bridge';
import { mountPanel } from './mount';

mountPanel('#app', new ChromeBridge());
