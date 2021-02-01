import { exec } from 'child_process';
import { window } from 'vscode';

export interface Command {
    shellCmd: string;
    cwd: string;
}

export class Param {
    name: string;
    command: string;
    args: string[] | Command;

    constructor(name: string, command: string, args: string[]) {
        this.name = name;
        this.command = command;
        this.args = args;
    }

    async getValues(): Promise<string[]> {
        return new Promise((resolve, reject) => {
            if (this.args instanceof Array) {
                resolve(this.args);
            } else if (this.args.shellCmd) {
                exec(this.args.shellCmd, { cwd: this.args.cwd }, (error, stdout, stderr) => {
                    if (error && !(this.args instanceof Array)) {
                        window.showErrorMessage(`An error occured when executing '${this.args.shellCmd}': ${error}\n${stderr}`);
                    }
                    resolve((stdout ? stdout : stderr).split('\n'));
                });
            }
        });
    }
}