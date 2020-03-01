# Status Bar Parameter

This vscode extension adds selectable parameter to the status bar (in the bottom), which then can be used in tasks.json.

![Demo](images/demo.gif)

## Features

* Add a parameter by using the command: `StatusBarParam: Add Parameter to Status Bar`.
* Select an argument by clicking on the status bar item.
* Retrieve the selected value in commands of tasks.json with `${input:<param_name>}`.

> Tip: You can also get the selected value, where vscode supports the substitution of commands, by using `${command:statusBarParam.get.<param_name>}`.

## Known Issues

* None yet.