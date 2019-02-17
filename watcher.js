var fs = require("fs");
var path = require("path");
var stream = require("stream");
var crypto = require("crypto");
var childProcess = require("child_process");
var EventEmitter = require("events");

var minimatch = require("minimatch");
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

function debounceThrottle(fun, debounceDuration, throttleDuration, last) {
	var timeout;
	last = last || 0;

	var debouncer = function() {
		var context = this;
		var args = arguments;

		clearTimeout(timeout);

		var left = Math.max(0, throttleDuration - (Date.now() - last));
		timeout = setTimeout(function () {
			last = Date.now();
			fun.apply(context, args);
		}, Math.max(debounceDuration, left));
	};

	debouncer.cancel = function () {
		clearTimeout(timeout);
	};

	return debouncer;
}

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

function preprocessGlobPatters(patterns) {
	if (!Array.isArray(patterns)) {
		patterns = patterns.split(",");
	}
	var additional = [];
	patterns.forEach(function (p) {
		if (p.startsWith("!") && !p.endsWith("**/*")) {
			if (p.endsWith("/")) {
				additional.push(p+"**/*");
			}
		}
	});
	return patterns.concat(additional);
}

function uniqArrStr(arr) {
	var hash = {};
	arr.forEach(function (p) {
		hash[p] = true;
	});

	return Object.keys(hash);
}

function sequentialGlob(patterns) {
	patterns = preprocessGlobPatters(patterns);
	var result = [];
	patterns.forEach(function (p) {
		if (p.startsWith("!") && !p.startsWith("!(")) {
			var mm = new minimatch.Minimatch(p);
			result = result.filter(function (f) {
				return mm.match(f);
			});
		} else {
			var paths = glob.sync(p);
			[].push.apply(result, paths);
		}
	});

	return uniqArrStr(result);
}

function globsMatcher(patterns) {
	patterns = preprocessGlobPatters(patterns);
	var matchers = patterns.map(function (p) {
		return new minimatch.Minimatch(p);
	});
	return function (f) {
		return matchers.every(function (m) { return m.match(f); })
	};
}

function md5(filePath, callback) {
	var fd = fs.createReadStream(filePath);
	var hash = crypto.createHash("md5");
	hash.setEncoding("hex");

	fd.on("end", function() {
		hash.end();
		callback(null, hash.read());
	});

	fd.on("error", callback);

	fd.pipe(hash);
}

function AlivePassThrough (options) {
	stream.PassThrough.call(this, options);
}

AlivePassThrough.prototype = Object.create(stream.PassThrough.prototype);
AlivePassThrough.prototype.constructor = AlivePassThrough;
AlivePassThrough.prototype.end = function () {};

function RestartRunner(options) {
	this.options = Object.assign({}, this.defaults, options || {});

	if (this.options.stdio) {
		if (this.options.stdio[1] == "pipe") {
			this.stdout = new AlivePassThrough();
		}
		if (this.options.stdio[2] == "pipe") {
			this.stderr = new AlivePassThrough();
		}
	}

	this.isStarted = false;

	this.ee = new EventEmitter();
}

RestartRunner.prototype.defaults = {
	restartOnError: true,
	restartOnSuccess: true,
	stdio: ["ignore", "pipe", "pipe"],
	shell: true,
	kill: {}
};

RestartRunner.prototype.on = function () {
	return this.ee.on.apply(this.ee, arguments);
};

RestartRunner.prototype.once = function () {
	return this.ee.once.apply(this.ee, arguments);
};

