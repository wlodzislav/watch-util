var assert = require("assert");
var fs = require("fs");
var path = require("path");
var EventEmitter = require("events");

var touch = require("touch");
var rimraf = require("rimraf");

var watch = require("../");

function opts(options) {
	return Object.assign({}, defaultOptions, options || {});
}

var callbackArguments = [];
var _callback;
var callback = function () {
	if (_callback) {
		_callback.apply(null, arguments);
	} else {
		callbackArguments.push(arguments);
	}
};

function expectCallback() {
	if (arguments.length == 3) {
		var filePath = arguments[0];
		var event = arguments[1];
		var callback = arguments[2];
		_callback = function (f, e) {
			try {
				assert.equal(f, filePath);
				assert.equal(e, event);
			} catch (err) {
				console.error("Got callback arguments");
				console.dir(arguments);
				throw err;
			}
			_callback = null;
			callback();
		}
	} else {
		var filePaths = arguments[0];
		var callback = arguments[1];
		_callback = function (f) {
			assert.deepEqual(f, filePaths);
			_callback = null;
			callback();
		}
	}
	if (callbackArguments.length) {
		var args = callbackArguments.shift();
		_callback.apply(null, args);
	}
}

function expectNoCallback(delay, callback) {
	var timeout = setTimeout(function () {
		clearTimeout(timeout);
		_callback = null;
		callback();
	}, delay);

	_callback = function (f, e) {
		clearTimeout(timeout);
		_callback = null;
		throw new Error("Callback is called with arguments " + [].join.call(arguments, ", "));
	};
	if (callbackArguments.length) {
		clearTimeout(timeout);
		var args = callbackArguments.shift();
		_callback.apply(null, args);
	}
};

function create(f) {
	fs.writeFileSync(f, "", "utf8");
}

function change(f) {
	fs.writeFileSync(f, "" + Math.random(), "utf8");
}

function rm(f) {
	rimraf.sync(f);
}

function CMDHelper() {
	this._events = [];
	this.tmp = path.join("temp", "log-" + Date.now());
	var tmp = this.tmp;
	this.clean();
	this.start();
}

CMDHelper.prototype.cmd = function (args) {
	return "node " + path.join(__dirname, "test-helper.js") + " --event %event %cwd --rel-file %relFile --file %file --rel-dir %relDir --dir %dir "
		+ args
		+ " --log " + this.tmp
		+ " -- %relFiles -- %files";
}

CMDHelper.prototype.expectEvent = function () {
	var args = arguments;
	if (arguments.length == 3) {
		var event = arguments[0];
		var options = arguments[1];
		var callback = arguments[2];
	} else {
		var event = arguments[0];
		var options = {};
		var callback = arguments[1];
	}
	this._callback = function (e) {
		var copy = {};
		for (var key in options) {
			copy[key] = e.data[key];
		}
		try {
			assert.deepEqual(e.event, event);
			assert.deepEqual(copy, options);
		} catch (err) {
			console.error("Got event");
			console.dir(e);
			throw err;
		}
		this._callback = null;
		callback();
	}.bind(this);
	if (this._events.length) {
		var e = this._events.shift();
		this._callback(e);
	}
}

CMDHelper.prototype.expectNoEvents = function (delay, callback) {
	var timeout = setTimeout(function () {
		clearTimeout(timeout);
		this._callback = null;
		callback();
	}.bind(this), delay);

	this._callback = function (e) {
		clearTimeout(timeout);
		this._callback = null;
		throw new Error("Expect no events but received " + JSON.stringify(e));
	}.bind(this);
	if (this._events.length) {
		clearTimeout(timeout);
		var e = this._events.shift();
		this._callback(e);
	}
}

CMDHelper.prototype.start = function () {
	this._nextLogLineIndex = 0;
	this._pollInterval = setInterval(function () {
		try {
			var content = fs.readFileSync(this.tmp, "utf8")
			var lines = content.split("\n");
			lines.slice(this._nextLogLineIndex).filter(Boolean).forEach(function (raw) {
				var entry = JSON.parse(raw);
				if (entry.event == "crash") {
					throw new Error("Helper crashed");
				}
				this._nextLogLineIndex += 1;
				if (this._callback) {
					this._callback(entry);
				} else {
					this._events.push(entry);
				}
			}.bind(this));
		} catch (err) {
			if (err.code != "ENOENT") {
				throw err;
			}
		}
	}.bind(this), 50);
};

CMDHelper.prototype.clean = function () {
	clearInterval(this._pollInterval);
	try {
		fs.unlinkSync(this.tmp);
	} catch (err) {}
};

