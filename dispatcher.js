var library = require("nrtv-library")(require)

module.exports = library.export(
  "nrtv-dispatcher",
  [library.collective({})],
  function(collective) {
    function Dispatcher() {
      this.tasks = []
      this.workers = []
      this.retainers = []
      this.working = false
    }

    Dispatcher.taskIds = {}

    Dispatcher.buildTask =
      function(args) {
        var task = {
          clean: true
        }

        do {
          task.id = Math.random().toString(36).split(".")[1]
        } while(Dispatcher.taskIds[task.id])

        for(var i=0; i<args.length; i++) {
          var arg = args[i]
          var isFunction = typeof arg == "function"
          var hasFunction = task.func || task.funcSource

          if (isFunction && !hasFunction) {
            task.func = arg
          } else if (isFunction) {
            task.callback = arg
          } else if (Array.isArray(arg)) {
            task.args = arg
          } else if (typeof arg == "object") {
            task = arg
          } else {
            throw Error("Not sure what to do with "+JSON.stringify(arg)+" in dispatcher.addTask. Expecting a function or two and optionally an array of arguments.")
          }
        }

        if (!task.funcSource && !task.func) {
          throw new Error("Your minion task ("+JSON.stringify(task)+") needs to have a func property with a function to run, or a funcSource property with the source of a function to run")
        } else if (typeof task.callback != "function") {
          throw new Error("Your minion task needs a callback")
        }

        return task
      }
    Dispatcher.prototype.addTask =
      function() {
        var task = Dispatcher.buildTask(arguments)
        this.tasks.push(task)
        this.work()
      }

    function callable(func) {
      if (typeof func == "string") {
        return eval("f="+func)
      } else if (typeof func == "function") {
        return func
      } else {
        throw new Error(func+" can't be turned into a function")
      }
    }

    Dispatcher.prototype.requestWork =
      function(callback) {

        if (this.retainers.length > 0) {
          var retainer = this.retainers.pop()
          retainer(callback)
          return
        }

        this.workers.push(callback)
        this.work()
        var workers = this.workers

        return {
          quit: function() {
            var i = workers.indexOf(callback)
            workers.splice(i, 1)
            callback.__nrtvMinionQuit = true
          }
        }
      }

    Dispatcher.prototype._getWorker =
      function(callback) {
        if (this.workers.length > 0) {
          var worker = this.workers.shift()
          callback(worker)
        } else {
          this.retainers.push(callback)
        }
      }

    Dispatcher.prototype.retainWorker =
      function(callback) {
        if (typeof callback == "function") {
          throw new Error("retainWorker doesn't take a callback. It just gives you a reference to a new dispatcher which will start working when your retained worker shows up.")
        }

        var centralDispatch = this

        var retainer = new Retainer(this)

        retainer.getWorker()

        return retainer
      }


    function Retainer(parent) {
      this.centralDispatch = parent
      this.dispatcher = new Dispatcher()
      this.isClean = false
    }

    Retainer.prototype.addTask =
      function() {
        var task = Dispatcher.buildTask(arguments)

        if (!this.isClean) {
          task.clean = true
          this.isClean = true
        } else {
          task.clean = false
        }
        
        this.dispatcher.addTask(task)
      }

    Retainer.prototype.resign =
      function() {
        this.centralDispatch.requestWork(this.worker)
      }

    Retainer.prototype.getWorker =
      function() {
        var retainer = this
        this.centralDispatch._getWorker(
          function(worker) {
            retainer.worker = worker

            retainer.dispatcher.requestWork(worker)
          }
        )
      }

    Dispatcher.prototype.work =
      function() {
        if (this.working) { return }
        this._work()
      }

    Dispatcher.prototype._work =
      function() {
        var noTasks = this.tasks.length < 1
        var noWorkers = this.workers.length < 1

        if (noTasks || noWorkers) {
          this.working = false
          return
        } else {
          this.working = true
        }

        var queue = this
        var tasks = this.tasks

        this._getWorker(
          function(worker) {
            var original = tasks.shift()

            var task = shallowClone(original)

            task.callback = checkForMore.bind(null, queue, worker, original.callback)

            worker(task)

            queue._work()
          }
        )

        function checkForMore(queue, worker, callback, message) {

          callback(message)

          if (!worker.__nrtvMinionQuit) {
            queue.workers.push(worker)
          }

          queue._work()
        }


      }

    function shallowClone(object) {
      var fresh = {}
      for(var key in object) {
        fresh[key] = object[key]
      }
      return fresh
    }

    library.collectivize(
      Dispatcher,
      collective,
      ["addTask", "requestWork"]
    )

    return Dispatcher
  }
)