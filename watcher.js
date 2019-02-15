var fs = require("fs");
var path = require("path");
var stream = require("stream");
var childProcess = require("child_process");
var EventEmitter = require("events");

var glob = require("glob");
var chalk = require("chalk");
var async = require("async");
var kill = require("kill-with-style");

function debug(message) {
	var d = new Date();
	console.log("DEBUG "
		+ ("" + d.getHours()).padStart(2, "0")
		+ ":" + ("" + d.getMinutes()).padStart(2, "0")
		+ ":" + ("" + d.getSeconds()).padStart(2, "0")
		+ "." + ("" + d.getMilliseconds()).padStart(3, "0")
		+ " " + message);
}

function debounce(fun, duration) {
	var timeout;
	var context, args;
	var debouncer = function() {
		context = this;
		args = arguments;
		clearTimeout(timeout);
		timeout = setTimeout(function () {
			fun.apply(context, args);
		}, duration);
	};
	debouncer.cancel = function () {
		clearTimeout(timeout);
	};
	return debouncer;
};

var defaultOptions = {
	type: "exec",
	debounce: 200, // exec/reload once in ms at max
	reglob: 50, // perform reglob to watch added files
	restartOnError: false, // restart if exit code != 0
	restartOnSuccess: false, // restart if exit code == 0
	restartOnEvent: false, // restart if file changed
	run: false, // run immediately without waiting for events
	events: ["create", "change", "delete"],
	combineEvents: false, // true - run separate cmd per changed file, false - run single cmd for all changes, default: false
	parallelLimit: 4, // max parallel running cmds in combineEvents == true mode
	useShell: true, // run in shell
	customShell: "", // custom shell to run cmds, if not set - run in default shell
	maxLogEntries: 100, // max log entries to store for each watcher, Note! entry could be multiline
	writeToConsole: false, // write logs to console
	mtimeCheck: true, // check modified time before firing events
	kill: {},
	debug: false, // debug logging
};

var isShAvailableOnWin = undefined;
function checkShAvailableOnWin() {
	try {
		var stat = fs.statSync("/bin/sh.exe");
	} catch (err) {
		return false;
	}
	return true;
}


function exec(cmd, options) {
	if (options.useShell) {
		if (options.customShell) {
			var shellExecutable = options.customShell.split(" ")[0];
			var child = childProcess.spawn(shellExecutable, options.customShell.split(" ").slice(1).concat([cmd]), { stdio: ["ignore", "pipe", "pipe"] });
		} else {
			if (process.platform === 'win32') {
				if (isShAvailableOnWin === undefined) {
					isShAvailableOnWin = checkShAvailableOnWin();
					if (isShAvailableOnWin && options.debug) {
						debug("Will use " + chalk.yellow("'C:\\\\bin\\\\sh.exe'") + " as default shell.");
					}
				}

				if (isShAvailableOnWin) {
					var child = childProcess.spawn("/bin/sh", ["-c", cmd], { stdio: ["ignore", "pipe", "pipe"] });
				} else {
					var child = childProcess.spawn(cmd, { shell: true, stdio: ["ignore", "pipe", "pipe"] });
				}
			} else {
				var child = childProcess.spawn(cmd, { shell: true, stdio: ["ignore", "pipe", "pipe"] });
			}
		}
	} else {
		var splittedCmd = cmd.split(" ");
		var child = childProcess.spawn(splittedCmd[0], splittedCmd.slice(1), { shell: false, stdio: ["ignore", "pipe", "pipe"] });
	}

	return child;
}

function preprocessGlobPatters(patterns) {
	if (!Array.isArray(patterns)) {
		patterns = patterns.split(",");
	}
	var additional = [];
	patterns.forEach(function (p) {
		if (p.startsWith("!") && !p.endsWith("**/*")) {
			if (p.endsWith("/")) {
				additional.push(p+"**/*");
			} else {
				additional.push(p+"/**/*");
			}
		}
	});
	return patterns.concat(additional);
}

function globWithNegates(patterns) {
	var includePatterns = [];
	var excludePatterns = [];

	patterns.forEach(function (p) {
		if (p.startsWith("!") && !p.startsWith("!(")) {
			excludePatterns.push(p.substr(1));
		} else {
			includePatterns.push(p);
		}
	});

	var resultHash = {};
	includePatterns.forEach(function (pattern) {
		if (excludePatterns.length) {
			var options = { ignore: excludePatterns };
		}
		var paths = glob.sync(pattern, options);
		paths.forEach(function (p) {
			resultHash[p] = true;
		});
	});
	return Object.keys(resultHash);
}

