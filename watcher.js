var fs = require("fs");
var path = require("path");
var child = require('child_process');
var EventEmitter = require('events');

var glob = require("glob");
var chalk = require("chalk");
var async = require("async");

var utils = require("./utils");
var debounce = utils.debounce;
var debugLog = utils.debugLog;
var shallowCopyObj = utils.shallowCopyObj;
var genUID = utils.genUID;
var kill = require("kill-with-style");
var defaultOptions = require("./default-options");

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
			var childRunning = child.spawn(shellExecutable, options.customShell.split(" ").slice(1).concat([cmd]), { stdio: ["ignore", "pipe", "pipe"] });
		} else {
			if (process.platform === 'win32') {
				if (isShAvailableOnWin === undefined) {
					isShAvailableOnWin = checkShAvailableOnWin();
					if (isShAvailableOnWin && options.debug) {
						debugLog("Will use " + chalk.yellow("'C:\\\\bin\\\\sh.exe'") + " as default shell.");
					}
				}

				if (isShAvailableOnWin) {
					var childRunning = child.spawn("/bin/sh", ["-c", cmd], { stdio: ["ignore", "pipe", "pipe"] });
				} else {
					var childRunning = child.spawn(cmd, { shell: true, stdio: ["ignore", "pipe", "pipe"] });
				}
			} else {
				var childRunning = child.spawn(cmd, { shell: true, stdio: ["ignore", "pipe", "pipe"] });
			}
		}
	} else {
		var splittedCmd = cmd.split(" ");
		var childRunning = child.spawn(splittedCmd[0], splittedCmd.slice(1), { shell: false, stdio: ["ignore", "pipe", "pipe"] });
	}

	return childRunning;
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

function Watcher(globs, ruleOptions, cmdOrFun) {
	if (!(this instanceof Watcher)) {
		if (arguments.length === 1) {
			return new Watcher(arguments[0]);
		} else if (arguments.length === 2) {
			return new Watcher(arguments[0], arguments[1]);
		} else {
			return new Watcher(arguments[0], arguments[1], arguments[2]);
		}
	}

	var ruleOptions;
	if (arguments.length === 1) {
		ruleOptions = shallowCopyObj(arguments[0]);
	} else if (arguments.length === 2) {
		ruleOptions = {};
		ruleOptions.globs = arguments[0];
		ruleOptions.cmdOrFun = arguments[1];
	} else {
		ruleOptions = shallowCopyObj(ruleOptions);
		ruleOptions.globs = globs;
		ruleOptions.cmdOrFun = cmdOrFun;
	}

	this._ruleOptions = ruleOptions;
	this.id = this._ruleOptions.id || genUID();

	if (!this._ruleOptions.type) {
		this._ruleOptions.type = "reload";
	}
	if (typeof cmdOrFun === "function") {
		this._ruleOptions.type = "exec";
	}

	this._runState = ruleOptions.runState || "stopped"
	if (this._runState === "running") {
		this._runState = "paused"
	}

	this._log = [];

	this.ee = new EventEmitter();
	this.on = this.ee.on.bind(this.ee);
	this.once = this.ee.once.bind(this.ee);
}

Watcher.prototype.isRunning = function () {
	return this._runState === "running";
};

Watcher.prototype.isStopped = function () {
	return this._runState === "stopped";
};

Watcher.prototype.isPaused = function () {
	return this._runState === "paused";
};

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

Watcher.prototype.update = function (ruleOptions, callback) {
	this._ruleOptions = ruleOptions;
	this.restart(callback);
};

Watcher.prototype.patch = function (ruleOptions, callback) {
	for (var key in ruleOptions) {
		this._ruleOptions[key] = ruleOptions[key];
	}
	this.restart(callback);
};

