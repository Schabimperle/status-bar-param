import { Event, EventEmitter, ThemeIcon, TreeDataProvider, TreeItem, TreeItemCollapsibleState } from "vscode";
import { JsonFile } from "./jsonFile";
import { Param } from "./param";
import { Strings } from "./strings";

export class ParameterProvider implements TreeDataProvider<JsonFile | Param> {
    static onDidChangeTreeDataEmitter = new EventEmitter<JsonFile | Param | undefined | null | void>();
    readonly onDidChangeTreeData: Event<JsonFile | Param | undefined | null | void> = ParameterProvider.onDidChangeTreeDataEmitter.event;

    constructor(private jsonFiles: JsonFile[]) { }

    getTreeItem(element: JsonFile | Param): TreeItem {
        if (element instanceof JsonFile) {
            return {
                resourceUri: element.uri,
                iconPath: ThemeIcon.File,
                description: element.workspaceFolder?.name,
                collapsibleState: TreeItemCollapsibleState.Expanded,
                contextValue: 'JsonFile'
            };
        } else {
            return {
                label: element.name,
                description: element.onGet(),
                iconPath: Param.getIcon(element),
                contextValue: 'Param',
                command: {
                    title: 'Edit',
                    command: Strings.COMMAND_EDIT,
                    arguments: [element],
                }
            };
        }
    }

    getChildren(element?: JsonFile) {
        if (!element) {
            return this.jsonFiles;
        } else {
            return element.params;
        }
    }
}
