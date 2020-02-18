import * as vscode from 'vscode';
import { window, commands, ExtensionContext } from 'vscode';

let statusBarItems: vscode.StatusBarItem[] = [];

export function activate(context: vscode.ExtensionContext) {

	console.log('activated');

	let statusBarParams: any[] | undefined = vscode.workspace.getConfiguration().get('statusbar.params');
	if (!statusBarParams) {
		return;
	}
	for (let i = 0; i < statusBarParams.length; i++) {
		let statusBarParam = statusBarParams[i];
		let commandID = `extension.selectParam${statusBarParam.parameter}`;

		let statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
		statusBarItem.command = commandID;
		statusBarItem.text = 'Select a value...';
		context.subscriptions.push(statusBarItem);

		let disposable = vscode.commands.registerCommand(commandID, () => {
			window.showQuickPick(
				statusBarParam.strings
			).then((value) => {
				if (value) {
					statusBarItem.text = value;
				}
			});
		});
		context.subscriptions.push(disposable);
		statusBarItems.push(statusBarItem);
		statusBarItem.show();
	}
}

// this method is called when your extension is deactivated
export function deactivate() { }