function AlivePassThrough (options) {
	stream.PassThrough.call(this, options);
}

AlivePassThrough.prototype = Object.create(stream.PassThrough.prototype);
AlivePassThrough.prototype.constructor = AlivePassThrough;
AlivePassThrough.prototype.end = function () {};

function RestartRunner(options) {
	this.options = Object.assign({}, this.defaults, options || {});

	if (this.options.stdio[1] == "pipe") {
		this.stdout = new AlivePassThrough();
	}
	if (this.options.stdio[2] == "pipe") {
		this.stderr = new AlivePassThrough();
	}

	this.isStarted = false;

	this.ee = new EventEmitter();
	this.on = this.ee.on.bind(this.ee);
}

RestartRunner.prototype.defaults = {
	restartOnError: true,
	restartOnSuccess: true,
	stdio: ["ignore", "pipe", "pipe"],
	shell: true,
	kill: {}
};

RestartRunner.prototype.start = function (entry, callback) {
	var _callback = function () {
		if (callback) {
			callback.apply(null, arguments);
			callback = null;
		}
	}

	if (this.process) {
		return;
	}

	this.isStarted = true;

	var cmd;
	if (typeof(this.options.cmd) == "function") {
		cmd = this.options.cmd(entry);
	} else {
		cmd = this.options.cmd;
	}

	var child = exec(cmd, {
		useShell: this.options.useShell,
		customShell: this.options.customShell,
		debug: this.options.debug
	});

	this.process = child;

	if (this.options.stdio[1] == "inherit") {
		child.stdout.pipe(process.stdout);
	} else if (this.options.stdio[1] == "pipe") {
		child.stdout.pipe(this.stdout);
	}

	if (this.options.stdio[2] == "inherit") {
		child.stdout.pipe(process.stderr);
	} else if (this.options.stdio[2] == "pipe") {
		child.stderr.pipe(this.stderr);
	}

	child.on("exit", function (code) {
		this.process = null;
		if (!this.isStarted) {
			return;
		}
		if (this.options.restartOnError && code != 0) {
			this.start();
		} else if (this.options.restartOnSuccess && code == 0) {
			this.start();
		}
	}.bind(this));

	child.on("error", function (err) {
		if (callback) {
			callback(err);
			this.ee.emit("error", err);
		}
	});

	if (child.pid) {
		if (callback) {
			setImmediate(callback);
		}
	}
};

RestartRunner.prototype.stop = function (callback) {
	callback = callback || function () {};
	this.isStarted = false;
	if (this.process) {
		var pid = this.process.pid;
		this.process = null;
		kill(pid, this.options.kill, callback);
	} else {
		setImmediate(callback);
	}
};

RestartRunner.prototype.restart = function (entry, callback) {
	this.stop(function () {
		this.start(entry, callback);
	}.bind(this));
};

function QueueRunner(options) {
	this.options = Object.assign({}, this.defaults, options || {});

	if (this.options.stdio[1] == "pipe") {
		this.stdout = new AlivePassThrough();
	}
	if (this.options.stdio[2] == "pipe") {
		this.stderr = new AlivePassThrough();
	}

	this.isStarted = false;
	this.processes = [];

	this.ee = new EventEmitter();
	this.on = this.ee.on.bind(this.ee);
}

QueueRunner.prototype.defaults = {
	parallelLimit: 8,
	waitDone: true,
	throttle: 0,
	restartOnError: false,
	stdio: ["ignore", "pipe", "pipe"],
	shell: true,
	kill: {}
};

QueueRunner.prototype.start = function (callback) {
	var _callback = function () {
		if (callback) {
			callback.apply(null, arguments);
			callback = null;
		}
	}

	this.queue = [];
	this.isStarted = true;
	this.exec();
}

QueueRunner.prototype.push = function (entry) {
	this.queue.push(entry);
	if (this.options.debug) {
		debug(chalk.green("Pushed") + " to queue " + JSON.stringify(entry));
	}
	if (this.options.reducer) {
		this.queue = this.options.reducer(this.queue);
	}

	this.exec();
};

