import { vscode } from './common';
import { registerDumpActions } from './dumpPanelShared';
import { typeDumpActions } from './entityDumpActions';

const actions = typeDumpActions(message => vscode.postMessage(message));
registerDumpActions(document, () => actions);
