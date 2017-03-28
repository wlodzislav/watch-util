var fs = require("fs");
var path = require("path");
var globby = require("globby");
var underscore = require("underscore");
var child = require('child_process');
var moment = require("moment");
var chalk = require("chalk");
var terminate = require('terminate');

debugLog = function () {
	console.log(moment().format("hh:mm:ss: ") + [].slice.call(arguments).join(" "));
}

function shallowCopyObj(obj) {
	var copy = {};
	for (var key in obj) {
		copy[key] = obj[key];
	}
	return copy;
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
	if (options.shell === true) {
		if (process.platform === 'win32') {
			if (isShAvailableOnWin === undefined) {
				isShAvailableOnWin = checkShAvailableOnWin();
				if (isShAvailableOnWin && options.debug) {
					debugLog("Will use " + chalk.yellow("'C:\\\\bin\\\\sh.exe'") + " as default shell.");
				}
			}

			if (isShAvailableOnWin) {
				var childRunning = child.spawn("/bin/sh", ["-c", cmd], { stdio: options.writeToConsole ? "inherit" : null });
			} else {
				var childRunning = child.spawn(cmd, { shell: true, stdio: options.writeToConsole ? "inherit" : null });
			}
		} else {
			var childRunning = child.spawn(cmd, { shell: true, stdio: options.writeToConsole ? "inherit" : null });
		}
	} else if (typeof(options.shell) === "string") {
		var shellExecutable = options.shell.split(" ")[0];
		var childRunning = child.spawn(shellExecutable, options.shell.split(" ").slice(1).concat([cmd]), { stdio: options.writeToConsole ? "inherit" : null });
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

var _ruleId = 0;
function ruleId() {
	return _ruleId++;
}

var _watcherId = 0;
function watcherId() {
	return _watcherId++;
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
		ruleOptions.globPatterns = arguments[0];
		ruleOptions.cmdOrFun = arguments[1];
	} else {
		ruleOptions = shallowCopyObj(ruleOptions);
		ruleOptions.globPatterns = globs;
		ruleOptions.cmdOrFun = cmdOrFun;
	}

	this._ruleOptions = ruleOptions;
	if (!this._ruleOptions.type) {
		this._ruleOptions.type = "restart";
	}
}

Watcher.prototype.start = function () {
	if (this._started) {
		throw new Error("Process already started");
	}
	this._watchers = {};

	this._childRunning = null;
	var restart = function (err) {
		if(err && this._childRunning){
			debugLog(chalk.red("Terminating error:"), err.message);
			debugLog(chalk.green("Kill"), this._ruleOptions.cmdOrFun.toString().slice(0, 50));
			this._childRunning.kill(this.getOption("killSignal"));

			return restart();
		}

		if (this._childRunning) {
			if (this.getOption("debug")) {
				debugLog(chalk.green("Terminate"), this._ruleOptions.cmdOrFun.toString().slice(0, 50));
			}
			terminate(this._childRunning.pid, { pollInterval: this.getOption("terminatePollInterval"), timeout: this.getOption("terminateTimeout") }, restart);
			return;
		}
		if (this.getOption("debug")) {
			debugLog(chalk.green("Restart"), this._ruleOptions.cmdOrFun.toString());
		}
		this._childRunning = exec(this._ruleOptions.cmdOrFun, {
			writeToConsole: this.getOption("writeToConsole"),
			shell: this.getOption("shell"),
			debug: this.getOption("debug")
		});
		this._childRunning.on("exit", function (code) {
			if (!this._childRunning.killed) { // not killed
				this._childRunning = null;
				if (this.getOption("restartOnSuccess") && code === 0) {
					restart();
				}
				if (this.getOption("restartOnError") && code !== 0) {
					restart();
				}
			} else {
				this._childRunning = null;
			}
		}.bind(this));
	}.bind(this);

	var firstTime = true;
	var reglob = function () {
		var paths = globby.sync(preprocessGlobPatters(this._ruleOptions.globPatterns));
		paths.forEach(function (p) {
			if (!this._watchers[p]) {
				var execCallback = underscore.debounce(function (action, filePath) {
					if (this._ruleOptions.type === "exec") {
						if (typeof(this._ruleOptions.cmdOrFun) === "function") {
							this._ruleOptions.cmdOrFun(p, action);
						} else {
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
							this._childRunning.on("exit", function () {
								this._childRunning = null;
							}.bind(this));
						}
					} else if (this._ruleOptions.type === "restart") {
						restart();
					}
				}.bind(this), this.getOption("debounce"));

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
								return execCallback("remove", p);
							}
						}
						if (action == "rename") {
							setTimeout(rewatch, 0);
						}

						if (this.getOption("mtimeCheck")) {
							if (stat.mtime > mtime) {
								execCallback(action, p);
								mtime = stat.mtime;
							}
						} else {
							execCallback(action, p);
						}
					}.bind(this));
					if (this.getOption("debug")) {
						this._watchers[p].id = watcherId();
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
				this._watchers[p].close();
				delete this._watchers[p];
			}
		}.bind(this));

		if (firstTime && this._ruleOptions.type === "restart") {
			restart();
		}
		firstTime = false;
	}.bind(this);

	reglob();

	this._started = true;
	this._reglobInterval = setInterval(reglob, this.getOption("reglob"));
	return this;
};

Watcher.prototype.options = function () {
	return this._ruleOptions;
}

Watcher.prototype.getOption = function (name) {
	if (this._watcher) {
		return [this._ruleOptions[name], this._watcher._globalOptions[name], defaultOptions[name]].find(function (v) {
			return v != null;
		});
	} else {
		return [this._ruleOptions[name], defaultOptions[name]].find(function (v) {
			return v != null;
		});
	}
};