RestartRunner.prototype.off = function () {
	return this.ee.off.apply(this.ee, arguments);
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
		shell: this.options.shell,
		stdio: this.options.stdio,
		debug: this.options.debug
	});

	this.process = child;

	if (this.options.stdio) {
		if (this.options.stdio[1] == "pipe") {
			child.stdout.pipe(this.stdout);
		}

		if (this.options.stdio[2] == "pipe") {
			child.stderr.pipe(this.stderr);
		}
	}

	child.on("exit", function (code) {
		this.process = null;

		if (this.options.debug) {
			debug(chalk.red("Exited ") + cmd);
		}

		this.ee.emit("exit", code, cmd);

		if (code != 0) {
			this.ee.emit("crash", code, cmd);
		}

		if (!this.isStarted) {
			return;
		}

		if (this._isRestating) {
			return
		}
		if (this.options.restartOnError && code != 0) {
			if (this.options.debug) {
				debug(chalk.green("Restart") + " on error "+  cmd);
			}
			this.start();
		} else if (this.options.restartOnSuccess && code == 0) {
			if (this.options.debug) {
				debug(chalk.green("Restart") + " on success " + cmd);
			}
			this.start();
		}
	}.bind(this));

	child.on("error", function (err) {
		this.process = null;
		this.ee.emit("error", err, cmd);
		_callback(err);
	}.bind(this));

	child.cmd = cmd;

	if (this.options.debug) {
		debug(chalk.green("Exec ") + "pid=" + child.pid + " " + cmd);
	}

	this.ee.emit("exec", cmd);

	if (child.pid) {
		setImmediate(_callback);
	}
};

RestartRunner.prototype.stop = function (callback) {
	this.isStarted = false;
	this.kill(callback);
};

RestartRunner.prototype.kill = function (callback) {
	callback = callback || function () {};
	if (this.isKilling) {
		return setImmediate(callback);
	}

	if (this.process && this.process.pid) {

		this.isKilling = true;
		this.ee.emit("kill", this.process.cmd);
		var pid = this.process.pid;
		var cmd = this.process.cmd;

		if (this.options.debug) {
			debug(chalk.red("Kill ") + this.process.cmd);
		}

		kill(pid, this.options.kill, function () {
			this.isKilling = false;
			this.ee.emit("kill", cmd);
			this.process = null;
			callback()
		}.bind(this));
	} else {
		setImmediate(callback);
	}
};

RestartRunner.prototype.restart = function (entry, callback) {
	callback = callback || function () {};
	this.ee.emit("restart");
	this._isRestating = true;
	this.kill(function () {
		this._isRestating = false;
		if (this.isStarted) {
			this.start(entry, callback);
		} else {
			setImmediate(callback);
		}
	}.bind(this));
};

