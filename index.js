var path = require("path");

var RestartRunner = require("./lib/restart-runner");
var QueueRunner = require("./lib/queue-runner");
var AlivePassThrough = require("./lib/alive-pass-through");
var Watcher = require("./lib/watcher");

function _interpolateCombinedCmd(cmd, options) {
	options = options || [];
	var filePaths = options.filePaths || [];
	if (cmd.indexOf("%") !== -1) {
		var cwd = path.resolve(".")
		var relFiles = filePaths.join(" ");
		var files = filePaths.map(function (f) { return path.resolve(f); }).join(" ");
		cmd = cmd
			.replace("%cwd", cwd)
			.replace("%relFiles", relFiles || "")
			.replace("%files", files || "");
	}

	return cmd;
}

function _interpolateSeparateCmd(cmd, options) {
	var filePath = options.filePath;
	var action = options.action;
	var cmd;
	if (cmd.indexOf("%") !== -1) {
		var cwd = path.resolve(".")
		var relFile = filePath;
		var file = path.resolve(filePath);
		var relDir = path.dirname(filePath);
		var dir = path.resolve(path.dirname(filePath));
		cmd = cmd
			.replace("%cwd", cwd)
			.replace("%event", action || "")
			.replace("%relFile", relFile || "")
			.replace("%file", file || "")
			.replace("%relDir", relDir || "")
			.replace("%dir", dir || "");
	}

	return cmd;
};

var watcher = {};

/*
	watcher.exec(globs, callback)
	watcher.exec(globs, options, callback)
	watcher.exec(globs) - to use with .on(event, handler)
	watcher.exec(globs, options)
	watcher.exec(globs, cmd)
	watcher.exec(globs, options, cmd)
*/

var execWatcherDefaults = {
	debounce: 50,
	throttle: 0,
	reglob: 1000,
	events: ["create", "change", "delete"],
	combineEvents: true,
	checkMD5: false,
	checkMtime: true,
	deleteCheckInterval: 25,
	deleteCheckTimeout: 100,
	debug: false
};

var execRunnerDefaults = {
	waitDone: true,
	restartOnError: false,
	parallelLimit: 8,
	combineEvents: true,
	shell: true,
	stdio: [null, "ignore", "ignore"],
	debug: false
};

var killDefaults = {
	signal: ["SIGTERM", "SIGTERM", "SIGKILL"]
}

function applyDefaults(options, defaults) {
	var copy = {};
	for (var key in defaults) {
		if (key in options) {
			copy[key] = options[key];
		} else {
			copy[key] = defaults[key];
		}
	}
	return copy;
}

