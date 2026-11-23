import { vscode } from './common';
import { registerObjectDumpActions } from './objectDumpActions';

registerObjectDumpActions(document, message => vscode.postMessage(message));
