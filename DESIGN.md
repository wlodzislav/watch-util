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

// Constructor
var watcher = Watcher({
	debounce: "300ms", // exec/reload once in ms at max
	queue: true, // exec calback if it's already executing
	reglob: "3s", // perform reglob to watch added files
	restartOnError: true, // restart if exit code != 0
	restartOnSuccess: false, // restart if exit code == 0
	cwd: "path for resolving",
	persistLog: true, // save logs in files
	logDir: "./logs",
	logRotation: "5h", // s,m,h,d,M
	writeToConsole: true // write logs to console
});

// Create from file of from json object
var watcher = Watcher.load(fileName)

// Get watcher options
watcher.options()

// Set watcher options
watcher.options(values)

// Set watcher option value, all rules will be restarted
watcher.setOption("name", value)

// Add rules
// exec rule executes cmdOrFun when files watched by glob are changed
// restart rule restarts cmdOfFun when filew are changed
// options are optional and could overwrite any params from Watcher constructor
// cmdOrFun could be shell cmd or function
// rules are stopped by default
watcher.addExecRule([globPattern], optionalOptions, cmdOrFun)
watcher.addRestartRule([globPattern], {
	name: "name for log file", // by default log is named with generated id
	// + all options from Watcher()
}, cmdOrFun)
watcher.addRule(options)

// Serialize watcher
watcher.toJSON() // Note! Functions are serialized using .toString()

// Serialize watcher and write to file
watcher.save(fileName)

// Start REST api server
watcher.startREST({ port })

// Get rule by id
watcher.getRuleById(id)

// Stop wathing/executing all rules
watcher.stopAll()

// Start wathing/executing all rules
watcher.startAll()

// Stop then start wathing/executing all rules
watcher.restartAll()

// Stop then start wathing/executing all rules
watcher.restartAllStarted()

// Get all rules
watcher.rules() // [rule]

// Stop watching/eecuting
rule.stop()

// Start watching/eecuting
rule.start()

// Stop then start watching/eecuting
rule.restart()

// Get started flag
rule.isStarted()

// Get rule options merged with Watcher options and defaults
rule.options() // { type: "exec/reload", name, cmd, fun, debounce, queue, reglob, restartOnError, restartOnSuccess, logFile }

// Set rule options
rule.options(values)

// Set options, rule will be restarted
rule.setOption("name", value)

// Stop and delete rule
rule.delete()

// ReadStream for logs
rule.log.readStream

// Get all logs from rule
rule.log.all()

// Get all n last strings from logs
rule.log.tail(n)

// Get step lines from offset counting from the last
rule.log.getLastLines(offset, step)

// Get lines in data interval
rule.log.getByDateInterval(from, to)

// Write logs in memory to file using log options
rule.log.dump()

// Write logs in memory to specific file
rule.log.dump(path)

// Serialize rule
rule.toJSON()

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
