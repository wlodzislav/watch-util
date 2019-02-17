var childProcess = require("child_process");

var chalk = require("chalk");

var debug = require("./debug");

function exec(cmd, options) {
	var child;
	if (options.shell) {
		if (typeof(options.shell) == "string") {
			var shellExecutable = options.shell.split(" ")[0];
			child = childProcess.spawn(shellExecutable, options.shell.split(" ").slice(1).concat([cmd]), { shell: false, stdio: options.stdio });
		} else {
			child = childProcess.spawn(cmd, { shell: true, stdio: options.stdio });
		}
	} else {
		var splittedCmd = cmd.split(" ");
		child = childProcess.spawn(splittedCmd[0], splittedCmd.slice(1), { shell: false, stdio: options.stdio });
	}

	return child;
}

module.exports = exec;
