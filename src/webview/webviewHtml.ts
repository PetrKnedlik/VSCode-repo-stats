import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export function getRepoStatsWebviewHtml(
  webview: Pick<vscode.Webview, 'asWebviewUri' | 'cspSource'>,
  extensionUri: vscode.Uri
): string {
  const distPath = vscode.Uri.joinPath(extensionUri, 'webview-ui', 'dist');
  if (!fs.existsSync(path.join(distPath.fsPath, 'assets', 'index.js'))) {
    return createMissingBuildHtml();
  }

  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(distPath, 'assets', 'index.js')
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(distPath, 'assets', 'index.css')
  );

  const nonce = getNonce();
  const csp = `
    default-src 'none';
    style-src ${webview.cspSource} 'unsafe-inline';
    script-src 'nonce-${nonce}' ${webview.cspSource};
    img-src ${webview.cspSource} data:;
    font-src ${webview.cspSource};
  `.replace(/\s+/g, ' ').trim();

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Repo Stats</title>
    <script nonce="${nonce}" defer src="${scriptUri}"></script>
    <link rel="stylesheet" href="${styleUri}">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;
}

function createMissingBuildHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Repo Stats</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      padding: 20px;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
    }
    .error {
      color: var(--vscode-errorForeground);
    }
  </style>
</head>
<body>
  <h1>Repo Stats</h1>
  <p class="error">The webview UI has not been built yet. Run <code>npm run compile:webview</code> to build it.</p>
</body>
</html>`;
}

function getNonce(): string {
  return crypto.randomBytes(16).toString('base64');
}