QueueRunner.prototype.exec = function () {
	if (!this.isStarted) {
		return;
	}

	if (this.processes.length >= this.options.parallelLimit) {
		return;
	}

	if (!this.queue.length) {
		return;
	}

	var entry;
	if (this.options.skip) {
		var runningEntries = this.processes.map(function (p) { return p.entry; });
		var index = this.queue.findIndex(function (e) { return !this.options.skip(e, runningEntries); }.bind(this));
		if (index != -1) {
			entry = this.queue[index];
			this.queue.splice(index, 1);
		}
	} else {
		var entry = this.queue.shift();
	}

	if (!entry) {
		return;
	}

	var cmd = entry.cmd || this.options.cmd(entry);

	if (this.options.debug) {
		debug(chalk.green("Exec ") + cmd);
	}

	var child = exec(cmd, {
		useShell: this.options.useShell,
		customShell: this.options.customShell,
		debug: this.options.debug
	});

	this.processes.push(child);

	if (this.options.stdio[1] == "inherit") {
		child.stdout.pipe(process.stdout);
	} else if (this.options.stdio[1] == "pipe") {
		child.stdout.pipe(this.stdout);
	}

	if (this.options.stdio[2] == "inherit") {
		child.stdout.pipe(process.stderr);
	} else if (this.options.stdio[2] == "pipe") {
		child.stderr.pipe(this.stderr);
	}

	child.on("exit", function (code) {
		if (this.options.debug) {
			debug(chalk.red("Exited ") + cmd);
		}
		if (!this.isStarted) {
			return;
		}
		this.processes.splice(this.processes.indexOf(child), 1);
		if (this.options.restartOnError && code != 0) {
			if (this.options.debug) {
				debug(chalk.green("Restart") + " on error "+ cmd);
			}
			this.push(entry);
		}
		this.exec();
	}.bind(this));

	child.on("error", function (err) {
		this.ee.emit("error", err);
	});

	child.entry = entry;
	child.cmd = cmd;

	this.exec();
};

QueueRunner.prototype.stop = function (callback) {
	callback = callback || function () {};
	this.isStarted = false;
	async.each(this.processes, function (c, callback) {
		if (this.options.debug) {
			debug(chalk.green("Kill ") + c.cmd);
		}
		kill(c.pid, this.options.kill, callback);
	}.bind(this), callback);
	this.processes = null;
};

QueueRunner.prototype.restart = function (callback) {
	this.stop(this.start.bind(this, callback));
};

/*
	new Watcher(globs, options, callback)
	new Watcher(globs, options, cmd)
	new Watcher(globs, callback)
	new Watcher(globs, cmd)
	new Watcher(options, callback)
	new Watcher(options, cmd)
	new Watcher(globs)
	new Watcher(options)
*/

function Watcher() {
	var globs, options, callback, cmd;
	if (Array.isArray(arguments[0])) {
		globs = arguments[0];
	} else {
		options = arguments[0];
	}

	if (arguments.length > 1) {
		if (typeof(arguments[1]) == "function") {
			callback = arguments[1];
		} else if (typeof(arguments[1]) == "string") {
			cmd = arguments[1];
		} else {
			options = arguments[1];
		}
	}

	if (arguments.length > 2) {
		if (typeof(arguments[2]) == "function") {
			callback = arguments[2];
		} else {
			cmd = arguments[2];
		}
	}

	this._ruleOptions = Object.assign({}, defaultOptions, options || {});
	this._ruleOptions.globs = globs;
	this._ruleOptions.cmd = cmd;
	this._ruleOptions.callback = callback;

	if (this._ruleOptions.restart) {
		this._ruleOptions.combineEvents = true;
	}

	if (this._ruleOptions.debug) {
		this._ruleOptions.kill.debug = true;
	}

	this._runState = "stopped";

	this._log = [];

	this.ee = new EventEmitter();
	this.on = this.ee.on.bind(this.ee);

	//this._ruleOptions.writeToConsole = true;
	//this._ruleOptions.debug = true;
	//this._ruleOptions.kill.debug = true;
}

Watcher.prototype.getLog = function () {
	return this._log;
};

Watcher.prototype._writeLog = function (entry) {
	var max = this.getOption("maxLogEntries");
	if (this._log.length >= max) {
		this._log.splice(0, 1);
	}
	entry.date = Date.now();
	this._log.push(entry);
	this.ee.emit("log", entry);
};

Watcher.prototype.getOption = function (name) {
	if (this._pm) {
		return [this._ruleOptions[name], this._pm._globalOptions[name], defaultOptions[name]].find(function (v) {
			return v != null;
		});
	} else {
		return [this._ruleOptions[name], defaultOptions[name]].find(function (v) {
			return v != null;
		});
	}
};

