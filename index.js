var Watcher = require("./lib/watcher");

var watcher = {};

/*
	watcher.exec(globs, callback)
	watcher.exec(globs, options, callback)
	watcher.exec(globs) - to use with .on(event, handler)
	watcher.exec(globs, options)
	watcher.exec(globs, cmd)
	watcher.exec(globs, options, cmd)
*/
watcher.exec = function (globs) {
	var options, callback, cmd;
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
		if (typeof(arguments[1]) == "string") {
			cmd = arguments[2];
		} else {
			callback = arguments[2];
		}
	}

	options = options || {};

	var w = new Watcher(globs, options, cmd || callback);
	return w;
}

/*
	watcher.restart(globs, cmd)
	watcher.restart(globs, options, cmd)
*/
watcher.restart = function (globs) {
	var options, cmd;
	if (arguments.length == 2) {
		cmd = arguments[1];
	} else if (arguments.length == 3) {
		options = arguments[1];
		cmd = arguments[2];
	}

	options = options || {};
	options.restart = true;

	var w = new Watcher(globs, options, cmd);
	return w;
}

watcher.Watcher = Watcher;

module.exports = watcher;
