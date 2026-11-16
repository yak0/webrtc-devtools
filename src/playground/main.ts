// The collector must be installed before the demo app touches RTCPeerConnection,
// exactly like the extension's document_start content script.
import '../injected/index';
import { LocalBridge } from '../panel/bridge';
import { mountPanel } from '../panel/mount';
import { setupDemo } from './demo';

setupDemo();
mountPanel('#panel', new LocalBridge());