Watcher.prototype.start = function (callback) {
	if (this._runState === "running") {
		var err = new Error("Process already started");
		if (callback) {
			return callback(err);
		} else {
			throw err;
		}
	}
	this._runState = "running";
	this._watchers = {};

	this._firstTime = true;
	this._changed = {};
	this._processes = {};
	this._queues = {};

	if (this._ruleOptions.cmd) {
		if (this._ruleOptions.restart) {
			this._restartRunner = new RestartRunner(this._ruleOptions);
			this._restartRunner.options.cmd = this._interpolateCombinedCmd.bind(this);
			this._ruleOptions.callback = function (filePaths) {
				this._restartRunner.restart(filePaths);
			}.bind(this);
			this._restartRunner.start();
		} else {
			this._queueRunner = new QueueRunner(this._ruleOptions);
			if (this.getOption("combineEvents")) {
				if (this._ruleOptions.waitDone) {
					this._queueRunner.options.parallelLimit = 1;
				}
				this._queueRunner.options.cmd = this._interpolateCombinedCmd.bind(this);
				this._queueRunner.options.reducer = function (queue) {
					var last = queue.pop();
					var filePaths = last.filePaths.filter(function (f) {
						return !queue.find(function (e) { return e.filePaths.indexOf(f) != -1; });
					});
					if (filePaths.length) {
						queue.push({ filePaths });
					}
					return queue;
				};
				this._ruleOptions.callback = function (filePaths) {
					this._queueRunner.push({ filePaths });
				}.bind(this);
			} else {
				this._queueRunner.options.cmd = this._interpolateSeparateCmd.bind(this);
				this._queueRunner.options.reducer = function (queue) {
					var last = queue.pop();
					;
					var found = queue.find(function (e) { return e.filePath == last.filePath; });
					if (found) {
						found.action = last.action;
					} else {
						queue.push(last);
					}
					return queue;
				};
				this._queueRunner.options.skip = function (entry, running) {
					if (this._ruleOptions.waitDone) {
						var inProcessing = running.find(function (r) { return r.filePath == entry.filePath; });
						return inProcessing;
					} else {
						return false;
					}
				}.bind(this);
				this._ruleOptions.callback = function (filePath, action) {
					this._queueRunner.push({ filePath, action });
				}.bind(this);
			}
			this._queueRunner.start();
		}
	}

	if (this._ruleOptions.callback || this.getOption("combineEvents")) {
		this._callbackCombinedDebounced = debounce(this._callbackCombined.bind(this), this.getOption("debounce"));
	}

	this._reglob();
	this._debouncers = {};

	this._reglobInterval = setInterval(this._reglob.bind(this), this.getOption("reglob"));

	if (callback) {
		setTimeout(function () {
			callback();
		}, 0);
	} else {
		return this;
	}
};

Watcher.prototype._callbackCombined = function () {
	if (this.getOption("debug")) {
		debug(chalk.green("Call") + " callback for " + chalk.yellow(Object.keys(this._changed).join(", ")));
	}
	this._ruleOptions.callback(Object.keys(this._changed));
	this._changed = {};
}

Watcher.prototype._callbackSingle = function (filePath) {
	var action = this._changed[filePath].action;
	if (this.getOption("debug")) {
		debug(chalk.green("Call") + " callback for path=" + chalk.yellow(filePath) + " action=" + action);
	}
	this._changed[filePath] = null;
	this._ruleOptions.callback(filePath, action);
}

Watcher.prototype._onWatcherEvent = function (filePath, action) {
	if (this.getOption("debug")) {
		debug(chalk.green("Fire") + " watcher: path=" + chalk.yellow(filePath) + " action=" + action);
	}
	var events = this.getOption("events");
	if (events.indexOf(action) == -1) {
		return;
	}
	this._changed[filePath] = { action: action, filePath: filePath };

	if (this._ruleOptions.type === "exec") {
		if (this.getOption("combineEvents")) {
			this._callbackCombinedDebounced();
		} else {
			if (!this._debouncers[filePath]) {
				this._debouncers[filePath] = debounce(function () {
					delete this._debouncers[filePath];
					this._callbackSingle(filePath);
				}.bind(this), this.getOption("debounce"));
			}
			this._debouncers[filePath]();
		}
	} else {
		this._changed[filePath] = { action: action, filePath: filePath };
		this._callbackCombinedDebounced();
	}
};

