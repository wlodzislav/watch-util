module.exports = {
	debounce: 500, // exec/reload once in ms at max
	reglob: 2000, // perform reglob to watch added files
	restartOnError: false, // restart if exit code != 0
	restartOnSuccess: false, // restart if exit code == 0
	actions: ["create", "change", "delete"],
	runSeparate: false, // true - run separate cmd per changed file, false - run single cmd for all changes, default: false
	parallelLimit: 4, // max parallel running cmds in runSeparate == true mode
	useShell: true, // run in shell
	customShell: "", // custom shell to run cmds, if not set - run in default shell
	maxLogEntries: 100, // max log entries to store for each watcher, Note! entry could be multiline
	writeToConsole: false, // write logs to console
	mtimeCheck: true, // check modified time before firing events
	debug: false, // debug logging
	killSignal: "SIGTERM", // default signal for terminate()
	killCheckInterval: 20, // interval for checking that process is dead
	killRetryInterval: 500, // interval to retry killing process if it's still not dead
	killRetryCount: 5, // max retries to kill process
	killTimeout: 5000 // stop trying to kill process after that timeout
};
