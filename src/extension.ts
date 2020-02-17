import * as vscode from 'vscode';
import { window, commands, ExtensionContext } from 'vscode';

let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {

	console.log('activated');

	let commandID = 'extension.helloWorld';
	let disposable = vscode.commands.registerCommand(commandID, () => {
		window.showQuickPick(
			[
				"first",
				"second",
				"third"
			]
		).then((value) => {
			let config = vscode.workspace.getConfiguration('statusbar.params');
			console.dir(config.get);
		});
	});
	context.subscriptions.push(disposable);

	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBarItem.command = commandID;
	statusBarItem.text = 'Hello World';
	context.subscriptions.push(statusBarItem);
	statusBarItem.show();

	
}

// this method is called when your extension is deactivated
export function deactivate() {}
