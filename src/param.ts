import { exec } from 'child_process';
import { commands, Disposable, StatusBarAlignment, StatusBarItem, Uri, window } from 'vscode';
import * as ext from './extension';
import * as path from 'path';

export interface Options {
    type: string;
    shellCmd: string;
    cwd: string;
}

export class Param {
    jsonFile: Uri;
    name: string;
    commandGetValue: string;
    commandSelectValue: string;
    args: string[] | Options;
    statusBarItem: StatusBarItem;
    disposables: Disposable[] = [];
    priority: number;

    constructor(jsonFile: Uri, name: string, command: string, args: string[], priority: number) {
        this.jsonFile = jsonFile;
        this.name = name;
        this.commandGetValue = command;
        this.args = args;
        this.priority = priority;

        // create status bar item
        this.statusBarItem = window.createStatusBarItem(StatusBarAlignment.Left, this.priority);
        this.disposables.push(this.statusBarItem);
        this.commandSelectValue = `statusBarParam.select.${this.name}`;
        this.statusBarItem.command = this.commandSelectValue;
        this.update();

        try {
            // create command to retrieve the selected value (when input:<input_id> is used in json)
            let displosable = commands.registerCommand(this.commandGetValue, () => this.getSelectedValue());
            this.disposables.push(displosable);

            // create command for selection of status bar param
            displosable = commands.registerCommand(this.statusBarItem.command, async () => {
                let value = await window.showQuickPick(this.getValues());
                if (value !== undefined) {
                    this.setSelectedValue(value);
                }
            });
            this.disposables.push(displosable);

            this.statusBarItem.show();
        } catch (err) {
            console.error(err);
            if (err instanceof Error) {
                window.showErrorMessage(err.message);
            }
        }

    }

    async getValues(): Promise<string[]> {
        return new Promise((resolve) => {
            if (this.args instanceof Array) {
                resolve(this.args);
            } else if (this.args.shellCmd) {
                exec(this.args.shellCmd, { cwd: this.getExecPath() }, (error, stdout, stderr) => {
                    if (error && !(this.args instanceof Array)) {
                        window.showErrorMessage(`An error occured when executing '${this.args.shellCmd}': ${error}\n${stderr}`);
                    }
                    let values = (stdout ? stdout : stderr).split('\n');
                    if (values && values.length > 0 && values[values.length - 1] === "") {
                        values.pop();
                    }
                    resolve(values);
                });
            }
        });
    }

    getExecPath() {
        if (this.args instanceof Array) {
            return;
        }
        if (this.args.cwd) {
            if (!path.isAbsolute(this.args.cwd)) {
                this.args.cwd = path.join(path.dirname(this.jsonFile.fsPath).replace(/.vscode$/, ''), this.args.cwd);;
            }
            return this.args.cwd;
        } else {
            return path.dirname(this.jsonFile.fsPath).replace(/.vscode$/, '');
        }
    }

    async getSelectedValue() {
        let value = ext.getExtensionContext().workspaceState.get<string>(this.name);
        if (value) {
            return value;
        }
        let values = await this.getValues();
        if (values.length > 0) {
            value = values[0];
            return value;
        }
        return "";
    }

    async setSelectedValue(value: string) {
        ext.getExtensionContext().workspaceState.update(this.name, value);
        if (value === "") {
            value = " ";
        }
        if (ext.getShowParamNames()) {
            value = `${this.name}: ${value}`;
        }
        this.statusBarItem.text = value;
    }

    async update() {
        let value = await this.getSelectedValue();
        let values = await this.getValues();
        if (values.indexOf(value) === -1) {
            value = values[0];
        }
        if (value) {
            this.setSelectedValue(value);
        } else {
            window.showWarningMessage(`Parameter '${this.name}' has no arguments!`);
        }
    }

    dispose() {
        this.disposables.forEach(disposable => disposable.dispose());
    }
}