'use strict';
const ServerClass_1 = require('./ServerClass');
// import {LogEntry, LogType} from './LogEntry';
const Log_1 = require('./Log');
// import {Settings} from './Settings'
const ViperProtocol_1 = require('./ViperProtocol');
// import {NailgunService} from './NailgunService';
const VerificationTask_1 = require('./VerificationTask');
// import {Model} from './Model';
let ipc = require('node-ipc');
class DebugServer {
    static initialize() {
        this.startIPCServer();
        this.registerHandlers();
    }
    static registerHandlers() {
        ServerClass_1.Server.connection.onRequest({ method: 'variablesInLine' }, (lineNumber) => {
            let variables = [];
            if (ServerClass_1.Server.debuggedVerificationTask) {
                ServerClass_1.Server.debuggedVerificationTask.steps.forEach(element => {
                    if (element.position.line === lineNumber) {
                        element.store.forEach(variable => {
                            variables.push({
                                name: variable,
                                value: variable,
                                variablesReference: 0
                            });
                        });
                    }
                });
            }
        });
    }
    //communication with debugger
    static startIPCServer() {
        ipc.config.id = 'viper';
        ipc.config.retry = 1500;
        ipc.serve(function () {
            ipc.server.on('log', function (data, socket) {
                Log_1.Log.logWithOrigin("Debugger", data, ViperProtocol_1.LogLevel.LowLevelDebug);
            });
            ipc.server.on('launchRequest', function (data, socket) {
                try {
                    DebugServer.debuggerRunning = true;
                    Log_1.Log.log('Debugging was requested for file: ' + data, ViperProtocol_1.LogLevel.Debug);
                    VerificationTask_1.VerificationTask.pathToUri(data.program).then((uri) => {
                        ServerClass_1.Server.debuggedVerificationTask = ServerClass_1.Server.verificationTasks.get(uri);
                        let response = "true";
                        if (!ServerClass_1.Server.debuggedVerificationTask) {
                            //TODO: use better criterion to detect a missing verification
                            Log_1.Log.hint("Cannot debug file, you must first verify the file: " + uri);
                            response = "false";
                        }
                        ipc.server.emit(socket, 'launchResponse', response);
                        //TODO: is it right to connect each time debugging is started?
                        //connect to Debugger as client to be able to send messages
                        ipc.connectTo('viperDebugger', () => {
                            ipc.of.viperDebugger.on('connect', () => {
                                Log_1.Log.log("Language Server connected to Debugger, as client", ViperProtocol_1.LogLevel.Debug);
                            });
                            ipc.of.viperDebugger.on('disconnect', () => {
                                ipc.disconnect();
                                if (DebugServer.debuggerRunning) {
                                    Log_1.Log.log('LanguageServer disconnected from Debugger', ViperProtocol_1.LogLevel.Debug);
                                    DebugServer.debuggerRunning = false;
                                    VerificationTask_1.VerificationTask.connection.sendNotification(ViperProtocol_1.Commands.StopDebugging);
                                }
                            });
                        });
                    });
                }
                catch (e) {
                    Log_1.Log.error("Error handling lanch request: " + e);
                }
            });
            ipc.server.on('MoveRequest', function (dataString, socket) {
                try {
                    let data = JSON.parse(dataString);
                    let newState = -1;
                    //translate from client state to server state
                    let currentState = ServerClass_1.Server.debuggedVerificationTask.clientStepIndexToServerStep[data.state].index;
                    let steps = ServerClass_1.Server.debuggedVerificationTask.steps;
                    let currentDepth = steps[currentState].depthLevel();
                    switch (data.type) {
                        case ViperProtocol_1.StepType.Stay:
                            newState = currentState;
                            break;
                        case ViperProtocol_1.StepType.In:
                            newState = currentState + 1;
                            while (newState < steps.length && !steps[newState].canBeShownAsDecoration) {
                                newState++;
                            }
                            break;
                        case ViperProtocol_1.StepType.Back:
                            newState = currentState - 1;
                            while (newState >= 0 && !steps[newState].canBeShownAsDecoration) {
                                newState--;
                            }
                            break;
                        case ViperProtocol_1.StepType.Continue:
                            Log_1.Log.error("continue is not supported right now, do step next instead");
                        case ViperProtocol_1.StepType.Next:
                            for (let i = currentState + 1; i < steps.length; i++) {
                                let step = steps[i];
                                if (step.depthLevel() <= currentDepth && step.canBeShownAsDecoration) {
                                    //the step is on the same level or less deap
                                    newState = i;
                                    break;
                                }
                            }
                            break;
                        case ViperProtocol_1.StepType.Out:
                            for (let i = currentState + 1; i < steps.length; i++) {
                                let step = steps[i];
                                if (step.depthLevel() < currentDepth && step.canBeShownAsDecoration) {
                                    //the step is less deap
                                    newState = i;
                                    break;
                                }
                            }
                            break;
                    }
                    Log_1.Log.log(`Step${ViperProtocol_1.StepType[data.type]}: state ${data.state} -> state ${newState}`, ViperProtocol_1.LogLevel.LowLevelDebug);
                    let position = ServerClass_1.Server.debuggedVerificationTask ? ServerClass_1.Server.debuggedVerificationTask.getPositionOfState(newState) : { line: 0, character: 0 };
                    if (position.line >= 0) {
                        ServerClass_1.Server.showHeap(ServerClass_1.Server.debuggedVerificationTask, newState);
                    }
                    //translate from server state to client state
                    newState = steps[newState].decorationOptions.index;
                    ipc.server.emit(socket, 'MoveResponse', JSON.stringify({ position: position, state: newState }));
                }
                catch (e) {
                    Log_1.Log.error("Error handling move request: " + e);
                }
            });
            ipc.server.on('variablesInLineRequest', function (data, socket) {
                Log_1.Log.log('got a variables request for line ' + data, ViperProtocol_1.LogLevel.Debug);
                let lineNumber;
                try {
                    lineNumber = data - 0;
                }
                catch (error) {
                    Log_1.Log.error("Wrong format");
                }
                let variables = [];
                if (ServerClass_1.Server.debuggedVerificationTask) {
                    let steps = ServerClass_1.Server.debuggedVerificationTask.getStepsOnLine(lineNumber);
                    if (steps.length > 0) {
                        steps[0].store.forEach((variable) => {
                            variables.push(variable);
                        });
                    }
                }
                else {
                    Log_1.Log.error("no Server.debuggedVerificationTask available");
                }
                ipc.server.emit(socket, 'variablesInLineResponse', JSON.stringify(variables));
            });
            ipc.server.on('evaluateRequest', function (data, socket) {
                Log_1.Log.log(`evaluate(context: '${data.context}', '${data.expression}')`, ViperProtocol_1.LogLevel.LowLevelDebug);
                let evaluated = ServerClass_1.Server.debuggedVerificationTask.model.values.has(data.expression)
                    ? ServerClass_1.Server.debuggedVerificationTask.model.values.get(data.expression)
                    : "unknown";
                ipc.server.emit(socket, 'evaluateResponse', JSON.stringify(evaluated));
            });
            ipc.server.on('stackTraceRequest', function (data, socket) {
                Log_1.Log.log('stack trace request for line ' + data, ViperProtocol_1.LogLevel.Debug);
                let lineNumber;
                try {
                    lineNumber = data - 0;
                }
                catch (error) {
                    Log_1.Log.error("Wrong format");
                }
                let stepsOnLine = [];
                if (ServerClass_1.Server.debuggedVerificationTask) {
                    let steps = ServerClass_1.Server.debuggedVerificationTask.getStepsOnLine(lineNumber);
                    steps.forEach((step) => {
                        stepsOnLine.push({ "type": ViperProtocol_1.StatementType[step.type], position: step.position });
                    });
                }
                ipc.server.emit(socket, 'stackTraceResponse', JSON.stringify(stepsOnLine));
            });
        });
        ipc.server.start();
    }
    static moveDebuggerToPos(position, step) {
        if (DebugServer.debuggerRunning) {
            try {
                ipc.of.viperDebugger.emit("MoveDebuggerToPos", JSON.stringify({ position: position, step: step }));
                Log_1.Log.log("LanguageServer is telling Debugger to Move to Position of State " + step);
            }
            catch (e) {
                Log_1.Log.error("Error sending MoveDebuggerToPos request: " + e);
            }
        }
    }
    static stopDebugging() {
        if (DebugServer.debuggerRunning) {
            try {
                ipc.of.viperDebugger.emit("StopDebugging");
                Log_1.Log.log("LanguageServer is telling Debugger to stop debugging");
            }
            catch (e) {
                Log_1.Log.error("Error sending StopDebugging request: " + e);
            }
        }
    }
}
DebugServer.debuggerRunning = false;
exports.DebugServer = DebugServer;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiRGVidWdTZXJ2ZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zZXJ2ZXIvc3JjL0RlYnVnU2VydmVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVksQ0FBQztBQVliLDhCQUFxQixlQUFlLENBQUMsQ0FBQTtBQUVyQyxnREFBZ0Q7QUFDaEQsc0JBQWtCLE9BQU8sQ0FBQyxDQUFBO0FBQzFCLHNDQUFzQztBQUN0QyxnQ0FBc0ssaUJBRXRLLENBQUMsQ0FGc0w7QUFDdkwsbURBQW1EO0FBQ25ELG1DQUErQixvQkFBb0IsQ0FBQyxDQUFBO0FBRXBELGlDQUFpQztBQUVqQyxJQUFJLEdBQUcsR0FBRyxPQUFPLENBQUMsVUFBVSxDQUFDLENBQUM7QUFFOUI7SUFJSSxPQUFjLFVBQVU7UUFDcEIsSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDO1FBQ3RCLElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDO0lBQzVCLENBQUM7SUFFRCxPQUFjLGdCQUFnQjtRQUMxQixvQkFBTSxDQUFDLFVBQVUsQ0FBQyxTQUFTLENBQUMsRUFBRSxNQUFNLEVBQUUsaUJBQWlCLEVBQUUsRUFBRSxDQUFDLFVBQVU7WUFDbEUsSUFBSSxTQUFTLEdBQUcsRUFBRSxDQUFDO1lBQ25CLEVBQUUsQ0FBQyxDQUFDLG9CQUFNLENBQUMsd0JBQXdCLENBQUMsQ0FBQyxDQUFDO2dCQUNsQyxvQkFBTSxDQUFDLHdCQUF3QixDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsT0FBTztvQkFDakQsRUFBRSxDQUFDLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxJQUFJLEtBQUssVUFBVSxDQUFDLENBQUMsQ0FBQzt3QkFDdkMsT0FBTyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsUUFBUTs0QkFDMUIsU0FBUyxDQUFDLElBQUksQ0FBQztnQ0FDWCxJQUFJLEVBQUUsUUFBUTtnQ0FDZCxLQUFLLEVBQUUsUUFBUTtnQ0FDZixrQkFBa0IsRUFBRSxDQUFDOzZCQUN4QixDQUFD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