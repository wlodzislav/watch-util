var fs = require("fs");
var path = require("path");
var child = require('child_process');
var EventEmitter = require('events');

var glob = require("glob");
var chalk = require("chalk");

var utils = require("./utils");
var debounce = utils.debounce;
var debugLog = utils.debugLog;
var shallowCopyObj = utils.shallowCopyObj;
var genUID = utils.genUID;
var terminate = require("./terminate");
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
	if (options.shell === true) {
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
	} else if (typeof(options.shell) === "string") {
		var shellExecutable = options.shell.split(" ")[0];
		var childRunning = child.spawn(shellExecutable, options.shell.split(" ").slice(1).concat([cmd]), { stdio: ["ignore", "pipe", "pipe"] });
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
	var execCallback = debounce(function (action, filePath) {
		var actions = this.getOption("actions");
		if (actions.indexOf(action) === -1) {
			return;
		}

		if (this._ruleOptions.type === "exec") {
			if (typeof(this._ruleOptions.cmdOrFun) === "function") {
				this._ruleOptions.cmdOrFun(filePath, action);
			} else {
				this._execChild(filePath, action);
			}
		} else if (this._ruleOptions.type === "reload") {
			this._restartChild();
		}
	}.bind(this), this.getOption("debounce"));
	var reglob = function () {
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
		clearInterval(this._reglobInterval);
		this._reglobInterval = null;
		Object.keys(this._watchers).forEach(function (p) {
			this._watchers[p].close();
			delete this._watchers[p];
		}.bind(this));
		this._runState = "stopped";

		if (callback) { return callback(null); }
	}.bind(this);

	if (this._runState === "running") {
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
		terminate(this._childRunning.pid, {
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
			if (callback) { callback(); }
		}.bind(this));
	}
};

Watcher.prototype._execChild = function (filePath, action) {
	var cwd = path.resolve(".")
	var relFile = filePath;
	var file = path.resolve(filePath);
	var relDir = path.dirname(filePath);
	var dir = path.resolve(path.dirname(filePath));
	var cmd = this._ruleOptions.cmdOrFun
		.replace(new RegExp("\\" + this.getOption("execVariablePrefix") + "cwd", "g"), cwd)
		.replace(new RegExp("\\" + this.getOption("execVariablePrefix") + "relfile", "g"), relFile)
		.replace(new RegExp("\\" + this.getOption("execVariablePrefix") + "file", "g"), file)
		.replace(new RegExp("\\" + this.getOption("execVariablePrefix") + "reldir", "g"), relDir)
		.replace(new RegExp("\\" + this.getOption("execVariablePrefix") + "dir", "g"), dir)
		.replace(new RegExp("\\" + this.getOption("execVariablePrefix") + "action", "g"), action);

	this._childRunning = exec(cmd, {
		writeToConsole: this.getOption("writeToConsole"),
		shell: this.getOption("shell"),
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
		this._childRunning = null;
	}.bind(this));
};

Watcher.prototype._runRestartingChild = function () {
	if (this.getOption("debug")) {
		debugLog(chalk.green("Run"), this._ruleOptions.cmdOrFun.toString());
	}

	this._childRunning = exec(this._ruleOptions.cmdOrFun, {
		writeToConsole: this.getOption("writeToConsole"),
		shell: this.getOption("shell"),
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
			this._runRestartingChild();
		}.bind(this));
	} else {
		this._runRestartingChild();
	}
};

module.exports = Watcher;