function killBash(name) {
	if (process.platform != "win32") {
		try {
			var pids = childProcess.execSync("ps -A -o pid,command | grep " + name + " | grep -v grep | awk '{print $1}'", { shell: true, encoding: "utf8" });
			if (pids.length) {
				childProcess.execSync("kill " + pids.split("\n").join(" "), { shell: true, encoding: "utf8" })
			}
		} catch (err) {
		}
	}
}

var watcherStartDelay = 200;

describe("Watching", function () {
	var w;

	beforeEach(function () {
		rimraf.sync("temp");
		fs.mkdirSync("temp");
	});

	afterEach(function (done) {
		rimraf.sync("temp");
		w.stop(done);
	});

	it("negate globs", function (done) {
		w = watch.exec(["temp/a", "!temp/b"], { combineEvents: false }, callback);

		create("temp/a");
		create("temp/b");
		w.start(function () {
			setTimeout(function () {
				change("temp/a");
				change("temp/b");
				expectCallback("temp/a", "change", function () {
					expectNoCallback(500, done);
				});
			}, watcherStartDelay);
		});
	});

	it("globs apply sequentially", function (done) {
		w = watch.exec(["temp/*", "!temp/a*", "temp/a1"], { combineEvents: false }, callback);

		create("temp/a1");
		create("temp/a2");
		w.start(function () {
			setTimeout(function () {
				create("temp/a1");
				create("temp/a2");
				expectCallback("temp/a1", "change", function () {
					expectNoCallback(500, done);
				});
			}, watcherStartDelay);
		});
	});

	it("handle create", function (done) {
		w = watch.exec(["temp/a"], { combineEvents: false }, callback);

		w.start(function () {
			setTimeout(function () {
				create("temp/a");
				expectCallback("temp/a", "create", done);
			}, watcherStartDelay);
		});
	});

	it("watch dirs to handle create", function (done) {
		w = watch.exec(["temp/*"], { reglob: 10000, combineEvents: false }, callback);

		create("temp/a");
		w.start(function () {
			setTimeout(function () {
				create("temp/b");
				expectCallback("temp/b", "create", done);
			}, watcherStartDelay);
		});
	});

	it("handle change", function (done) {
		w = watch.exec(["temp/a"], { combineEvents: false }, callback);

		create("temp/a");
		w.start(function () {
			setTimeout(function () {
				change("temp/a");
				expectCallback("temp/a", "change", done);
			}, watcherStartDelay);
		});
	});

	it("handle delete", function (done) {
		w = watch.exec(["temp/a"], { combineEvents: false }, callback);

		create("temp/a");
		w.start(function () {
			setTimeout(function () {
				rm("temp/a");
				expectCallback("temp/a", "delete", done);
			}, watcherStartDelay);
		});
	});

	it("handle delete parent dir", function (done) {
		w = watch.exec(["temp/a"], { combineEvents: false }, callback);

		create("temp/a");
		w.start(function () {
			setTimeout(function () {
				rm("temp");
				expectCallback("temp/a", "delete", done);
			}, watcherStartDelay);
		});
	});

	it("handle rename", function (done) {
		w = watch.exec(["temp/a", "temp/b"], { combineEvents: false }, callback);

		create("temp/a");
		w.start(function () {
			setTimeout(function () {
				fs.renameSync("temp/a", "temp/b");
				expectCallback("temp/a", "delete", function () {
					expectCallback("temp/b", "create", done);
				});
			}, watcherStartDelay);
		});
	});

	it(".events", function (done) {
		w = watch.exec(["temp/a"], { events: ["create", "change"], combineEvents: false }, callback);

		w.start(function () {
			setTimeout(function () {
				create("temp/a");
				expectCallback("temp/a", "create", function () {
					change("temp/a");
					expectCallback("temp/a", "change", function () {
						rm("temp/a");
						expectNoCallback(500, done);
					});
				});
			}, watcherStartDelay);
		});
	});


	it(".combineEvents same file", function (done) {
		w = watch.exec(["temp/a"], { debounce: 1000, combineEvents: true }, callback);

		create("temp/a");
		w.start(function () {
			setTimeout(function () {
				change("temp/a");
				delete("temp/a");
				expectCallback(["temp/a"], done);
			}, watcherStartDelay);
		});
	});

	it(".combineEvents multiple files", function (done) {
		w = watch.exec(["temp/a", "temp/b"], { debounce: 1000, combineEvents: true }, callback);

		create("temp/a");
		create("temp/b");
		w.start(function () {
			setTimeout(function () {
				change("temp/a");
				change("temp/b");
				expectCallback(["temp/a", "temp/b"], done);
			}, watcherStartDelay);
		});
	});

	it(".combineEvents == true + .debounce", function (done) {
		w = watch.exec(["temp/a", "temp/b"], { debounce: 1000, combineEvents: true }, callback);

		create("temp/a");
		create("temp/b");
		w.start(function () {
			setTimeout(function () {
				change("temp/a");
				change("temp/b");
				setTimeout(function () {
					change("temp/b");
				}, 1100);
				expectCallback(["temp/a", "temp/b"], function () {
					expectCallback(["temp/b"], done);
				});
			}, watcherStartDelay);
		});
	});

	it(".combineEvents == false + .debounce", function (done) {
		w = watch.exec(["temp/a", "temp/b"], { debounce: 1000, combineEvents: false }, callback);

		create("temp/a");
		create("temp/b");
		w.start(function () {
			setTimeout(function () {
				change("temp/a");
				change("temp/b");
				setTimeout(function () {
					change("temp/a");
				}, 500);
				setTimeout(function () {
					change("temp/b");
				}, 1100);
				expectCallback("temp/b", "change", function () {
					expectCallback("temp/a", "change", function () {
						expectCallback("temp/b", "change", done);
					});
				});
			}, watcherStartDelay);
		});
	});

	it("dont't fire debounced combined callback after .stop()", function (done) {
		w = watch.exec(["temp/a"], { debounce: 1000, combineEvents: true }, callback);

		create("temp/a");
		w.start(function () {
			setTimeout(function () {
				change("temp/a");
				setTimeout(function () {
					w.stop();
					expectNoCallback(500, done);
				}, 500);
			}, watcherStartDelay);
		});
	});

	it("dont't fire debounced separate callback after .stop()", function (done) {
		w = watch.exec(["temp/a"], { debounce: 1000, combineEvents: false }, callback);

		create("temp/a");
		w.start(function () {
			setTimeout(function () {
				change("temp/a");
				setTimeout(function () {
					w.stop();
					expectNoCallback(500, done);
				}, 500);
			}, watcherStartDelay);
		});
	});

	it(".reglob", function (done) {
		w = watch.exec(["temp/a"], { reglob: 10000, combineEvents: false }, callback);

		w.start(function () {
			setTimeout(function () {
				create("temp/a");
				expectNoCallback(500, done);
			}, watcherStartDelay);
		});
	});

	it(".checkMD5 == true, no change", function (done) {
		w = watch.exec(["temp/a"], { checkMD5: true, combineEvents: false }, callback);

		create("temp/a");
		w.start(function () {
			setTimeout(function () {
				fs.writeFileSync("temp/a", "", "utf8");
				expectNoCallback(500, done);
			}, watcherStartDelay);
		});
	});

	it(".checkMD5 == true, change", function (done) {
		w = watch.exec(["temp/a"], { checkMD5: true, combineEvents: false }, callback);

		create("temp/a");
		w.start(function () {
			setTimeout(function () {
				fs.writeFileSync("temp/a", "abc", "utf8");
				expectCallback("temp/a", "change", done);
			}, watcherStartDelay);
		});
	});

	it(".checkMD5 == false", function (done) {
		w = watch.exec(["temp/a"], { checkMD5: false, combineEvents: false }, callback);

		create("temp/a");
		w.start(function () {
			setTimeout(function () {
				change("temp/a");
				expectCallback("temp/a", "change", done);
			}, watcherStartDelay);
		});
	});

	it(".checkMtime == true, no change", function (done) {
		w = watch.exec(["temp/a"], { checkMtime: true, combineEvents: false }, callback);

		create("temp/a");
		touch.sync("temp/a"); // node-touch can't set sub-ms mtime on mac, overwrite with rounded ms
		var stat1 = fs.statSync("temp/a");
		w.start(function () {
			setTimeout(function () {
				touch.sync("temp/a");
				var stat2 = fs.statSync("temp/a");
				assert.equal(stat2.mtimeMs, stat1.mtimeMs);
				expectNoCallback(500, done);
			}, watcherStartDelay);
		});
	});

	it(".checkMtime == true, change", function (done) {
		w = watch.exec(["temp/a"], { checkMtime: true, combineEvents: false }, callback);

		create("temp/a");
		touch.sync("temp/a");
		var start = Date.now();
		var stat1 = fs.statSync("temp/a");
		w.start(function () {
			setTimeout(function () {
				fs.writeFileSync("temp/a", "", "utf8");
				var stat2 = fs.statSync("temp/a");
				expectCallback("temp/a", "change", done);
			}, watcherStartDelay);
		});
	});

	it(".checkMtime == false", function (done) {
		w = watch.exec(["temp/a"], { checkMtime: false, combineEvents: false }, callback);

		create("temp/a");
		touch.sync("temp/a");
		var stat1 = fs.statSync("temp/a");
		w.start(function () {
			setTimeout(function () {
				touch.sync("temp/a");
				var stat2 = fs.statSync("temp/a");
				assert.equal(stat2.mtimeMs, stat1.mtimeMs);
				expectCallback("temp/a", "change", done);
			}, watcherStartDelay);
		});
	});
});