Watcher.prototype.options = function () {
	return this._ruleOptions;
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
	this._watchers = {};

	this._childRunning = null;
	var firstTime = true;
	var changed = {};
	var execCallback = function (action, filePath) {
		var actions = this.getOption("actions");
		if (actions.indexOf(action) !== -1) {
			changed[filePath] = { action: action, filePath: filePath };
			execCallbackDebounce();
		}
	}.bind(this);

	var execCallbackDebounce = debounce(function () {
		if (this._runState !== "running") {
			return;
		}
		if (this._ruleOptions.type === "exec") {
			if (typeof(this._ruleOptions.cmdOrFun) === "function") {
				if (this.getOption("runSeparate")) {
					Object.keys(changed).forEach(function (fileName) {
						var action = changed[fileName].action;
						this._ruleOptions.cmdOrFun(fileName, action);
					}.bind(this));
					changed = {};
				} else {
					this._ruleOptions.cmdOrFun(Object.keys(changed));
					changed = {};
				}
			} else {
				if (this.getOption("runSeparate")) {
					var runForEach = function () {
						var fileNames = Object.keys(changed);
						async.eachLimit(fileNames, this.getOption("parallelLimit"), function (fileName, callback) {
							if (this._runState !== "running") {
								return callback();
							}
							var action = changed[fileName].action;
							delete changed[fileName];
							this._execChildSeparate(fileName, action, callback);
						}.bind(this), function () {
							if (this._runState !== "running") {
								return;
							}
							if (Object.keys(changed).length) {
								setTimeout(function () { // to prevent call stack error
									runForEach();
								}, 0);
							}
						});
					}.bind(this);

					if (!this._childrenRunning || !this._childrenRunning.length) {
						runForEach();
					}
				} else {
					var onExit = function () {
						if (Object.keys(changed).length) {
							if (this._runState !== "running") {
								return;
							}
							this._execChildBatch(Object.keys(changed), onExit);
							changed = {};
						}
					}.bind(this);

					if (!this._childRunning) {
						this._execChildBatch(Object.keys(changed), onExit);
						changed = {};
					}
				}
			}
		} else if (this._ruleOptions.type === "reload") {
			this._restartChild();
		}
	}.bind(this), this.getOption("debounce"));
	var reglob = function () {
		if (this._runState !== "running") {
			return;
		}
		var paths = globWithNegates(preprocessGlobPatters(this._ruleOptions.globs));

		paths.forEach(function (p) {
			if (!this._watchers[p]) {
				var rewatch = function () {
					if (this._watchers[p]) {
						if (this.getOption("debug")) {
							debugLog(chalk.red("Deleted")+" watcher: path="+chalk.yellow(p)+" id="+this._watchers[p].id);
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
						if (this.getOption("debug")) {
							debugLog(chalk.green("Fire")+" watcher: path="+chalk.yellow(p)+" id="+this._watchers[p].id+" action="+action);
						}
						try {
							stat = fs.statSync(p);
						} catch (err) {
							if (err.code == "ENOENT") {
								this._watchers[p].close();
								delete this._watchers[p];
								execCallback("delete", p);
								return;
							}
						}
						if (action == "rename") {
							setTimeout(rewatch, 0);
						}

						if (this.getOption("mtimeCheck")) {
							if (stat.mtime > mtime) {
								execCallback("change", p);
								mtime = stat.mtime;
							}
						} else {
							execCallback("change", p);
						}
					}.bind(this));
					if (this.getOption("debug")) {
						this._watchers[p].id = genUID();
						debugLog(chalk.green("Created")+" watcher: path="+chalk.yellow(p)+" id="+this._watchers[p].id);
					}
				}.bind(this);

				rewatch();

				if (!firstTime) {
					execCallback("create", p);
				}
			}
		}.bind(this));

		Object.keys(this._watchers).forEach(function (p) {
			if (paths.indexOf(p) == -1) {
				if (this.getOption("debug")) {
					debugLog(chalk.red("Deleted")+" watcher: path="+chalk.yellow(p)+" id="+this._watchers[p].id);
				}
				// catch deletions that happened right after reglob
				if (this._watchers[p]) {
					this._watchers[p].close();
					delete this._watchers[p];
					execCallback("delete", p);
				}
			}
		}.bind(this));

		if (firstTime && this._ruleOptions.type === "reload") {
			this._restartChild();
		}
		firstTime = false;
	}.bind(this);

	reglob();

	this._runState = "running";
	this._reglobInterval = setInterval(reglob, this.getOption("reglob"));
	if (callback) {
		return callback(null);
	} else {
		return this;
	}
};

Watcher.prototype.stop = function (callback) {
	var afterTerminate = function () {
		if (callback) { return callback(null); }
	}.bind(this);

	if (this._runState === "running") {
		this._runState = "stopped";
		clearInterval(this._reglobInterval);
		this._reglobInterval = null;
		Object.keys(this._watchers).forEach(function (p) {
			this._watchers[p].close();
			delete this._watchers[p];
		}.bind(this));

		if (this._childRunning) {
			this._terminateChild(function (err) {
				afterTerminate();
			});
		} else {
			afterTerminate();
		}
	}
};

Watcher.prototype.restart = function (callback) {
	this.stop(function (err) {
		this.start();
		if (callback) { return callback(null); }
	}.bind(this));
};

