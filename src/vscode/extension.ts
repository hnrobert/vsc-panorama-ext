import type { ExtensionContext } from 'vscode';
import { createIndexHost } from './index-host';
import { createDiagnosticsHost } from './diagnostics-host';
import { registerVxml } from './providers/vxml';
import { registerVcss } from './providers/vcss';

export function activate(context: ExtensionContext): void {
  const index = createIndexHost(context);
  registerVxml(context, index);
  registerVcss(context, index);
  createDiagnosticsHost(context, index);
}

export function deactivate(): void {
  // provider 与监视器均已放入 context.subscriptions，由宿主统一释放
}
