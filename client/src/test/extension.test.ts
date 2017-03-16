// 
// Note: This example test is leveraging the Mocha test framework.
// Please refer to their documentation on https://mochajs.org/ for help.
//

// The module 'assert' provides assertion methods from node
import * as assert from 'assert';
import * as path from 'path';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import * as myExtension from '../extension';
import Uri from 'vscode-uri/lib/index';
import { Common, VerificationState } from '../ViperProtocol';
import { Event } from 'typescript.events';
import { State } from '../ExtensionState';
import * as child_process from 'child_process';
import * as mocha from 'mocha';
import { Helper } from '../Helper';

let ready = false;
//let verified = false;

let executionStates = [];

let backendReadyCallback = (b) => { };
let verificationCompletionCallback = (b, f) => { };
let abortCallback = () => { };
let updateViperToolsCallback = () => { };
let logFileOpened = () => { };
let workspaceVerificationCompletionCallback = (result) => { };
let idleCallback = () => { };

let internalErrorDetected: boolean;

const SILICON = 'silicon';
const CARBON = 'carbon';
const SIMPLE = 'simple.sil';
const LONG = 'longDuration.vpr';

//needs to be first test
StartViperIdeTests();

//Test core functionality
ViperIdeTests();

//Test corner cases, and timing related issues
ViperIdeStressTests();

//can take a long time. 
TestVerificationOfAllFilesInWorkspace();

//needs to be last test
FinishViperIdeTests();


function log(msg: string) {
    console.log("UnitTest: " + msg);
}

function waitForBackendStarted(): Promise<boolean> {
    return new Promise((resolve, reject) => {
        backendReadyCallback = () => { resolve(true); }
    });
}

function waitForVerification(backend: string, fileName: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
        verificationCompletionCallback = (b, f) => {
            log("Verificaion Completed: file: " + f + ", backend: " + b);
            if (b === backend && f === fileName) {
                resolve(true);
            }
        }
    });
}

function waitForVerificationOfAllFilesInWorkspace(): Promise<boolean> {
    return new Promise((resolve, reject) => {
        workspaceVerificationCompletionCallback = (res) => {
            resolve(res);
        }
    });
}

function waitForViperToolsUpdate(): Promise<boolean> {
    return new Promise((resolve, reject) => {
        updateViperToolsCallback = () => { resolve(true); }
    });
}

function waitForAbort(): Promise<boolean> {
    return new Promise((resolve, reject) => {
        abortCallback = () => { resolve(true); }
    });
}

function waitForLogFile(): Promise<boolean> {
    return new Promise((resolve, reject) => {
        logFileOpened = () => { resolve(true); }
    });
}

function waitForIdle(): Promise<boolean> {
    return new Promise((resolve, reject) => {
        idleCallback = () => {
            idleCallback = () => { };
            resolve(true);
        }
    });
}

function wait(timeout): Promise<boolean> {
    return new Promise((resolve, reject) => {
        setTimeout(function () {
            resolve(true);
        }, timeout);
    });
}

function registerUnitTestHandler() {
    myExtension.initializeUnitTest(function (state) {
        executionStates.push(state);
        if (state.event == "BackendStarted") {
            backendReadyCallback(state.backend);
            ready = true;
        }
        else if (state.event == "ViperUpdateComplete") {
            updateViperToolsCallback();
        }
        else if (state.event == "ViperUpdateFailed") {
        }
        else if (ready && state.event == "VerificationComplete") {
            verificationCompletionCallback(state.backend, state.fileName);
        }
        else if (state.event == 'VerificationStopped') {
            abortCallback();
        }
        else if (state.event == 'InternalError') {
            internalErrorDetected = true;
        }
        else if (state.event == 'LogFileOpened') {
            logFileOpened();
        } else if (state.event == 'AllFilesVerified') {
            workspaceVerificationCompletionCallback({ verified: state.verified, total: state.total });
        } else if (state.event == 'Idle') {
            idleCallback();
        }
    });
}

function StartViperIdeTests() {
    describe("ViperIDE tests", function () {
        before(() => {
            registerUnitTestHandler();
        });

        it("Language Detection, and Backend Startup test.", function (done) {
            this.timeout(60000);
            openFile(SIMPLE).then(document => {
                if (document.languageId != 'viper') {
                    throw new Error("The language of viper file was not detected correctly: should: viper, is: " + document.languageId);
                }
                return waitForBackendStarted();
            }).then(() => {
                //backend ready
                done();
            });
        });
    });
}

