"use strict";
const vscode = require('vscode');
const Log_1 = require('./Log');
const ViperProtocol_1 = require('./ViperProtocol');
const fs = require('fs');
const Helper_1 = require('./Helper');
class HeapProvider {
    constructor() {
        this._onDidChange = new vscode.EventEmitter();
    }
    setState(heapGraph, index) {
        this.heapGraphs[index] = heapGraph;
    }
    resetState() {
        this.heapGraphs = [];
    }
    provideTextDocumentContent(uri) {
        let table;
        let darkGraphs = Helper_1.Helper.getConfiguration("darkGraphs");
        if (this.heapGraphs.length > 1) {
            table = ` <table>
  <tr><td>
   <h1 style="color:${ViperProtocol_1.StateColors.previousState(darkGraphs)}">Previous State</h1>
   ${this.heapGraphToContent(this.stateVisualizer.nextHeapIndex, 1 - this.stateVisualizer.nextHeapIndex)}
  </td><td>
   <h1 style="color:${ViperProtocol_1.StateColors.currentState(darkGraphs)}">Current State</h1>
   ${this.heapGraphToContent(1 - this.stateVisualizer.nextHeapIndex, this.stateVisualizer.nextHeapIndex)}
  </td></tr>
 </table>`;
        }
        else if (this.heapGraphs.length == 1) {
            table = ` <h1 style="color:${ViperProtocol_1.StateColors.currentState(darkGraphs)}">Current</h1>${this.heapGraphToContent(0)}`;
        }
        else {
            table = " <p>No graph to show</p>";
        }
        return `<head>
<style>
 table td, table td * {
  vertical-align: top;
 }
</style>        
</head>
<body>
 ${table}
 <p><font face="courier">${this.stringToHtml(this.stateVisualizer.globalInfo)}</font></p>
 <a href='${uri}'>view source</a>
</body>`;
    }
    heapGraphToContent(index, otherIndex) {
        let heapGraph = this.heapGraphs[index];
        if (!heapGraph) {
            Log_1.Log.error("invalid index for heapGraphToContent: " + index);
            return;
        }
        let compareToOther = typeof otherIndex !== 'undefined';
        let otherHeapGraph;
        if (compareToOther) {
            otherHeapGraph = this.heapGraphs[otherIndex];
        }
        let conditions = "";
        if (heapGraph.conditions.length > 0) {
            heapGraph.conditions.forEach(element => {
                //if the condition is new, draw it in bold (non optimized)
                let isNew = compareToOther && otherHeapGraph.conditions.indexOf(element) < 0;
                conditions += `     <tr><td>${isNew ? "<b>" : ""}${element}${isNew ? "</b>" : ""}</td></tr>\n`;
            });
            conditions = `<h3>Path conditions</h3>
    <table border="solid">${conditions}
    </table>`;
        }
        else {
            conditions = `<h3>No path conditions</h3>`;
        }
        let state = this.stateVisualizer.decorationOptions[heapGraph.state];
        let content = `
    <h2>file: ${heapGraph.fileName}<br />${heapGraph.methodType}: ${heapGraph.methodName}</h2>
    <h3${state.isErrorState ? ' style="color:red">Errorstate' : ">State"} ${state.numberToDisplay}<br />position: ${heapGraph.position.line + 1}:${heapGraph.position.character + 1}</h3>
    ${this.getSvgContent(Log_1.Log.svgFilePath(index))}
    ${conditions}
    <p>${this.stringToHtml(heapGraph.stateInfos)}</p><br />`;
        return content;
    }
    //<img src="${Log.svgFilePath(index)}"></img><br />
    getSvgContent(filePath) {
        let content = fs.readFileSync(filePath).toString();
        return content.substring(content.indexOf("<svg"), content.length);
    }
    get onDidChange() {
        //Log.log("PreviewHTML: onDidChange", LogLevel.Debug)
        return this._onDidChange.event;
    }
    update(uri) {
        this._onDidChange.fire(uri);
    }
    errorSnippet(error) {
        return `<body>\n\t${error}\n</body>`;
    }
    stringToHtml(s) {
        return s.replace(/\n/g, "<br />\n    ").replace(/\t/g, "&nbsp;");
    }
}
exports.HeapProvider = HeapProvider;
// ${editor.document.getText(new vscode.Range(editor.selection.start, editor.selection.end))}
// <div style='border:solid;width:100;height:100'>
// </div>
// <form action="demo_form.asp">
//     First name: <input type="text" name="fname"><br>
//     Last name: <input type="text" name="lname"><br>
//     <input type="submit" value="Submit">
// </form>
// external <a href='http://www.google.ch'>link</a>
// <br>
// <a href='command:vscode.previewHtml?"${uri}"'>refresh</a> using internal link
// <br>
// <a href='${uri}'>view source</a>
// <br>
// <a href='command:editor.action.showReferences?"${editor.document.uri}"'>command</a>
// <br>
// <a href='command:editor.action.startDebug?'>start Debug</a> 
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiVGV4dERvY3VtZW50Q29udGVudFByb3ZpZGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vc3JjL1RleHREb2N1bWVudENvbnRlbnRQcm92aWRlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUEsTUFBWSxNQUFNLFdBQU0sUUFBUSxDQUFDLENBQUE7QUFDakMsc0JBQWtCLE9BQU8sQ0FBQyxDQUFBO0FBQzFCLGdDQUF5RCxpQkFBaUIsQ0FBQyxDQUFBO0FBRTNFLE1BQVksRUFBRSxXQUFNLElBQUksQ0FBQyxDQUFBO0FBQ3pCLHlCQUFxQixVQUFVLENBQUMsQ0FBQTtBQUVoQztJQUFBO1FBRVksaUJBQVksR0FBRyxJQUFJLE1BQU0sQ0FBQyxZQUFZLEVBQWMsQ0FBQztJQTJHakUsQ0FBQztJQXhHVSxRQUFRLENBQUMsU0FBb0IsRUFBRSxLQUFhO1FBQy9DLElBQUksQ0FBQyxVQUFVLENBQUMsS0FBSyxDQUFDLEdBQUcsU0FBUyxDQUFDO0lBQ3ZDLENBQUM7SUFFTSxVQUFVO1FBQ2IsSUFBSSxDQUFDLFVBQVUsR0FBRyxFQUFFLENBQUM7SUFDekIsQ0FBQztJQUlNLDBCQUEwQixDQUFDLEdBQWU7UUFDN0MsSUFBSSxLQUFhLENBQUM7UUFDbEIsSUFBSSxVQUFVLEdBQVksZUFBTSxDQUFDLGdCQUFnQixDQUFDLFlBQVksQ0FBQyxDQUFDO1FBQ2hFLEVBQUUsQ0FBQyxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDN0IsS0FBSyxHQUFHOztzQkFFRSwyQkFBVyxDQUFDLGFBQWEsQ0FBQyxVQUFVLENBQUM7S0FDdEQsSUFBSSxDQUFDLGtCQUFrQixDQUFDLElBQUksQ0FBQyxlQUFlLENBQUMsYUFBYSxFQUFFLENBQUMsR0FBRyxJQUFJLENBQUMsZUFBZSxDQUFDLGFBQWEsQ0FBQzs7c0JBRWxGLDJCQUFXLENBQUMsWUFBWSxDQUFDLFVBQVUsQ0FBQztLQUNyRCxJQUFJLENBQUMs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