watcher.exec = function (globs) {
	var options = {};
	var callback, cmd;
	if (arguments.length > 1) {
		if (typeof(arguments[1]) == "string") {
			cmd = arguments[1];
		} else if (typeof(arguments[1]) == "function") {
			callback = arguments[1];
		} else {
			options = arguments[1];
		}
	}
	if (arguments.length > 2) {
		if (typeof(arguments[2]) == "string") {
			cmd = arguments[2];
		} else {
			callback = arguments[2];
		}
	}

	if (options.debug && options.kill && !("debug" in options.kill)) {
		options.kill.debug = true;
	}

	var watcherOptions = applyDefaults(options, execWatcherDefaults);
	var runnerOptions = applyDefaults(options, execRunnerDefaults);
	runnerOptions.kill = Object.assign({}, killDefaults, options.kill);
	//console.log({watcherOptions, runnerOptions});

	var _callback;
	if (cmd) {
		if (watcherOptions.combineEvents) {
			if (runnerOptions.waitDone) {
				runnerOptions.parallelLimit = 1;
			}

			runnerOptions.cmd = function (task) {
				return _interpolateCombinedCmd(cmd, task);
			};

			runnerOptions.reducer = function (queue) {
				var last = queue.pop();
				var filePaths = last.filePaths.filter(function (f) {
					return !queue.find(function (e) { return e.filePaths.indexOf(f) != -1; });
				});
				if (filePaths.length) {
					queue.push({ filePaths });
				}
				return queue;
			};

			_callback = function (filePaths) {
				w._queueRunner.push({ filePaths });
			};
		} else {
			runnerOptions.cmd = function (task) {
				return _interpolateSeparateCmd(cmd, task);
			};

			runnerOptions.reducer = function (queue) {
				var last = queue.pop();
				var found = queue.find(function (e) { return e.filePath == last.filePath; });
				if (found) {
					found.action = last.action;
				} else {
					queue.push(last);
				}
				return queue;
			};

			runnerOptions.skip = function (entry, running) {
				if (runnerOptions.waitDone) {
					var inProcessing = running.find(function (r) { return r.filePath == entry.filePath; });
					return inProcessing;
				} else {
					return false;
				}
			};

			_callback = function (filePath, action) {
				w._queueRunner.push({ filePath, action });
			};
		}

	} else if (callback) {
		_callback = callback;
	}

	var w = new Watcher(globs, watcherOptions, _callback);

	if (cmd) {
		w._queueRunner = new QueueRunner(runnerOptions);

		// HACK: substitute ee to passthrough events
		w._queueRunner.ee = w.ee;

		if (runnerOptions.stdio) {
			if (runnerOptions.stdio[1] == "pipe") {
				w.stdout = new AlivePassThrough();
				w._queueRunner.stdout.pipe(w.stdout);
			}

			if (runnerOptions.stdio[2] == "pipe") {
				w.stderr = new AlivePassThrough();
				w._queueRunner.stderr.pipe(w.stderr);
			}
		}
		w.on("start", function () {
			w._queueRunner.start();
		});

		var _stop = w.stop;
		w.stop = function (callback) {
			w._queueRunner.stop(function () {
				_stop.call(w, callback);
			});
		};
	}

	w.start();

	return w;
}

var restartWatcherDefaults = {
	debounce: 50,
	throttle: 0,
	reglob: 1000,
	events: ["create", "change", "delete"],
	checkMD5: false,
	checkMtime: true,
	deleteCheckInterval: 25,
	deleteCheckTimeout: 100,
	debug: false
};

var restartRunnerDefaults = {
	restartOnError: true,
	restartOnSuccess: true,
	shell: true,
	stdio: [null, "ignore", "ignore"],
	debug: false
};

/*
	watcher.restart(globs, cmd)
	watcher.restart(globs, options, cmd)
*/
watcher.restart = function (globs) {
	var options = {};
	var cmd;
	if (arguments.length == 2) {
		cmd = arguments[1];
	} else if (arguments.length == 3) {
		options = arguments[1];
		cmd = arguments[2];
	}

	if (options.debug && options.kill && !("debug" in options.kill)) {
		options.kill.debug = true;
	}

	var watcherOptions = applyDefaults(options, restartWatcherDefaults);
	var runnerOptions = applyDefaults(options, restartRunnerDefaults);
	runnerOptions.kill = Object.assign({}, killDefaults, options.kill);
	//console.log({watcherOptions, runnerOptions});

	watcherOptions.callOnStart = true;
	watcherOptions.combineEvents = true;

	var callback = function (filePaths) {
		w._restartRunner.restart(filePaths);
	};

	var w = new Watcher(globs, watcherOptions, callback);

	runnerOptions.cmd = function (task) {
		return _interpolateCombinedCmd(cmd, task);
	};
	w._restartRunner = new RestartRunner(runnerOptions);

	// HACK: substitute ee to passthrough events
	w._restartRunner.ee = w.ee;

	if (runnerOptions.stdio) {
		if (runnerOptions.stdio[1] == "pipe") {
			w.stdout = new AlivePassThrough();
			w._restartRunner.stdout.pipe(w.stdout);
		}

		if (runnerOptions.stdio[2] == "pipe") {
			w.stderr = new AlivePassThrough();
			w._restartRunner.stderr.pipe(w.stderr);
		}
	}

	w.on("start", function () {
		w._restartRunner.start();
	});

	var _stop = w.stop;
	w.stop = function (callback) {
		w._restartRunner.stop(function () {
			_stop.call(w, callback);
		});
	};

	w.start();

	return w;
}

watcher.Watcher = Watcher;

module.exports = watcher;
