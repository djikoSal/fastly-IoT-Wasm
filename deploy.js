//* Compile and deploy
const fs = require('fs');

function _createTsFile(filterCodeRaw, filterCodeId, services) {
    const declarations = require('./services/assemblyscript_declarations.json');
    var tsSourceCode = "";
    // tsSourceCode += 'import "wasi";\n'; //! Should not be wasi
    tsSourceCode += "//add assemblyscript imports\n";
    services.forEach((serviceName) => {
        const declaration = declarations[serviceName];
        if (!declaration)
            throw Error(`The declaration/import statement for "${serviceName}" is missing`);
        tsSourceCode += `${declaration}\n`;
    });
    tsSourceCode += "export function filterCode(): void {\n";
    tsSourceCode += `${filterCodeRaw}\n`;
    tsSourceCode += "}";
    fs.writeFileSync(`filtercode/assemblyscript/${filterCodeId}.ts`, tsSourceCode);
}

function _compileToWasm(pathToSourceFile, filterCodeId) {
    //TODO: Make sure .wasm.map is not generated as well
    const asc = require('assemblyscript/cli/asc');
    asc.ready.then(() => {
        asc.main([
            pathToSourceFile,
            "-b", `filtercode/wasm/${filterCodeId}.wasm`,
            "-t", `filtercode/wasm/${filterCodeId}.wat` // textFile
        ], {
            //stdout: process.stdout, stderr: process.stderr
        }, function (err) {
            if (err) {
                console.log('Could not compile to wasm:\n' + err);
                return;
            }
        });
    });
}

function _transpileTS2JS(filterCodeId) {
    console.log('Starting transpiling TS 2 JS');
    const ts = require('typescript');
    let compilerOpts = {
        noEmitOnError: true,
        noImplicitAny: true,
        target: ts.ScriptTarget.ES5,
        module: ts.ModuleKind.CommonJS,
        outDir: `filtercode/javascript`,
    };
    let program = ts.createProgram([`filtercode/assemblyscript/${filterCodeId}.ts`], compilerOpts);
    let emitResult = program.emit();

    let allDiagnostics = ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics);
    allDiagnostics.forEach((diagnostic) => {
        if (diagnostic.file) {
            const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
            const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
            console.log(`${diagnostic.file.fileName} (${line + 1},${character + 1}): ${message}`);
        } else {
            console.log(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
        }
    });

    let exitCode = emitResult.emitSkipped ? 1 : 0;
    console.log(`Transpiling from TS 2 JS exiting with code '${exitCode}'.`);
}

function _postTranspile(jsPth, services) {
    const transpiledCode = fs.readFileSync(jsPth, 'utf-8');
    const startOfFunction = transpiledCode.indexOf('function filterCode');
    const endOfFunction = transpiledCode.lastIndexOf('exports.filterCode');
    const functionCode = transpiledCode.substring(startOfFunction, endOfFunction);
    var filterCodeJS = "";
    filterCodeJS += `// Insert some imports here that the filter code needs\n`;
    const serviceAPIs = require('./services/API');
    services.forEach((serviceName) => {
        if (!(serviceName in serviceAPIs))
            throw Error(`The service ${serviceName} could not be found`);
        filterCodeJS += `const ${serviceName} = require("../services/API").${serviceName}\n`
    })
    filterCodeJS += `${functionCode}\n`;
    filterCodeJS += 'exports.filterCode = filterCode\n';
    fs.writeFileSync(jsPth, filterCodeJS);

    // save js body alone as well
    fs.writeFileSync(jsPth + 'body', functionCode.split('\n').slice(1, -2).join('\n'));
}

function _addFilterCodeId2ServicesBinding(filterCodeId, services) {
    let data = JSON.parse(fs.readFileSync('./services/filterCodeId2Services.json', 'utf-8'));
    if (data[filterCodeId]) {
        data[filterCodeId]['services'] = services;
    } else {
        data[filterCodeId] = { 'services': services };
    }
    fs.writeFileSync('./services/filterCodeId2Services.json', JSON.stringify(data));
}

function deploy(filterCodeRaw, filterCodeId, services) {
    _createTsFile(filterCodeRaw, filterCodeId, services);
    _compileToWasm(`filtercode/assemblyscript/${filterCodeId}.ts`, filterCodeId);
    _transpileTS2JS(filterCodeId);
    _postTranspile(`filtercode/javascript/${filterCodeId}.js`, services);
    _addFilterCodeId2ServicesBinding(filterCodeId, services);
}

if (require.main == module) { // if this is running standalone
    let filterCodePth = process.argv[2];
    let filterCodeId = process.argv[3];
    let services = process.argv.slice(4);
    const filterCodeRaw = fs.readFileSync(filterCodePth, 'utf-8');
    deploy(filterCodeRaw, filterCodeId, services);
}

exports = deploy