Watcher.prototype.stop = function () {
	if (this._started) {
		if (this._childRunning) {
			terminate(this._childRunning.pid, { pollInterval: this.getOption("terminatePollInterval"), timeout: this.getOption("terminateTimeout") }, function () {
				this._childRunning = null;
			});
		}
		clearInterval(this._reglobInterval);
		this._reglobInterval = null;
		Object.keys(this._watchers).forEach(function (p) {
			this._watchers[p].close();
			delete this._watchers[p];
		}.bind(this));
		this._started = false;
	}
};

Watcher.prototype.restart = function () {
	this.stop();
	this.start();
};

Watcher.prototype.toJSON = function () {
	var ruleOptionsCopy = JSON.parse(JSON.stringify(this._ruleOptions));
	if (typeof(this._ruleOptions.cmdOrFun) === "function") {
		ruleOptionsCopy.cmdOrFun = "<FUNCTION>";
	}
	ruleOptionsCopy.started = this._started;
	ruleOptionsCopy.id = this.id;
	return ruleOptionsCopy;
};

Watcher.prototype.delete = function () {
	this.stop();
	var index = this._watcher._rules.indexOf(this);
	this._watcher._rules.splice(index, 1);
	if (this.getOption("debug")) {
		debugLog(chalk.green("Delete rule"), "index="+index);
	}
};

function rulesToJSON() {
	return this.map(function (r) {
		return r.toJSON();
	});
}

function PM(globalOptions) {
	if (!(this instanceof PM)) { return new PM(globalOptions); }

	this._globalOptions = globalOptions || {};
	this._rules = [];

	this._rules.toJSON = rulesToJSON;
	this._ruleId = 0;
	this._watcherId = 0;
}

var defaultOptions = {
	debounce: 500, // exec/reload once in ms at max
	reglob: 2000, // perform reglob to watch added files
	//queue: true, // exec calback if it's already executing
	restartOnError: false, // restart if exit code != 0
	restartOnSuccess: false, // restart if exit code == 0
	shell: true, // use this shell for running cmds, or default shell(true)
	//cwd: "path for resolving",
	//persistLog: true, // save logs in files
	//logDir: "./logs",
	//logRotation: "5h", // s,m,h,d,M
	killSignal: "SIGTERM", // used if package terminate will return error
	writeToConsole: true, // write logs to console
	mtimeCheck: true,
	debug: false,
	terminatePollInterval: 200,
	terminateTimeout: 2000,
	execVariablePrefix: "$"
};

PM.prototype.getOption = function (name) {
	return [this._globalOptions[name], defaultOptions[name]].find(function (v) {
		return v != null;
	});
};

PM.prototype.addExecRule = function (globPatterns, ruleOptions, cmdOrFun) {
	if (arguments.length === 2) {
		cmdOrFun = arguments[1];
		ruleOptions = {};
	}

	ruleOptions.globPatterns = globPatterns;
	ruleOptions.type = "exec";
	ruleOptions.cmdOrFun = cmdOrFun;

	return this.addRule(ruleOptions);
};

PM.prototype.addRestartRule = function (globPatterns, ruleOptions, cmd) {
	if (arguments.length === 2) {
		cmd = arguments[1];
		ruleOptions = {};
	}

	ruleOptions.globPatterns = globPatterns;
	ruleOptions.type = "restart";
	ruleOptions.cmdOrFun = cmd;

	return this.addRule(ruleOptions);
};

PM.prototype.addRule = function (globs, ruleOptions, cmdOrFun) {
	var rule;
	if(ruleOptions instanceof Watcher){
		rule = arguments[0];
	}else{
		rule = Watcher.apply(null, arguments);
		if (this.getOption("debug")) {
			if (typeof(rule.options().cmdOrFun) === "function") {
				var ruleOptionsCopy = JSON.parse(JSON.stringify(rule.options()));
				ruleOptionsCopy.cmdOrFun = "<FUNCTION>";
			}
			debugLog(chalk.green(".addRule")+"("+JSON.stringify(ruleOptionsCopy || ruleOptions)+")");
		}
		rule.id = ruleId();
	}

	rule._watcher = this;
	this._rules.push(rule);
	return rule;
};

PM.prototype.rules = function () {
	return this._rules;
};

PM.prototype.getRuleById = function (id) {
	return this._rules.find(function (rule) {
		return rule.id === id;
	});
};

PM.prototype.getRuleByIndex = function (index) {
	return this._rules[index];
};

PM.prototype.startById = function (id) {
	var rule = this.getRuleById(id);
	if (!rule) {
		throw { code: "RULE_NOT_FOUND", id: id, message: "Can't start rule with id=" + id + ", there is no such rule" }
	}

	rule.start();
};

PM.prototype.restartById = function (id) {
	var rule = this.getRuleById(id);
	if (!rule) {
		throw { code: "RULE_NOT_FOUND", id: id, message: "Can't restart rule with id=" + id + ", there is no such rule" }
	}

	rule.restart();
};

PM.prototype.stopById = function (id) {
	var rule = this.getRuleById(id);
	if (!rule) {
		throw { code: "RULE_NOT_FOUND", id: id, message: "Can't stop rule with id=" + id + ", there is no such rule" }
	}

	rule.stop();
};

PM.prototype.deleteById = function (id) {
	var rule = this.getRuleById(id);
	if (!rule) {
		throw { code: "RULE_NOT_FOUND", id: id, message: "Can't delete rule with id=" + id + ", there is no such rule" }
	}

	rule.delete();
};

PM.prototype.startAll = function () {
	this._rules.forEach(function (rule) {
		rule.start();
	});
};

PM.prototype.stopAll = function () {
	this._rules.forEach(function (rule) {
		rule.stop();
	});
};

module.exports.PM = PM;
module.exports.Watcher = Watcher;
