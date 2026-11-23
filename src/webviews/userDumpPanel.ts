import { vscode } from './common';
import { registerDumpActions } from './dumpPanelShared';
import { userDumpActions } from './entityDumpActions';

const actions = userDumpActions(message => vscode.postMessage(message));
registerDumpActions(document, () => actions);