function ViperIdeTests() {
    // Defines a Mocha test suite to group tests of similar kind together
    describe("ViperIDE tests", function () {

        it("Viper Tools Update Test", function (done) {
            this.timeout(60000);
            vscode.commands.executeCommand('viper.updateViperTools');

            //wait until viper tools update done
            waitForViperToolsUpdate().then(() => {
                //viper tools update done
                return waitForBackendStarted();
            }).then(() => {
                //backend ready
                done();
            });
        })

        it("Test simple verification with silicon", function (done) {
            this.timeout(25000);
            //3. viper file should verify with silicon 
            waitForVerification(SILICON, SIMPLE).then(() => {
                //verified
                log("silicon verification complete");
                done();
            });
        });

        it("Test abort", function (done) {
            this.timeout(30000);

            //open a file that takes longer
            openFile(LONG);
            //stop the verification after 1000ms
            setTimeout(() => {
                vscode.commands.executeCommand('viper.stopVerification');
            }, 1000)

            waitForAbort().then(() => {
                //aborted
                //wait before reverifying
                return true //wait(500);
            }).then(() => {
                //reverify longDuration viper file
                vscode.commands.executeCommand('viper.verify');
                return waitForVerification(SILICON, LONG);
            }).then(() => {
                //verified
                done();
            })
        });

        it("Test not verifying verified files", function (done) {

            this.timeout(6000);

            let simpleAlreadyOpen = path.basename(vscode.window.activeTextEditor.document.fileName) == SIMPLE

            let timer = setTimeout(() => {
                done();
            }, 5000);

            //reopen simple silicon file
            openFile(SIMPLE).then(() => {
                if (simpleAlreadyOpen) return true;
                return waitForVerification(SILICON, SIMPLE);
            }).then(() => {
                //simulate context switch by opening non-viper file
                return openFile('empty.txt');
            }).then(() => {
                return openFile(SIMPLE);
            }).then(() => {
                //wait 5000ms for verification
                return waitForVerification(SILICON, SIMPLE);
            }).then(() => {
                //verified
                throw new Error("unwanted reverification of verified file after switching context");
            });
        });

        it("Test zooming", function (done) {
            this.timeout(11000);
            let timer = setTimeout(() => {
                done();
            }, 10000);
            vscode.commands.executeCommand("workbench.action.zoomIn").then(() => {
                return wait(500);
            }).then(() => {
                return vscode.commands.executeCommand("workbench.action.zoomOut");
            }).then(() => {
                return waitForBackendStarted();
            }).then(() => {
                //verified
                clearTimeout(timer);
            });
        });

        it("Test Helper Methods", function (done) {
            checkAssert(Helper.formatProgress(12.9), "13%", "formatProgress");
            checkAssert(Helper.formatSeconds(12.99), "13.0 seconds", "formatSeconds");
            checkAssert(Helper.isViperSourceFile("/folder/file.vpr"), true, "isViperSourceFile unix path");
            checkAssert(Helper.isViperSourceFile("..\\.\\folder\\file.sil"), true, "isViperSourceFile relavive windows path");
            checkAssert(!Helper.isViperSourceFile("C:\\absolute\\path\\file.ts"), true, "isViperSourceFile absolute windows path");
            checkAssert(path.basename(Helper.uriToString(Helper.getActiveFileUri())), SIMPLE, "active file");
            done();
        });

        it("Test opening logFile", function (done) {
            this.timeout(2000);

            vscode.commands.executeCommand('viper.openLogFile');
            waitForLogFile().then(() => {
                vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                return wait(500);
            }).then(() => {
                done();
            })
        });
    });
}

