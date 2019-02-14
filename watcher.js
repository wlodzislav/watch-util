var fs = require("fs");
var path = require("path");
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

	if (this._ruleOptions.debug) {
		this._ruleOptions.kill.debug = true;
	}

	if (this._ruleOptions.callback) {
		this._ruleOptions.type = "exec";
	}

	this._runState = "stopped";

	this._log = [];

	this.ee = new EventEmitter();
	this._rawEE = new EventEmitter();
	this.on = this.ee.on.bind(this.ee);
	this.once = this.ee.once.bind(this.ee);

	//this._ruleOptions.writeToConsole = true; this._ruleOptions.debug = true; this._ruleOptions.kill.debug = true;
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

	this._childRunning = null;
	this._firstTime = true;
	this._changed = {};
	this._processes = {};

	if (this._ruleOptions.cmd) {
		if (this._ruleOptions.type === "exec") {
			if (this.getOption("combineEvents")) {
				this._ruleOptions.callback = this._execCmd.bind(this);
			} else {
				this._ruleOptions.callback = this._execCmd.bind(this);
			}
		} else {
			//this._ruleOptions.callback = this._restartChild.bind(this);
		}
	}

	//console.log(this._ruleOptions);
	if (this._ruleOptions.type === "exec") {
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

	var children = Object.values(this._processes);
	async.each(children, function (child, callback) {
		kill(child.pid, this.getOption("kill"), callback);
	}.bind(this), function (err) {
		if (err) { return callback(err); }
		if (callback) {
			callback();
		}
	}.bind(this));
	
	var afterTerminate = function () {
		if (callback) { return callback(null); }
	}.bind(this);
};

Watcher.prototype._terminateChild = function (callback) {
	if(!this._isTerminating) {
		if (this.getOption("debug")) {
			debug(chalk.green("Terminate ") + this._ruleOptions.cmd.toString().slice(0, 50));
		}
		this._isTerminating = true;
		kill(this._childRunning.pid, {
			signal: this.getOption("killSignal"),
			checkInterval: this.getOption("killCheckInterval"),
			retryInterval: this.getOption("killRetryInterval"),
			retryCount: this.getOption("killRetryCount"),
			timeout: this.getOption("killTimeout"),
		}, function (err) {
			if (err) {
				console.log(err);
				process.exit(1);
			}
			this._childRunning = null;
			this._isTerminating = false;
			this.ee.emit("terminated");
			if (callback) { callback(); }
		}.bind(this));
	} else {
		if (callback) {
			this.once("terminated", callback);
		}
	}
};

Watcher.prototype._execCmd = function () {
	var combined;
	if (arguments.length == 1) {
		combined = true;
		var filePaths = arguments[0];
	} else {
		combined = false;
		var filePath = arguments[0];
		var action = arguments[1];
	}

	var cmd;
	if (this._ruleOptions.cmd.indexOf("%") !== -1) {
		if (combined) {
			var cwd = path.resolve(".")
			var relFiles = filePaths.join(" ");
			var files = filePaths.map(function (f) { return path.resolve(f); }).join(" ");
		} else {
			var cwd = path.resolve(".")
			var relFile = filePath;
			var file = path.resolve(filePath);
			var relDir = path.dirname(filePath);
			var dir = path.resolve(path.dirname(filePath));
		}
		cmd = this._ruleOptions.cmd
			.replace("%cwd", cwd)
			.replace("%relFiles", relFiles || "")
			.replace("%files", files || "")
			.replace("%event", action || "")
			.replace("%relFile", relFile || "")
			.replace("%file", file || "")
			.replace("%relDir", relDir || "")
			.replace("%dir", dir || "");
	} else {
		cmd = this._ruleOptions.cmd;
	}

	if (this.getOption("debug")) {
		debug(chalk.green("Exec ") + cmd);
	}

	var child = exec(cmd, {
		writeToConsole: this.getOption("writeToConsole"),
		useShell: this.getOption("useShell"),
		customShell: this.getOption("customShell"),
		debug: this.getOption("debug")
	});

	child.stdout.on("data", function (buffer) {
		var text = buffer.toString();
		if (this.getOption("writeToConsole")) {
			console.log(text.replace(/\n$/, ""));
		}
		this._writeLog({ stream: "stdout", text: text });
	}.bind(this));

	child.stderr.on("data", function (buffer) {
		var text = buffer.toString();
		if (this.getOption("writeToConsole")) {
			console.error(text.replace(/\n$/, ""));
		}
		this._writeLog({ stream: "stderr", text: text });
	}.bind(this));

	child.on("exit", function (code) {
		if (this._runState !== "running") {
			return;
		}
		if (this.getOption("restartOnError") && code != 0) {
			this._execCmd(filePath, action);
		}
		if (combined) {
			delete this._processes["*"];
		} else {
			delete this._processes[filePath];
		}
	}.bind(this));
	
	if (combined) {
		this._processes["*"] = child;
	} else {
		this._processes[filePath] = child;
	}
};

Watcher.prototype._runRestartingChild = function () {
	/*
	if (this.getOption("debug")) {
		debug(chalk.green("Run ") + this._ruleOptions.cmd.toString());
	}

	this._childRunning = exec(this._ruleOptions.cmd, {
		writeToConsole: this.getOption("writeToConsole"),
		useShell: this.getOption("useShell"),
		customShell: this.getOption("customShell"),
		debug: this.getOption("debug")
	});
	var childRunning = this._childRunning;

	this._childRunning.stdout.on("data", function (buffer) {
		var text = buffer.toString();
		if (this.getOption("writeToConsole")) {
			console.log(text.replace(/\n$/, ""));
		}
		this._writeLog({ stream: "stdout", text: text });
	}.bind(this));

	this._childRunning.stderr.on("data", function (buffer) {
		var text = buffer.toString();
		if (this.getOption("writeToConsole")) {
			console.error(text.replace(/\n$/, ""));
		}
		this._writeLog({ stream: "stderr", text: text });
	}.bind(this));

	this._childRunning.on("exit", function (code) {
		if (!(childRunning.killed || code === null)) { // not killed
			this._childRunning = null;
			if (this._runState !== "running") {
				return;
			}
			if (this.getOption("restartOnSuccess") && code === 0) {
				this._runRestartingChild();
			}
			if (this.getOption("restartOnError") && code !== 0) {
				this._runRestartingChild();
			}
		} else {
			this._childRunning = null;
		}
	}.bind(this));
	*/
};

Watcher.prototype._restartChild = function () {
	/*
	if (this._childRunning) {
		this._terminateChild(function (err) {
			if(err){
				console.error(chalk.red("Terminating error: ") + err.message);
				process.exit(1);
			}
			// check for case when watcher is stopped while reloading cmd is terminating
			if (this._runState === "running") {
				this._runRestartingChild();
			}
		}.bind(this));
	} else {
		this._runRestartingChild();
	}
	*/
};

module.exports = Watcher;