describe("Running", function () {
	var w, helper;

	beforeEach(function () {
		rimraf.sync("temp");
		fs.mkdirSync("temp");
		helper = new CMDHelper();
	});

	afterEach(function (done) {
		rimraf.sync("temp");
		w.stop(function () {
			helper.clean();
			killBash("test-helper.js");
			done();
		});
	});

	it("run cmd", function (done) {
		w = watch.exec(["temp/a"], { combineEvents: false }, helper.cmd());

		create("temp/a");
		w.start(function () {
			setTimeout(function () {
				change("temp/a");
				helper.expectEvent("run", done);
			}, watcherStartDelay);
		});
	});

	it("kill cmd in .stop()", function (done) {
		w = watch.exec(["temp/a"], { combineEvents: false }, helper.cmd("--stay-alive"));

		create("temp/a");
		w.start(function () {
			setTimeout(function () {
				change("temp/a");
				helper.expectEvent("run", function () {
					w.stop();
					helper.expectEvent("killed", function () {
						helper.expectNoEvents(1000, done);
					});
				});
			}, watcherStartDelay);
		});
	});

	it("kill cmd in .stop() + .combineEvents = true", function (done) {
		w = watch.exec(["temp/a"], { combineEvents: true }, helper.cmd("--stay-alive"));

		create("temp/a");
		w.start(function () {
			setTimeout(function () {
				change("temp/a");
				helper.expectEvent("run", function () {
					w.stop();
					helper.expectEvent("killed", function () {
						helper.expectNoEvents(1000, done);
					});
				});
			}, watcherStartDelay);
		});
	});

	it("don't restart debounced cmd in .stop()", function (done) {
		w = watch.exec(["temp/a"], { combineEvents: false, debounce: 1000 }, helper.cmd());

		create("temp/a");
		w.start(function () {
			setTimeout(function () {
				change("temp/a");
				helper.expectEvent("run", function () {
					change("temp/a");
					setTimeout(function () {
						w.stop();
						helper.expectEvent("exit", function () {
							helper.expectNoEvents(1000, done);
						});
					}, 500);
				});
			}, watcherStartDelay);
		});
	});

	it("don't restart debounced cmd in .stop() + .combineEvents = true", function (done) {
		w = watch.exec(["temp/a"], { combineEvents: true, debounce: 1000 }, helper.cmd());

		create("temp/a");
		w.start(function () {
			setTimeout(function () {
				change("temp/a");
				helper.expectEvent("run", function () {
					change("temp/a");
					setTimeout(function () {
						w.stop();
						helper.expectEvent("exit", function () {
							helper.expectNoEvents(1000, done);
						});
					}, 500);
				});
			}, watcherStartDelay);
		});
	});

	it(".restartOnError == true, exec", function (done) {
		w = watch.exec(["temp/a"], { restartOnError: true, combineEvents: false }, helper.cmd("--exit 1 --delay 200"));

		create("temp/a");
		w.start(function () {
			setTimeout(function () {
				change("temp/a");
				helper.expectEvent("run", function () {
					helper.expectEvent("exit", function () {
						helper.expectEvent("run", done);
					});
				});
			}, watcherStartDelay);
		});
	});

	it(".restartOnError == true + .combineEvents == true, exec", function (done) {
		w = watch.exec(["temp/a"], { restartOnError: true, combineEvents: true }, helper.cmd("--exit 1 --delay 200"));

		create("temp/a");
		w.start(function () {
			setTimeout(function () {
				change("temp/a");
				helper.expectEvent("run", function () {
					helper.expectEvent("exit", function () {
						helper.expectEvent("run", done);
					});
				});
			}, watcherStartDelay);
		});
	});

	it("kill in .stop + .restartOnError == true, exec", function (done) {
		w = watch.exec(["temp/a"], { restartOnError: true, combineEvents: false }, helper.cmd("--exit 1 --delay 500"));

		create("temp/a");
		w.start(function () {
			setTimeout(function () {
				change("temp/a");
				helper.expectEvent("run", function () {
					helper.expectEvent("exit", function () {
						helper.expectEvent("run", function () {
							w.stop();
							helper.expectEvent("killed", function () {
								helper.expectNoEvents(1000, done);
							});
						});
					});
				});
			}, watcherStartDelay);
		});
	});


	it(".restartOnError == false, exec", function (done) {
		w = watch.exec(["temp/a"], { restartOnError: false, combineEvents: false }, helper.cmd("--exit 1"));

		create("temp/a");
		w.start(function () {
			setTimeout(function () {
				change("temp/a");
				helper.expectEvent("run", function () {
					helper.expectEvent("exit", function () {
						helper.expectNoEvents(500, done);
					});
				});
			}, watcherStartDelay);
		});
	});

	it(".restartOnSuccess == true, restart", function (done) {
		w = watch.restart(["temp/a"], { restartOnSuccess: true, combineEvents: false }, helper.cmd("--exit 0 --delay 200"));

		create("temp/a");
		w.start(function () {
			setTimeout(function () {
				helper.expectEvent("run", function () {
					helper.expectEvent("exit", function () {
						helper.expectEvent("run", done);
					});
				});
			}, watcherStartDelay);
		});
	});

	it(".restartOnSuccess == false, restart", function (done) {
		w = watch.restart(["temp/a"], { restartOnSuccess: false, combineEvents: false }, helper.cmd("--exit 0"));

		w.start(function () {
			setTimeout(function () {
				helper.expectEvent("run", function () {
					helper.expectEvent("exit", function () {
						helper.expectNoEvents(500, done);
					});
				});
			}, watcherStartDelay);
		});
	});

	it(".restart, run cmd immediately", function (done) {
		w = watch.restart(["temp/a"], { combineEvents: false }, helper.cmd("--stay-alive"));

		w.start(function () {
			helper.expectEvent("run", done);
		});
	});

	it(".restart, restart on event", function (done) {
		w = watch.restart(["temp/a"], { combineEvents: false }, helper.cmd("--stay-alive"));

		create("temp/a");
		w.start(function () {
			setTimeout(function () {
				helper.expectEvent("run", function () {
					change("temp/a");
					helper.expectEvent("killed", function () {
						helper.expectEvent("run", function () {
							helper.expectNoEvents(500, done);
						});
					});
				});
			}, watcherStartDelay);
		});
	});

	it(".exec, don't run cmd", function (done) {
		w = watch.exec(["temp/a"], { combineEvents: false }, helper.cmd("--stay-alive"));

		w.start(function () {
			helper.expectNoEvents(500, done);
		});
	});

	it("don't kill .waitDone == true + .combineEvents == true", function (done) {
		w = watch.exec(["temp/a"], { waitDone: true, combineEvents: true }, helper.cmd("--stay-alive"));

		create("temp/a");
		w.start(function () {
			setTimeout(function () {
				change("temp/a");
				helper.expectEvent("run", function () {
					change("temp/a");
					helper.expectNoEvents(500, done);
				});
			}, watcherStartDelay);
		});
	});

	it("don't kill .waitDone == true + .combineEvents == false", function (done) {
		w = watch.exec(["temp/a", "temp/b"], { waitDone: true, combineEvents: false }, helper.cmd("--stay-alive"));

		create("temp/a");
		create("temp/b");
		w.start(function () {
			setTimeout(function () {
				change("temp/a");
				change("temp/b");
				helper.expectEvent("run", function () {
					helper.expectEvent("run", function () {
						change("temp/a");
						change("temp/b");
						helper.expectNoEvents(500, done);
					});
				});
			}, watcherStartDelay);
		});
	});

	it("run 2 time .waitDone == true + .combineEvents == true", function (done) {
		w = watch.exec(["temp/a"], { waitDone: true, combineEvents: true }, helper.cmd("--delay 500"));

		create("temp/a");
		w.start(function () {
			setTimeout(function () {
				change("temp/a");
				helper.expectEvent("run", function () {
					change("temp/a");
					helper.expectEvent("exit", function () {
						helper.expectEvent("run", done);
					});
				});
			}, watcherStartDelay);
		});
	});

	it("run 2 time .waitDone == true + .combineEvents == false", function (done) {
		w = watch.exec(["temp/a", "temp/b"], { waitDone: true, combineEvents: false }, helper.cmd("--delay 500"));

		create("temp/a");
		create("temp/b");
		w.start(function () {
			setTimeout(function () {
				change("temp/a");
				change("temp/b");
				helper.expectEvent("run", function () {
					helper.expectEvent("run", function () {
						change("temp/a");
						change("temp/b");
						helper.expectEvent("exit", function () {
							helper.expectEvent("exit", function () {
								helper.expectEvent("run", function () {
									helper.expectEvent("run", done);
								});
							});
						});
					});
				});
			}, watcherStartDelay);
		});
	});

	it(".waitDone == true + .combineEvents == true combine events in long queue", function (done) {
		w = watch.exec(["temp/a"], { debounce: 0, waitDone: true, combineEvents: true }, helper.cmd("--delay 500"));

		create("temp/a");
		w.start(function () {
			setTimeout(function () {
				change("temp/a");
				helper.expectEvent("run", function () {
					change("temp/a");
					setTimeout(function () {
						change("temp/a");
						helper.expectEvent("exit", function () {
							helper.expectEvent("run", function () {
								helper.expectEvent("exit", function () {
									helper.expectNoEvents(1000, done);
								});
							});
						});
					}, 50);
				});
			}, watcherStartDelay);
		});
	});

	it(".waitDone == true + .combineEvents == false combine events in long queue", function (done) {
		w = watch.exec(["temp/a"], { debounce: 0, waitDone: true, combineEvents: false }, helper.cmd("--delay 500"));

		create("temp/a");
		w.start(function () {
			setTimeout(function () {
				change("temp/a");
				helper.expectEvent("run", function () {
					change("temp/a");
					setTimeout(function () {
						change("temp/a");
						helper.expectEvent("exit", function () {
							helper.expectEvent("run", function () {
								helper.expectEvent("exit", function () {
									helper.expectNoEvents(1000, done);
								});
							});
						});
					}, 50);
				});
			}, watcherStartDelay);
		});
	});

	it(".waitDone == false + .combineEvents == true", function (done) {
		w = watch.exec(["temp/a"], { waitDone: false, combineEvents: true }, helper.cmd("--stay-alive"));

		create("temp/a");
		w.start(function () {
			setTimeout(function () {
				change("temp/a");
				helper.expectEvent("run", function () {
					change("temp/a");
					helper.expectEvent("run", done);
				});
			}, watcherStartDelay);
		});
	});

	it(".waitDone == false + .combineEvents == false", function (done) {
		w = watch.exec(["temp/a", "temp/b"], { waitDone: false, combineEvents: false }, helper.cmd("--stay-alive"));

		create("temp/a");
		create("temp/b");
		w.start(function () {
			setTimeout(function () {
				change("temp/a");
				change("temp/b");
				helper.expectEvent("run", function () {
					helper.expectEvent("run", function () {
						change("temp/a");
						change("temp/b");
						helper.expectEvent("run", function () {
							helper.expectEvent("run", done);
						});
					});
				});
			}, watcherStartDelay);
		});
	});

	it(".shell == true", function (done) {
		w = watch.exec(["temp/a"], { shell: true, combineEvents: false }, "VAR=1; echo $VAR");
		w.start(function () {
			setTimeout(function () {
				create("temp/a");
			}, watcherStartDelay);
		});
		w.once("exec", function (err) {
			done();
		});
	});

	it(".shell == false", function (done) {
		w = watch.exec(["temp/a"], { shell: false, combineEvents: false }, "VAR=1; echo $VAR");
		w.start(function () {
			setTimeout(function () {
				create("temp/a");
			}, watcherStartDelay);
		});
		w.once("error", function (err) {
			done();
		});
	});

	it("custom .shell", function (done) {
		w = watch.exec(["temp/a"], { shell: "node -e", stdio: [null, "pipe", "pipe"], combineEvents: false }, "console.log(123)");
		w.start(function () {
			setTimeout(function () {
				create("temp/a");
			}, watcherStartDelay);
		});
		w.stdout.once("data", function (data) {
			assert.equal(data.toString(), "123\n");
			done();
		});
	});

	it(".throttle + .combineEvents = true", function (done) {
		w = watch.exec(["temp/a", "temp/b"], { combineEvents: true, throttle: 1000 }, helper.cmd());

		w.start(function () {
			setTimeout(function () {
				create("temp/a");
				create("temp/b");
				helper.expectEvent("run", { relFiles: ["temp/a", "temp/b"]}, function () {
					var start = Date.now();
					helper.expectEvent("exit", function () {
						create("temp/a");
						create("temp/b");
						helper.expectEvent("run", { relFiles: ["temp/a", "temp/b"]}, function () {
							var delay = Date.now() - start;
							assert(delay >= 900); // 100 ms to start process
							done();
						});
					});
				});
			}, watcherStartDelay);
		});
	});

	it(".throttle + .combineEvents = false", function (done) {
		w = watch.exec(["temp/a", "temp/b"], { combineEvents: false, throttle: 1500, debounce: 0 }, helper.cmd("--delay 1000"));

		w.start(function () {
			setTimeout(function () {
				create("temp/a");
				helper.expectEvent("run", { relFile: "temp/a"}, function () {
					var start = Date.now();
					helper.expectEvent("exit", function () {
						create("temp/b");
						helper.expectEvent("run", { relFile: "temp/b"}, function () {
							rimraf.sync("temp/a");
							helper.expectEvent("run", { relFile: "temp/a"}, function () {
								var delay = Date.now() - start;
								assert(delay >= 1400); // 100 ms to start process
								done();
							});
						});
					});
				});
			}, watcherStartDelay);
		});
	});

	it(".throttle + .restart", function (done) {
		w = watch.restart(["temp/a"], { throttle: 1000, combineEvents: false }, helper.cmd("--stay-alive"));

		w.start(function () {
			helper.expectEvent("run", function () {
				var start = Date.now();
				create("temp/a");
				helper.expectEvent("killed", function () {
					var delay = Date.now() - start;
					helper.expectEvent("run", function () {
						assert(delay >= 900); // 100 ms to start process
						done();
					});
				});
			});
		});
	});

	it(".parallelLimit", function (done) {
		w = watch.exec(["temp/a", "temp/b"], { waitDone: true, combineEvents: false, parallelLimit: 1 }, helper.cmd("--delay 500"));

		create("temp/a");
		create("temp/b");
		w.start(function () {
			setTimeout(function () {
				change("temp/a");
				change("temp/b");
				helper.expectEvent("run", function () {
					helper.expectEvent("exit", function () {
						helper.expectEvent("run", function () {
							helper.expectEvent("exit", done);
						});
					});
				});
			}, watcherStartDelay);
		});
	});

	it(".stdio pipe", function (done) {
		w = watch.exec(["temp/a"], { stdio: [null, "pipe", "pipe"], combineEvents: false }, helper.cmd());
		create("temp/a");
		w.start(function () {
			setTimeout(function () {
				var receivedOut = false;
				var receivedErr = false;
				change("temp/a");
				w.stdout.on("data", function (data) {
					receivedOut = true;
					if (receivedOut && receivedErr) {
						done();
					}
				});
				w.stderr.on("data", function (data) {
					receivedErr = true;
					if (receivedOut && receivedErr) {
						done();
					}
				});
			}, watcherStartDelay);
		});
	});
});