function ViperIdeStressTests() {
    describe("ViperIDE Stress Tests", function () {
        it("Stress test 1: multiple fast verification requests", function (done) {
            this.timeout(11000);
            internalErrorDetected = false;

            let verificationDone = false;

            let timer = setTimeout(() => {
                //the file should be verified exactly once
                //no internal error must happen
                if (!verificationDone) {
                    throw new Error("No verification completed");
                } else if (internalErrorDetected) {
                    throw new Error("Internal error detected");
                } else {
                    done();
                }
            }, 10000);

            //submit 10 verification requests
            for (let i = 0; i < 10; i++) {
                vscode.commands.executeCommand('viper.verify');
            }

            waitForVerification(SILICON, SIMPLE).then(() => {
                verificationDone = true;
                return waitForVerification(SILICON, SIMPLE);
            }).then(() => {
                throw new Error("multiple verifications seen");
            });
        });

        it("Stress test 2: quickly change backends", function (done) {
            this.timeout(50000);
            internalErrorDetected = false;

            vscode.commands.executeCommand('viper.selectBackend', 'carbon');

            //submit 10 verification requests
            for (let i = 0; i < 10; i++) {
                vscode.commands.executeCommand('viper.selectBackend', 'silicon');
                vscode.commands.executeCommand('viper.selectBackend', 'carbon');
            }

            wait(500).then(() => {
                vscode.commands.executeCommand('viper.selectBackend', 'silicon');
                return waitForVerification(SILICON, SIMPLE);
            }).then(() => {
                if (internalErrorDetected) {
                    throw new Error("Internal error detected");
                } else {
                    done();
                }
            });
        });

        it("Stress test 3: quickly start, stop, and restart verification", function (done) {
            this.timeout(15000);
            internalErrorDetected = false;

            vscode.commands.executeCommand('viper.verify');
            vscode.commands.executeCommand('viper.stopVerification');
            vscode.commands.executeCommand('viper.verify');
            waitForVerification(SILICON, SIMPLE).then(() => {
                if (internalErrorDetected) {
                    throw new Error("Internal error detected");
                } else {
                    done();
                }
            });
        });

        it("Stress test 4: closing all files right after starting verificaiton", function (done) {
            this.timeout(6000);
            internalErrorDetected = false;

            let timer = setTimeout(() => {
                //no internal error must happen
                if (internalErrorDetected) {
                    throw new Error("Internal error detected");
                } else {
                    done();
                }
            }, 5000);

            vscode.commands.executeCommand('viper.verify');
            vscode.commands.executeCommand('workbench.action.closeAllEditors');
        });

        it("Test simple verification with carbon", function (done) {
            this.timeout(35000);
            openFile(SIMPLE).then(() => {
                //change backend to carbon
                vscode.commands.executeCommand('viper.selectBackend', 'carbon');
                return waitForBackendStarted()
            }).then(() => {
                //backend ready
                return waitForVerification(CARBON, SIMPLE);
            }).then(() => {
                //verified
                done();
            })
        });
    })
}

//TODO: Not working yet
function TestVerificationOfAllFilesInWorkspace() {
    describe("Test Verification of all files in the workspace", function () {
        it("Test Verification of all files in the workspace", function (done) {
            this.timeout(100000);
            vscode.commands.executeCommand('workbench.action.closeAllEditors');
            waitForIdle().then(() => {
                vscode.commands.executeCommand('viper.verifyAllFilesInWorkspace', Helper.uriToString(TestContext.DATA_ROOT));
                return waitForVerificationOfAllFilesInWorkspace();
            }).then((result: any) => {
                if (result.verified == result.total) {
                    done();
                } else {
                    throw new Error("partially verified workspace: (" + result.verified + "/" + result.total + ")");
                }
            })
        });
    })
}

function FinishViperIdeTests() {
    describe("Finish Viper Tests", function () {
        it("Test closing all auxilary processes", function (done) {
            this.timeout(10000);
            TestContext.dispose();

            //wait 5000ms
            setTimeout(() => {
                let command: string;
                if (State.isWin) {
                    command = `wmic process where 'name="ng.exe" or (name="java.exe" and CommandLine like "%nailgun%") or name="Boogie.exe" or name="z3.exe"' get ProcessId,Name,commandline` // 
                } else {
                    command = 'pgrep -x -l -u "$UID" ng; pgrep -x -l -u "$UID" z3; pgrep -l -u "$UID" -f nailgun; pgrep -x -l -u "$UID" Boogie'
                }
                let pgrep = Common.executer(command);
                pgrep.stdout.on('data', data => {
                    let stringData = (<string>data).replace(/[\n\r]/g, " ");
                    if (/^.*?(\d+).*/.test(stringData)) {
                        throw new Error("Process found");
                    }
                });
                pgrep.on('exit', data => {
                    done();
                });
            }, 5000);
        });
    })
}
function checkAssert(seen, expected, message: string) {
    assert(expected === seen, message + ": Expected: " + expected + " Seen: " + seen);
}

function openFile(fileName): Promise<vscode.TextDocument> {
    return new Promise((resolve, reject) => {
        let filePath = path.join(TestContext.DATA_ROOT, fileName);
        log("open " + filePath);
        vscode.workspace.openTextDocument(filePath).then(document => {
            vscode.window.showTextDocument(document).then((editor) => {
                resolve(document);
            });
        });
    });
}

class TestContext {

    private static PROJECT_ROOT = path.join(__dirname, '../../');

    public static DATA_ROOT = path.join(TestContext.PROJECT_ROOT, "src", "test", "data");

    public static subscriptions: any[] = [];
    public static asAbsolutePath(relativePath: string): string {
        //return path.join(vscode.workspace.rootPath, relativePath);
        return path.join(TestContext.PROJECT_ROOT, relativePath);
    }

    public static dispose() {
        myExtension.deactivate();
        this.subscriptions.forEach(disposable => {
            disposable.dispose();
        });
    }
}