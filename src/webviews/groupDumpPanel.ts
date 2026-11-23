import { vscode } from './common';
import { registerDumpActions } from './dumpPanelShared';
import { groupDumpActions } from './entityDumpActions';

const actions = groupDumpActions(message => vscode.postMessage(message));
registerDumpActions(document, () => actions);