Watcher.prototype.pause = function (callback) {
	this.stop(function (err) {
		this._runState = "paused";
		if (callback) { return callback(null); }
	}.bind(this));
};

Watcher.prototype.toJSON = function () {
	var ruleOptionsCopy = JSON.parse(JSON.stringify(this._ruleOptions));
	if (typeof(this._ruleOptions.cmdOrFun) === "function") {
		ruleOptionsCopy.cmdOrFun = "<FUNCTION>";
	}
	ruleOptionsCopy.runState = this._runState;
	ruleOptionsCopy.id = this.id;
	return ruleOptionsCopy;
};

Watcher.prototype._terminateChild = function (callback) {
	if(!this._isTerminating) {
		if (this.getOption("debug")) {
			debugLog(chalk.green("Terminate"), this._ruleOptions.cmdOrFun.toString().slice(0, 50));
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

Watcher.prototype._execChildBatch = function (filePaths, callback) {
	var cmd;
	if (this._ruleOptions.cmdOrFun.indexOf("${") !== -1) {
		var cwd = path.resolve(".")
		var relFiles = filePaths;
		var files = filePaths.map(function (f) { return path.resolve(f); });
		var body = "var cwd = \"" + cwd + "\";"
			+ "var relFiles = " + JSON.stringify(relFiles) + ";"
			+ "var files = " + JSON.stringify(files) + ";"
			+ "return `" + this._ruleOptions.cmdOrFun.replace(/\\/g, "\\\\") + "`;";
		var func = new Function(body);
		var cmd = func();
	} else {
		cmd = this._ruleOptions.cmdOrFun;
	}

	this._childRunning = exec(cmd, {
		writeToConsole: this.getOption("writeToConsole"),
		useShell: this.getOption("useShell"),
		customShell: this.getOption("customShell"),
		debug: this.getOption("debug")
	});

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

	this._childRunning.on("exit", function () {
		setTimeout(function () { // to prevent call stack error
			callback();
			this._childRunning = null;
		}.bind(this), 0);
	}.bind(this));
};

Watcher.prototype._execChildSeparate = function (filePath, action, callback) {
	var cmd;
	if (this._ruleOptions.cmdOrFun.indexOf("${") !== -1) {
		var cwd = path.resolve(".")
		var relFile = filePath;
		var file = path.resolve(filePath);
		var relDir = path.dirname(filePath);
		var dir = path.resolve(path.dirname(filePath));
		var body = "var cwd = \"" + cwd + "\";"
			+ "var relFile = \"" +relFile + "\";"
			+ "var file = \"" + file + "\";"
			+ "var relDir = \"" + relDir + "\";"
			+ "var dir = \"" + dir + "\";"
			+ "var action = \"" + action + "\";"
			+ "return `" + this._ruleOptions.cmdOrFun.replace(/\\/g, "\\\\") + "`;";
		var func = new Function(body);
		cmd = func();
	} else {
		cmd = this._ruleOptions.cmdOrFun;
	}
	var childRunning = exec(cmd, {
		writeToConsole: this.getOption("writeToConsole"),
		useShell: this.getOption("useShell"),
		customShell: this.getOption("customShell"),
		debug: this.getOption("debug")
	});

	childRunning.stdout.on("data", function (buffer) {
		var text = buffer.toString();
		if (this.getOption("writeToConsole")) {
			console.log(text.replace(/\n$/, ""));
		}
		this._writeLog({ stream: "stdout", text: text });
	}.bind(this));

	childRunning.stderr.on("data", function (buffer) {
		var text = buffer.toString();
		if (this.getOption("writeToConsole")) {
			console.error(text.replace(/\n$/, ""));
		}
		this._writeLog({ stream: "stderr", text: text });
	}.bind(this));

	childRunning.on("exit", function () {
		var index = this._childrenRunning.indexOf(childRunning);
		this._childrenRunning.splice(index, 1);
		callback();
	}.bind(this));
	
	if (!this._childrenRunning) {
		this._childrenRunning = [];
	}
	this._childrenRunning.push(childRunning);
};

Watcher.prototype._runRestartingChild = function () {
	if (this.getOption("debug")) {
		debugLog(chalk.green("Run"), this._ruleOptions.cmdOrFun.toString());
	}

	this._childRunning = exec(this._ruleOptions.cmdOrFun, {
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
};

Watcher.prototype._restartChild = function () {
	if (this._childRunning) {
		this._terminateChild(function (err) {
			if(err){
				debugLog(chalk.red("Terminating error:"), err.message);
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
};

module.exports = Watcher;