describe("API", function () {
	var w, helper;

	beforeEach(function () {
		rimraf.sync("temp");
		fs.mkdirSync("temp");
		helper = new CMDHelper();
	});

	afterEach(function (done) {
		rimraf.sync("temp");
		w.stop(function () {
			helper.clean();
			killBash("test-helper.js");
			done();
		});
	});

	it(".on(\"create\")", function (done) {
		w = watch.exec(["temp/a"], { combineEvents: false });
		w.start(function () {
			setTimeout(function () {
				create("temp/a");
				w.once("create", function (filePath) {
					assert.equal(filePath, "temp/a");
					done();
				});
			}, watcherStartDelay);
		});
	});

	it(".on(\"change\")", function (done) {
		w = watch.exec(["temp/a"], { combineEvents: false });
		create("temp/a");
		w.start(function () {
			setTimeout(function () {
				change("temp/a");
				w.once("change", function (filePath) {
					assert.equal(filePath, "temp/a");
					done();
				});
			}, watcherStartDelay);
		});
	});

	it(".on(\"delete\")", function (done) {
		w = watch.exec(["temp/a"], { combineEvents: false });
		create("temp/a");
		w.start(function () {
			setTimeout(function () {
				rimraf.sync("temp/a");
				w.once("delete", function (filePath) {
					assert.equal(filePath, "temp/a");
					done();
				});
			}, watcherStartDelay);
		});
	});

	it(".on(\"all\")", function (done) {
		w = watch.exec(["temp/a"], { combineEvents: false });
		w.start(function () {
			setTimeout(function () {
				create("temp/a");
				w.once("all", function (filePath, action) {
					assert.equal(filePath, "temp/a");
					assert.equal(action, "create");
					change("temp/a");
					w.once("all", function (filePath, action) {
						assert.equal(filePath, "temp/a");
						assert.equal(action, "change");
						rimraf.sync("temp/a");
						w.once("all", function (filePath, action) {
							assert.equal(filePath, "temp/a");
							assert.equal(action, "delete");
							done();
						});
					});
				});
			}, watcherStartDelay);
		});
	});

	it(".on(\"all\") + .combineEvents = true", function (done) {
		w = watch.exec(["temp/a", "temp/b"], { combineEvents: true, debounce: 500 });
		w.start(function () {
			setTimeout(function () {
				create("temp/a");
				create("temp/b");
				w.once("all", function (filePaths) {
					assert.deepEqual(filePaths, ["temp/a", "temp/b"]);
					change("temp/a");
					change("temp/b");
					w.once("all", function (filePaths) {
						assert.deepEqual(filePaths, ["temp/a", "temp/b"]);
						rimraf.sync("temp/a");
						rimraf.sync("temp/b");
						w.once("all", function (filePaths) {
							assert.deepEqual(filePaths, ["temp/a", "temp/b"]);
							done();
						});
					});
				});
			}, watcherStartDelay);
		});
	});

	it(".on(\"exec\")", function (done) {
		w = watch.exec(["temp/a"], { combineEvents: false }, helper.cmd("--stay-alive"));
		w.start(function () {
			setTimeout(function () {
				create("temp/a");
				w.once("exec", function () {
					done();
				});
			}, watcherStartDelay);
		});
	});

	it(".on(\"exec\") + .restart", function (done) {
		w = watch.restart(["temp/a"], { combineEvents: false }, helper.cmd("--stay-alive"));
		w.once("exec", function () {
			w.once("exec", function () {
				done();
			});
		});
		w.start(function () {
			create("temp/a");
		});
	});

	it(".on(\"restart\")", function (done) {
		w = watch.restart(["temp/a"], { combineEvents: false }, helper.cmd("--stay-alive"));
		w.start(function () {
			setTimeout(function () {
				create("temp/a");
				w.once("restart", function () {
					done();
				});
			}, watcherStartDelay);
		});
	});

	it(".on(\"kill\") + .restart", function (done) {
		w = watch.restart(["temp/a"], { combineEvents: false }, helper.cmd("--stay-alive wtf"));
		w.start(function () {
			setTimeout(function () {
				create("temp/a");
				w.once("kill", function () {
					done();
				});
			}, watcherStartDelay);
		});
	});

	it(".on(\"kill\") + .stop", function (done) {
		w = watch.exec(["temp/a"], { combineEvents: false }, helper.cmd("--stay-alive"));
		w.start(function () {
			setTimeout(function () {
				create("temp/a");
				helper.expectEvent("run", function () {
					w.stop();
					w.once("kill", function () {
						done();
					});
				});
			}, watcherStartDelay);
		});
	});

	it(".on(\"kill\") + .stop + .restart", function (done) {
		w = watch.restart(["temp/a"], { combineEvents: false }, helper.cmd("--stay-alive"));
		w.start(function () {
			w.stop();
			w.once("kill", function () {
				done();
			});
		});
	});

	it(".on(\"crash\")", function (done) {
		w = watch.exec(["temp/a"], { combineEvents: false }, helper.cmd("--exit 1"));
		w.start(function () {
			setTimeout(function () {
				create("temp/a");
				w.on("crash", function () {
					done();
				});
			}, watcherStartDelay);
		});
	});

	it(".on(\"crash\") + .restart", function (done) {
		w = watch.restart(["temp/a"], { combineEvents: false }, helper.cmd("--exit 1 --delay 500"));
		w.start(function () {
			w.once("crash", function () {
				done();
			});
		});
	});

	it(".on(\"error\")", function (done) {
		w = watch.exec(["temp/a"], { shell: false, combineEvents: false }, "non-existing-cmd");
		w.start(function () {
			setTimeout(function () {
				create("temp/a");
				w.once("error", function () {
					done();
				});
			}, watcherStartDelay);
		});
	});

	it(".on(\"error\") + restart", function (done) {
		w = watch.restart(["temp/a"], { shell: false, combineEvents: false }, "non-existing-cmd");
		w.start();
		w.once("error", function () {
			done();
		});
	});

	it(".on(\"exit\") code = 0", function (done) {
		w = watch.exec(["temp/a"], { combineEvents: false }, helper.cmd("--exit 0"));
		w.start(function () {
			setTimeout(function () {
				create("temp/a");
				w.once("exit", function (code) {
					assert.equal(code, 0);
					done();
				});
			}, watcherStartDelay);
		});
	});

	it(".on(\"exit\") code = 0 + .restart", function (done) {
		w = watch.restart(["temp/a"], { combineEvents: false }, helper.cmd("--exit 0 --delay 500"));
		w.start(function () {
			w.once("exit", function (code) {
				assert.equal(code, 0);
				done();
			});
		});
	});

	it(".on(\"exit\") code = 1", function (done) {
		w = watch.exec(["temp/a"], { combineEvents: false }, helper.cmd("--exit 1"));
		w.start(function () {
			setTimeout(function () {
				create("temp/a");
				w.once("exit", function (code) {
					assert.equal(code, 1);
					done();
				});
			}, watcherStartDelay);
		});
	});

	it(".on(\"exit\") code = 1 + .restart", function (done) {
		w = watch.restart(["temp/a"], { combineEvents: false }, helper.cmd("--exit 1 --delay 500"));
		w.start(function () {
			w.once("exit", function (code) {
				assert.equal(code, 1);
				done();
			});
		});
	});
});

