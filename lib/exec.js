var childProcess = require("child_process");

var chalk = require("chalk");

var debug = require("./debug");

function exec(cmd, options) {
	var child;
	if (options.shell) {
		if (typeof(options.shell) == "string") {
			var shellExecutable = options.shell.split(" ")[0];
			var shellArgs = options.shell.split(" ").slice(1);
			var stdio = [
				"pipe",
				options.stdio ? options.stdio[1] : "ignore",
				options.stdio ? options.stdio[2] : "ignore"
			];
			child = childProcess.spawn(shellExecutable, shellArgs, { shell: false, stdio: stdio });
			child.stdin.write(cmd);
			child.stdin.end();
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
