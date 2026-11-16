// Entry of the standalone HTML report: the panel UI bundled into one file with the data inlined.
import { ReportBridge } from '../panel/bridge';
import { mountPanel } from '../panel/mount';

mountPanel('#app', new ReportBridge());