function QueueRunner(options) {
	this.options = Object.assign({}, this.defaults, options || {});

	if (this.options.stdio) {
		if (this.options.stdio[1] == "pipe") {
			this.stdout = new AlivePassThrough();
		}
		if (this.options.stdio[2] == "pipe") {
			this.stderr = new AlivePassThrough();
		}
	}

	this.isStarted = false;
	this.processes = [];

	this.ee = new EventEmitter();
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

QueueRunner.prototype.on = function () {
	return this.ee.on.apply(this.ee, arguments);
};

QueueRunner.prototype.once = function () {
	return this.ee.once.apply(this.ee, arguments);
};

QueueRunner.prototype.off = function () {
	return this.ee.off.apply(this.ee, arguments);
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

	var child = exec(cmd, {
		shell: this.options.shell,
		stdio: this.options.stdio,
		debug: this.options.debug
	});

	this.processes.push(child);

	if (this.options.stdio) {
		if (this.options.stdio[1] == "pipe") {
			child.stdout.pipe(this.stdout);
		}

		if (this.options.stdio[2] == "pipe") {
			child.stderr.pipe(this.stderr);
		}
	}

	child.on("exit", function (code) {
		if (this.options.debug) {
			debug(chalk.red("Exited ") + cmd);
		}

		this.ee.emit("exit", code, cmd);

		if (code != 0) {
			this.ee.emit("crash", code, cmd);
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
		this.processes.splice(this.processes.indexOf(child), 1);
		this.ee.emit("error", err);
	}.bind(this));

	child.entry = entry;
	child.cmd = cmd;

	if (this.options.debug) {
		debug(chalk.green("Exec ") + "pid=" + child.pid + " " + cmd);
	}

	this.ee.emit("exec", cmd);

	this.exec();
};

QueueRunner.prototype.stop = function (callback) {
	callback = callback || function () {};
	this.isStarted = false;
	async.each(this.processes, function (c, callback) {
		var cmd = c.cmd;
		if (this.options.debug) {
			debug(chalk.red("Kill ") + c.cmd);
		}

		if (!c.pid) {
			return setInterval(callback);
		}

		kill(c.pid, this.options.kill, function () {
			this.ee.emit("kill", cmd);
			callback();
		}.bind(this));
	}.bind(this), function () {
		callback();
	}.bind(this));
	this.processes = null;
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

	this._ruleOptions = Object.assign({}, this.defaultOptions, options);
	this._ruleOptions.globs = globs;
	this._ruleOptions.cmd = cmd;
	this._ruleOptions.callback = callback;

	if (this._ruleOptions.restart) {
		this._ruleOptions.combineEvents = true;
		if (!options.hasOwnProperty("restartOnError")) {
			this._ruleOptions.restartOnError = true;
		}
		if (!options.hasOwnProperty("restartOnSuccess")) {
			this._ruleOptions.restartOnSuccess = true;
		}
	}

	if (this._ruleOptions.debug && options.kill && !options.kill.hasOwnProperty("debug")) {
		this._ruleOptions.kill.debug = true;
	}

	if (this._ruleOptions.stdio) {
		if (this._ruleOptions.stdio[1] == "pipe") {
			this.stdout = new AlivePassThrough();
		}

		if (this._ruleOptions.stdio[2] == "pipe") {
			this.stderr = new AlivePassThrough();
		}
	}

	this.ee = new EventEmitter();
	this.on = this.ee.on.bind(this.ee);
	this.once = this.ee.once.bind(this.ee);
	this.off = this.ee.off.bind(this.ee);

	this._runState = "stopped";
	this._matcher = globsMatcher(this._ruleOptions.globs);

	this._debouncers = {};
	this._watchers = {};
	this._changed = {};
	this._md5s = {};

	//this._ruleOptions.debug = true;
	//this._ruleOptions.kill.debug = true;
	
}

Watcher.prototype.defaultOptions = {
	debounce: 200, // exec/reload only after no events for N ms
	throttle: 0, // exec/reload no more then once every N ms
	reglob: 50, // perform reglob to watch added files
	restartOnError: false, // restart if exit code != 0
	restartOnSuccess: false, // restart if exit code == 0
	restart: false, // run as persistent process
	events: ["create", "change", "delete"],
	checkMD5: false,
	combineEvents: false, // true - run separate cmd per changed file, false - run single cmd for all changes, default: false
	parallelLimit: 4, // max parallel running cmds in combineEvents == true mode
	shell: true, // run in shell or pass custom shell
	stdio: [null, "ignore", "ignore"],
	maxLogEntries: 100, // max log entries to store for each watcher, Note! entry could be multiline
	writeToConsole: false, // write logs to console
	mtimeCheck: true, // check modified time before firing events
	kill: {},
	deleteCheckInterval: 25, // check if file reappeared
	deleteCheckTimeout: 100, // "debounce" for delete for 2 stage save, when file is renamed and replaced with new one
	debug: false, // debug logging
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

Watcher.prototype.getOption = function (name) {
	if (this._pm) {
		return [this._ruleOptions[name], this._pm._globalOptions[name], this.defaultOptions[name]].find(function (v) {
			return v != null;
		});
	} else {
		return [this._ruleOptions[name], this.defaultOptions[name]].find(function (v) {
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
	this._firstTime = true;

	if (this._ruleOptions.cmd) {
		if (this._ruleOptions.restart) {
			this._restartRunner = new RestartRunner(this._ruleOptions);
			this._restartRunner.options.cmd = this._interpolateCombinedCmd.bind(this);
			this._ruleOptions.callback = function (filePaths) {
				this._restartRunner.restart(filePaths);
			}.bind(this);

			if (this._ruleOptions.stdio) {
				if (this._ruleOptions.stdio[1] == "pipe") {
					this._restartRunner.stdout.pipe(this.stdout);
				}

				if (this._ruleOptions.stdio[2] == "pipe") {
					this._restartRunner.stderr.pipe(this.stderr);
				}
			}

			// HACK: substitute ee to passthrough events
			this._restartRunner.ee = this.ee;

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

			if (this._ruleOptions.stdio) {
				if (this._ruleOptions.stdio[1] == "pipe") {
					this._queueRunner.stdout.pipe(this.stdout);
				}

				if (this._ruleOptions.stdio[2] == "pipe") {
					this._queueRunner.stderr.pipe(this.stderr);
				}
			}

			// HACK: substitute ee to passthrough events
			this._queueRunner.ee = this.ee;

			this._queueRunner.start();
		}
	}

	var last = 0;
	if (this._ruleOptions.restart) {
		last = Date.now();
	}

	if (this._ruleOptions.callback || this.getOption("combineEvents")) {
		this._callbackCombinedDebounced = debounceThrottle(this._callbackCombined.bind(this), this.getOption("debounce"), this.getOption("throttle"), last);
	}


	this._reglob();
	this._debouncers = {};

	this._reglobInterval = setInterval(this._reglob.bind(this), this.getOption("reglob"));

	if (callback) {
		setImmediate(callback);
	} else {
		return this;
	}
};

Watcher.prototype._callbackCombined = function () {
	if (this._runState != "running") {
		return;
	}

	if (this.getOption("debug")) {
		debug(chalk.green("Call") + " callback for " + chalk.yellow(Object.keys(this._changed).join(", ")));
	}

	var filePaths = Object.keys(this._changed);
	if (this._ruleOptions.callback) {
		this._ruleOptions.callback(filePaths);
	}
	this.ee.emit("change", filePaths);
	this.ee.emit("all", filePaths);
	this._changed = {};
}

Watcher.prototype._callbackSingle = function (filePath, action) {
	if (this._runState != "running") {
		return;
	}

	if (this.getOption("debug")) {
		debug(chalk.green("Call") + " callback for path=" + chalk.yellow(filePath) + " action=" + action);
	}

	this._changed[filePath] = null;
	if (this._ruleOptions.callback) {
		this._ruleOptions.callback(filePath, action);
	}
	this.ee.emit(action, filePath);
	this.ee.emit("all", filePath, action);
}

Watcher.prototype._fireEvent = function (filePath, action) {
	if (this._runState != "running") {
		return;
	}

	if (this.getOption("debug")) {
		debug(chalk.green("Fire") + " watcher: path=" + chalk.yellow(filePath) + " action=" + action);
	}

	var events = this.getOption("events");
	if (events.indexOf(action) == -1) {
		return;
	}
	this._changed[filePath] = { action: action, filePath: filePath };

	if (this.restart) {
		this._changed[filePath] = { action: action, filePath: filePath };
		this._callbackCombinedDebounced();
	} else {
		if (this.getOption("combineEvents")) {
			this._callbackCombinedDebounced();
		} else {
			if (!this._debouncers[filePath]) {
				this._debouncers[filePath] = debounceThrottle(function (filePath, action) {
					this._callbackSingle(filePath, action);
				}.bind(this), this.getOption("debounce"), this.getOption("throttle"));
			}
			this._debouncers[filePath](filePath, action);
		}
	}
};


Watcher.prototype._checkDelete = function (p) {
	var interval = setInterval(function () {
		try {
			var stat = fs.statSync(p);
		} catch (err) {}

		if (stat) {
			clearInterval(interval);
			clearTimeout(timeout);
			this._optionalMD5Check(p, function () {
				this._fireEvent(p, "change");
			}.bind(this));
		}
	}.bind(this), this._ruleOptions.deleteCheckInterval);

	var timeout = setTimeout(function () {
		this._fireEvent(p, "delete");
		if (!this._ruleOptions.combineEvents) {
			delete this._debouncers[p];
		}
		clearInterval(interval);
	}.bind(this), this._ruleOptions.deleteCheckTimeout);
};

Watcher.prototype._optionalMD5 = function (fileName, callback) {
	if (this._ruleOptions.checkMD5) {
		md5(fileName, function (err, hash) {
			if (err) {
				this.ee.emit("error", err);
				return callback();
			}
			this._md5s[fileName] = hash;

			if (this.getOption("debug")) {
				debug(chalk.green("MD5") + " for path=" + chalk.yellow(fileName));
			}
			callback();
		}.bind(this));
	} else {
		callback();
	}
};

Watcher.prototype._optionalMD5Check = function (fileName, callback) {
	if (this._ruleOptions.checkMD5) {
		md5(fileName, function (err, hash) {
			if (err) {
				this.ee.emit("error", err);
				return callback();
			}

			if (this.getOption("debug")) {
				debug(chalk.green("Compare MD5") + " for path=" + chalk.yellow(fileName) + " old=" + this._md5s[fileName] + " new=" + hash);
			}

			if (this._md5s[fileName] != hash) {
				this._md5s[fileName] = hash;
				callback();
			}
		}.bind(this));
	} else {
		callback();
	}
};

Watcher.prototype._watchFile = function (p) {
	this._watchers[p] = fs.watch(p, function (action) {
		if (this._runState !== "running") {
			return;
		}

		if (action == "rename") {
			try {
				var stat = fs.statSync(p);
			} catch (err) {
			}

			if (stat) {
				this._optionalMD5Check(p, function () {
					this._fireEvent(p, "change");
				}.bind(this));
			} else {
				this._checkDelete(p);
			}

			if (this.getOption("debug")) {
				debug(chalk.red("Deleted") + " watcher: path=" + chalk.yellow(p));
			}

			this._watchers[p].close();
			delete this._watchers[p];
			// try to rewatch
		} else {
			this._optionalMD5Check(p, function () {
				this._fireEvent(p, "change");
			}.bind(this));
		}
	}.bind(this));

	if (this.getOption("debug")) {
		debug(chalk.green("Created") + " watcher: path=" + chalk.yellow(p));
	}
};

Watcher.prototype._watchDir = function (d) {
	this._watchers[d] = fs.watch(d, function (action, fileName) {
		if (this._runState !== "running") {
			return;
		}

		var filePath = path.join(d, fileName);
		if (this._watchers[filePath]) {
			return;
		}

		if (this._matcher(filePath)) {
			try {
				var stat = fs.statSync(filePath);
			} catch (err) {
			}

			if (stat) {
				this._fireEvent(filePath, "create");
				this._optionalMD5(filePath, function () {
					this._watchFile(filePath);
				}.bind(this));
			}
		}
	}.bind(this));

	if (this.getOption("debug")) {
		debug(chalk.green("Created") + " watcher: path=" + chalk.yellow(d));
	}
};

Watcher.prototype._reglob = function () {
	if (this._runState !== "running") {
		return;
	}

	var paths = sequentialGlob(this._ruleOptions.globs);
	paths.forEach(function (p) {
		if (this._watchers[p]) {
			return;
		}

		this._optionalMD5(p, function () {
			this._watchFile(p);
		}.bind(this));

		if (!this._firstTime) {
			this._fireEvent(p, "create");
		}
	}.bind(this));
	
	var dirs = paths.map(function (p) { return path.dirname(p); });
	dirs.forEach(function (d) {
		if (this._watchers[d]) {
			return;
		}

		this._watchDir(d);
	}.bind(this));

	/*
	var pathsToDelete = Object.keys(this._watchers).filter(function (p) {
		return paths.indexOf(p) == -1 && dirs.indexOf(p) == -1;
	})

	pathsToDelete.forEach(function (p) {
		this._watchers[p].close();
		delete this._watchers[p];

		if (this.getOption("debug")) {
			debug(chalk.red("Deleted") + " watcher: path=" + chalk.yellow(p));
		}
	}.bind(this));
	*/

	this._firstTime = false;
};

Watcher.prototype.stop = function (callback) {
	var _callback = function () {
		if (this.getOption("debug")) {
			debug(chalk.green("Stoped") + " watcher");
		}
		if (callback) {
			callback();
		}
	}.bind(this);
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

	if (this._restartRunner) {
		this._restartRunner.stop(_callback);
	} else if (this._queueRunner) {
		this._queueRunner.stop(_callback);
	} else {
		setImmediate(_callback);
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
