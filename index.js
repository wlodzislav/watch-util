var fs = require("fs");
var globby = require("globby");
var underscore = require("underscore");
var child = require('child_process');
var moment = require("moment");
var chalk = require("chalk");
var terminate = require('terminate');

debugLog = function () {
	console.log(moment().format("hh:mm:ss: ") + [].slice.call(arguments).join(" "));
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

function Rule(ruleOptions, watcher) {
	if (!(this instanceof Rule)) { return new Rule(ruleOptions, watcher); }

	this._ruleOptions = ruleOptions || {};
	this._watcher = watcher;
}

Rule.prototype.start = function () {
	if (this._started) {
		throw new Error("Process already started");
	}
	this._watchers = {};

	this._childRunning = null;
	var restart = function () {
		if (this._childRunning) {
			if (this.getOption("debug")) {
				debugLog(chalk.green("Kill"), this._ruleOptions.cmdOrFun.toString().slice(0, 50));
			}
			terminate(this._childRunning.pid, restart);
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
			this._childRunning = null;
			if (code !== null) { // not killed
				if (this.getOption("restartOnSuccess") && code === 0) {
					restart();
				}
				if (this.getOption("restartOnError") && code !== 0) {
					restart();
				}
			}
		}.bind(this));
	}.bind(this);

	var firstTime = true;
	var reglob = function () {
		var paths = globby.sync(preprocessGlobPatters(this._ruleOptions.globPatterns));
		paths.forEach(function (p) {
			if (!this._watchers[p]) {
				var execCallback = underscore.debounce(function (action) {
					if (this._ruleOptions.type === "exec") {
						if (typeof(this._ruleOptions.cmdOrFun) === "function") {
							this._ruleOptions.cmdOrFun(p, action);
						} else {
							this._childRunning = exec(this._ruleOptions.cmdOrFun, {
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
								return execCallback("remove");
							}
						}
						if (action == "rename") {
							setTimeout(rewatch, 0);
						}

						if (this.getOption("mtimeCheck")) {
							if (stat.mtime > mtime) {
								execCallback();
								mtime = stat.mtime;
							}
						} else {
							execCallback(action);
						}
					}.bind(this));
					if (this.getOption("debug")) {
						this._watchers[p].id = this._watcher.watcherId();
						debugLog(chalk.green("Created")+" watcher: path="+chalk.yellow(p)+" id="+this._watchers[p].id);
					}
				}.bind(this);

				rewatch();

				if (!firstTime) {
					execCallback("create");
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

Rule.prototype.getOption = function (name) {
	return [this._ruleOptions[name], this._watcher._globalOptions[name], this._watcher._defaultOptions[name]].find(function (value) {
		return value != null;
	});
};

Rule.prototype.stop = function () {
	if (this._started) {
		if (this._childRunning) {
			terminate(this._childRunning.pid, function () {
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

Rule.prototype.restart = function () {
	this.stop();
	this.start();
};

Rule.prototype.toJSON = function () {
	var ruleOptionsCopy = JSON.parse(JSON.stringify(this._ruleOptions));
	if (typeof(this._ruleOptions.cmdOrFun) === "function") {
		ruleOptionsCopy.cmdOrFun = "<FUNCTION>";
	}
	ruleOptionsCopy.started = this._started;
	ruleOptionsCopy.id = this.id;
	return ruleOptionsCopy;
};

Rule.prototype.delete = function () {
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

function Watcher(globalOptions) {
	if (!(this instanceof Watcher)) { return new Watcher(globalOptions); }

	this._globalOptions = globalOptions || {};
	this._rules = [];

	this._rules.toJSON = rulesToJSON;
	this._ruleId = 0;
	this._watcherId = 0;
}

Watcher.prototype.Rule = Rule;

Watcher.prototype._defaultOptions = {
	debounce: 500, // exec/reload once in ms at max
	reglob: 2000, // perform reglob to watch added files
	//queue: true, // exec calback if it's already executing
	restartOnError: true, // restart if exit code != 0
	restartOnSuccess: false, // restart if exit code == 0
	shell: true, // use this shell for running cmds, or default shell(true)
	//cwd: "path for resolving",
	//persistLog: true, // save logs in files
	//logDir: "./logs",
	//logRotation: "5h", // s,m,h,d,M
	writeToConsole: true, // write logs to console
	mtimeCheck: true,
	debug: false
};

Watcher.prototype.ruleId = function () {
	return this._ruleId++;
}

Watcher.prototype.watcherId = function () {
	return this._watcherId++;
}

Watcher.prototype.getOption = function (name) {
	return [this._globalOptions[name], this._defaultOptions[name]].find(function (value) {
		return value != null;
	});
};

Watcher.prototype.addExecRule = function (globPatterns, ruleOptions, cmdOrFun) {
	if (arguments.length === 2) {
		cmdOrFun = ruleOptions;
		ruleOptions = {};
	}

	ruleOptions.globPatterns = globPatterns;
	ruleOptions.type = "exec";
	ruleOptions.cmdOrFun = cmdOrFun;

	return this.addRule(ruleOptions);
};

Watcher.prototype.addRestartRule = function (globPatterns, ruleOptions, cmd) {
	if (arguments.length === 2) {
		cmd = ruleOptions;
		ruleOptions = {};
	}

	ruleOptions.globPatterns = globPatterns;
	ruleOptions.type = "restart";
	ruleOptions.cmdOrFun = cmd;

	return this.addRule(ruleOptions);
};

Watcher.prototype.addRule = function (ruleOptions) {
	var rule;
	if(ruleOptions instanceof Rule){
		rule = ruleOptions;
		rule._watcher = this;
	}else{
		if (this.getOption("debug")) {
			if (typeof(ruleOptions.cmdOrFun) === "function") {
				var ruleOptionsCopy = JSON.parse(JSON.stringify(ruleOptions));
				ruleOptionsCopy.cmdOrFun = "<FUNCTION>";
			}
			debugLog(chalk.green(".addRule")+"("+JSON.stringify(ruleOptionsCopy || ruleOptions)+")");
		}
		rule = new Rule(ruleOptions, this);
		rule.id = this.ruleId();
	}

	this._rules.push(rule);
	return rule;
};

Watcher.prototype.rules = function () {
	return this._rules;
};

Watcher.prototype.getRuleById = function (id) {
	return this._rules.find(function (rule) {
		return rule.id === id;
	});
};

Watcher.prototype.getRuleByIndex = function (index) {
	return this._rules[index];
};

Watcher.prototype.startById = function (id) {
	var rule = this.getRuleById(id);
	if (!rule) {
		throw { code: "RULE_NOT_FOUND", id: id, message: "Can't start rule with id=" + id + ", there is no such rule" }
	}

	rule.start();
};

Watcher.prototype.restartById = function (id) {
	var rule = this.getRuleById(id);
	if (!rule) {
		throw { code: "RULE_NOT_FOUND", id: id, message: "Can't restart rule with id=" + id + ", there is no such rule" }
	}

	rule.restart();
};

Watcher.prototype.stopById = function (id) {
	var rule = this.getRuleById(id);
	if (!rule) {
		throw { code: "RULE_NOT_FOUND", id: id, message: "Can't stop rule with id=" + id + ", there is no such rule" }
	}

	rule.stop();
};

Watcher.prototype.deleteById = function (id) {
	var rule = this.getRuleById(id);
	if (!rule) {
		throw { code: "RULE_NOT_FOUND", id: id, message: "Can't delete rule with id=" + id + ", there is no such rule" }
	}

	rule.delete();
};

Watcher.prototype.startAll = function () {
	this._rules.forEach(function (rule) {
		rule.start();
	});
};

Watcher.prototype.stopAll = function () {
	this._rules.forEach(function (rule) {
		rule.stop();
	});
};

module.exports = Watcher;
