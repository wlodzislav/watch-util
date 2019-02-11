Utility for running, restarting and log viewing of multiple commands per project
================================================================================

Plan
====
- lib exec/restart
- cmd
- gui
- REST
- persistent logs

Features
========

- glob watching + exec/reload
- log view/search/filter + write/load
- project file
- gui + web gui
- REST api for integration

API
===

Watcher constructor
	var watcher = Watcher(options)
	var watcher = Watcher(globs, cmdOrFun)
	var watcher = Watcher(globs, options, cmdOrFun)

Options are:
	globs: ["*.js"], // array of globs
	cmd: "...", // shell chd to exec/reload, used if created with options only
	fun: function (fileName, action) {...}, // function to exed, used if created with options only
	debounce: 500, // exec/reload once in ms at max
	reglob: 2000, // perform reglob to watch added files
	//queue: true, // exec calback if its already executing
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
	debug: false

Serialize
	watcher.toJSON({ stringifyFun: true }) Note! Functions are serialized using .toString()

Manage options
	watcher.options()
	watcher.options(values)
	watcher.mergeOptions(values)
	watcher.getOption("name")
	watcher.setOption("name", value)

Run/stop
	watcher.start()
	watcher.stop()
	watcher.restart()
	watcher.isStarted()

PM Constructor
	var pm = ProcessesManager(options);

Options are the same as in Watcher(), and:
	watchers: [] // each watchers settings

Serialize pm settings
	pm.toJSON({ stringifyFun: true })

Manage options
	pm.options()
	pm.options(values)
	pm.mergeOptions(values)
	pm.getOption("name")
	pm.setOption("name", value)

Manage watchers
	pm.addWatcher(watcher)
	pm.addWatcher(watcherOptions)
	pm.addWatcher(globs, cmdOrFun)
	pm.addWatcher(globs, watcherOptions, cmdOrFun)
	pm.getWatcherById(id)
	pm.watchers()

Run/stop wathers
	pm.startAll()
	pm.stopAll()
	pm.restartAll()
	pm.restartAllStarted()

REST API
========

GET /options
POST /options
GET /options/:option
POST /options/:option

GET /rules
POST /rules

POST /rules/stopAll
POST /rules/startAll
POST /rules/restartAll

GET /rules/:ruleId
DELETE /rules/:ruleId
GET /rules/:ruleId/options
POST /rules/:ruleId/options
GET /rules/:ruleId/options/:option
POST /rules/:ruleId/options/:option

POST /rules/:ruleId/start
POST /rules/:ruleId/stop
POST /rules/:ruleId/restart

GET /rules/:ruleId/log
GET /rules/:ruleId/log?n=100
GET /rules/:ruleId/log?offset=0&step=100
GET /rules/:ruleId/log?from=...&to=...

POST /rules/:ruleId/log/dump
POST /rules/:ruleId/log/dump?path=...
