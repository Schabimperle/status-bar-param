# Status Bar Parameter

This vscode extension adds the possibility to add selectable parameter to the status bar (the bar in the bottom of the window), which then can be used eslewhere (e.g. in the tasks.json).

![Demo](images/demo.gif)

## Features

* Add a parameter by using the added command: `StatusBarParam: Add Parameter to Status Bar`.
* Select one of the given arguments by clicking on the status bar item.
* Use the selected value in tasks.json in commands with `${input:<param_name>}`.

> Tip: You can also get the selected value of the param where vscode supports the substitution of commands by using: `${command:statusBarParam:getSelected:<param_name>}`.

## Known Issues

* None yet.

## Release Notes

### 1.0.0

* Initial release.