Watcher.prototype._reglob = function () {
	if (this._runState !== "running") {
		return;
	}
	var paths = globWithNegates(preprocessGlobPatters(this._ruleOptions.globs));

	paths.forEach(function (p) {
		if (!this._watchers[p]) {
			var rewatch = function () {
				if (this._watchers[p]) {
					if (this.getOption("debug")) {
						debug(chalk.red("Deleted") + " watcher: path=" + chalk.yellow(p));
					}
					this._watchers[p].close();
				} else {
				}
				try {
					var stat = fs.statSync(p);
					var mtime = stat.mtime;
				} catch (err) {
					return setTimeout(reglob, 0);
				}
				this._watchers[p] = fs.watch(p, function (action) {
					try {
						stat = fs.statSync(p);
					} catch (err) {
						if (err.code == "ENOENT") {
							this._watchers[p].close();
							delete this._watchers[p];
							this._onWatcherEvent(p, "delete");
							return;
						}
					}
					if (action == "rename") {
						setTimeout(rewatch, 0);
					}

					if (this.getOption("mtimeCheck")) {
						if (stat.mtime > mtime) {
							this._onWatcherEvent(p, "change");
							mtime = stat.mtime;
						}
					} else {
						this._onWatcherEvent(p, "change");
					}
				}.bind(this));
				if (this.getOption("debug")) {
					debug(chalk.green("Created") + " watcher: path=" + chalk.yellow(p));
				}
			}.bind(this);

			rewatch();

			if (!this._firstTime) {
				this._onWatcherEvent(p, "create");
			}
		}
	}.bind(this));

	Object.keys(this._watchers).forEach(function (p) {
		if (paths.indexOf(p) == -1) {
			if (this.getOption("debug")) {
				debug(chalk.red("Deleted") + " watcher: path=" + chalk.yellow(p) + " id=" + this._watchers[p].id);
			}
			// catch deletions that happened right after reglob
			if (this._watchers[p]) {
				this._watchers[p].close();
				delete this._watchers[p];
				this._onWatcherEvent(p, "delete");
			}
		}
	}.bind(this));

	this._firstTime = false;
};

Watcher.prototype.stop = function (callback) {
	if (this._runState == "stopped") {
		if (callback) {
			callback();
		}
		return;
	}
	if (this.getOption("debug")) {
		debug(chalk.green("Stop") + " watcher");
	}
	this._runState = "stopped";

	clearInterval(this._reglobInterval);

	if (this._callbackCombinedDebounced) {
		this._callbackCombinedDebounced.cancel();
	}

	Object.values(this._debouncers).forEach(function (d) {
		d.cancel();
	});
	this._debouncers = {};

	Object.values(this._watchers).forEach(function (w) {
		w.close();
	}.bind(this));
	this._watchers = {};

	if (this._restartRunner) {
		this._restartRunner.stop(callback);
	} else if (this._queueRunner) {
		this._queueRunner.stop(callback);
	}
};

Watcher.prototype._interpolateCombinedCmd = function (options) {
	options = options || [];
	var filePaths = options.filePaths || [];
	var cmd;
	if (this._ruleOptions.cmd.indexOf("%") !== -1) {
		var cwd = path.resolve(".")
		var relFiles = filePaths.join(" ");
		var files = filePaths.map(function (f) { return path.resolve(f); }).join(" ");
		cmd = this._ruleOptions.cmd
			.replace("%cwd", cwd)
			.replace("%relFiles", relFiles || "")
			.replace("%files", files || "");
	} else {
		cmd = this._ruleOptions.cmd;
	}

	return cmd;
}

Watcher.prototype._interpolateSeparateCmd = function (options) {
	var filePath = options.filePath;
	var action = options.action;
	var cmd;
	if (this._ruleOptions.cmd.indexOf("%") !== -1) {
		var cwd = path.resolve(".")
		var relFile = filePath;
		var file = path.resolve(filePath);
		var relDir = path.dirname(filePath);
		var dir = path.resolve(path.dirname(filePath));
		cmd = this._ruleOptions.cmd
			.replace("%cwd", cwd)
			.replace("%event", action || "")
			.replace("%relFile", relFile || "")
			.replace("%file", file || "")
			.replace("%relDir", relDir || "")
			.replace("%dir", dir || "");
	} else {
		cmd = this._ruleOptions.cmd;
	}

	return cmd;
};

module.exports = Watcher;
