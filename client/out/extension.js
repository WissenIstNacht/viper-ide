'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const fs = require('fs');
const path = require('path');
const Timer_1 = require('./Timer');
const vscode = require('vscode');
const ExtensionState_1 = require('./ExtensionState');
const ViperProtocol_1 = require('./ViperProtocol');
const index_1 = require('vscode-uri/lib/index');
const Log_1 = require('./Log');
const StateVisualizer_1 = require('./StateVisualizer');
const Helper_1 = require('./Helper');
const ViperFormatter_1 = require('./ViperFormatter');
let statusBarItem;
let statusBarProgress;
let backendStatusBar;
let abortButton;
let autoSaver;
let state;
let verificationController;
let fileSystemWatcher;
let formatter;
let workList;
//let lastActiveTextEditor: vscode.Uri;
//for timing:
let verificationStartTime;
let timings;
let oldTimings;
let progressUpdater;
let lastProgress;
let progressLabel = "";
var TaskType;
(function (TaskType) {
    TaskType[TaskType["Save"] = 0] = "Save";
    TaskType[TaskType["Verify"] = 1] = "Verify";
    TaskType[TaskType["NoOp"] = 2] = "NoOp";
})(TaskType || (TaskType = {}));
let isUnitTest = false;
let unitTestResolve;
function initializeUnitTest(done) {
    isUnitTest = true;
    unitTestResolve = done;
    //activate(context);
}
exports.initializeUnitTest = initializeUnitTest;
// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
function activate(context) {
    lastVersionWithSettingsChange = {
        nailgunSettingsVersion: "0.2.15",
        backendSettingsVersion: "0.2.15",
        pathSettingsVersion: "0.2.15",
        userPreferencesVersion: "0.2.15",
        javaSettingsVersion: "0.2.15",
        advancedFeaturesVersion: "0.3.1"
    };
    workList = [];
    Log_1.Log.initialize();
    Log_1.Log.log('Viper-Client is now active!', ViperProtocol_1.LogLevel.Info);
    state = ExtensionState_1.State.createState();
    ExtensionState_1.State.checkOperatingSystem();
    context.subscriptions.push(state);
    fileSystemWatcher = vscode.workspace.createFileSystemWatcher('**/*{' + Helper_1.Helper.viperFileEndings.join(",") + "}");
    state.startLanguageServer(context, fileSystemWatcher, false); //break?
    registerHandlers();
    startAutoSaver();
    initializeStatusBar();
    registerFormatter();
    let uri = vscode.window.activeTextEditor.document.uri;
    ExtensionState_1.State.setLastActiveFile(uri, vscode.window.activeTextEditor);
    startVerificationController();
}
exports.activate = activate;
let verifyingAllFiles = false;
let allFilesToAutoVerify;
let nextFileToAutoVerify;
let autoVerificationResults;
let autoVerificationStartTime;
function verifyAllFilesInWorkspace() {
    autoVerificationStartTime = Date.now();
    verifyingAllFiles = true;
    autoVerificationResults = [];
    if (!ExtensionState_1.State.isBackendReady) {
        Log_1.Log.error("The backend must be running before verifying all files in the workspace");
        return;
    }
    let endings = "{" + Helper_1.Helper.viperFileEndings.join(",") + "}";
    vscode.workspace.findFiles('**/*' + endings, '').then((uris) => {
        Log_1.Log.log("Starting to verify " + uris.length + " viper files.", ViperProtocol_1.LogLevel.Info);
        allFilesToAutoVerify = uris;
        nextFileToAutoVerify = 0;
        autoVerifyFile();
    });
}
function printAllVerificationResults() {
    Log_1.Log.log("Verified " + autoVerificationResults.length + " files in " + formatSeconds((Date.now() - autoVerificationStartTime) / 100), ViperProtocol_1.LogLevel.Info);
    autoVerificationResults.forEach(res => {
        Log_1.Log.log("Verification Result: " + res, ViperProtocol_1.LogLevel.Info);
    });
}
function autoVerifyFile() {
    return new Promise((resolve, reject) => {
        if (nextFileToAutoVerify < allFilesToAutoVerify.length && verifyingAllFiles) {
            let currFile = allFilesToAutoVerify[nextFileToAutoVerify];
            Log_1.Log.log("AutoVerify " + path.basename(currFile.toString()));
            nextFileToAutoVerify++;
            vscode.workspace.openTextDocument(currFile).then((document) => {
                vscode.window.showTextDocument(document).then(() => {
                    verify(ExtensionState_1.State.getFileState(currFile), false);
                    resolve(true);
                });
            });
        }
        else {
            verifyingAllFiles = false;
            printAllVerificationResults();
            resolve(false);
        }
    });
}
let lastVersionWithSettingsChange;
function getRequiredVersion() {
    try {
        return lastVersionWithSettingsChange;
    }
    catch (e) {
        Log_1.Log.error("Error checking settings version: " + e);
        return null;
    }
}
function canStartDebugging() {
    try {
        let result = false;
        let reason;
        if (Helper_1.Helper.getConfiguration("advancedFeatures").enabled !== true) {
            reason = "Don't debug, You must first Enable the advanced features in the settings.";
        }
        else if (!ExtensionState_1.State.lastActiveFile) {
            reason = "Don't debug, no viper file open.";
        }
        else {
            let fileState = ExtensionState_1.State.lastActiveFile;
            let uri = fileState.uri;
            let filename = path.basename(uri.toString());
            let dontDebugString = `Don't debug ${filename}, `;
            if (!ExtensionState_1.State.isBackendReady) {
                reason = dontDebugString + "the backend is not ready";
            }
            else if (ExtensionState_1.State.isVerifying) {
                reason = dontDebugString + "a verification is running", ViperProtocol_1.LogLevel.Debug;
            }
            else if (!fileState.verified) {
                reason = dontDebugString + "the file is not verified, the verificaion will be started.", ViperProtocol_1.LogLevel.Debug;
                workList.push({ type: TaskType.Verify, uri: uri, manuallyTriggered: false });
            }
            else if (!fileState.stateVisualizer.readyToDebug) {
                reason = dontDebugString + "the verification provided no states";
            }
            else if (Helper_1.Helper.getConfiguration("advancedFeatures").simpleMode === true && !fileState.stateVisualizer.decorationOptions.some(option => option.isErrorState)) {
                reason = `Don't debug ${filename}. In simple mode debugging can only be started when there is an no error state.`;
            }
            else {
                result = true;
            }
        }
        return {
            result: result,
            reason: reason,
            error: null
        };
    }
    catch (e) {
        let error = "Error checking if Debugging can be started " + e;
        Log_1.Log.error(error);
        return {
            result: false,
            reason: null,
            error: error
        };
    }
}
function canStartVerification(task) {
    try {
        let result = false;
        let reason;
        let dontVerify = `Don't verify ${path.basename(task.uri.toString())}: `;
        if (!ExtensionState_1.State.isBackendReady) {
            reason = "Backend is not ready, wait for backend to start.";
        }
        else {
            let activeFile;
            let fileState = ExtensionState_1.State.getFileState(task.uri);
            if (vscode.window.activeTextEditor) {
                activeFile = vscode.window.activeTextEditor.document.uri.toString();
            }
            if (!task.manuallyTriggered && !autoVerify) {
                reason = dontVerify + "autoVerify is disabled.";
            }
            else if (!fileState.open) {
                reason = dontVerify + "file is closed";
            }
            else if (fileState.verifying) {
                reason = dontVerify + `file is verifying`;
            }
            else if (!task.manuallyTriggered && fileState.verified) {
                reason = dontVerify + `not manuallyTriggered and file is verified`;
            }
            else if (!activeFile) {
                reason = dontVerify + `no file is active`;
            }
            else if (activeFile !== task.uri.toString()) {
                reason = dontVerify + `another file is active`;
            }
            else {
                result = true;
            }
        }
        return {
            result: result,
            reason: reason,
            error: null
        };
    }
    catch (e) {
        let error = "Error checking if Verification can be started " + e;
        Log_1.Log.error(error);
        return {
            result: false,
            reason: null,
            error: error
        };
    }
}
function startVerificationController() {
    let verificationTimeout = 100; //ms
    verificationController = new Timer_1.Timer(() => {
        try {
            let done = false;
            let i = 0;
            //remove leading NoOps
            while (workList.length > 0 && workList[0].type == TaskType.NoOp) {
                workList.shift();
            }
            while (!done && workList.length > i) {
                let task = workList[i++];
                if (!Helper_1.Helper.isViperSourceFile(task.uri)) {
                    task.type = TaskType.NoOp;
                    Log_1.Log.log("Warning: Only handle viper files, not file: " + path.basename(task.uri.toString()), ViperProtocol_1.LogLevel.Info);
                    continue;
                }
                let fileState = ExtensionState_1.State.getFileState(task.uri);
                if (!fileState) {
                    Log_1.Log.error("The file is unknown to the verification controller: " + path.basename(task.uri.toString()), ViperProtocol_1.LogLevel.Debug);
                    continue;
                }
                switch (task.type) {
                    case TaskType.Verify:
                        let canVerify = canStartVerification(task);
                        if (canVerify.result) {
                            verify(fileState, task.manuallyTriggered);
                        }
                        else if (canVerify.reason) {
                            Log_1.Log.log(canVerify.reason, ViperProtocol_1.LogLevel.Info);
                        }
                        task.type = TaskType.NoOp;
                        break;
                    case TaskType.Save:
                        if (fileState.onlySpecialCharsChanged) {
                            fileState.onlySpecialCharsChanged = false;
                        }
                        else {
                            //Log.log("Save " + path.basename(task.uri.toString()) + " is handled", LogLevel.Info);
                            fileState.changed = true;
                            fileState.verified = false;
                            stopDebuggingOnServer();
                            stopDebuggingLocally();
                            workList.push({ type: TaskType.Verify, uri: task.uri, manuallyTriggered: false });
                        }
                        task.type = TaskType.NoOp;
                        break;
                }
            }
        }
        catch (e) {
            Log_1.Log.error("Error in verification controller: " + e);
            workList.shift();
        }
    }, verificationTimeout);
    state.context.subscriptions.push(verificationController);
    //trigger verification texteditorChange
    state.context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => {
        try {
            let editor = vscode.window.activeTextEditor;
            if (editor) {
                let uri = editor.document.uri;
                if (Helper_1.Helper.isViperSourceFile(uri.toString())) {
                    let oldViperFile = ExtensionState_1.State.lastActiveFile;
                    if (oldViperFile) {
                        //change in avtive viper file, remove special characters from the previous one
                        if (oldViperFile.uri.toString() !== uri.toString()) {
                            oldViperFile.decorationsShown = false;
                            oldViperFile.stateVisualizer.removeSpecialCharsFromClosedDocument(() => { });
                            stopDebuggingOnServer();
                            stopDebuggingLocally();
                        }
                    }
                    let fileState = ExtensionState_1.State.setLastActiveFile(uri, editor);
                    if (fileState) {
                        if (!fileState.verified) {
                            Log_1.Log.log("reverify because the active text editor changed", ViperProtocol_1.LogLevel.Debug);
                            workList.push({ type: TaskType.Verify, uri: uri, manuallyTriggered: false });
                        }
                        else {
                            Log_1.Log.log("don't reverify, the file is already verified", ViperProtocol_1.LogLevel.Debug);
                        }
                        Log_1.Log.log("Active viper file changed to " + path.basename(uri.toString()), ViperProtocol_1.LogLevel.Info);
                    }
                }
            }
        }
        catch (e) {
            Log_1.Log.error("Error handling active text editor change: " + e);
        }
    }));
}
function deactivate() {
    console.log("deactivate");
    state.dispose();
    console.log("state disposed");
    //TODO: make sure no doc contains special chars any more
    if (ExtensionState_1.State.lastActiveFile) {
        console.log("Removing special chars of last opened file.");
        ExtensionState_1.State.lastActiveFile.stateVisualizer.removeSpecialCharacters(() => {
            console.log("deactivated");
        });
    }
    console.log("Close Log");
    Log_1.Log.dispose();
    console.log("Deactivated");
}
exports.deactivate = deactivate;
function registerFormatter() {
    formatter = new ViperFormatter_1.ViperFormatter();
}
function initializeStatusBar() {
    statusBarProgress = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 11);
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
    updateStatusBarItem(statusBarItem, "Hello from Viper", "white");
    abortButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 9);
    abortButton.command = "extension.stopVerification";
    updateStatusBarItem(abortButton, "$(x) Stop", "orange", null, false);
    state.context.subscriptions.push(statusBarProgress);
    state.context.subscriptions.push(statusBarItem);
    state.context.subscriptions.push(abortButton);
    backendStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 12);
}
function updateStatusBarItem(item, text, color, tooltip = null, show = true) {
    item.text = text;
    item.color = color;
    item.tooltip = tooltip;
    if (show) {
        item.show();
    }
    else {
        item.hide();
    }
}
let autoVerify = true;
function toggleAutoVerify() {
    autoVerify = !autoVerify;
    if (autoVerify) {
        statusBarItem.color = 'white';
        statusBarItem.text = "Auto Verify is " + (autoVerify ? "on" : "off");
    }
}
function startAutoSaver() {
    let autoSaveTimeout = 1000; //ms
    autoSaver = new Timer_1.Timer(() => {
        //only save viper files
        if (vscode.window.activeTextEditor != null && vscode.window.activeTextEditor.document.languageId == 'viper') {
            if (Helper_1.Helper.getConfiguration('preferences').autoSave === true) {
                vscode.window.activeTextEditor.document.save();
            }
        }
    }, autoSaveTimeout);
    state.context.subscriptions.push(autoSaver);
    let onActiveTextEditorChangeDisposable = vscode.window.onDidChangeActiveTextEditor(resetAutoSaver);
    let onTextEditorSelectionChange = vscode.window.onDidChangeTextEditorSelection(resetAutoSaver);
    state.context.subscriptions.push(onActiveTextEditorChangeDisposable);
    state.context.subscriptions.push(onTextEditorSelectionChange);
}
function resetAutoSaver() {
    autoSaver.reset();
}
function handleStateChange(params) {
    try {
        if (!params.progress)
            Log_1.Log.log("The new state is: " + ViperProtocol_1.VerificationState[params.newState], ViperProtocol_1.LogLevel.Debug);
        let window = vscode.window;
        switch (params.newState) {
            case ViperProtocol_1.VerificationState.Starting:
                ExtensionState_1.State.isBackendReady = false;
                updateStatusBarItem(statusBarItem, 'starting', 'orange');
                break;
            case ViperProtocol_1.VerificationState.VerificationRunning:
                progressLabel = `verifying ${params.filename}:`;
                addTiming(params.progress, 'orange');
                abortButton.show();
                break;
            case ViperProtocol_1.VerificationState.PostProcessing:
                progressLabel = `postprocessing ${params.filename}:`;
                addTiming(params.progress, 'white');
                break;
            case ViperProtocol_1.VerificationState.Stage:
                Log_1.Log.log("Run " + params.stage + " for " + params.filename);
                updateStatusBarItem(statusBarItem, `File ${params.filename}: Stage ${params.stage}`, 'white');
            case ViperProtocol_1.VerificationState.Ready:
                clearInterval(progressUpdater);
                statusBarProgress.hide();
                abortButton.hide();
                ExtensionState_1.State.viperFiles.forEach(file => {
                    file.verifying = false;
                });
                ExtensionState_1.State.isVerifying = false;
                if (!params.verificationCompleted) {
                    updateStatusBarItem(statusBarItem, "ready", 'white');
                }
                else {
                    let uri = vscode.Uri.parse(params.uri);
                    //since at most one file can be verified at a time, set all to non-verified before potentially setting one to verified 
                    ExtensionState_1.State.viperFiles.forEach(state => state.verified = false);
                    let verifiedFile = ExtensionState_1.State.getFileState(params.uri);
                    verifiedFile.success = params.success;
                    if (params.success != ViperProtocol_1.Success.Aborted && params.success != ViperProtocol_1.Success.Error) {
                        verifiedFile.verified = true;
                    }
                    //complete the timing measurement
                    addTiming(100, 'white', true);
                    if (Helper_1.Helper.getConfiguration("preferences").showProgress === true) {
                        verifiedFile.stateVisualizer.addTimingInformationToFile({ total: params.time, timings: timings });
                    }
                    //workList.push({ type: TaskType.VerificationCompleted, uri: uri, success: params.success });
                    let msg = "";
                    switch (params.success) {
                        case ViperProtocol_1.Success.Success:
                            msg = `Successfully verified ${params.filename} in ${formatSeconds(params.time)}`;
                            Log_1.Log.log(msg, ViperProtocol_1.LogLevel.Default);
                            updateStatusBarItem(statusBarItem, "$(check) " + msg, 'lightgreen');
                            if (params.manuallyTriggered)
                                Log_1.Log.hint(msg);
                            //for SymbexLogger
                            let symbexDotFile = Log_1.Log.getSymbExDotPath();
                            let symbexSvgFile = Log_1.Log.getSymbExSvgPath();
                            if (Helper_1.Helper.getConfiguration("advancedFeatures").enabled === true && fs.existsSync(symbexDotFile)) {
                                verifiedFile.stateVisualizer.generateSvg(null, symbexDotFile, symbexSvgFile, () => { });
                            }
                            break;
                        case ViperProtocol_1.Success.ParsingFailed:
                            msg = `Parsing ${params.filename} failed after ${formatSeconds(params.time)}`;
                            Log_1.Log.log(msg, ViperProtocol_1.LogLevel.Default);
                            updateStatusBarItem(statusBarItem, "$(x) " + msg, 'red');
                            break;
                        case ViperProtocol_1.Success.TypecheckingFailed:
                            msg = `Type checking ${params.filename} failed after ${formatSeconds(params.time)} with ${params.nofErrors} error${params.nofErrors == 1 ? "s" : ""}`;
                            Log_1.Log.log(msg, ViperProtocol_1.LogLevel.Default);
                            updateStatusBarItem(statusBarItem, "$(x) " + msg, 'red');
                            break;
                        case ViperProtocol_1.Success.VerificationFailed:
                            msg = `Verifying ${params.filename} failed after ${formatSeconds(params.time)} with ${params.nofErrors} error${params.nofErrors == 1 ? "s" : ""}`;
                            Log_1.Log.log(msg, ViperProtocol_1.LogLevel.Default);
                            updateStatusBarItem(statusBarItem, "$(x) " + msg, 'red');
                            break;
                        case ViperProtocol_1.Success.Aborted:
                            updateStatusBarItem(statusBarItem, "Verification aborted", 'orange');
                            Log_1.Log.log(`Verifying ${params.filename} was aborted`, ViperProtocol_1.LogLevel.Info);
                            break;
                        case ViperProtocol_1.Success.Error:
                            let moreInfo = " - see View->Output->Viper for more info";
                            updateStatusBarItem(statusBarItem, `$(x) Internal error` + moreInfo, 'red');
                            msg = `Verifying ${params.filename} failed due to an internal error`;
                            Log_1.Log.log(`Internal Error: failed to verify ${params.filename}: Reason: ` + (params.error && params.error.length > 0 ? params.error : "Unknown Reason: Set loglevel to 5 and see the viper.log file for more details"));
                            Log_1.Log.hint(msg + moreInfo);
                            break;
                        case ViperProtocol_1.Success.Timeout:
                            updateStatusBarItem(statusBarItem, "Verification timed out", 'orange');
                            Log_1.Log.log(`Verifying ${params.filename} timed out`, ViperProtocol_1.LogLevel.Info);
                            break;
                    }
                    if (isUnitTest && unitTestResolve) {
                        if (verificationCompleted(params.success)) {
                            unitTestResolve("VerificationCompleted");
                        }
                    }
                }
                if (verifyingAllFiles) {
                    autoVerificationResults.push(`${ViperProtocol_1.Success[params.success]}: ${index_1.default.parse(params.uri).fsPath}`);
                    autoVerifyFile();
                }
                break;
            case ViperProtocol_1.VerificationState.Stopping:
                updateStatusBarItem(statusBarItem, 'preparing', 'orange');
                break;
            case ViperProtocol_1.VerificationState.Stopped:
                clearInterval(progressUpdater);
                updateStatusBarItem(statusBarItem, 'stopped', 'white');
                break;
            default:
                break;
        }
    }
    catch (e) {
        Log_1.Log.error("Error handling state change: " + e);
    }
}
function verificationCompleted(success) {
    return success == ViperProtocol_1.Success.Success
        || success == ViperProtocol_1.Success.ParsingFailed
        || success == ViperProtocol_1.Success.TypecheckingFailed
        || success == ViperProtocol_1.Success.VerificationFailed;
}
function handleSettingsCheckResult(params) {
    if (params.errors && params.errors.length > 0) {
        let nofErrors = 0;
        let nofWarnings = 0;
        let message = "";
        params.errors.forEach(error => {
            switch (error.type) {
                case ViperProtocol_1.SettingsErrorType.Error:
                    nofErrors++;
                    Log_1.Log.error("Settings Error: " + error.msg, ViperProtocol_1.LogLevel.Default);
                    break;
                case ViperProtocol_1.SettingsErrorType.Warning:
                    nofWarnings++;
                    Log_1.Log.log("Settings Warning: " + error.msg);
                    break;
            }
            message = error.msg;
        });
        let errorCounts = ((nofErrors > 0 ? ("" + nofErrors + " Error" + (nofErrors > 1 ? "s" : "")) : "") + (nofWarnings > 0 ? (" " + nofWarnings + " Warning" + (nofWarnings > 1 ? "s" : "")) : "")).trim();
        //update status bar
        Log_1.Log.log(errorCounts + " in settings detected.", ViperProtocol_1.LogLevel.Default);
        statusBarItem.text = errorCounts + " in settings";
        if (nofErrors > 0) {
            statusBarItem.color = 'red';
            ExtensionState_1.State.isBackendReady = false;
        }
        else if (nofWarnings > 0) {
            statusBarItem.color = 'orange';
        }
        if (nofErrors + nofWarnings > 1)
            message = "see View->Output->Viper";
        let userSettingsButton = { title: "Open User Settings" };
        let workspaceSettingsButton = { title: "Open Workspace Settings" };
        vscode.window.showInformationMessage("Viper Settings: " + errorCounts + ": " + message, userSettingsButton, workspaceSettingsButton).then((choice) => {
            try {
                if (choice && choice.title === workspaceSettingsButton.title) {
                    vscode.commands.executeCommand("workbench.action.openWorkspaceSettings");
                }
                else if (choice && choice.title === userSettingsButton.title) {
                    vscode.commands.executeCommand("workbench.action.openGlobalSettings");
                }
            }
            catch (e) {
                Log_1.Log.error("Error accessing " + choice.title + " settings: " + e);
            }
        });
    }
}
function registerHandlers() {
    state.client.onNotification(ViperProtocol_1.Commands.StateChange, (params) => handleStateChange(params));
    state.client.onNotification(ViperProtocol_1.Commands.SettingsChecked, (data) => handleSettingsCheckResult(data));
    state.client.onNotification(ViperProtocol_1.Commands.Hint, (data) => {
        Log_1.Log.hint(data);
    });
    state.client.onNotification(ViperProtocol_1.Commands.Log, (msg) => {
        Log_1.Log.log((Log_1.Log.logLevel >= ViperProtocol_1.LogLevel.Debug ? "S: " : "") + msg.data, msg.logLevel);
    });
    state.client.onNotification(ViperProtocol_1.Commands.ToLogFile, (msg) => {
        Log_1.Log.toLogFile((Log_1.Log.logLevel >= ViperProtocol_1.LogLevel.Debug ? "S: " : "") + msg.data, msg.logLevel);
    });
    state.client.onNotification(ViperProtocol_1.Commands.Error, (msg) => {
        Log_1.Log.error((Log_1.Log.logLevel >= ViperProtocol_1.LogLevel.Debug ? "S: " : "") + msg.data, msg.logLevel);
    });
    state.client.onNotification(ViperProtocol_1.Commands.BackendChange, (newBackend) => {
        try {
            updateStatusBarItem(backendStatusBar, newBackend, "white");
            ExtensionState_1.State.reset();
        }
        catch (e) {
            Log_1.Log.error("Error handling backend change: " + e);
        }
    });
    state.client.onNotification(ViperProtocol_1.Commands.FileOpened, (uri) => {
        try {
            Log_1.Log.log("File openend: " + path.basename(uri), ViperProtocol_1.LogLevel.Info);
            let uriObject = index_1.default.parse(uri);
            let fileState = ExtensionState_1.State.getFileState(uri);
            if (fileState) {
                fileState.open = true;
                fileState.verifying = false;
            }
            workList.push({ type: TaskType.Verify, uri: uriObject, manuallyTriggered: false });
        }
        catch (e) {
            Log_1.Log.error("Error handling file opened notification: " + e);
        }
    });
    state.client.onNotification(ViperProtocol_1.Commands.FileClosed, (uri) => {
        try {
            let uriObject = index_1.default.parse(uri);
            Log_1.Log.log("File closed: " + path.basename(uriObject.path), ViperProtocol_1.LogLevel.Info);
            let fileState = ExtensionState_1.State.getFileState(uri);
            if (fileState) {
                fileState.open = false;
                fileState.verified = false;
            }
            if (ExtensionState_1.State.lastActiveFile == fileState) {
                ExtensionState_1.State.lastActiveFile = null;
            }
            fileState.stateVisualizer.removeSpecialCharsFromClosedDocument(() => { });
        }
        catch (e) {
            Log_1.Log.error("Error handling file closed notification: " + e);
        }
    });
    state.client.onRequest(ViperProtocol_1.Commands.RequestRequiredVersion, () => {
        return getRequiredVersion();
    });
    state.context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((params) => {
        try {
            workList.push({ type: TaskType.Save, uri: params.uri });
        }
        catch (e) {
            Log_1.Log.error("Error handling saved document: " + e);
        }
    }));
    state.context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(() => {
        try {
            Log_1.Log.updateSettings();
            stopDebuggingOnServer();
            stopDebuggingLocally();
        }
        catch (e) {
            Log_1.Log.error("Error handling configuration change: " + e);
        }
    }));
    state.client.onNotification(ViperProtocol_1.Commands.BackendReady, (params) => {
        handleBackendReadyNotification(params);
    });
    //Heap visualization
    state.client.onNotification(ViperProtocol_1.Commands.StepsAsDecorationOptions, params => {
        try {
            let castParams = params;
            if (!castParams) {
                Log_1.Log.error("Invalid Params for StepsAdDecorationOptions");
            }
            let visualizer = ExtensionState_1.State.getVisualizer(castParams.uri);
            visualizer.storeNewStates(castParams);
        }
        catch (e) {
            Log_1.Log.error("Error handling steps as decoration options notification: " + e);
        }
    });
    state.client.onRequest(ViperProtocol_1.Commands.HeapGraph, (heapGraph) => {
        try {
            if (!heapGraph)
                return;
            if (Helper_1.Helper.getConfiguration("advancedFeatures").enabled === true) {
                let visualizer = ExtensionState_1.State.getVisualizer(heapGraph.fileUri);
                let state = visualizer.decorationOptions[heapGraph.state];
                if (Helper_1.Helper.getConfiguration("advancedFeatures").simpleMode === true) {
                    //Simple Mode
                    if (state.isErrorState) {
                        //replace the error state
                        visualizer.focusOnState(heapGraph);
                    }
                    else {
                        //replace the execution state
                        visualizer.setState(heapGraph, 1);
                    }
                }
                else {
                    //Advanced Mode
                    if (heapGraph.state != visualizer.previousState) {
                        visualizer.pushState(heapGraph);
                    }
                }
            }
            else {
                Log_1.Log.log("WARNING: Heap Graph is generated, even though the advancedFeatures are disabled.", ViperProtocol_1.LogLevel.Debug);
            }
        }
        catch (e) {
            Log_1.Log.error("Error displaying HeapGraph: " + e);
        }
    });
    vscode.window.onDidChangeTextEditorSelection((change) => {
        try {
            if (!change.textEditor.document) {
                Log_1.Log.error("document is undefined in onDidChangeTextEditorSelection");
                return;
            }
            let uri = change.textEditor.document.uri.toString();
            let start = change.textEditor.selection.start;
            let visualizer = ExtensionState_1.State.getVisualizer(uri);
            if (visualizer) {
                visualizer.showStateSelection(start);
            }
        }
        catch (e) {
            Log_1.Log.error("Error handling text editor selection change: " + e);
        }
    });
    /*state.client.onRequest(Commands.StateSelected, change => {
        try {
            let castChange = <{ uri: string, line: number, character: number }>change;
            if (!castChange) {
                Log.error("error casting stateSelected Request data");
            }
            let visualizer = State.viperFiles.get(castChange.uri).stateVisualizer;
            visualizer.showStateSelection({ line: castChange.line, character: castChange.character });
        } catch (e) {
            Log.error("Error handling state selected request: " + e);
        }
    });*/
    state.client.onNotification(ViperProtocol_1.Commands.VerificationNotStarted, uri => {
        try {
            Log_1.Log.log("Verification not started for " + path.basename(uri), ViperProtocol_1.LogLevel.Debug);
            //reset the verifying flag if it is not beeing verified
            ExtensionState_1.State.viperFiles.forEach(file => {
                file.verifying = false;
            });
            ExtensionState_1.State.isVerifying = false;
        }
        catch (e) {
            Log_1.Log.error("Error handling verification not started request: " + e);
        }
    });
    state.client.onNotification(ViperProtocol_1.Commands.StopDebugging, () => {
        stopDebuggingLocally();
    });
    //Command Handlers
    //verify
    state.context.subscriptions.push(vscode.commands.registerCommand('extension.verify', () => {
        workList.push({ type: TaskType.Verify, uri: vscode.window.activeTextEditor.document.uri, manuallyTriggered: true });
    }));
    //verifyAllFilesInWorkspace
    state.context.subscriptions.push(vscode.commands.registerCommand('extension.verifyAllFilesInWorkspace', () => {
        verifyAllFilesInWorkspace();
    }));
    //toggleAutoVerify
    state.context.subscriptions.push(vscode.commands.registerCommand('extension.toggleAutoVerify', () => {
        toggleAutoVerify();
    }));
    //selectBackend
    state.context.subscriptions.push(vscode.commands.registerCommand('extension.selectBackend', () => {
        try {
            if (!state.client) {
                Log_1.Log.hint("Extension not ready yet.");
            }
            else {
                state.client.sendRequest(ViperProtocol_1.Commands.RequestBackendNames, null).then((backendNames) => {
                    if (backendNames.length > 1) {
                        vscode.window.showQuickPick(backendNames).then(selectedBackend => {
                            if (selectedBackend && selectedBackend.length > 0) {
                                startBackend(selectedBackend);
                            }
                            else {
                                Log_1.Log.log("No backend was selected, don't change the backend");
                            }
                        });
                    }
                    else {
                        Log_1.Log.log("No need to ask user, since there is only one backend.", ViperProtocol_1.LogLevel.Debug);
                        startBackend(backendNames[0]);
                    }
                }, (reason) => {
                    Log_1.Log.error("Backend change request was rejected: reason: " + reason.toString());
                });
            }
        }
        catch (e) {
            Log_1.Log.error("Error selecting backend: " + e);
        }
    }));
    //start Debugging
    state.context.subscriptions.push(vscode.commands.registerCommand('extension.startDebugging', () => {
        try {
            //check if all the requirements are met to start debugging
            let canDebug = canStartDebugging();
            if (canDebug.result) {
                let uri = ExtensionState_1.State.lastActiveFile.uri;
                let filename = path.basename(uri.toString());
                let openDoc = uri.path;
                if (ExtensionState_1.State.isWin) {
                    openDoc = openDoc.substring(1, openDoc.length);
                }
                let launchConfig = {
                    name: "Viper Debug",
                    type: "viper",
                    request: "launch",
                    program: openDoc,
                    startInState: 0,
                    //console:"externalConsole"
                    internalConsoleOptions: "neverOpen"
                };
                if (ExtensionState_1.State.isDebugging) {
                    Log_1.Log.hint("Don't debug " + filename + ", the file is already being debugged");
                    return;
                }
                showStates(() => {
                    vscode.commands.executeCommand('vscode.startDebug', launchConfig).then(() => {
                        Log_1.Log.log('Debug session started successfully', ViperProtocol_1.LogLevel.Info);
                        ExtensionState_1.State.isDebugging = true;
                        vscode.commands.executeCommand("workbench.view.debug");
                    }, err => {
                        Log_1.Log.error("Error starting debugger: " + err.message);
                    });
                });
            }
            else if (canDebug.reason) {
                Log_1.Log.hint(canDebug.reason);
            }
        }
        catch (e) {
            Log_1.Log.error("Error starting debug session: " + e);
        }
    }));
    //stopVerification
    state.context.subscriptions.push(vscode.commands.registerCommand('extension.stopVerification', () => {
        if (verifyingAllFiles) {
            printAllVerificationResults();
            verifyingAllFiles = false;
        }
        if (state.client) {
            if (ExtensionState_1.State.isVerifying) {
                clearInterval(progressUpdater);
                Log_1.Log.log("Verification stop request", ViperProtocol_1.LogLevel.Debug);
                abortButton.hide();
                statusBarItem.color = 'orange';
                statusBarItem.text = "aborting";
                statusBarProgress.hide();
                state.client.sendNotification(ViperProtocol_1.Commands.StopVerification, ExtensionState_1.State.lastActiveFile.uri.toString());
            }
            else {
                Log_1.Log.hint("Cannot stop the verification, no verification is running.");
            }
        }
        else {
            Log_1.Log.hint("Extension not ready yet.");
        }
    }));
    //format
    state.context.subscriptions.push(vscode.commands.registerCommand('extension.format', () => {
        try {
            formatter.formatOpenDoc();
        }
        catch (e) {
            Log_1.Log.error("Error handling formating request: " + e);
        }
    }));
    //open logFile
    state.context.subscriptions.push(vscode.commands.registerCommand('extension.openLogFile', () => {
        try {
            Log_1.Log.log("Open logFile located at: " + Log_1.Log.logFilePath, ViperProtocol_1.LogLevel.Info);
            vscode.workspace.openTextDocument(Log_1.Log.logFilePath).then(textDocument => {
                vscode.window.showTextDocument(textDocument, vscode.ViewColumn.Two);
            });
        }
        catch (e) {
            Log_1.Log.error("Error opening log file: " + e);
        }
    }));
}
function startBackend(backendName) {
    try {
        ExtensionState_1.State.isBackendReady = false;
        state.client.sendNotification(ViperProtocol_1.Commands.StartBackend, backendName);
    }
    catch (e) {
        Log_1.Log.error("Error starting backend: " + e);
    }
}
function handleBackendReadyNotification(params) {
    try {
        ExtensionState_1.State.isBackendReady = true;
        Log_1.Log.log("Backend ready: " + params.name, ViperProtocol_1.LogLevel.Info);
        updateStatusBarItem(statusBarItem, "ready", 'white');
        //automatically trigger the first verification
        if (params.restarted) {
            //no file is verifying
            ExtensionState_1.State.resetViperFiles();
            if (ExtensionState_1.State.lastActiveFile && Helper_1.Helper.getConfiguration('preferences').autoVerifyAfterBackendChange === true) {
                Log_1.Log.log("autoVerify after backend change", ViperProtocol_1.LogLevel.Info);
                workList.push({ type: TaskType.Verify, uri: ExtensionState_1.State.lastActiveFile.uri, manuallyTriggered: false });
            }
        }
        if (isUnitTest && unitTestResolve) {
            unitTestResolve("BackendReady");
        }
    }
    catch (e) {
        Log_1.Log.error("Error handling backend started notification: " + e);
    }
}
function stopDebuggingOnServer() {
    if (ExtensionState_1.State.isDebugging) {
        Log_1.Log.log("Tell language server to stop debugging", ViperProtocol_1.LogLevel.Debug);
        state.client.sendNotification(ViperProtocol_1.Commands.StopDebugging);
    }
}
function stopDebuggingLocally() {
    try {
        if (ExtensionState_1.State.isDebugging) {
            Log_1.Log.log("Stop Debugging", ViperProtocol_1.LogLevel.Info);
            let visualizer = ExtensionState_1.State.lastActiveFile.stateVisualizer;
            hideStates(() => { }, visualizer);
        }
    }
    catch (e) {
        Log_1.Log.error("Error handling stop debugging request: " + e);
    }
}
function showStates(callback) {
    try {
        if (!StateVisualizer_1.StateVisualizer.showStates) {
            StateVisualizer_1.StateVisualizer.showStates = true;
            let visualizer = ExtensionState_1.State.lastActiveFile.stateVisualizer;
            visualizer.removeSpecialCharacters(() => {
                visualizer.addCharacterToDecorationOptionLocations(() => {
                    visualizer.showDecorations();
                    callback();
                });
            });
        }
        else {
            Log_1.Log.log("don't show states, they are already shown", ViperProtocol_1.LogLevel.Debug);
        }
    }
    catch (e) {
        Log_1.Log.error("Error showing States: " + e);
    }
}
function hideStates(callback, visualizer) {
    try {
        vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup').then(success => { }, error => {
            Log_1.Log.error("Error changing the focus to the first editorGroup");
        });
        ExtensionState_1.State.isDebugging = false;
        Log_1.Log.log("Hide states for " + visualizer.viperFile.name(), ViperProtocol_1.LogLevel.Info);
        StateVisualizer_1.StateVisualizer.showStates = false;
        visualizer.removeSpecialCharacters(() => {
            visualizer.hideDecorations();
            visualizer.reset();
            callback();
        });
    }
    catch (e) {
        Log_1.Log.error("Error hiding States: " + e);
    }
}
function verify(fileState, manuallyTriggered) {
    //reset timing;
    verificationStartTime = Date.now();
    timings = [];
    clearInterval(progressUpdater);
    lastProgress = 0;
    //load expected timing
    let expectedTimings = fileState.stateVisualizer.getLastTiming();
    if (expectedTimings && expectedTimings.total) {
        Log_1.Log.log("Verification is expected to take " + formatSeconds(expectedTimings.total), ViperProtocol_1.LogLevel.Info);
        oldTimings = expectedTimings;
    }
    let uri = fileState.uri.toString();
    if (Helper_1.Helper.isViperSourceFile(uri)) {
        if (!state.client) {
            Log_1.Log.hint("Extension not ready yet.");
        }
        else {
            let visualizer = ExtensionState_1.State.getVisualizer(uri);
            visualizer.completeReset();
            hideStates(() => {
                //delete old SymbExLog:
                Log_1.Log.deleteFile(Log_1.Log.getSymbExLogPath());
                //change fileState
                fileState.changed = false;
                fileState.verified = false;
                fileState.verifying = true;
                ExtensionState_1.State.isVerifying = true;
                //start progress updater
                clearInterval(progressUpdater);
                progressUpdater = setInterval(() => {
                    let progress = getProgress(lastProgress);
                    if (progress != lastProgress) {
                        lastProgress = progress;
                        let totalProgress = verifyingAllFiles ? ` (${nextFileToAutoVerify + 1}/${allFilesToAutoVerify.length})` : "";
                        Log_1.Log.log("Progress: " + progress, ViperProtocol_1.LogLevel.Debug);
                        statusBarProgress.text = progressBarText(progress);
                        statusBarItem.text = progressLabel + " " + formatProgress(progress) + totalProgress;
                    }
                }, 500);
                Log_1.Log.log("Request verification for " + path.basename(uri));
                let workspace = vscode.workspace.rootPath ? vscode.workspace.rootPath : path.dirname(fileState.uri.fsPath);
                let params = { uri: uri, manuallyTriggered: manuallyTriggered, workspace: workspace };
                state.client.sendNotification(ViperProtocol_1.Commands.Verify, params);
            }, visualizer);
        }
        //in case a debugging session is still running, stop it
        stopDebuggingOnServer();
        stopDebuggingLocally();
    }
}
function addTiming(paramProgress, color, hide = false) {
    let showProgressBar = Helper_1.Helper.getConfiguration('preferences').showProgress === true;
    timings.push(Date.now() - verificationStartTime);
    let progress = getProgress(paramProgress || 0);
    Log_1.Log.log("Progress: " + progress, ViperProtocol_1.LogLevel.Debug);
    let totalProgress = verifyingAllFiles ? ` (${nextFileToAutoVerify + 1}/${allFilesToAutoVerify.length})` : "";
    lastProgress = progress;
    if (hide)
        statusBarProgress.hide();
    else {
        updateStatusBarItem(statusBarProgress, progressBarText(progress), 'white', null, showProgressBar);
        updateStatusBarItem(statusBarItem, progressLabel + " " + formatProgress(progress) + totalProgress, color);
    }
}
function getProgress(progress) {
    try {
        let timeSpentUntilLastStep = timings.length > 0 ? timings[timings.length - 1] : 0;
        let timeAlreadySpent = Date.now() - verificationStartTime;
        if (oldTimings && oldTimings.timings) {
            let old = oldTimings.timings;
            if (old.length >= timings.length) {
                let timeSpentLastTime = timings.length > 0 ? old[timings.length - 1] : 0;
                let oldTotal = old[old.length - 1];
                let timeSpent = timeSpentUntilLastStep;
                if (old.length > timings.length && (timeAlreadySpent - timeSpentUntilLastStep) > (old[timings.length] - old[timings.length - 1])) {
                    //if this time we should already have completed the step, factor that in
                    timeSpentLastTime = old[timings.length];
                    timeSpent = timeAlreadySpent;
                }
                let leftToCompute = oldTotal - timeSpentLastTime;
                let estimatedTotal = timeSpent + leftToCompute;
                progress = 100 * Math.min((timeAlreadySpent / estimatedTotal), 1);
            }
            //don't show 100%, because otherwise people think it is done.
            if (progress > 99)
                progress = 99;
        }
        return progress;
    }
    catch (e) {
        Log_1.Log.error("Error computing progress: " + e);
    }
}
function progressBarText(progress) {
    progress = Math.floor(progress);
    let bar = "";
    for (var i = 0; i < progress / 10; i++) {
        bar = bar + "⚫";
    }
    for (var i = 10; i > progress / 10; i--) {
        bar = bar + "⚪";
    }
    return bar;
}
function formatSeconds(time) {
    return time.toFixed(1) + " seconds";
}
function formatProgress(progress) {
    if (!progress)
        return "0%";
    return progress.toFixed(0) + "%";
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXh0ZW5zaW9uLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vc3JjL2V4dGVuc2lvbi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZLENBQUM7QUFDYiw2REFBNkQ7QUFDN0QsOEVBQThFO0FBRTlFLE1BQVksRUFBRSxXQUFNLElBQUksQ0FBQyxDQUFBO0FBQ3pCLE1BQVksSUFBSSxXQUFNLE1BQU0sQ0FBQyxDQUFBO0FBQzdCLHdCQUFvQixTQUFTLENBQUMsQ0FBQTtBQUM5QixNQUFZLE1BQU0sV0FBTSxRQUFRLENBQUMsQ0FBQTtBQUNqQyxpQ0FBb0Isa0JBQWtCLENBQUMsQ0FBQTtBQUN2QyxnQ0FBNk4saUJBQWlCLENBQUMsQ0FBQTtBQUMvTyx3QkFBZ0Isc0JBQXNCLENBQUMsQ0FBQTtBQUN2QyxzQkFBa0IsT0FBTyxDQUFDLENBQUE7QUFDMUIsa0NBQThCLG1CQUFtQixDQUFDLENBQUE7QUFDbEQseUJBQXFCLFVBQVUsQ0FBQyxDQUFBO0FBQ2hDLGlDQUE2QixrQkFBa0IsQ0FBQyxDQUFBO0FBR2hELElBQUksYUFBYSxDQUFDO0FBQ2xCLElBQUksaUJBQWlCLENBQUM7QUFDdEIsSUFBSSxnQkFBZ0IsQ0FBQztBQUNyQixJQUFJLFdBQVcsQ0FBQztBQUNoQixJQUFJLFNBQWdCLENBQUM7QUFDckIsSUFBSSxLQUFZLENBQUM7QUFFakIsSUFBSSxzQkFBNkIsQ0FBQztBQUNsQyxJQUFJLGlCQUEyQyxDQUFDO0FBQ2hELElBQUksU0FBeUIsQ0FBQztBQUM5QixJQUFJLFFBQWdCLENBQUM7QUFFckIsdUNBQXVDO0FBRXZDLGFBQWE7QUFDYixJQUFJLHFCQUE2QixDQUFDO0FBQ2xDLElBQUksT0FBaUIsQ0FBQztBQUN0QixJQUFJLFVBQXNCLENBQUM7QUFDM0IsSUFBSSxlQUFlLENBQUM7QUFDcEIsSUFBSSxZQUFvQixDQUFDO0FBQ3pCLElBQUksYUFBYSxHQUFHLEVBQUUsQ0FBQztBQVN2QixJQUFLLFFBRUo7QUFGRCxXQUFL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