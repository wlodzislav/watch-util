module.exports = {
	debounce: 500, // exec/reload once in ms at max
	reglob: 2000, // perform reglob to watch added files
	//queue: true, // exec calback if it's already executing
	restartOnError: false, // restart if exit code != 0
	restartOnSuccess: false, // restart if exit code == 0
	shell: true, // use this shell for running cmds, or default shell(true)
	//cwd: "path for resolving",
	maxLogEntries: 100,
	writeToConsole: true, // write logs to console
	mtimeCheck: true,
	debug: false,
	execVariablePrefix: "@",
	killSignal: "SIGTERM",
	killCheckInterval: 20,
	killRetryInterval: 500,
	killRetryCount: 5,
	killTimeout: 5000
};
