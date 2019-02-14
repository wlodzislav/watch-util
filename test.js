var assert = require("assert");
var fs = require("fs");
var path = require("path");
var EventEmitter = require("events");

var touch = require("touch");
var rimraf = require("rimraf");

var Watcher = require("./watcher");

function opts(options) {
	return Object.assign({}, defaultOptions, options || {});
}

var callbackArguments = [];
var callback = function () {
	//console.log(arguments);
	if (_callback) {
		_callback.apply(null, arguments);
	} else {
		callbackArguments.push(arguments);
	}
};

function expectCallback() {
	if (arguments.length == 3) {
		var fileName = arguments[0];
		var event = arguments[1];
		var callback = arguments[2];
		_callback = function (f, e) {
			assert.equal(f, fileName);
			assert.equal(e, event);
			_callback = null;
			callback();
		}
	} else {
		var fileNames = arguments[0];
		var callback = arguments[1];
		_callback = function (f) {
			assert.deepEqual(f, fileNames);
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
	var timeout = setTimeout(callback, delay);

	_callback = function (f, e) {
		clearTimeout(timeout);
		_callback = null;
		callback(new Error("Callback is called with arguments " + [].join.call(arguments, ", ")));
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

var change = create;

function rm(f) {
	rimraf.sync(f);
}

function CMDHelper() {
	this._events = [];
	this.tmp = path.join(__dirname, "log");
	this.start();

	this.execCmdCombined = "node test-helper.js --type exec --cwd %cwd -- %relFiles -- %files";
	this.execCmd = "node test-helper.js --type exec --event %event %cwd --rel-file %relFile --file %file --rel-dir %relDir --dir %dir";
	this.execCrashCmd = "node test-helper.js --type exec --exit 1";
	this.reloadCmd = "node test-helper.js --type reload --cwd %cwd -- %relFiles -- %files";
}

CMDHelper.prototype.expectEvent = function () {
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
		assert.deepEqual(e.event, event);
		assert.deepEqual(copy, options);
		this._callback = null;
		callback();
	}
	if (callbackArguments.length) {
		var args = this._events.shift();
		this._callback.apply(null, args);
	}
}

CMDHelper.prototype.expectNoEvents = function (delay, callback) {
	var timeout = setTimeout(callback, delay);

	this._callback = function (e) {
		clearTimeout(timeout);
		this._callback = null;
		callback(new Error("Expect no events but received " + JSON.stringify(e)));
	}
	if (callbackArguments.length) {
		clearTimeout(timeout);
		var args = this._events.shift();
		this._callback.apply(null, args);
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
				//console.log(entry);
				this._nextLogLineIndex += 1;
				if (this._callback) {
					this._callback.apply(null, [entry]);
				} else {
					this._events.push([entry]);
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
	try {
		fs.unlinkSync(this.tmp);
	} catch (err) {}
};

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

	it("negate globs");
	it("globs apply sequentially");

	it("handle create", function (done) {
		w = new Watcher(["temp/a"], callback);

		w.start(function () {
			create("temp/a");
			expectCallback("temp/a", "create", done);
		});
	});

	it("handle change", function (done) {
		w = new Watcher(["temp/a"], callback);

		create("temp/a");
		w.start(function () {
			change("temp/a");
			expectCallback("temp/a", "change", done);
		});
	});

	it("handle delete", function (done) {
		w = new Watcher(["temp/a"], callback);

		create("temp/a");
		w.start(function () {
			rm("temp/a");
			expectCallback("temp/a", "delete", done);
		});
	});

	it("handle delete parent dir", function (done) {
		w = new Watcher(["temp/a"], callback);

		create("temp/a");
		w.start(function () {
			rm("temp");
			expectCallback("temp/a", "delete", done);
		});
	});

	it(".events", function (done) {
		w = new Watcher(["temp/a"], { events: ["create", "change"] }, callback);

		w.start(function () {
			create("temp/a");
			expectCallback("temp/a", "create", function () {
				change("temp/a");
				expectCallback("temp/a", "change", function () {
					rm("temp/a");
					expectNoCallback(500, done);
				});
			});
		});
	});


	it(".combineEvents same file", function (done) {
		w = new Watcher(["temp/a"], { debounce: 1000, combineEvents: true }, callback);

		create("temp/a");
		w.start(function () {
			change("temp/a");
			delete("temp/a");
			expectCallback(["temp/a"], done);
		});
	});

	it(".combineEvents multiple files", function (done) {
		w = new Watcher(["temp/a", "temp/b"], { debounce: 1000, combineEvents: true }, callback);

		create("temp/a");
		create("temp/b");
		w.start(function () {
			change("temp/a");
			change("temp/b");
			expectCallback(["temp/a", "temp/b"], done);
		});
	});

	it(".combineEvents == true + .debounce", function (done) {
		w = new Watcher(["temp/a", "temp/b"], { debounce: 1000, combineEvents: true }, callback);

		create("temp/a");
		create("temp/b");
		w.start(function () {
			change("temp/a");
			change("temp/b");
			setTimeout(function () {
				change("temp/b");
			}, 1100);
			expectCallback(["temp/a", "temp/b"], function () {
				expectCallback(["temp/b"], done);
			});
		});
	});

	it(".combineEvents == false + .debounce", function (done) {
		w = new Watcher(["temp/a", "temp/b"], { debounce: 1000, combineEvents: false }, callback);

		create("temp/a");
		create("temp/b");
		w.start(function () {
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
		});
	});

	it(".reglob");
});

describe("Running", function () {
	var helper;
	beforeEach(function () {
		rimraf.sync("temp");
		fs.mkdirSync("temp");
		helper = new CMDHelper();
	});

	afterEach(function (done) {
		rimraf.sync("temp");
		helper.clean();
		w.stop(done);
	});

	it("run cmd", function (done) {
		w = new Watcher(["temp/a"], helper.execCmd);

		create("temp/a");
		w.start(function () {
			change("temp/a");
			helper.expectEvent("run", done);
		});
	});

	it.skip(".restartOnError == true", function (done) {
		w = new Watcher(["temp/a"], { restartOnError: true, writeToConsole: true, debug: true }, helper.execCrashCmd);

		create("temp/a");
		w.start(function () {
			change("temp/a");
			helper.expectEvent("run", function () {
				helper.expectEvent("run", done);
			});
		});
	});

	it.skip(".restartOnError == false", function (done) {
		w = new Watcher(["temp/a"], helper.execCrashCmd);

		create("temp/a");
		w.start(function () {
			change("temp/a");
			helper.expectEvent("run", function () {
				helper.expectNoEvents(500, done);
			});
		});
	});

	it(".restartOnSuccess == true");
	it(".restartOnSuccess == false");

	it(".restartOnEvent == true");
	it(".restartOnEvent == false");

	it(".restart");

	it(".useShell == true");
	it(".useShell == false");

	it(".customShell");

	it(".throttle");

	it(".parallelLimit");

	it(".waitDone == true");
	it(".waitDone == false");

	it(".writeToConsole == true");
	it(".writeToConsole == false");

	it(".checkMtime == true");
	it(".checkMtime == false");

	it(".checkMD5 == true");
	it(".checkMD5 == false");

	it(".stdin");
});

describe("API", function () {
	it(".stop() + .start()");

	it(".on(\"create\")");
	it(".on(\"change\")");
	it(".on(\"delete\")");
	it(".on(\"all\")");
	it(".on(\"exec\")");
	it(".on(\"reload\")");
	it(".on(\"killed\")");
	it(".on(\"crashed\")");
	it(".on(\"exited\")");

	it(".stdout");
	it(".stderr");
	it(".stdin");
});

